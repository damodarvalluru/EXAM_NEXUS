import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  type AuthMethod,
  type LoginResult,
  type MfaEnrollment,
  type RecoveryCodesResult,
  type StepUpResult,
  type UserView,
} from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TotpService } from '../../common/crypto/totp.service';
import { AuditService } from '../../common/services/audit.service';
import { AuthEventService } from '../../common/services/auth-event.service';
import { RateLimitService } from '../../common/services/rate-limit.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { SessionService } from './session.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  STEP_UP_TTL_SECONDS,
  TokenService,
} from './token.service';
import type {
  ChangePasswordDto,
  LoginDto,
  MfaVerifyDto,
  PinLoginDto,
  StepUpDto,
} from './dto/auth.dto';

type AuthUser = Prisma.UserGetPayload<{
  include: { profile: true; mfaMethods: true; superAdminPin: true; memberships: true; recoveryCodes: true };
}>;

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** Internal shape: refresh tokens are never serialised into a response body. */
export interface AuthOutcome<T> {
  result: T;
  refreshToken?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly authEvents: AuthEventService,
    private readonly config: ConfigService,
  ) {
    // Equalise verification cost for unknown identifiers.
    this.dummyHash = this.crypto.hashSecret('not-a-real-password-9f8e7d6c');
  }

  async login(dto: LoginDto, request: RequestWithContext): Promise<AuthOutcome<LoginResult>> {
    const identifier = dto.identifier.trim().toLowerCase();
    const key = `${request.ip ?? 'unknown'}:${identifier}`;
    await this.rateLimit.consume('login', key, 10, 300);

    const user = await this.findUser(identifier);
    const passwordValid = await this.crypto.verifySecret(
      user?.passwordHash ?? (await this.dummyHash),
      dto.password,
    );

    if (!user || !passwordValid || !user.passwordHash || this.isLocked(user)) {
      if (user && !passwordValid && !this.isLocked(user)) {
        await this.registerFailure(user, 'login', key, request);
      }
      await this.authEvents.record({
        userId: user?.id ?? null,
        tenantId: user?.tenantId ?? null,
        email: user?.email ?? identifier,
        method: 'PASSWORD',
        outcome: 'FAILURE',
        request,
      });
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Invalid credentials or account unavailable',
      });
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Account is not active',
      });
    }

    await this.onSuccess(user, 'login', key, request);
    return this.issueLogin(user, 'PASSWORD', request);
  }

  async pinLogin(dto: PinLoginDto, request: RequestWithContext): Promise<AuthOutcome<LoginResult>> {
    const identifier = dto.identifier.trim().toLowerCase();
    const key = `${request.ip ?? 'unknown'}:${identifier}`;
    await this.rateLimit.consume('pin', key, 5, 300);

    const user = await this.findUser(identifier);
    const pinValid =
      user?.superAdminPin && !this.isPinLocked(user.superAdminPin)
        ? await this.crypto.verifySecret(user.superAdminPin.pinHash, dto.pin)
        : await this.crypto.verifySecret(await this.dummyHash, dto.pin);

    const allowed = Boolean(
      user && user.globalRole === 'SUPER_ADMIN' && user.superAdminPin && pinValid && !this.isPinLocked(user.superAdminPin),
    );
    if (!allowed || !user) {
      if (user?.superAdminPin) {
        await this.registerPinFailure(user, key, request);
      }
      await this.authEvents.record({
        userId: user?.id ?? null,
        email: user?.email ?? identifier,
        method: 'PIN',
        outcome: 'FAILURE',
        request,
        metadata: { reason: 'invalid_pin_or_not_super_admin' },
      });
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Invalid PIN or account unavailable',
      });
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'Account is not active' });
    }

    await this.onSuccess(user, 'pin', key, request);
    if (!user.mfaMethods.some((method) => method.enabled && method.type === 'TOTP')) {
      // PIN login for a Super Admin without MFA is refused; MFA is mandatory.
      throw new ForbiddenException({
        code: ERROR_CODES.STEP_UP_REQUIRED,
        message: 'A TOTP factor must be enrolled before PIN authentication can be used',
      });
    }
    return this.issueLogin(user, 'PIN', request);
  }

  async verifyMfa(dto: MfaVerifyDto, request: RequestWithContext): Promise<AuthOutcome<{
    accessToken: string;
    expiresIn: number;
    user: UserView;
  }>> {
    if (!dto.code && !dto.recoveryCode) {
      throw new ForbiddenException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Provide a TOTP code or a recovery code',
      });
    }
    const challenge = await this.tokens.verifyChallenge(dto.challengeToken);
    await this.rateLimit.consume('mfa', challenge.sub, 8, 300);
    const user = await this.findUserById(challenge.sub);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Account unavailable' });
    }

    let accepted = false;
    if (dto.code) {
      const method = user.mfaMethods.find((item) => item.enabled && item.type === 'TOTP' && item.secretEncrypted);
      if (method?.secretEncrypted) {
        accepted = this.totp.verify(this.crypto.decrypt(method.secretEncrypted), dto.code);
      }
    } else if (dto.recoveryCode) {
      const codeHash = this.crypto.sha256(dto.recoveryCode.trim().toUpperCase());
      const recovery = user.recoveryCodes.find((item) => item.codeHash === codeHash && !item.usedAt);
      if (recovery) {
        await this.prisma.withElevated((tx) =>
          tx.recoveryCode.update({ where: { id: recovery.id }, data: { usedAt: new Date() } }),
        );
        accepted = true;
      }
    }

    if (!accepted) {
      await this.authEvents.record({
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        method: 'TOTP',
        outcome: 'FAILURE',
        request,
      });
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Invalid second factor',
      });
    }

    await this.onSuccess(user, 'mfa', request.ip ?? 'unknown', request);
    const session = await this.sessions.create(user.id, challenge.tid, challenge.am, request);
    const token = this.tokens.signAccess({
      userId: user.id,
      sessionId: session.session.id,
      tenantId: challenge.tid,
      authMethod: 'TOTP',
    });
    return {
      result: { accessToken: token, expiresIn: ACCESS_TOKEN_TTL_SECONDS, user: await this.userView(user.id) },
      refreshToken: session.token,
    };
  }

  /** Validates a refresh cookie and issues a new access token. */
  async refresh(token: string, request: Request): Promise<AuthOutcome<{ accessToken: string; expiresIn: number; user: UserView }>> {
    const rotated = await this.sessions.rotate(token, request);
    const user = await this.findUserById(rotated.userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.sessions.revoke(rotated.session.id);
      throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Account unavailable' });
    }
    return {
      result: {
        accessToken: this.tokens.signAccess({
          userId: user.id,
          sessionId: rotated.session.id,
          tenantId: rotated.session.tenantId,
          authMethod: rotated.session.authMethod,
        }),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        user: await this.userView(user.id),
      },
      refreshToken: rotated.token,
    };
  }

  async logout(sessionId: string, request: RequestWithContext): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.record({
      actorUserId: request.principal?.userId,
      actorEmail: request.principal?.email,
      tenantId: request.principal?.tenantId,
      action: 'auth.logout',
      resourceType: 'session',
      resourceId: sessionId,
      request,
    });
  }

  /** Requires a fresh password, PIN or TOTP proof and returns a short-lived token. */
  async stepUp(
    dto: StepUpDto,
    principal: { userId: string; tenantId: string | null; sessionId: string; authMethod: string },
    request: RequestWithContext,
  ): Promise<StepUpResult> {
    await this.rateLimit.consume('step-up', principal.userId, 5, 300);
    const user = await this.findUserById(principal.userId);
    if (!user) throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Account unavailable' });

    let verified = false;
    if (dto.password && user.passwordHash) {
      verified = await this.crypto.verifySecret(user.passwordHash, dto.password);
    }
    if (!verified && dto.pin && user.superAdminPin && user.globalRole === 'SUPER_ADMIN') {
      verified = await this.crypto.verifySecret(user.superAdminPin.pinHash, dto.pin);
    }
    if (!verified && dto.code) {
      const method = user.mfaMethods.find((item) => item.enabled && item.type === 'TOTP' && item.secretEncrypted);
      if (method?.secretEncrypted) {
        verified = this.totp.verify(this.crypto.decrypt(method.secretEncrypted), dto.code);
      }
    }
    if (!verified) {
      await this.audit.record({
        actorUserId: user.id,
        tenantId: user.tenantId,
        action: 'auth.step_up',
        resourceType: 'session',
        outcome: 'FAILURE',
        request,
      });
      throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Second-factor proof failed' });
    }

    const stepUpVerifiedAt = new Date().toISOString();
    await this.audit.record({
      actorUserId: user.id,
      tenantId: user.tenantId,
      action: 'auth.step_up',
      resourceType: 'session',
      request,
    });
    return {
      accessToken: this.tokens.signAccess(
        {
          userId: user.id,
          sessionId: principal.sessionId,
          tenantId: principal.tenantId,
          authMethod: (principal.authMethod as AuthMethod) ?? 'PASSWORD',
          stepUpVerifiedAt,
        },
        STEP_UP_TTL_SECONDS,
      ),
      expiresIn: STEP_UP_TTL_SECONDS,
      stepUpVerifiedAt,
    };
  }

  async enrollMfa(userId: string): Promise<MfaEnrollment> {
    const secret = this.totp.generateSecret();
    const encrypted = this.crypto.encrypt(secret);
    await this.prisma.withElevated(async (tx) => {
      const existing = await tx.mfaMethod.findFirst({ where: { userId, type: 'TOTP' } });
      if (existing) {
        await tx.mfaMethod.update({
          where: { id: existing.id },
          data: { secretEncrypted: encrypted, enabled: false, verifiedAt: null },
        });
      } else {
        await tx.mfaMethod.create({
          data: { tenantId: null, userId, type: 'TOTP', label: 'Authenticator app', secretEncrypted: encrypted },
        });
      }
    });
    return { secret, otpauthUri: this.totp.otpauthUri(secret, userId) };
  }

  async confirmMfa(userId: string, code: string): Promise<RecoveryCodesResult> {
    const method = await this.prisma.withElevated((tx) =>
      tx.mfaMethod.findFirst({ where: { userId, type: 'TOTP', enabled: false } }),
    );
    if (!method?.secretEncrypted || !this.totp.verify(this.crypto.decrypt(method.secretEncrypted), code)) {
      throw new ForbiddenException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid authenticator code' });
    }
    const codes = this.totp.generateRecoveryCodes();
    await this.prisma.withElevated(async (tx) => {
      await tx.mfaMethod.update({
        where: { id: method.id },
        data: { enabled: true, verifiedAt: new Date() },
      });
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.recoveryCode.createMany({
        data: codes.map((value) => ({
          tenantId: null,
          userId,
          codeHash: this.crypto.sha256(value),
        })),
      });
    });
    return { codes, warning: 'Store these codes offline. They are shown only once.' };
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<RecoveryCodesResult> {
    const method = await this.prisma.withElevated((tx) =>
      tx.mfaMethod.findFirst({ where: { userId, type: 'TOTP', enabled: true } }),
    );
    if (!method?.secretEncrypted || !this.totp.verify(this.crypto.decrypt(method.secretEncrypted), code)) {
      throw new ForbiddenException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid authenticator code' });
    }
    const codes = this.totp.generateRecoveryCodes();
    await this.prisma.withElevated(async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.recoveryCode.createMany({
        data: codes.map((value) => ({ tenantId: null, userId, codeHash: this.crypto.sha256(value) })),
      });
    });
    return { codes, warning: 'Store these codes offline. They are shown only once.' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ requiresRelogin: true }> {
    const user = await this.findUserById(userId);
    if (!user?.passwordHash || !(await this.crypto.verifySecret(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Current password is incorrect' });
    }
    const passwordHash = await this.crypto.hashSecret(dto.newPassword);
    await this.prisma.withElevated((tx) =>
      tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      }),
    );
    await this.sessions.revokeAllForUser(userId);
    return { requiresRelogin: true };
  }

  /** Used by organisation registration; the token is single-use and expires. */
  async issueEmailVerification(userId: string, tenantId: string): Promise<string> {
    const token = this.crypto.randomToken(32);
    await this.redis.client.set(
      `emailverify:${this.crypto.sha256(token)}`,
      JSON.stringify({ userId, tenantId }),
      'EX',
      24 * 60 * 60,
    );
    return token;
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    const key = `emailverify:${this.crypto.sha256(token)}`;
    const raw = await this.redis.client.get(key);
    if (!raw) throw new ForbiddenException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Verification link is invalid or expired' });
    const { userId } = JSON.parse(raw) as { userId: string };
    await this.prisma.withElevated((tx) =>
      tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), status: 'ACTIVE' } }),
    );
    await this.redis.client.del(key);
    return { verified: true };
  }

  async requestPhoneOtp(userId: string): Promise<{ code?: string; expiresIn: number }> {
    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    await this.redis.client.set(`phoneotp:${userId}`, code, 'EX', 10 * 60);
    const dev = this.config.get<string>('app.environment') !== 'production';
    return { ...(dev ? { code } : {}), expiresIn: 600 };
  }

  async verifyPhone(userId: string, code: string): Promise<{ verified: true }> {
    const stored = await this.redis.client.get(`phoneotp:${userId}`);
    if (!stored || !this.crypto.safeEqual(stored, code)) {
      throw new ForbiddenException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid or expired OTP' });
    }
    await this.prisma.withElevated((tx) =>
      tx.user.update({ where: { id: userId }, data: { phoneVerifiedAt: new Date() } }),
    );
    await this.redis.client.del(`phoneotp:${userId}`);
    return { verified: true };
  }

  /** Password reset tokens are stored hashed in Redis and are single-use. */
  async requestPasswordReset(email: string): Promise<{ token?: string; message: string }> {
    const user = await this.findUser(email.toLowerCase());
    if (!user) {
      return { message: 'If the account exists, a reset link has been issued.' };
    }
    const token = this.crypto.randomToken(32);
    await this.redis.client.set(`pwdreset:${this.crypto.sha256(token)}`, user.id, 'EX', 15 * 60);
    // A real deployment delivers this through the notification service (Phase 6).
    if (this.config.get<string>('app.environment') === 'production') {
      return { message: 'If the account exists, a reset link has been issued.' };
    }
    return { token, message: 'Development token returned for end-to-end testing.' };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ success: true }> {
    const key = `pwdreset:${this.crypto.sha256(token)}`;
    const userId = await this.redis.client.get(key);
    if (!userId) throw new ForbiddenException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Reset link is invalid or expired' });
    const passwordHash = await this.crypto.hashSecret(newPassword);
    await this.prisma.withElevated((tx) =>
      tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() } }),
    );
    await this.sessions.revokeAllForUser(userId);
    await this.redis.client.del(key);
    return { success: true };
  }

  async userView(userId: string): Promise<UserView> {
    const user = await this.findUserById(userId);
    if (!user) throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Account unavailable' });
    const tenantId = user.memberships.find((membership) => membership.status === 'ACTIVE')?.tenantId ?? null;
    const assignments = tenantId
      ? await this.prisma.withElevated((tx) =>
          tx.userRole.findMany({
            where: { tenantId, userId },
            include: { role: { include: { permissions: { include: { permission: true } } } } },
          }),
        )
      : [];
    const permissions =
      user.globalRole === 'SUPER_ADMIN'
        ? ['*']
        : [...new Set(assignments.flatMap((item) => item.role.permissions.map((link) => link.permission.key)))];
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      status: user.status,
      globalRole: user.globalRole,
      tenantId,
      tenantRoles: assignments.map((item) => item.role.name),
      permissions,
      mfaEnabled: user.mfaMethods.some((method) => method.enabled),
      profile: user.profile
        ? { firstName: user.profile.firstName, lastName: user.profile.lastName }
        : null,
    };
  }

  private async issueLogin(user: AuthUser, method: AuthMethod, request: Request): Promise<AuthOutcome<LoginResult>> {
    const tenantId = user.memberships.find((membership) => membership.status === 'ACTIVE')?.tenantId ?? null;
    if (user.mfaMethods.some((item) => item.enabled && item.type === 'TOTP')) {
      return {
        result: {
          status: 'MFA_REQUIRED',
          challengeToken: this.tokens.signChallenge(user.id, method, tenantId),
          expiresIn: 300,
          totpConfigured: true,
        },
      };
    }
    const session = await this.sessions.create(user.id, tenantId, method, request);
    return {
      result: {
        status: 'AUTHENTICATED',
        accessToken: this.tokens.signAccess({
          userId: user.id,
          sessionId: session.session.id,
          tenantId,
          authMethod: method,
        }),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        user: await this.userView(user.id),
      },
      refreshToken: session.token,
    };
  }

  private async onSuccess(
    user: AuthUser,
    scope: string,
    key: string,
    request: RequestWithContext,
  ): Promise<void> {
    await this.rateLimit.clearFailures(scope, key);
    await this.prisma.withElevated(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: request.ip ?? null },
      });
      if (user.lastLoginIp && user.lastLoginIp !== request.ip) {
        await tx.securityAlert.create({
          data: {
            tenantId: user.tenantId,
            severity: 'LOW',
            category: 'NEW_LOGIN_LOCATION',
            title: 'Login from a new IP address',
            description: `Previous IP ${user.lastLoginIp}, current IP ${request.ip ?? 'unknown'}`,
            source: 'auth-service',
          },
        });
      }
    });
    await this.authEvents.record({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      method: scope === 'pin' ? 'PIN' : scope === 'mfa' ? 'TOTP' : 'PASSWORD',
      outcome: 'SUCCESS',
      request,
    });
  }

  private async registerFailure(
    user: AuthUser,
    scope: string,
    key: string,
    request: RequestWithContext,
  ): Promise<void> {
    const count = await this.rateLimit.recordFailure(scope, key, 15 * 60);
    if (count >= MAX_FAILED_ATTEMPTS) {
      await this.prisma.withElevated((tx) =>
        tx.user.update({
          where: { id: user.id },
          data: { failedLoginCount: count, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), status: 'LOCKED' },
        }),
      );
      await this.audit.record({
        actorUserId: user.id,
        tenantId: user.tenantId,
        action: 'auth.account_locked',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'FAILURE',
        request,
      });
    } else {
      await this.prisma.withElevated((tx) =>
        tx.user.update({ where: { id: user.id }, data: { failedLoginCount: count } }),
      );
    }
  }

  private async registerPinFailure(
    user: AuthUser,
    key: string,
    request: RequestWithContext,
  ): Promise<void> {
    const count = await this.rateLimit.recordFailure('pin', key, 15 * 60);
    if (!user.superAdminPin) return;
    await this.prisma.withElevated((tx) =>
      tx.superAdminCredential.update({
        where: { userId: user.id },
        data: {
          failedAttempts: count,
          ...(count >= MAX_FAILED_ATTEMPTS
            ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : {}),
        },
      }),
    );
    if (count >= MAX_FAILED_ATTEMPTS) {
      await this.audit.record({
        actorUserId: user.id,
        action: 'auth.pin_locked',
        resourceType: 'super_admin_credential',
        outcome: 'FAILURE',
        request,
      });
    }
  }

  private isLocked(user: AuthUser): boolean {
    return Boolean(user.lockedUntil && user.lockedUntil > new Date()) || user.status === 'LOCKED';
  }

  private isPinLocked(credential: { lockedUntil: Date | null }): boolean {
    return Boolean(credential.lockedUntil && credential.lockedUntil > new Date());
  }

  private findUser(identifier: string): Promise<AuthUser | null> {
    return this.prisma.withElevated((tx) =>
      tx.user.findFirst({
        where: {
          OR: [{ email: identifier }, { username: identifier }],
          deletedAt: null,
        },
        include: { profile: true, mfaMethods: true, superAdminPin: true, memberships: true, recoveryCodes: true },
      }),
    );
  }

  private findUserById(id: string): Promise<AuthUser | null> {
    return this.prisma.withElevated((tx) =>
      tx.user.findFirst({
        where: { id, deletedAt: null },
        include: {
          profile: true,
          mfaMethods: true,
          superAdminPin: true,
          memberships: true,
          recoveryCodes: true,
        },
      }),
    );
  }
}
