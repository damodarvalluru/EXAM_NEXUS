import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Certificate } from '@prisma/client';
import {
  ERROR_CODES,
  type CertificateVerificationView,
  type CertificateView,
  type Principal,
} from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { buildCertificatePdf } from './certificate-pdf';

type CertificateWithRelations = Certificate & {
  result: {
    score: number;
    maxScore: number;
    status: string;
    candidate: { firstName: string; lastName: string; candidateCode: string };
    examination: { title: string };
  };
};

/** Certificates are generated from published, passed results and verified by a random public code. */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, resultId?: string): Promise<CertificateView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.certificate.findMany({
        where: resultId ? { resultId } : {},
        include: { result: { include: { candidate: true, examination: true } } },
        orderBy: { issuedAt: 'desc' },
        take: 200,
      });
      return rows.map((row) => this.toView(row as CertificateWithRelations));
    });
  }

  async issue(
    tenantId: string,
    resultId: string,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<CertificateView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const result = await tx.result.findUnique({
        where: { id: resultId },
        include: { candidate: true, examination: true },
      });
      if (!result) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Result not found' });
      if (result.status !== 'PUBLISHED') {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Only a published result can be certified' });
      }
      if (!result.passed) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Only a passing result can be certified' });
      }
      const existing = await tx.certificate.findUnique({ where: { resultId } });
      if (existing) {
        const withRelations = await tx.certificate.findUnique({
          where: { id: existing.id },
          include: { result: { include: { candidate: true, examination: true } } },
        });
        return this.toView(withRelations as CertificateWithRelations);
      }

      const year = new Date().getUTCFullYear();
      const certificate = await tx.certificate.create({
        data: {
          tenantId,
          resultId,
          certificateNumber: `EXN-${year}-${randomUUID().slice(0, 8).toUpperCase()}`,
          verificationCode: randomBytes(20).toString('hex'),
          issuedAt: new Date(),
        },
      });
      const withRelations = await tx.certificate.findUnique({
        where: { id: certificate.id },
        include: { result: { include: { candidate: true, examination: true } } },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'certificate.issued',
        resourceType: 'certificate',
        resourceId: certificate.id,
        newValues: { resultId, certificateNumber: certificate.certificateNumber },
        request,
      });
      return this.toView(withRelations as CertificateWithRelations);
    });
  }

  async pdf(tenantId: string, certificateId: string): Promise<{ data: Buffer; fileName: string }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.certificate.findUnique({
        where: { id: certificateId },
        include: { result: { include: { candidate: true, examination: true } } },
      });
      if (!row) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Certificate not found' });
      if (row.revokedAt) {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'A revoked certificate cannot be downloaded' });
      }
      const view = this.toView(row as CertificateWithRelations);
      const data = buildCertificatePdf([
        'ExamNexus Certificate of Achievement',
        '',
        `Awarded to: ${view.candidateName}`,
        `Examination: ${view.examinationTitle}`,
        `Score: ${view.score} / ${view.maxScore}`,
        `Issued: ${view.issuedAt.slice(0, 10)}`,
        `Certificate: ${view.certificateNumber}`,
        `Verification: ${view.verificationCode}`,
        '',
        'Verify at the public certificate verification page.',
      ]);
      return { data, fileName: `${view.certificateNumber}.pdf` };
    });
  }

  async revoke(
    tenantId: string,
    certificateId: string,
    reason: string | undefined,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<CertificateView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.certificate.findUnique({ where: { id: certificateId } });
      if (!row) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Certificate not found' });
      if (row.revokedAt) return this.listOne(tx, certificateId);
      const updated = await tx.certificate.update({
        where: { id: certificateId },
        data: { revokedAt: new Date() },
        include: { result: { include: { candidate: true, examination: true } } },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'certificate.revoked',
        resourceType: 'certificate',
        resourceId: certificateId,
        previousValues: { revokedAt: null },
        newValues: { revokedAt: updated.revokedAt?.toISOString() ?? null, reason: reason ?? null },
        request,
      });
      return this.toView(updated as CertificateWithRelations);
    });
  }

  /** Public verification oracle: the random code is the only identifier accepted. */
  async verify(code: string): Promise<CertificateVerificationView> {
    const trimmed = code.trim();
    if (!/^[a-f0-9]{16,120}$/i.test(trimmed)) return { valid: false, reason: 'NOT_FOUND' };
    return this.prisma.withElevated(async (tx) => {
      const row = await tx.certificate.findUnique({
        where: { verificationCode: trimmed.toLowerCase() },
        include: { result: { include: { candidate: true, examination: true } } },
      });
      if (!row) return { valid: false, reason: 'NOT_FOUND' };
      if (row.revokedAt) return { valid: false, reason: 'REVOKED', certificateNumber: row.certificateNumber };
      if (row.result.status !== 'PUBLISHED') {
        return { valid: false, reason: 'RESULT_NOT_PUBLISHED', certificateNumber: row.certificateNumber };
      }
      return {
        valid: true,
        certificateNumber: row.certificateNumber,
        candidateName: `${row.result.candidate.firstName} ${row.result.candidate.lastName}`.trim(),
        examinationTitle: row.result.examination.title,
        score: row.result.score,
        maxScore: row.result.maxScore,
        issuedAt: row.issuedAt.toISOString(),
      };
    });
  }

  private async listOne(tx: Prisma.TransactionClient, certificateId: string): Promise<CertificateView> {
    const row = await tx.certificate.findUnique({
      where: { id: certificateId },
      include: { result: { include: { candidate: true, examination: true } } },
    });
    if (!row) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Certificate not found' });
    return this.toView(row as CertificateWithRelations);
  }

  private toView(row: CertificateWithRelations): CertificateView {
    return {
      id: row.id,
      certificateNumber: row.certificateNumber,
      verificationCode: row.verificationCode,
      resultId: row.resultId,
      candidateName: `${row.result.candidate.firstName} ${row.result.candidate.lastName}`.trim() || row.result.candidate.candidateCode,
      examinationTitle: row.result.examination.title,
      score: row.result.score,
      maxScore: row.result.maxScore,
      issuedAt: row.issuedAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      pdfAvailable: !row.revokedAt,
    };
  }
}
