import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { createStorageAdapter, getStorageAdapter } from './storage.factory';
import { assertSafeStorageSegment } from './storage-key';

const TENANT = 'tenant-1';

function mockConfig(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (value === undefined || value === null) throw new Error(`Missing config: ${key}`);
      return value;
    }),
  } as unknown as ConfigService;
}

describe('LocalStorageAdapter', () => {
  let root: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'examnexus-storage-'));
    adapter = new LocalStorageAdapter(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores and reads an object under <root>/<tenant>/<fileName>', async () => {
    const fileName = `REGISTRATION_${randomUUID()}`;
    const bytes = Buffer.from('registration-document');

    await adapter.put(TENANT, fileName, bytes);

    await expect(readFile(join(root, TENANT, fileName))).resolves.toEqual(bytes);
    await expect(adapter.get(TENANT, fileName)).resolves.toEqual(bytes);
  });

  it('accepts the flattened filename used for legacy slash-form keys', async () => {
    const uuid = randomUUID();
    const bytes = Buffer.from('legacy-document');
    await adapter.put(TENANT, `verification_${uuid}`, bytes);

    await expect(adapter.get(TENANT, `verification_${uuid}`)).resolves.toEqual(bytes);
    await expect(adapter.get(TENANT, `verification/${uuid}`)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes only the requested tenant object', async () => {
    const fileName = `ID_PROOF_${randomUUID()}`;
    await adapter.put(TENANT, fileName, Buffer.from('one'));
    await adapter.put('tenant-2', fileName, Buffer.from('two'));

    await adapter.delete(TENANT, fileName);

    await expect(adapter.get(TENANT, fileName)).rejects.toThrow();
    await expect(adapter.get('tenant-2', fileName)).resolves.toEqual(Buffer.from('two'));
  });

  it('reports the configured root in its readiness check', async () => {
    await expect(adapter.check()).resolves.toEqual({ status: 'up', adapter: 'local', path: root });
  });

  it('reports down when the root is missing', async () => {
    await rm(root, { recursive: true, force: true });
    await expect(adapter.check()).resolves.toEqual({ status: 'down', adapter: 'local', path: root });
  });

  it('reports down when the root is a file', async () => {
    const filePath = join(tmpdir(), `examnexus-storage-file-${randomUUID()}`);
    await writeFile(filePath, 'not-a-directory');
    try {
      await expect(new LocalStorageAdapter(filePath).check())
        .resolves.toMatchObject({ status: 'down', adapter: 'local' });
    } finally {
      await rm(filePath, { force: true });
    }
  });

  it.each([
    ['parent traversal', '..'],
    ['slash', 'REGISTRATION/secret'],
    ['backslash', 'REGISTRATION\\secret'],
    ['absolute path', '/etc/passwd'],
    ['drive path', 'C:secret'],
    ['null byte', 'REGISTRATION\0secret'],
    ['empty', ''],
  ])('rejects unsafe filename (%s)', async (_label, fileName) => {
    await expect(adapter.put(TENANT, fileName, Buffer.from('x'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(adapter.get(TENANT, fileName)).rejects.toBeInstanceOf(BadRequestException);
    await expect(adapter.delete(TENANT, fileName)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['..', 'tenant/other', 'tenant\\other', ''])(
    'rejects unsafe tenant id %p',
    async (tenantId) => {
      await expect(adapter.put(tenantId, 'ID_PROOF_1', Buffer.from('x'))).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('exposes the legacy local bucket identifier', () => {
    expect(adapter.name).toBe('local');
    expect(adapter.bucket).toBe('local');
  });
});

describe('storage key validation', () => {
  it.each(['..', '.', 'a/b', 'a\\b', 'a..b', 'C:secret', 'a\0b', ''])('rejects %p', (value) => {
    expect(() => assertSafeStorageSegment(value)).toThrow(BadRequestException);
  });

  it('accepts a generated document filename', () => {
    expect(() => assertSafeStorageSegment(`ID_PROOF_${randomUUID()}`)).not.toThrow();
  });
});

describe('storage driver selection', () => {
  it('defaults to local when no driver is configured', () => {
    const adapter = createStorageAdapter(mockConfig({ 'storage.localPath': '/tmp/examnexus' }));

    expect(adapter).toBeInstanceOf(LocalStorageAdapter);
    expect(adapter.name).toBe('local');
    expect(adapter.bucket).toBe('local');
  });

  it('selects the local adapter explicitly', () => {
    const adapter = createStorageAdapter(mockConfig({
      'storage.driver': 'local',
      'storage.localPath': '/tmp/examnexus',
    }));

    expect(adapter).toBeInstanceOf(LocalStorageAdapter);
  });

  it('selects an S3-compatible adapter with the configured bucket', () => {
    const adapter = createStorageAdapter(mockConfig({
      'storage.driver': 's3',
      'storage.endpoint': 'http://localhost:9000',
      'storage.region': 'us-east-1',
      'storage.bucket': 'examnexus',
      'storage.accessKeyId': 'access',
      'storage.secretAccessKey': 'secret',
      'storage.forcePathStyle': true,
    }));

    expect(adapter).toBeInstanceOf(S3StorageAdapter);
    expect(adapter.name).toBe('s3');
    expect(adapter.bucket).toBe('examnexus');
  });

  it('rejects an unsupported driver', () => {
    expect(() => createStorageAdapter(mockConfig({ 'storage.driver': 'gcs' }))).toThrow(/Unsupported storage driver/);
  });

  it('memoizes an adapter per ConfigService instance', () => {
    const config = mockConfig({ 'storage.driver': 'local', 'storage.localPath': '/tmp/examnexus' });

    expect(getStorageAdapter(config)).toBe(getStorageAdapter(config));
  });

  it('reuses the local root for a readiness check', async () => {
    const root = await mkdtemp(join(tmpdir(), 'examnexus-storage-'));
    try {
      const adapter = getStorageAdapter(mockConfig({ 'storage.driver': 'local', 'storage.localPath': root }));
      await expect(adapter.check()).resolves.toMatchObject({ status: 'up', adapter: 'local' });
      expect(await stat(root)).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
