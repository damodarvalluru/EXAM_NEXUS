import { RateLimitService } from './rate-limit.service';

function fakeRedis(keys: string[] = [], pages = 1) {
  const store = new Set(keys);
  const removed: string[] = [];
  let calls = 0;
  return {
    store,
    removed,
    client: {
      del: jest.fn(async (key: string) => {
        removed.push(key);
        store.delete(key);
        return 1;
      }),
      scan: jest.fn(async () => {
        calls += 1;
        const cursor = calls < pages ? String(calls) : '0';
        return [cursor, [...store].filter((key) => key.startsWith('failures:'))] as [string, string[]];
      }),
    },
  };
}

describe('RateLimitService.clearUserFailures', () => {
  const keys = [
    'failures:login:127.0.0.1:admin@example.invalid',
    'failures:login:10.0.0.4:admin@example.invalid',
    'failures:pin:127.0.0.1:admin@example.invalid',
    'failures:login:127.0.0.1:root',
    'failures:mfa:user-1',
    'failures:step-up:user-1',
    'failures:login:127.0.0.1:someone-else@example.invalid',
    'failures:mfa:user-2',
    'ratelimit:login:127.0.0.1:admin@example.invalid',
  ];

  it('removes failure counters from every scope and IP for the user', async () => {
    const redis = fakeRedis(keys);
    const service = new RateLimitService(redis as never);

    await service.clearUserFailures({
      userId: 'user-1',
      email: 'ADMIN@example.invalid',
      username: 'root',
    });

    expect(redis.removed.sort()).toEqual([
      'failures:login:10.0.0.4:admin@example.invalid',
      'failures:login:127.0.0.1:admin@example.invalid',
      'failures:login:127.0.0.1:root',
      'failures:mfa:user-1',
      'failures:pin:127.0.0.1:admin@example.invalid',
      'failures:step-up:user-1',
    ]);
    expect(redis.store.has('failures:login:127.0.0.1:someone-else@example.invalid')).toBe(true);
    expect(redis.store.has('failures:mfa:user-2')).toBe(true);
    expect(redis.store.has('ratelimit:login:127.0.0.1:admin@example.invalid')).toBe(true);
  });

  it('follows the SCAN cursor until Redis returns zero', async () => {
    const redis = fakeRedis(keys, 3);
    const service = new RateLimitService(redis as never);

    await service.clearUserFailures({ userId: 'user-1', email: 'admin@example.invalid' });

    expect(redis.client.scan).toHaveBeenCalledTimes(3);
    expect(redis.removed).toContain('failures:mfa:user-1');
  });

  it('does not throw when Redis is unavailable', async () => {
    const redis = fakeRedis();
    redis.client.scan.mockRejectedValueOnce(new Error('connection refused'));
    const service = new RateLimitService(redis as never);

    await expect(service.clearUserFailures({ userId: 'user-1' })).resolves.toBeUndefined();
    expect(redis.removed).toEqual([]);
  });

  it('does nothing without any usable identity', async () => {
    const redis = fakeRedis(keys);
    const service = new RateLimitService(redis as never);

    await service.clearUserFailures({ userId: '', email: null, username: null });

    expect(redis.client.scan).not.toHaveBeenCalled();
  });
});
