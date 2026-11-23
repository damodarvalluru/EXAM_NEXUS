import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OrganisationsService } from './organisations.service';

const TENANT = 'tenant-1';

function buildService(root: string, overrides: Record<string, unknown> = {}) {
  const fileObject = {
    findFirst: jest.fn(async () => ({ mimeType: 'application/pdf' })),
  };
  const user = {
    findMany: jest.fn(async () => [{ email: 'member@example.invalid', username: 'member' }]),
    updateMany: jest.fn(async () => ({ count: 1 })),
    update: jest.fn(async () => ({ email: 'member@example.invalid', username: 'member' })),
  };
  const tx = {
    fileObject,
    user,
    organisationMembership: { findFirst: jest.fn(async () => ({ id: 'membership-1' })) },
  };
  const prisma = {
    withElevated: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
    withTenant: jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => work(tx)),
  };
  const redis = { client: { get: jest.fn(async () => null), del: jest.fn(async () => 1) } };
  const crypto = {
    sha256: jest.fn(() => 'hashed-token'),
    hashSecret: jest.fn(async () => 'hash'),
  };
  const config = { getOrThrow: jest.fn(() => root), get: jest.fn() };
  const rateLimit = { clearUserFailures: jest.fn(async () => undefined) };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new OrganisationsService(
    prisma as never,
    redis as never,
    crypto as never,
    audit as never,
    {} as never,
    config as never,
    rateLimit as never,
  );
  Object.assign(service, overrides);
  return { service, prisma, redis, crypto, config, rateLimit, fileObject, user, tx };
}

const request = {} as never;
const principal = { userId: 'admin-1' } as never;

