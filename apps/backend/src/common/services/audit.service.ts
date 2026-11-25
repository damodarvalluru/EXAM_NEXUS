import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestWithContext } from '../middleware/request-context.middleware';
import { PrismaService } from '../../database/prisma.service';
import { runInTenantScope, tenantScopeStorage } from '../../database/tenant-scope';
import type { AuditOutcome } from '@examnexus/shared';

export interface AuditEntry {
  actorUserId?: string | null;
  actorEmail?: string | null;
  tenantId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  previousValues?: unknown;
  newValues?: unknown;
  outcome?: AuditOutcome;
  request?: RequestWithContext | null;
  sessionId?: string | null;
}

/**
 * Audit writes are always made in an elevated scope so a tenant context can
 * never suppress evidence of its own misuse. When the caller is already inside
 * a scoped transaction, the same transaction is reused under an elevated scope
 * instead of opening a nested transaction (which deadlocks on TiDB Cloud).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const data = {
      actorUserId: entry.actorUserId ?? null,
      actorEmail: entry.actorEmail ?? null,
      tenantId: entry.tenantId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      previousValues: (entry.previousValues as never) ?? null,
      newValues: (entry.newValues as never) ?? null,
      outcome: entry.outcome ?? 'SUCCESS',
      ip: entry.request?.ip ?? null,
      userAgent: entry.request?.header('user-agent') ?? null,
      sessionId: entry.sessionId ?? entry.request?.principal?.sessionId ?? null,
      correlationId: (() => {
        const supplied = entry.request?.header('x-correlation-id');
        return supplied && /^[a-zA-Z0-9._:-]{1,120}$/.test(supplied) ? supplied : null;
      })(),
      requestId: entry.request?.requestId ?? null,
    };

    const scope = tenantScopeStorage.getStore();
    const activeTx = scope?.tx as Prisma.TransactionClient | undefined;
    if (activeTx) {
      // Reuse the caller's transaction. Opening a second transaction here would
      // contend with the first on TiDB and produce lock-wait timeouts.
      await runInTenantScope({ tenantId: null, elevated: true, tx: activeTx }, () =>
        activeTx.auditLog.create({ data }),
      );
      return;
    }

    await this.prisma.withElevated((tx) => tx.auditLog.create({ data }));
  }
}
