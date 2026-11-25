import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { AlertSeverity, ComponentHealthView } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { runInTenantScope, tenantScopeStorage } from '../../database/tenant-scope';
import type { RequestWithContext } from '../middleware/request-context.middleware';
import { OutboundHttpService } from '../net/outbound-http.service';
import {
  signWebhookPayload,
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '../webhooks/webhook-signature';
import { AuditService } from './audit.service';
import { NotificationDispatchService } from './notification-dispatch.service';

export interface DispatchableAlert {
  id: string;
  tenantId: string | null;
  severity: AlertSeverity;
  category?: string | null;
  title: string;
  description?: string | null;
  source?: string | null;
  status?: string | null;
}

export interface DispatchableIncident {
  id: string;
  tenantId: string | null;
  severity: AlertSeverity;
  classification: string;
  status?: string | null;
}

export interface AlertRoute {
  channel: 'EMAIL' | 'SMS';
  recipient: string;
}

export interface AlertPolicy {
  webhookUrl: string | null;
  escalationMinutes: number;
  slaMinutes: number;
  onCallAlias: string;
  routes: Partial<Record<AlertSeverity, AlertRoute>>;
  signingSecret: string;
}

type AlertCreatedHook = (alert: DispatchableAlert, request?: RequestWithContext | null) => Promise<void> | void;

let alertCreatedHook: AlertCreatedHook | null = null;

/** Test/reset hook for the process-local bridge used by auth's alert creation. */
export function registerSecurityAlertHook(hook: AlertCreatedHook | null): void {
  alertCreatedHook = hook;
}

/**
 * Non-throwing bridge so a best-effort notification can never fail a login.
 * Auth calls this from its single security-alert creation site without taking
 * a new constructor dependency.
 */
export async function dispatchSecurityAlertCreated(
  alert: DispatchableAlert,
  request?: RequestWithContext | null,
): Promise<void> {
  try {
    await alertCreatedHook?.(alert, request);
  } catch {
    // Alerting is best-effort; callers must not observe dispatch failures.
  }
}

const POLICY_KEYS = [
  'alerts.webhookUrl',
  'alerts.escalationMinutes',
  'alerts.onCallAlias',
  'alerts.slaMinutes',
  'alerts.routes',
];

const HEALTH_SEVERITY: Record<string, AlertSeverity> = {
  DEGRADED: 'HIGH',
  DOWN: 'CRITICAL',
  UNKNOWN: 'MEDIUM',
};

const TERMINAL_STATUSES = new Set(['RESOLVED', 'CLOSED', 'FALSE_POSITIVE']);

@Injectable()
export class AlertDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertDispatchService.name);
  private readonly timers = new Map<string, { escalation?: NodeJS.Timeout; sla?: NodeJS.Timeout }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: OutboundHttpService,
    private readonly notifications: NotificationDispatchService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    registerSecurityAlertHook((alert, request) => this.onCreateSecurityAlert(alert, request));
  }

  onModuleDestroy(): void {
    registerSecurityAlertHook(null);
    for (const key of [...this.timers.keys()]) this.clearTimers(key);
  }

  /** Initial dispatch for a newly created security alert (including auth alerts). */
  async onCreateSecurityAlert(alert: DispatchableAlert, request?: RequestWithContext | null): Promise<void> {
    const policy = await this.readPolicy();
    const route = this.routeFor(alert.severity, policy);
    const now = new Date();
    const escalationAt = new Date(now.getTime() + policy.escalationMinutes * 60_000);
    const slaDeadline = new Date(now.getTime() + policy.slaMinutes * 60_000);

    await this.createAndDispatchNotification({
      tenantId: alert.tenantId,
      channel: route.channel,
      recipient: route.recipient,
      templateKey: `alert.${alert.severity.toLowerCase()}`,
      subject: `${alert.severity} alert: ${alert.title}`,
      body: [alert.title, alert.description, alert.source ? `Source: ${alert.source}` : null]
        .filter(Boolean)
        .join('\n'),
      request,
    });
    await this.postSignedAlert('created', alert, policy, { route, escalationAt, slaDeadline }, request);
    await this.audit.record({
      actorUserId: request?.principal?.userId ?? null,
      actorEmail: request?.principal?.email ?? null,
      tenantId: alert.tenantId,
      action: 'security.alert.dispatched',
      resourceType: 'security_alert',
      resourceId: alert.id,
      newValues: {
        severity: alert.severity,
        channel: route.channel,
        recipient: route.recipient,
        escalationAt: escalationAt.toISOString(),
        slaDeadline: slaDeadline.toISOString(),
      },
      request,
    });
    this.schedule(`alert:${alert.id}`, alert, route, policy, request);
  }

  /** Alert acknowledgement/closure cancels any outstanding escalation and SLA timers. */
  async onSecurityAlertUpdated(
    alert: DispatchableAlert,
    previousStatus: string,
    principal: { userId?: string; email?: string | null } | null | undefined,
    request?: RequestWithContext | null,
  ): Promise<void> {
    const key = `alert:${alert.id}`;
    const status = alert.status ?? '';
    const acknowledged = ['INVESTIGATING', 'CONTAINED'].includes(status) && status !== previousStatus;
    if (acknowledged || TERMINAL_STATUSES.has(status)) this.clearTimers(key);
    await this.audit.record({
      actorUserId: principal?.userId ?? null,
      actorEmail: principal?.email ?? null,
      tenantId: alert.tenantId,
      action: acknowledged ? 'security.alert.acknowledged' : 'security.alert.status_changed',
      resourceType: 'security_alert',
      resourceId: alert.id,
      previousValues: { status: previousStatus },
      newValues: { status, escalationCancelled: acknowledged || TERMINAL_STATUSES.has(status) },
      request,
    });
  }

  async onSecurityIncidentUpdated(
    incident: DispatchableIncident,
    previousStatus: string,
    principal: { userId?: string; email?: string | null } | null | undefined,
    request?: RequestWithContext | null,
  ): Promise<void> {
    const status = incident.status ?? '';
    if (TERMINAL_STATUSES.has(status)) this.clearTimers(`incident:${incident.id}`);
    await this.audit.record({
      actorUserId: principal?.userId ?? null,
      actorEmail: principal?.email ?? null,
      tenantId: incident.tenantId,
      action: 'security.incident.status_changed',
      resourceType: 'security_incident',
      resourceId: incident.id,
      previousValues: { status: previousStatus },
      newValues: { status, severity: incident.severity },
      request,
    });
  }

  /** Persists only real component status transitions and alerts on degradation. */
  async trackHealthTransitions(components: ComponentHealthView[]): Promise<void> {
    for (const component of components) {
      const previous = await this.runElevated((tx) =>
        tx.systemHealthEvent.findFirst({
          where: { component: component.component },
          orderBy: { detectedAt: 'desc' },
        }),
      );
      const previousStatus = previous?.status ?? null;
      if (previousStatus === component.status || (!previous && component.status === 'HEALTHY')) continue;

      const detectedAt = new Date(component.detectedAt);
      const eventId = await this.runElevated(async (tx) => {
        const created = await tx.systemHealthEvent.create({
          data: {
            component: component.component,
            status: component.status as never,
            latencyMs: component.latencyMs ?? null,
            details: (component.details ?? Prisma.JsonNull) as never,
            detectedAt,
          },
          select: { id: true },
        });
        if (previous && component.status === 'HEALTHY' && !previous.resolvedAt) {
          await tx.systemHealthEvent.update({ where: { id: previous.id }, data: { resolvedAt: detectedAt } });
        }
        return created.id;
      });
      await this.audit.record({
        action: 'system.health.transition',
        resourceType: 'system_health_event',
        resourceId: eventId,
        tenantId: null,
        previousValues: { status: previousStatus },
        newValues: { status: component.status, component: component.component, latencyMs: component.latencyMs },
      });
      const severity = HEALTH_SEVERITY[component.status];
      if (severity) {
        await this.onCreateSecurityAlert({
          id: `health:${component.component}`,
          tenantId: null,
          severity,
          category: 'SYSTEM_HEALTH',
          title: `${component.component} is ${component.status}`,
          description: component.details?.error
            ? String(component.details.error)
            : `${component.component} reported ${component.status}`,
          source: 'platform-health',
          status: 'OPEN',
        });
      }
    }
  }

  async readPolicy(): Promise<AlertPolicy> {
    const config = this.config;
    const fallbackAlias = config.get<string>('alerts.onCallAlias') || 'platform-oncall';
    const defaults: AlertPolicy = {
      webhookUrl: config.get<string>('alerts.webhookUrl') || null,
      escalationMinutes: config.get<number>('alerts.escalationMinutes') ?? 15,
      slaMinutes: config.get<number>('alerts.slaMinutes') ?? 60,
      onCallAlias: fallbackAlias,
      routes: this.defaultRoutes(fallbackAlias),
      signingSecret: config.get<string>('security.encryptionMasterKey') ?? '',
    };
    try {
      const rows = await this.runElevated((tx) =>
        tx.platformSetting.findMany({ where: { key: { in: POLICY_KEYS } } }),
      );
      const values = new Map<string, unknown>(rows.map((row) => [row.key, row.value]));
      const alertsObject = this.asRecord(values.get('alerts'));
      const pick = (key: string): unknown =>
        values.has(key) ? values.get(key) : alertsObject[key.slice('alerts.'.length)];
      const alias = this.asString(pick('alerts.onCallAlias')) ?? defaults.onCallAlias;
      const routesValue = pick('alerts.routes');
      return {
        webhookUrl: this.asString(pick('alerts.webhookUrl')) ?? defaults.webhookUrl,
        escalationMinutes: this.asPositiveInt(pick('alerts.escalationMinutes'), defaults.escalationMinutes),
        slaMinutes: this.asPositiveInt(pick('alerts.slaMinutes'), defaults.slaMinutes),
        onCallAlias: alias,
        routes: routesValue === undefined ? (alias === defaults.onCallAlias ? defaults.routes : this.defaultRoutes(alias)) : this.parseRoutes(routesValue, alias),
        signingSecret: defaults.signingSecret,
      };
    } catch {
      return defaults;
    }
  }

  private schedule(
    key: string,
    alert: DispatchableAlert,
    route: AlertRoute,
    policy: AlertPolicy,
    request?: RequestWithContext | null,
  ): void {
    this.clearTimers(key);
    const escalation = setTimeout(() => {
      void this.escalate(key, alert, route, policy, request).catch((error: unknown) =>
        this.logger.warn(`Alert escalation failed: ${error instanceof Error ? error.message : 'unknown error'}`),
      );
    }, policy.escalationMinutes * 60_000);
    const sla = setTimeout(() => {
      void this.audit
        .record({
          tenantId: alert.tenantId,
          action: 'security.alert.sla_breached',
          resourceType: 'security_alert',
          resourceId: alert.id,
          outcome: 'FAILURE',
          newValues: { slaMinutes: policy.slaMinutes, deadlineAt: new Date().toISOString() },
          request,
        })
        .catch(() => undefined);
    }, policy.slaMinutes * 60_000);
    escalation.unref?.();
    sla.unref?.();
    this.timers.set(key, { escalation, sla });
  }

  private async escalate(
    key: string,
    alert: DispatchableAlert,
    route: AlertRoute,
    policy: AlertPolicy,
    request?: RequestWithContext | null,
  ): Promise<void> {
    // A single escalation per alert lifecycle. Keep the SLA timer alive: an
    // escalated alert can still breach its SLA and must be audited as such.
    const hadEscalation = Boolean(this.timers.get(key)?.escalation);
    this.clearEscalationTimer(key);
    if (!hadEscalation) return;
    await this.createAndDispatchNotification({
      tenantId: alert.tenantId,
      channel: route.channel,
      recipient: policy.onCallAlias || route.recipient,
      templateKey: `alert.escalation.${alert.severity.toLowerCase()}`,
      subject: `ESCALATED ${alert.severity}: ${alert.title}`,
      body: `${alert.title}\nEscalated to ${policy.onCallAlias || route.recipient} after ${policy.escalationMinutes} minutes`,
      request,
    });
    await this.postSignedAlert('escalation', alert, policy, { route, escalationAt: new Date(), slaDeadline: null }, request);
    await this.audit.record({
      tenantId: alert.tenantId,
      action: 'security.alert.escalated',
      resourceType: 'security_alert',
      resourceId: alert.id,
      previousValues: { status: alert.status ?? 'OPEN' },
      newValues: { recipient: policy.onCallAlias || route.recipient, afterMinutes: policy.escalationMinutes },
      request,
    });
  }

  private clearTimers(key: string): void {
    const timers = this.timers.get(key);
    if (timers?.escalation) clearTimeout(timers.escalation);
    if (timers?.sla) clearTimeout(timers.sla);
    this.timers.delete(key);
  }

  /** Cancels only escalation; the SLA deadline remains tracked. */
  private clearEscalationTimer(key: string): void {
    const timers = this.timers.get(key);
    if (!timers) return;
    if (timers.escalation) clearTimeout(timers.escalation);
    timers.escalation = undefined;
  }

  private async createAndDispatchNotification(input: {
    tenantId: string | null;
    channel: AlertRoute['channel'];
    recipient: string;
    templateKey: string;
    subject: string;
    body: string;
    request?: RequestWithContext | null;
  }): Promise<void> {
    const notification = await this.runElevated((tx) =>
      tx.notification.create({
        data: {
          tenantId: input.tenantId,
          channel: input.channel,
          templateKey: input.templateKey,
          recipient: input.recipient,
          subject: input.subject.slice(0, 300),
          body: input.body,
          status: 'PENDING',
        },
        select: {
          id: true, tenantId: true, channel: true, templateKey: true,
          recipient: true, subject: true, body: true, status: true, providerMessageId: true,
        },
      }),
    );
    await this.notifications.dispatch(notification, input.request);
  }

  private async postSignedAlert(
    kind: 'created' | 'escalation',
    alert: DispatchableAlert,
    policy: AlertPolicy,
    meta: { route: AlertRoute; escalationAt: Date; slaDeadline: Date | null },
    request?: RequestWithContext | null,
  ): Promise<void> {
    if (!policy.webhookUrl || !policy.signingSecret) return;
    const payload = {
      type: `security.alert.${kind}`,
      alert: {
        id: alert.id,
        tenantId: alert.tenantId,
        severity: alert.severity,
        category: alert.category ?? null,
        title: alert.title,
        description: alert.description ?? null,
        source: alert.source ?? null,
        status: alert.status ?? 'OPEN',
      },
      route: meta.route,
      escalationAt: meta.escalationAt.toISOString(),
      slaDeadline: meta.slaDeadline?.toISOString() ?? null,
      requestId: request?.requestId ?? null,
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('base64url');
    try {
      const response = await this.http.request({
        url: policy.webhookUrl,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(policy.signingSecret, timestamp, nonce, rawBody),
          [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
          [WEBHOOK_NONCE_HEADER]: nonce,
        },
        body: rawBody,
      });
      if (!response.ok) {
        await this.audit.record({
          tenantId: alert.tenantId,
          action: 'security.alert.webhook_failed',
          resourceType: 'security_alert',
          resourceId: alert.id,
          outcome: 'FAILURE',
          newValues: { httpStatus: response.status },
          request,
        });
      }
    } catch (error) {
      await this.audit.record({
        tenantId: alert.tenantId,
        action: 'security.alert.webhook_failed',
        resourceType: 'security_alert',
        resourceId: alert.id,
        outcome: 'FAILURE',
        newValues: { reason: error instanceof Error ? error.message : 'Unknown alert webhook error' },
        request,
      });
    }
  }

  private routeFor(severity: AlertSeverity, policy: AlertPolicy): AlertRoute {
    return (
      policy.routes[severity] ?? {
        channel: severity === 'CRITICAL' ? 'SMS' : 'EMAIL',
        recipient: policy.onCallAlias,
      }
    );
  }

  private defaultRoutes(alias: string): Partial<Record<AlertSeverity, AlertRoute>> {
    return {
      INFO: { channel: 'EMAIL', recipient: alias },
      LOW: { channel: 'EMAIL', recipient: alias },
      MEDIUM: { channel: 'EMAIL', recipient: alias },
      HIGH: { channel: 'EMAIL', recipient: alias },
      CRITICAL: { channel: 'SMS', recipient: alias },
    };
  }

  private parseRoutes(value: unknown, alias: string): Partial<Record<AlertSeverity, AlertRoute>> {
    const record = this.asRecord(value);
    const routes: Partial<Record<AlertSeverity, AlertRoute>> = {};
    for (const severity of ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const) {
      const entry = this.asRecord(record[severity]);
      const channel = entry.channel === 'SMS' ? 'SMS' : entry.channel === 'EMAIL' ? 'EMAIL' : null;
      const recipient = this.asString(entry.recipient);
      if (channel && recipient) routes[severity] = { channel, recipient };
    }
    return Object.keys(routes).length ? routes : this.defaultRoutes(alias);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private asPositiveInt(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }

  /** Reuse an already-open elevated transaction (e.g. auth login) to avoid TiDB deadlocks. */
  private async runElevated<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const activeTx = tenantScopeStorage.getStore()?.tx as Prisma.TransactionClient | undefined;
    if (activeTx) return runInTenantScope({ tenantId: null, elevated: true, tx: activeTx }, () => work(activeTx));
    return this.prisma.withElevated(work);
  }
}
