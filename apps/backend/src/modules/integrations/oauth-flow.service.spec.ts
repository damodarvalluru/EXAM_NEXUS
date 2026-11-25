import type { ConfigService } from '@nestjs/config';
import type { OAuthTokenResult, Principal } from '@examnexus/shared';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { OutboundHttpService } from '../../common/net/outbound-http.service';
import type { RedisService } from '../../database/redis.service';
import type { IntegrationsService } from './integrations.service';
import { OAuthFlowService } from './oauth-flow.service';
import { createPkceChallenge } from './oauth';

const TENANT = 'tenant-1';
const INTEGRATION = 'integration-1';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const REDIRECT = 'https://app.example.com/org/integrations';
const CLIENT_SECRET = 'client-secret-value';
const principal = { userId: 'user-1', email: 'admin@example.com' } as Principal;
const request = { header: () => undefined, requestId: 'req-1' } as never;
const tokenResult: OAuthTokenResult = {
  integrationId: INTEGRATION,
  tokenType: 'Bearer',
  scopes: ['candidates:read'],
  expiresAt: '2026-11-25T13:00:00.000Z',
  credentialId: 'cred-1',
  tokenEndpoint: 'https://idp.example.com/token',
  acquiredAt: '2026-11-25T12:00:00.000Z',
};

