import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../database/redis.service';
import { IntegrationWebhooksService } from './webhooks.service';

export const WEBHOOK_RETRY_LOCK_KEY = 'integrations:webhook-retry:leader';
/** Release only our own lock so a slow run cannot delete a newer replica's lock. */
const RELEASE_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';

/**
 * Periodic webhook retry worker. A Redis SET NX EX leader lock ensures only one
 * API replica drains the due queue per tick.
 */
@Injectable()
export class WebhookRetryProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRetryProcessor.name);
  private readonly holder = randomUUID();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly webhooks: IntegrationWebhooksService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<boolean>('integrations.retryEnabled') !== true) {
      this.logger.log('Webhook retry processor is disabled');
      return;
    }
    const intervalMs = this.positive('integrations.retryIntervalMs', 30_000, 1_000);
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    // A worker timer must not hold the Node process open during shutdown/tests.
    this.timer.unref();
    this.logger.log(`Webhook retry processor enabled (every ${intervalMs}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One locked retry pass; returns the number of successfully redelivered events. */
  async runOnce(): Promise<number> {
    const intervalMs = this.positive('integrations.retryIntervalMs', 30_000, 1_000);
    const lockTtlSeconds = Math.max(60, Math.ceil(intervalMs / 1_000) * 2);
    let acquired: string | null;
    try {
      acquired = await this.redis.client.set(WEBHOOK_RETRY_LOCK_KEY, this.holder, 'EX', lockTtlSeconds, 'NX');
    } catch (error) {
      this.logger.warn(`Webhook retry lock could not be acquired: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 0;
    }
    if (acquired !== 'OK') return 0;

    try {
      const batchSize = this.positive('integrations.retryBatchSize', 20, 1);
      return await this.webhooks.retryPending(batchSize);
    } catch (error) {
      this.logger.warn(`Webhook retry pass failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 0;
    } finally {
      try {
        await this.redis.client.eval(RELEASE_SCRIPT, 1, WEBHOOK_RETRY_LOCK_KEY, this.holder);
      } catch (error) {
        this.logger.warn(`Webhook retry lock could not be released: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }

  private positive(key: string, fallback: number, minimum: number): number {
    const value = this.config.get<number>(key);
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(minimum, Math.floor(value))
      : fallback;
  }
}
