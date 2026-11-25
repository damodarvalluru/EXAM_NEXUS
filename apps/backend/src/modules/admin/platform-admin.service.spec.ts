import type { Principal } from '@examnexus/shared';
import type { AlertDispatchService } from '../../common/services/alert-dispatch.service';
import type { AuditService } from '../../common/services/audit.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../database/redis.service';
import { isAttemptPassed, PlatformAdminService } from './platform-admin.service';

interface AlertServiceMock {
  onSecurityAlertUpdated: jest.Mock;
  onSecurityIncidentUpdated: jest.Mock;
  trackHealthTransitions: jest.Mock;
}

function alertServiceMock(): AlertServiceMock {
  return {
    onSecurityAlertUpdated: jest.fn().mockResolvedValue(undefined),
    onSecurityIncidentUpdated: jest.fn().mockResolvedValue(undefined),
    trackHealthTransitions: jest.fn().mockResolvedValue(undefined),
  };
}

function adminPrincipal(): Principal {
  return {
    userId: 'user-1',
    email: 'admin@example.com',
    tenantId: 'tenant-1',
    globalRoles: ['PLATFORM_ADMIN'],
    tenantRoles: [],
    permissions: [],
    sessionId: null,
    authMethod: null,
    stepUpVerifiedAt: null,
  };
}

describe('isAttemptPassed', () => {
  it.each<[number | null, number | null, boolean]>([
    [40, 40, true],
    [85, 40, true],
    [39.99, 40, false],
    [50, 70, false],
    [70, 70, true],
    [null, 40, false],
    [80, null, false],
  ])('score %s against passing marks %s is %s', (score, passingMarks, expected) => {
    expect(isAttemptPassed(score, passingMarks)).toBe(expected);
  });
});

describe('PlatformAdminService.analytics pass rates', () => {
  it('uses each examination passingMarks instead of a hardcoded threshold', async () => {
    const now = new Date();
    const attempts = [
      { createdAt: now, score: 39, status: 'COMPLETED', examination: { passingMarks: 40 } },
      { createdAt: now, score: 40, status: 'COMPLETED', examination: { passingMarks: 40 } },
      { createdAt: now, score: 50, status: 'COMPLETED', examination: { passingMarks: 70 } },
      { createdAt: now, score: 80, status: 'COMPLETED', examination: { passingMarks: 70 } },
    ];
    const examinations = [
      {
        id: 'exam-1', title: 'Exam 1', passingMarks: 40,
        attempts: [{ score: 39, status: 'COMPLETED' }, { score: 40, status: 'COMPLETED' }],
      },
      {
        id: 'exam-2', title: 'Exam 2', passingMarks: 70,
        attempts: [{ score: 50, status: 'COMPLETED' }, { score: 80, status: 'COMPLETED' }],
      },
    ];
    const tx = {
      organisation: {
        findMany: jest.fn((args?: { select?: { createdAt?: unknown; id?: unknown } }) =>
          Promise.resolve(args?.select?.createdAt && !args.select?.id
            ? [{ createdAt: now }]
            : [{ id: 'org-1', name: 'Org', examinations: [], candidates: [] }])),
      },
      examination: {
        findMany: jest.fn((args?: { include?: unknown }) =>
          Promise.resolve(args?.include ? examinations : [{ createdAt: now }])),
      },
      examinationAttempt: {
        findMany: jest.fn().mockResolvedValue(attempts),
        count: jest.fn().mockResolvedValue(4),
      },
      candidate: { count: jest.fn().mockResolvedValue(0) },
      authenticationEvent: { findMany: jest.fn().mockResolvedValue([]) },
      securityAlert: { count: jest.fn().mockResolvedValue(0) },
    };
    const prisma = {
      withElevated: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaService;
    const service = new PlatformAdminService(prisma, {} as RedisService, {} as AuditService);

    const report = await service.analytics('30d');

    expect(report.summary.passRate).toBe(50);
    expect(report.byExamination.find((row) => row.examinationId === 'exam-1')?.passRate).toBe(50);
    expect(report.byExamination.find((row) => row.examinationId === 'exam-2')?.passRate).toBe(50);
  });
});

describe('PlatformAdminService.systemHealth degradation', () => {
  function buildService(options: {
    databaseAvailable?: boolean;
    redisAvailable?: boolean;
    transactionFails?: boolean;
    eventsFail?: boolean;
    alerts?: AlertServiceMock;
  } = {}) {
    const queryRaw = jest.fn();
    if (options.databaseAvailable === false) queryRaw.mockRejectedValue(new Error('database unreachable'));
    else queryRaw.mockResolvedValue([{ ok: 1 }]);

    const ping = jest.fn();
    if (options.redisAvailable === false) ping.mockRejectedValue(new Error('redis unreachable'));
    else ping.mockResolvedValue('PONG');

    const tx = {
      systemHealthEvent: { findMany: jest.fn().mockResolvedValue([]) },
      webhookEvent: { count: jest.fn().mockResolvedValue(2) },
      notification: { count: jest.fn().mockResolvedValue(1) },
      fileObject: {
        aggregate: jest.fn().mockResolvedValue({ _count: { _all: 3 }, _sum: { sizeBytes: 10n } }),
      },
    };
    if (options.eventsFail) tx.systemHealthEvent.findMany.mockRejectedValue(new Error('events query failed'));

    const withElevated = jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => {
      if (options.transactionFails) throw new Error('transaction failed');
      return work(tx);
    });

    const prisma = { $queryRaw: queryRaw, withElevated } as unknown as PrismaService;
    const redis = { ping } as unknown as RedisService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const alerts = options.alerts as unknown as AlertDispatchService | undefined;
    return { service: new PlatformAdminService(prisma, redis, audit, alerts), withElevated };
  }

  it('returns a structured DOWN payload when the database probe fails', async () => {
    const { service, withElevated } = buildService({ databaseAvailable: false });

    const health = await service.systemHealth();

    expect(health.api.status).toBe('DOWN');
    expect(health.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'database', status: 'DOWN' }),
        expect.objectContaining({ component: 'queues', status: 'DOWN' }),
        expect.objectContaining({ component: 'storage', status: 'DOWN' }),
      ]),
    );
    expect(health.events).toEqual([]);
    expect(health.queues).toEqual([
      { name: 'webhooks', waiting: 0, active: 0, failed: 0 },
      { name: 'notifications', waiting: 0, active: 0, failed: 0 },
    ]);
    expect(health.storage).toEqual({ objects: 0, bytes: 0 });
    expect(withElevated).not.toHaveBeenCalled();
  });

  it('keeps database aggregates when only Redis is down', async () => {
    const { service } = buildService({ redisAvailable: false });

    const health = await service.systemHealth();

    expect(health.api.status).toBe('DEGRADED');
    expect(health.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'database', status: 'HEALTHY' }),
        expect.objectContaining({ component: 'redis', status: 'DOWN' }),
      ]),
    );
    expect(health.queues[0]).toEqual(expect.objectContaining({ waiting: 2, failed: 2 }));
    expect(health.storage).toEqual({ objects: 3, bytes: 10 });
  });

  it('degrades only the failing aggregate instead of aborting the response', async () => {
    const { service } = buildService({ eventsFail: true });

    const health = await service.systemHealth();

    expect(health.api.status).toBe('DEGRADED');
    expect(health.events).toEqual([]);
    expect(health.components).toEqual(
      expect.arrayContaining([expect.objectContaining({ component: 'events', status: 'DEGRADED' })]),
    );
    expect(health.storage).toEqual({ objects: 3, bytes: 10 });
  });

  it('returns a structured payload when the elevated transaction itself fails', async () => {
    const { service } = buildService({ transactionFails: true });

    const health = await service.systemHealth();

    expect(health.api.status).toBe('DEGRADED');
    expect(health.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ component: 'queues', status: 'DOWN' }),
        expect.objectContaining({ component: 'storage', status: 'DOWN' }),
      ]),
    );
    expect(health.storage).toEqual({ objects: 0, bytes: 0 });
  });

  it('passes the resolved components to health transition tracking', async () => {
    const alerts = alertServiceMock();
    const { service } = buildService({ alerts });

    const health = await service.systemHealth();

    expect(alerts.trackHealthTransitions).toHaveBeenCalledTimes(1);
    expect(alerts.trackHealthTransitions).toHaveBeenCalledWith(health.components);
  });

  it('does not fail the health response when alert tracking fails', async () => {
    const alerts = alertServiceMock();
    alerts.trackHealthTransitions.mockRejectedValue(new Error('dispatch unavailable'));
    const { service } = buildService({ alerts });

    const health = await service.systemHealth();

    expect(health.api.status).toBe('HEALTHY');
    expect(alerts.trackHealthTransitions).toHaveBeenCalledTimes(1);
  });
});

