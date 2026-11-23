import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  signWebhookPayload,
} from '../../common/webhooks/webhook-signature';
import type { AuditService } from '../../common/services/audit.service';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { OutboundHttpService } from '../../common/net/outbound-http.service';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../database/redis.service';
import { IntegrationWebhooksService } from './webhooks.service';

describe('inbound webhook verification', () => {
  const secret = 'signing-secret';
  const toleranceSeconds = 30;
  const nowSeconds = 1_700_000_000;
  const nonce = 'nonce_abcdefghijklmnop';
  const rawBody = JSON.stringify({ type: 'candidate.created', data: { id: 'cand_1' } });

  let endpointCreate: jest.Mock;
  let redisEval: jest.Mock;
  let service: IntegrationWebhooksService;

  const endpoint = {
    id: 'endpoint-1',
    tenantId: 'tenant-1',
    integrationId: 'integration-1',
    url: 'https://example.com/hook',
    secretEncrypted: 'encrypted',
    events: ['*'],
    status: 'ACTIVE',
    createdAt: new Date(nowSeconds * 1000),
    disabledAt: null,
  };

  function headers(timestamp: number, signature: string) {
    return {
      [WEBHOOK_SIGNATURE_HEADER]: signature,
      [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
      [WEBHOOK_NONCE_HEADER]: nonce,
    };
  }

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(nowSeconds * 1000);
    endpointCreate = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'event-1',
      ...data,
      nextAttemptAt: null,
      error: null,
      createdAt: new Date(nowSeconds * 1000),
    }));
    redisEval = jest.fn().mockResolvedValue(1);

    const prisma = {
      withElevated: jest.fn().mockImplementation((work) => work({ webhookEndpoint: { findFirst: jest.fn().mockResolvedValue(endpoint) } })),
      withTenant: jest.fn().mockImplementation((_tenantId, work) => work({ webhookEvent: { create: endpointCreate } })),
    } as unknown as PrismaService;
    const crypto = { decrypt: jest.fn().mockReturnValue(secret) } as unknown as CryptoService;
    const redis = { client: { eval: redisEval } } as unknown as RedisService;
    const config = { get: jest.fn().mockReturnValue(toleranceSeconds) } as unknown as ConfigService;

    service = new IntegrationWebhooksService(
      prisma,
      crypto,
      {} as AuditService,
      {} as OutboundHttpService,
      redis,
      config,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists a correctly signed payload with the configured tolerance', async () => {
    const signature = signWebhookPayload(secret, nowSeconds, nonce, rawBody);
    const event = await service.receiveInbound(endpoint.id, headers(nowSeconds, signature), rawBody);

    expect(event.status).toBe('SUCCESS');
    expect(event.eventType).toBe('candidate.created');
    expect(endpointCreate).toHaveBeenCalledTimes(1);
    expect(redisEval).toHaveBeenCalledWith(
      expect.stringContaining('SET'),
      1,
      `webhook:nonce:${endpoint.tenantId}:${endpoint.id}:${nonce}`,
      String(nowSeconds * 1000),
      String(toleranceSeconds * 2),
    );
  });

  it('rejects a tampered payload before persisting it', async () => {
    const signature = signWebhookPayload(secret, nowSeconds, nonce, rawBody);
    await expect(
      service.receiveInbound(endpoint.id, headers(nowSeconds, signature), `${rawBody} `),
    ).rejects.toThrow(ForbiddenException);
    expect(redisEval).not.toHaveBeenCalled();
    expect(endpointCreate).not.toHaveBeenCalled();
  });

  it('rejects a payload outside the configured tolerance window', async () => {
    const stale = nowSeconds - toleranceSeconds - 30;
    const signature = signWebhookPayload(secret, stale, nonce, rawBody);
    await expect(
      service.receiveInbound(endpoint.id, headers(stale, signature), rawBody),
    ).rejects.toThrow('Timestamp outside the allowed window');
    expect(endpointCreate).not.toHaveBeenCalled();
  });

  it('rejects a replayed nonce and persists only the first delivery', async () => {
    const signature = signWebhookPayload(secret, nowSeconds, nonce, rawBody);
    await service.receiveInbound(endpoint.id, headers(nowSeconds, signature), rawBody);
    redisEval.mockResolvedValueOnce(0);

    await expect(
      service.receiveInbound(endpoint.id, headers(nowSeconds, signature), rawBody),
    ).rejects.toThrow('Webhook nonce has already been used');
    expect(endpointCreate).toHaveBeenCalledTimes(1);
  });
});
