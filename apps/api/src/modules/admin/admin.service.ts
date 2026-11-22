import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, type PlatformOverview } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../../common/services/audit.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import type {
  AdminQueryDto,
  CreatePlatformUserDto,
  RotatePinDto,
  UpdatePlatformUserRoleDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async overview(): Promise<PlatformOverview> {
    return this.prisma.withElevated(async (tx) => {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [
        orgTotal, orgByStatus, userTotal, activeUsers, superAdmins, examTotal,
        examByStatus, attempts, integrationByStatus, authLast24, authByOutcome,
        auditLast24,
      ] = await Promise.all([
        tx.organisation.count({ where: { deletedAt: null } }),
        tx.organisation.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.user.count({ where: { deletedAt: null } }),
        tx.user.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        tx.user.count({ where: { globalRole: 'SUPER_ADMIN', deletedAt: null } }),
        tx.examination.count(),
        tx.examination.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.examinationAttempt.count(),
        tx.integration.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.authenticationEvent.count({ where: { createdAt: { gte: dayAgo } } }),
        tx.authenticationEvent.groupBy({ by: ['outcome'], _count: { _all: true } }),
        tx.auditLog.count({ where: { createdAt: { gte: dayAgo } } }),
      ]);

      const statusCount = (rows: Array<{ status: string; _count: { _all: number } }>, status: string) =>
        rows.find((row) => row.status === status)?._count._all ?? 0;

      return {
        organisations: {
          total: orgTotal,
          verified: statusCount(orgByStatus, 'APPROVED'),
          pending: orgByStatus
            .filter((row) => ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED'].includes(row.status))
            .reduce((sum, row) => sum + row._count._all, 0),
          suspended: statusCount(orgByStatus, 'SUSPENDED'),
          byStatus: orgByStatus.map((row) => ({ status: row.status, count: row._count._all })),
        },
        users: { total: userTotal, active: activeUsers, superAdmins },
        examinations: {
          total: examTotal,
          live: statusCount(examByStatus, 'LIVE'),
          scheduled: statusCount(examByStatus, 'SCHEDULED'),
          completed: statusCount(examByStatus, 'COMPLETED'),
          cancelled: statusCount(examByStatus, 'CANCELLED'),
          attempts,
        },
        integrations: {
          total: integrationByStatus.reduce((sum, row) => sum + row._count._all, 0),
          connected: ['CONNECTED', 'SYNC_ACTIVE'].reduce((sum, status) => sum + statusCount(integrationByStatus, status), 0),
          pending: ['CONFIGURATION_PENDING', 'AUTHENTICATION_PENDING', 'VERIFICATION_PENDING'].reduce(
            (sum, status) => sum + statusCount(integrationByStatus, status),
            0,
          ),
          failed: statusCount(integrationByStatus, 'FAILED'),
        },
        authentication: {
          last24Hours: authLast24,
          failedLast24Hours: authByOutcome.find((row) => row.outcome === 'FAILURE')?._count._all ?? 0,
          byOutcome: authByOutcome.map((row) => ({ outcome: row.outcome, count: row._count._all })),
        },
        audit: { last24Hours: auditLast24 },
      };
    });
  }

  async listUsers(query: AdminQueryDto): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    return this.prisma.withElevated(async (tx) => {
      const where: Prisma.UserWhereInput = {
        deletedAt: null,
        ...(query.status ? { status: query.status as Prisma.UserWhereInput['status'] } : {}),
        ...(query.search
          ? {
              OR: [
                { email: { contains: query.search, mode: 'insensitive' } },
                { username: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true, email: true, username: true, globalRole: true, status: true,
            tenantId: true, lastLoginAt: true, createdAt: true,
            mfaMethods: { where: { enabled: true }, select: { type: true } },
          },
        }),
        tx.user.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          email: row.email,
          username: row.username,
          globalRole: row.globalRole,
          status: row.status,
          tenantId: row.tenantId,
          lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          mfaEnabled: row.mfaMethods.length > 0,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async updateUserStatus(
    userId: string,
    status: string,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ): Promise<{ success: true }> {
    if (principal?.userId === userId) {
      throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'You cannot change your own status' });
    }
    const user = await this.prisma.withElevated((tx) =>
      tx.user.findFirst({ where: { id: userId, deletedAt: null } }),
    );
    if (!user) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'User not found' });

    await this.prisma.withElevated(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: status as Prisma.UserUpdateInput['status'] },
      });
      if (status === 'SUSPENDED' || status === 'LOCKED') {
        await tx.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId: user.tenantId,
      action: 'platform.user.status.update',
      resourceType: 'user',
      resourceId: userId,
      previousValues: { status: user.status },
      newValues: { status },
      request,
    });
    return { success: true };
  }

  async permissions() {
    return this.prisma.withElevated((tx) =>
      tx.permission.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] }),
    );
  }

  async roles(query: AdminQueryDto): Promise<{ items: unknown[]; total: number }> {
    return this.prisma.withElevated(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.role.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            organisation: { select: { name: true, slug: true } },
            _count: { select: { users: true, permissions: true } },
          },
        }),
        tx.role.count(),
      ]);
      return {
        total,
        items: rows.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          organisation: role.organisation.name,
          organisationSlug: role.organisation.slug,
          memberCount: role._count.users,
          permissionCount: role._count.permissions,
          createdAt: role.createdAt.toISOString(),
        })),
      };
    });
  }

  async authEvents(query: AdminQueryDto) {
    return this.prisma.withElevated(async (tx) => {
      const where: Prisma.AuthenticationEventWhereInput = {
        ...(query.outcome ? { outcome: query.outcome as Prisma.AuthenticationEventWhereInput['outcome'] } : {}),
        ...(query.method ? { method: query.method as Prisma.AuthenticationEventWhereInput['method'] } : {}),
        ...(query.search ? { email: { contains: query.search, mode: 'insensitive' } } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.authenticationEvent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.authenticationEvent.count({ where }),
      ]);
      return {
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: rows.map((row) => ({
          id: row.id,
          email: row.email,
          method: row.method,
          outcome: row.outcome,
          ip: row.ip,
          location: row.location,
          metadata: row.metadata,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  }

  async auditLogs(query: AdminQueryDto) {
    return this.prisma.withElevated(async (tx) => {
      const where: Prisma.AuditLogWhereInput = {
        ...(query.outcome ? { outcome: query.outcome as Prisma.AuditLogWhereInput['outcome'] } : {}),
        ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        ...(query.search ? { actorEmail: { contains: query.search, mode: 'insensitive' } } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.auditLog.count({ where }),
      ]);
      return {
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: rows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          actorEmail: row.actorEmail,
          action: row.action,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          outcome: row.outcome,
          ip: row.ip,
          correlationId: row.correlationId,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  }

  async createPlatformUser(
    dto: CreatePlatformUserDto,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ) {
    const passwordHash = await this.crypto.hashSecret(dto.password);
    let user;
    try {
      user = await this.prisma.withElevated((tx) =>
        tx.user.create({
          data: {
            email: dto.email.trim().toLowerCase(),
            username: dto.username?.trim() || null,
            passwordHash,
            globalRole: dto.globalRole,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            passwordChangedAt: new Date(),
          },
          select: {
            id: true,
            email: true,
            username: true,
            globalRole: true,
            status: true,
            createdAt: true,
          },
        }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Email or username already exists' });
      }
      throw error;
    }
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      action: 'platform.user.created',
      resourceType: 'user',
      resourceId: user.id,
      newValues: { email: user.email, globalRole: user.globalRole },
      request,
    });
    return user;
  }

  async updatePlatformUserRole(
    userId: string,
    dto: UpdatePlatformUserRoleDto,
    principal: RequestWithContext['principal'],
    request: RequestWithContext,
  ) {
    const user = await this.prisma.withElevated(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { id: userId, globalRole: { not: null }, deletedAt: null },
        select: { id: true, globalRole: true },
      });
      if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Platform user not found' });
      return tx.user.update({
        where: { id: userId },
        data: { globalRole: dto.globalRole },
        select: { id: true, email: true, globalRole: true, status: true },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      action: 'platform.user.role_changed',
      resourceType: 'user',
      resourceId: user.id,
      previousValues: { globalRole: user.globalRole },
      newValues: { globalRole: dto.globalRole },
      request,
    });
    return user;
  }

  async rotatePin(userId: string, dto: RotatePinDto, principal: RequestWithContext['principal'], request: RequestWithContext) {
    const pinHash = await this.crypto.hashSecret(dto.newPin);
    await this.prisma.withElevated(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, globalRole: 'SUPER_ADMIN', deletedAt: null } });
      if (!user) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Super Admin not found' });
      await tx.superAdminCredential.upsert({
        where: { userId },
        update: { pinHash, pinUpdatedAt: new Date(), rotationRequired: false, failedAttempts: 0, lockedUntil: null },
        create: { userId, pinHash },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      action: 'platform.super_admin.pin_rotated',
      resourceType: 'super_admin_credential',
      resourceId: userId,
      newValues: { rotated: true },
      request,
    });
    return { success: true };
  }
}
