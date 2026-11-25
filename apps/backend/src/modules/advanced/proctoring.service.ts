import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertSeverity,
  Prisma,
  type ExamSession,
  type RiskAssessment,
  type ExaminationSecurityEvent,
} from '@prisma/client';
import {
  ERROR_CODES,
  PROCTOR_EVENT_TYPES,
  type Principal,
  type ProctorAttemptView,
  type ProctorEventDto,
  type ProctorSessionView,
  type RegisterProctorSessionDto,
  type ReviewRiskDto,
  type RiskAssessmentView,
  type SecurityEventView,
} from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import {
  assessRisk,
  defaultEventWeight,
  parseThresholds,
} from './risk-engine';
import type { InvestigateEventDto, RotateSessionTokenDto } from './dto';
import { issueProctorToken, verifyProctorToken } from './proctor-token';

export interface ProctorEventIngestView {
  event: SecurityEventView;
  assessment: RiskAssessmentView;
}

const EVENT_CATEGORY: Record<string, string> = {
  TAB_HIDDEN: 'FOCUS_LOSS',
  WINDOW_BLUR: 'FOCUS_LOSS',
  FULLSCREEN_EXIT: 'FOCUS_LOSS',
  DISCONNECTED: 'CONNECTIVITY',
  RECONNECTED: 'CONNECTIVITY',
  REPEATED_RECONNECT: 'CONNECTIVITY',
  SCREEN_CAPTURE_SIGNAL: 'CAPTURE',
  MULTIPLE_SESSION: 'IDENTITY',
  SESSION_TOKEN_MISMATCH: 'IDENTITY',
  DEVICE_CHANGE: 'IDENTITY',
  CLOCK_SKEW: 'INTEGRITY',
  SUSPICIOUS_INTERACTION: 'INTERACTION',
};

const EVENT_SEVERITY: Record<string, AlertSeverity> = {
  TAB_HIDDEN: 'LOW',
  WINDOW_BLUR: 'LOW',
  FULLSCREEN_EXIT: 'MEDIUM',
  DISCONNECTED: 'INFO',
  RECONNECTED: 'INFO',
  REPEATED_RECONNECT: 'HIGH',
  SCREEN_CAPTURE_SIGNAL: 'HIGH',
  MULTIPLE_SESSION: 'CRITICAL',
  SESSION_TOKEN_MISMATCH: 'CRITICAL',
  CLOCK_SKEW: 'MEDIUM',
  DEVICE_CHANGE: 'HIGH',
  SUSPICIOUS_INTERACTION: 'MEDIUM',
};

const REVIEW_PERMISSION = 'org.proctoring.read';

