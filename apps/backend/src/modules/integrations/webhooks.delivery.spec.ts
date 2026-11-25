import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../../common/services/audit.service';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { OutboundHttpService } from '../../common/net/outbound-http.service';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../database/redis.service';
import {
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  signWebhookPayload,
} from '../../common/webhooks/webhook-signature';
import { IntegrationWebhooksService } from './webhooks.service';

const TENANT = 'tenant-1';
const INTEGRATION = 'integration-1';
const SECRET = 'signing-secret';
const NONCE = 'nonce_abcdefghijklmnop';
const ENDPOINT_ID = 'endpoint-1';
const BASE_TIME = new Date('2026-11-25T12:00:00.000Z');

type Row = Record<string, unknown> & { id: string };

/** Minimal in-memory delegates that support the exact queries the service issues. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    const actual = row[key];
    if (expected instanceof Date) return new Date(String(actual)).getTime() === expected.getTime();
    if (expected && typeof expected === 'object') {
      const clause = expected as Record<string, unknown>;
      if ('lte' in clause) return new Date(String(actual)).getTime() <= new Date(String(clause.lte)).getTime();
      if ('lt' in clause) return Number(actual) < Number(clause.lt);
      if ('in' in clause) return (clause.in as unknown[]).includes(actual);
    }
    return actual === expected;
  });
}

function fixture() {
  const events: Row[] = [];
  const endpoints: Row[] = [];
  const endpoint: Row = {
    id: ENDPOINT_ID,
    tenantId: TENANT,
    integrationId: INTEGRATION,
    url: 'https://hooks.example.com/examnexus',
    events: ['*'],
    status: 'ACTIVE',
    secretEncrypted: 'encrypted',
    createdAt: BASE_TIME,
    disabledAt: null,
  };
  endpoints.push(endpoint);

  const tx = {
    webhookEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: Row = {
          ...data,
          id: data.id as string,
          attempts: (data.attempts as number | undefined) ?? 0,
          status: (data.status as string | undefined) ?? 'PENDING',
          lastAttemptAt: (data.lastAttemptAt as Date | undefined) ?? null,
          nextAttemptAt: (data.nextAttemptAt as Date | undefined) ?? null,
          error: (data.error as string | undefined) ?? null,
          createdAt: (data.createdAt as Date | undefined) ?? new Date(),
        };
        events.push(row);
        return { ...row };
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        events.find((event) => matches(event, where)) ?? null),
      findMany: jest.fn(async ({ where, orderBy, take }: {
        where?: Record<string, unknown>;
        orderBy?: { nextAttemptAt?: string };
        take?: number;
      }) => {
        const rows = events.filter((event) => matches(event, where));
        if (orderBy?.nextAttemptAt === 'asc') {
          rows.sort((a, b) =>
            new Date(String(a.nextAttemptAt)).getTime() - new Date(String(b.nextAttemptAt)).getTime());
        }
        return (take ? rows.slice(0, take) : rows).map((row) => ({ ...row }));
      }),
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = events.find((event) => matches(event, where));
        if (!row) throw new Error('Event not found');
        Object.assign(row, data);
        return { ...row };
      }),
    },
    webhookEndpoint: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        endpoints.find((item) => matches(item, where)) ?? null),
    },
  };
  const prisma = {
    withTenant: jest.fn(async (_tenantId: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    withElevated: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;
  return { events, endpoints, endpoint, tx, prisma };
}

describe('outbound webhook delivery, retries and audit', () => {
  const okResponse = { ok: true, status: 200, body: '{}', latencyMs: 4 };
  const failResponse = (status: number) => ({ ok: false, status, body: '{}', latencyMs: 4 });
  const principal = { userId: 'user-1', email: 'admin@example.com' };
  const request = { header: () => undefined, requestId: 'req-1' };

  let fixtureData: ReturnType<typeof fixture>;
  let outbound: { request: jest.Mock; assertSafeUrl: jest.Mock };
  let audit: { record: jest.Mock };
  let service: IntegrationWebhooksService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(BASE_TIME);
    fixtureData = fixture();
    outbound = { request: jest.fn(), assertSafeUrl: jest.fn() };
    audit = { record: jest.fn() };
    const crypto = {
      decrypt: jest.fn().mockReturnValue(SECRET),
      randomToken: jest.fn().mockReturnValue(NONCE),
      encrypt: jest.fn().mockReturnValue('encrypted'),
    } as unknown as CryptoService;
    const redis = { client: { eval: jest.fn().mockResolvedValue(1) } } as unknown as RedisService;
    const config = { get: jest.fn().mockReturnValue(300) } as unknown as ConfigService;
    service = new IntegrationWebhooksService(
      fixtureData.prisma,
      crypto,
      audit as unknown as AuditService,
      outbound as unknown as OutboundHttpService,
      redis,
      config,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const enqueue = () => service.enqueue(TENANT, INTEGRATION, 'candidate.created', { candidateCode: 'C1' });

  it('enqueues an event as PENDING with an immediate next attempt', async () => {
    const view = await enqueue();

    expect(view).toMatchObject({
      eventType: 'candidate.created',
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: BASE_TIME.toISOString(),
      error: null,
    });
    expect(fixtureData.events).toHaveLength(1);
    expect(outbound.request).not.toHaveBeenCalled();
  });

  it('fails twice then succeeds, with signed requests and exponential backoff', async () => {
    await enqueue();
    const id = fixtureData.events[0]!.id as string;
    outbound.request
      .mockRejectedValueOnce(new Error('socket reset'))
      .mockResolvedValueOnce(failResponse(503))
      .mockResolvedValueOnce(okResponse);

    const first = await service.deliver(TENANT, id);
    expect(first).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      nextAttemptAt: new Date(BASE_TIME.getTime() + 60_000).toISOString(),
      error: 'socket reset',
    });

    jest.setSystemTime(new Date(BASE_TIME.getTime() + 60_001));
    const second = await service.deliver(TENANT, id);
    expect(second).toMatchObject({
      status: 'PENDING',
      attempts: 2,
      nextAttemptAt: new Date(BASE_TIME.getTime() + 60_001 + 120_000).toISOString(),
      error: 'Endpoint returned HTTP 503',
    });

    jest.setSystemTime(new Date(BASE_TIME.getTime() + 180_001));
    const third = await service.deliver(TENANT, id);
    expect(third).toMatchObject({ status: 'SUCCESS', attempts: 3, nextAttemptAt: null, error: null });
    expect(outbound.request).toHaveBeenCalledTimes(3);

    const call = outbound.request.mock.calls[2]![0] as {
      url: string; body: string; headers: Record<string, string>;
    };
    expect(call.url).toBe('https://hooks.example.com/examnexus');
    expect(call.headers[WEBHOOK_SIGNATURE_HEADER]).toBe(signWebhookPayload(
      SECRET,
      Number(call.headers[WEBHOOK_TIMESTAMP_HEADER]),
      NONCE,
      call.body,
    ));
    expect(call.headers[WEBHOOK_NONCE_HEADER]).toBe(NONCE);
    expect(JSON.parse(call.body)).toMatchObject({ id, type: 'candidate.created', data: { candidateCode: 'C1' } });
    // Direct delivery is a system action; only operator-initiated retries are audited.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('retryPending drains due events only after their backoff and stops after success', async () => {
    await enqueue();
    outbound.request
      .mockRejectedValueOnce(new Error('socket reset'))
      .mockResolvedValueOnce(failResponse(500))
      .mockResolvedValueOnce(okResponse);

    expect(await service.retryPending(20)).toBe(0);
    expect(fixtureData.events[0]).toMatchObject({ attempts: 1, status: 'PENDING' });

    jest.setSystemTime(new Date(BASE_TIME.getTime() + 61_000));
    expect(await service.retryPending(20)).toBe(0);
    expect(fixtureData.events[0]).toMatchObject({ attempts: 2, status: 'PENDING' });

    jest.setSystemTime(new Date(BASE_TIME.getTime() + 181_000));
    expect(await service.retryPending(20)).toBe(1);
    expect(fixtureData.events[0]).toMatchObject({ attempts: 3, status: 'SUCCESS', nextAttemptAt: null });

    expect(await service.retryPending(20)).toBe(0);
    expect(outbound.request).toHaveBeenCalledTimes(3);
  });

  it('marks an event FAILED terminally after five unsuccessful attempts', async () => {
    await enqueue();
    outbound.request.mockResolvedValue(failResponse(503));
    const backoffs = [60_000, 120_000, 240_000, 480_000];

    for (const delay of backoffs) {
      expect(await service.retryPending(20)).toBe(0);
      jest.setSystemTime(new Date(Date.now() + delay + 1_000));
    }
    expect(await service.retryPending(20)).toBe(0);

    expect(fixtureData.events[0]).toMatchObject({
      status: 'FAILED',
      attempts: 5,
      nextAttemptAt: null,
      error: 'Endpoint returned HTTP 503',
    });
    expect(outbound.request).toHaveBeenCalledTimes(5);
    expect(await service.retryPending(20)).toBe(0);
    expect(outbound.request).toHaveBeenCalledTimes(5);
  });

  it('manually retries failed events and records an audit entry', async () => {
    const created = await fixtureData.tx.webhookEvent.create({
      data: {
        id: 'event-failed',
        tenantId: TENANT,
        integrationId: INTEGRATION,
        eventType: 'candidate.updated',
        payload: { candidateCode: 'C2' },
        status: 'FAILED',
        attempts: 2,
        lastAttemptAt: new Date(BASE_TIME.getTime() - 10_000),
        error: 'previous failure',
      },
    });
    outbound.request.mockResolvedValueOnce(okResponse);

    const results = await service.retry(TENANT, created.id, { limit: 10 }, principal as never, request as never);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'SUCCESS', attempts: 3, error: null });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'user-1',
      actorEmail: 'admin@example.com',
      tenantId: TENANT,
      action: 'integration.webhook.retried',
      resourceType: 'webhook_event',
      resourceId: created.id,
      newValues: { count: 1 },
    }));
  });

  it('refuses a manual retry for another tenant without auditing a delivery', async () => {
    const created = await fixtureData.tx.webhookEvent.create({
      data: {
        id: 'event-foreign',
        tenantId: TENANT,
        integrationId: INTEGRATION,
        eventType: 'candidate.updated',
        payload: {},
        status: 'FAILED',
        attempts: 1,
      },
    });

    await expect(
      service.retry('tenant-2', created.id, { limit: 10 }, principal as never, request as never),
    ).rejects.toThrow('Webhook event not found');
    expect(outbound.request).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
