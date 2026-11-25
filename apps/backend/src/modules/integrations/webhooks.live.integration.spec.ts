import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { OutboundHttpService } from '../../common/net/outbound-http.service';
import {
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  signWebhookPayload,
} from '../../common/webhooks/webhook-signature';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { IntegrationWebhooksService } from './webhooks.service';

/**
 * Opt-in end-to-end verification of Redis nonce de-duplication against the
 * configured MySQL/TiDB cluster and Redis instance:
 *   RUN_DB_TESTS=1 pnpm --filter @examnexus/api test
 * It creates and removes a temporary tenant, integration and webhook endpoint.
 */
const describeLive = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeLive('inbound webhook nonce replay (live Redis and database)', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let service: IntegrationWebhooksService;
  let tenantId: string;
  let integrationId: string;
  let endpointId: string;
  let nonceKey: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for live webhook tests');
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required for live webhook tests');
    const config = {
      getOrThrow: (key: string) =>
        key === 'security.encryptionMasterKey'
          ? Buffer.alloc(32, 11).toString('base64')
          : key === 'redis.url'
            ? process.env.REDIS_URL
            : process.env.DATABASE_URL,
      get: (key: string) => key === 'integrations.webhookToleranceSeconds' ? 300 : 'test',
    } as unknown as ConfigService;

    prisma = new PrismaService(config);
    await prisma.onModuleInit();
    redis = new RedisService(config);
    await redis.ping();

    const crypto = new CryptoService(config);
    const audit = new AuditService(prisma);
    const outbound = { assertSafeUrl: jest.fn().mockResolvedValue(undefined) } as unknown as OutboundHttpService;
    service = new IntegrationWebhooksService(prisma, crypto, audit, outbound, redis, config);

    const suffix = randomUUID().slice(0, 8);
    tenantId = await prisma.withElevated((tx) =>
      tx.organisation.create({
        data: {
          name: 'Webhook replay test',
          slug: `webhook-replay-${suffix}`,
          officialEmail: `webhook-replay-${suffix}@example.invalid`,
          status: 'APPROVED',
        },
      }).then((row) => row.id),
    );
    integrationId = await prisma.withTenant(tenantId, (tx) =>
      tx.integration.create({
        data: {
          tenantId,
          name: 'Webhook replay test integration',
          provider: 'custom',
          authType: 'WEBHOOK',
          config: {},
        },
      }).then((row) => row.id),
    );
    const endpoint = await service.createEndpoint(
      tenantId,
      integrationId,
      { url: 'https://example.invalid/webhook', events: ['*'] },
      null,
      { header: () => undefined } as never,
    );
    endpointId = endpoint.id;
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.withElevated((tx) => tx.webhookEvent.deleteMany({ where: { tenantId } }));
      await prisma.withElevated((tx) => tx.webhookEndpoint.deleteMany({ where: { tenantId } }));
      await prisma.withElevated((tx) => tx.integration.deleteMany({ where: { tenantId } }));
      await prisma.withElevated((tx) => tx.organisation.deleteMany({ where: { id: tenantId } }));
      await prisma.onModuleDestroy();
    }
    if (redis) {
      if (nonceKey) await redis.client.del(nonceKey);
      await redis.onModuleDestroy();
    }
  }, 120_000);

  it('accepts a signed webhook once and rejects the replayed nonce', async () => {
    const secret = await prisma.withTenant(tenantId, async (tx) => {
      const endpoint = await tx.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });
      return new CryptoService({
        getOrThrow: () => Buffer.alloc(32, 11).toString('base64'),
      } as unknown as ConfigService).decrypt(endpoint.secretEncrypted);
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = `nonce_${randomUUID().replace(/-/g, '')}`;
    nonceKey = `webhook:nonce:${tenantId}:${endpointId}:${nonce}`;
    const rawBody = JSON.stringify({ type: 'candidate.created', data: { candidateCode: 'LIVE-1' } });
    const signature = signWebhookPayload(secret, timestamp, nonce, rawBody);
    const headers = {
      [WEBHOOK_SIGNATURE_HEADER]: signature,
      [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
      [WEBHOOK_NONCE_HEADER]: nonce,
    };

    const first = await service.receiveInbound(endpointId, headers, rawBody);
    expect(first.status).toBe('SUCCESS');
    const afterFirst = await prisma.withTenant(tenantId, (tx) => tx.webhookEvent.count({ where: { tenantId } }));

    await expect(service.receiveInbound(endpointId, headers, rawBody)).rejects.toThrow(ForbiddenException);
    await expect(service.receiveInbound(endpointId, headers, rawBody)).rejects.toThrow('Webhook nonce has already been used');
    const afterReplay = await prisma.withTenant(tenantId, (tx) => tx.webhookEvent.count({ where: { tenantId } }));
    expect(afterReplay).toBe(afterFirst);
    expect(afterFirst).toBe(1);
  }, 120_000);
});