/** Browser events are advisory signals for human review, never proof of misconduct. */
@Injectable()
export class ProctoringService {
  private readonly tokenSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.tokenSecret = config.getOrThrow<string>('security.encryptionMasterKey');
  }

  /** Called by the candidate client with its short-lived session token. */
  async registerSession(
    tenantId: string,
    dto: RegisterProctorSessionDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ProctorSessionView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await this.ownedAttempt(tx, tenantId, dto.attemptId, principal);
      if (attempt.status !== 'IN_PROGRESS') {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Only an in-progress attempt can register a session' });
      }
      let device = await tx.deviceRegistration.findFirst({ where: { tenantId, deviceId: dto.deviceId } });
      if (!device) {
        device = await tx.deviceRegistration.create({
          data: {
            tenantId,
            deviceId: dto.deviceId,
            userId: null,
            candidateId: attempt.candidateId,
            platform: dto.platform ?? null,
            model: dto.model ?? null,
            osVersion: dto.osVersion ?? null,
            clientVersion: dto.clientVersion ?? null,
            integrityStatus: dto.integrityAttestation ? 'ATTESTED' : 'UNKNOWN',
            lastSeenAt: new Date(),
          },
        });
      } else {
        await tx.deviceRegistration.update({
          where: { id: device.id },
          data: { lastSeenAt: new Date(), integrityStatus: dto.integrityAttestation ? 'ATTESTED' : device.integrityStatus },
        });
      }

      const securityProfile = attempt.examination.securityPolicy?.profile ?? 'STANDARD_BROWSER';
      const existing = await tx.examSession.findUnique({ where: { attemptId: attempt.id } });
      if (existing?.terminatedAt) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'A terminated exam session cannot be revived',
        });
      }
      // The server always issues the token. A client-chosen value would make
      // the "short-lived session token" claim meaningless.
      const { token, expiresAt } = issueProctorToken(this.tokenSecret, tenantId, attempt.id);
      const sessionTokenHash = this.hashSessionToken(tenantId, token);
      const session = existing
        ? await tx.examSession.update({
            where: { attemptId: attempt.id },
            data: {
              deviceId: device.id,
              sessionTokenHash,
              securityProfile,
              secureClientVersion: dto.clientVersion ?? null,
              heartbeatAt: new Date(),
              disconnectedAt: null,
            },
          })
        : await tx.examSession.create({
            data: {
              tenantId,
              attemptId: attempt.id,
              deviceId: device.id,
              sessionTokenHash,
              securityProfile,
              secureClientVersion: dto.clientVersion ?? null,
              heartbeatAt: new Date(),
            },
          });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'proctoring.session_registered',
        resourceType: 'attempt',
        resourceId: attempt.id,
        newValues: { sessionId: session.id, deviceId: device.deviceId, securityProfile, expiresAt: expiresAt.toISOString() },
        request,
      });
      return this.toSessionView(session, device.deviceId, token, expiresAt);
    });
  }

  /** Rotate an expiring token without reviving a terminated session. */
  async rotateSessionToken(
    tenantId: string,
    attemptId: string,
    dto: RotateSessionTokenDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ProctorSessionView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await this.ownedAttempt(tx, tenantId, attemptId, principal);
      const session = await tx.examSession.findUnique({ where: { attemptId } });
      if (!session || session.terminatedAt) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'No active session is available for token rotation',
        });
      }
      if (
        !verifyProctorToken(this.tokenSecret, tenantId, attemptId, dto.sessionToken) ||
        session.sessionTokenHash !== this.hashSessionToken(tenantId, dto.sessionToken)
      ) {
        throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'Current session token is invalid or expired' });
      }
      const { token, expiresAt } = issueProctorToken(this.tokenSecret, tenantId, attempt.id);
      const updated = await tx.examSession.update({
        where: { attemptId },
        data: { sessionTokenHash: this.hashSessionToken(tenantId, token), heartbeatAt: new Date() },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'proctoring.session_token_rotated',
        resourceType: 'attempt',
        resourceId: attempt.id,
        newValues: { expiresAt: expiresAt.toISOString() },
        request,
      });
      return this.toSessionView(updated, null, token, expiresAt);
    });
  }

  /** Keep the active session alive without creating an advisory security event. */
  async heartbeat(
    tenantId: string,
    attemptId: string,
    dto: RotateSessionTokenDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ProctorSessionView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await this.ownedAttempt(tx, tenantId, attemptId, principal);
      const session = await tx.examSession.findUnique({ where: { attemptId } });
      if (
        !session ||
        session.terminatedAt ||
        !verifyProctorToken(this.tokenSecret, tenantId, attemptId, dto.sessionToken) ||
        session.sessionTokenHash !== this.hashSessionToken(tenantId, dto.sessionToken)
      ) {
        throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'Session token is invalid or expired' });
      }
      const updated = await tx.examSession.update({
        where: { attemptId },
        data: { heartbeatAt: new Date() },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'proctoring.session_heartbeat',
        resourceType: 'attempt',
        resourceId: attempt.id,
        request,
      });
      return this.toSessionView(updated, null);
    });
  }

  /** Ingest one advisory event and immediately refresh the explainable risk assessment. */
  async ingestEvent(
    tenantId: string,
    attemptId: string,
    dto: ProctorEventDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ProctorEventIngestView> {
    if (!PROCTOR_EVENT_TYPES.includes(dto.eventType)) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Unsupported proctoring event type' });
    }
    const outcome = await this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await this.ownedAttempt(tx, tenantId, attemptId, principal);
      const session = await tx.examSession.findUnique({ where: { attemptId } });
      const tokenValid = verifyProctorToken(this.tokenSecret, tenantId, attemptId, dto.sessionToken);
      const tokenMatches = Boolean(
        session && tokenValid && session.sessionTokenHash === this.hashSessionToken(tenantId, dto.sessionToken!),
      );
      if (session && !tokenMatches) {
        // Record first, return the forbidden response outside the transaction:
        // throwing here would roll the critical identity event back.
        const mismatch = await tx.examinationSecurityEvent.create({
          data: {
            tenantId,
            attemptId,
            eventType: 'SESSION_TOKEN_MISMATCH',
            category: 'IDENTITY',
            severity: 'CRITICAL',
            riskWeight: defaultEventWeight('SESSION_TOKEN_MISMATCH'),
            evidence: { reportedType: dto.eventType, reason: tokenValid ? 'token_reused' : 'token_invalid_or_expired' } as Prisma.InputJsonValue,
          },
        });
        if (!session.terminatedAt) {
          await tx.examSession.update({ where: { attemptId }, data: { terminatedAt: new Date() } });
        }
        await this.audit.record({
          actorUserId: principal.userId,
          tenantId,
          action: 'proctoring.session_token_mismatch',
          resourceType: 'security_event',
          resourceId: mismatch.id,
          newValues: { attemptId, reason: tokenValid ? 'token_reused' : 'token_invalid_or_expired' },
          request,
        });
        return { mismatch: true as const };
      }
      const clientTime = dto.clientTime ? this.parseDate(dto.clientTime) : null;
      const event = await tx.examinationSecurityEvent.create({
        data: {
          tenantId,
          attemptId,
          eventType: dto.eventType,
          category: EVENT_CATEGORY[dto.eventType] ?? 'OTHER',
          severity: EVENT_SEVERITY[dto.eventType] ?? 'LOW',
          riskWeight: defaultEventWeight(dto.eventType),
          clientTime,
          evidence: this.safeEvidence(dto.evidence),
        },
      });
      if (session) {
        const patch: Prisma.ExamSessionUpdateInput = { heartbeatAt: new Date() };
        if (dto.eventType === 'DISCONNECTED') patch.disconnectedAt = new Date();
        if (dto.eventType === 'RECONNECTED') patch.disconnectedAt = null;
        if (dto.eventType === 'MULTIPLE_SESSION') patch.terminatedAt = new Date();
        await tx.examSession.update({ where: { attemptId }, data: patch });
      }
      const assessment = await this.recompute(tx, tenantId, attemptId, null);
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'proctoring.event_ingested',
        resourceType: 'attempt',
        resourceId: attemptId,
        newValues: { eventId: event.id, eventType: event.eventType, riskScore: assessment.score },
        request,
      });
      return {
        mismatch: false as const,
        view: { event: this.toEventView(event), assessment: this.toRiskView(assessment) },
      };
    });
    if (outcome.mismatch) {
      throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'Session token does not match the registered session' });
    }
    return outcome.view;
  }

  async listAttempts(tenantId: string): Promise<ProctorAttemptView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempts = await tx.examinationAttempt.findMany({
        where: { status: { in: ['IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'TERMINATED'] } },
        include: {
          candidate: true,
          examination: true,
          securityEvents: { orderBy: { serverTime: 'desc' }, take: 100 },
          riskAssessments: { orderBy: { createdAt: 'desc' }, take: 20 },
          session: { include: { device: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 200,
      });
      return attempts.map((attempt) => this.toAttemptView(attempt));
    });
  }

  async detail(tenantId: string, attemptId: string): Promise<ProctorAttemptView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await tx.examinationAttempt.findUnique({
        where: { id: attemptId },
        include: {
          candidate: true,
          examination: true,
          securityEvents: { orderBy: { serverTime: 'desc' }, take: 500 },
          riskAssessments: { orderBy: { createdAt: 'desc' }, take: 50 },
          session: { include: { device: true } },
        },
      });
      if (!attempt) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
      return this.toAttemptView(attempt);
    });
  }

  async assess(
    tenantId: string,
    attemptId: string,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<RiskAssessmentView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await tx.examinationAttempt.findUnique({ where: { id: attemptId } });
      if (!attempt) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
      const assessment = await this.recompute(tx, tenantId, attemptId, principal.userId);
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'proctoring.risk_assessed',
        resourceType: 'attempt',
        resourceId: attemptId,
        newValues: { assessmentId: assessment.id, score: assessment.score, level: assessment.level },
        request,
      });
      return this.toRiskView(assessment);
    });
  }

  async investigateEvent(
    tenantId: string,
    eventId: string,
    dto: InvestigateEventDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<SecurityEventView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.examinationSecurityEvent.findUnique({ where: { id: eventId } });
      if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Security event not found' });
      const updated = await tx.examinationSecurityEvent.update({
        where: { id: eventId },
        data: { investigated: dto.investigated },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'proctoring.event_investigation_changed',
        resourceType: 'security_event',
        resourceId: eventId,
        previousValues: { investigated: existing.investigated },
        newValues: { investigated: dto.investigated },
        request,
      });
      return this.toEventView(updated);
    });
  }

  async reviewAssessment(
    tenantId: string,
    assessmentId: string,
    dto: ReviewRiskDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<RiskAssessmentView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.riskAssessment.findUnique({ where: { id: assessmentId } });
      if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Risk assessment not found' });
      const reviewed = dto.investigated !== false;
      const updated = await tx.riskAssessment.update({
        where: { id: assessmentId },
        data: {
          reviewedBy: reviewed ? principal.userId : null,
          reviewedAt: reviewed ? new Date() : null,
          appealStatus: dto.appealStatus ?? existing.appealStatus,
        },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'proctoring.risk_reviewed',
        resourceType: 'risk_assessment',
        resourceId: assessmentId,
        previousValues: { appealStatus: existing.appealStatus, reviewedBy: existing.reviewedBy },
        newValues: { appealStatus: updated.appealStatus, investigated: reviewed, note: dto.note ?? null },
        request,
      });
      return this.toRiskView(updated);
    });
  }

  private async ownedAttempt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    attemptId: string,
    principal: Principal,
  ) {
    const attempt = await tx.examinationAttempt.findUnique({
      where: { id: attemptId },
      include: { examination: { include: { securityPolicy: true } } },
    });
    if (!attempt) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
    const candidate = await tx.candidate.findFirst({ where: { tenantId, userId: principal.userId } });
    const isOwner = Boolean(candidate && candidate.id === attempt.candidateId);
    const isReviewer = principal.permissions?.includes(REVIEW_PERMISSION) ?? false;
    if (!isOwner && !isReviewer) {
      throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'You cannot submit events for this attempt' });
    }
    return attempt;
  }

  private async recompute(
    tx: Prisma.TransactionClient,
    tenantId: string,
    attemptId: string,
    actorUserId: string | null,
  ): Promise<RiskAssessment> {
    const attempt = await tx.examinationAttempt.findUnique({
      where: { id: attemptId },
      include: { examination: { include: { securityPolicy: true } } },
    });
    if (!attempt) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
    const events = await tx.examinationSecurityEvent.findMany({
      where: { attemptId },
      orderBy: { serverTime: 'desc' },
      take: 200,
    });
    const thresholds = parseThresholds(attempt.examination.securityPolicy?.riskThresholds);
    const result = assessRisk(events, thresholds);
    const assessment = await tx.riskAssessment.create({
      data: {
        tenantId,
        attemptId,
        score: result.score,
        level: result.level,
        rules: result.rules as unknown as Prisma.InputJsonValue,
        modelVersion: result.modelVersion,
        reviewedBy: actorUserId,
        reviewedAt: actorUserId ? new Date() : null,
      },
    });
    await tx.examinationAttempt.update({ where: { id: attemptId }, data: { riskScore: result.score } });

    if (result.level === 'HIGH' || result.level === 'CRITICAL') {
      const existingAlert = await tx.securityAlert.findFirst({
        where: {
          tenantId,
          category: 'PROCTORING_RISK',
          source: 'risk-engine',
          evidenceRef: attemptId,
          status: 'OPEN',
        },
        orderBy: { createdAt: 'desc' },
      });
      const fields = {
        severity: result.level,
        title: `Proctoring risk ${result.level.toLowerCase()} on attempt`,
        description: `Explainable rule score ${result.score}; assessment ${assessment.id}. Requires human review; no automatic disqualification.`,
      };
      if (existingAlert) {
        await tx.securityAlert.update({ where: { id: existingAlert.id }, data: fields });
      } else {
        await tx.securityAlert.create({
          data: {
            tenantId,
            category: 'PROCTORING_RISK',
            evidenceRef: attemptId,
            status: 'OPEN',
            ...fields,
          },
        });
      }
    }
    return assessment;
  }

  private hashSessionToken(tenantId: string, token: string): string {
    return createHash('sha256').update(tenantId).update(':').update(token).digest('hex');
  }

  private parseDate(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'clientTime must be an ISO timestamp' });
    }
    return parsed;
  }

  private safeEvidence(
    value: Record<string, unknown> | undefined,
  ): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
    if (!value) return Prisma.JsonNull;
    try {
      const serialised = JSON.stringify(value);
      if (serialised.length > 4000) return { truncated: true, preview: serialised.slice(0, 4000) } as Prisma.InputJsonValue;
      return value as Prisma.InputJsonValue;
    } catch {
      return { invalid: true } as Prisma.InputJsonValue;
    }
  }

  private toEventView(row: ExaminationSecurityEvent): SecurityEventView {
    return {
      id: row.id,
      attemptId: row.attemptId,
      eventType: row.eventType,
      category: row.category,
      severity: row.severity,
      riskWeight: row.riskWeight,
      investigated: row.investigated,
      clientTime: row.clientTime?.toISOString() ?? null,
      serverTime: row.serverTime.toISOString(),
      evidence: row.evidence,
    };
  }

  private toRiskView(row: RiskAssessment): RiskAssessmentView {
    return {
      id: row.id,
      attemptId: row.attemptId,
      score: row.score,
      level: row.level,
      rules: row.rules,
      modelVersion: row.modelVersion,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      appealStatus: row.appealStatus,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toSessionView(
    row: ExamSession,
    deviceId: string | null,
    sessionToken: string | null = null,
    sessionTokenExpiresAt: Date | null = null,
  ): ProctorSessionView {
    return {
      id: row.id,
      attemptId: row.attemptId,
      deviceId,
      securityProfile: row.securityProfile,
      secureClientVersion: row.secureClientVersion,
      sessionToken,
      sessionTokenExpiresAt: sessionTokenExpiresAt?.toISOString() ?? null,
      heartbeatAt: row.heartbeatAt?.toISOString() ?? null,
      disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
      terminatedAt: row.terminatedAt?.toISOString() ?? null,
    };
  }

  private toAttemptView(attempt: {
    id: string;
    riskScore: number;
    candidate: { firstName: string; lastName: string; candidateCode: string };
    examination: { title: string };
    securityEvents: ExaminationSecurityEvent[];
    riskAssessments: RiskAssessment[];
    session: (ExamSession & { device: { deviceId: string } | null }) | null;
  }): ProctorAttemptView {
    return {
      attemptId: attempt.id,
      candidateName: `${attempt.candidate.firstName} ${attempt.candidate.lastName}`.trim() || attempt.candidate.candidateCode,
      examinationTitle: attempt.examination.title,
      riskScore: attempt.riskScore,
      events: attempt.securityEvents.map((event) => this.toEventView(event)),
      assessments: attempt.riskAssessments.map((assessment) => this.toRiskView(assessment)),
      session: attempt.session ? this.toSessionView(attempt.session, attempt.session.device?.deviceId ?? null) : null,
    };
  }
}
