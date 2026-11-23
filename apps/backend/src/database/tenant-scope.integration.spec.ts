import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

/**
 * Live tenant-isolation verification against the configured MySQL/TiDB Cloud
 * cluster. Opt-in because it writes and removes temporary organisations:
 *   RUN_DB_TESTS=1 pnpm --filter @examnexus/api test
 */
const describeLive = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeLive('tenant scoping (live database)', () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let examA: string;
  let examB: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for live tenant tests');
    const config = {
      getOrThrow: () => process.env.DATABASE_URL,
      get: () => 'test',
    } as unknown as ConfigService;
    prisma = new PrismaService(config);
    await prisma.onModuleInit();

    const suffix = randomUUID().slice(0, 8);
    tenantA = await prisma.withElevated((tx) =>
      tx.organisation.create({
        data: {
          name: 'Tenant isolation test A',
          slug: `scope-a-${suffix}`,
          officialEmail: `scope-a-${suffix}@example.invalid`,
          status: 'APPROVED',
        },
      }).then((row) => row.id),
    );
    tenantB = await prisma.withElevated((tx) =>
      tx.organisation.create({
        data: {
          name: 'Tenant isolation test B',
          slug: `scope-b-${suffix}`,
          officialEmail: `scope-b-${suffix}@example.invalid`,
          status: 'APPROVED',
        },
      }).then((row) => row.id),
    );
    examA = await prisma.withTenant(tenantA, (tx) =>
      tx.examination.create({
        data: { tenantId: tenantA, title: 'Scoped A', durationMinutes: 30, totalMarks: 10 },
      }).then((row) => row.id),
    );
    examB = await prisma.withTenant(tenantB, (tx) =>
      tx.examination.create({
        data: { tenantId: tenantB, title: 'Scoped B', durationMinutes: 30, totalMarks: 10 },
      }).then((row) => row.id),
    );
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.withElevated((tx) =>
        tx.organisation.deleteMany({ where: { id: { in: [tenantA, tenantB].filter(Boolean) } } }),
      );
      await prisma.onModuleDestroy();
    }
  }, 120_000);

  it('returns only rows belonging to the active tenant', async () => {
    const rows = await prisma.withTenant(tenantA, (tx) => tx.examination.findMany());
    expect(rows.map((row) => row.id)).toEqual([examA]);
    expect(rows.some((row) => row.id === examB)).toBe(false);
  });

  it('denies unique reads of another tenant\'s row', async () => {
    const foreign = await prisma.withTenant(tenantA, (tx) => tx.examination.findUnique({ where: { id: examB } }));
    expect(foreign).toBeNull();
  });

  it('rejects writes that try to override the tenant id', async () => {
    await expect(
      prisma.withTenant(tenantA, (tx) =>
        tx.examination.create({
          data: { tenantId: tenantB, title: 'Escaped', durationMinutes: 10, totalMarks: 5 },
        }),
      ),
    ).rejects.toThrow(/Cross-tenant tenantId/);
  });

  it('fails closed outside a tenant scope and allows explicit elevated reads', async () => {
    await expect(prisma.examination.findMany()).rejects.toThrow(/Tenant context is required/);
    const rows = await prisma.withElevated((tx) => tx.examination.findMany({ where: { id: { in: [examA, examB] } } }));
    expect(rows).toHaveLength(2);
  });
});
