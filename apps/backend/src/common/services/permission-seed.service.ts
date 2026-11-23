import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PERMISSION_CATALOGUE } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';

/** Idempotently seeds the global permission catalogue. */
@Injectable()
export class PermissionSeedService implements OnModuleInit {
  private readonly logger = new Logger(PermissionSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  async seed(): Promise<void> {
    await this.prisma.withElevated(async (tx) => {
      for (const permission of PERMISSION_CATALOGUE) {
        await tx.permission.upsert({
          where: { key: permission.key },
          update: { description: permission.description, category: permission.category },
          create: {
            key: permission.key,
            description: permission.description,
            category: permission.category,
          },
        });
      }
    });
    this.logger.log(`Permission catalogue ready (${PERMISSION_CATALOGUE.length} permissions)`);
  }
}
