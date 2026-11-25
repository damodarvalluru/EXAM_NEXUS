import {
  buildAuthorizeUrl,
  buildTokenRequest,
  createPkceChallenge,
  generatePkceVerifier,
  parseDiscoveryDocument,
  parseTokenResponse,
} from './oauth';
import { normaliseCandidateCsv, parseCsv } from './csv';
import { applyMapping, verifyMapping } from './mapping';
import { transitionIntegrationStatus } from './lifecycle';

describe('integration extension helpers', () => {
  describe('OAuth/OIDC token exchange', () => {
    it('builds a form-encoded client credentials request with scopes', () => {
      const request = buildTokenRequest(
        {
          grantType: 'CLIENT_CREDENTIALS',
          clientId: 'client_1',
          clientSecret: 'secret-value',
          scopes: ['candidates:read', 'candidates:write'],
        },
        'https://idp.example.com/token',
      );
      const form = new URLSearchParams(request.body);
      expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(form.get('grant_type')).toBe('client_credentials');
      expect(form.get('scope')).toBe('candidates:read candidates:write');
      expect(form.get('client_secret')).toBe('secret-value');
    });

    it('includes PKCE fields for an authorization code grant', () => {
      const request = buildTokenRequest(
        {
          grantType: 'AUTHORIZATION_CODE',
          clientId: 'client_1',
          clientSecret: 'secret-value',
          code: 'code_1',
          redirectUri: 'https://app.example.com/callback',
          codeVerifier: 'verifier-value',
        },
        'https://idp.example.com/token',
      );
      const form = new URLSearchParams(request.body);
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe('code_1');
      expect(form.get('code_verifier')).toBe('verifier-value');
      expect(form.get('redirect_uri')).toBe('https://app.example.com/callback');
    });

    it('builds an authorization-code URL with PKCE S256 and state', () => {
      // RFC 7636 Appendix B vector.
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      expect(createPkceChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
      expect(() => createPkceChallenge('too-short')).toThrow('43-128 unreserved characters');
      expect(generatePkceVerifier()).toMatch(/^[A-Za-z0-9\-._~]{43}$/);

      const url = new URL(buildAuthorizeUrl({
        authorizeUrl: 'https://idp.example.com/authorize?prompt=login',
        clientId: 'client_1',
        redirectUri: 'https://app.example.com/org/integrations',
        state: 'state-value',
        codeChallenge: createPkceChallenge(verifier),
        scopes: ['candidates:read', 'candidates:write'],
      }));
      expect(url.origin + url.pathname).toBe('https://idp.example.com/authorize');
      expect(url.searchParams.get('prompt')).toBe('login');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        response_type: 'code',
        client_id: 'client_1',
        redirect_uri: 'https://app.example.com/org/integrations',
        state: 'state-value',
        code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        code_challenge_method: 'S256',
        scope: 'candidates:read candidates:write',
      });
    });

    it('rejects incomplete authorization URL inputs', () => {
      expect(() => buildAuthorizeUrl({
        authorizeUrl: 'not a url', clientId: 'c', redirectUri: 'https://a.test', state: 's', codeChallenge: 'x',
      })).toThrow('Invalid authorization endpoint');
      expect(() => buildAuthorizeUrl({
        authorizeUrl: 'https://idp.example.com/authorize', clientId: '', redirectUri: 'https://a.test', state: 's', codeChallenge: 'x',
      })).toThrow('client ID');
    });

    it('parses token responses and rejects malformed payloads', () => {
      const token = parseTokenResponse(JSON.stringify({
        access_token: 'token-value',
        token_type: 'Bearer',
        expires_in: 120,
        scope: 'candidates:read candidates:write',
      }));
      expect(token.accessToken).toBe('token-value');
      expect(token.expiresIn).toBe(120);
      expect(token.scopes).toEqual(['candidates:read', 'candidates:write']);
      expect(() => parseTokenResponse('{}')).toThrow('access_token');
    });

    it('discovers the OIDC token endpoint over a validated HTTPS response', () => {
      expect(parseDiscoveryDocument(JSON.stringify({ token_endpoint: 'https://idp.example.com/token' })))
        .toBe('https://idp.example.com/token');
      expect(() => parseDiscoveryDocument('{}')).toThrow('token_endpoint');
    });
  });

  describe('CSV import', () => {
    it('parses quoted fields, escaped quotes, CRLF and a BOM', () => {
      const rows = parseCsv('\uFEFFcandidateCode,firstName,notes\r\nC1,"Ada","said ""hello"""\r\n');
      expect(rows).toHaveLength(2);
      expect(rows[1]?.values).toEqual(['C1', 'Ada', 'said "hello"']);
    });

    it('validates candidate rows before any import', () => {
      const rows = parseCsv('candidateCode,firstName,lastName,email\nC1,Ada,Lovelace,ada@example.com\nC2,Bad,Email,not-an-email\n');
      const result = normaliseCandidateCsv(rows);
      expect(result.records).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.records[0]).toEqual({
        candidateCode: 'C1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: null,
      });
    });

    it('rejects files without required columns', () => {
      expect(() => normaliseCandidateCsv(parseCsv('firstName,lastName\nAda,Lovelace\n'))).toThrow('candidateCode and email');
    });
  });

  describe('mapping verification', () => {
    it('aggregates field presence without mutating source records', () => {
      const fields = verifyMapping(
        { candidateCode: 'student_id', email: 'email_address' },
        [{ student_id: 'S1', email_address: 'one@example.com' }, { student_id: 'S2' }],
        ['phone'],
      );
      expect(fields.find((field) => field.target === 'candidateCode')).toEqual({
        target: 'candidateCode', source: 'student_id', present: 2, missing: 0, ok: true,
      });
      expect(fields.find((field) => field.target === 'email')?.missing).toBe(1);
      expect(fields.find((field) => field.target === 'phone')).toEqual({
        target: 'phone', source: '', present: 0, missing: 2, ok: false,
      });
    });

    it('applies only allowed mapped targets', () => {
      expect(applyMapping<Record<string, unknown>>(
        { candidateCode: 'student_id', internal: 'secret_source' },
        { student_id: 'S1', secret_source: 'hidden' },
        ['candidateCode'],
      )).toEqual({ candidateCode: 'S1' });
    });
  });

  describe('lifecycle state machine', () => {
    it('allows guarded transitions and rejects invalid ones', () => {
      expect(transitionIntegrationStatus('VERIFICATION_PENDING', 'activate')).toBe('CONNECTED');
      expect(transitionIntegrationStatus('CONNECTED', 'pause')).toBe('SUSPENDED');
      expect(transitionIntegrationStatus('SUSPENDED', 'activate')).toBe('CONNECTED');
      expect(transitionIntegrationStatus('REVOKED', 'reset')).toBe('NOT_CONNECTED');
      expect(() => transitionIntegrationStatus('REVOKED', 'activate')).toThrow('Cannot activate');
    });
  });
});