describe('PlatformAdminService security status dispatch hooks', () => {
  function serviceWithTransaction(tx: unknown, alerts: AlertServiceMock): PlatformAdminService {
    const prisma = {
      withElevated: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    return new PlatformAdminService(prisma, {} as RedisService, audit, alerts as unknown as AlertDispatchService);
  }

  it('dispatches an alert update with the previous status and actor', async () => {
    const alerts = alertServiceMock();
    const updated = {
      id: 'alert-1',
      tenantId: 'tenant-1',
      organisation: { name: 'Org' },
      severity: 'HIGH',
      category: 'SUSPICIOUS_LOGIN',
      title: 'Suspicious login',
      description: 'New location',
      source: 'auth',
      evidenceRef: null,
      status: 'INVESTIGATING',
      assignedTo: 'user-2',
      createdAt: new Date(),
      resolvedAt: null,
      _count: { incidents: 0 },
    };
    const tx = {
      securityAlert: {
        findUnique: jest.fn().mockResolvedValue({ status: 'OPEN', assignedTo: null }),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const service = serviceWithTransaction(tx, alerts);
    const principal = adminPrincipal();
    const request = {} as RequestWithContext;

    const result = await service.updateAlert(
      'alert-1',
      { status: 'INVESTIGATING', assignee: 'user-2' },
      principal,
      request,
    );

    expect(result.id).toBe('alert-1');
    expect(alerts.onSecurityAlertUpdated).toHaveBeenCalledWith(updated, 'OPEN', principal, request);
  });

  it('dispatches an incident update with the previous status and actor', async () => {
    const alerts = alertServiceMock();
    const updated = {
      id: 'incident-1',
      tenantId: 'tenant-1',
      organisation: { name: 'Org' },
      alertId: 'alert-1',
      severity: 'CRITICAL',
      classification: 'BREACH',
      status: 'CONTAINED',
      assignedTo: 'user-2',
      notes: 'Isolated affected account',
      responseActions: ['isolated-account'],
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = {
      securityIncident: {
        findUnique: jest.fn().mockResolvedValue({ status: 'OPEN', assignedTo: null, notes: null, responseActions: [] }),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const service = serviceWithTransaction(tx, alerts);
    const principal = adminPrincipal();
    const request = {} as RequestWithContext;

    const result = await service.updateIncident(
      'incident-1',
      { status: 'CONTAINED', assignee: 'user-2', notes: 'Isolated affected account', responseActions: ['isolated-account'] },
      principal,
      request,
    );

    expect(result.id).toBe('incident-1');
    expect(alerts.onSecurityIncidentUpdated).toHaveBeenCalledWith(updated, 'OPEN', principal, request);
  });
});
