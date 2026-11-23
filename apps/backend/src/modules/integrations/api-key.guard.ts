import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES, type Principal } from '@examnexus/shared';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../database/prisma.service';
import { ApiManagementService } from './api-management.service';

export const API_SCOPES_KEY = 'apiScopes';
export const RequireApiScopes = (...scopes: string[]) => SetMetadata(API_SCOPES_KEY, scopes);

export interface ApiCredentialContext {
  apiClientId: string;
  apiKeyId?: string;
  apiCredentialKind: 'API_KEY' | 'CLIENT_CREDENTIALS';
}

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

const CLIENT_ID_PREFIX = 'enx_c_';
const CLIENT_SECRET_PREFIX = 'enx_s_';

function unauthorized(message: string): UnauthorizedException {
  return new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message });
}

function asHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function credentialsFromBody(body: unknown): ClientCredentials | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as { clientId?: unknown; clientSecret?: unknown };
  if (typeof value.clientId !== 'string' || typeof value.clientSecret !== 'string') return null;
  return { clientId: value.clientId.trim(), clientSecret: value.clientSecret.trim() };
}

function credentialsFromBasic(header: string | undefined): ClientCredentials | null {
  if (!header?.startsWith('Basic ')) return null;
  const encoded = header.slice(6).trim();
  if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 1) return null;
  return {
    clientId: decoded.slice(0, separator).trim(),
    clientSecret: decoded.slice(separator + 1).trim(),
  };
}

/**
 * Guards the public API. Two credential forms are accepted:
 *  - `x-api-key: enx_k_...` (a scoped key, with its own expiry)
 *  - client credentials: HTTP Basic, `x-client-id`/`x-client-secret` headers,
 *    or `clientId`/`clientSecret` in the request body.
 *
 * Client-level scopes are derived from the client's active, unexpired keys;
 * the client model has no independent scope column.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly apiManagement: ApiManagementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const keyToken = request.header('x-api-key') ?? '';

    let clientId: string;
    let tenantId: string;
    let keyId: string | undefined;
    let scopes: string[];
    let principalUserId: string;
    let authMethod: Principal['authMethod'];

    if (keyToken) {
      if (!keyToken.startsWith('enx_k_') || keyToken.length < 24) {
        throw unauthorized('A valid API key is required');
      }
      const prefix = keyToken.slice(0, 20);
      const digest = this.crypto.sha256(keyToken);
      const record = await this.prisma.withElevated(async (tx) =>
        tx.apiKey.findFirst({ where: { prefix, revokedAt: null }, include: { client: true } }),
      );
      if (!record?.client || !this.crypto.safeEqual(record.secretHash, digest)) {
        throw unauthorized('Invalid API key');
      }
      if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
        throw unauthorized('API key has expired');
      }
      if (this.clientIsInactive(record.client)) throw unauthorized('API client is not active');

      clientId = record.client.clientId;
      tenantId = record.client.tenantId!;
      keyId = record.id;
      scopes = this.stringArray(record.scopes);
      principalUserId = record.client.createdBy ?? `api-key:${record.id}`;
      authMethod = 'API_KEY';
      await this.apiManagement.touchKey(record.id);
    } else {
      const credentials = this.clientCredentials(request);
      if (!credentials) throw unauthorized('A valid API key or client credentials are required');
      const { clientId: submittedId, clientSecret } = credentials;
      if (!submittedId.startsWith(CLIENT_ID_PREFIX) || !clientSecret.startsWith(CLIENT_SECRET_PREFIX)) {
        throw unauthorized('Invalid client credentials');
      }

      const client = await this.prisma.withElevated((tx) =>
        tx.apiClient.findUnique({ where: { clientId: submittedId }, include: { keys: true } }),
      );
      if (!client || !this.crypto.safeEqual(client.secretHash, this.crypto.sha256(clientSecret))) {
        throw unauthorized('Invalid client credentials');
      }
      if (this.clientIsInactive(client)) throw unauthorized('API client is not active');

      clientId = client.clientId;
      tenantId = client.tenantId!;
      scopes = this.activeKeyScopes(client.keys);
      principalUserId = client.createdBy ?? `api-client:${client.id}`;
      authMethod = 'API_CLIENT';
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(API_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.every((scope) => scopes.includes(scope))) {
      throw unauthorized('Credential lacks the required scope');
    }

    const principal: Principal = {
      userId: principalUserId,
      email: null,
      tenantId,
      globalRoles: [],
      tenantRoles: ['API_CLIENT'],
      permissions: scopes,
      sessionId: null,
      authMethod,
      stepUpVerifiedAt: null,
    };
    const credentialContext = request as RequestWithContext & ApiCredentialContext;
    credentialContext.apiClientId = clientId;
    if (keyId) credentialContext.apiKeyId = keyId;
    credentialContext.apiCredentialKind = keyId ? 'API_KEY' : 'CLIENT_CREDENTIALS';
    request.principal = principal;
    request.tenantId = tenantId;
    return true;
  }

  private clientCredentials(request: RequestWithContext): ClientCredentials | null {
    const headerId = request.header('x-client-id')?.trim();
    const headerSecret = asHeader(request.headers['x-client-secret'])?.trim();
    if (headerId || headerSecret) {
      return headerId && headerSecret ? { clientId: headerId, clientSecret: headerSecret } : null;
    }
    const basic = credentialsFromBasic(request.header('authorization') ?? undefined);
    if (basic) return basic;
    return credentialsFromBody(request.body);
  }

  private clientIsInactive(client: { status: string; revokedAt: Date | null; tenantId: string | null }): boolean {
    return client.status !== 'ACTIVE' || Boolean(client.revokedAt) || !client.tenantId;
  }

  private activeKeyScopes(keys: Array<{
    scopes: unknown;
    expiresAt: Date | null;
    revokedAt: Date | null;
  }>): string[] {
    const scopes = new Set<string>();
    const now = Date.now();
    for (const key of keys) {
      if (key.revokedAt || (key.expiresAt && key.expiresAt.getTime() <= now)) continue;
      for (const scope of this.stringArray(key.scopes)) scopes.add(scope);
    }
    return [...scopes];
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }
}
