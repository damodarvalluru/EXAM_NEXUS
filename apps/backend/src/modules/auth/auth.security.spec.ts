import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PERMISSIONS } from '@examnexus/shared';
import { AuthService } from './auth.service';
import { AUDITOR_PERMISSIONS, permissionsForGlobalRole } from './principal.service';
import {
  STEP_UP_TTL_SECONDS,
  TokenService,
  freshStepUpAt,
  latestValidStepUp,
  stepUpSessionKey,
} from './token.service';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      getdel: jest.fn(async (key: string) => {
        const value = store.get(key) ?? null;
        store.delete(key);
        return value;
      }),
      del: jest.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
      incr: jest.fn(async () => 1),
      expire: jest.fn(async () => 1),
    },
  };
}

function authFixture(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 'user-1',
    email: 'admin@example.invalid',
    username: null,
    status: 'ACTIVE',
    globalRole: 'SUPER_ADMIN',
    tenantId: null,
    passwordHash: 'password-hash',
    lockedUntil: null,
    failedLoginCount: 0,
    lastLoginIp: null,
    profile: null,
    mfaMethods: [],
    memberships: [],
    recoveryCodes: [],
    superAdminPin: {
      userId: 'user-1',
      pinHash: 'pin-hash',
      failedAttempts: 0,
      lockedUntil: null,
      rotationRequired: false,
    },
    ...overrides,
  };
  const tx = {
    user: {
      findFirst: jest.fn(async () => user),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...user, ...data })),
      count: jest.fn(async () => 0),
    },
    superAdminCredential: { update: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
    securityAlert: { create: jest.fn(async () => ({})) },
    userRole: { findMany: jest.fn(async () => []) },
  };
  const prisma = {
    withElevated: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
  };
  const redis = fakeRedis();
  const crypto = {
    hashSecret: jest.fn(async () => 'hash'),
    verifySecret: jest.fn(async () => true),
    decrypt: jest.fn(() => 'secret'),
    sha256: jest.fn(() => 'sha'),
    safeEqual: jest.fn(() => true),
    randomToken: jest.fn(() => 'token'),
  };
  const tokens = {
    signAccess: jest.fn(() => 'access-token'),
    signChallenge: jest.fn(async () => 'challenge-token'),
    verifyChallenge: jest.fn(async () => ({ sub: 'user-1', tid: null, am: 'PASSWORD', jti: 'jti' })),
    readStepUpFromAccess: jest.fn(async () => null),
  };
  const rateLimit = {
    consume: jest.fn(async () => undefined),
    recordFailure: jest.fn(async () => 1),
    clearFailures: jest.fn(async () => undefined),
    clearUserFailures: jest.fn(async () => undefined),
  };
  const request = { ip: '127.0.0.1', header: jest.fn(() => undefined), principal: undefined };
  const service = new AuthService(
    prisma as never,
    redis as never,
    crypto as never,
    {} as never,
    tokens as never,
    {} as never,
    rateLimit as never,
    { record: jest.fn(async () => undefined) } as never,
    { record: jest.fn(async () => undefined) } as never,
    { get: jest.fn() } as never,
  );
  return { service, user, tx, redis, crypto, tokens, rateLimit, request };
}

const internals = (service: AuthService) =>
  service as unknown as {
    expireLock: (user: unknown) => Promise<{ status: string; lockedUntil: Date | null }>;
    isLocked: (user: unknown) => boolean;
  };

