import { AuditService } from './audit.service';
import { runInTenantScope } from '../../database/tenant-scope';

describe('AuditService transaction reuse', () => {
  it('writes through an active scoped transaction instead of opening a nested one', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = { auditLog: { create } } as never;
    const withElevated = jest.fn();
    const service = new AuditService({ withElevated } as never);

    await runInTenantScope({ tenantId: 'tenant-1', elevated: false, tx }, () =>
      service.record({
        tenantId: 'tenant-1',
        action: 'test.action',
        resourceType: 'test',
        resourceId: 'resource-1',
      }),
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'test.action', tenantId: 'tenant-1' }),
    }));
    expect(withElevated).not.toHaveBeenCalled();
  });

  it('uses an elevated transaction when no scope is active', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-2' });
    const withElevated = jest.fn(async (work: (tx: never) => Promise<unknown>) => work({ auditLog: { create } } as never));
    const service = new AuditService({ withElevated } as never);

    await service.record({ action: 'test.platform', resourceType: 'test' });

    expect(withElevated).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
