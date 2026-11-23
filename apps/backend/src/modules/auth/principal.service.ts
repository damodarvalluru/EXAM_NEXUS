import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES, PERMISSIONS, type Principal } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { latestValidStepUp, stepUpSessionKey, type AccessTokenPayload } from './token.service';

/**
 * Platform-wide permissions that do not require step-up or a tenant context.
 * Kept explicit so a global role can never silently inherit tenant-role rows.
 */
export const AUDITOR_PERMISSIONS: readonly string[] = [
  PERMISSIONS.PLATFORM_ORGANISATIONS_READ,
  PERMISSIONS.PLATFORM_USERS_READ,
  PERMISSIONS.PLATFORM_ROLES_READ,
  PERMISSIONS.PLATFORM_AUDIT_READ,
  PERMISSIONS.PLATFORM_AUTH_EVENTS_READ,
  PERMISSIONS.PLATFORM_SECURITY_READ,
  PERMISSIONS.PLATFORM_MONITORING_READ,
  PERMISSIONS.PLATFORM_REPORTS_READ,
  PERMISSIONS.PLATFORM_INTEGRATIONS_READ,
];

/** Operational staff may manage day-to-day platform data, not security or configuration. */
export const PLATFORM_STAFF_PERMISSIONS: readonly string[] = [
  PERMISSIONS.PLATFORM_ORGANISATIONS_READ,
  PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE,
  PERMISSIONS.PLATFORM_VERIFICATION_REVIEW,
  PERMISSIONS.PLATFORM_USERS_READ,
  PERMISSIONS.PLATFORM_USERS_MANAGE,
  PERMISSIONS.PLATFORM_ROLES_READ,
  PERMISSIONS.PLATFORM_AUDIT_READ,
  PERMISSIONS.PLATFORM_AUTH_EVENTS_READ,
  PERMISSIONS.PLATFORM_SECURITY_READ,
  PERMISSIONS.PLATFORM_MONITORING_READ,
  PERMISSIONS.PLATFORM_REPORTS_READ,
  PERMISSIONS.PLATFORM_INTEGRATIONS_READ,
  PERMISSIONS.PLATFORM_INTEGRATIONS_MANAGE,
  PERMISSIONS.PLATFORM_SUPPORT_MANAGE,
];

/** Returns explicit permissions for a global role, or null when none applies. */
export function permissionsForGlobalRole(globalRole: string | null): string[] | null {
  if (globalRole === 'SUPER_ADMIN') return ['*'];
  if (globalRole === 'PLATFORM_STAFF') return [...PLATFORM_STAFF_PERMISSIONS];
  if (globalRole === 'AUDITOR') return [...AUDITOR_PERMISSIONS];
  return null;
}

/**
 * Rebuilds the caller's identity from the database on every request.
 * Token claims are hints only — account status, session validity and tenant
 * membership are always re-verified against persistent state.
 */
@Injectable()
export class PrincipalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async resolve(payload: AccessTokenPayload): Promise<Principal> {
    // Step-up is bound to the session, so it survives an access-token refresh
    // until its own expiry. The claim in the token is also accepted as a fallback.
    const sessionStepUp = payload.sid
      ? await this.redis.client.get(stepUpSessionKey(payload.sid))
      : null;
    const stepUpVerifiedAt = latestValidStepUp(sessionStepUp, payload.sup);

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
      // Tenant roles may only carry organisation-scoped permissions. Filtering
      // here (as well as in the guard) prevents a planted platform.* row from
      // ever being treated as platform authority.
      const globalPermissions = permissionsForGlobalRole(user.globalRole);
      const permissions =
        globalPermissions ??
        assignments
          .flatMap((assignment) => assignment.role.permissions.map((link) => link.permission.key))
          .filter((key) => key.startsWith('org.'));

      return {
        userId: user.id,
        email: user.email,
        tenantId,
        globalRoles: user.globalRole ? [user.globalRole] : [],
        tenantRoles,
        permissions: [...new Set(permissions)],
        sessionId: session.id,
        authMethod: payload.am,
        stepUpVerifiedAt,
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
