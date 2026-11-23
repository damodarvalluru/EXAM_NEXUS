import type { CryptoService } from '../../common/crypto/crypto.service';
import type { AuditService } from '../../common/services/audit.service';
import type { PrismaService } from '../../database/prisma.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { AdminService } from './admin.service';

describe('AdminService.updateUserStatus', () => {
  function buildService(previousStatus: string) {
    const update = jest.fn().mockResolvedValue({ id: 'user-1' });
    const revokeSessions = jest.fn().mockResolvedValue({ count: 0 });
    const withElevated = jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => {
      if (withElevated.mock.calls.length === 1) {
        return { id: 'user-1', tenantId: 'tenant-1', status: previousStatus };
      }
      return work({ user: { update }, userSession: { updateMany: revokeSessions } });
    });
    const prisma = { withElevated } as unknown as PrismaService;
    const audit = { record: jest.fn() } as unknown as AuditService;
    const rateLimit = { clearUserFailures: jest.fn(async () => undefined) };
    const service = new AdminService(prisma, {} as CryptoService, audit, rateLimit as never);
    return { service, update, revokeSessions, rateLimit };
  }

  const principal = { userId: 'admin-1', email: 'admin@example.com' } as RequestWithContext['principal'];

  it('clears failed-login lockout state when reactivating an account', async () => {
    const { service, update, revokeSessions, rateLimit } = buildService('LOCKED');

    await expect(service.updateUserStatus('user-1', 'ACTIVE', principal, {} as RequestWithContext))
      .resolves.toEqual({ success: true });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: expect.objectContaining({ status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null }),
    }));
    expect(rateLimit.clearUserFailures).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
    expect(revokeSessions).not.toHaveBeenCalled();
  });

  it('keeps lockout state intact when locking an account', async () => {
    const { service, update, revokeSessions, rateLimit } = buildService('ACTIVE');

    await service.updateUserStatus('user-1', 'LOCKED', principal, {} as RequestWithContext);

    const data = update.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data).toEqual({ status: 'LOCKED' });
    expect(revokeSessions).toHaveBeenCalledTimes(1);
    expect(rateLimit.clearUserFailures).not.toHaveBeenCalled();
  });

  it('still reactivates when the Redis-backed lockout service is unavailable', async () => {
    const { service, update } = buildService('LOCKED');
    Object.assign(service, { rateLimit: undefined });

    await expect(service.updateUserStatus('user-1', 'ACTIVE', principal, {} as RequestWithContext))
      .resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalled();
  });
});
