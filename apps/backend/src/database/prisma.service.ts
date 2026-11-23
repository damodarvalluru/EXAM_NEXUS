import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { createTenantScopeExtension, runInTenantScope } from './tenant-scope';

/**
 * The extended client is installed on the base client (Prisma forbids
 * extending a transaction client) and query extensions propagate to every
 * transaction client obtained from it.
 *
 * Interface merging gives consumers the full Prisma delegate/`$queryRaw`/
 * `$transaction` surface while the constructor proxy forwards those members
 * to the extended client.
 */
export interface PrismaService extends PrismaClient {}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly base: PrismaClient;
  private readonly scoped: PrismaClient;

  constructor(config: ConfigService) {
    this.base = new PrismaClient({
      datasources: { db: { url: config.getOrThrow<string>('database.url') } },
      log: config.get('app.environment') === 'production' ? ['warn', 'error'] : ['error', 'warn'],
    });
    this.scoped = this.base.$extends(createTenantScopeExtension()) as PrismaClient;

    return new Proxy(this, {
      get(target, property, receiver) {
        if (property in target) return Reflect.get(target, property, receiver);
        const value = Reflect.get(target.scoped, property);
        return typeof value === 'function' ? value.bind(target.scoped) : value;
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
    this.logger.log('TiDB Cloud (MySQL) connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }

  /**
   * Runs work in a transaction whose model queries are implicitly scoped to
   * `tenantId`. Pass `elevated` to explicitly bypass scoping (rare; prefer
   * `withElevated` so the intent is visible at the call site).
   */
  async withTenant<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    elevated = false,
  ): Promise<T> {
    return this.scoped.$transaction(
      async (tx) =>
        runInTenantScope({ tenantId, elevated, tx }, () => work(tx as Prisma.TransactionClient)),
      // TiDB Cloud adds network latency; the 5s Prisma default is too short for
      // startup seeding and the larger tenant dashboard transactions.
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  /** Trusted internal escape hatch: bypasses tenant scoping, so callers must enforce
   * platform permissions themselves and is responsible for audit logging. */
  async withElevated<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.scoped.$transaction(
      async (tx) =>
        runInTenantScope({ tenantId: null, elevated: true, tx }, () => work(tx as Prisma.TransactionClient)),
      { maxWait: 10_000, timeout: 60_000 },
    );
  }
}
