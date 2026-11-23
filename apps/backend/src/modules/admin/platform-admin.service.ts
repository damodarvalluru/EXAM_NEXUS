import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import os from 'node:os';
import { ERROR_CODES, type AnalyticsReportView, type ComponentHealthView, type LiveAttemptView, type NotificationView, type PlatformSettingView, type ReportPoint, type SecurityAlertView, type SecurityIncidentView, type SubscriptionView, type SupportTicketView, type SystemHealthView } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { AuditService } from '../../common/services/audit.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import type { Principal } from '@examnexus/shared';
import type {
  CreateSupportTicketDto,
  PlatformAdminQueryDto,
  UpdateAlertDto,
  UpdateIncidentDto,
  UpdateSettingDto,
  UpdateSupportTicketDto,
} from './dto/platform-admin.dto';

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function bucket(rows: Array<{ createdAt: Date }>, from: Date, days: number): ReportPoint[] {
  const points: ReportPoint[] = [];
  for (let index = 0; index < days; index += 1) {
    const day = new Date(from.getTime() + index * 86_400_000);
    const label = day.toISOString().slice(0, 10);
    points.push({ label, value: rows.filter((row) => row.createdAt.toISOString().slice(0, 10) === label).length });
  }
  return points;
}

/**
 * Mirrors result creation in attempts.service: an attempt only counts as a pass
 * when its examination defines a threshold and the score meets that threshold.
 */
