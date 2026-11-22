import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({
      datasources: { db: { url: config.getOrThrow<string>('database.url') } },
      log: config.get('app.environment') === 'production' ? ['warn', 'error'] : ['error', 'warn'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('PostgreSQL connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs work inside a transaction with RLS context applied. All tenant data
   * access must go through this helper (or an equivalent scoped transaction).
   */
  async withTenant<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    elevated = false,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT app.set_context(${tenantId}::uuid, ${elevated})`;
      return work(tx);
    });
  }

  /** Super Admin only: caller must have passed step-up authorisation before invoking. */
  async withElevated<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT app.set_context(NULL::uuid, true)`;
      return work(tx);
    });
  }
}
