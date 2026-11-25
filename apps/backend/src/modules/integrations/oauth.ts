import { createHash, randomBytes } from 'node:crypto';
import type { AcquireTokenDto } from './dto/integration.dto';

export interface TokenRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  scopes: string[];
  expiresIn: number;
}

const DEFAULT_EXPIRES_IN_SECONDS = 3600;

export interface AuthorizeUrlInput {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}

/** RFC 7636 §4.1: 43-128 unreserved characters with at least 256 bits of entropy. */
export function generatePkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** RFC 7636 S256 challenge: BASE64URL(SHA256(ASCII(verifier))). */
export function createPkceChallenge(verifier: string): string {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) {
    throw new Error('PKCE verifier must be 43-128 unreserved characters');
  }
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Build the browser redirect to the provider's authorization endpoint. */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  if (!input.clientId || !input.redirectUri || !input.state || !input.codeChallenge) {
    throw new Error('Authorization URL requires a client ID, redirect URI, state and code challenge');
  }
  let url: URL;
  try {
    url = new URL(input.authorizeUrl);
  } catch {
    throw new Error('Invalid authorization endpoint');
  }
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.scopes?.length) url.searchParams.set('scope', input.scopes.join(' '));
  return url.toString();
}

/** Build a standards-compliant form-encoded token request. No secret is logged. */
export function buildTokenRequest(input: AcquireTokenDto, tokenUrl: string): TokenRequest {
  const form = new URLSearchParams({
    grant_type: input.grantType === 'CLIENT_CREDENTIALS' ? 'client_credentials' : 'authorization_code',
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  if (input.scopes?.length) form.set('scope', input.scopes.join(' '));
  if (input.grantType === 'AUTHORIZATION_CODE') {
    if (!input.code) throw new Error('An authorization code is required for AUTHORIZATION_CODE grants');
    form.set('code', input.code);
    if (input.redirectUri) form.set('redirect_uri', input.redirectUri);
    if (input.codeVerifier) form.set('code_verifier', input.codeVerifier);
  }
  return {
    url: tokenUrl,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  };
}

/** Parse only the fields required for credential storage; reject malformed responses. */
export function parseTokenResponse(body: string): TokenResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Token endpoint did not return JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Malformed token response');
  const record = parsed as Record<string, unknown>;
  if (typeof record.access_token !== 'string' || !record.access_token) {
    throw new Error('Token response did not contain an access_token');
  }
  const expiresIn =
    typeof record.expires_in === 'number' && Number.isFinite(record.expires_in) && record.expires_in > 0
      ? Math.floor(record.expires_in)
      : DEFAULT_EXPIRES_IN_SECONDS;
  const scopes = typeof record.scope === 'string'
    ? record.scope.split(/\s+/).filter(Boolean)
    : [];
  return {
    accessToken: record.access_token,
    tokenType: typeof record.token_type === 'string' ? record.token_type : 'Bearer',
    scopes,
    expiresIn,
  };
}

/** Resolve an OIDC token endpoint from a discovery document response. */
export function parseDiscoveryDocument(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('OIDC discovery document did not return JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Malformed OIDC discovery document');
  const endpoint = (parsed as Record<string, unknown>).token_endpoint;
  if (typeof endpoint !== 'string' || !endpoint) {
    throw new Error('OIDC discovery document did not contain a token_endpoint');
  }
  return endpoint;
}
