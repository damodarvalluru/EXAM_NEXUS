import { Injectable } from '@nestjs/common';
import type { AuthMethod, AuditOutcome } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import type { RequestWithContext } from '../middleware/request-context.middleware';

export interface AuthEventEntry {
  userId?: string | null;
  tenantId?: string | null;
  email?: string | null;
  method: AuthMethod;
  outcome: AuditOutcome;
  ip?: string | null;
  request?: RequestWithContext | null;
  riskScore?: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuthEventService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuthEventEntry): Promise<void> {
    await this.prisma.withElevated((tx) =>
      tx.authenticationEvent.create({
        data: {
          userId: entry.userId ?? null,
          tenantId: entry.tenantId ?? null,
          email: entry.email ?? null,
          method: entry.method,
          outcome: entry.outcome,
          ip: entry.ip ?? entry.request?.ip ?? null,
          userAgent: entry.request?.header('user-agent') ?? null,
          location: entry.request?.header('x-geo-location') ?? null,
          riskScore: entry.riskScore ?? null,
          metadata: (entry.metadata as never) ?? null,
        },
      }),
    );
  }
}
