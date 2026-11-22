import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { stat } from 'node:fs/promises';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import { Public } from '../common/decorators/public.decorator';

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

  private async checkStorage(): Promise<{ status: 'up' | 'down'; adapter: 'local'; path: string }> {
    const path = this.config.getOrThrow<string>('storage.localPath');
    try {
      const info = await stat(path);
      return { status: info.isDirectory() ? 'up' : 'down', adapter: 'local', path };
    } catch {
      return { status: 'down', adapter: 'local', path };
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
