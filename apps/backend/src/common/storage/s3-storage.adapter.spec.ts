import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { S3StorageAdapter, type S3StorageOptions } from './s3-storage.adapter';

const TENANT = 'tenant-1';
const BUCKET = 'examnexus';

function options(overrides: Partial<S3StorageOptions> = {}): S3StorageOptions {
  return {
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: BUCKET,
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    forcePathStyle: true,
    ...overrides,
  };
}

describe('S3StorageAdapter', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function lastRequest(): { url: URL; method: string; headers: Record<string, string> } {
    const call = fetchMock.mock.calls.at(-1);
    if (!call) throw new Error('fetch was not called');
    const [input, init] = call as [string | URL, RequestInit];
    return {
      url: new URL(typeof input === 'string' ? input : input.toString()),
      method: init.method ?? '',
      headers: init.headers as Record<string, string>,
    };
  }

  it('PUTs a path-style object key with SigV4 headers', async () => {
    const bytes = Buffer.from('document');
    await new S3StorageAdapter(options()).put(TENANT, 'ID_PROOF_1', bytes);

    const { url, method, headers } = lastRequest();
    expect(url.toString()).toBe(`http://localhost:9000/${BUCKET}/${TENANT}/ID_PROOF_1`);
    expect(method).toBe('PUT');
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers['x-amz-content-sha256']).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=access-key\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('GETs the object and returns the response bytes', async () => {
    fetchMock.mockResolvedValueOnce(new Response(Buffer.from('stored-document'), { status: 200 }));

    const bytes = await new S3StorageAdapter(options()).get(TENANT, 'REGISTRATION_1');

    expect(bytes.toString()).toBe('stored-document');
    const request = lastRequest();
    expect(request.method).toBe('GET');
    expect(request.url.toString()).toBe(`http://localhost:9000/${BUCKET}/${TENANT}/REGISTRATION_1`);
  });

  it('DELETEs an object and treats a missing object as success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const adapter = new S3StorageAdapter(options());

    await expect(adapter.delete(TENANT, 'ADDITIONAL_1')).resolves.toBeUndefined();

    const request = lastRequest();
    expect(request.method).toBe('DELETE');
    expect(request.url.toString()).toBe(`http://localhost:9000/${BUCKET}/${TENANT}/ADDITIONAL_1`);
  });

  it('HEADs the configured bucket for readiness', async () => {
    const adapter = new S3StorageAdapter(options());

    await expect(adapter.check()).resolves.toEqual({
      status: 'up',
      adapter: 's3',
      bucket: BUCKET,
      endpoint: 'http://localhost:9000',
    });
    const request = lastRequest();
    expect(request.method).toBe('HEAD');
    expect(request.url.toString()).toBe(`http://localhost:9000/${BUCKET}`);
  });

  it('reports down when the bucket probe fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(new S3StorageAdapter(options()).check()).resolves.toMatchObject({
      status: 'down',
      adapter: 's3',
      bucket: BUCKET,
    });
  });

  it('uses a virtual-hosted bucket when path-style is disabled', async () => {
    await new S3StorageAdapter(options({ forcePathStyle: false })).put(TENANT, 'ID_PROOF_1', Buffer.from('x'));

    const { url, headers } = lastRequest();
    expect(url.toString()).toBe(`http://${BUCKET}.localhost:9000/${TENANT}/ID_PROOF_1`);
    expect(headers.host).toBe(`${BUCKET}.localhost:9000`);
  });

  it('uses the regional AWS endpoint when no endpoint is configured', async () => {
    await new S3StorageAdapter(options({
      endpoint: '',
      forcePathStyle: false,
      region: 'eu-west-1',
    })).put(TENANT, 'ID_PROOF_1', Buffer.from('x'));

    expect(lastRequest().url.toString()).toBe(
      `https://${BUCKET}.s3.eu-west-1.amazonaws.com/${TENANT}/ID_PROOF_1`,
    );
  });

  it('rejects unsafe tenant and file segments before signing', async () => {
    const adapter = new S3StorageAdapter(options());

    await expect(adapter.put('..', 'ID_PROOF_1', Buffer.from('x'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(adapter.get(TENANT, 'REGISTRATION/secret')).rejects.toBeInstanceOf(BadRequestException);
    await expect(adapter.delete(TENANT, '')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a bucket and credentials', () => {
    expect(() => new S3StorageAdapter(options({ bucket: '' }))).toThrow(/storage\.bucket/);
    expect(() => new S3StorageAdapter(options({ accessKeyId: '' }))).toThrow(/storage\.accessKeyId/);
    expect(() => new S3StorageAdapter(options({ secretAccessKey: '' }))).toThrow(/storage\.secretAccessKey/);
  });
});
