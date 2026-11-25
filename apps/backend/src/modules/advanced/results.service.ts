import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Result, type ResultStatus } from '@prisma/client';
import {
  ERROR_CODES,
  type Principal,
  type PublishDueView,
  type RankListView,
  type ResultAnalyticsView,
  type SchedulePublicationDto,
  type ScorecardView,
  type ScheduledPublicationView,
} from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { ExaminationsService } from '../examinations/examinations.service';
import { isAutomaticallyGradable } from '../examinations/grading';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { isAcceptedEvaluation, latestEvaluationByQuestion } from './current-evaluation';
import type {
  ApproveResultDto,
  PublishResultDto,
  RejectResultDto,
  ResultQueryDto,
  SchedulePublicationDto as SchedulePublicationInputDto,
  WithholdResultDto,
} from './dto';

export interface ResultReviewView {
  id: string;
  attemptId: string;
  examinationId: string;
  examinationTitle: string;
  candidateId: string;
  candidateName: string;
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  status: ResultStatus;
  version: number;
  publishedAt: string | null;
  approvedBy: string | null;
  certificateId: string | null;
  certificateVerificationCode: string | null;
  certificateRevoked: boolean;
  scheduledPublishAt: string | null;
  createdAt: string;
}

type ResultWithRelations = Result & {
  examination: { title: string; totalMarks: number };
  candidate: { firstName: string; lastName: string; candidateCode: string; departmentId: string | null };
  certificate: { id: string; verificationCode: string; revokedAt: Date | null } | null;
};

const REVIEWABLE_STATUSES = new Set<ResultStatus>(['PENDING', 'UNDER_REVIEW', 'REVISION', 'WITHHELD']);

