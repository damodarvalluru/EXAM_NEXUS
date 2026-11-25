import { createHash, createHmac } from 'node:crypto';
import { assertSafeStorageSegment } from './storage-key';
import type { StorageAdapter, StorageHealth } from './storage.types';

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const EMPTY_BODY = Buffer.alloc(0);
const AWS_SERVICE = 's3';

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

/** RFC 3986 encoding required by SigV4 (encodeURIComponent leaves !'()* alone). */
function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function assertOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  const detail = await response.text().catch(() => '');
  throw new Error(`S3 ${action} failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ''}`);
}

/**
 * S3-compatible implementation using Node 20+ fetch and SigV4 signing. Works
 * with AWS S3 and MinIO; path-style is used for MinIO by default.
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3' as const;
  readonly bucket: string;

  private readonly region: string;
  private readonly endpoint: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly forcePathStyle: boolean;

  constructor(options: S3StorageOptions) {
    if (!options.bucket) throw new Error('storage.bucket is required when storage.driver is s3');
    if (!options.accessKeyId || !options.secretAccessKey) {
      throw new Error('storage.accessKeyId and storage.secretAccessKey are required when storage.driver is s3');
    }
    this.bucket = options.bucket;
    this.region = options.region || 'us-east-1';
    this.endpoint = options.endpoint;
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.forcePathStyle = options.forcePathStyle;
  }

  private requestUrl(segments: readonly string[]): URL {
    const url = this.endpoint
      ? new URL(this.endpoint)
      : new URL(`https://s3.${this.region}.amazonaws.com`);
    url.search = '';
    url.hash = '';
    url.username = '';
    url.password = '';
    if (!this.forcePathStyle) url.hostname = `${this.bucket}.${url.hostname}`;

    const encoded = [
      ...(this.forcePathStyle ? [this.bucket] : []),
      ...segments,
    ].map(encodeURIComponent).join('/');
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = encoded ? `${prefix}/${encoded}` : `${prefix}/`;
    return url;
  }

  /** Build the signed headers for a single request, including its payload hash. */
  private sign(method: string, url: URL, body: Buffer): Record<string, string> {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const signedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
    const canonicalQuery = [...url.searchParams.entries()]
      .map(([name, value]) => `${encodeQueryComponent(name)}=${encodeQueryComponent(value)}`)
      .sort()
      .join('&');
    const scope = `${date}/${this.region}/${AWS_SERVICE}/aws4_request`;
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders.join(';'),
      payloadHash,
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const dateKey = hmac(`AWS4${this.secretAccessKey}`, date);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, AWS_SERVICE);
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = hmac(signingKey, stringToSign).toString('hex');

    return {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, `
        + `SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
    };
  }

  private async send(
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
    segments: readonly string[],
    body: Buffer = EMPTY_BODY,
  ): Promise<Response> {
    const url = this.requestUrl(segments);
    return fetch(url, {
      method,
      headers: this.sign(method, url, body),
      ...(method === 'PUT' ? { body, duplex: 'half' as const } : {}),
    });
  }

  private objectSegments(tenantId: string, fileName: string): [string, string] {
    assertSafeStorageSegment(tenantId);
    assertSafeStorageSegment(fileName);
    return [tenantId, fileName];
  }

  async put(tenantId: string, fileName: string, bytes: Buffer): Promise<void> {
    await assertOk(await this.send('PUT', this.objectSegments(tenantId, fileName), bytes), 'put');
  }

  async get(tenantId: string, fileName: string): Promise<Buffer> {
    const response = await this.send('GET', this.objectSegments(tenantId, fileName));
    await assertOk(response, 'get');
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(tenantId: string, fileName: string): Promise<void> {
    const response = await this.send('DELETE', this.objectSegments(tenantId, fileName));
    if (response.ok || response.status === 404) return;
    await assertOk(response, 'delete');
  }

  async check(): Promise<StorageHealth> {
    const health: StorageHealth = {
      status: 'down',
      adapter: this.name,
      bucket: this.bucket,
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
    };
    try {
      const response = await this.send('HEAD', []);
      return response.ok ? { ...health, status: 'up' } : health;
    } catch {
      return health;
    }
  }
}
