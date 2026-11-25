import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import { Public } from '../common/decorators/public.decorator';
import { getStorageAdapter } from '../common/storage/storage.factory';
import type { StorageHealth } from '../common/storage/storage.types';

@Public()
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness probe' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness probe' })
  async ready() {
    const [database, redis, storage] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
    ]);
    const ready = database.status === 'up' && redis.status === 'up' && storage.status === 'up';
    const payload = {
      status: ready ? 'ready' : 'not_ready',
      checks: { database, redis, storage },
    };
    if (!ready) throw new ServiceUnavailableException(payload);
    return payload;
  }

  private async checkStorage(): Promise<StorageHealth> {
    try {
      return await getStorageAdapter(this.config).check();
    } catch {
      // A misconfigured driver must still surface a health payload, including
      // the driver that was selected, instead of failing the probe outright.
      const driver = this.config.get<string>('storage.driver') ?? 'local';
      if (driver === 's3') {
        return {
          status: 'down',
          adapter: 's3',
          bucket: this.config.get<string>('storage.bucket') ?? '',
          ...(this.config.get<string>('storage.endpoint')
            ? { endpoint: this.config.get<string>('storage.endpoint') }
            : {}),
        };
      }
      return { status: 'down', adapter: 'local', path: this.config.get<string>('storage.localPath') ?? '' };
    }
  }

  private async checkDatabase(): Promise<{ status: 'up' | 'down'; latencyMs?: number }> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'up', latencyMs: Date.now() - started };
    } catch {
      return { status: 'down' };
    }
  }

  private async checkRedis(): Promise<{ status: 'up' | 'down'; latencyMs?: number }> {
    const started = Date.now();
    try {
      await this.redis.ping();
      return { status: 'up', latencyMs: Date.now() - started };
    } catch {
      return { status: 'down' };
    }
  }
}
