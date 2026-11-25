import type { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import type { OutboundHttpService } from '../../common/net/outbound-http.service';
import type { AuditService } from '../../common/services/audit.service';
import { signWebhookPayload, WEBHOOK_NONCE_HEADER, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from '../../common/webhooks/webhook-signature';
import { BillingService } from './billing.service';

const WEBHOOK_SECRET = 'billing-webhook-secret';

function signedHeaders(rawBody: string, timestamp = Math.floor(Date.now() / 1000), nonce = 'abcdefghijklmnop1234') {
  return {
    signature: signWebhookPayload(WEBHOOK_SECRET, timestamp, nonce, rawBody),
    timestamp: String(timestamp),
    nonce,
  };
}

function buildService() {
  const values: Record<string, unknown> = {
    'billing.providerBaseUrl': 'https://billing.example.test',
    'billing.keyId': 'key-id',
    'billing.keySecret': 'key-secret',
    'billing.webhookSecret': WEBHOOK_SECRET,
    'integrations.webhookToleranceSeconds': 300,
  };
  const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  const subscription = {
    id: 'sub-1', tenantId: 'tenant-1', plan: 'PRO', seats: 10, billingCycle: 'MONTHLY',
    status: 'TRIAL', endDate: null, trialEndsAt: null,
  };
  const tx = {
    subscription: {
      findUnique: jest.fn().mockResolvedValue(subscription),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...subscription, ...data })),
    },
    payment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'pay-1', ...data })),
    },
  };
  const prisma = {
    withElevated: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;
  const http = {
    request: jest.fn().mockResolvedValue({
      ok: true, status: 200, latencyMs: 12,
      body: JSON.stringify({ id: 'cs_1', checkoutUrl: 'https://checkout.example.test/session/1', expiresAt: '2026-12-01T00:00:00.000Z' }),
    }),
  } as unknown as OutboundHttpService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { service: new BillingService(prisma, config, http, audit), tx, http, audit, subscription };
}

describe('BillingService.createCheckout', () => {
  it('uses provider-supplied session and URL without creating a Payment', async () => {
    const { service, http, tx } = buildService();

    const result = await service.createCheckout({ plan: 'PRO' }, { userId: 'admin-1', tenantId: 'tenant-1' });

    expect(result).toEqual({
      provider: 'external',
      sessionId: 'cs_1',
      checkoutUrl: 'https://checkout.example.test/session/1',
      expiresAt: '2026-12-01T00:00:00.000Z',
    });
    const request = (http.request as jest.Mock).mock.calls[0][0] as {
      url: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(request.url).toBe('https://billing.example.test/checkout/sessions');
    expect(request.headers.authorization).toBe(`Basic ${Buffer.from('key-id:key-secret').toString('base64')}`);
    expect(JSON.parse(request.body)).toMatchObject({ tenantId: 'tenant-1', plan: 'PRO', subscriptionId: 'sub-1' });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('rejects a provider response without an HTTPS checkout URL', async () => {
    const { service, http } = buildService();
    (http.request as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ id: 'cs_1', url: 'http://insecure.example.test' }) });

    await expect(service.createCheckout({}, { tenantId: 'tenant-1' })).rejects.toThrow(/HTTPS checkout URL/);
  });
});

describe('BillingService.verifyProviderWebhook', () => {
  const body = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    tenantId: 'tenant-1',
    amount: 1200.5,
    currency: 'INR',
    paymentIntent: 'pi_1',
  });

  it('accepts a signed, provider-confirmed payment and activates the subscription', async () => {
    const { service, tx } = buildService();

    const result = await service.verifyProviderWebhook(body, signedHeaders(body));

    expect(result).toMatchObject({ eventId: 'evt_1', status: 'PROCESSED', paymentId: 'pay-1', subscriptionStatus: 'ACTIVE', replayed: false });
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        provider: 'external', providerReference: 'pi_1', currency: 'INR', status: 'SUCCEEDED',
      }),
    }));
    const data = (tx.payment.create as jest.Mock).mock.calls[0][0].data as { amount: { toNumber: () => number } };
    expect(data.amount.toNumber()).toBe(1200.5);
    expect(tx.subscription.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACTIVE', endDate: null }),
    }));
  });

  it('does not create a second Payment when the same webhook is replayed', async () => {
    const { service, tx } = buildService();
    await service.verifyProviderWebhook(body, signedHeaders(body));
    (tx.subscription.update as jest.Mock).mockClear();
    (tx.payment.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'pay-1' });
    (tx.subscription.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'sub-1', tenantId: 'tenant-1', status: 'ACTIVE', endDate: null,
    });

    const replay = await service.verifyProviderWebhook(body, signedHeaders(body));

    expect(replay.replayed).toBe(true);
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(tx.subscription.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid HMAC before touching the database', async () => {
    const { service, tx } = buildService();
    const headers = { ...signedHeaders(body), signature: '0'.repeat(64) };

    await expect(service.verifyProviderWebhook(body, headers)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.subscription.findUnique).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('does not invent a Payment when the provider omits an amount', async () => {
    const { service, tx } = buildService();
    const noAmount = JSON.stringify({ id: 'evt_2', type: 'payment.failed', tenantId: 'tenant-1' });

    const result = await service.verifyProviderWebhook(noAmount, signedHeaders(noAmount));

    expect(result.subscriptionStatus).toBe('PAST_DUE');
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.subscription.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PAST_DUE' }),
    }));
  });
});

describe('BillingService subscription mutations', () => {
  it('cancels and restores using statuses supported by the schema', async () => {
    const { service, tx } = buildService();

    const cancelled = await service.cancelSubscription('sub-1', undefined, { userId: 'admin-1' });
    expect(cancelled.status).toBe('CANCELLED');
    expect(tx.subscription.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));

    const restored = await service.restoreSubscription('sub-1', undefined, { userId: 'admin-1' });
    expect(restored.status).toBe('ACTIVE');
    expect(restored.endDate).toBeNull();
    expect(tx.subscription.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { status: 'ACTIVE', endDate: null },
    }));
  });
});