describe('OrganisationsService.readDocument legacy keys', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'examnexus-docs-'));
    await mkdir(join(root, TENANT), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function putFile(name: string) {
    await writeFile(join(root, TENANT, name), Buffer.from('legacy-document'));
  }

  it('downloads a historical <type>/<uuid> key from its flattened filename', async () => {
    const uuid = randomUUID();
    await putFile(`REGISTRATION_${uuid}`);
    const { service } = buildService(root);

    const result = await service.readDocument(TENANT, TENANT, `REGISTRATION/${uuid}`);

    expect(result.bytes.toString()).toBe('legacy-document');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.fileName).toBe(uuid);
  });

  it('downloads a legacy verification/<uuid> key', async () => {
    const uuid = randomUUID();
    await putFile(`verification_${uuid}`);
    const { service } = buildService(root);

    await expect(service.readDocument(TENANT, TENANT, `verification/${uuid}`))
      .resolves.toMatchObject({ fileName: uuid, mimeType: 'application/pdf' });
  });

  it('keeps current single-segment keys working', async () => {
    const uuid = randomUUID();
    await putFile(`ID_PROOF_${uuid}`);
    const { service } = buildService(root);

    await expect(service.readDocument(TENANT, TENANT, `ID_PROOF_${uuid}`))
      .resolves.toMatchObject({ fileName: uuid });
  });

  it.each([
    ['unknown prefix', 'unknown/document'],
    ['parent traversal', 'REGISTRATION/../../secret'],
    ['embedded traversal', 'REGISTRATION/a/../secret'],
    ['absolute path', '/etc/passwd'],
    ['drive path', 'C:secret'],
    ['UNC path', '\\\\server\\share'],
    ['backslash', 'REGISTRATION\\secret'],
    ['null byte', 'REGISTRATION/\0secret'],
    ['nested key', 'REGISTRATION/one/two'],
  ])('rejects %s', async (_label, key) => {
    const { service, fileObject } = buildService(root);

    await expect(service.readDocument(TENANT, TENANT, key)).rejects.toBeInstanceOf(BadRequestException);
    expect(fileObject.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a resolved path that escapes the storage root', async () => {
    const { service } = buildService(root);

    await expect(service.readDocument(null, '..', 'REGISTRATION_secret'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects cross-tenant access before touching storage', async () => {
    const { service, fileObject } = buildService(root);

    await expect(service.readDocument('tenant-2', TENANT, `REGISTRATION/${randomUUID()}`))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(fileObject.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an empty key', async () => {
    const { service, fileObject } = buildService(root);

    await expect(service.readDocument(TENANT, TENANT, '')).rejects.toBeInstanceOf(BadRequestException);
    expect(fileObject.findFirst).not.toHaveBeenCalled();
  });

  it('still returns not found for an unregistered legacy key', async () => {
    const { service, fileObject } = buildService(root);
    fileObject.findFirst.mockResolvedValueOnce(null as never);

    await expect(service.readDocument(TENANT, TENANT, `REGISTRATION/${randomUUID()}`))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrganisationsService reactivation', () => {
  it('clears Redis lockout counters for a tenant member reactivated to ACTIVE', async () => {
    const { service, rateLimit, user } = buildService('/unused');

    await expect(service.updateUserStatus(TENANT, 'user-1', { status: 'ACTIVE' }, principal, request))
      .resolves.toEqual({ success: true });

    expect(user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1', tenantId: TENANT },
      data: expect.objectContaining({ status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null }),
    }));
    expect(rateLimit.clearUserFailures).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'member@example.invalid',
      username: 'member',
    });
  });

  it('does not clear lockout counters when suspending a member', async () => {
    const { service, rateLimit } = buildService('/unused');

    await service.updateUserStatus(TENANT, 'user-1', { status: 'SUSPENDED' }, principal, request);

    expect(rateLimit.clearUserFailures).not.toHaveBeenCalled();
  });

  it('clears lockout counters when an invitation is accepted', async () => {
    const { service, redis, rateLimit } = buildService('/unused');
    redis.client.get.mockResolvedValueOnce(JSON.stringify({ userId: 'user-1', tenantId: TENANT }) as never);

    await expect(service.acceptInvitation({ token: 'token', password: 'a-very-long-password' }))
      .resolves.toEqual({ success: true });

    expect(rateLimit.clearUserFailures).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'member@example.invalid',
      username: 'member',
    });
  });

  it('does not fail reactivation when the Redis-backed lockout service is unavailable', async () => {
    const { service } = buildService('/unused');
    Object.assign(service, { rateLimit: undefined });

    await expect(service.updateUserStatus(TENANT, 'user-1', { status: 'ACTIVE' }, principal, request))
      .resolves.toEqual({ success: true });
  });

  it('clears lockout counters for pending members when an organisation is reactivated', async () => {
    const organisation = {
      id: TENANT,
      name: 'Test Org',
      slug: 'test-org',
      registrationNumber: null,
      officialEmail: 'office@example.invalid',
      contactPhone: null,
      website: null,
      logoKey: null,
      primaryColour: null,
      address: null,
      status: 'SUSPENDED',
      verificationSubmittedAt: null,
      approvedAt: null,
      suspendedAt: new Date(),
      createdAt: new Date(),
      verifications: [],
    };
    const reactivated = [{ id: 'user-1', email: 'member@example.invalid', username: 'member' }];
    const tx = {
      organisation: {
        findFirst: jest.fn(async () => organisation),
        update: jest.fn(async () => ({})),
      },
      organisationVerification: { create: jest.fn(async () => ({})) },
      organisationMembership: { count: jest.fn(async () => 0) },
      candidate: { count: jest.fn(async () => 0) },
      examination: { count: jest.fn(async () => 0) },
      integration: { count: jest.fn(async () => 0) },
      notification: { create: jest.fn(async () => ({})) },
      userSession: { updateMany: jest.fn(async () => ({ count: 0 })) },
      user: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => reactivated),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      withElevated: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
    };
    const rateLimit = { clearUserFailures: jest.fn(async () => undefined) };
    const service = new OrganisationsService(
      prisma as never,
      {} as never,
      {} as never,
      { record: jest.fn(async () => undefined) } as never,
      {} as never,
      { getOrThrow: jest.fn(), get: jest.fn() } as never,
      rateLimit as never,
    );

    await service.review(TENANT, { decision: 'REACTIVATE' }, principal, request);

    expect(tx.user.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, status: 'PENDING_VERIFICATION' },
      select: { id: true, email: true, username: true },
    });
    expect(rateLimit.clearUserFailures).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'member@example.invalid',
      username: 'member',
    });
  });
});
