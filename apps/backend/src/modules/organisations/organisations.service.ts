import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  PERMISSIONS,
  TENANT_ROLE_PERMISSIONS,
  type CandidateView,
  type MemberView,
  type OrganisationDetail,
  type OrganisationView,
  type RegisterOrganisationResult,
  type ReviewDecision,
  type RoleView,
} from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../../common/services/audit.service';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { AuthService } from '../auth/auth.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import type {
  AcceptInvitationDto,
  AssignRolesDto,
  CreateCandidateDto,
  CreateRoleDto,
  DocumentUploadDto,
  InviteUserDto,
  OrganisationQueryDto,
  RegisterDocumentDto,
  RegisterOrganisationDto,
  ReviewOrganisationDto,
  UpdateOrganisationDto,
  UpdateUserStatusDto,
  VerificationDocumentType,
} from './dto/organisation.dto';
import { VERIFICATION_DOCUMENT_TYPES } from './dto/organisation.dto';

const STATUS_BY_DECISION: Record<ReviewDecision, string> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_INFO: 'VERIFICATION_REQUIRED',
  SUSPEND: 'SUSPENDED',
  REACTIVATE: 'APPROVED',
};

/** MySQL stores the former Postgres `String[]` columns as JSON. */
function readDocumentKeys(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];
}

/** Tenant roles must never be able to carry platform-wide permissions. */
function assertTenantPermissionKeys(keys: readonly string[]): void {
  const unique = [...new Set(keys)];
  if (unique.some((key) => !key.startsWith('org.'))) {
    throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Tenant roles may only contain organisation-scoped permissions',
    });
  }
}

/** Belt-and-braces guard for callers that bypass the DTO validation pipe. */
function assertVerificationDocumentType(documentType: string): void {
  if (!VERIFICATION_DOCUMENT_TYPES.includes(documentType as VerificationDocumentType)) {
    throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `documentType must be one of ${VERIFICATION_DOCUMENT_TYPES.join(', ')}`,
    });
  }
}

function isSafeFileName(value: string): boolean {
  return Boolean(value)
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('..')
    && !value.includes('\0')
    && !/^[A-Za-z]:/.test(value)
    && basename(value) === value;
}

/** Object keys are single path segments: separators and traversal are never accepted. */
function assertSafeObjectKey(objectKey: string): void {
  if (!isSafeFileName(objectKey)) {
    throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Invalid document key',
    });
  }
}

/** Keep the download filename equal to the stored UUID portion of the key. */
function documentFileName(objectKey: string): string {
  const prefix = VERIFICATION_DOCUMENT_TYPES.find((type) => objectKey.startsWith(`${type}_`));
  return prefix ? objectKey.slice(prefix.length + 1) : objectKey;
}

/**
 * Historical uploads stored `<prefix>/<uuid>` as the object key but wrote the
 * file as `<prefix>_<uuid>`. Only these exact prefixes are grandfathered for
 * downloads; new uploads must keep using single-segment keys.
 */
const LEGACY_DOCUMENT_PREFIXES = [...VERIFICATION_DOCUMENT_TYPES, 'verification'] as const;

interface ResolvedDocumentKey {
  /** Filename inside the tenant's storage directory. */
  fileName: string;
  /** Name returned to the client. */
  downloadName: string;
}

function legacyDocumentKey(objectKey: string): ResolvedDocumentKey | null {
  if (typeof objectKey !== 'string' || !objectKey) return null;
  const separator = objectKey.indexOf('/');
  if (separator <= 0 || separator !== objectKey.lastIndexOf('/')) return null;
  const prefix = objectKey.slice(0, separator);
  const tail = objectKey.slice(separator + 1);
  if (!LEGACY_DOCUMENT_PREFIXES.includes(prefix as (typeof LEGACY_DOCUMENT_PREFIXES)[number])) return null;
  if (!isSafeFileName(tail) || !isSafeFileName(prefix)) return null;
  return { fileName: `${prefix}_${tail}`, downloadName: tail };
}

function resolveDocumentKey(objectKey: string): ResolvedDocumentKey {
  const legacy = legacyDocumentKey(objectKey);
  if (legacy) return legacy;
  assertSafeObjectKey(objectKey);
  return { fileName: objectKey, downloadName: documentFileName(objectKey) };
}