describe('MFA challenge replay protection', () => {
  it('consumes a challenge on first verification and rejects a second use', async () => {
    const redis = fakeRedis();
    const config = { getOrThrow: jest.fn(() => 'test-secret') } as unknown as ConfigService;
    const tokens = new TokenService(new JwtService({}), config, redis as never);

    const token = await tokens.signChallenge('user-1', 'PASSWORD', null);
    const payload = await tokens.verifyChallenge(token);

    expect(payload.sub).toBe('user-1');
    expect(redis.client.getdel).toHaveBeenCalledTimes(1);
    await expect(tokens.verifyChallenge(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.client.getdel).toHaveBeenCalledTimes(2);
  });
});

describe('global role permissions', () => {
  it('gives auditors read-only platform access and staff scoped management', () => {
    expect(permissionsForGlobalRole('SUPER_ADMIN')).toEqual(['*']);
    expect(permissionsForGlobalRole('AUDITOR')).toEqual(AUDITOR_PERMISSIONS);
    expect(permissionsForGlobalRole('AUDITOR')).not.toContain(PERMISSIONS.PLATFORM_USERS_MANAGE);
    expect(permissionsForGlobalRole('PLATFORM_STAFF')).toContain(PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE);
    expect(permissionsForGlobalRole('PLATFORM_STAFF')).not.toContain(PERMISSIONS.PLATFORM_CONFIGURATION_MANAGE);
  });
});

describe('step-up replay window', () => {
  const now = new Date().toISOString();

  it('accepts fresh proofs and rejects stale ones', () => {
    expect(freshStepUpAt(now)).toBe(now);
    expect(freshStepUpAt(null)).toBeNull();
    expect(freshStepUpAt(new Date(Date.now() - (STEP_UP_TTL_SECONDS + 1) * 1000).toISOString())).toBeNull();
    expect(latestValidStepUp(undefined, now)).toBe(now);
  });
});

describe('time-bounded failed-login lockout', () => {
  it('ignores deadlines that have passed and reactivates the account', async () => {
    const { service, tx, rateLimit } = authFixture({
      status: 'LOCKED',
      lockedUntil: new Date(Date.now() - 60_000),
      failedLoginCount: 5,
    });
    const lockedUser = await tx.user.findFirst();
    expect(internals(service).isLocked(lockedUser)).toBe(false);

    const restored = await internals(service).expireLock(lockedUser);
    expect(restored.status).toBe('ACTIVE');
    expect(restored.lockedUntil).toBeNull();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', failedLoginCount: 0 }) }),
    );
    expect(rateLimit.clearUserFailures).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', email: 'admin@example.invalid' }),
    );
  });

  it('still locks while the deadline is in the future', async () => {
    const { service, tx } = authFixture({
      status: 'LOCKED',
      lockedUntil: new Date(Date.now() + 60_000),
    });
    expect(internals(service).isLocked(await tx.user.findFirst())).toBe(true);
  });
});

describe('step-up authorisation', () => {
  it('refuses step-up while the Super Admin PIN is locked', async () => {
    const { service, crypto, rateLimit, request } = authFixture({
      superAdminPin: {
        userId: 'user-1',
        pinHash: 'pin-hash',
        failedAttempts: 5,
        lockedUntil: new Date(Date.now() + 60_000),
        rotationRequired: false,
      },
    });
    await expect(
      service.stepUp({ pin: '0123456789ab' }, { userId: 'user-1', tenantId: null, sessionId: 'session-1', authMethod: 'PASSWORD' }, request as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(crypto.verifySecret).not.toHaveBeenCalled();
    expect(rateLimit.recordFailure).toHaveBeenCalled();
  });

  it('refuses step-up for an inactive account before checking the proof', async () => {
    const { service, crypto, request } = authFixture({ status: 'SUSPENDED' });
    await expect(
      service.stepUp({ password: 'correct-password' }, { userId: 'user-1', tenantId: null, sessionId: 'session-1', authMethod: 'PASSWORD' }, request as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(crypto.verifySecret).not.toHaveBeenCalled();
  });

  it('binds successful step-up proof to the session until its expiry', async () => {
    const { service, redis, tokens, request } = authFixture();
    const result = await service.stepUp(
      { password: 'correct-password' },
      { userId: 'user-1', tenantId: null, sessionId: 'session-1', authMethod: 'PASSWORD' },
      request as never,
    );
    expect(redis.client.set).toHaveBeenCalledWith(
      stepUpSessionKey('session-1'),
      result.stepUpVerifiedAt,
      'EX',
      STEP_UP_TTL_SECONDS,
    );
    expect(tokens.signAccess).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: result.stepUpVerifiedAt }),
      STEP_UP_TTL_SECONDS,
    );
  });
});

describe('email verification', () => {
  it('cannot reactivate a suspended account', async () => {
    const { service, tx, redis } = authFixture({ status: 'SUSPENDED' });
    const config = { getOrThrow: jest.fn(() => 'test-secret') } as unknown as ConfigService;
    const crypto = { sha256: jest.fn(() => 'hashed-token') } as never;
    Object.assign(service, { config, crypto });
    redis.client.get.mockResolvedValueOnce(JSON.stringify({ userId: 'user-1', tenantId: null }));

    await expect(service.verifyEmail('token')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(redis.client.del).not.toHaveBeenCalled();
  });

  it('activates an account that is pending verification', async () => {
    const { service, tx, redis } = authFixture({ status: 'PENDING_VERIFICATION' });
    const config = { getOrThrow: jest.fn(() => 'test-secret') } as unknown as ConfigService;
    const crypto = { sha256: jest.fn(() => 'hashed-token') } as never;
    Object.assign(service, { config, crypto });
    redis.client.get.mockResolvedValueOnce(JSON.stringify({ userId: 'user-1', tenantId: null }));

    await expect(service.verifyEmail('token')).resolves.toEqual({ verified: true });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
    expect(redis.client.del).toHaveBeenCalledWith('emailverify:hashed-token');
  });
});