/**
 * Human-controlled result lifecycle. A result is only visible to a candidate
 * once it has been approved by a reviewer and explicitly published. Objective
 * results are published at submission by AttemptsService; this service owns
 * every transition that follows a subjective evaluation.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly examinations: ExaminationsService,
  ) {}

  async list(tenantId: string, query: ResultQueryDto): Promise<ResultReviewView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.result.findMany({
        where: {
          ...(query.examinationId ? { examinationId: query.examinationId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.departmentId ? { candidate: { departmentId: query.departmentId } } : {}),
        },
        include: { examination: true, candidate: true, certificate: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return rows.map((row) => this.toView(row as ResultWithRelations));
    });
  }

  async detail(tenantId: string, resultId: string): Promise<ResultReviewView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.result.findUnique({
        where: { id: resultId },
        include: { examination: true, candidate: true, certificate: true },
      });
      if (!row) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Result not found' });
      return this.toView(row as ResultWithRelations);
    });
  }

  async approve(
    tenantId: string,
    resultId: string,
    dto: ApproveResultDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ResultReviewView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await this.load(tx, resultId);
      if (row.status === 'APPROVED' && !dto.publish) return this.toView(row);
      if (row.status === 'PUBLISHED') return this.toView(row);
      if (!REVIEWABLE_STATUSES.has(row.status)) {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Result cannot be approved from its current status' });
      }
      await this.assertReadyForPublication(tx, tenantId, row);

      const metadata = this.mergeMetadata(row.metadata, {
        approvedNote: dto.note ?? null,
        approvedAt: new Date().toISOString(),
      });
      const status: ResultStatus = dto.publish ? 'PUBLISHED' : 'APPROVED';
      const updated = await tx.result.update({
        where: { id: row.id },
        data: {
          status,
          approvedBy: principal.userId,
          publishedAt: dto.publish ? new Date() : null,
          metadata,
        },
        include: { examination: true, candidate: true, certificate: true },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: dto.publish ? 'result.approved_and_published' : 'result.approved',
        resourceType: 'result',
        resourceId: row.id,
        previousValues: { status: row.status, score: row.score },
        newValues: { status, score: row.score, approvedBy: principal.userId },
        request,
      });
      return this.toView(updated as ResultWithRelations);
    });
  }

  async publish(
    tenantId: string,
    resultId: string,
    dto: PublishResultDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ResultReviewView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await this.load(tx, resultId);
      if (row.status === 'PUBLISHED') return this.toView(row);
      if (row.status !== 'APPROVED') {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Only an approved result can be published' });
      }
      await this.assertReadyForPublication(tx, tenantId, row);
      const updated = await tx.result.update({
        where: { id: row.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          metadata: this.mergeMetadata(row.metadata, { publishedNote: dto.note ?? null, publishedAt: new Date().toISOString() }),
        },
        include: { examination: true, candidate: true, certificate: true },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'result.published',
        resourceType: 'result',
        resourceId: row.id,
        previousValues: { status: row.status },
        newValues: { status: 'PUBLISHED', score: row.score },
        request,
      });
      return this.toView(updated as ResultWithRelations);
    });
  }

  async reject(
    tenantId: string,
    resultId: string,
    dto: RejectResultDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ResultReviewView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await this.load(tx, resultId);
      if (row.status === 'PUBLISHED') {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'A published result cannot be rejected; withhold it instead' });
      }
      const updated = await tx.result.update({
        where: { id: row.id },
        data: {
          status: 'REVISION',
          approvedBy: null,
          publishedAt: null,
          metadata: this.mergeMetadata(row.metadata, { rejectionNote: dto.note, rejectedAt: new Date().toISOString() }),
        },
        include: { examination: true, candidate: true, certificate: true },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'result.rejected',
        resourceType: 'result',
        resourceId: row.id,
        previousValues: { status: row.status },
        newValues: { status: 'REVISION', note: dto.note },
        request,
      });
      return this.toView(updated as ResultWithRelations);
    });
  }

  async withhold(
    tenantId: string,
    resultId: string,
    dto: WithholdResultDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ResultReviewView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await this.load(tx, resultId);
      if (row.status === 'PUBLISHED') {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'A published result cannot be withheld through this endpoint' });
      }
      const updated = await tx.result.update({
        where: { id: row.id },
        data: {
          status: 'WITHHELD',
          approvedBy: null,
          publishedAt: null,
          metadata: this.mergeMetadata(row.metadata, { withholdNote: dto.note ?? null, withheldAt: new Date().toISOString() }),
        },
        include: { examination: true, candidate: true, certificate: true },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'result.withheld',
        resourceType: 'result',
        resourceId: row.id,
        previousValues: { status: row.status },
        newValues: { status: 'WITHHELD', note: dto.note ?? null },
        request,
      });
      return this.toView(updated as ResultWithRelations);
    });
  }

  /** Schedule an already approved result for later automatic publication. */
  async schedule(
    tenantId: string,
    resultId: string,
    dto: SchedulePublicationInputDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ScheduledPublicationView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await this.load(tx, resultId);
      if (row.status !== 'APPROVED') {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Only an approved result can be scheduled' });
      }
      const publishAt = new Date(dto.publishAt);
      if (Number.isNaN(publishAt.getTime())) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'publishAt must be a valid ISO date' });
      }
      const scheduledAt = new Date().toISOString();
      await tx.result.update({
        where: { id: row.id },
        data: {
          metadata: this.mergeMetadata(row.metadata, {
            scheduledPublishAt: publishAt.toISOString(),
            scheduledBy: principal.userId,
            scheduledAt,
            scheduledNote: dto.note ?? null,
          }),
        },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'result.publication_scheduled',
        resourceType: 'result',
        resourceId: row.id,
        newValues: { publishAt: publishAt.toISOString(), scheduledBy: principal.userId },
        request,
      });
      return {
        resultId: row.id,
        publishAt: publishAt.toISOString(),
        scheduledBy: principal.userId,
        scheduledAt,
        status: row.status,
      };
    });
  }

  /** Idempotent due-publication sweep; call from a trusted scheduler or admin job. */
  async publishDue(
    tenantId: string,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<PublishDueView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.result.findMany({
        where: { status: 'APPROVED' },
        include: { examination: true, candidate: true, certificate: true },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      const now = Date.now();
      const due = rows.filter((row) => {
        const value = this.metadataRecord(row.metadata).scheduledPublishAt;
        return typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;
      });
      const results: PublishDueView['results'] = [];
      let published = 0;
      for (const row of due) {
        try {
          await this.assertReadyForPublication(tx, tenantId, row);
          await tx.result.update({
            where: { id: row.id },
            data: {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              metadata: this.mergeMetadata(row.metadata, {
                scheduledPublishAt: null,
                publishedByScheduleAt: new Date().toISOString(),
              }),
            },
          });
          await this.audit.record({
            actorUserId: principal.userId,
            tenantId,
            action: 'result.scheduled_publication',
            resourceType: 'result',
            resourceId: row.id,
            newValues: { status: 'PUBLISHED', score: row.score },
            request,
          });
          results.push({ resultId: row.id, status: 'PUBLISHED' });
          published += 1;
        } catch (error) {
          results.push({
            resultId: row.id,
            status: 'SKIPPED',
            reason: error instanceof Error ? error.message : 'Publication gate failed',
          });
        }
      }
      return { processedAt: new Date().toISOString(), published, skipped: results.length - published, results };
    });
  }

  /** Per-question scorecard built from the frozen version and accepted evaluations. */
  async scorecard(tenantId: string, resultId: string): Promise<ScorecardView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await this.load(tx, resultId);
      const attempt = await tx.examinationAttempt.findUnique({
        where: { id: row.attemptId },
        include: { answers: true, evaluations: true },
      });
      if (!attempt) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
      const snapshot = await this.examinations.loadSnapshot(tx, tenantId, attempt.examinationId, attempt.versionId);
      const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
      const answers = attempt.answers.flatMap((answer) => {
        const question = byId.get(answer.questionId);
        if (!question) return [];
        const evaluations = attempt.evaluations.filter(
          (evaluation) => evaluation.questionId === answer.questionId && evaluation.status === 'COMPLETED' && typeof evaluation.score === 'number',
        );
        const average = evaluations.length
          ? Math.round((evaluations.reduce((sum, evaluation) => sum + (evaluation.score ?? 0), 0) / evaluations.length) * 100) / 100
          : null;
        const status = evaluations.length
          ? 'COMPLETED'
          : attempt.evaluations.some((evaluation) => evaluation.questionId === answer.questionId && evaluation.status === 'PENDING')
            ? 'PENDING'
            : 'UNSCORED';
        return [{
          questionId: question.id,
          prompt: question.prompt,
          type: question.type,
          maxMarks: question.marks,
          marksAwarded: isAutomaticallyGradable(question.type) ? answer.marksAwarded : average,
          evaluationCount: evaluations.length,
          evaluationStatus: status as ScorecardView['answers'][number]['evaluationStatus'],
          feedback: attempt.evaluations
            .filter((evaluation) => evaluation.questionId === answer.questionId && evaluation.feedback)
            .map((evaluation) => evaluation.feedback!)
            .join('\n') || null,
        }];
      });
      return {
        resultId: row.id,
        attemptId: row.attemptId,
        examinationId: row.examinationId,
        examinationTitle: row.examination.title,
        candidateId: row.candidateId,
        candidateName: `${row.candidate.firstName} ${row.candidate.lastName}`.trim() || row.candidate.candidateCode,
        score: row.score,
        maxScore: row.maxScore,
        percentage: row.percentage,
        passed: row.passed,
        resultStatus: row.status,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        certificateId: row.certificate?.id ?? null,
        answers,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  /** Competition ranking derived from the latest published result per candidate (read-only). */
  async rankList(tenantId: string, examinationId: string): Promise<RankListView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.result.findMany({
        where: { examinationId, status: 'PUBLISHED' },
        include: { candidate: true, examination: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) if (!latest.has(row.candidateId)) latest.set(row.candidateId, row);
      const ordered = [...latest.values()].sort((a, b) => b.score - a.score);
      let rank = 0;
      let previousScore: number | null = null;
      const entries = ordered.map((row, index) => {
        if (previousScore === null || row.score !== previousScore) {
          rank = index + 1;
          previousScore = row.score;
        }
        return {
          rank,
          resultId: row.id,
          candidateId: row.candidateId,
          candidateName: `${row.candidate.firstName} ${row.candidate.lastName}`.trim() || row.candidate.candidateCode,
          candidateCode: row.candidate.candidateCode,
          score: row.score,
          maxScore: row.maxScore,
          percentage: row.percentage,
          publishedAt: row.publishedAt?.toISOString() ?? null,
        };
      });
      return { examinationId, generatedAt: new Date().toISOString(), entries };
    });
  }

  /** Explicitly persist computed ranks; GET endpoints stay side-effect free. */
  async persistRanks(
    tenantId: string,
    examinationId: string,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<RankListView> {
    const view = await this.rankList(tenantId, examinationId);
    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const entry of view.entries) {
        await tx.result.update({ where: { id: entry.resultId }, data: { rank: entry.rank } });
      }
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'results.ranked',
        resourceType: 'examination',
        resourceId: examinationId,
        newValues: { entries: view.entries.length },
        request,
      });
    });
    return view;
  }

  /** Published-result analytics grouped by department and examination. */
  async analytics(tenantId: string): Promise<ResultAnalyticsView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [rows, departments] = await Promise.all([
        tx.result.findMany({
          where: { status: 'PUBLISHED' },
          include: { candidate: true, examination: true },
          take: 5000,
        }),
        tx.department.findMany({ where: { tenantId }, select: { id: true, name: true, code: true } }),
      ]);
      const departmentNames = new Map(departments.map((department) => [department.id, department.name]));
      const group = (
        items: typeof rows,
        keyOf: (row: (typeof rows)[number]) => string,
        labelOf: (row: (typeof rows)[number]) => string,
      ) => {
        const groups = new Map<string, typeof rows>();
        for (const row of items) {
          const key = keyOf(row);
          groups.set(key, [...(groups.get(key) ?? []), row]);
        }
        return [...groups.entries()].map(([key, groupRows]) => {
          const passed = groupRows.filter((row) => row.passed).length;
          const averageScore = groupRows.reduce((sum, row) => sum + row.score, 0) / groupRows.length;
          const averagePercentage = groupRows.reduce((sum, row) => sum + row.percentage, 0) / groupRows.length;
          return {
            key,
            label: labelOf(groupRows[0]!),
            results: groupRows.length,
            passed,
            passRate: Math.round((passed / groupRows.length) * 10_000) / 100,
            averageScore: Math.round(averageScore * 100) / 100,
            averagePercentage: Math.round(averagePercentage * 100) / 100,
          };
        });
      };
      const passed = rows.filter((row) => row.passed).length;
      const averageScore = rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
      const averagePercentage = rows.length ? rows.reduce((sum, row) => sum + row.percentage, 0) / rows.length : 0;
      return {
        generatedAt: new Date().toISOString(),
        totals: {
          publishedResults: rows.length,
          passed,
          passRate: rows.length ? Math.round((passed / rows.length) * 10_000) / 100 : 0,
          averageScore: Math.round(averageScore * 100) / 100,
          averagePercentage: Math.round(averagePercentage * 100) / 100,
        },
        byDepartment: group(
          rows.filter((row) => row.candidate.departmentId),
          (row) => row.candidate.departmentId!,
          (row) => departmentNames.get(row.candidate.departmentId!) ?? row.candidate.departmentId!,
        ),
        byExamination: group(rows, (row) => row.examinationId, (row) => row.examination.title),
      };
    });
  }

  private async load(tx: Prisma.TransactionClient, resultId: string): Promise<ResultWithRelations> {
    const row = await tx.result.findUnique({
      where: { id: resultId },
      include: { examination: true, candidate: true, certificate: true },
    });
    if (!row) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Result not found' });
    return row as ResultWithRelations;
  }

  /**
   * Refuse to publish a result while an answered subjective question has no
   * current COMPLETED human evaluation. AI suggestions, revisions and reopened
   * marks are never enough.
   */
  private async assertReadyForPublication(
    tx: Prisma.TransactionClient,
    tenantId: string,
    result: Result,
  ): Promise<void> {
    const attempt = await tx.examinationAttempt.findUnique({
      where: { id: result.attemptId },
      include: { answers: true, evaluations: true },
    });
    if (!attempt) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
    const snapshot = await this.examinations.loadSnapshot(tx, tenantId, attempt.examinationId, attempt.versionId);
    const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
    const current = latestEvaluationByQuestion(attempt.evaluations);
    const pending: string[] = [];
    for (const answer of attempt.answers) {
      const question = byId.get(answer.questionId);
      if (!question || isAutomaticallyGradable(question.type)) continue;
      if (!isAcceptedEvaluation(current.get(answer.questionId))) pending.push(answer.questionId);
    }
    if (pending.length) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Subjective answers still require human evaluation before publication',
        details: { pendingQuestionIds: pending.slice(0, 20), pendingCount: pending.length },
      });
    }
  }

  private scheduledAt(value: Prisma.JsonValue | null): string | null {
    const candidate = this.metadataRecord(value).scheduledPublishAt;
    return typeof candidate === 'string' ? candidate : null;
  }

  private metadataRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private mergeMetadata(current: Prisma.JsonValue | null, patch: Record<string, unknown>): Prisma.InputJsonValue {
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};
    return { ...base, ...patch } as Prisma.InputJsonValue;
  }

  private toView(row: ResultWithRelations): ResultReviewView {
    return {
      id: row.id,
      attemptId: row.attemptId,
      examinationId: row.examinationId,
      examinationTitle: row.examination.title,
      candidateId: row.candidateId,
      candidateName: `${row.candidate.firstName} ${row.candidate.lastName}`.trim() || row.candidate.candidateCode,
      score: row.score,
      maxScore: row.maxScore,
      percentage: row.percentage,
      passed: row.passed,
      status: row.status,
      version: row.version,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      approvedBy: row.approvedBy,
      certificateId: row.certificate?.id ?? null,
      certificateVerificationCode: row.certificate?.verificationCode ?? null,
      certificateRevoked: Boolean(row.certificate?.revokedAt),
      scheduledPublishAt: this.scheduledAt(row.metadata),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