/** Both components must resolve to a real file below STORAGE_LOCAL_PATH. */
function resolveStorageFile(root: string, tenantId: string, fileName: string): string {
  const base = resolve(root);
  const target = resolve(base, tenantId, fileName);
  const inside = relative(base, target);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Invalid document key',
    });
  }
  return target;
}

@Injectable()
export class OrganisationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    // Optional so Redis-less unit tests can construct the service; all
    // failure-counter resets are best-effort.
    @Optional() private readonly rateLimit?: RateLimitService,
  ) {}

  // -------------------------------------------------------------------------
  // Registration and verification
  // -------------------------------------------------------------------------

  async register(dto: RegisterOrganisationDto): Promise<RegisterOrganisationResult> {
    const slug = dto.slug.toLowerCase();
    const officialEmail = dto.officialEmail.toLowerCase().trim();
    const adminEmail = dto.admin.email.toLowerCase().trim();

    const conflict = await this.prisma.withElevated(async (tx) => {
      const org = await tx.organisation.findFirst({
        where: {
          OR: [
            { slug },
            { officialEmail },
            ...(dto.registrationNumber ? [{ registrationNumber: dto.registrationNumber }] : []),
          ],
        },
      });
      const user = await tx.user.findUnique({ where: { email: adminEmail } });
      return Boolean(org || user);
    });
    if (conflict) {
      throw new ConflictException({
        code: ERROR_CODES.CONFLICT,
        message: 'An organisation or administrator with these details already exists',
      });
    }

    const passwordHash = await this.crypto.hashSecret(dto.admin.password);
    const organisation = await this.prisma.withElevated(async (tx) => {
      const created = await tx.organisation.create({
        data: {
          name: dto.name.trim(),
          slug,
          officialEmail,
          contactPhone: dto.contactPhone,
          registrationNumber: dto.registrationNumber,
          website: dto.website,
          address: (dto.address as Prisma.InputJsonValue) ?? undefined,
          status: 'SUBMITTED',
          verificationSubmittedAt: new Date(),
        },
      });
      const admin = await tx.user.create({
        data: {
          tenantId: created.id,
          email: adminEmail,
          passwordHash,
          status: 'PENDING_VERIFICATION',
        },
      });
      await tx.userProfile.create({
        data: {
          tenantId: created.id,
          userId: admin.id,
          firstName: dto.admin.firstName,
          lastName: dto.admin.lastName,
        },
      });
      await tx.organisationMembership.create({
        data: { tenantId: created.id, userId: admin.id, isPrimary: true, status: 'ACTIVE', joinedAt: new Date() },
      });
      await tx.organisationVerification.create({
        data: {
          tenantId: created.id,
          stage: 'INITIAL',
          status: 'PENDING',
          documentKeys: dto.documentKeys ?? [],
          notes: 'Submitted through the public onboarding form',
        },
      });
      await tx.subscription.create({
        data: {
          tenantId: created.id,
          plan: 'TRIAL',
          status: 'TRIAL',
          trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      const roleIds = await this.seedRoles(tx, created.id, admin.id);
      const adminRoleId = roleIds.get('ORG_ADMIN');
      if (!adminRoleId) throw new Error('ORG_ADMIN role seed failed');
      await tx.userRole.create({ data: { tenantId: created.id, userId: admin.id, roleId: adminRoleId } });
      await tx.notification.create({
        data: {
          tenantId: created.id,
          userId: admin.id,
          channel: 'EMAIL',
          recipient: adminEmail,
          subject: 'ExamNexus organisation registration received',
          body: `Organisation ${created.name} (${created.slug}) was submitted for verification.`,
        },
      });
      return created;
    });

    if (dto.documents?.length) {
      await this.storeRegistrationDocuments(organisation.id, dto.documents);
    }

    await this.audit.record({
      actorUserId: null,
      actorEmail: adminEmail,
      tenantId: organisation.id,
      action: 'organisation.register',
      resourceType: 'organisation',
      resourceId: organisation.id,
      newValues: { name: organisation.name, slug, status: organisation.status },
    });

    const emailToken = await this.auth.issueEmailVerification(
      await this.primaryAdminId(organisation.id),
      organisation.id,
    );
    const dev = this.config.get<string>('app.environment') !== 'production';
    return {
      organisationId: organisation.id,
      slug,
      status: organisation.status,
      ...(dev ? { emailVerificationToken: emailToken } : {}),
      ...(dev ? {} : { note: 'Verification email queued for delivery.' }),
    };
  }

  async acceptInvitation(dto: AcceptInvitationDto): Promise<{ success: true }> {
    const key = `invite:${this.crypto.sha256(dto.token)}`;
    const raw = await this.redis.client.get(key);
    if (!raw) {
      throw new ForbiddenException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Invitation is invalid or expired' });
    }
    const { userId, tenantId } = JSON.parse(raw) as { userId: string; tenantId: string };
    const passwordHash = await this.crypto.hashSecret(dto.password);
    const activated = await this.prisma.withElevated((tx) =>
      tx.user.update({
        where: { id: userId },
        data: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date(), passwordChangedAt: new Date() },
      }),
    );
    await this.clearLockoutCounters({ userId, email: activated.email, username: activated.username });
    await this.audit.record({
      actorUserId: userId,
      tenantId,
      action: 'user.accept_invitation',
      resourceType: 'user',
      resourceId: userId,
    });
    await this.redis.client.del(key);
    return { success: true };
  }

  async findBySlug(slug: string): Promise<OrganisationView> {
    const organisation = await this.prisma.withElevated((tx) =>
      tx.organisation.findFirst({ where: { slug: slug.toLowerCase(), deletedAt: null } }),
    );
    if (!organisation) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Organisation not found' });
    return this.toOrganisationView(organisation);
  }

  async list(query: OrganisationQueryDto): Promise<{ items: OrganisationView[]; total: number; page: number; pageSize: number }> {
    const where: Prisma.OrganisationWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status as Prisma.OrganisationWhereInput['status'] } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { slug: { contains: query.search } },
              { officialEmail: { contains: query.search } },
            ],
          }
        : {}),
    };
    return this.prisma.withElevated(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.organisation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.organisation.count({ where }),
      ]);
      return { items: rows.map((row) => this.toOrganisationView(row)), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async detail(id: string): Promise<OrganisationDetail> {
    const organisation = await this.prisma.withElevated(async (tx) => {
      const row = await tx.organisation.findFirst({
        where: { id, deletedAt: null },
        include: { verifications: { orderBy: { createdAt: 'desc' } } },
      });
      if (!row) return null;
      const [users, members, candidates, examinations, integrations] = await Promise.all([
        tx.user.count({ where: { tenantId: id } }),
        tx.organisationMembership.count({ where: { tenantId: id } }),
        tx.candidate.count({ where: { tenantId: id } }),
        tx.examination.count({ where: { tenantId: id } }),
        tx.integration.count({ where: { tenantId: id } }),
      ]);
      return { row, counts: { users, members, candidates, examinations, integrations } };
    });
    if (!organisation) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Organisation not found' });
    return {
      ...this.toOrganisationView(organisation.row),
      verifications: organisation.row.verifications.map((item) => ({
        id: item.id,
        stage: item.stage,
        status: item.status,
        documentKeys: readDocumentKeys(item.documentKeys),
        notes: item.notes,
        reviewerId: item.reviewerId,
        reviewedAt: item.reviewedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      counts: organisation.counts,
    };
  }

  async review(
    id: string,
    dto: ReviewOrganisationDto,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ): Promise<OrganisationDetail> {
    const current = await this.detail(id);
    const nextStatus = STATUS_BY_DECISION[dto.decision];
    const reactivatedUsers: Array<{ id: string; email: string; username: string | null }> = [];
    await this.prisma.withElevated(async (tx) => {
      await tx.organisation.update({
        where: { id },
        data: {
          status: nextStatus as Prisma.OrganisationUpdateInput['status'],
          approvedAt: dto.decision === 'APPROVE' || dto.decision === 'REACTIVATE' ? new Date() : current.approvedAt ? new Date(current.approvedAt) : null,
          suspendedAt: dto.decision === 'SUSPEND' ? new Date() : null,
        },
      });
      await tx.organisationVerification.create({
        data: {
          tenantId: id,
          stage: 'REVIEW',
          status: dto.decision,
          documentKeys: [],
          notes: dto.reason ?? null,
          reviewerId: principal?.userId ?? null,
          reviewedAt: new Date(),
        },
      });
      if (dto.decision === 'APPROVE' || dto.decision === 'REACTIVATE') {
        reactivatedUsers.push(
          ...(await tx.user.findMany({
            where: { tenantId: id, status: 'PENDING_VERIFICATION' },
            select: { id: true, email: true, username: true },
          })),
        );
        await tx.user.updateMany({
          where: { tenantId: id, status: 'PENDING_VERIFICATION' },
          data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
        });
      }
      if (dto.decision === 'SUSPEND' || dto.decision === 'REJECT') {
        await tx.user.updateMany({
          where: { tenantId: id, status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } },
          data: { status: 'SUSPENDED' },
        });
        await this.sessionsRevocationForTenant(id);
      }
      await tx.notification.create({
        data: {
          tenantId: id,
          channel: 'EMAIL',
          recipient: current.officialEmail,
          subject: `Organisation ${dto.decision.toLowerCase()}`,
          body: dto.reason ?? `Your organisation status is now ${nextStatus}.`,
        },
      });
    });
    for (const user of reactivatedUsers) {
      await this.clearLockoutCounters({ userId: user.id, email: user.email, username: user.username });
    }
    await this.audit.record({
      actorUserId: principal?.userId ?? null,
      actorEmail: principal?.email ?? null,
      tenantId: id,
      action: `organisation.review.${dto.decision.toLowerCase()}`,
      resourceType: 'organisation',
      resourceId: id,
      previousValues: { status: current.status },
      newValues: { status: nextStatus, reason: dto.reason ?? null },
      request,
    });
    return this.detail(id);
  }

  private async sessionsRevocationForTenant(tenantId: string): Promise<void> {
    await this.prisma.withElevated((tx) =>
      tx.userSession.updateMany({
        where: { tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Organisation administrator
  // -------------------------------------------------------------------------

  /** Profile-only contract for the tenant settings screen (OrganisationView). */
  async profile(tenantId: string): Promise<OrganisationView> {
    const organisation = await this.prisma.withTenant(tenantId, (tx) =>
      tx.organisation.findUniqueOrThrow({ where: { id: tenantId } }),
    );
    return this.toOrganisationView(organisation);
  }

  async dashboard(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const organisation = await tx.organisation.findUniqueOrThrow({ where: { id: tenantId } });
      const [
        users, activeUsers, candidates, verifiedCandidates, examinations, scheduledExaminations,
        liveExaminations, completedExaminations, integrations, connectedIntegrations,
        failedIntegrations, attempts, recentExaminations, roles,
      ] = await Promise.all([
        tx.user.count({ where: { tenantId } }),
        tx.user.count({ where: { tenantId, status: 'ACTIVE' } }),
        tx.candidate.count({ where: { tenantId } }),
        tx.candidate.count({ where: { tenantId, verifiedAt: { not: null } } }),
        tx.examination.count({ where: { tenantId } }),
        tx.examination.count({ where: { tenantId, status: 'SCHEDULED' } }),
        tx.examination.count({ where: { tenantId, status: 'LIVE' } }),
        tx.examination.count({ where: { tenantId, status: 'COMPLETED' } }),
        tx.integration.count({ where: { tenantId } }),
        tx.integration.count({ where: { tenantId, status: { in: ['CONNECTED', 'SYNC_ACTIVE'] } } }),
        tx.integration.count({ where: { tenantId, status: 'FAILED' } }),
        tx.examinationAttempt.count({ where: { tenantId } }),
        tx.examination.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, title: true, status: true, startsAt: true },
        }),
        tx.role.findMany({
          where: { tenantId },
          include: { _count: { select: { users: true } } },
          orderBy: { name: 'asc' },
        }),
      ]);
      return {
        organisation: this.toOrganisationView(organisation),
        counts: {
          users, activeUsers, candidates, verifiedCandidates, examinations, scheduledExaminations,
          liveExaminations, completedExaminations, integrations, connectedIntegrations,
          failedIntegrations, attempts,
        },
        recentExaminations: recentExaminations.map((exam) => ({
          id: exam.id,
          title: exam.title,
          status: exam.status,
          startsAt: exam.startsAt?.toISOString() ?? null,
        })),
        roleDistribution: roles.map((role) => ({ role: role.name, count: role._count.users })),
      };
    });
  }

  async updateProfile(tenantId: string, dto: UpdateOrganisationDto, principal: RequestWithContext['principal'], request: RequestWithContext) {
    const before = await this.prisma.withTenant(tenantId, (tx) =>
      tx.organisation.findUniqueOrThrow({ where: { id: tenantId } }),
    );
    const updated = await this.prisma.withTenant(tenantId, (tx) =>
      tx.organisation.update({
        where: { id: tenantId },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
          ...(dto.website !== undefined ? { website: dto.website } : {}),
          ...(dto.primaryColour !== undefined ? { primaryColour: dto.primaryColour } : {}),
          ...(dto.address !== undefined ? { address: dto.address as Prisma.InputJsonValue } : {}),
        },
      }),
    );
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'organisation.profile.update',
      resourceType: 'organisation',
      resourceId: tenantId,
      previousValues: { name: before.name, website: before.website },
      newValues: { name: updated.name, website: updated.website },
      request,
    });
    return this.toOrganisationView(updated);
  }

  async listMembers(tenantId: string, query: { page: number; pageSize: number; search?: string }): Promise<{ items: MemberView[]; total: number }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where: Prisma.OrganisationMembershipWhereInput = {
        tenantId,
        ...(query.search
          ? {
              user: {
                OR: [
                  { email: { contains: query.search } },
                  { profile: { firstName: { contains: query.search } } },
                ],
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.organisationMembership.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            user: {
              include: {
                profile: true,
                assignedRoles: { where: { tenantId }, include: { role: true } },
              },
            },
          },
        }),
        tx.organisationMembership.count({ where }),
      ]);
      return {
        total,
        items: rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          email: row.user.email,
          firstName: row.user.profile?.firstName ?? null,
          lastName: row.user.profile?.lastName ?? null,
          status: row.user.status,
          roles: row.user.assignedRoles.map((assignment) => assignment.role.name),
          isPrimary: row.isPrimary,
          joinedAt: row.joinedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  }

  async inviteUser(
    tenantId: string,
    dto: InviteUserDto,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ): Promise<{ userId: string; inviteToken?: string }> {
    const email = dto.email.toLowerCase().trim();
    // users.email is globally unique; a tenant-scoped duplicate check cannot
    // see an account owned by another organisation and would surface as a 500.
    const duplicate = await this.prisma.withElevated((tx) =>
      tx.user.findUnique({ where: { email }, select: { id: true } }),
    );
    if (duplicate) {
      throw new ConflictException({
        code: ERROR_CODES.CONFLICT,
        message: 'A user with this email already exists. Use a different address or ask the existing account holder to join.',
      });
    }

    let user: { id: string };
    try {
      user = await this.prisma.withTenant(tenantId, async (tx) => {
        const roles = await tx.role.findMany({ where: { tenantId, name: { in: dto.roleNames } } });
        if (roles.length !== new Set(dto.roleNames).size) {
          throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'One or more roles do not exist' });
        }
        const created = await tx.user.create({
          data: {
            tenantId,
            email,
            passwordHash: await this.crypto.hashSecret(this.crypto.randomToken(32)),
            status: 'PENDING_VERIFICATION',
          },
        });
        await tx.userProfile.create({
          data: { tenantId, userId: created.id, firstName: dto.firstName, lastName: dto.lastName },
        });
        await tx.organisationMembership.create({
          data: { tenantId, userId: created.id, status: 'ACTIVE', invitedBy: principal?.userId ?? null },
        });
        await tx.userRole.createMany({
          data: roles.map((role) => ({ tenantId, userId: created.id, roleId: role.id })),
        });
        return created;
      });
    } catch (error) {
      // Close the check-then-insert race without leaking a raw Prisma 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'A user with this email already exists. Use a different address or ask the existing account holder to join.',
        });
      }
      throw error;
    }

    const token = this.crypto.randomToken(32);
    await this.redis.client.set(
      `invite:${this.crypto.sha256(token)}`,
      JSON.stringify({ userId: user.id, tenantId }),
      'EX',
      7 * 24 * 60 * 60,
    );
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'user.invite',
      resourceType: 'user',
      resourceId: user.id,
      newValues: { email, roles: dto.roleNames },
      request,
    });
    const dev = this.config.get<string>('app.environment') !== 'production';
    return { userId: user.id, ...(dev ? { inviteToken: token } : {}) };
  }

  async updateUserStatus(
    tenantId: string,
    userId: string,
    dto: UpdateUserStatusDto,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ): Promise<{ success: true }> {
    if (principal?.userId === userId) {
      throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'You cannot change your own status' });
    }
    const target: Array<{ email: string; username: string | null }> = [];
    await this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertActiveMembership(tx, tenantId, userId);
      target.push(
        ...(await tx.user.findMany({
          where: { id: userId, tenantId },
          select: { email: true, username: true },
          take: 1,
        })),
      );
      const updated = await tx.user.updateMany({
        where: { id: userId, tenantId },
        data: {
          status: dto.status as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
          // A reactivated account must not inherit a stale lockout.
          ...(dto.status === 'ACTIVE' ? { lockedUntil: null, failedLoginCount: 0 } : {}),
        },
      });
      if (updated.count === 0) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'User not found' });
      }
    });
    if (dto.status === 'ACTIVE' && target[0]) {
      await this.clearLockoutCounters({ userId, ...target[0] });
    }
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'user.status.update',
      resourceType: 'user',
      resourceId: userId,
      newValues: { status: dto.status },
      request,
    });
    return { success: true };
  }

  async assignRoles(
    tenantId: string,
    userId: string,
    dto: AssignRolesDto,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ): Promise<{ roles: string[] }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertActiveMembership(tx, tenantId, userId);
      const roles = await tx.role.findMany({ where: { tenantId, name: { in: dto.roleNames } } });
      if (roles.length !== new Set(dto.roleNames).size) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'One or more roles do not exist' });
      }
      await tx.userRole.deleteMany({ where: { tenantId, userId } });
      await tx.userRole.createMany({
        data: roles.map((role) => ({ tenantId, userId, roleId: role.id })),
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'user.roles.update',
      resourceType: 'user',
      resourceId: userId,
      newValues: { roles: dto.roleNames },
      request,
    });
    return { roles: dto.roleNames };
  }

  // -------------------------------------------------------------------------
  // Roles and permissions
  // -------------------------------------------------------------------------

  async permissions() {
    return this.prisma.withElevated((tx) =>
      tx.permission.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] }),
    );
  }

  async listRoles(tenantId: string): Promise<RoleView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const roles = await tx.role.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
        include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      });
      return roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: role.permissions.map((link) => link.permission.key),
        memberCount: role._count.users,
        createdAt: role.createdAt.toISOString(),
      }));
    });
  }

  async createRole(
    tenantId: string,
    dto: CreateRoleDto,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ): Promise<RoleView> {
    const role = await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.role.findFirst({ where: { tenantId, name: dto.name } });
      if (existing) throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Role name already exists' });
      assertTenantPermissionKeys(dto.permissions);
      const permissions = await tx.permission.findMany({ where: { key: { in: dto.permissions } } });
      if (permissions.length !== new Set(dto.permissions).size) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Unknown permission key' });
      }
      const created = await tx.role.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description,
          createdBy: principal?.userId ?? null,
          permissions: {
            create: permissions.map((permission) => ({ tenantId, permissionId: permission.id })),
          },
        },
      });
      return created;
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'role.create',
      resourceType: 'role',
      resourceId: role.id,
      newValues: { name: role.name, permissions: dto.permissions },
      request,
    });
    return (await this.listRoles(tenantId)).find((item) => item.id === role.id)!;
  }

  async updateRole(tenantId: string, roleId: string, dto: CreateRoleDto, principal: RequestWithContext['principal'], request: RequestWithContext): Promise<RoleView> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, tenantId } });
      if (!role) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Role not found' });
      if (role.isSystem) throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'System roles cannot be modified' });
      assertTenantPermissionKeys(dto.permissions);
      const permissions = await tx.permission.findMany({ where: { key: { in: dto.permissions } } });
      if (permissions.length !== new Set(dto.permissions).size) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Unknown permission key' });
      }
      await tx.role.update({ where: { id: roleId }, data: { name: dto.name, description: dto.description } });
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({ tenantId, roleId, permissionId: permission.id })),
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'role.update',
      resourceType: 'role',
      resourceId: roleId,
      newValues: { name: dto.name, permissions: dto.permissions },
      request,
    });
    return (await this.listRoles(tenantId)).find((item) => item.id === roleId)!;
  }

  async deleteRole(tenantId: string, roleId: string, principal: RequestWithContext['principal'], request: RequestWithContext): Promise<{ success: true }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, tenantId } });
      if (!role) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Role not found' });
      if (role.isSystem) throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'System roles cannot be deleted' });
      await tx.role.delete({ where: { id: roleId } });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'role.delete',
      resourceType: 'role',
      resourceId: roleId,
      request,
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Candidates
  // -------------------------------------------------------------------------

  async listCandidates(tenantId: string, query: { page: number; pageSize: number; search?: string }): Promise<{ items: CandidateView[]; total: number }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where: Prisma.CandidateWhereInput = {
        tenantId,
        ...(query.search
          ? {
              OR: [
                { candidateCode: { contains: query.search } },
                { email: { contains: query.search } },
                { firstName: { contains: query.search } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.candidate.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.candidate.count({ where }),
      ]);
      return {
        total,
        items: rows.map((row) => ({
          id: row.id,
          candidateCode: row.candidateCode,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: row.phone,
          status: row.status,
          verifiedAt: row.verifiedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  }

  async createCandidate(
    tenantId: string,
    dto: CreateCandidateDto,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ): Promise<CandidateView> {
    const candidate = await this.prisma.withTenant(tenantId, (tx) =>
      tx.candidate.create({
        data: {
          tenantId,
          candidateCode: dto.candidateCode,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email.toLowerCase(),
          phone: dto.phone,
        },
      }),
    );
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'candidate.create',
      resourceType: 'candidate',
      resourceId: candidate.id,
      newValues: { candidateCode: candidate.candidateCode, email: candidate.email },
      request,
    });
    return {
      id: candidate.id,
      candidateCode: candidate.candidateCode,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone,
      status: candidate.status,
      verifiedAt: null,
      createdAt: candidate.createdAt.toISOString(),
    };
  }

  async updateCandidateStatus(
    tenantId: string,
    candidateId: string,
    status: string,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ): Promise<{ success: true }> {
    const updated = await this.prisma.withTenant(tenantId, (tx) =>
      tx.candidate.updateMany({ where: { id: candidateId, tenantId }, data: { status } }),
    );
    if (updated.count === 0) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Candidate not found' });
    }
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'candidate.status.update',
      resourceType: 'candidate',
      resourceId: candidateId,
      newValues: { status },
      request,
    });
    return { success: true };
  }

  // -------------------------------------------------------------------------
  // Verification documents (local disk adapter; replace with S3 in production)
  // -------------------------------------------------------------------------

  private async storeRegistrationDocuments(tenantId: string, documents: RegisterDocumentDto[]): Promise<void> {
    if (documents.length > 5) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'A maximum of five verification documents may be submitted',
      });
    }
    const root = this.config.getOrThrow<string>('storage.localPath');
    const directory = join(root, tenantId);
    await mkdir(directory, { recursive: true });

    const objectKeys: string[] = [];
    for (const document of documents) {
      const bytes = Buffer.from(document.contentBase64, 'base64');
      if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Document ${document.fileName} must be between 1 byte and 10 MB`,
        });
      }
      assertVerificationDocumentType(document.documentType);
      const objectKey = `${document.documentType}_${randomUUID()}`;
      await writeFile(join(directory, basename(objectKey)), bytes);
      objectKeys.push(objectKey);
      await this.prisma.withElevated((tx) =>
        tx.fileObject.create({
          data: {
            tenantId,
            objectKey,
            bucket: 'local',
            mimeType: document.mimeType ?? 'application/octet-stream',
            sizeBytes: BigInt(bytes.byteLength),
            purpose: `verification:${document.documentType}`,
            uploadedBy: null,
          },
        }),
      );
    }
    await this.prisma.withTenant(tenantId, async (tx) => {
      const verification = await tx.organisationVerification.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      if (verification) {
        await tx.organisationVerification.update({
          where: { id: verification.id },
          data: { documentKeys: [...readDocumentKeys(verification.documentKeys), ...objectKeys] },
        });
      }
    });
  }

  async uploadDocument(
    tenantId: string,
    organisationId: string,
    dto: DocumentUploadDto,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ): Promise<{ objectKey: string; documentType: string }> {
    if (tenantId !== organisationId) {
      throw new ForbiddenException({ code: ERROR_CODES.TENANT_ACCESS_DENIED, message: 'Cross-tenant document upload denied' });
    }
    const bytes = Buffer.from(dto.contentBase64, 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Document must be between 1 byte and 10 MB' });
    }
    assertVerificationDocumentType(dto.documentType);
    const root = this.config.getOrThrow<string>('storage.localPath');
    const directory = join(root, tenantId);
    await mkdir(directory, { recursive: true });
    const objectKey = `${dto.documentType}_${randomUUID()}`;
    await writeFile(join(directory, basename(objectKey)), bytes);

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.fileObject.create({
        data: {
          tenantId,
          objectKey,
          bucket: 'local',
          mimeType: dto.mimeType ?? 'application/octet-stream',
          sizeBytes: BigInt(bytes.byteLength),
          purpose: `verification:${dto.documentType}`,
          uploadedBy: principal?.userId ?? null,
        },
      });
      const verification = await tx.organisationVerification.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      if (verification) {
        await tx.organisationVerification.update({
          where: { id: verification.id },
          data: { documentKeys: [...readDocumentKeys(verification.documentKeys), objectKey] },
        });
      }
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'organisation.document.upload',
      resourceType: 'file_object',
      resourceId: objectKey,
      newValues: { documentType: dto.documentType, fileName: dto.fileName, sizeBytes: bytes.byteLength },
      request,
    });
    return { objectKey, documentType: dto.documentType };
  }

  async readDocument(
    tenantId: string | null,
    organisationId: string,
    objectKey: string,
  ): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    if (tenantId && tenantId !== organisationId) {
      throw new ForbiddenException({ code: ERROR_CODES.TENANT_ACCESS_DENIED, message: 'Cross-tenant document access denied' });
    }
    const documentKey = resolveDocumentKey(objectKey);
    const file = await this.prisma.withElevated((tx) =>
      tx.fileObject.findFirst({ where: { tenantId: organisationId, objectKey } }),
    );
    if (!file) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Document not found' });
    const root = this.config.getOrThrow<string>('storage.localPath');
    const bytes = await readFile(resolveStorageFile(root, organisationId, documentKey.fileName));
    return { bytes, mimeType: file.mimeType, fileName: documentKey.downloadName };
  }

  // -------------------------------------------------------------------------

  /** Best-effort; a missing Redis dependency must never fail a reactivation. */
  private async clearLockoutCounters(identity: { userId: string; email?: string | null; username?: string | null }) {
    await this.rateLimit?.clearUserFailures?.(identity);
  }

  /** A userId is only actionable when it has a live membership in this tenant. */
  private async assertActiveMembership(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const membership = await tx.organisationMembership.findFirst({
      where: { tenantId, userId, status: 'ACTIVE' },
    });
    if (!membership) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'User is not an active member of this organisation',
      });
    }
  }

  private async primaryAdminId(tenantId: string): Promise<string> {
    const membership = await this.prisma.withElevated((tx) =>
      tx.organisationMembership.findFirst({ where: { tenantId, isPrimary: true } }),
    );
    if (!membership) throw new Error('Primary administrator was not created');
    return membership.userId;
  }

  private async seedRoles(
    tx: Prisma.TransactionClient,
    tenantId: string,
    creatorId: string,
  ): Promise<Map<string, string>> {
    const permissions = await tx.permission.findMany();
    const byKey = new Map(permissions.map((permission) => [permission.key, permission.id]));
    const ids = new Map<string, string>();
    for (const [name, keys] of Object.entries(TENANT_ROLE_PERMISSIONS)) {
      const role = await tx.role.create({
        data: { tenantId, name, isSystem: true, createdBy: creatorId },
      });
      ids.set(name, role.id);
      const links = keys.flatMap((key) => {
        const permissionId = byKey.get(key);
        return permissionId ? [{ tenantId, roleId: role.id, permissionId }] : [];
      });
      if (links.length) await tx.rolePermission.createMany({ data: links });
    }
    return ids;
  }

  private toOrganisationView(row: {
    id: string;
    name: string;
    slug: string;
    registrationNumber: string | null;
    officialEmail: string;
    contactPhone: string | null;
    website: string | null;
    logoKey: string | null;
    primaryColour: string | null;
    address: Prisma.JsonValue;
    status: string;
    verificationSubmittedAt: Date | null;
    approvedAt: Date | null;
    suspendedAt: Date | null;
    createdAt: Date;
  }): OrganisationView {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      registrationNumber: row.registrationNumber,
      officialEmail: row.officialEmail,
      contactPhone: row.contactPhone,
      website: row.website,
      logoKey: row.logoKey,
      primaryColour: row.primaryColour,
      address: row.address,
      status: row.status as OrganisationView['status'],
      verificationSubmittedAt: row.verificationSubmittedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
