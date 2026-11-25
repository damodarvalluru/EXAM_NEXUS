import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  EvaluationMode,
  EvaluationStatus,
  type AiSuggestionView,
  type EvaluatorAssignmentView,
  type EvaluationDetailView,
  type EvaluationQueueItem,
  type EvaluationRecordView,
  type MarkChangeView,
  type Principal,
  type ReopenEvaluationDto,
  type ReviewEvaluationDto,
  type ReviewOutcomeView,
} from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { ExaminationsService } from '../examinations/examinations.service';
import { isAutomaticallyGradable, type ExaminationSnapshot } from '../examinations/grading';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { AI_EVALUATOR_VERSION, suggestMarks, type SuggestionInput } from './ai-evaluator';
import { isAcceptedEvaluation, latestEvaluationByQuestion } from './current-evaluation';
import { recomputeAttemptScore } from './score-reconciliation';

const SUBMITTED_STATUSES = new Set(['SUBMITTED', 'AUTO_SUBMITTED']);

@Injectable()
export class EvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly examinations: ExaminationsService,
  ) {}

  async queue(tenantId: string): Promise<EvaluationQueueItem[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempts = await tx.examinationAttempt.findMany({
        where: { status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
        include: {
          examination: true,
          candidate: true,
          answers: true,
          evaluations: true,
          results: { orderBy: { version: 'desc' }, take: 1 },
        },
        orderBy: { submittedAt: 'desc' },
        take: 200,
      });
      const snapshots = new Map<string, ExaminationSnapshot>();
      const items: EvaluationQueueItem[] = [];
      for (const attempt of attempts) {
        const snapshot = await this.snapshot(tx, tenantId, attempt.examinationId, attempt.versionId, snapshots);
        const subjective = new Set(snapshot.questions.filter((question) => !isAutomaticallyGradable(question.type)).map((question) => question.id));
        if (! subjective.size) continue;
        const answered = attempt.answers.filter((answer) => subjective.has(answer.questionId)).length;
        if (!answered) continue;
        const result = attempt.results[0];
        items.push({
          attemptId: attempt.id,
          examinationId: attempt.examinationId,
          examinationTitle: attempt.examination.title,
          candidateId: attempt.candidateId,
          candidateName: `${attempt.candidate.firstName} ${attempt.candidate.lastName}`.trim(),
          attemptStatus: attempt.status,
          submittedAt: attempt.submittedAt?.toISOString() ?? null,
          score: attempt.score,
          totalMarks: attempt.examination.totalMarks,
          pendingSubjective: answered,
          evaluationCount: attempt.evaluations.length,
          resultId: result?.id ?? null,
          resultStatus: result?.status ?? null,
        });
      }
      return items;
    });
  }

  async detail(
    tenantId: string,
    attemptId: string,
    blind: boolean,
    principal: Principal | null,
  ): Promise<EvaluationDetailView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await tx.examinationAttempt.findUnique({
        where: { id: attemptId },
        include: {
          examination: true,
          candidate: true,
          answers: true,
          evaluations: { orderBy: { createdAt: 'asc' } },
          results: { orderBy: { version: 'desc' }, take: 1 },
        },
      });
      if (!attempt || !SUBMITTED_STATUSES.has(attempt.status)) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Submitted attempt not found' });
      }
      const snapshot = await this.snapshot(tx, tenantId, attempt.examinationId, attempt.versionId, new Map());
      const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
      const currentEvaluations = latestEvaluationByQuestion(attempt.evaluations);
      const result = attempt.results[0];
      // A blind assignment overrides the caller's display preference: an
      // assigned evaluator can never unblind the candidate through the query.
      const effectiveBlind = blind || attempt.evaluations.some(
        (evaluation) => evaluation.evaluatorId === principal?.userId && evaluation.blind,
      );
      return {
        attemptId: attempt.id,
        examinationId: attempt.examinationId,
        examinationTitle: attempt.examination.title,
        candidateId: effectiveBlind ? '' : attempt.candidateId,
        candidateName: effectiveBlind ? 'Withheld (blind evaluation)' : `${attempt.candidate.firstName} ${attempt.candidate.lastName}`.trim(),
        attemptStatus: attempt.status,
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        score: attempt.score,
        totalMarks: attempt.examination.totalMarks,
        pendingSubjective: attempt.answers.filter((answer) => {
          const question = byId.get(answer.questionId);
          return question ? !isAutomaticallyGradable(question.type) : false;
        }).length,
        evaluationCount: attempt.evaluations.length,
        resultId: result?.id ?? null,
        resultStatus: result?.status ?? null,
        resultVersion: result?.version ?? null,
        answers: attempt.answers
          .filter((answer) => {
            const question = byId.get(answer.questionId);
            return question ? !isAutomaticallyGradable(question.type) : false;
          })
          .map((answer) => {
            const question = byId.get(answer.questionId)!;
            const payload = answer.answer as { value?: unknown };
            return {
              questionId: answer.questionId,
              prompt: question.prompt,
              questionType: question.type,
              maxMarks: question.marks,
              answer: payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload,
              marksAwarded: answer.marksAwarded,
              feedback: currentEvaluations.get(answer.questionId)?.feedback ?? null,
              evaluations: attempt.evaluations
                .filter((evaluation) => evaluation.questionId === answer.questionId || (!evaluation.questionId && evaluation.mode === 'AUTOMATIC'))
                .map((evaluation) => this.toEvaluationView(
                  effectiveBlind && evaluation.evaluatorId === principal?.userId
                    ? { ...evaluation, evaluatorId: null }
                    : evaluation,
                )),
            };
          }),
      };
    });
  }

  /**
   * Produce an explainable suggestion and store it as a PENDING evaluation.
   * Marks are never written to the answer or result here.
   */
  async suggest(
    tenantId: string,
    attemptId: string,
    questionId: string,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<AiSuggestionView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await tx.examinationAttempt.findUnique({
        where: { id: attemptId },
        include: { answers: true, evaluations: true },
      });
      if (!attempt || !SUBMITTED_STATUSES.has(attempt.status)) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Submitted attempt not found' });
      }
      const snapshot = await this.snapshot(tx, tenantId, attempt.examinationId, attempt.versionId, new Map());
      const question = snapshot.questions.find((item) => item.id === questionId);
      if (!question || isAutomaticallyGradable(question.type)) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Question is not eligible for assisted evaluation' });
      }
      const answer = attempt.answers.find((item) => item.questionId === questionId);
      if (!answer) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Answer not found' });

      const existing = attempt.evaluations.find(
        (evaluation) =>
          evaluation.questionId === questionId &&
          evaluation.evaluatorId === principal.userId &&
          evaluation.status === 'PENDING' &&
          evaluation.rubric !== null &&
          typeof evaluation.rubric === 'object' &&
          !Array.isArray(evaluation.rubric) &&
          'modelVersion' in evaluation.rubric,
      );
      if (existing?.rubric) {
        return existing.rubric as unknown as AiSuggestionView;
      }

      const evaluation = await tx.evaluation.create({
        data: {
          tenantId,
          attemptId,
          questionId,
          evaluatorId: principal.userId,
          mode: 'RUBRIC',
          blind: false,
          status: 'PENDING',
          maxScore: question.marks,
        },
      });
      const payload = answer.answer as { value?: unknown };
      const input: SuggestionInput = {
        attemptId,
        questionId,
        prompt: question.prompt,
        answer: payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload,
        maxMarks: question.marks,
        questionType: question.type,
        evaluationId: evaluation.id,
      };
      const suggestion = suggestMarks(input);
      await tx.evaluation.update({
        where: { id: evaluation.id },
        data: { rubric: suggestion as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'evaluation.ai_suggestion_created',
        resourceType: 'evaluation',
        resourceId: evaluation.id,
        newValues: { attemptId, questionId, modelVersion: AI_EVALUATOR_VERSION },
        request,
      });
      return suggestion;
    });
  }

  /** Human review: only COMPLETED evaluations contribute to the final score. */
  async review(
    tenantId: string,
    attemptId: string,
    dto: ReviewEvaluationDto,
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ReviewOutcomeView> {
    const snapshot = await this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await tx.examinationAttempt.findUnique({ where: { id: attemptId }, include: { answers: true } });
      if (!attempt || !SUBMITTED_STATUSES.has(attempt.status)) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Submitted attempt not found' });
      }
      return this.snapshot(tx, tenantId, attempt.examinationId, attempt.versionId, new Map());
    });
    const questions = new Map(snapshot.questions.map((question) => [question.id, question]));

    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const item of dto.answers) {
        const question = questions.get(item.questionId);
        if (!question || isAutomaticallyGradable(question.type)) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Only subjective answers can be reviewed manually',
            details: { questionId: item.questionId },
          });
        }
        if (item.marks < 0 || item.marks > question.marks) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Marks exceed the frozen question maximum',
            details: { questionId: item.questionId, maxMarks: question.marks },
          });
        }
        const answer = await tx.candidateAnswer.findFirst({ where: { attemptId, questionId: item.questionId } });
        if (!answer) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Answer not found' });

        // A reviewer cannot overwrite a peer's accepted mark by accident: the
        // latest evaluation wins and every change is audited.
        await tx.evaluation.create({
          data: {
            tenantId,
            attemptId,
            questionId: item.questionId,
            evaluatorId: principal.userId,
            mode: 'MANUAL',
            blind: false,
            score: item.status === 'COMPLETED' ? item.marks : null,
            maxScore: question.marks,
            feedback: item.feedback ?? null,
            status: item.status,
            startedAt: new Date(),
            completedAt: new Date(),
            rubric: dto.note ? { note: dto.note } : Prisma.JsonNull,
          },
        });
      }
    });

    const outcome = await recomputeAttemptScore(
      this.prisma,
      this.examinations,
      tenantId,
      attemptId,
      principal.userId,
      'UNDER_REVIEW',
    );
    await this.audit.record({
      actorUserId: principal.userId,
      tenantId,
      action: 'evaluation.reviewed',
      resourceType: 'attempt',
      resourceId: attemptId,
      newValues: { reviewedAnswers: dto.answers.length, score: outcome.score, resultVersion: outcome.result.version },
      request,
    });
    return {
      attemptId,
      resultId: outcome.result.id,
      previousScore: outcome.previousScore,
      score: outcome.score,
      resultVersion: outcome.result.version,
      reviewedAnswers: dto.answers.length,
    };
  }

  /** Assign subjective questions to named evaluators; blind assignments stay enforced in detail(). */
  async assignEvaluators(
    tenantId: string,
    attemptId: string,
    dto: { assignments: Array<{ questionId: string; evaluatorId: string; blind?: boolean }> },
    principal: Principal,
    request: RequestWithContext,
  ): Promise<EvaluatorAssignmentView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await tx.examinationAttempt.findUnique({
        where: { id: attemptId },
        include: { evaluations: true },
      });
      if (!attempt || !SUBMITTED_STATUSES.has(attempt.status)) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Submitted attempt not found' });
      }
      const snapshot = await this.snapshot(tx, tenantId, attempt.examinationId, attempt.versionId, new Map());
      const subjective = new Map(
        snapshot.questions
          .filter((question) => !isAutomaticallyGradable(question.type))
          .map((question) => [question.id, question] as const),
      );
      const evaluatorIds = [...new Set(dto.assignments.map((item) => item.evaluatorId))];
      const users = await tx.user.findMany({
        where: { tenantId, id: { in: evaluatorIds } },
        select: { id: true },
      });
      const knownEvaluators = new Set(users.map((user) => user.id));
      for (const assignment of dto.assignments) {
        const question = subjective.get(assignment.questionId);
        if (!question) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Only subjective questions can be assigned',
            details: { questionId: assignment.questionId },
          });
        }
        if (!knownEvaluators.has(assignment.evaluatorId)) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Evaluator must be an active user in this organisation',
            details: { evaluatorId: assignment.evaluatorId },
          });
        }
      }

      const assignedAt = new Date().toISOString();
      const created: EvaluatorAssignmentView[] = [];
      for (const assignment of dto.assignments) {
        const duplicate = attempt.evaluations.some(
          (evaluation) =>
            evaluation.questionId === assignment.questionId &&
            evaluation.evaluatorId === assignment.evaluatorId &&
            evaluation.status === 'PENDING' &&
            this.isAssignmentRubric(evaluation.rubric),
        );
        if (duplicate) continue;
        const blind = assignment.blind ?? true;
        const row = await tx.evaluation.create({
          data: {
            tenantId,
            attemptId,
            questionId: assignment.questionId,
            evaluatorId: assignment.evaluatorId,
            mode: 'RUBRIC',
            blind,
            status: 'PENDING',
            maxScore: subjective.get(assignment.questionId)!.marks,
            rubric: {
              assignment: { assignedBy: principal.userId, assignedAt, blind },
            } as unknown as Prisma.InputJsonValue,
          },
        });
        created.push({
          attemptId,
          questionId: row.questionId ?? assignment.questionId,
          evaluatorId: row.evaluatorId ?? assignment.evaluatorId,
          blind: row.blind,
          assignedBy: principal.userId,
          assignedAt,
          status: row.status,
        });
      }
      await this.audit.record({
        actorUserId: principal.userId,
        tenantId,
        action: 'evaluation.assigned',
        resourceType: 'attempt',
        resourceId: attemptId,
        newValues: { assignments: dto.assignments.length, created: created.length },
        request,
      });
      return created;
    });
  }

  /** Complete marks-change history reconstructed from immutable evaluation records. */
  async markHistory(tenantId: string, attemptId: string): Promise<MarkChangeView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await tx.examinationAttempt.findUnique({
        where: { id: attemptId },
        include: { evaluations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      });
      if (!attempt) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
      const previousByQuestion = new Map<string, number | null>();
      return attempt.evaluations.map((evaluation) => {
        const previousScore = evaluation.questionId ? previousByQuestion.get(evaluation.questionId) ?? null : null;
        if (evaluation.questionId && typeof evaluation.score === 'number') {
          previousByQuestion.set(evaluation.questionId, evaluation.score);
        }
        return {
          evaluationId: evaluation.id,
          attemptId,
          questionId: evaluation.questionId,
          evaluatorId: evaluation.evaluatorId,
          mode: evaluation.mode,
          previousScore,
          score: evaluation.score,
          maxScore: evaluation.maxScore,
          feedback: evaluation.feedback,
          status: evaluation.status,
          changedAt: evaluation.updatedAt.toISOString(),
        };
      });
    });
  }

  /** Moderation reopens accepted marks and forces a fresh human evaluation. */
  async reopen(
    tenantId: string,
    attemptId: string,
    dto: { questionIds?: string[]; reason: string },
    principal: Principal,
    request: RequestWithContext,
  ): Promise<ReviewOutcomeView> {
    const snapshot = await this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await tx.examinationAttempt.findUnique({
        where: { id: attemptId },
        include: { evaluations: true },
      });
      if (!attempt || !SUBMITTED_STATUSES.has(attempt.status)) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Submitted attempt not found' });
      }
      const loaded = await this.snapshot(tx, tenantId, attempt.examinationId, attempt.versionId, new Map());
      const subjective = new Map(
        loaded.questions
          .filter((question) => !isAutomaticallyGradable(question.type))
          .map((question) => [question.id, question] as const),
      );
      const targets = dto.questionIds?.length ? dto.questionIds : [...subjective.keys()];
      for (const questionId of targets) {
        if (!subjective.has(questionId)) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Only subjective questions can be reopened',
            details: { questionId },
          });
        }
      }
      const current = latestEvaluationByQuestion(attempt.evaluations);
      const accepted = [...current.entries()].filter(
        ([questionId, evaluation]) => targets.includes(questionId) && isAcceptedEvaluation(evaluation),
      );
      if (!accepted.length) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'No accepted marks are available to reopen' });
      }
      const now = new Date().toISOString();
      // Evaluation rows are immutable: reopening appends a REVISION marker that
      // supersedes the accepted mark instead of mutating the historical row.
      for (const [questionId] of accepted) {
        await tx.evaluation.create({
          data: {
            tenantId,
            attemptId,
            questionId,
            evaluatorId: principal.userId,
            mode: 'MANUAL',
            blind: false,
            status: 'REVISION',
            score: null,
            maxScore: subjective.get(questionId)!.marks,
            rubric: {
              moderation: { reason: dto.reason, requestedBy: principal.userId, requestedAt: now },
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return loaded;
    });

    const outcome = await recomputeAttemptScore(
      this.prisma,
      this.examinations,
      tenantId,
      attemptId,
      principal.userId,
      'REVISION',
    );
    await this.audit.record({
      actorUserId: principal.userId,
      tenantId,
      action: 'evaluation.moderation_reopened',
      resourceType: 'attempt',
      resourceId: attemptId,
      newValues: { reason: dto.reason, questionIds: dto.questionIds ?? null, resultVersion: outcome.result.version },
      request,
    });
    // Keep the snapshot in scope so the compiler proves it was validated.
    void snapshot;
    return {
      attemptId,
      resultId: outcome.result.id,
      previousScore: outcome.previousScore,
      score: outcome.score,
      resultVersion: outcome.result.version,
      reviewedAnswers: outcome.reviewedAnswers,
    };
  }

  private isAssignmentRubric(value: Prisma.JsonValue | null): boolean {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'assignment' in value);
  }

  private async snapshot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    examinationId: string,
    versionId: string | null | undefined,
    cache: Map<string, ExaminationSnapshot>,
  ): Promise<ExaminationSnapshot> {
    const key = versionId ?? examinationId;
    const cached = cache.get(key);
    if (cached) return cached;
    const snapshot = await this.examinations.loadSnapshot(tx, tenantId, examinationId, versionId);
    cache.set(key, snapshot);
    return snapshot;
  }

  private toEvaluationView(row: {
    id: string;
    evaluatorId: string | null;
    mode: EvaluationMode;
    blind: boolean;
    score: number | null;
    maxScore: number | null;
    feedback: string | null;
    status: EvaluationStatus;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }): EvaluationRecordView {
    return {
      id: row.id,
      evaluatorId: row.evaluatorId,
      mode: row.mode,
      blind: row.blind,
      score: row.score,
      maxScore: row.maxScore,
      feedback: row.feedback,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
