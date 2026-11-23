import type { AuditService } from '../../common/services/audit.service';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../database/redis.service';
import { isAttemptPassed, PlatformAdminService } from './platform-admin.service';

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
    return { service: new PlatformAdminService(prisma, redis, audit), withElevated };
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
});
