import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  IntegrationAuthType,
  type IntegrationDetail,
  type IntegrationEventView,
  type IntegrationMonitoringView,
  type IntegrationView,
  type Principal,
  type SyncResult,
  type TestConnectionResult,
} from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { OutboundHttpService } from '../../common/net/outbound-http.service';
import { IntegrationCredentialsService } from './credentials.service';
import { IntegrationWebhooksService } from './webhooks.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import type {
  CreateIntegrationDto,
  GrantScopesDto,
  SyncDto,
  TestConnectionDto,
  UpdateIntegrationDto,
  UpdateStatusDto,
} from './dto/integration.dto';

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function eventView(row: {
  id: string; eventType: string; status: string; attempts: number;
  lastAttemptAt: Date | null; nextAttemptAt: Date | null; error: string | null; createdAt: Date;
}): IntegrationEventView {
  return {
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    lastAttemptAt: iso(row.lastAttemptAt),
    nextAttemptAt: iso(row.nextAttemptAt),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbound: OutboundHttpService,
    private readonly credentials: IntegrationCredentialsService,
    private readonly webhooks: IntegrationWebhooksService,
  ) {}

  async list(tenantId: string): Promise<IntegrationView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.integration.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          credentials: { where: { revokedAt: null }, select: { id: true } },
          endpoint: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        name: row.name,
        provider: row.provider,
        category: row.category,
        status: row.status,
        authType: row.authType,
        config: (row.config as Record<string, unknown>) ?? {},
        scopes: this.scopeList(row.scopes),
        lastConnectedAt: iso(row.lastConnectedAt),
        lastSyncAt: iso(row.lastSyncAt),
        healthStatus: row.healthStatus,
        errorCount: row.errorCount,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        activeCredentialCount: row.credentials.length,
        webhook: row.endpoint ? this.webhooks.endpointView(row.endpoint) : null,
      }));
    });
  }

  async detail(tenantId: string, integrationId: string): Promise<IntegrationDetail> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.integration.findUnique({
        where: { id: integrationId },
        include: {
          credentials: { orderBy: { createdAt: 'desc' } },
          permissions: { orderBy: { grantedAt: 'desc' } },
          endpoint: true,
          events: { orderBy: { createdAt: 'desc' }, take: 10 },
        },
      });
      if (!row) throw this.notFound();
      return {
        id: row.id,
        tenantId: row.tenantId,
        name: row.name,
        provider: row.provider,
        category: row.category,
        status: row.status,
        authType: row.authType,
        config: (row.config as Record<string, unknown>) ?? {},
        scopes: this.scopeList(row.scopes),
        lastConnectedAt: iso(row.lastConnectedAt),
        lastSyncAt: iso(row.lastSyncAt),
        healthStatus: row.healthStatus,
        errorCount: row.errorCount,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        webhook: row.endpoint ? this.webhooks.endpointView(row.endpoint) : null,
        recentEvents: row.events.map(eventView),
        credentials: row.credentials.map((credential) => ({
          id: credential.id,
          keyId: credential.keyId,
          algorithm: credential.algorithm,
          expiresAt: iso(credential.expiresAt),
          rotatedAt: iso(credential.rotatedAt),
          revokedAt: iso(credential.revokedAt),
          createdAt: credential.createdAt.toISOString(),
        })),
        permissions: row.permissions.map((permission) => ({
          id: permission.id,
          permission: permission.permission,
          grantedBy: permission.grantedBy,
          grantedAt: permission.grantedAt.toISOString(),
          revokedAt: iso(permission.revokedAt),
        })),
      };
    });
  }

  async create(
    tenantId: string,
    dto: CreateIntegrationDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<IntegrationDetail> {
    await this.validateConfigUrls(dto.config);
    const integrationId = await this.prisma.withTenant(tenantId, async (tx) => {
      const integration = await tx.integration.create({
        data: {
          tenantId,
          name: dto.name,
          provider: dto.provider,
          category: dto.category ?? null,
          authType: dto.authType,
          config: (dto.config ?? {}) as never,
          scopes: (dto.scopes ?? []) as never,
          ownerUserId: principal?.userId ?? null,
          status: 'CONFIGURATION_PENDING',
        },
      });
      return integration.id;
    });

    if (dto.webhookUrl) {
      await this.webhooks.createEndpoint(tenantId, integrationId, { url: dto.webhookUrl, events: dto.webhookEvents ?? ['*'] }, principal, request);
    }

    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.create',
      resourceType: 'integration',
      resourceId: integrationId,
      newValues: { name: dto.name, provider: dto.provider, authType: dto.authType },
      request,
    });
    return this.detail(tenantId, integrationId);
  }

  async update(
    tenantId: string,
    integrationId: string,
    dto: UpdateIntegrationDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<IntegrationDetail> {
    await this.validateConfigUrls(dto.config);
    await this.prisma.withTenant(tenantId, async (tx) => {
      const previous = await tx.integration.findUnique({ where: { id: integrationId } });
      if (!previous) throw this.notFound();
      if (previous.status === 'REVOKED' || previous.status === 'SUSPENDED') {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'A revoked or suspended integration must be recreated before editing',
        });
      }
      await tx.integration.update({
        where: { id: integrationId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.config !== undefined ? { config: dto.config as never } : {}),
        },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.update',
      resourceType: 'integration',
      resourceId: integrationId,
      newValues: { name: dto.name, category: dto.category, configKeys: Object.keys(dto.config ?? {}) },
      request,
    });
    return this.detail(tenantId, integrationId);
  }

  async setStatus(
    tenantId: string,
    integrationId: string,
    dto: UpdateStatusDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<IntegrationDetail> {
    const previousStatus = await this.prisma.withTenant(tenantId, async (tx) => {
      const previous = await tx.integration.findUnique({ where: { id: integrationId } });
      if (!previous) throw this.notFound();
      await tx.integration.update({ where: { id: integrationId }, data: { status: dto.status as never } });
      return previous.status;
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.status_changed',
      resourceType: 'integration',
      resourceId: integrationId,
      previousValues: { status: previousStatus },
      newValues: { status: dto.status },
      request,
    });
    return this.detail(tenantId, integrationId);
  }

  async remove(
    tenantId: string,
    integrationId: string,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<{ success: true }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const integration = await tx.integration.findUnique({ where: { id: integrationId } });
      if (!integration) throw this.notFound();
      await tx.integration.delete({ where: { id: integrationId } });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.delete',
      resourceType: 'integration',
      resourceId: integrationId,
      request,
    });
    return { success: true };
  }

  async grantScopes(
    tenantId: string,
    integrationId: string,
    dto: GrantScopesDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<IntegrationDetail> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertIntegration(tx, integrationId);
      for (const permission of new Set(dto.permissions)) {
        const existing = await tx.integrationPermission.findFirst({ where: { integrationId, permission } });
        if (existing) {
          await tx.integrationPermission.update({
            where: { id: existing.id },
            data: { revokedAt: null, grantedBy: principal?.userId ?? null, grantedAt: new Date() },
          });
        } else {
          await tx.integrationPermission.create({
            data: { tenantId, integrationId, permission, grantedBy: principal?.userId ?? null },
          });
        }
      }
      const integration = await tx.integration.findUniqueOrThrow({ where: { id: integrationId } });
      const active = await tx.integrationPermission.findMany({ where: { integrationId, revokedAt: null } });
      await tx.integration.update({
        where: { id: integrationId },
        data: { scopes: active.map((row) => row.permission) as never },
      });
      if (integration.status === 'CONFIGURATION_PENDING' && active.length) {
        await tx.integration.update({ where: { id: integrationId }, data: { status: 'VERIFICATION_PENDING' } });
      }
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.scopes.granted',
      resourceType: 'integration',
      resourceId: integrationId,
      newValues: { permissions: dto.permissions },
      request,
    });
    return this.detail(tenantId, integrationId);
  }

  async revokeScope(
    tenantId: string,
    integrationId: string,
    permission: string,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<IntegrationDetail> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.integrationPermission.findFirst({ where: { integrationId, permission, revokedAt: null } });
      if (!row) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Permission grant not found' });
      await tx.integrationPermission.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      const active = await tx.integrationPermission.findMany({ where: { integrationId, revokedAt: null } });
      await tx.integration.update({
        where: { id: integrationId },
        data: { scopes: active.map((item) => item.permission) as never },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.scopes.revoked',
      resourceType: 'integration',
      resourceId: integrationId,
      newValues: { permission },
      request,
    });
    return this.detail(tenantId, integrationId);
  }

  /** Performs a real HTTPS request using the stored credential; never fabricates success. */
  async testConnection(
    tenantId: string,
    integrationId: string,
    dto: TestConnectionDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<TestConnectionResult> {
    const integration = await this.loadIntegration(tenantId, integrationId);
    const config = (integration.config as Record<string, unknown>) ?? {};
    const url = dto.url ?? (typeof config.baseUrl === 'string' ? config.baseUrl : undefined);
    if (!url) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'No connection URL is configured' });
    }

    let result: TestConnectionResult;
    try {
      const headers = await this.authHeaders(tenantId, integrationId, integration.authType);
      const response = await this.outbound.request({ url, method: dto.method ?? 'GET', headers });
      result = {
        ok: response.ok,
        statusCode: response.status,
        latencyMs: response.latencyMs,
        message: response.ok ? 'Endpoint responded successfully' : `Endpoint returned HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      result = {
        ok: false,
        statusCode: null,
        latencyMs: 0,
        message: error instanceof Error ? error.message : 'Connection test failed',
        checkedAt: new Date().toISOString(),
      };
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.webhookEvent.create({
        data: {
          tenantId,
          integrationId,
          eventType: 'TEST_CONNECTION',
          payload: { url, ok: result.ok, statusCode: result.statusCode, message: result.message } as never,
          status: result.ok ? 'SUCCESS' : 'FAILED',
          attempts: 1,
          lastAttemptAt: new Date(),
          error: result.ok ? null : result.message,
        },
      });
      await tx.integration.update({
        where: { id: integrationId },
        data: {
          lastConnectedAt: result.ok ? new Date() : integration.lastConnectedAt,
          healthStatus: result.ok ? 'HEALTHY' : 'DOWN',
          status: result.ok ? 'CONNECTED' : 'FAILED',
          errorCount: result.ok ? 0 : { increment: 1 },
        },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.connection_tested',
      resourceType: 'integration',
      resourceId: integrationId,
      outcome: result.ok ? 'SUCCESS' : 'FAILURE',
      newValues: { statusCode: result.statusCode, ok: result.ok },
      request,
    });
    return result;
  }

  /** Pulls candidate records from an external HTTPS JSON endpoint into the tenant. */
  async sync(
    tenantId: string,
    integrationId: string,
    dto: SyncDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<SyncResult> {
    const integration = await this.loadIntegration(tenantId, integrationId);
    const config = (integration.config as Record<string, unknown>) ?? {};
    const url = dto.url ?? (typeof config.syncUrl === 'string' ? config.syncUrl : undefined);
    if (!url) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'No synchronisation URL is configured' });
    }

    const mapping = {
      candidateCode: 'candidateCode',
      firstName: 'firstName',
      lastName: 'lastName',
      email: 'email',
      phone: 'phone',
      ...(dto.mapping ?? {}),
    };

    const result: SyncResult = {
      processed: 0, created: 0, updated: 0, failed: 0, errors: [], completedAt: new Date().toISOString(),
    };
    try {
      const headers = await this.authHeaders(tenantId, integrationId, integration.authType);
      const response = await this.outbound.request({ url, headers });
      if (!response.ok) throw new Error(`Synchronisation endpoint returned HTTP ${response.status}`);
      const parsed: unknown = JSON.parse(response.body);
      const records = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { candidates?: unknown }).candidates)
          ? (parsed as { candidates: unknown[] }).candidates
          : null;
      if (!records) throw new Error('Synchronisation response must be an array or an object with a candidates array');

      for (const record of records) {
        result.processed += 1;
        if (!record || typeof record !== 'object') {
          result.failed += 1;
          result.errors.push(`Record ${result.processed} is not an object`);
          continue;
        }
        const source = record as Record<string, unknown>;
        const values = Object.fromEntries(
          Object.entries(mapping).map(([target, sourceKey]) => [target, source[sourceKey]]),
        ) as Record<string, unknown>;
        const candidateCode = String(values.candidateCode ?? '').trim();
        const email = String(values.email ?? '').trim().toLowerCase();
        if (!candidateCode || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          result.failed += 1;
          result.errors.push(`Record ${result.processed} has an invalid candidateCode or email`);
          continue;
        }
        if (dto.dryRun) continue;
        const existing = await this.prisma.withTenant(tenantId, (tx) =>
          tx.candidate.findFirst({ where: { tenantId, candidateCode } }),
        );
        await this.prisma.withTenant(tenantId, async (tx) => {
          if (existing) {
            await tx.candidate.update({
              where: { id: existing.id },
              data: {
                firstName: String(values.firstName ?? existing.firstName),
                lastName: String(values.lastName ?? existing.lastName),
                email,
                phone: values.phone ? String(values.phone) : existing.phone,
              },
            });
            result.updated += 1;
          } else {
            await tx.candidate.create({
              data: {
                tenantId,
                candidateCode,
                firstName: String(values.firstName ?? 'Unknown'),
                lastName: String(values.lastName ?? 'Candidate'),
                email,
                phone: values.phone ? String(values.phone) : null,
              },
            });
            result.created += 1;
          }
        });
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(error instanceof Error ? error.message : 'Synchronisation failed');
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      const ok = result.failed === 0 && !dto.dryRun;
      await tx.webhookEvent.create({
        data: {
          tenantId,
          integrationId,
          eventType: dto.dryRun ? 'TEST_SYNC' : 'SYNC',
          payload: { url, ...result } as never,
          status: ok ? 'SUCCESS' : 'FAILED',
          attempts: 1,
          lastAttemptAt: new Date(),
          error: result.errors.length ? result.errors.join('; ').slice(0, 4000) : null,
        },
      });
      await tx.integration.update({
        where: { id: integrationId },
        data: {
          lastSyncAt: new Date(),
          healthStatus: ok ? 'HEALTHY' : 'DEGRADED',
          status: ok ? 'SYNC_ACTIVE' : 'FAILED',
          errorCount: ok ? 0 : { increment: 1 },
        },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.sync.completed',
      resourceType: 'integration',
      resourceId: integrationId,
      outcome: result.failed ? 'FAILURE' : 'SUCCESS',
      newValues: { processed: result.processed, created: result.created, updated: result.updated, failed: result.failed, dryRun: Boolean(dto.dryRun) },
      request,
    });
    return result;
  }

  async monitoring(): Promise<IntegrationMonitoringView> {
    return this.prisma.withElevated(async (tx) => {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [
        byStatus, byHealth, byProvider, organisations, apiRequests, apiFailures,
        webhookEvents, webhookFailures, providerFailures, lastSync, recentEvents,
      ] = await Promise.all([
        tx.integration.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.integration.groupBy({ by: ['healthStatus'], _count: { _all: true } }),
        tx.integration.groupBy({ by: ['provider'], _count: { _all: true } }),
        tx.organisation.findMany({
          select: { id: true, name: true, integrations: { select: { status: true } } },
        }),
        tx.apiRequestLog.count({ where: { createdAt: { gte: dayAgo } } }),
        tx.apiRequestLog.count({ where: { createdAt: { gte: dayAgo }, outcome: { not: 'SUCCESS' } } }),
        tx.webhookEvent.count({ where: { createdAt: { gte: dayAgo } } }),
        tx.webhookEvent.count({ where: { createdAt: { gte: dayAgo }, status: 'FAILED' } }),
        // ApiRequestLog has no provider column, so per-provider failures are
        // attributed through failed webhook events and their integration.
        tx.webhookEvent.findMany({
          where: { createdAt: { gte: dayAgo }, status: 'FAILED', integrationId: { not: null } },
          select: { integration: { select: { provider: true } } },
        }),
        tx.integration.aggregate({ _max: { lastSyncAt: true } }),
        tx.webhookEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      ]);

      const count = (rows: Array<{ status: string; _count: { _all: number } }>, status: string) =>
        rows.find((row) => row.status === status)?._count._all ?? 0;
      const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);
      const failedByProvider = new Map<string, number>();
      for (const event of providerFailures) {
        const provider = event.integration?.provider;
        if (!provider) continue;
        failedByProvider.set(provider, (failedByProvider.get(provider) ?? 0) + 1);
      }

      return {
        generatedAt: new Date().toISOString(),
        totals: {
          integrations: total,
          connected: count(byStatus, 'CONNECTED'),
          syncActive: count(byStatus, 'SYNC_ACTIVE'),
          warning: count(byStatus, 'WARNING'),
          failed: count(byStatus, 'FAILED'),
          suspended: count(byStatus, 'SUSPENDED'),
          revoked: count(byStatus, 'REVOKED'),
        },
        health: byHealth.map((row) => ({ status: row.healthStatus, count: row._count._all })),
        byProvider: byProvider.map((row) => ({
          provider: row.provider,
          count: row._count._all,
          failed: failedByProvider.get(row.provider) ?? 0,
        })),
        byOrganisation: organisations.map((org) => ({
          tenantId: org.id,
          organisation: org.name,
          total: org.integrations.length,
          connected: org.integrations.filter((item) => ['CONNECTED', 'SYNC_ACTIVE'].includes(item.status)).length,
          failed: org.integrations.filter((item) => item.status === 'FAILED').length,
        })),
        apiRequests24Hours: apiRequests,
        apiFailures24Hours: apiFailures,
        webhookEvents24Hours: webhookEvents,
        webhookFailures24Hours: webhookFailures,
        lastSyncAt: iso(lastSync._max.lastSyncAt),
        recentEvents: recentEvents.map(eventView),
      };
    });
  }

  private async authHeaders(
    tenantId: string,
    integrationId: string,
    authType: string,
  ): Promise<Record<string, string>> {
    const credential = await this.prisma.withTenant(tenantId, async (tx) =>
      tx.integrationCredential.findFirst({
        where: { integrationId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (!credential) return {};
    if (credential.expiresAt && credential.expiresAt <= new Date()) {
      throw new Error('The integration credential has expired');
    }
    const secret = this.credentials.decryptSecret({
      ciphertext: credential.ciphertext,
      iv: credential.iv,
      authTag: credential.authTag,
      algorithm: credential.algorithm,
    });
    switch (authType) {
      case IntegrationAuthType.API_KEY:
        return { 'x-api-key': secret };
      case IntegrationAuthType.OAUTH2:
      case IntegrationAuthType.OIDC:
      case IntegrationAuthType.SCIM:
        return { authorization: `Bearer ${secret}` };
      case IntegrationAuthType.BASIC:
        return { authorization: `Basic ${Buffer.from(secret).toString('base64')}` };
      default:
        return {};
    }
  }

  private async validateConfigUrls(config: Record<string, unknown> | undefined): Promise<void> {
    for (const key of ['baseUrl', 'syncUrl', 'authorizeUrl', 'tokenUrl']) {
      const value = config?.[key];
      if (typeof value === 'string' && value) await this.outbound.assertSafeUrl(value);
    }
  }

  private async loadIntegration(tenantId: string, id: string) {
    const integration = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findUnique({ where: { id } }),
    );
    if (!integration) throw this.notFound();
    return integration;
  }

  private async assertIntegration(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const integration = await tx.integration.findUnique({ where: { id } });
    if (!integration) throw this.notFound();
  }

  private scopeList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Integration not found' });
  }
}
