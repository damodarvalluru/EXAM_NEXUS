import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type IntegrationEventView,
  type Principal,
  type WebhookEndpointView,
} from '@examnexus/shared';
import type { Prisma, WebhookEndpoint, WebhookEvent } from '@prisma/client';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { OutboundHttpService } from '../../common/net/outbound-http.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '../../common/webhooks/webhook-signature';
import type { CreateWebhookDto, RetryWebhookDto } from './dto/integration.dto';

const MAX_ATTEMPTS = 5;

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

@Injectable()
export class IntegrationWebhooksService {
  private readonly logger = new Logger(IntegrationWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbound: OutboundHttpService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  endpointView(endpoint: WebhookEndpoint): WebhookEndpointView {
    return {
      id: endpoint.id,
      url: endpoint.url,
      events: this.scopeList(endpoint.events),
      status: endpoint.status,
      createdAt: endpoint.createdAt.toISOString(),
      disabledAt: iso(endpoint.disabledAt),
    };
  }

  eventView(event: WebhookEvent): IntegrationEventView {
    return {
      id: event.id,
      eventType: event.eventType,
      status: event.status,
      attempts: event.attempts,
      lastAttemptAt: iso(event.lastAttemptAt),
      nextAttemptAt: iso(event.nextAttemptAt),
      error: event.error,
      createdAt: event.createdAt.toISOString(),
    };
  }

  async createEndpoint(
    tenantId: string,
    integrationId: string,
    dto: CreateWebhookDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<WebhookEndpointView> {
    await this.outbound.assertSafeUrl(dto.url);
    const secret = this.crypto.randomToken(32);
    const encrypted = this.crypto.encrypt(secret);
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertIntegration(tx, integrationId);
      const existing = await tx.webhookEndpoint.findUnique({ where: { integrationId } });
      if (existing) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Integration already has a webhook endpoint' });
      }
      return tx.webhookEndpoint.create({
        data: {
          id: randomUUID(),
          tenantId,
          integrationId,
          url: dto.url,
          events: dto.events,
          secretEncrypted: encrypted,
          status: 'ACTIVE',
        },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.webhook.created',
      resourceType: 'webhook_endpoint',
      resourceId: row.id,
      newValues: { integrationId, url: dto.url, events: dto.events },
      request,
    });
    return { ...this.endpointView(row), secret };
  }

  async rotateSecret(
    tenantId: string,
    endpointId: string,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<WebhookEndpointView> {
    const secret = this.crypto.randomToken(32);
    const encrypted = this.crypto.encrypt(secret);
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const endpoint = await this.findEndpoint(tx, tenantId, endpointId);
      return tx.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { secretEncrypted: encrypted, status: 'ACTIVE', disabledAt: null },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.webhook.secret_rotated',
      resourceType: 'webhook_endpoint',
      resourceId: row.id,
      request,
    });
    return { ...this.endpointView(row), secret };
  }

