import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES, type Principal } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import type { AccessTokenPayload } from './token.service';

/**
 * Rebuilds the caller's identity from the database on every request.
 * Token claims are hints only — account status, session validity and tenant
 * membership are always re-verified against persistent state.
 */
@Injectable()
export class PrincipalService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(payload: AccessTokenPayload): Promise<Principal> {
    const principal = await this.prisma.withElevated(async (tx) => {
      const session = await tx.userSession.findUnique({ where: { id: payload.sid } });
      if (
        !session ||
        session.userId !== payload.sub ||
        session.revokedAt ||
        session.expiresAt <= new Date()
      ) {
        return null;
      }

      const user = await tx.user.findFirst({
        where: { id: payload.sub, deletedAt: null },
        include: { profile: true },
      });
      if (!user || user.status !== 'ACTIVE') return null;

      let tenantId = payload.tid;
      if (tenantId) {
        const membership = await tx.organisationMembership.findFirst({
          where: { tenantId, userId: user.id, status: 'ACTIVE' },
        });
        if (!membership) return null;
        const organisation = await tx.organisation.findFirst({
          where: { id: tenantId, status: 'APPROVED', deletedAt: null },
        });
        if (!organisation) return null;
      }

      const assignments = tenantId
        ? await tx.userRole.findMany({
            where: { tenantId, userId: user.id },
            include: { role: { include: { permissions: { include: { permission: true } } } } },
          })
        : [];

      const tenantRoles = assignments.map((assignment) => assignment.role.name);
      const permissions =
        user.globalRole === 'SUPER_ADMIN'
          ? ['*']
          : assignments.flatMap((assignment) =>
              assignment.role.permissions.map((link) => link.permission.key),
            );

      return {
        userId: user.id,
        email: user.email,
        tenantId,
        globalRoles: user.globalRole ? [user.globalRole] : [],
        tenantRoles,
        permissions: [...new Set(permissions)],
        sessionId: session.id,
        authMethod: payload.am,
        stepUpVerifiedAt: payload.sup ?? null,
        profile: user.profile
          ? { firstName: user.profile.firstName, lastName: user.profile.lastName }
          : null,
      } satisfies Principal & {
        profile: { firstName: string | null; lastName: string | null } | null;
      };
    });

    if (!principal) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Session is no longer valid',
      });
    }
    return principal;
  }
}
