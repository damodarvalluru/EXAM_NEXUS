import type { ConfigService } from '@nestjs/config';
import { NotificationDispatchService, type DispatchableNotification } from './notification-dispatch.service';
import type { PrismaService } from '../../database/prisma.service';
import type { OutboundHttpService } from '../net/outbound-http.service';
import type { AuditService } from './audit.service';
import {
  verifyWebhookSignature,
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '../webhooks/webhook-signature';

const SECRET = '0123456789abcdef';

function notification(overrides: Partial<DispatchableNotification> = {}): DispatchableNotification {
  return {
    id: 'notif-1',
    tenantId: 'tenant-1',
    channel: 'EMAIL',
    templateKey: 'alert.critical',
    recipient: 'ops@example.test',
    subject: 'CRITICAL alert: Database down',
    body: 'Database is DOWN',
    status: 'PENDING',
    ...overrides,
  };
}

function buildService() {
  const values: Record<string, string> = {
    'notifications.emailWebhookUrl': 'https://hooks.example.test/email',
    'notifications.smsWebhookUrl': 'https://hooks.example.test/sms',
    'notifications.fromAddress': 'noreply@example.test',
    'security.encryptionMasterKey': SECRET,
  };
  const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  const template = {
    subject: 'Alert: {{title}}',
    body: 'Recipient {{recipient}} — {{body}}',
  };
  const tx = {
    notificationTemplate: { findFirst: jest.fn().mockResolvedValue(template) },
    notification: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const prisma = { withElevated: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const http = {
    request: jest.fn().mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ id: 'provider-123' }), latencyMs: 12 }),
  } as unknown as OutboundHttpService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const service = new NotificationDispatchService(prisma, config, http, audit);
  return { service, tx, config, http, audit };
}

describe('NotificationDispatchService', () => {
  it('renders a template, posts a signed HTTPS message and records the provider id', async () => {
    const { service, http, tx, audit } = buildService();

    const sent = await service.dispatch(notification());

    expect(sent).toBe(true);
    const request = (http.request as jest.Mock).mock.calls[0][0] as {
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(request.url).toBe('https://hooks.example.test/email');
    expect(request.method).toBe('POST');
    const payload = JSON.parse(request.body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      to: 'ops@example.test',
      from: 'noreply@example.test',
      subject: 'Alert: CRITICAL alert: Database down',
      text: 'Recipient ops@example.test — Database is DOWN',
    });
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        signature: request.headers[WEBHOOK_SIGNATURE_HEADER],
        timestamp: request.headers[WEBHOOK_TIMESTAMP_HEADER],
        nonce: request.headers[WEBHOOK_NONCE_HEADER],
        rawBody: request.body,
        toleranceSeconds: 300,
      }).valid,
    ).toBe(true);
    expect(tx.notification.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'notif-1' },
      data: expect.objectContaining({ status: 'SENT', providerMessageId: 'provider-123' }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification.dispatched', outcome: 'SUCCESS' }));
  });

  it('uses the SMS webhook for SMS notifications and ignores other channels', async () => {
    const { service, http } = buildService();

    await service.dispatch(notification({ channel: 'SMS', subject: null }));
    expect((http.request as jest.Mock).mock.calls[0][0].url).toBe('https://hooks.example.test/sms');

    await service.dispatch(notification({ channel: 'IN_APP' }));
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('marks a notification FAILED when the webhook rejects the delivery', async () => {
    const { service, http, tx, audit } = buildService();
    (http.request as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503, body: '', latencyMs: 3 });

    await expect(service.dispatch(notification())).resolves.toBe(false);

    expect(tx.notification.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification.dispatch_failed', outcome: 'FAILURE' }));
  });

  it('drains only pending email/SMS rows when explicitly invoked', async () => {
    const { service, tx, audit } = buildService();
    (tx.notification.findMany as jest.Mock).mockResolvedValue([
      notification({ id: 'notif-1' }),
      notification({ id: 'notif-2', channel: 'SMS' }),
    ]);

    const result = await service.drainPending(20);

    expect(result).toEqual({ attempted: 2, sent: 2, failed: 0 });
    expect(tx.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDING', channel: { in: ['EMAIL', 'SMS'] } },
      take: 20,
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'notification.drain', newValues: { attempted: 2, sent: 2, failed: 0 } }));
  });
});
