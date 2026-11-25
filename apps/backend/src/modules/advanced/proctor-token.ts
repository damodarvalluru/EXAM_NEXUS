import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Tokens are bound to one attempt and expire in 30 minutes. */
export const PROCTOR_TOKEN_TTL_MS = 30 * 60 * 1000;

interface ProctorTokenClaims {
  tenantId: string;
  attemptId: string;
  exp: number;
  nonce: string;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueProctorToken(
  secret: string,
  tenantId: string,
  attemptId: string,
  now = Date.now(),
): { token: string; expiresAt: Date } {
  const claims: ProctorTokenClaims = {
    tenantId,
    attemptId,
    exp: now + PROCTOR_TOKEN_TTL_MS,
    nonce: randomBytes(18).toString('base64url'),
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return {
    token: `${payload}.${sign(secret, payload)}`,
    expiresAt: new Date(claims.exp),
  };
}

export function parseProctorToken(secret: string, token: string): ProctorTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(sign(secret, parts[0]));
  const actual = Buffer.from(parts[1]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as ProctorTokenClaims;
    if (
      !claims ||
      typeof claims.tenantId !== 'string' ||
      typeof claims.attemptId !== 'string' ||
      typeof claims.exp !== 'number' ||
      typeof claims.nonce !== 'string'
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function verifyProctorToken(
  secret: string,
  tenantId: string,
  attemptId: string,
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const claims = parseProctorToken(secret, token);
  if (!claims) return false;
  return (
    claims.tenantId === tenantId &&
    claims.attemptId === attemptId &&
    claims.exp > now &&
    claims.exp - now <= PROCTOR_TOKEN_TTL_MS
  );
}
