import { Injectable } from '@nestjs/common';
import type { RequestWithContext } from '../middleware/request-context.middleware';
import { PrismaService } from '../../database/prisma.service';
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
 * Audit writes are always made in an elevated transaction so a tenant context
 * can never suppress evidence of its own misuse. Tenant scope is stored on the
 * row and enforced on reads by RLS.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.withElevated((tx) =>
      tx.auditLog.create({
        data: {
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
        },
      }),
    );
  }
}