export function isAttemptPassed(score: number | null | undefined, passingMarks: number | null | undefined): boolean {
  return typeof score === 'number' && typeof passingMarks === 'number' && score >= passingMarks;
}

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' ? result.value : fallback;
}

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async securityAlerts(query: PlatformAdminQueryDto): Promise<{ items: SecurityAlertView[]; total: number; page: number; pageSize: number }> {
    return this.prisma.withElevated(async (tx) => {
      const where = {
        ...(query.severity ? { severity: query.severity as never } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.securityAlert.findMany({
          where,
          orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { organisation: { select: { name: true } }, _count: { select: { incidents: true } } },
        }),
        tx.securityAlert.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          organisation: row.organisation?.name ?? null,
          severity: row.severity,
          category: row.category,
          title: row.title,
          description: row.description,
          source: row.source,
          evidenceRef: row.evidenceRef,
          status: row.status,
          assignedTo: row.assignedTo,
          createdAt: row.createdAt.toISOString(),
          resolvedAt: iso(row.resolvedAt),
          incidentCount: row._count.incidents,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async updateAlert(id: string, dto: UpdateAlertDto, principal: Principal, request: RequestWithContext): Promise<SecurityAlertView> {
    const row = await this.prisma.withElevated(async (tx) => {
      const previous = await tx.securityAlert.findUnique({ where: { id }, include: { organisation: { select: { name: true } } } });
      if (!previous) throw this.notFound('Security alert');
      const updated = await tx.securityAlert.update({
        where: { id },
        data: {
          status: dto.status,
          assignedTo: dto.assignee ?? previous.assignedTo,
          resolvedAt: ['RESOLVED', 'CLOSED', 'FALSE_POSITIVE'].includes(dto.status) ? new Date() : null,
        },
        include: { organisation: { select: { name: true } }, _count: { select: { incidents: true } } },
      });
      return updated;
    });
    await this.audit.record({
      actorUserId: principal.userId,
      actorEmail: principal.email,
      tenantId: row.tenantId,
      action: 'security.alert.updated',
      resourceType: 'security_alert',
      resourceId: id,
      newValues: { status: dto.status },
      request,
    });
    return {
      id: row.id, tenantId: row.tenantId, organisation: row.organisation?.name ?? null,
      severity: row.severity, category: row.category, title: row.title, description: row.description,
      source: row.source, evidenceRef: row.evidenceRef, status: row.status, assignedTo: row.assignedTo,
      createdAt: row.createdAt.toISOString(), resolvedAt: iso(row.resolvedAt), incidentCount: row._count.incidents,
    };
  }

  async incidents(query: PlatformAdminQueryDto): Promise<{ items: SecurityIncidentView[]; total: number; page: number; pageSize: number }> {
    return this.prisma.withElevated(async (tx) => {
      const where = {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.severity ? { severity: query.severity as never } : {}),
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.securityIncident.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { organisation: { select: { name: true } } },
        }),
        tx.securityIncident.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id, tenantId: row.tenantId, organisation: row.organisation?.name ?? null,
          alertId: row.alertId, severity: row.severity, classification: row.classification,
          status: row.status, assignedTo: row.assignedTo, notes: row.notes,
          responseActions: strings(row.responseActions), resolvedAt: iso(row.resolvedAt),
          createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        })),
        total, page: query.page, pageSize: query.pageSize,
      };
    });
  }

  async updateIncident(id: string, dto: UpdateIncidentDto, principal: Principal, request: RequestWithContext): Promise<SecurityIncidentView> {
    const row = await this.prisma.withElevated(async (tx) => {
      const previous = await tx.securityIncident.findUnique({ where: { id } });
      if (!previous) throw this.notFound('Security incident');
      return tx.securityIncident.update({
        where: { id },
        data: {
          status: dto.status ? (dto.status as never) : previous.status,
          assignedTo: dto.assignee ?? previous.assignedTo,
          notes: dto.notes ?? previous.notes,
          responseActions: (dto.responseActions ?? (previous.responseActions as string[] | null)) as never,
          resolvedAt: ['RESOLVED', 'CLOSED', 'FALSE_POSITIVE'].includes(dto.status ?? previous.status) ? new Date() : null,
        },
        include: { organisation: { select: { name: true } } },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId, actorEmail: principal.email, tenantId: row.tenantId,
      action: 'security.incident.updated', resourceType: 'security_incident', resourceId: id,
      newValues: { status: row.status }, request,
    });
    return {
      id: row.id, tenantId: row.tenantId, organisation: row.organisation?.name ?? null,
      alertId: row.alertId, severity: row.severity, classification: row.classification,
      status: row.status, assignedTo: row.assignedTo, notes: row.notes,
      responseActions: strings(row.responseActions), resolvedAt: iso(row.resolvedAt),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async systemHealth(): Promise<SystemHealthView> {
    const generatedAt = new Date();
    const components: ComponentHealthView[] = [];
    const started = Date.now();
    let databaseAvailable = false;
    try {
      await this.prisma.$queryRaw`SELECT 1 AS ok`;
      databaseAvailable = true;
      components.push(this.component('database', 'HEALTHY', Date.now() - started, { engine: 'tidb-cloud' }, generatedAt));
    } catch (error) {
      components.push(this.component('database', 'DOWN', Date.now() - started, { error: this.message(error) }, generatedAt));
    }
    const redisStarted = Date.now();
    try {
      await this.redis.ping();
      components.push(this.component('redis', 'HEALTHY', Date.now() - redisStarted, null, generatedAt));
    } catch (error) {
      components.push(this.component('redis', 'DOWN', Date.now() - redisStarted, { error: this.message(error) }, generatedAt));
    }

    // A failed probe must never abort the response. If the database probe
    // failed, skip aggregates entirely; otherwise settle each one separately
    // so a single failing aggregate only degrades its own component.
    let events: ComponentHealthView[] = [];
    let pendingWebhooks = 0;
    let pendingNotifications = 0;
    let failedWebhooks = 0;
    let failedNotifications = 0;
    let storageObjects = 0;
    let storageBytes = 0;
    const failedAggregates: string[] = [];
    let aggregateError: unknown = null;
    const aggregateStarted = Date.now();

    if (databaseAvailable) {
      try {
        const aggregates = await this.prisma.withElevated(async (tx) => {
          const [eventRows, webhooksPending, notificationsPending, webhooksFailed, notificationsFailed, storage] = await Promise.allSettled([
            tx.systemHealthEvent.findMany({ orderBy: { detectedAt: 'desc' }, take: 20 }),
            tx.webhookEvent.count({ where: { status: 'PENDING' } }),
            tx.notification.count({ where: { status: 'PENDING' } }),
            tx.webhookEvent.count({ where: { status: 'FAILED' } }),
            tx.notification.count({ where: { status: 'FAILED' } }),
            tx.fileObject.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
          ]);
          return {
            events: settledValue(eventRows, []).map((event) => ({
              component: event.component,
              status: event.status,
              latencyMs: event.latencyMs,
              details: (event.details as Record<string, unknown>) ?? null,
              detectedAt: event.detectedAt.toISOString(),
            })),
            pendingWebhooks: settledValue(webhooksPending, 0),
            pendingNotifications: settledValue(notificationsPending, 0),
            failedWebhooks: settledValue(webhooksFailed, 0),
            failedNotifications: settledValue(notificationsFailed, 0),
            storageObjects: settledValue(storage, { _count: { _all: 0 }, _sum: { sizeBytes: 0n } })._count._all,
            storageBytes: Number(settledValue(storage, { _count: { _all: 0 }, _sum: { sizeBytes: 0n } })._sum.sizeBytes ?? 0n),
            failed: [
              ...(eventRows.status === 'rejected' ? ['events'] : []),
              ...(webhooksPending.status === 'rejected' || webhooksFailed.status === 'rejected' ? ['queues'] : []),
              ...(notificationsPending.status === 'rejected' || notificationsFailed.status === 'rejected' ? ['queues'] : []),
              ...(storage.status === 'rejected' ? ['storage'] : []),
            ],
          };
        });
        events = aggregates.events;
        pendingWebhooks = aggregates.pendingWebhooks;
        pendingNotifications = aggregates.pendingNotifications;
        failedWebhooks = aggregates.failedWebhooks;
        failedNotifications = aggregates.failedNotifications;
        storageObjects = aggregates.storageObjects;
        storageBytes = aggregates.storageBytes;
        failedAggregates.push(...aggregates.failed);
      } catch (error) {
        aggregateError = error;
      }
    } else {
      aggregateError = new Error('Database probe failed; health aggregates skipped');
    }

    const aggregateLatency = Date.now() - aggregateStarted;
    if (aggregateError) {
      const details = { error: this.message(aggregateError) };
      components.push(this.component('queues', 'DOWN', aggregateLatency, details, generatedAt));
      components.push(this.component('storage', 'DOWN', aggregateLatency, details, generatedAt));
    } else {
      for (const componentName of new Set(failedAggregates)) {
        components.push(this.component(componentName, 'DEGRADED', aggregateLatency, { error: 'Health aggregate unavailable' }, generatedAt));
      }
    }

    const apiStatus: SystemHealthView['api']['status'] = components.some((item) => item.component === 'database' && item.status === 'DOWN')
      ? 'DOWN'
      : components.some((item) => item.status === 'DOWN' || item.status === 'DEGRADED')
        ? 'DEGRADED'
        : 'HEALTHY';
    const memory = process.memoryUsage();
    return {
      generatedAt: generatedAt.toISOString(),
      api: {
        status: apiStatus,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssBytes: memory.rss,
        memoryHeapUsedBytes: memory.heapUsed,
        nodeVersion: process.version,
      },
      components,
      events,
      queues: [
        { name: 'webhooks', waiting: pendingWebhooks, active: 0, failed: failedWebhooks },
        { name: 'notifications', waiting: pendingNotifications, active: 0, failed: failedNotifications },
      ],
      storage: { objects: storageObjects, bytes: storageBytes },
    };
  }

  async analytics(range: '7d' | '30d' | '90d' = '30d'): Promise<AnalyticsReportView> {
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    const from = new Date(Date.now() - days * 86_400_000);
    return this.prisma.withElevated(async (tx) => {
      const [
        organisations, examinations, attempts, submitted, candidates, failedLogins,
        securityAlerts, byOrg, byExam,
      ] = await Promise.all([
        tx.organisation.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
        tx.examination.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
        tx.examinationAttempt.findMany({
          where: { createdAt: { gte: from } },
          select: { createdAt: true, score: true, status: true, examination: { select: { passingMarks: true } } },
        }),
        tx.examinationAttempt.count({ where: { submittedAt: { gte: from } } }),
        tx.candidate.count(),
        tx.authenticationEvent.findMany({ where: { createdAt: { gte: from }, outcome: 'FAILURE' }, select: { createdAt: true } }),
        tx.securityAlert.count({ where: { createdAt: { gte: from } } }),
        tx.organisation.findMany({
          select: {
            id: true, name: true,
            examinations: { select: { id: true, attempts: { select: { id: true } } } },
            candidates: { select: { id: true } },
          },
        }),
        tx.examination.findMany({
          include: { attempts: { select: { score: true, status: true } } },
          take: 200,
        }),
      ]);
      const scored = attempts.filter((attempt) => typeof attempt.score === 'number');
      const averageScore = scored.length ? scored.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) / scored.length : 0;
      const passed = scored.filter((attempt) => isAttemptPassed(attempt.score, attempt.examination.passingMarks)).length;
      return {
        range, from: from.toISOString(), to: new Date().toISOString(), generatedAt: new Date().toISOString(),
        summary: {
          organisations: organisations.length, examinations: examinations.length, attempts: attempts.length,
          submittedAttempts: submitted, candidates, averageScore: Number(averageScore.toFixed(2)),
          passRate: scored.length ? Number(((passed / scored.length) * 100).toFixed(2)) : 0,
          failedLogins: failedLogins.length, securityAlerts,
        },
        series: {
          organisations: bucket(organisations, from, days),
          examinations: bucket(examinations, from, days),
          attempts: bucket(attempts, from, days),
          results: bucket(scored, from, days),
          failedLogins: bucket(failedLogins, from, days),
        },
        byOrganisation: byOrg.map((org) => ({
          tenantId: org.id, organisation: org.name,
          examinations: org.examinations.length,
          attempts: org.examinations.reduce((sum, exam) => sum + exam.attempts.length, 0),
          candidates: org.candidates.length,
        })),
        byExamination: byExam.map((exam) => {
          const scores = exam.attempts.filter((attempt) => typeof attempt.score === 'number');
          const passedCount = scores.filter((attempt) => isAttemptPassed(attempt.score, exam.passingMarks)).length;
          return {
            examinationId: exam.id, title: exam.title, attempts: exam.attempts.length,
            averageScore: scores.length ? Number((scores.reduce((sum, item) => sum + (item.score ?? 0), 0) / scores.length).toFixed(2)) : 0,
            passRate: scores.length ? Number(((passedCount / scores.length) * 100).toFixed(2)) : 0,
          };
        }),
      };
    });
  }

  async notifications(query: PlatformAdminQueryDto): Promise<{ items: NotificationView[]; total: number; page: number; pageSize: number }> {
    return this.prisma.withElevated(async (tx) => {
      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.notification.findMany({
          where, orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        }),
        tx.notification.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id, tenantId: row.tenantId, channel: row.channel, templateKey: row.templateKey,
          recipient: row.recipient, subject: row.subject, status: row.status,
          sentAt: iso(row.sentAt), readAt: iso(row.readAt), createdAt: row.createdAt.toISOString(),
        })),
        total, page: query.page, pageSize: query.pageSize,
      };
    });
  }

  async subscriptions(): Promise<SubscriptionView[]> {
    return this.prisma.withElevated(async (tx) => {
      const rows = await tx.subscription.findMany({
        include: { organisation: { select: { name: true } } }, orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id, tenantId: row.tenantId, organisation: row.organisation.name,
        plan: row.plan, status: row.status, seats: row.seats, billingCycle: row.billingCycle,
        startDate: row.startDate.toISOString(), endDate: iso(row.endDate), trialEndsAt: iso(row.trialEndsAt),
      }));
    });
  }

  async supportTickets(query: PlatformAdminQueryDto): Promise<{ items: SupportTicketView[]; total: number; page: number; pageSize: number }> {
    return this.prisma.withElevated(async (tx) => {
      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.supportTicket.findMany({
          where, orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          include: { organisation: { select: { name: true } } },
        }),
        tx.supportTicket.count({ where }),
      ]);
      return { items: rows.map((row) => this.ticketView(row)), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async createTicket(dto: CreateSupportTicketDto, principal: Principal, request: RequestWithContext): Promise<SupportTicketView> {
    const row = await this.prisma.withElevated(async (tx) => {
      if (dto.tenantId) {
        const tenant = await tx.organisation.findUnique({ where: { id: dto.tenantId }, select: { id: true } });
        if (!tenant) throw this.notFound('Organisation');
      }
      return tx.supportTicket.create({
        data: {
          tenantId: dto.tenantId ?? principal.tenantId ?? null,
          subject: dto.subject, category: dto.category, priority: dto.priority,
          requesterEmail: principal.email ?? 'platform-user', body: dto.body,
          assignee: principal.userId,
        },
        include: { organisation: { select: { name: true } } },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId, actorEmail: principal.email, tenantId: row.tenantId,
      action: 'support.ticket.created', resourceType: 'support_ticket', resourceId: row.id, request,
    });
    return this.ticketView(row);
  }

  async updateTicket(id: string, dto: UpdateSupportTicketDto, principal: Principal, request: RequestWithContext): Promise<SupportTicketView> {
    const row = await this.prisma.withElevated(async (tx) => {
      const previous = await tx.supportTicket.findUnique({ where: { id } });
      if (!previous) throw this.notFound('Support ticket');
      return tx.supportTicket.update({
        where: { id },
        data: {
          status: dto.status ?? previous.status,
          assignee: dto.assignee ?? previous.assignee,
          resolution: dto.resolution ?? previous.resolution,
          resolvedAt: ['RESOLVED', 'CLOSED'].includes(dto.status ?? previous.status) ? new Date() : null,
        },
        include: { organisation: { select: { name: true } } },
      });
    });
    await this.audit.record({
      actorUserId: principal.userId, actorEmail: principal.email, tenantId: row.tenantId,
      action: 'support.ticket.updated', resourceType: 'support_ticket', resourceId: id,
      newValues: { status: row.status }, request,
    });
    return this.ticketView(row);
  }

  async settings(): Promise<PlatformSettingView[]> {
    return this.prisma.withElevated(async (tx) => {
      const rows = await tx.platformSetting.findMany({ orderBy: { key: 'asc' } });
      return rows.map((row) => ({
        key: row.key, value: (row.value as Record<string, unknown>) ?? {},
        description: row.description, updatedBy: row.updatedBy, updatedAt: row.updatedAt.toISOString(),
      }));
    });
  }

  async updateSetting(key: string, dto: UpdateSettingDto, principal: Principal, request: RequestWithContext): Promise<PlatformSettingView> {
    const row = await this.prisma.withElevated(async (tx) =>
      tx.platformSetting.upsert({
        where: { key },
        create: { key, value: dto.value as never, description: dto.description ?? null, updatedBy: principal.userId },
        update: { value: dto.value as never, ...(dto.description !== undefined ? { description: dto.description } : {}), updatedBy: principal.userId },
      }),
    );
    await this.audit.record({
      actorUserId: principal.userId, actorEmail: principal.email, tenantId: null,
      action: 'platform.setting.updated', resourceType: 'platform_setting', resourceId: key,
      newValues: { key }, request,
    });
    return {
      key: row.key, value: (row.value as Record<string, unknown>) ?? {},
      description: row.description, updatedBy: row.updatedBy, updatedAt: row.updatedAt.toISOString(),
    };
  }

  async liveAttempts(): Promise<LiveAttemptView[]> {
    return this.prisma.withElevated(async (tx) => {
      const rows = await tx.examinationAttempt.findMany({
        where: { status: 'IN_PROGRESS' },
        orderBy: { startedAt: 'desc' },
        take: 200,
        include: {
          candidate: { select: { firstName: true, lastName: true } },
          examination: { select: { title: true, organisation: { select: { name: true } } } },
          session: { select: { heartbeatAt: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id, tenantId: row.tenantId, organisation: row.examination.organisation.name,
        candidate: `${row.candidate.firstName} ${row.candidate.lastName}`,
        examination: row.examination.title, status: row.status,
        startedAt: iso(row.startedAt), serverEndAt: iso(row.serverEndAt), riskScore: row.riskScore,
        lastHeartbeatAt: iso(row.session?.heartbeatAt),
      }));
    });
  }

  async exportCsv(kind: 'organisations' | 'attempts' | 'alerts', range: '7d' | '30d' | '90d' = '30d'): Promise<string> {
    const from = new Date(Date.now() - (range === '7d' ? 7 : range === '90d' ? 90 : 30) * 86_400_000);
    return this.prisma.withElevated(async (tx) => {
      if (kind === 'organisations') {
        const rows = await tx.organisation.findMany({ where: { createdAt: { gte: from } }, select: { id: true, name: true, slug: true, status: true, createdAt: true } });
        return ['id,name,slug,status,createdAt', ...rows.map((row) => this.csv([row.id, row.name, row.slug, row.status, row.createdAt.toISOString()]))].join('\n');
      }
      if (kind === 'attempts') {
        const rows = await tx.examinationAttempt.findMany({ where: { createdAt: { gte: from } }, select: { id: true, tenantId: true, status: true, score: true, riskScore: true, createdAt: true } });
        return ['id,tenantId,status,score,riskScore,createdAt', ...rows.map((row) => this.csv([row.id, row.tenantId, row.status, String(row.score ?? ''), String(row.riskScore), row.createdAt.toISOString()]))].join('\n');
      }
      const rows = await tx.securityAlert.findMany({ where: { createdAt: { gte: from } }, select: { id: true, tenantId: true, severity: true, category: true, title: true, status: true, createdAt: true } });
      return ['id,tenantId,severity,category,title,status,createdAt', ...rows.map((row) => this.csv([row.id, row.tenantId ?? '', row.severity, row.category, row.title, row.status, row.createdAt.toISOString()]))].join('\n');
    });
  }

  private component(component: string, status: 'HEALTHY' | 'DEGRADED' | 'DOWN', latencyMs: number, details: Record<string, unknown> | null, detectedAt: Date): ComponentHealthView {
    return { component, status, latencyMs, details, detectedAt: detectedAt.toISOString() };
  }

  private ticketView(row: {
    id: string; tenantId: string | null; subject: string; category: string; priority: string;
    status: string; requesterEmail: string; body: string; assignee: string | null;
    resolution: string | null; createdAt: Date; updatedAt: Date; resolvedAt: Date | null;
    organisation: { name: string } | null;
  }): SupportTicketView {
    return {
      id: row.id, tenantId: row.tenantId, organisation: row.organisation?.name ?? null,
      subject: row.subject, category: row.category, priority: row.priority, status: row.status as SupportTicketView['status'],
      requesterEmail: row.requesterEmail, body: row.body, assignee: row.assignee, resolution: row.resolution,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), resolvedAt: iso(row.resolvedAt),
    };
  }

  private csv(values: string[]): string {
    return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(',');
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private notFound(resource: string): NotFoundException {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: `${resource} not found` });
  }
}
