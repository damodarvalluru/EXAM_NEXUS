import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES, type AuthMethod } from '@examnexus/shared';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../database/redis.service';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const STEP_UP_TTL_SECONDS = 10 * 60;
export const CHALLENGE_TTL_SECONDS = 5 * 60;

const CHALLENGE_KEY_PREFIX = 'mfaChallenge:';
const STEP_UP_KEY_PREFIX = 'stepup:';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  tid: string | null;
  am: AuthMethod;
  sup?: string;
  typ: 'access';
  iat: number;
  exp: number;
}

export interface ChallengePayload {
  sub: string;
  am: AuthMethod;
  tid: string | null;
  typ: 'mfa';
  jti: string;
  iat: number;
  exp: number;
}

export interface TokenIdentity {
  userId: string;
  sessionId: string;
  tenantId: string | null;
  authMethod: AuthMethod;
  stepUpVerifiedAt?: string | null;
}

export function stepUpSessionKey(sessionId: string): string {
  return `${STEP_UP_KEY_PREFIX}${sessionId}`;
}

/** Rejects missing, malformed or stale step-up timestamps (small clock skew allowed). */
export function freshStepUpAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const age = Date.now() - timestamp;
  if (age < -60_000 || age > STEP_UP_TTL_SECONDS * 1000) return null;
  return value;
}

/** Newest still-valid step-up proof wins, whether it came from a token or the session. */
export function latestValidStepUp(...values: Array<string | null | undefined>): string | null {
  return (
    values
      .map((value) => freshStepUpAt(value))
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
  );
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  signAccess(identity: TokenIdentity, ttlSeconds = ACCESS_TOKEN_TTL_SECONDS): string {
    return this.jwt.sign(
      {
        sub: identity.userId,
        sid: identity.sessionId,
        tid: identity.tenantId,
        am: identity.authMethod,
        ...(identity.stepUpVerifiedAt ? { sup: identity.stepUpVerifiedAt } : {}),
        typ: 'access',
      },
      { secret: this.config.getOrThrow<string>('security.jwtAccessSecret'), expiresIn: ttlSeconds },
    );
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    const payload = await this.jwt
      .verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('security.jwtAccessSecret'),
      })
      .catch(() => {
        throw new UnauthorizedException({
          code: ERROR_CODES.UNAUTHENTICATED,
          message: 'Access token is invalid or expired',
        });
      });
    if (payload.typ !== 'access' || !payload.sub || !payload.sid) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Invalid token type',
      });
    }
    return payload;
  }

  /**
   * Reads a step-up timestamp from the bearer token sent alongside a refresh.
   * The signature is still verified; only expiry is ignored because clients
   * refresh precisely when an access token has expired.
   */
  async readStepUpFromAccess(
    authorization: string | undefined,
    expectedSessionId: string,
    expectedUserId: string,
  ): Promise<string | null> {
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
    const token = match?.[1];
    if (!token) return null;
    const payload = await this.jwt
      .verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('security.jwtAccessSecret'),
        ignoreExpiration: true,
      })
      .catch(() => null);
    // Step-up belongs to one session only; never import another session's claim.
    if (
      !payload ||
      payload.typ !== 'access' ||
      payload.sid !== expectedSessionId ||
      payload.sub !== expectedUserId
    ) {
      return null;
    }
    return freshStepUpAt(payload.sup);
  }

  async signChallenge(userId: string, authMethod: AuthMethod, tenantId: string | null): Promise<string> {
    const jti = randomUUID();
    const token = this.jwt.sign(
      { sub: userId, am: authMethod, tid: tenantId, typ: 'mfa', jti },
      { secret: this.config.getOrThrow<string>('security.jwtAccessSecret'), expiresIn: CHALLENGE_TTL_SECONDS },
    );
    await this.redis.client.set(
      `${CHALLENGE_KEY_PREFIX}${jti}`,
      JSON.stringify({ sub: userId, am: authMethod, tid: tenantId }),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
    return token;
  }

  /** Verifies the signature and atomically consumes the challenge jti exactly once. */
  async verifyChallenge(token: string): Promise<ChallengePayload> {
    const payload = await this.jwt
      .verifyAsync<ChallengePayload>(token, {
        secret: this.config.getOrThrow<string>('security.jwtAccessSecret'),
      })
      .catch(() => {
        throw new UnauthorizedException({
          code: ERROR_CODES.UNAUTHENTICATED,
          message: 'MFA challenge is invalid or expired',
        });
      });
    if (payload.typ !== 'mfa' || !payload.sub || !payload.jti) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Invalid challenge type',
      });
    }
    const raw = await this.redis.client.getdel(`${CHALLENGE_KEY_PREFIX}${payload.jti}`);
    if (!raw) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'MFA challenge is invalid, expired or already used',
      });
    }
    let stored: { sub: string; am: AuthMethod; tid: string | null };
    try {
      stored = JSON.parse(raw) as { sub: string; am: AuthMethod; tid: string | null };
    } catch {
      stored = { sub: '', am: 'PASSWORD', tid: null };
    }
    if (stored.sub !== payload.sub || stored.am !== payload.am || stored.tid !== payload.tid) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'MFA challenge is invalid, expired or already used',
      });
    }
    return payload;
  }
}
