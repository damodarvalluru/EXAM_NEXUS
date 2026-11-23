import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { AuthMethod, SessionView } from '@examnexus/shared';
import { ERROR_CODES } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { CryptoService } from '../../common/crypto/crypto.service';

export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionIdentity {
  id: string;
  familyId: string;
  expiresAt: Date;
  tenantId: string | null;
  authMethod: AuthMethod;
}

export interface CreatedSession {
  token: string;
  session: SessionIdentity;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
  ) {}

  async create(
    userId: string,
    tenantId: string | null,
    authMethod: AuthMethod,
    request: Request,
  ): Promise<CreatedSession> {
    const token = this.crypto.randomToken(48);
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const session = await this.prisma.withElevated((tx) =>
      tx.userSession.create({
        data: {
          tenantId,
          userId,
          refreshHash: this.crypto.sha256(token),
          familyId,
          authMethod,
          ip: request.ip ?? null,
          userAgent: request.header('user-agent') ?? null,
          deviceLabel: request.header('x-device-label') ?? null,
          expiresAt,
          lastUsedAt: new Date(),
        },
        select: { id: true, familyId: true, expiresAt: true, tenantId: true, authMethod: true },
      }),
    );
    return { token, session };
  }

  /** Rotates the refresh token; reuse of an old token revokes the whole family. */
  async rotate(token: string, request: Request): Promise<CreatedSession & { userId: string }> {
    const hash = this.crypto.sha256(token);
    const usedKey = `refreshused:${hash}`;
    const reused = await this.redis.client.get(usedKey);
    if (reused) {
      await this.revokeFamily(reused);
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Refresh token reuse detected; all sessions in the family were revoked',
      });
    }

    const result = await this.prisma.withElevated(async (tx) => {
      const session = await tx.userSession.findFirst({
        where: { refreshHash: hash, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!session) return null;
      const nextToken = this.crypto.randomToken(48);
      const updated = await tx.userSession.update({
        where: { id: session.id },
        data: {
          refreshHash: this.crypto.sha256(nextToken),
          lastUsedAt: new Date(),
          ip: request.ip ?? session.ip,
          userAgent: request.header('user-agent') ?? session.userAgent,
        },
        select: { id: true, familyId: true, expiresAt: true, tenantId: true, authMethod: true },
      });
      await this.redis.client.set(usedKey, session.familyId, 'EX', REFRESH_TOKEN_TTL_SECONDS);
      return { token: nextToken, session: updated, userId: session.userId };
    });

    if (!result) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Refresh token is invalid or expired',
      });
    }
    return result;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.withElevated((tx) =>
      tx.userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.withElevated((tx) =>
      tx.userSession.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.withElevated((tx) =>
      tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  async list(userId: string, currentSessionId: string | null): Promise<SessionView[]> {
    const sessions = await this.prisma.withElevated((tx) =>
      tx.userSession.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return sessions.map((session) => ({
      id: session.id,
      authMethod: session.authMethod,
      ip: session.ip,
      deviceLabel: session.deviceLabel,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === currentSessionId,
    }));
  }
}
