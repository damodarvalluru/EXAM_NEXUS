import type { ConfigService } from '@nestjs/config';
import type { RedisService } from '../../database/redis.service';
import type { IntegrationWebhooksService } from './webhooks.service';
import { WebhookRetryProcessor, WEBHOOK_RETRY_LOCK_KEY } from './webhook-retry.processor';

describe('WebhookRetryProcessor', () => {
  const now = new Date('2026-11-25T12:00:00.000Z');
  let set: jest.Mock;
  let release: jest.Mock;
  let retryPending: jest.Mock;
  let processor: WebhookRetryProcessor;

  const build = (config: Record<string, unknown>) => {
    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
    const redis = { client: { set, eval: release } } as unknown as RedisService;
    const webhooks = { retryPending } as unknown as IntegrationWebhooksService;
    return new WebhookRetryProcessor(configService, redis, webhooks);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    set = jest.fn().mockResolvedValue('OK');
    release = jest.fn().mockResolvedValue(1);
    retryPending = jest.fn().mockResolvedValue(2);
  });

  afterEach(async () => {
    await processor?.onModuleDestroy();
    jest.useRealTimers();
  });

  it('does not schedule or acquire a lock when retries are disabled', async () => {
    processor = build({ 'integrations.retryEnabled': false, 'integrations.retryIntervalMs': 30_000 });
    processor.onModuleInit();

    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(set).not.toHaveBeenCalled();
    expect(retryPending).not.toHaveBeenCalled();
  });

  it('polls on the configured interval and drains one batch under the leader lock', async () => {
    processor = build({
      'integrations.retryEnabled': true,
      'integrations.retryIntervalMs': 45_000,
      'integrations.retryBatchSize': 7,
    });
    processor.onModuleInit();
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(45_000);
    expect(set).toHaveBeenCalledWith(WEBHOOK_RETRY_LOCK_KEY, expect.any(String), 'EX', 90, 'NX');
    expect(retryPending).toHaveBeenCalledWith(7);
    expect(release).toHaveBeenCalledWith(expect.stringContaining('redis.call("GET"'), 1, WEBHOOK_RETRY_LOCK_KEY, expect.any(String));

    retryPending.mockClear();
    await jest.advanceTimersByTimeAsync(45_000);
    expect(retryPending).toHaveBeenCalledTimes(1);
  });

  it('skips the batch when another replica holds the leader lock', async () => {
    set.mockResolvedValue(null);
    processor = build({
      'integrations.retryEnabled': true,
      'integrations.retryIntervalMs': 30_000,
      'integrations.retryBatchSize': 20,
    });
    processor.onModuleInit();

    await jest.advanceTimersByTimeAsync(30_000);
    expect(retryPending).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('always releases the lock when a retry pass throws', async () => {
    retryPending.mockRejectedValue(new Error('database unavailable'));
    processor = build({
      'integrations.retryEnabled': true,
      'integrations.retryIntervalMs': 30_000,
      'integrations.retryBatchSize': 20,
    });
    processor.onModuleInit();

    await expect(jest.advanceTimersByTimeAsync(30_000)).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('clears the interval on module destroy', async () => {
    processor = build({ 'integrations.retryEnabled': true, 'integrations.retryIntervalMs': 30_000 });
    processor.onModuleInit();
    expect(jest.getTimerCount()).toBe(1);

    await processor.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(retryPending).not.toHaveBeenCalled();
  });
});
