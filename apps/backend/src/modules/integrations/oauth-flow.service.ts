import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  IntegrationAuthType,
  type OAuthTokenResult,
  type Principal,
} from '@examnexus/shared';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { OutboundHttpService } from '../../common/net/outbound-http.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { RedisService } from '../../database/redis.service';
import type { CreateOAuthAuthorizeDto, OAuthCallbackDto } from './dto/integration.dto';
import { IntegrationsService } from './integrations.service';
import { buildAuthorizeUrl, createPkceChallenge, generatePkceVerifier } from './oauth';

export interface OAuthAuthorizeView {
  authorizeUrl: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  expiresInSeconds: number;
}

interface OAuthStateRecord {
  tenantId: string;
  integrationId: string;
  principalId: string | null;
  clientId: string;
  /** AES-GCM encrypted; the secret never sits in plaintext in Redis or audit logs. */
  clientSecretEncrypted: string;
  redirectUri: string;
  scopes: string[];
  codeVerifier: string;
  createdAt: string;
}

const DEFAULT_STATE_TTL_SECONDS = 600;
const MIN_STATE_TTL_SECONDS = 60;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Browser-based OAuth2/OIDC authorization-code flow with PKCE S256. The state
 * record is single-use (Redis GETDEL) and carries the tenant, integration and
 * principal so a callback from another scope cannot be replayed here.
 */
