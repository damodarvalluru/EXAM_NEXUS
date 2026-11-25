import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let ping: jest.Mock;

  beforeEach(() => {
    ping = jest.fn().mockResolvedValue('PONG');
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]),
    } as unknown as PrismaService;
    const redis = { ping } as unknown as RedisService;
    const config = {
      get: jest.fn((key: string) => (key === 'storage.driver' ? 'local' : undefined)),
      getOrThrow: jest.fn().mockReturnValue(process.cwd()),
    } as unknown as ConfigService;
    controller = new HealthController(prisma, redis, config);
  });

  it('reports liveness with uptime', () => {
    const result = controller.live();
    expect(result.status).toBe('ok');
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('reports readiness when dependencies respond', async () => {
    const result = await controller.ready();
    expect(result.status).toBe('ready');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
    expect(result.checks.storage.status).toBe('up');
    expect(result.checks.storage.adapter).toBe('local');
  });

  it('reports the configured S3 adapter when storage is misconfigured', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]) } as unknown as PrismaService;
    const redis = { ping: jest.fn().mockResolvedValue('PONG') } as unknown as RedisService;
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'storage.driver') return 's3';
        if (key === 'storage.bucket') return '';
        return undefined;
      }),
      getOrThrow: jest.fn(),
    } as unknown as ConfigService;
    const s3Controller = new HealthController(prisma, redis, config);

    await expect(s3Controller.ready()).rejects.toMatchObject({
      response: { checks: { storage: { adapter: 's3', status: 'down' } } },
    });
  });

  it('throws when a dependency is unavailable', async () => {
    ping.mockRejectedValueOnce(new Error('connection refused'));
    await expect(controller.ready()).rejects.toThrow();
  });
});
