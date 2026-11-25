import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { runInTenantScope, tenantScopeStorage } from '../../database/tenant-scope';
import { OutboundHttpService } from '../net/outbound-http.service';
import type { RequestWithContext } from '../middleware/request-context.middleware';
import {
  signWebhookPayload,
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '../webhooks/webhook-signature';
import { AuditService } from './audit.service';

/** Structural subset of the Notification row needed for rendering and dispatch. */
export interface DispatchableNotification {
  id: string;
  tenantId: string | null;
  channel: string;
  templateKey: string | null;
  recipient: string;
  subject: string | null;
  body: string;
  status: string;
  providerMessageId?: string | null;
}

interface RenderedMessage {
  subject: string | null;
  body: string;
  templateKey: string;
}

export interface DrainResult {
  attempted: number;
  sent: number;
  failed: number;
}

/**
 * Renders NotificationTemplate-backed email/SMS rows and delivers them through
 * configured HTTPS webhooks. Delivery is opt-in: nothing is dispatched unless
 * dispatch() or drainPending() is called explicitly.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: OutboundHttpService,
    private readonly audit: AuditService,
  ) {}

  async dispatch(notification: DispatchableNotification, request?: RequestWithContext | null): Promise<boolean> {
    if (notification.channel !== 'EMAIL' && notification.channel !== 'SMS') return false;
    const webhookUrl = this.webhookFor(notification.channel);
    // No configured transport means the row stays PENDING for a later drain.
    if (!webhookUrl) return false;

    const rendered = await this.render(notification);
    const payload = {
      notificationId: notification.id,
      tenantId: notification.tenantId,
      channel: notification.channel,
      templateKey: rendered.templateKey,
      to: notification.recipient,
      ...(notification.channel === 'EMAIL'
        ? {
            from: this.config.get<string>('notifications.fromAddress') ?? 'noreply@examnexus.local',
            subject: rendered.subject,
          }
        : {}),
      text: rendered.body,
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('base64url');
    const secret = this.config.get<string>('security.encryptionMasterKey') ?? '';

    try {
      const response = await this.http.request({
        url: webhookUrl,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(secret, timestamp, nonce, rawBody),
          [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
          [WEBHOOK_NONCE_HEADER]: nonce,
        },
        body: rawBody,
      });
      const providerMessageId = this.providerMessageId(response.body);
      await this.update(notification.id, {
        status: response.ok ? 'SENT' : 'FAILED',
        sentAt: response.ok ? new Date() : null,
        providerMessageId,
      });
      await this.audit.record({
        actorUserId: request?.principal?.userId ?? null,
        actorEmail: request?.principal?.email ?? null,
        tenantId: notification.tenantId,
        action: response.ok ? 'notification.dispatched' : 'notification.dispatch_failed',
        resourceType: 'notification',
        resourceId: notification.id,
        outcome: response.ok ? 'SUCCESS' : 'FAILURE',
        newValues: { channel: notification.channel, templateKey: rendered.templateKey, httpStatus: response.status },
        request,
      });
      if (!response.ok) this.logger.warn(`Notification ${notification.id} delivery returned ${response.status}`);
      return response.ok;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown notification error';
      await this.update(notification.id, { status: 'FAILED', sentAt: null, providerMessageId: null });
      await this.audit.record({
        actorUserId: request?.principal?.userId ?? null,
        actorEmail: request?.principal?.email ?? null,
        tenantId: notification.tenantId,
        action: 'notification.dispatch_failed',
        resourceType: 'notification',
        resourceId: notification.id,
        outcome: 'FAILURE',
        newValues: { reason },
        request,
      });
      this.logger.warn(`Notification ${notification.id} could not be dispatched: ${reason}`);
      return false;
    }
  }

  /** Explicit drain for operators/workers; no background timer is installed. */
  async drainPending(limit = 20, request?: RequestWithContext | null): Promise<DrainResult> {
    const rows = await this.runElevated((tx) =>
      tx.notification.findMany({
        where: { status: 'PENDING', channel: { in: ['EMAIL', 'SMS'] } },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
    );
    const outcomes = await Promise.allSettled(rows.map((row) => this.dispatch(row, request)));
    const sent = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<boolean> => outcome.status === 'fulfilled' && outcome.value,
    ).length;
    const failed = outcomes.length - sent;
    await this.audit.record({
      actorUserId: request?.principal?.userId ?? null,
      actorEmail: request?.principal?.email ?? null,
      action: 'notification.drain',
      resourceType: 'notification',
      outcome: failed ? 'FAILURE' : 'SUCCESS',
      newValues: { attempted: rows.length, sent, failed },
      request,
    });
    return { attempted: rows.length, sent, failed };
  }

  private async render(notification: DispatchableNotification): Promise<RenderedMessage> {
    const templateKey = notification.templateKey ?? 'notification.default';
    const template = await this.runElevated((tx) =>
      tx.notificationTemplate.findFirst({
        where: {
          key: templateKey,
          channel: notification.channel as never,
          active: true,
          ...(notification.tenantId
            ? { OR: [{ tenantId: notification.tenantId }, { tenantId: null }] }
            : { tenantId: null }),
        },
      }),
    );
    const severity = templateKey.split('.').pop() ?? '';
    const context: Record<string, string> = {
      recipient: notification.recipient,
      subject: notification.subject ?? '',
      title: notification.subject ?? '',
      body: notification.body,
      description: notification.body,
      templateKey,
      tenantId: notification.tenantId ?? '',
      severity,
    };
    const interpolate = (value: string | null | undefined): string =>
      (value ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, name: string) => context[name] ?? '');
    if (!template) {
      return {
        templateKey,
        subject: notification.subject,
        body: interpolate(notification.body),
      };
    }
    return {
      templateKey,
      subject: template.subject ? interpolate(template.subject) : notification.subject,
      body: interpolate(template.body),
    };
  }

  private webhookFor(channel: 'EMAIL' | 'SMS'): string | null {
    return (
      this.config.get<string>(channel === 'EMAIL' ? 'notifications.emailWebhookUrl' : 'notifications.smsWebhookUrl') ?? ''
    ) || null;
  }

  private providerMessageId(body: string): string | null {
    try {
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as Record<string, unknown>;
      for (const key of ['id', 'messageId', 'providerMessageId']) {
        if (typeof record[key] === 'string' && (record[key] as string).length <= 200) return record[key] as string;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async update(id: string, data: Prisma.NotificationUpdateInput): Promise<void> {
    await this.runElevated((tx) => tx.notification.update({ where: { id }, data }));
  }

  /** Reuse an already-open elevated transaction (e.g. auth login) to avoid TiDB deadlocks. */
  private async runElevated<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const activeTx = tenantScopeStorage.getStore()?.tx as Prisma.TransactionClient | undefined;
    if (activeTx) return runInTenantScope({ tenantId: null, elevated: true, tx: activeTx }, () => work(activeTx));
    return this.prisma.withElevated(work);
  }
}
