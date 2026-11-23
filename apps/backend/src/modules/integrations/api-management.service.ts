import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type ApiClientView,
  type ApiKeyView,
  type CreateApiKeyResult,
  type Principal,
  type SyncResult,
} from '@examnexus/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../database/prisma.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import type { CreateApiClientDto, CreateApiKeyDto, IngestCandidatesDto } from './dto/integration.dto';

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

@Injectable()
export class ApiManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async listClients(tenantId: string): Promise<ApiClientView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.apiClient.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { keys: { orderBy: { createdAt: 'desc' } } },
      });
      return rows.map((row) => this.clientView(row));
    });
  }

  async createClient(
    tenantId: string,
    dto: CreateApiClientDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<ApiClientView & { secret: string }> {
    const clientId = `enx_c_${randomBytes(18).toString('base64url')}`;
    const secret = `enx_s_${randomBytes(32).toString('base64url')}`;
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const created = await tx.apiClient.create({
        data: {
          id: randomUUID(),
          tenantId,
          name: dto.name,
          clientId,
          secretHash: this.crypto.sha256(secret),
          description: dto.description ?? null,
          createdBy: principal?.userId ?? null,
        },
        include: { keys: true },
      });
      return created;
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'api.client.created',
      resourceType: 'api_client',
      resourceId: row.id,
      newValues: { name: row.name, clientId },
      request,
    });
    return { ...this.clientView(row), secret };
  }

  async revokeClient(
    tenantId: string,
    clientId: string,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<{ success: true }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await this.findClient(tx, tenantId, clientId);
      if (client.revokedAt) throw this.notFound('API client');
      await tx.apiClient.update({ where: { id: client.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
      await tx.apiKey.updateMany({
        where: { clientId: client.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'api.client.revoked',
      resourceType: 'api_client',
      resourceId: clientId,
      request,
    });
    return { success: true };
  }

  async listKeys(tenantId: string, clientId?: string): Promise<ApiKeyView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.apiKey.findMany({
        where: {
          tenantId,
          clientId: clientId ? (await this.findClient(tx, tenantId, clientId)).id : undefined,
        },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => this.keyView(row));
    });
  }

  async createKey(
    tenantId: string,
    clientId: string,
    dto: CreateApiKeyDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<CreateApiKeyResult> {
    const allowed = new Set(['candidates:read', 'candidates:write', 'webhooks:read']);
    const scopes = [...new Set(dto.scopes.map((scope) => scope.trim()))];
    if (!scopes.length || scopes.some((scope) => !allowed.has(scope))) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Unsupported API key scopes',
      });
    }
    const secret = `enx_k_${randomBytes(36).toString('base64url')}`;
    const prefix = secret.slice(0, 20);
    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const client = await this.findClient(tx, tenantId, clientId);
      if (client.status !== 'ACTIVE' || client.revokedAt) {
        throw new ForbiddenException('API client is not active');
      }
      return tx.apiKey.create({
        data: {
          id: randomUUID(),
          tenantId,
          clientId: client.id,
          prefix,
          secretHash: this.crypto.sha256(secret),
          scopes,
          expiresAt,
        },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'api.key.created',
      resourceType: 'api_key',
      resourceId: row.id,
      newValues: { clientId, scopes, prefix },
      request,
    });
    return { ...this.keyView(row), secret };
  }

  async revokeKey(
    tenantId: string,
    keyId: string,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<{ success: true }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const key = await tx.apiKey.findFirst({ where: { id: keyId, tenantId, revokedAt: null } });
      if (!key) throw this.notFound('API key');
      await tx.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'api.key.revoked',
      resourceType: 'api_key',
      resourceId: keyId,
      request,
    });
    return { success: true };
  }

  /** Called by the API-key guard after the key hash and scopes have been verified. */
  async touchKey(keyId: string): Promise<void> {
    await this.prisma.withElevated(async (tx) => {
      await tx.apiKey.update({ where: { id: keyId }, data: { lastUsedAt: new Date() } });
    });
  }

  async ingestCandidates(
    tenantId: string,
    keyId: string | null,
    dto: IngestCandidatesDto,
  ): Promise<SyncResult> {
    const result: SyncResult = {
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
      completedAt: new Date().toISOString(),
    };
    for (const candidate of dto.candidates) {
      result.processed += 1;
      const email = candidate.email.trim().toLowerCase();
      const existing = await this.prisma.withTenant(tenantId, (tx) =>
        tx.candidate.findFirst({ where: { tenantId, candidateCode: candidate.candidateCode } }),
      );
      if (existing) {
        await this.prisma.withTenant(tenantId, (tx) =>
          tx.candidate.update({
            where: { id: existing.id },
            data: {
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              email,
              phone: candidate.phone ?? existing.phone,
            },
          }),
        );
        result.updated += 1;
      } else {
        await this.prisma.withTenant(tenantId, (tx) =>
          tx.candidate.create({
            data: {
              tenantId,
              candidateCode: candidate.candidateCode,
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              email,
              phone: candidate.phone ?? null,
            },
          }),
        );
        result.created += 1;
      }
    }
    // Request metrics are recorded centrally by ApiRequestLogMiddleware with
    // the real status and latency; do not write a synthetic success row here.
    if (keyId) await this.touchKey(keyId);
    return result;
  }

  /** Read endpoint for the candidates:read API scope. */
  async readCandidate(tenantId: string, candidateCode: string) {
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.candidate.findFirst({ where: { tenantId, candidateCode } }),
    );
    if (!row) throw this.notFound('Candidate');
    return {
      id: row.id,
      candidateCode: row.candidateCode,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private clientView(row: {
    id: string;
    name: string;
    clientId: string;
    description: string | null;
    status: string;
    createdAt: Date;
    revokedAt: Date | null;
    keys: Array<{
      id: string;
      prefix: string;
      scopes: unknown;
      expiresAt: Date | null;
      lastUsedAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
    }>;
  }): ApiClientView {
    return {
      id: row.id,
      name: row.name,
      clientId: row.clientId,
      description: row.description,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      revokedAt: iso(row.revokedAt),
      keys: row.keys.map((key) => this.keyView(key)),
    };
  }

  private keyView(row: {
    id: string;
    prefix: string;
    scopes: unknown;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }): ApiKeyView {
    return {
      id: row.id,
      prefix: row.prefix,
      scopes: stringArray(row.scopes),
      expiresAt: iso(row.expiresAt),
      lastUsedAt: iso(row.lastUsedAt),
      revokedAt: iso(row.revokedAt),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async findClient(
    tx: Prisma.TransactionClient,
    tenantId: string,
    clientId: string,
  ) {
    const client = await tx.apiClient.findFirst({
      where: { tenantId, OR: [{ id: clientId }, { clientId }] },
    });
    if (!client) throw this.notFound('API client');
    return client;
  }

  private notFound(resource: string): NotFoundException {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: `${resource} not found` });
  }
}
