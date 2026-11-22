import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@examnexus/shared';
import { RedisService } from '../../database/redis.service';

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
}
