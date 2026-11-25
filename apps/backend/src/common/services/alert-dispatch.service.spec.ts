import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../database/prisma.service';
import type { OutboundHttpService } from '../net/outbound-http.service';
import type { AuditService } from './audit.service';
import {
  AlertDispatchService,
  dispatchSecurityAlertCreated,
  registerSecurityAlertHook,
  type DispatchableAlert,
} from './alert-dispatch.service';
import type { NotificationDispatchService } from './notification-dispatch.service';
import {
  verifyWebhookSignature,
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '../webhooks/webhook-signature';

const SECRET = '0123456789abcdef';

const alert: DispatchableAlert = {
  id: 'alert-1',
  tenantId: 'tenant-1',
  severity: 'CRITICAL',
  category: 'SYSTEM_HEALTH',
  title: 'Database down',
  description: 'Primary connection failed',
  source: 'platform-health',
  status: 'OPEN',
};

function buildService() {
  const values: Record<string, unknown> = {
    'alerts.webhookUrl': 'https://hooks.example.test/alerts',
    'alerts.escalationMinutes': 15,
    'alerts.onCallAlias': 'oncall',
    'alerts.slaMinutes': 60,
    'security.encryptionMasterKey': SECRET,
  };
  const config = { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  let counter = 0;
  const tx = {
    platformSetting: {
      findMany: jest.fn().mockResolvedValue([
        { key: 'alerts.escalationMinutes', value: 5 },
        { key: 'alerts.routes', value: { CRITICAL: { channel: 'SMS', recipient: '+15551234567' } } },
      ]),
    },
    notification: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        counter += 1;
        return { id: `notif-${counter}`, ...data, providerMessageId: null };
      }),
    },
    systemHealthEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'health-event-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    withElevated: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;
  const http = {
    request: jest.fn().mockResolvedValue({ ok: true, status: 200, body: '{}', latencyMs: 5 }),
  } as unknown as OutboundHttpService;
  const notifications = { dispatch: jest.fn().mockResolvedValue(true) } as unknown as NotificationDispatchService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const service = new AlertDispatchService(prisma, config, http, notifications, audit);
  return { service, tx, http, notifications, audit };
}

describe('AlertDispatchService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    registerSecurityAlertHook(null);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('uses the stored policy, signs the alert webhook and records the SLA deadline', async () => {
    const { service, tx, http, audit } = buildService();

    await service.onCreateSecurityAlert(alert);

    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        templateKey: 'alert.critical',
        channel: 'SMS',
        recipient: '+15551234567',
      }),
    }));
    const request = (http.request as jest.Mock).mock.calls[0][0] as {
      body: string;
      headers: Record<string, string>;
      url: string;
    };
    expect(request.url).toBe('https://hooks.example.test/alerts');
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
    expect(JSON.parse(request.body)).toMatchObject({
      type: 'security.alert.created',
      alert: { id: 'alert-1', severity: 'CRITICAL' },
      escalationAt: '2026-01-01T00:05:00.000Z',
      slaDeadline: '2026-01-01T01:00:00.000Z',
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security.alert.dispatched',
      newValues: expect.objectContaining({ recipient: '+15551234567' }),
    }));
  });

  it('escalates to the on-call alias after the configured delay', async () => {
    const { service, tx, http, audit } = buildService();
    await service.onCreateSecurityAlert(alert);

    await jest.advanceTimersByTimeAsync(5 * 60_000);

    expect(tx.notification.create).toHaveBeenCalledTimes(2);
    expect((tx.notification.create as jest.Mock).mock.calls[1][0].data).toMatchObject({
      templateKey: 'alert.escalation.critical',
      recipient: 'oncall',
    });
    expect(http.request).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security.alert.escalated',
      newValues: expect.objectContaining({ recipient: 'oncall', afterMinutes: 5 }),
    }));
  });

  it('audits an SLA breach at the deadline', async () => {
    const { service, audit } = buildService();
    await service.onCreateSecurityAlert(alert);

    await jest.advanceTimersByTimeAsync(60 * 60_000);

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security.alert.sla_breached',
      outcome: 'FAILURE',
    }));
  });

  it('cancels escalation when an alert is acknowledged', async () => {
    const { service, audit } = buildService();
    await service.onCreateSecurityAlert(alert);
    await service.onSecurityAlertUpdated({ ...alert, status: 'INVESTIGATING' }, 'OPEN', { userId: 'admin-1' });

    await jest.advanceTimersByTimeAsync(60 * 60_000);

    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'security.alert.escalated' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'security.alert.acknowledged' }));
  });

  it('persists health transitions and alerts on degradation, resolving the event on recovery', async () => {
    const { service, tx } = buildService();
    (tx.systemHealthEvent.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'previous', status: 'HEALTHY', resolvedAt: null });

    await service.trackHealthTransitions([{
      component: 'database', status: 'DOWN', latencyMs: 42,
      details: { error: 'connection refused' }, detectedAt: new Date().toISOString(),
    }]);

    expect(tx.systemHealthEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ component: 'database', status: 'DOWN', latencyMs: 42 }),
    }));
    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ templateKey: 'alert.critical' }),
    }));

    (tx.systemHealthEvent.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'previous-down', status: 'DOWN', resolvedAt: null });
    (tx.notification.create as jest.Mock).mockClear();
    await service.trackHealthTransitions([{
      component: 'database', status: 'HEALTHY', latencyMs: 4,
      details: null, detectedAt: new Date().toISOString(),
    }]);

    expect(tx.systemHealthEvent.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'previous-down' },
      data: { resolvedAt: expect.any(Date) },
    }));
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('routes auth-created alerts through the process-local bridge', async () => {
    const { service, http } = buildService();
    service.onModuleInit();

    await dispatchSecurityAlertCreated(alert);

    expect(http.request).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });
});
