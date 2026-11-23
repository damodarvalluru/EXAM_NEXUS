import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { PrismaService } from '../../database/prisma.service';
import { ApiKeyGuard } from './api-key.guard';
import type { ApiManagementService } from './api-management.service';

describe('scoped API credentials guard', () => {
  const client = {
    id: 'client-row',
    clientId: 'enx_c_example',
    tenantId: 'tenant-1',
    status: 'ACTIVE',
    revokedAt: null,
    createdBy: 'user-1',
    secretHash: 'hash:enx_s_secret',
  };

  let requiredScopes: string[];
  let apiKeyFindFirst: jest.Mock;
  let apiClientFindUnique: jest.Mock;
  let touchKey: jest.Mock;
  let guard: ApiKeyGuard;
  let request: {
    header: jest.Mock;
    headers: Record<string, string>;
    body: unknown;
    tenantId?: string;
    principal?: { permissions: string[] };
  };

  function context(): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    requiredScopes = ['candidates:write'];
    apiKeyFindFirst = jest.fn();
    apiClientFindUnique = jest.fn();
    touchKey = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      withElevated: jest.fn().mockImplementation((work) => work({
        apiKey: { findFirst: apiKeyFindFirst },
        apiClient: { findUnique: apiClientFindUnique },
      })),
    } as unknown as PrismaService;
    const crypto = {
      sha256: (value: string) => `hash:${value}`,
      safeEqual: (left: string, right: string) => left === right,
    } as unknown as CryptoService;
    const reflector = {
      getAllAndOverride: jest.fn().mockImplementation(() => requiredScopes),
    } as unknown as Reflector;
    guard = new ApiKeyGuard(reflector, prisma, crypto, { touchKey } as unknown as ApiManagementService);
    const req = { header: jest.fn(), headers: {} as Record<string, string>, body: {} as unknown };
    req.header.mockImplementation((name: string) => req.headers[name.toLowerCase()]);
    request = req;
  });

  it('accepts client credentials with a scope granted by an active key', async () => {
    apiClientFindUnique.mockResolvedValue({
      ...client,
      keys: [{ scopes: ['candidates:read', 'candidates:write'], expiresAt: null, revokedAt: null }],
    });
    request.headers.authorization = `Basic ${Buffer.from('enx_c_example:enx_s_secret').toString('base64')}`;

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(request.tenantId).toBe('tenant-1');
    expect(request.principal?.permissions).toEqual(['candidates:read', 'candidates:write']);
    expect(touchKey).not.toHaveBeenCalled();
  });

  it('rejects client credentials without the required scope', async () => {
    apiClientFindUnique.mockResolvedValue({
      ...client,
      keys: [{ scopes: ['candidates:read'], expiresAt: null, revokedAt: null }],
    });
    request.body = { clientId: client.clientId, clientSecret: 'enx_s_secret' };

    await expect(guard.canActivate(context())).rejects.toThrow(UnauthorizedException);
  });

  it('keeps the x-api-key path working', async () => {
    const token = `enx_k_${'x'.repeat(30)}`;
    apiKeyFindFirst.mockResolvedValue({
      id: 'key-1',
      secretHash: `hash:${token}`,
      scopes: ['candidates:write'],
      expiresAt: null,
      revokedAt: null,
      client,
    });
    request.header.mockImplementation((name: string) => name === 'x-api-key' ? token : undefined);

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(request.tenantId).toBe('tenant-1');
    expect(touchKey).toHaveBeenCalledWith('key-1');
  });
});
