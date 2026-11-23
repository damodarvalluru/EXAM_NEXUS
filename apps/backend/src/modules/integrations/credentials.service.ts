import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODES, type IntegrationCredentialView, type Principal } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../../common/services/audit.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import type { RotateCredentialDto, StoreCredentialDto } from './dto/integration.dto';

interface EncryptedParts {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: string;
}

function toView(row: {
  id: string;
  keyId: string;
  algorithm: string;
  expiresAt: Date | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): IntegrationCredentialView {
  return {
    id: row.id,
    keyId: row.keyId,
    algorithm: row.algorithm,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Encrypted credential vault. Plaintext secrets never leave this service. */
@Injectable()
export class IntegrationCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  encryptSecret(secret: string): EncryptedParts {
    const [version, iv, authTag, ciphertext] = this.crypto.encrypt(secret).split('.');
    if (version !== 'v1' || !iv || !authTag || !ciphertext) {
      throw new Error('Credential encryption produced an invalid envelope');
    }
    return { ciphertext, iv, authTag, algorithm: 'aes-256-gcm' };
  }

  decryptSecret(parts: EncryptedParts): string {
    if (parts.algorithm !== 'aes-256-gcm') {
      throw new Error(`Unsupported credential algorithm: ${parts.algorithm}`);
    }
    return this.crypto.decrypt(`v1.${parts.iv}.${parts.authTag}.${parts.ciphertext}`);
  }

  async list(tenantId: string, integrationId: string): Promise<IntegrationCredentialView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertIntegration(tx, integrationId);
      const rows = await tx.integrationCredential.findMany({
        where: { integrationId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(toView);
    });
  }

  async store(
    tenantId: string,
    integrationId: string,
    dto: StoreCredentialDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<IntegrationCredentialView> {
    const encrypted = this.encryptSecret(dto.secret);
    const view = await this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertIntegration(tx, integrationId);
      const credential = await tx.integrationCredential.create({
        data: {
          tenantId,
          integrationId,
          keyId: dto.keyId,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          algorithm: encrypted.algorithm,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
      await tx.integration.update({
        where: { id: integrationId },
        data: { status: 'AUTHENTICATION_PENDING', errorCount: 0 },
      });
      return toView(credential);
    });

    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.credential.stored',
      resourceType: 'integration_credential',
      resourceId: view.id,
      newValues: { integrationId, keyId: dto.keyId, expiresAt: view.expiresAt },
      request,
    });
    return view;
  }

  async rotate(
    tenantId: string,
    integrationId: string,
    credentialId: string,
    dto: RotateCredentialDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<IntegrationCredentialView> {
    const encrypted = this.encryptSecret(dto.secret);
    const view = await this.prisma.withTenant(tenantId, async (tx) => {
      const previous = await tx.integrationCredential.findUnique({ where: { id: credentialId } });
      if (!previous || previous.integrationId !== integrationId || previous.revokedAt) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Active credential not found' });
      }
      const now = new Date();
      await tx.integrationCredential.update({
        where: { id: credentialId },
        data: { revokedAt: now, rotatedAt: now },
      });
      const credential = await tx.integrationCredential.create({
        data: {
          tenantId,
          integrationId,
          keyId: previous.keyId,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          algorithm: encrypted.algorithm,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          rotatedAt: now,
        },
      });
      return toView(credential);
    });

    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.credential.rotated',
      resourceType: 'integration_credential',
      resourceId: credentialId,
      newValues: { integrationId, replacementId: view.id },
      request,
    });
    return view;
  }

  async revoke(
    tenantId: string,
    integrationId: string,
    credentialId: string,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<{ success: true }> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const credential = await tx.integrationCredential.findUnique({ where: { id: credentialId } });
      if (!credential || credential.integrationId !== integrationId || credential.revokedAt) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Active credential not found' });
      }
      await tx.integrationCredential.update({ where: { id: credentialId }, data: { revokedAt: new Date() } });
      const active = await tx.integrationCredential.count({ where: { integrationId, revokedAt: null } });
      if (active === 0) {
        await tx.integration.update({ where: { id: integrationId }, data: { status: 'REVOKED' } });
      }
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      actorEmail: principal?.email,
      tenantId,
      action: 'integration.credential.revoked',
      resourceType: 'integration_credential',
      resourceId: credentialId,
      newValues: { integrationId },
      request,
    });
    return { success: true };
  }

  private async assertIntegration(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const integration = await tx.integration.findUnique({ where: { id } });
    if (!integration) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Integration not found' });
  }
}
