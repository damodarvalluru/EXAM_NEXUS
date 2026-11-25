import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type AttemptStatus,
  type ExaminationAttempt,
  type Result,
  type Submission,
} from '@prisma/client';
import {
  ERROR_CODES,
  type AttemptClockEvent,
  type AttemptStateEvent,
  type AttemptSummaryView,
  type AttemptView,
  type CandidateExamView,
  type CandidateResultView,
  type Principal,
  type QuestionView,
  type SubmitReceipt,
} from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  gradeAnswer,
  isAutomaticallyGradable,
  seededShuffle,
  snapshotHash,
  type ExaminationSnapshot,
  type GradeableQuestion,
} from './grading';
import { ExaminationsService } from './examinations.service';
import type { SaveAnswerDto, SubmitAttemptDto } from './dto/examination.dto';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';

@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly examinations: ExaminationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async candidateIdFor(tenantId: string, principal: Principal | null): Promise<string> {
    if (!principal) throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'Authentication is required' });
    return this.prisma.withTenant(tenantId, async (tx) => {
      const candidate = await tx.candidate.findFirst({ where: { tenantId, userId: principal.userId } });
      if (!candidate) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'No candidate profile is linked to this account',
        });
      }
      return candidate.id;
    });
  }

  async availableExams(tenantId: string, principal: Principal | null): Promise<CandidateExamView[]> {
    const candidateId = await this.candidateIdFor(tenantId, principal);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const assignments = await tx.candidateExamination.findMany({
        where: { candidateId, eligible: true },
        include: { examination: true },
        orderBy: { createdAt: 'desc' },
      });
      const now = Date.now();
      const views: CandidateExamView[] = [];
      for (const assignment of assignments) {
        const exam = assignment.examination;
        const attemptsUsed = await tx.examinationAttempt.count({ where: { candidateId, examinationId: exam.id } });
        const windowOpen = !assignment.windowStartAt || assignment.windowStartAt.getTime() <= now;
        const windowClosed = assignment.windowEndAt ? assignment.windowEndAt.getTime() < now : false;
        const live = exam.status === 'LIVE' || exam.status === 'SCHEDULED';
        let reason: string | undefined;
        if (!live) reason = 'This examination is not open';
        else if (!windowOpen) reason = 'Your examination window has not started';
        else if (windowClosed) reason = 'Your examination window has closed';
        else if (attemptsUsed >= exam.maxAttempts) reason = 'Maximum attempts reached';
        views.push({
          id: exam.id,
          title: exam.title,
          description: exam.description,
          instructions: exam.instructions,
          type: exam.type,
          durationMinutes: exam.durationMinutes,
          startsAt: exam.startsAt?.toISOString() ?? null,
          endsAt: exam.endsAt?.toISOString() ?? null,
          totalMarks: exam.totalMarks,
          maxAttempts: exam.maxAttempts,
          attemptsUsed,
          available: !reason,
          ...(reason ? { reason } : {}),
        });
      }
      return views;
    });
  }

  async start(
    tenantId: string,
    examId: string,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<AttemptView> {
    const candidateId = await this.candidateIdFor(tenantId, principal);
    const attemptId = await this.prisma.withTenant(tenantId, async (tx) => {
      const assignment = await tx.candidateExamination.findFirst({ where: { candidateId, examinationId: examId, eligible: true } });
      if (!assignment) {
        throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'You are not eligible for this examination' });
      }
      const exam = await tx.examination.findUnique({ where: { id: examId } });
      if (!exam || exam.tenantId !== tenantId) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Examination not found' });
      }
      const now = Date.now();
      if (exam.status !== 'LIVE' && exam.status !== 'SCHEDULED') {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'This examination is not open' });
      }
      if (assignment.windowStartAt && assignment.windowStartAt.getTime() > now) {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Your examination window has not started' });
      }
      if (assignment.windowEndAt && assignment.windowEndAt.getTime() < now) {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Your examination window has closed' });
      }
      const used = await tx.examinationAttempt.count({ where: { candidateId, examinationId: examId } });
      if (used >= exam.maxAttempts) {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Maximum attempts reached' });
      }
      const open = await tx.examinationAttempt.findFirst({
        where: { candidateId, examinationId: examId, status: 'IN_PROGRESS' },
      });
      if (open) throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'An attempt is already in progress', details: { attemptId: open.id } });

      const version = await this.examinations.loadVersion(tx, tenantId, examId);
      const snapshot = await this.examinations.loadSnapshot(tx, tenantId, examId, version.id);
      const questionIds = snapshot.sections.flatMap((section) => section.questionIds);
      if (!questionIds.length) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'This examination has no questions' });
      }
      const attempt = await tx.examinationAttempt.create({
        data: {
          tenantId,
          candidateId,
          examinationId: examId,
          versionId: version.id,
          attemptNumber: used + 1,
          status: 'IN_PROGRESS',
          startedAt: new Date(now),
          serverEndAt: new Date(now + exam.durationMinutes * 60_000),
          metadata: { snapshotVersion: version.version, contentHash: snapshot.contentHash } as Prisma.InputJsonValue,
        },
      });
      return attempt.id;
    });

    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'examination.attempt_started',
      resourceType: 'attempt',
      resourceId: attemptId,
      request,
    });
    const view = await this.getAttempt(tenantId, attemptId, principal);
    this.emitClock(attemptId, view.serverEndAt, 'START');
    return view;
  }

  async getAttempt(tenantId: string, attemptId: string, principal: Principal | null): Promise<AttemptView> {
    const candidateId = await this.candidateIdFor(tenantId, principal);
    let currentStatus: AttemptStatus = 'NOT_STARTED';
    let currentScore: number | null = null;
    const view = await this.prisma.withTenant(tenantId, async (tx) => {
      const owned = await this.loadOwnedAttempt(tx, tenantId, attemptId, candidateId);
      // Settlement only happens after ownership has been verified and inside
      // this same transaction, so a peer candidate cannot force a write.
      await this.settleExpired(tx, tenantId, owned, candidateId);
      const attempt = await tx.examinationAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { examination: true, candidate: true, answers: true },
      });
      currentStatus = attempt.status;
      currentScore = attempt.score;
      const snapshot = await this.examinations.loadSnapshot(tx, tenantId, attempt.examinationId, attempt.versionId);
      const questions = this.deliverQuestions(
        snapshot,
        attempt.id,
        snapshot.randomiseQuestions,
        snapshot.randomiseOptions,
      );
      const answers: Record<string, unknown> = {};
      for (const answer of attempt.answers) {
        const payload = answer.answer as { value?: unknown };
        answers[answer.questionId] = payload && typeof payload === 'object' && 'value' in payload ? payload.value : payload;
      }
      const remaining = attempt.serverEndAt
        ? Math.max(0, Math.floor((attempt.serverEndAt.getTime() - Date.now()) / 1000))
        : 0;
      return {
        id: attempt.id,
        examinationId: attempt.examinationId,
        title: attempt.examination.title,
        instructions: attempt.examination.instructions,
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
        startedAt: attempt.startedAt?.toISOString() ?? null,
        serverEndAt: attempt.serverEndAt?.toISOString() ?? null,
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        remainingSeconds: remaining,
        totalMarks: attempt.examination.totalMarks,
        questions,
        answers,
      };
    });
    this.emitState(view.id, currentStatus, currentScore, view.submittedAt);
    return view;
  }

  async saveAnswer(
    tenantId: string,
    attemptId: string,
    dto: SaveAnswerDto,
    principal: Principal | null,
  ): Promise<{ saved: true; questionId: string; savedAt: string }> {
    const candidateId = await this.candidateIdFor(tenantId, principal);
    const clock = { serverEndAt: null as Date | null };
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const owned = await this.loadOwnedAttempt(tx, tenantId, attemptId, candidateId);
      const active = (await this.settleExpired(tx, tenantId, owned, candidateId)) ?? owned;
      clock.serverEndAt = active.serverEndAt;
      if (active.status !== 'IN_PROGRESS') {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'The attempt is no longer accepting answers' });
      }
      const snapshot = await this.examinations.loadSnapshot(tx, tenantId, active.examinationId, active.versionId);
      const questionIds = new Set(snapshot.sections.flatMap((section) => section.questionIds));
      const byQuestion = await tx.candidateAnswer.findUnique({
        where: { attemptId_questionId: { attemptId, questionId: dto.questionId } },
      });
      if (byQuestion && byQuestion.idempotencyKey !== dto.idempotencyKey) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'A different idempotency key was already used for this question',
        });
      }
      const byKey = await tx.candidateAnswer.findUnique({
        where: { attemptId_idempotencyKey: { attemptId, idempotencyKey: dto.idempotencyKey } },
      });
      if (byKey && byKey.questionId !== dto.questionId) {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Idempotency key is already used for another question' });
      }
      const questionId = byQuestion?.questionId ?? byKey?.questionId ?? dto.questionId;
      if (!questionIds.has(questionId)) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Answer must identify a question in this attempt' });
      }
      const answer = await tx.candidateAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId } },
        create: {
          tenantId,
          attemptId,
          questionId,
          answer: dto.answer as Prisma.InputJsonValue,
          idempotencyKey: dto.idempotencyKey,
          savedAt: new Date(),
        },
        update: {
          answer: dto.answer as Prisma.InputJsonValue,
          idempotencyKey: dto.idempotencyKey,
          savedAt: new Date(),
        },
      });
      return { saved: true as const, questionId: answer.questionId, savedAt: answer.savedAt.toISOString() };
    });
    this.emitClock(attemptId, clock.serverEndAt?.toISOString() ?? null, 'ANSWER_SAVED');
    return result;
  }

  async submit(
    tenantId: string,
    attemptId: string,
    dto: SubmitAttemptDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<SubmitReceipt> {
    const candidateId = await this.candidateIdFor(tenantId, principal);
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const owned = await this.loadOwnedAttempt(tx, tenantId, attemptId, candidateId);
      const duplicate = await tx.submission.findUnique({
        where: {
          attemptId_idempotencyKey: { attemptId, idempotencyKey: dto.idempotencyKey },
        },
      });
      if (duplicate) {
        const exam = await tx.examination.findUniqueOrThrow({ where: { id: owned.examinationId } });
        const resultRow = await tx.result.findFirst({ where: { attemptId }, orderBy: { version: 'desc' } });
        return this.toReceipt(duplicate, owned, exam, resultRow, true);
      }
      const active = (await this.settleExpired(tx, tenantId, owned, candidateId)) ?? owned;
      if (active.status === 'AUTO_SUBMITTED' || active.status === 'SUBMITTED') {
        const existing = await tx.submission.findUnique({ where: { attemptId } });
        if (existing) {
          const exam = await tx.examination.findUniqueOrThrow({ where: { id: active.examinationId } });
          const resultRow = await tx.result.findFirst({ where: { attemptId }, orderBy: { version: 'desc' } });
          return this.toReceipt(existing, active, exam, resultRow, true);
        }
      }
      if (active.status !== 'IN_PROGRESS') {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'The attempt cannot be submitted' });
      }
      return this.finalise(tx, tenantId, active, dto.idempotencyKey, 'SUBMITTED', toDateOrUndefined(dto.clientTime));
    });

    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'examination.submitted',
      resourceType: 'attempt',
      resourceId: attemptId,
      newValues: { submissionId: result.submissionId, score: result.score },
      request,
    });
    this.emitState(attemptId, result.status, result.score, result.submittedAt);
    return result;
  }

  async history(tenantId: string, principal: Principal | null): Promise<AttemptSummaryView[]> {
    const candidateId = await this.candidateIdFor(tenantId, principal);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.examinationAttempt.findMany({
        where: { candidateId },
        include: { examination: true, candidate: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return rows.map((row) => ({
        id: row.id,
        candidateId: row.candidateId,
        candidateName: `${row.candidate.firstName} ${row.candidate.lastName}`,
        examinationId: row.examinationId,
        examinationTitle: row.examination.title,
        attemptNumber: row.attemptNumber,
        status: row.status,
        startedAt: row.startedAt?.toISOString() ?? null,
        serverEndAt: row.serverEndAt?.toISOString() ?? null,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        score: row.score,
        riskScore: row.riskScore,
      }));
    });
  }

  async result(tenantId: string, attemptId: string, principal: Principal | null): Promise<CandidateResultView> {
    const candidateId = await this.candidateIdFor(tenantId, principal);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const attempt = await tx.examinationAttempt.findUnique({
        where: { id: attemptId },
        include: { examination: true, results: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!attempt || attempt.candidateId !== candidateId) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
      }
      const row = attempt.results[0];
      if (!row || row.status !== 'PUBLISHED') {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Result is not published yet',
          details: { status: row?.status ?? 'PENDING' },
        });
      }
      return {
        attemptId,
        examinationId: attempt.examinationId,
        examinationTitle: attempt.examination.title,
        score: row.score,
        totalMarks: row.maxScore,
        passingMarks: attempt.examination.passingMarks,
        status: row.status,
        publishedAt: row.publishedAt?.toISOString() ?? null,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private emitClock(
    attemptId: string,
    serverEndAt: string | null,
    reason: NonNullable<AttemptClockEvent['reason']>,
  ): void {
    const event: AttemptClockEvent = {
      attemptId,
      serverTime: new Date().toISOString(),
      serverEndAt,
      remainingSeconds: serverEndAt
        ? Math.max(0, Math.floor((Date.parse(serverEndAt) - Date.now()) / 1000))
        : 0,
      reason,
    };
    this.realtime.emitAttemptClock(event);
  }

  private emitState(
    attemptId: string,
    status: AttemptStatus,
    score: number | null,
    submittedAt: string | null,
  ): void {
    const event: AttemptStateEvent = { attemptId, status, score, submittedAt };
    this.realtime.emitAttemptState(event);
  }

  private async loadOwnedAttempt(
    tx: Prisma.TransactionClient,
    tenantId: string,
    attemptId: string,
    candidateId: string,
  ): Promise<ExaminationAttempt> {
    const attempt = await tx.examinationAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.candidateId !== candidateId || attempt.tenantId !== tenantId) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
    }
    return attempt;
  }

  /** Candidate views are built exclusively from the attempt's frozen version snapshot. */
  private deliverQuestions(
    snapshot: ExaminationSnapshot,
    seed: string,
    randomise: boolean,
    randomiseOptions: boolean,
  ): QuestionView[] {
    const sectionIds = [...new Set(snapshot.sections.flatMap((section) => section.questionIds))];
    const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
    const ids = sectionIds.length ? sectionIds : snapshot.questions.map((question) => question.id);
    const ordered = randomise ? seededShuffle(ids, seed) : ids;
    return ordered.flatMap((id) => {
      const question = byId.get(id);
      if (!question) return [];
      // FILL_BLANK options carry the content that grading matches against. They
      // are hidden in the snapshot and must never reach a candidate payload.
      const options = question.type === 'FILL_BLANK'
        ? []
        : [...question.options].sort((a, b) => a.position - b.position);
      const presented = randomiseOptions ? seededShuffle(options, `${seed}:${id}`) : options;
      return [{
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        marks: question.marks,
        negativeMarks: question.negativeMarks,
        difficulty: question.difficulty,
        sectionId: question.sectionId,
        options: presented.map((option) => ({
          id: option.id,
          label: option.label,
          content: option.content,
          position: option.position,
        })),
      }];
    });
  }

  /** Authorise first, then settle an expired attempt inside the caller's transaction. */
  private async settleExpired(
    tx: Prisma.TransactionClient,
    tenantId: string,
    attempt: ExaminationAttempt,
    candidateId: string,
  ): Promise<ExaminationAttempt | null> {
    if (attempt.tenantId !== tenantId || attempt.candidateId !== candidateId) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Attempt not found' });
    }
    if (attempt.status !== 'IN_PROGRESS' || !attempt.serverEndAt || attempt.serverEndAt.getTime() > Date.now()) {
      return null;
    }
    const key = `auto:${attempt.id}`;
    const existing = await tx.submission.findUnique({
      where: { attemptId_idempotencyKey: { attemptId: attempt.id, idempotencyKey: key } },
    });
    if (!existing) {
      await this.finalise(tx, tenantId, attempt, key, 'AUTO_SUBMITTED', attempt.serverEndAt);
    }
    return tx.examinationAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  }

  private async finalise(
    tx: Prisma.TransactionClient,
    tenantId: string,
    attempt: ExaminationAttempt,
    idempotencyKey: string,
    status: 'SUBMITTED' | 'AUTO_SUBMITTED',
    clientTime?: Date,
  ): Promise<SubmitReceipt> {
    const snapshot = await this.examinations.loadSnapshot(tx, tenantId, attempt.examinationId, attempt.versionId);
    const frozenById = new Map(snapshot.questions.map((question) => [question.id, question]));
    const answers = await tx.candidateAnswer.findMany({
      where: { attemptId: attempt.id },
      orderBy: { createdAt: 'asc' },
    });

    // Only one answer per question can contribute to the score, even if legacy
    // rows were inserted before the unique index existed.
    const graded = new Set<string>();
    let score = 0;
    for (const answer of answers) {
      if (graded.has(answer.questionId)) continue;
      graded.add(answer.questionId);
      const frozen = frozenById.get(answer.questionId);
      if (!frozen) {
        await tx.candidateAnswer.update({
          where: { id: answer.id },
          data: { marksAwarded: 0, isCorrect: false },
        });
        continue;
      }
      const gradeable: GradeableQuestion = {
        id: frozen.id,
        type: frozen.type,
        marks: frozen.marks,
        negativeMarks: frozen.negativeMarks,
        options: frozen.options,
        expectedAnswer: frozen.expectedAnswer,
      };
      const payload = answer.answer as { value?: unknown };
      const outcome = gradeAnswer(gradeable, payload?.value);
      score += outcome.marks ?? 0;
      await tx.candidateAnswer.update({
        where: { id: answer.id },
        data: { marksAwarded: outcome.marks, isCorrect: outcome.isCorrect },
      });
    }
    score = Math.max(0, Math.round(score * 100) / 100);
    // A result containing subjective answers stays in review until a human
    // evaluator signs it off (Phase 7). Fully objective attempts can be
    // published immediately because every mark came from the frozen snapshot.
    const needsReview = answers.some((answer) => {
      const frozen = frozenById.get(answer.questionId);
      return frozen ? !isAutomaticallyGradable(frozen.type) : false;
    });
    const publishedAt = needsReview ? null : new Date();

    const exam = await tx.examination.findUniqueOrThrow({ where: { id: attempt.examinationId } });
    const submissionId = randomUUID();
    const submittedAt = new Date();
    const receiptHash = snapshotHash({
      attemptId: attempt.id,
      idempotencyKey,
      submissionId,
      submittedAt: submittedAt.toISOString(),
      score,
    });
    const receipt: SubmitReceipt = {
      attemptId: attempt.id,
      submissionId,
      receiptHash,
      submittedAt: submittedAt.toISOString(),
      status,
      score,
      totalMarks: exam.totalMarks,
      duplicate: false,
    };
    await tx.submission.create({
      data: {
        id: submissionId,
        tenantId,
        attemptId: attempt.id,
        idempotencyKey,
        receiptHash,
        clientTime,
        status: 'ACCEPTED',
        receipt: receipt as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.examinationAttempt.update({
      where: { id: attempt.id },
      data: { status, submittedAt, score },
    });
    await tx.result.create({
      data: {
        tenantId,
        attemptId: attempt.id,
        examinationId: attempt.examinationId,
        candidateId: attempt.candidateId,
        score,
        maxScore: exam.totalMarks,
        percentage: exam.totalMarks > 0 ? Math.round((score / exam.totalMarks) * 10_000) / 100 : 0,
        passed: exam.passingMarks !== null && score >= exam.passingMarks,
        status: needsReview ? 'PENDING' : 'PUBLISHED',
        version: 1,
        publishedAt,
        metadata: {
          gradedAt: submittedAt.toISOString(),
          automatic: true,
          needsReview,
          publishedImmediately: !needsReview,
        } as Prisma.InputJsonValue,
      },
    });
    return receipt;
  }

  private toReceipt(
    submission: Submission,
    attempt: ExaminationAttempt,
    exam: { totalMarks: number },
    resultRow: Result | null,
    duplicate: boolean,
  ): SubmitReceipt {
    const stored = submission.receipt as SubmitReceipt | null;
    if (stored && typeof stored === 'object' && typeof stored.receiptHash === 'string') {
      return { ...stored, duplicate };
    }
    // Legacy rows have no stored receipt: prefer the result row written at
    // settlement time over the attempt's current values.
    return {
      attemptId: submission.attemptId,
      submissionId: submission.id,
      receiptHash: submission.receiptHash,
      submittedAt: submission.createdAt.toISOString(),
      status: attempt.status as SubmitReceipt['status'],
      score: resultRow?.score ?? attempt.score ?? null,
      totalMarks: resultRow?.maxScore ?? exam.totalMarks,
      duplicate,
    };
  }
}

function toDateOrUndefined(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
