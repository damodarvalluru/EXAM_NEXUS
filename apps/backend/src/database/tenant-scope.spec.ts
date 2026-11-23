import { createTenantScopeExtension, runInTenantScope } from './tenant-scope';

const allOperations = (createTenantScopeExtension().query.$allModels as any).$allOperations as (
  params: { model: string; operation: string; args: any; query: (args: any) => Promise<any> },
) => Promise<unknown>;

describe('tenant scoping extension', () => {
  it('adds the tenant predicate to reads and stamps writes', async () => {
    const query = jest.fn(async (args: any) => args);
    const tx = { candidate: { count: jest.fn(async () => 1) } };

    await runInTenantScope({ tenantId: 'tenant-1', elevated: false, tx }, async () => {
      await allOperations({ model: 'Candidate', operation: 'findMany', args: { where: { status: 'ACTIVE' } }, query });
      await allOperations({
        model: 'Candidate',
        operation: 'create',
        args: { data: { candidateCode: 'C1', firstName: 'A', lastName: 'B', email: 'a@b.c' } },
        query,
      });
    });

    expect(query.mock.calls[0][0]).toEqual({ where: { status: 'ACTIVE', tenantId: 'tenant-1' } });
    expect(query.mock.calls[1][0].data.tenantId).toBe('tenant-1');
  });

  it('verifies tenant ownership before a unique read', async () => {
    const query = jest.fn(async (args: any) => args);
    const count = jest.fn(async () => 0);
    const tx = { user: { count } };

    await runInTenantScope({ tenantId: 'tenant-1', elevated: false, tx }, async () => {
      const result = await allOperations({ model: 'User', operation: 'findUnique', args: { where: { id: 'u1' } }, query });
      expect(result).toBeNull();
    });

    expect(count).toHaveBeenCalledWith({ where: { id: 'u1', tenantId: 'tenant-1' } });
    expect(query).not.toHaveBeenCalled();
  });

  it('flattens compound unique keys before checking tenant ownership', async () => {
    const query = jest.fn(async (args: any) => args);
    const count = jest.fn(async () => 1);
    const tx = { examinationVersion: { count } };

    await runInTenantScope({ tenantId: 'tenant-1', elevated: false, tx }, async () => {
      await allOperations({
        model: 'ExaminationVersion',
        operation: 'findUnique',
        args: { where: { examinationId_version: { examinationId: 'exam-1', version: 1 } } },
        query,
      });
    });

    expect(count).toHaveBeenCalledWith({
      where: { examinationId: 'exam-1', version: 1, tenantId: 'tenant-1' },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails closed outside a tenant context and for platform-only models', async () => {
    const query = jest.fn(async (args: any) => args);

    await expect(
      allOperations({ model: 'Candidate', operation: 'findMany', args: {}, query }),
    ).rejects.toThrow('Tenant context is required');

    await runInTenantScope({ tenantId: 'tenant-1', elevated: false }, async () => {
      await expect(
        allOperations({ model: 'SuperAdminCredential', operation: 'findMany', args: {}, query }),
      ).rejects.toThrow('elevated context');
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('passes through elevated platform work', async () => {
    const query = jest.fn(async (args: any) => args);
    const args = { where: { component: 'api' } };

    await runInTenantScope({ tenantId: null, elevated: true }, async () => {
      await allOperations({ model: 'SystemHealthEvent', operation: 'findMany', args, query });
    });

    expect(query).toHaveBeenCalledWith(args);
  });

  it('stamps tenantId into nested create payloads at every depth', async () => {
    const query = jest.fn(async (args: any) => args);
    const tx = { examination: { count: jest.fn(async () => 1) } };

    await runInTenantScope({ tenantId: 'tenant-1', elevated: false, tx }, async () => {
      await allOperations({
        model: 'Examination',
        operation: 'create',
        args: {
          data: {
            title: 'Exam',
            address: { city: 'Nested JSON must not be stamped' },
            sections: {
              create: [
                {
                  title: 'Section 1',
                  questions: { create: [{ text: 'Q1' }, { text: 'Q2' }] },
                },
              ],
            },
          },
        },
        query,
      });
    });

    const data = query.mock.calls[0][0].data;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.address).toEqual({ city: 'Nested JSON must not be stamped' });
    expect(data.sections.create[0].tenantId).toBe('tenant-1');
    expect(data.sections.create[0].questions.create.map((row: any) => row.tenantId)).toEqual([
      'tenant-1',
      'tenant-1',
    ]);
  });

  it('preserves non-plain values such as Date in write payloads', async () => {
    const query = jest.fn(async (args: any) => args);
    const joinedAt = new Date('2026-01-01T00:00:00.000Z');

    await runInTenantScope({ tenantId: 'tenant-1', elevated: false }, async () => {
      await allOperations({
        model: 'OrganisationMembership',
        operation: 'create',
        args: { data: { userId: 'u1', joinedAt } },
        query,
      });
    });

    expect(query.mock.calls[0][0].data).toMatchObject({ tenantId: 'tenant-1', joinedAt });
    expect(query.mock.calls[0][0].data.joinedAt).toBeInstanceOf(Date);
  });

  it('stamps nested upsert and connectOrCreate payloads but leaves unique selectors intact', async () => {
    const query = jest.fn(async (args: any) => args);
    const tx = { examination: { count: jest.fn(async () => 1) } };
    const uniqueSelector = { examinationId_version: { examinationId: 'exam-1', version: 1 } };

    await runInTenantScope({ tenantId: 'tenant-1', elevated: false, tx }, async () => {
      await allOperations({
        model: 'Examination',
        operation: 'upsert',
        args: {
          where: { id: 'exam-1' },
          create: {
            title: 'Exam',
            versions: {
              connectOrCreate: {
                where: uniqueSelector,
                create: { version: 1, tenantId: 'tenant-1' },
              },
            },
          },
          update: {
            sections: {
              upsert: {
                where: { id: 'section-1' },
                create: { title: 'New section' },
                update: { title: 'Updated section' },
              },
            },
          },
        },
        query,
      });
    });

    const args = query.mock.calls[0][0];
    expect(args.create.tenantId).toBe('tenant-1');
    expect(args.create.versions.connectOrCreate.create.tenantId).toBe('tenant-1');
    expect(args.create.versions.connectOrCreate.where).toEqual(uniqueSelector);
    expect(args.update.tenantId).toBe('tenant-1');
    expect(args.update.sections.upsert.create.tenantId).toBe('tenant-1');
    expect(args.update.sections.upsert.update.tenantId).toBe('tenant-1');
    expect(tx.examination.count).toHaveBeenCalledWith({ where: { id: 'exam-1', tenantId: 'tenant-1' } });
  });

  it('rejects a nested create that tries to override the tenant id', async () => {
    const query = jest.fn(async (args: any) => args);

    await runInTenantScope({ tenantId: 'tenant-1', elevated: false }, async () => {
      await expect(
        allOperations({
          model: 'Examination',
          operation: 'create',
          args: {
            data: {
              title: 'Exam',
              sections: { create: { title: 'Escaped', tenantId: 'tenant-2' } },
            },
          },
          query,
        }),
      ).rejects.toThrow(/Cross-tenant tenantId/);
    });

    expect(query).not.toHaveBeenCalled();
  });
});
