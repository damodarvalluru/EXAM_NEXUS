import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@examnexus/shared';
import { RedisService } from '../../database/redis.service';

/** Identifiers an authentication failure counter may be keyed by. */
export interface UserFailureIdentity {
  userId: string;
  email?: string | null;
  username?: string | null;
}

/** Redis-backed counters so limits are shared by every API replica. */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  async consume(scope: string, identity: string, limit: number, windowSeconds: number): Promise<void> {
    const key = `ratelimit:${scope}:${identity}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, windowSeconds);
    if (count > limit) {
      this.logger.warn(`Rate limit exceeded for ${scope}`);
      throw new HttpException(
        {
          code: ERROR_CODES.RATE_LIMITED,
          message: 'Too many attempts. Please try again later.',
          details: { retryAfterSeconds: windowSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async failures(scope: string, identity: string): Promise<number> {
    const value = await this.redis.client.get(`failures:${scope}:${identity}`);
    return Number.parseInt(value ?? '0', 10) || 0;
  }

  async recordFailure(scope: string, identity: string, windowSeconds: number): Promise<number> {
    const key = `failures:${scope}:${identity}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, windowSeconds);
    return count;
  }

  async clearFailures(scope: string, identity: string): Promise<void> {
    await this.redis.client.del(`failures:${scope}:${identity}`);
  }

  /**
   * Clears every failure counter belonging to one user, including counters
   * recorded from other IP addresses and from the PIN / MFA / step-up scopes.
   * This is best-effort: an unavailable Redis must not block an admin unlock.
   */
  async clearUserFailures(identity: UserFailureIdentity): Promise<void> {
    try {
      const identities = new Set<string>();
      if (identity.userId) identities.add(identity.userId.toLowerCase());
      for (const value of [identity.email, identity.username]) {
        if (value) identities.add(value.trim().toLowerCase());
      }
      if (!identities.size) return;

      const keys: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await this.redis.client.scan(cursor, 'MATCH', 'failures:*', 'COUNT', 250);
        cursor = next;
        keys.push(...batch.filter((key) => this.belongsToUser(key, identity.userId, identities)));
      } while (cursor !== '0');

      // Delete individually so a single malformed key can never abort the reset.
      for (const key of keys) {
        await this.redis.client.del(key);
      }
      if (keys.length) {
        this.logger.debug(`Cleared ${keys.length} failure counter(s) for user ${identity.userId}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not clear failure counters for ${identity.userId}: ${message}`);
    }
  }

  /** `failures:login|pin:<ip>:<identifier>` and `failures:mfa|step-up:<userId>`. */
  private belongsToUser(key: string, userId: string, identities: Set<string>): boolean {
    if (userId && (key === `failures:mfa:${userId}` || key === `failures:step-up:${userId}`)) {
      return true;
    }
    const scoped = /^failures:(?:login|pin):.*:([^:]*)$/.exec(key);
    return Boolean(scoped && identities.has(scoped[1].toLowerCase()));
  }
}