describe('OAuth authorization-code flow with PKCE', () => {
  const crypto = new CryptoService({
    getOrThrow: () => Buffer.alloc(32, 7).toString('base64'),
  } as unknown as ConfigService);

  let detail: jest.Mock;
  let acquireToken: jest.Mock;
  let set: jest.Mock;
  let getdel: jest.Mock;
  let assertSafeUrl: jest.Mock;
  let audit: { record: jest.Mock };
  let service: OAuthFlowService;

  const stateRecord = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    tenantId: TENANT,
    integrationId: INTEGRATION,
    principalId: 'user-1',
    clientId: 'client-1',
    clientSecretEncrypted: crypto.encrypt(CLIENT_SECRET),
    redirectUri: REDIRECT,
    scopes: ['candidates:read'],
    codeVerifier: VERIFIER,
    createdAt: '2026-11-25T12:00:00.000Z',
    ...overrides,
  });

  const authorize = (overrides: Record<string, unknown> = {}) => service.createAuthorizeUrl(
    TENANT,
    INTEGRATION,
    {
      clientId: 'client-1',
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT,
      scopes: ['candidates:read'],
      ...overrides,
    },
    principal,
    request,
  );

  const callback = (overrides: Record<string, unknown> = {}) => service.handleCallback(
    TENANT,
    INTEGRATION,
    { state: 'state-value', code: 'code-1', ...overrides },
    principal,
    request,
  );

  beforeEach(() => {
    detail = jest.fn().mockResolvedValue({
      id: INTEGRATION,
      tenantId: TENANT,
      authType: 'OAUTH2',
      config: {
        authorizeUrl: 'https://idp.example.com/authorize',
        tokenUrl: 'https://idp.example.com/token',
      },
    });
    acquireToken = jest.fn().mockResolvedValue(tokenResult);
    set = jest.fn().mockResolvedValue('OK');
    getdel = jest.fn().mockResolvedValue(null);
    assertSafeUrl = jest.fn().mockResolvedValue(undefined);
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn().mockImplementation((key: string) =>
        key === 'integrations.oauthStateTtlSeconds' ? 120 : undefined),
    } as unknown as ConfigService;
    service = new OAuthFlowService(
      { detail, acquireToken } as unknown as IntegrationsService,
      crypto,
      audit as unknown as AuditService,
      { assertSafeUrl } as unknown as OutboundHttpService,
      { client: { set, getdel } } as unknown as RedisService,
      config,
    );
  });

  it('creates an S256 authorize URL and stores encrypted single-use state in Redis', async () => {
    const result = await authorize();

    const url = new URL(result.authorizeUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe(result.state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('candidates:read');
    expect(result.codeChallengeMethod).toBe('S256');
    expect(result.expiresInSeconds).toBe(120);
    expect(assertSafeUrl).toHaveBeenCalledWith('https://idp.example.com/authorize');

    const [key, value, mode, ttl] = set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe(`oauth:state:${crypto.sha256(result.state)}`);
    expect(mode).toBe('EX');
    expect(ttl).toBe(120);
    expect(value).not.toContain(CLIENT_SECRET);
    const stored = JSON.parse(value) as {
      clientSecretEncrypted: string; codeVerifier: string; tenantId: string; principalId: string;
    };
    expect(stored.tenantId).toBe(TENANT);
    expect(stored.principalId).toBe('user-1');
    expect(crypto.decrypt(stored.clientSecretEncrypted)).toBe(CLIENT_SECRET);
    expect(createPkceChallenge(stored.codeVerifier)).toBe(url.searchParams.get('code_challenge'));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'integration.oauth.authorize',
      resourceId: INTEGRATION,
    }));
  });

  it('rejects a non-loopback HTTP redirect URI before writing state', async () => {
    await expect(authorize({ redirectUri: 'http://app.example.com/callback' })).rejects.toThrow('Redirect URI must use HTTPS');
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects an authorize endpoint that is not configured on an OAuth integration', async () => {
    detail.mockResolvedValueOnce({ id: INTEGRATION, authType: 'API_KEY', config: {} });
    await expect(authorize()).rejects.toThrow('requires an OAuth2 or OIDC integration');
    expect(assertSafeUrl).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('exchanges a code through acquireToken with the stored PKCE verifier and secret', async () => {
    getdel.mockResolvedValueOnce(stateRecord());

    await expect(callback()).resolves.toEqual(tokenResult);

    expect(getdel).toHaveBeenCalledWith(`oauth:state:${crypto.sha256('state-value')}`);
    expect(acquireToken).toHaveBeenCalledWith(
      TENANT,
      INTEGRATION,
      expect.objectContaining({
        grantType: 'AUTHORIZATION_CODE',
        clientId: 'client-1',
        clientSecret: CLIENT_SECRET,
        code: 'code-1',
        redirectUri: REDIRECT,
        codeVerifier: VERIFIER,
        scopes: ['candidates:read'],
      }),
      principal,
      request,
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'integration.oauth.callback',
      outcome: 'SUCCESS',
      newValues: { credentialId: 'cred-1', scopes: ['candidates:read'] },
    }));
  });

  it('rejects an unknown or replayed state', async () => {
    await expect(callback()).rejects.toThrow('OAuth state is invalid or has expired');
    expect(acquireToken).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'integration.oauth.callback',
      outcome: 'FAILURE',
    }));

    getdel.mockResolvedValueOnce(stateRecord());
    await callback();
    getdel.mockResolvedValueOnce(null);
    await expect(callback()).rejects.toThrow('OAuth state is invalid or has expired');
    expect(acquireToken).toHaveBeenCalledTimes(1);
  });

  it('rejects state bound to another tenant, integration or user', async () => {
    getdel.mockResolvedValueOnce(stateRecord({ tenantId: 'tenant-other' }));
    await expect(callback()).rejects.toThrow('different integration');
    getdel.mockResolvedValueOnce(stateRecord({ integrationId: 'integration-other' }));
    await expect(callback()).rejects.toThrow('different integration');
    getdel.mockResolvedValueOnce(stateRecord({ principalId: 'user-other' }));
    await expect(callback()).rejects.toThrow('different user');
    expect(acquireToken).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(3);
  });

  it('rejects provider errors and missing codes after consuming state', async () => {
    getdel.mockResolvedValueOnce(stateRecord());
    await expect(callback({ code: undefined, error: 'access_denied' })).rejects.toThrow('access_denied');
    getdel.mockResolvedValueOnce(stateRecord());
    await expect(callback({ code: undefined })).rejects.toThrow('An authorization code is required');
    expect(acquireToken).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed state records', async () => {
    getdel.mockResolvedValueOnce('{not json');
    await expect(callback()).rejects.toThrow('OAuth state is invalid or has expired');
    getdel.mockResolvedValueOnce(JSON.stringify({ tenantId: TENANT }));
    await expect(callback()).rejects.toThrow('OAuth state is invalid or has expired');
    expect(acquireToken).not.toHaveBeenCalled();
  });

  it('audits a failed token exchange without leaking the code or secret', async () => {
    getdel.mockResolvedValueOnce(stateRecord());
    acquireToken.mockRejectedValueOnce(new Error('Token endpoint returned HTTP 400'));

    await expect(callback()).rejects.toThrow('Token endpoint returned HTTP 400');
    const entry = audit.record.mock.calls.at(-1)![0] as { outcome: string; newValues: { reason: string } };
    expect(entry.outcome).toBe('FAILURE');
    expect(entry.newValues.reason).toBe('Token endpoint returned HTTP 400');
    expect(JSON.stringify(entry)).not.toContain('code-1');
    expect(JSON.stringify(entry)).not.toContain(CLIENT_SECRET);
  });
});
