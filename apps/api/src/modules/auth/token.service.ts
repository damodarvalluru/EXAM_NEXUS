import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES, type AuthMethod } from '@examnexus/shared';
import { randomUUID } from 'node:crypto';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const STEP_UP_TTL_SECONDS = 10 * 60;
export const CHALLENGE_TTL_SECONDS = 5 * 60;

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

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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

  signChallenge(userId: string, authMethod: AuthMethod, tenantId: string | null): string {
    return this.jwt.sign(
      { sub: userId, am: authMethod, tid: tenantId, typ: 'mfa', jti: randomUUID() },
      { secret: this.config.getOrThrow<string>('security.jwtAccessSecret'), expiresIn: CHALLENGE_TTL_SECONDS },
    );
  }

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
    if (payload.typ !== 'mfa' || !payload.sub) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Invalid challenge type',
      });
    }
    return payload;
  }
}