@Injectable()
export class OAuthFlowService {
  private readonly logger = new Logger(OAuthFlowService.name);

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbound: OutboundHttpService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async createAuthorizeUrl(
    tenantId: string,
    integrationId: string,
    dto: CreateOAuthAuthorizeDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<OAuthAuthorizeView> {
    const integration = await this.integrations.detail(tenantId, integrationId);
    if (integration.authType !== IntegrationAuthType.OAUTH2 && integration.authType !== IntegrationAuthType.OIDC) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Authorization-code flow requires an OAuth2 or OIDC integration',
      });
    }
    const config = integration.config ?? {};
    const authorizeUrl = dto.authorizeUrl
      ?? (typeof config.authorizeUrl === 'string' ? config.authorizeUrl : undefined);
    if (!authorizeUrl) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'No authorization endpoint is configured' });
    }
    await this.outbound.assertSafeUrl(authorizeUrl);
    this.assertRedirectUri(dto.redirectUri);

    const state = this.crypto.randomToken(32);
    const codeVerifier = generatePkceVerifier();
    const codeChallenge = createPkceChallenge(codeVerifier);
    const scopes = [...new Set(dto.scopes ?? [])];
    const url = buildAuthorizeUrl({
      authorizeUrl,
      clientId: dto.clientId,
      redirectUri: dto.redirectUri,
      state,
      codeChallenge,
      scopes,
    });
    const expiresInSeconds = this.stateTtlSeconds();
    const record: OAuthStateRecord = {
      tenantId,
      integrationId,
      principalId: principal?.userId ?? null,
      clientId: dto.clientId,
      clientSecretEncrypted: this.crypto.encrypt(dto.clientSecret),
      redirectUri: dto.redirectUri,
      scopes,
      codeVerifier,
      createdAt: new Date().toISOString(),
    };
    await this.redis.client.set(this.stateKey(state), JSON.stringify(record), 'EX', expiresInSeconds);
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.oauth.authorize',
      resourceType: 'integration',
      resourceId: integrationId,
      newValues: { redirectUri: dto.redirectUri, scopes, stateFingerprint: this.crypto.sha256(state).slice(0, 16) },
      request,
    });
    return { authorizeUrl: url, state, codeChallenge, codeChallengeMethod: 'S256', expiresInSeconds };
  }

  /**
   * Consumes the state and exchanges the code through the existing token path.
   * The callback itself is authenticated by the tenant guard plus the bound
   * state; step-up was already enforced when the URL was created.
   */
  async handleCallback(
    tenantId: string,
    integrationId: string,
    dto: OAuthCallbackDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<OAuthTokenResult> {
    const key = this.stateKey(dto.state);
    const stored = await this.redis.client.getdel(key);
    if (!stored) {
      return this.fail(tenantId, integrationId, principal, request, 'OAuth state is invalid or has expired');
    }
    let record: OAuthStateRecord;
    try {
      const parsed = JSON.parse(stored) as Partial<OAuthStateRecord>;
      if (
        !parsed || typeof parsed !== 'object'
        || typeof parsed.tenantId !== 'string' || typeof parsed.integrationId !== 'string'
        || typeof parsed.clientId !== 'string' || typeof parsed.clientSecretEncrypted !== 'string'
        || typeof parsed.redirectUri !== 'string' || typeof parsed.codeVerifier !== 'string'
        || !Array.isArray(parsed.scopes)
      ) {
        throw new Error('Malformed state record');
      }
      record = parsed as OAuthStateRecord;
    } catch {
      return this.fail(tenantId, integrationId, principal, request, 'OAuth state is invalid or has expired');
    }
    if (record.tenantId !== tenantId || record.integrationId !== integrationId) {
      return this.fail(tenantId, integrationId, principal, request, 'OAuth state belongs to a different integration', true);
    }
    if (record.principalId !== (principal?.userId ?? null)) {
      return this.fail(tenantId, integrationId, principal, request, 'OAuth state belongs to a different user', true);
    }
    if (dto.error) {
      return this.fail(tenantId, integrationId, principal, request, `Authorization provider returned ${dto.error.slice(0, 120)}`);
    }
    if (!dto.code) {
      return this.fail(tenantId, integrationId, principal, request, 'An authorization code is required');
    }
    let clientSecret = '';
    try {
      clientSecret = this.crypto.decrypt(record.clientSecretEncrypted);
    } catch {
      return this.fail(tenantId, integrationId, principal, request, 'OAuth state credential is invalid');
    }
    try {
      const result = await this.integrations.acquireToken(
        tenantId,
        integrationId,
        {
          grantType: 'AUTHORIZATION_CODE',
          clientId: record!.clientId,
          clientSecret,
          scopes: record!.scopes,
          code: dto.code!,
          redirectUri: record!.redirectUri,
          codeVerifier: record!.codeVerifier,
        },
        principal,
        request,
      );
      await this.audit.record({
        actorUserId: principal?.userId,
        actorEmail: principal?.email,
        tenantId,
        action: 'integration.oauth.callback',
        resourceType: 'integration',
        resourceId: integrationId,
        outcome: 'SUCCESS',
        newValues: { credentialId: result.credentialId, scopes: result.scopes },
        request,
      });
      return result;
    } catch (error) {
      return this.fail(
        tenantId,
        integrationId,
        principal,
        request,
        error instanceof Error ? error.message.slice(0, 300) : 'Token exchange failed',
      );
    }
  }

  private stateKey(state: string): string {
    return `oauth:state:${this.crypto.sha256(state)}`;
  }

  private stateTtlSeconds(): number {
    const configured = this.config.get<number>('integrations.oauthStateTtlSeconds');
    return typeof configured === 'number' && Number.isFinite(configured)
      ? Math.max(MIN_STATE_TTL_SECONDS, Math.floor(configured))
      : DEFAULT_STATE_TTL_SECONDS;
  }

  private assertRedirectUri(raw: string): void {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid redirect URI' });
    }
    if (url.username || url.password || url.hash) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Redirect URI must not contain credentials or a fragment' });
    }
    if (url.protocol === 'https:') return;
    if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return;
    throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Redirect URI must use HTTPS (HTTP is only allowed on loopback)',
    });
  }

  private async fail(
    tenantId: string,
    integrationId: string,
    principal: Principal | null,
    request: RequestWithContext,
    reason: string,
    forbidden = false,
  ): Promise<never> {
    try {
      await this.audit.record({
        actorUserId: principal?.userId,
        actorEmail: principal?.email,
        tenantId,
        action: 'integration.oauth.callback',
        resourceType: 'integration',
        resourceId: integrationId,
        outcome: 'FAILURE',
        newValues: { reason },
        request,
      });
    } catch (error) {
      this.logger.warn(`OAuth failure audit could not be written: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    throw forbidden
      ? new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: reason })
      : new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: reason });
  }
}