  async setEndpointStatus(
    tenantId: string,
    endpointId: string,
    active: boolean,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<WebhookEndpointView> {
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const endpoint = await this.findEndpoint(tx, tenantId, endpointId);
      return tx.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { status: active ? 'ACTIVE' : 'DISABLED', disabledAt: active ? null : new Date() },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: active ? 'integration.webhook.enabled' : 'integration.webhook.disabled',
      resourceType: 'webhook_endpoint',
      resourceId: row.id,
      request,
    });
    return this.endpointView(row);
  }

  /**
   * Verifies an inbound webhook using the endpoint's encrypted signing secret.
   * The endpoint ID is a public capability; the tenant is derived from the
   * stored endpoint, never from client input.
   */
  async verifyInbound(
    endpointId: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.withElevated((tx) =>
      tx.webhookEndpoint.findFirst({ where: { id: endpointId } }),
    );
    if (!endpoint || endpoint.status !== 'ACTIVE') throw new NotFoundException('Webhook endpoint not found');
    let secret: string;
    try {
      secret = this.crypto.decrypt(endpoint.secretEncrypted);
    } catch {
      throw new ForbiddenException('Webhook endpoint secret is invalid');
    }
    const toleranceSeconds = this.toleranceSeconds();
    const result = verifyWebhookSignature({
      secret,
      signature: this.header(headers, WEBHOOK_SIGNATURE_HEADER),
      timestamp: this.header(headers, WEBHOOK_TIMESTAMP_HEADER),
      nonce: this.header(headers, WEBHOOK_NONCE_HEADER),
      rawBody,
      toleranceSeconds,
    });
    if (!result.valid) throw new ForbiddenException(result.reason ?? 'Invalid webhook signature');

    const nonce = this.header(headers, WEBHOOK_NONCE_HEADER)!;
    const consumed = await this.redis.client.eval(
      'if redis.call("SET", KEYS[1], ARGV[1], "NX", "EX", ARGV[2]) then return 1 else return 0 end',
      1,
      `webhook:nonce:${endpoint.tenantId}:${endpointId}:${nonce}`,
      String(Date.now()),
      String(Math.max(60, Math.ceil(toleranceSeconds) * 2)),
    );
    if (Number(consumed) !== 1) {
      throw new ForbiddenException('Webhook nonce has already been used');
    }
    return endpoint;
  }

  /** Verifies, de-duplicates and only then persists an inbound webhook event. */
  async receiveInbound(
    endpointId: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<IntegrationEventView> {
    const endpoint = await this.verifyInbound(endpointId, headers, rawBody);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Webhook payload must be valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('Webhook payload must be a JSON object');
    }
    const payload = parsed as Record<string, unknown>;
    const candidateType = payload.type ?? payload.eventType;
    const eventType = typeof candidateType === 'string' && candidateType.length > 0 && candidateType.length <= 120
      ? candidateType
      : 'INBOUND_WEBHOOK';

    const event = await this.prisma.withTenant(endpoint.tenantId, (tx) =>
      tx.webhookEvent.create({
        data: {
          id: randomUUID(),
          tenantId: endpoint.tenantId,
          endpointId: endpoint.id,
          integrationId: endpoint.integrationId,
          eventType,
          payload: payload as never,
          status: 'SUCCESS',
          attempts: 1,
          lastAttemptAt: new Date(),
        },
      }),
    );
    return this.eventView(event);
  }

  async listTenantEvents(tenantId: string, take = 50): Promise<IntegrationEventView[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.webhookEvent.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    );
    return rows.map((row) => this.eventView(row));
  }

  private toleranceSeconds(): number {
    const configured = this.config.get<number>('integrations.webhookToleranceSeconds');
    return typeof configured === 'number' && Number.isFinite(configured) && configured > 0
      ? configured
      : 300;
  }

  async enqueue(
    tenantId: string,
    integrationId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<IntegrationEventView> {
    const event = await this.prisma.withTenant(tenantId, (tx) =>
      tx.webhookEvent.create({
        data: {
          id: randomUUID(),
          tenantId,
          integrationId,
          eventType,
          payload: payload as never,
          status: 'PENDING',
          nextAttemptAt: new Date(),
        },
      }),
    );
    return this.eventView(event);
  }

  /** Delivers one queued event with a real signed HTTPS request. */
  async deliver(tenantId: string, eventId: string): Promise<IntegrationEventView> {
    const context = await this.prisma.withTenant(tenantId, async (tx) => {
      const event = await tx.webhookEvent.findFirst({ where: { id: eventId, tenantId } });
      if (!event) throw this.notFound('Webhook event');
      const endpoint = event.endpointId
        ? await tx.webhookEndpoint.findFirst({ where: { id: event.endpointId, tenantId } })
        : await tx.webhookEndpoint.findFirst({ where: { integrationId: event.integrationId!, tenantId } });
      if (!endpoint) throw this.notFound('Webhook endpoint');
      return { event, endpoint };
    });
    const { event, endpoint } = context;
    if (endpoint.status !== 'ACTIVE') {
      throw new BadRequestException('Webhook endpoint is disabled');
    }
    const subscribed = this.scopeList(endpoint.events);
    if (subscribed.length && !subscribed.includes('*') && !subscribed.includes(event.eventType)) {
      throw new BadRequestException('Webhook endpoint is not subscribed to this event');
    }

    const secret = this.crypto.decrypt(endpoint.secretEncrypted);
    const rawBody = JSON.stringify({
      id: event.id,
      type: event.eventType,
      createdAt: event.createdAt.toISOString(),
      data: event.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = this.crypto.randomToken(18);
    const signature = signWebhookPayload(secret, timestamp, nonce, rawBody);

    let status = 'SUCCESS';
    let error: string | null = null;
    let responseStatus: number | null = null;
    try {
      const response = await this.outbound.request({
        url: endpoint.url,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: signature,
          [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
          [WEBHOOK_NONCE_HEADER]: nonce,
        },
        body: rawBody,
        timeoutMs: 8_000,
        maxBytes: 65_536,
      });
      responseStatus = response.status;
      if (!response.ok) {
        status = 'FAILED';
        error = `Endpoint returned HTTP ${response.status}`;
      }
    } catch (err) {
      status = 'FAILED';
      error = err instanceof Error ? err.message : 'Webhook delivery failed';
    }

    const updated = await this.prisma.withTenant(tenantId, async (tx) => {
      const attempts = event.attempts + 1;
      const shouldRetry = status === 'FAILED' && attempts < MAX_ATTEMPTS;
      const nextAttemptAt = shouldRetry
        ? new Date(Date.now() + Math.min(60_000 * 2 ** (attempts - 1), 3_600_000))
        : null;
      const row = await tx.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: shouldRetry ? 'PENDING' : status,
          attempts,
          lastAttemptAt: new Date(),
          nextAttemptAt,
          error,
          payload: { ...(event.payload as Record<string, unknown>), deliveryStatus: responseStatus } as never,
        },
      });
      return row;
    });
    return this.eventView(updated);
  }

  async retryPending(limit = 20): Promise<number> {
    const due = await this.prisma.withElevated(async (tx) =>
      tx.webhookEvent.findMany({
        where: { status: 'PENDING', attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: limit,
      }),
    );
    let delivered = 0;
    for (const event of due) {
      try {
        const result = await this.deliver(event.tenantId, event.id);
        if (result.status === 'SUCCESS') delivered += 1;
      } catch (error) {
        this.logger.warn(`Webhook retry failed for ${event.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    return delivered;
  }

  async retry(
    tenantId: string,
    eventId: string,
    dto: RetryWebhookDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<IntegrationEventView[]> {
    const events = await this.prisma.withTenant(tenantId, async (tx) => {
      const initial = await tx.webhookEvent.findFirst({ where: { id: eventId, tenantId } });
      if (!initial) throw this.notFound('Webhook event');
      return tx.webhookEvent.findMany({
        where: {
          tenantId,
          integrationId: initial.integrationId,
          status: 'FAILED',
          attempts: { lt: MAX_ATTEMPTS },
        },
        orderBy: { createdAt: 'asc' },
        take: dto.limit ?? 10,
      });
    });
    const results: IntegrationEventView[] = [];
    for (const event of events) {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.webhookEvent.update({
          where: { id: event.id },
          data: { status: 'PENDING', nextAttemptAt: new Date(), error: null },
        }),
      );
      results.push(await this.deliver(tenantId, event.id));
    }
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.webhook.retried',
      resourceType: 'webhook_event',
      resourceId: eventId,
      newValues: { count: results.length },
      request,
    });
    return results;
  }

  async listEvents(tenantId: string, integrationId: string): Promise<IntegrationEventView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertIntegration(tx, integrationId);
      const rows = await tx.webhookEvent.findMany({
        where: { integrationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return rows.map((row) => this.eventView(row));
    });
  }

  private header(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private scopeList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private async assertIntegration(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const integration = await tx.integration.findUnique({ where: { id } });
    if (!integration) throw this.notFound('Integration');
  }

  private async findEndpoint(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const endpoint = await tx.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!endpoint) throw this.notFound('Webhook endpoint');
    return endpoint;
  }

  private notFound(resource: string): NotFoundException {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: `${resource} not found` });
  }
}
