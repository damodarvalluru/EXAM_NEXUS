import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export interface OutboundRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface OutboundResponse {
  ok: boolean;
  status: number;
  body: string;
  latencyMs: number;
}

export interface ValidatedTarget {
  url: URL;
  /** Original hostname, used for SNI and the Host header. */
  host: string;
  /** DNS answer that was validated; the connection is pinned to this IP. */
  address: string;
  family: 4 | 6;
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  // A cross-host redirect does not forward the body, so stale framing headers
  // must not be carried over either.
  'content-length',
  'transfer-encoding',
]);

/**
 * SSRF policy for integration traffic. Every hop (including every redirect) is
 * resolved and validated, then the connection is pinned to the validated IP so
 * DNS cannot be re-resolved between validation and connect. Sensitive headers
 * are dropped when a redirect changes the host.
 */
@Injectable()
export class OutboundHttpService {
  private readonly logger = new Logger(OutboundHttpService.name);
  private readonly allowlist: string[];

  constructor(config: ConfigService) {
    this.allowlist = (config.get<string>('integrations.outboundAllowlist') ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean);
  }

  async request(options: OutboundRequest): Promise<OutboundResponse> {
    let current = options.url;
    let currentHost: string | null = null;
    const timeoutMs = options.timeoutMs ?? 8_000;
    const maxBytes = options.maxBytes ?? 1_048_576;
    const started = Date.now();

    for (let hop = 0; hop <= 2; hop += 1) {
      const target = await this.assertSafeUrl(current);
      const hostChanged = currentHost !== null && currentHost !== target.host.toLowerCase();
      const headers = hostChanged
        ? this.stripSensitiveHeaders({
          'user-agent': 'ExamNexus-Integration/1.0',
          accept: 'application/json, text/plain, */*',
          ...options.headers,
        })
        : {
          'user-agent': 'ExamNexus-Integration/1.0',
          accept: 'application/json, text/plain, */*',
          ...options.headers,
        };
      // Never forward a request payload to a different host on a redirect.
      const body = hostChanged ? undefined : options.body;

      let response: IncomingMessage;
      try {
        response = await this.performRequest(target, options.method ?? 'GET', headers, body, timeoutMs);
      } catch (error) {
        throw new Error(`Outbound request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }

      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        const location = response.headers.location;
        response.resume();
        if (!location) throw new Error('Redirect without a location header');
        current = new URL(location, target.url).toString();
        currentHost = target.host.toLowerCase();
        continue;
      }

      const status = response.statusCode ?? 0;
      const responseBody = await this.readLimited(response, maxBytes);
      return {
        ok: status >= 200 && status < 300,
        status,
        body: responseBody,
        latencyMs: Date.now() - started,
      };
    }

    throw new Error('Too many redirects for an outbound integration request');
  }

  /** Exported for direct unit testing of the URL/DNS policy. */
  async assertSafeUrl(rawUrl: string): Promise<ValidatedTarget> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('Invalid integration URL');
    }
    if (url.protocol !== 'https:') {
      throw new Error('Integration URLs must use HTTPS');
    }
    if (url.username || url.password) {
      throw new Error('Credentials in integration URLs are not allowed');
    }
    if (url.port && url.port !== '443' && url.port !== '8443') {
      throw new Error('Integration URL port is not allowed');
    }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (this.allowlist.length && !this.allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`))) {
      throw new Error('Integration host is not on the outbound allowlist');
    }
    if (isIP(host)) {
      this.assertPublicIp(host);
      return { url, host, address: this.stripIpv4Mapping(host), family: isIP(host) === 6 ? 6 : 4 };
    }

    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error('Integration host could not be resolved');
    }
    if (!addresses.length) throw new Error('Integration host could not be resolved');
    for (const address of addresses) this.assertPublicIp(address.address);
    const chosen = addresses[0]!;
    const address = this.stripIpv4Mapping(chosen.address);
    return { url, host, address, family: isIP(address) === 6 ? 6 : 4 };
  }

  /** Lookup callback that always returns the pre-validated address. */
  pinnedLookup(target: ValidatedTarget): LookupFunction {
    return (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: target.address, family: target.family }]);
        return;
      }
      callback(null, target.address, target.family);
    };
  }

  /** Header hygiene applied whenever a redirect leaves the original host. */
  stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers).filter(([name]) => !SENSITIVE_HEADERS.has(name.toLowerCase())),
    );
  }

  private async performRequest(
    target: ValidatedTarget,
    method: NonNullable<OutboundRequest['method']>,
    headers: Record<string, string>,
    body: string | undefined,
    timeoutMs: number,
  ): Promise<IncomingMessage> {
    const options: RequestOptions = {
      method,
      headers,
      lookup: this.pinnedLookup(target),
      timeout: timeoutMs,
      signal: AbortSignal.timeout(timeoutMs),
      // SNI and TLS certificate validation use the hostname, while the TCP
      // connection is pinned to the validated IP via the lookup callback.
      ...(isIP(target.host) ? {} : { servername: target.host }),
    };
    return new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpsRequest(target.url, options, resolve);
      request.once('timeout', () => request.destroy(new Error('Outbound request timed out')));
      request.once('error', reject);
      if (body) request.write(body);
      request.end();
    });
  }

  private assertPublicIp(rawIp: string): void {
    const ip = this.stripIpv4Mapping(rawIp.toLowerCase());
    if (isIP(ip) === 4) {
      const [a, b, c] = ip.split('.').map((part) => Number.parseInt(part, 10));
      if (
        a === 0 || a === 10 || a === 127 || a === 169 ||
        a === 172 && b >= 16 && b <= 31 ||
        a === 192 && (b === 168 || b === 0) ||
        a === 100 && b >= 64 && b <= 127 ||
        a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
        a === 203 && b === 0 && c === 113 ||
        a >= 224
      ) {
        throw new Error('Integration URL resolves to a restricted address');
      }
      return;
    }
    if (
      ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') ||
      ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') ||
      ip.startsWith('2001:db8')
    ) {
      throw new Error('Integration URL resolves to a restricted address');
    }
  }

  private stripIpv4Mapping(ip: string): string {
    return ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip;
  }

  private async readLimited(stream: IncomingMessage, maxBytes: number): Promise<string> {
    const declared = stream.headers['content-length'];
    if (declared && Number.parseInt(declared, 10) > maxBytes) {
      stream.destroy();
      throw new Error('Integration response exceeded the allowed size');
    }

    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        stream.destroy();
        reject(error);
      };
      stream.on('data', (chunk: Buffer) => {
        received += chunk.byteLength;
        if (received > maxBytes) {
          fail(new Error('Integration response exceeded the allowed size'));
          return;
        }
        text += decoder.decode(chunk, { stream: true });
      });
      stream.on('end', () => {
        if (settled) return;
        settled = true;
        text += decoder.decode();
        this.logger.debug(`Integration response received (${received} bytes)`);
        resolve(text);
      });
      stream.on('error', (error: Error) => fail(error));
      stream.on('aborted', () => fail(new Error('Outbound response was aborted')));
    });
  }
}
