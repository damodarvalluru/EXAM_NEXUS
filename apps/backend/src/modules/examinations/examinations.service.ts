import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Examination, type ExaminationVersion } from '@prisma/client';
import {
  ERROR_CODES,
  ExamStatus,
  type AttemptSummaryView,
  type CandidateCredentialsResult,
  type EligibilityView,
  type ExamSectionView,
  type ExamView,
  type Principal,
  type QuestionBankView,
  type QuestionView,
} from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  normaliseAnswer,
  snapshotHash,
  type ExaminationSnapshot,
  type SnapshotQuestion,
} from './grading';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import type {
  BulkQuestionsDto,
  CreateCandidateCredentialsDto,
  CreateExaminationDto,
  CreateQuestionBankDto,
  CreateQuestionDto,
  EligibilityDto,
  ExaminationQueryDto,
  UpdateExamStatusDto,
  UpdateExaminationDto,
  UpdateQuestionDto,
} from './dto/examination.dto';

const STATUS_TRANSITIONS: Record<ExamStatus, readonly ExamStatus[]> = {
  DRAFT: ['SCHEDULED', 'CANCELLED', 'ARCHIVED'],
  SCHEDULED: ['LIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'],
  LIVE: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['LIVE', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
};

function toDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: `Invalid ${field}` });
  }
  return parsed;
}

@Injectable()
export class ExaminationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  // -------------------------------------------------------------------------
  // Question banks
  // -------------------------------------------------------------------------

  async listBanks(tenantId: string): Promise<QuestionBankView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const banks = await tx.questionBank.findMany({ orderBy: { createdAt: 'desc' } });
      return Promise.all(
        banks.map(async (bank) => ({
          id: bank.id,
          name: bank.name,
          description: bank.description,
          category: bank.category,
          questionCount: await tx.question.count({ where: { bankId: bank.id } }),
          createdAt: bank.createdAt.toISOString(),
        })),
      );
    });
  }

  async createBank(
    tenantId: string,
    dto: CreateQuestionBankDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<QuestionBankView> {
    const bank = await this.prisma.withTenant(tenantId, (tx) =>
      tx.questionBank.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description,
          category: dto.category,
          createdBy: principal?.userId ?? null,
        },
      }),
    );
    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'question_bank.create',
      resourceType: 'question_bank',
      resourceId: bank.id,
      newValues: { name: bank.name },
      request,
    });
    return { id: bank.id, name: bank.name, description: bank.description, category: bank.category, questionCount: 0, createdAt: bank.createdAt.toISOString() };
  }

  async listQuestions(tenantId: string, bankId?: string): Promise<QuestionView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const questions = await tx.question.findMany({
        where: { ...(bankId ? { bankId } : {}), isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 300,
        include: { options: { orderBy: { position: 'asc' } } },
      });
      return questions.map((question) => this.toQuestionView(question));
    });
  }

  async createQuestions(
    tenantId: string,
    bankId: string,
    dto: BulkQuestionsDto | CreateQuestionDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<QuestionView[]> {
    const inputs = 'questions' in dto ? dto.questions : [dto];
    if (!inputs.length) throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'No questions supplied' });

    const created = await this.prisma.withTenant(tenantId, async (tx) => {
      const bank = await tx.questionBank.findUnique({ where: { id: bankId } });
      if (!bank) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Question bank not found' });
      const rows: QuestionView[] = [];
      for (const input of inputs) {
        this.assertOptions(input.type, input.options ?? []);
        const question = await tx.question.create({
          data: {
            tenantId,
            bankId,
            type: input.type,
            difficulty: input.difficulty ?? 'MEDIUM',
            prompt: input.prompt,
            explanation: input.explanation,
            marks: input.marks,
            negativeMarks: input.negativeMarks ?? 0,
            tags: input.tags ?? [],
            createdBy: principal?.userId ?? null,
            options: {
              create: (input.options ?? []).map((option, index) => ({
                tenantId,
                label: option.label,
                content: option.content,
                isCorrect: option.isCorrect ?? false,
                position: option.position ?? index,
              })),
            },
          },
          include: { options: { orderBy: { position: 'asc' } } },
        });
        rows.push(this.toQuestionView(question));
      }
      return rows;
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'question.create',
      resourceType: 'question_bank',
      resourceId: bankId,
      newValues: { count: created.length },
      request,
    });
    return created;
  }

  async updateQuestion(
    tenantId: string,
    questionId: string,
    dto: UpdateQuestionDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<QuestionView> {
    const question = await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.question.findUnique({ where: { id: questionId } });
      if (!existing) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Question not found' });
      if (await this.isPublishedQuestion(tx, tenantId, questionId)) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'Question is referenced by a published examination version and is immutable',
        });
      }
      if (dto.options) this.assertOptions(existing.type, dto.options);
      const updated = await tx.question.update({
        where: { id: questionId },
        data: {
          prompt: dto.prompt,
          marks: dto.marks,
          negativeMarks: dto.negativeMarks,
          difficulty: dto.difficulty,
          explanation: dto.explanation,
          isActive: dto.isActive,
        },
      });
      if (dto.options) {
        await tx.questionOption.deleteMany({ where: { questionId } });
        await tx.questionOption.createMany({
          data: dto.options.map((option, index) => ({
            tenantId,
            questionId,
            label: option.label,
            content: option.content,
            isCorrect: option.isCorrect ?? false,
            position: option.position ?? index,
          })),
        });
      }
      const withOptions = await tx.question.findUniqueOrThrow({
        where: { id: updated.id },
        include: { options: { orderBy: { position: 'asc' } } },
      });
      return withOptions;
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'question.update',
      resourceType: 'question',
      resourceId: questionId,
      newValues: dto as unknown as Record<string, unknown>,
      request,
    });
    return this.toQuestionView(question);
  }

  async deleteQuestion(tenantId: string, questionId: string, principal: Principal | null, request: RequestWithContext) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const question = await tx.question.findUnique({
        where: { id: questionId },
        include: { _count: { select: { answers: true, setItems: true } } },
      });
      if (!question) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Question not found' });
      if (question._count.answers > 0 || question._count.setItems > 0 || await this.isPublishedQuestion(tx, tenantId, questionId)) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'Question is referenced by a published examination version or attempt and cannot be deleted',
        });
      }
      await tx.question.delete({ where: { id: questionId } });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'question.delete',
      resourceType: 'question',
      resourceId: questionId,
      request,
    });
    return { success: true as const };
  }

  // -------------------------------------------------------------------------
  // Examinations
  // -------------------------------------------------------------------------

  async list(tenantId: string, query: ExaminationQueryDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where: Prisma.ExaminationWhereInput = {
        ...(query.status ? { status: query.status as Prisma.ExaminationWhereInput['status'] } : {}),
        ...(query.search ? { title: { contains: query.search } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.examination.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.examination.count({ where }),
      ]);
      return {
        items: await Promise.all(rows.map((row) => this.toExamView(tx, row))),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async detail(tenantId: string, examId: string): Promise<ExamView> {
    return this.prisma.withTenant((tenantId), async (tx) => {
      const exam = await tx.examination.findUnique({ where: { id: examId } });
      if (!exam) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Examination not found' });
      return this.toExamView(tx, exam);
    });
  }

  async create(
    tenantId: string,
    dto: CreateExaminationDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<ExamView> {
    const startsAt = toDate(dto.startsAt, 'startsAt');
    const endsAt = toDate(dto.endsAt, 'endsAt');
    if (startsAt && endsAt && startsAt >= endsAt) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'endsAt must be after startsAt' });
    }

    const examId = await this.prisma.withTenant(tenantId, async (tx) => {
      const exam = await tx.examination.create({
        data: {
          tenantId,
          title: dto.title,
          description: dto.description,
          category: dto.category,
          type: dto.type,
          instructions: dto.instructions,
          durationMinutes: dto.durationMinutes,
          startsAt,
          endsAt,
          timezone: dto.timezone ?? 'UTC',
          maxAttempts: dto.maxAttempts ?? 1,
          passingMarks: dto.passingMarks,
          totalMarks: dto.totalMarks,
          negativeMarking: dto.negativeMarking ?? 0,
          randomiseQuestions: dto.randomiseQuestions ?? false,
          randomiseOptions: dto.randomiseOptions ?? false,
          createdBy: principal?.userId ?? null,
          status: 'DRAFT',
        },
      });
      await this.replaceSections(tx, tenantId, exam.id, dto.sections ?? [], dto.type);
      if (dto.securityPolicy) {
        await tx.examinationSecurityPolicy.create({
          data: {
            tenantId,
            examinationId: exam.id,
            profile: dto.securityPolicy.profile ?? 'STANDARD_BROWSER',
            requireFullscreen: dto.securityPolicy.requireFullscreen ?? false,
            tabSwitchEvents: dto.securityPolicy.tabSwitchEvents ?? true,
            screenCapturePolicy: dto.securityPolicy.screenCapturePolicy ?? 'ALLOW',
            cameraPolicy: dto.securityPolicy.cameraPolicy ?? 'OPTIONAL',
            permittedUrls: dto.securityPolicy.permittedUrls ?? [],
            reconnectionLimit: dto.securityPolicy.reconnectionLimit ?? 3,
          },
        });
      }
      return exam.id;
    });

    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'examination.create',
      resourceType: 'examination',
      resourceId: examId,
      newValues: { title: dto.title, type: dto.type },
      request,
    });
    return this.detail(tenantId, examId);
  }

  async update(
    tenantId: string,
    examId: string,
    dto: UpdateExaminationDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<ExamView> {
    const startsAt = toDate(dto.startsAt, 'startsAt');
    const endsAt = toDate(dto.endsAt, 'endsAt');
    await this.prisma.withTenant(tenantId, async (tx) => {
      const exam = await tx.examination.findUnique({ where: { id: examId } });
      if (!exam) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Examination not found' });
      if (exam.publishedAt || exam.status !== 'DRAFT') {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: 'A published examination is immutable; create a new version instead',
        });
      }
      await tx.examination.update({
        where: { id: examId },
        data: {
          title: dto.title,
          description: dto.description,
          instructions: dto.instructions,
          durationMinutes: dto.durationMinutes,
          startsAt,
          endsAt,
          passingMarks: dto.passingMarks,
          totalMarks: dto.totalMarks,
          randomiseQuestions: dto.randomiseQuestions,
          randomiseOptions: dto.randomiseOptions,
        },
      });
      if (dto.sections) await this.replaceSections(tx, tenantId, examId, dto.sections, exam.type);
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'examination.update',
      resourceType: 'examination',
      resourceId: examId,
      newValues: dto as unknown as Record<string, unknown>,
      request,
    });
    return this.detail(tenantId, examId);
  }

  async publish(
    tenantId: string,
    examId: string,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<ExamView> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const exam = await tx.examination.findUnique({ where: { id: examId } });
      if (!exam) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Examination not found' });
      if (exam.status !== 'DRAFT') {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Only draft examinations can be published' });
      }
      const sections = await this.readSections(tx, tenantId, examId);
      const questionIds = sections.flatMap((section) => section.questionIds);
      if (!questionIds.length) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'At least one question is required' });
      }
      const uniqueIds = [...new Set(questionIds)];
      const questions = await tx.question.findMany({
        where: { id: { in: uniqueIds }, isActive: true },
        include: { options: { orderBy: { position: 'asc' } } },
      });
      if (questions.length !== uniqueIds.length) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'One or more questions are missing or inactive' });
      }
      const marks = questions.reduce((sum, question) => sum + question.marks, 0);
      if (marks > exam.totalMarks) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Selected questions exceed the configured total marks',
        });
      }

      // Freeze the complete question content (including correctness and marks)
      // into this version. Delivery and grading must never read live rows.
      const byId = new Map(questions.map((question) => [question.id, question]));
      const frozenQuestions: SnapshotQuestion[] = uniqueIds.map((id) => {
        const question = byId.get(id)!;
        const options = question.options.map((option) => ({
          id: option.id,
          label: option.label,
          content: option.content,
          position: option.position,
          isCorrect: option.isCorrect,
        }));
        const expectedAnswer = question.type === 'FILL_BLANK'
          ? normaliseAnswer(options.find((option) => option.isCorrect)?.content ?? '')
          : null;
        if (question.type === 'FILL_BLANK' && !expectedAnswer) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'A fill-in-the-blank question has no correct answer configured',
          });
        }
        const core = {
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          marks: question.marks,
          negativeMarks: question.negativeMarks,
          options,
          expectedAnswer,
        };
        return {
          ...core,
          sectionId: question.sectionId,
          difficulty: String(question.difficulty),
          questionHash: snapshotHash(core),
        };
      });
      const contentHash = snapshotHash(frozenQuestions);

      const policy = await tx.examinationSecurityPolicy.findUnique({ where: { examinationId: examId } });
      const snapshot = {
        version: exam.version,
        title: exam.title,
        type: exam.type,
        durationMinutes: exam.durationMinutes,
        instructions: exam.instructions,
        startsAt: exam.startsAt?.toISOString() ?? null,
        endsAt: exam.endsAt?.toISOString() ?? null,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        negativeMarking: exam.negativeMarking,
        maxAttempts: exam.maxAttempts,
        randomiseQuestions: exam.randomiseQuestions,
        randomiseOptions: exam.randomiseOptions,
        sections,
        questions: frozenQuestions,
        contentHash,
        securityProfile: policy?.profile ?? 'STANDARD_BROWSER',
      } satisfies ExaminationSnapshot;
      const hash = snapshotHash(snapshot);
      const existing = await tx.examinationVersion.findUnique({
        where: { examinationId_version: { examinationId: examId, version: exam.version } },
      });
      if (existing) {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'This examination version already exists' });
      }
      await tx.examinationVersion.create({
        data: {
          tenantId,
          examinationId: examId,
          version: exam.version,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          immutableHash: hash,
          contentHash,
          publishedAt: new Date(),
        },
      });
      await tx.examination.update({
        where: { id: examId },
        data: { status: exam.type === 'IMMEDIATE' ? 'LIVE' : 'SCHEDULED', publishedAt: new Date() },
      });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'examination.publish',
      resourceType: 'examination',
      resourceId: examId,
      request,
    });
    return this.detail(tenantId, examId);
  }

  async updateStatus(
    tenantId: string,
    examId: string,
    dto: UpdateExamStatusDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<ExamView> {
    const previous = await this.prisma.withTenant(tenantId, async (tx) => {
      const exam = await tx.examination.findUnique({ where: { id: examId } });
      if (!exam) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Examination not found' });
      if (!STATUS_TRANSITIONS[exam.status as ExamStatus].includes(dto.status)) {
        throw new ConflictException({
          code: ERROR_CODES.CONFLICT,
          message: `Cannot change status from ${exam.status} to ${dto.status}`,
        });
      }
      if ((dto.status === 'LIVE' || dto.status === 'SCHEDULED') && !exam.publishedAt) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Publish the examination first' });
      }
      await tx.examination.update({ where: { id: examId }, data: { status: dto.status } });
      return exam.status;
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'examination.status_changed',
      resourceType: 'examination',
      resourceId: examId,
      previousValues: { status: previous },
      newValues: { status: dto.status },
      request,
    });
    return this.detail(tenantId, examId);
  }

  async setEligibility(
    tenantId: string,
    examId: string,
    dto: EligibilityDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<EligibilityView[]> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const exam = await tx.examination.findUnique({ where: { id: examId } });
      if (!exam) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Examination not found' });
      if (!exam.publishedAt) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'Publish the examination first' });
      }
      const ids = [...new Set(dto.candidateIds)];
      const candidates = await tx.candidate.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (candidates.length !== ids.length) {
        throw new BadRequestException({ code: ERROR_CODES.VALIDATION_ERROR, message: 'One or more candidates do not belong to this organisation' });
      }
      const windowStartAt = exam.startsAt ?? new Date();
      const windowEndAt = exam.endsAt ?? new Date(windowStartAt.getTime() + exam.durationMinutes * 60_000);
      for (const candidateId of ids) {
        await tx.candidateExamination.upsert({
          where: { candidateId_examinationId: { candidateId, examinationId: examId } },
          create: { tenantId, candidateId, examinationId: examId, eligible: true, eligibleAt: new Date(), windowStartAt, windowEndAt },
          update: { eligible: true, eligibleAt: new Date(), windowStartAt, windowEndAt },
        });
      }
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'examination.eligibility_set',
      resourceType: 'examination',
      resourceId: examId,
      newValues: { candidateIds: dto.candidateIds },
      request,
    });
    return this.listEligibility(tenantId, examId);
  }

  async listEligibility(tenantId: string, examId: string): Promise<EligibilityView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.candidateExamination.findMany({
        where: { examinationId: examId },
        include: { candidate: true },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id,
        candidateId: row.candidateId,
        candidateCode: row.candidate.candidateCode,
        candidateName: `${row.candidate.firstName} ${row.candidate.lastName}`,
        eligible: row.eligible,
        windowStartAt: row.windowStartAt?.toISOString() ?? null,
        windowEndAt: row.windowEndAt?.toISOString() ?? null,
      }));
    });
  }

  async listAttempts(tenantId: string, examId?: string): Promise<AttemptSummaryView[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.examinationAttempt.findMany({
        where: examId ? { examinationId: examId } : undefined,
        include: { candidate: true, examination: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
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

  async createCandidateCredentials(
    tenantId: string,
    candidateId: string,
    dto: CreateCandidateCredentialsDto,
    principal: Principal | null,
    request: RequestWithContext,
  ): Promise<CandidateCredentialsResult> {
    const email = dto.email.toLowerCase().trim();
    await this.prisma.withTenant(tenantId, async (tx) => {
      const candidate = await tx.candidate.findUnique({ where: { id: candidateId } });
      if (!candidate) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Candidate not found' });
      if (candidate.userId) {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Candidate already has portal access' });
      }
      const existing = await tx.user.findFirst({ where: { email } });
      if (existing) throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Email is already in use' });
      const candidateRole = await tx.role.findFirst({ where: { tenantId, name: 'CANDIDATE' } });
      if (!candidateRole) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Candidate role is missing' });
      const passwordHash = await this.crypto.hashSecret(dto.password);
      const user = await tx.user.create({
        data: { tenantId, email, passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
      });
      await tx.userProfile.create({
        data: { tenantId, userId: user.id, firstName: candidate.firstName, lastName: candidate.lastName },
      });
      await tx.organisationMembership.create({
        data: { tenantId, userId: user.id, isPrimary: true, status: 'ACTIVE', joinedAt: new Date() },
      });
      await tx.userRole.create({ data: { tenantId, userId: user.id, roleId: candidateRole.id } });
      await tx.candidate.update({ where: { id: candidateId }, data: { userId: user.id } });
    });
    await this.audit.record({
      actorUserId: principal?.userId,
      tenantId,
      action: 'candidate.portal_access_created',
      resourceType: 'candidate',
      resourceId: candidateId,
      newValues: { email },
      request,
    });
    return { candidateId, email, enabled: true };
  }

  // -------------------------------------------------------------------------
  // Shared helpers used by the candidate attempt service
  // -------------------------------------------------------------------------

  /** Load a specific published version, or the latest one when starting a new attempt. */
  async loadVersion(
    tx: Prisma.TransactionClient,
    tenantId: string,
    examinationId: string,
    versionId?: string | null,
  ): Promise<ExaminationVersion> {
    const version = versionId
      ? await tx.examinationVersion.findUnique({ where: { id: versionId } })
      : await tx.examinationVersion.findFirst({
          where: { tenantId, examinationId },
          orderBy: { version: 'desc' },
        });
    if (!version || version.examinationId !== examinationId || version.tenantId !== tenantId) {
      throw new ConflictException({
        code: ERROR_CODES.CONFLICT,
        message: versionId
          ? 'Attempt is bound to an invalid examination version'
          : 'Examination is not published',
      });
    }
    return version;
  }

  /**
   * Read the immutable version snapshot only. `versionId` is the attempt's bound
   * version; when absent only a new attempt may resolve the latest version.
   */
  async loadSnapshot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    examinationId: string,
    versionId?: string | null,
  ): Promise<ExaminationSnapshot> {
    const version = await this.loadVersion(tx, tenantId, examinationId, versionId);
    if (!version.publishedAt) {
      throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Examination is not published' });
    }
    const snapshot = version.snapshot as unknown as ExaminationSnapshot;
    if (
      !snapshot ||
      !Array.isArray(snapshot.sections) ||
      !Array.isArray(snapshot.questions) ||
      !snapshot.questions.length
    ) {
      throw new ConflictException({
        code: ERROR_CODES.CONFLICT,
        message: 'Published version has no frozen question snapshot; republish the examination',
      });
    }
    if (snapshot.version !== version.version) {
      throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Published snapshot version mismatch' });
    }
    // Backfilled legacy versions carry a non-sha256 `legacy:` marker and are not
    // verifiable with the current hashing algorithm.
    if (version.contentHash && /^[a-f0-9]{64}$/.test(version.contentHash)) {
      if (version.contentHash !== snapshotHash(snapshot.questions)) {
        throw new ConflictException({ code: ERROR_CODES.CONFLICT, message: 'Published snapshot content hash mismatch' });
      }
    }
    const frozenIds = new Set(snapshot.questions.map((question) => question.id));
    if (snapshot.sections.some((section) => section.questionIds.some((id) => !frozenIds.has(id)))) {
      throw new ConflictException({
        code: ERROR_CODES.CONFLICT,
        message: 'Published snapshot is missing frozen questions; republish the examination',
      });
    }
    return snapshot;
  }

  /** Published question content is immutable even when the underlying bank row still exists. */
  private async isPublishedQuestion(
    tx: Prisma.TransactionClient,
    tenantId: string,
    questionId: string,
  ): Promise<boolean> {
    const versions = await tx.examinationVersion.findMany({
      where: { tenantId, publishedAt: { not: null } },
      select: { snapshot: true },
    });
    return versions.some(({ snapshot }) => {
      const data = snapshot as {
        questions?: Array<{ id: string }>;
        sections?: Array<{ questionIds: string[] }>;
      };
      return (
        data?.questions?.some((question) => question.id === questionId) === true ||
        data?.sections?.some((section) => section.questionIds?.includes(questionId)) === true
      );
    });
  }

  private async replaceSections(
    tx: Prisma.TransactionClient,
    tenantId: string,
    examId: string,
    sections: Array<{ name: string; description?: string; marks: number; questionIds: string[] }>,
    type: Extract<CreateExaminationDto['type'], string>,
  ): Promise<void> {
    await tx.examinationSection.deleteMany({ where: { examinationId: examId } });
    const sets = await tx.questionSet.findMany({ where: { tenantId, name: { startsWith: `exam:${examId}:section:` } } });
    if (sets.length) await tx.questionSet.deleteMany({ where: { id: { in: sets.map((set) => set.id) } } });

    for (const [index, section] of sections.entries()) {
      const saved = await tx.examinationSection.create({
        data: {
          tenantId,
          examinationId: examId,
          name: section.name,
          description: section.description,
          position: index,
          marks: section.marks,
          questionCount: section.questionIds.length,
        },
      });
      const uniqueIds = [...new Set(section.questionIds)];
      if (uniqueIds.length) {
        const found = await tx.question.count({ where: { id: { in: uniqueIds }, isActive: true } });
        if (found !== uniqueIds.length) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'One or more selected questions are missing or inactive',
          });
        }
        const set = await tx.questionSet.create({
          data: { tenantId, name: `exam:${examId}:section:${saved.id}`, description: section.name },
        });
        await tx.questionSetItem.createMany({
          data: uniqueIds.map((questionId, position) => ({ tenantId, setId: set.id, questionId, position })),
        });
      }
    }
    if (!sections.length && type !== 'PRACTICE') {
      // An empty exam is allowed as a draft, but publish() will reject it.
      return;
    }
  }

  private async readSections(
    tx: Prisma.TransactionClient,
    tenantId: string,
    examId: string,
  ): Promise<ExamSectionView[]> {
    const sections = await tx.examinationSection.findMany({ where: { examinationId: examId }, orderBy: { position: 'asc' } });
    const sets = await tx.questionSet.findMany({ where: { tenantId, name: { startsWith: `exam:${examId}:section:` } } });
    return Promise.all(
      sections.map(async (section) => {
        const set = sets.find((item) => item.name === `exam:${examId}:section:${section.id}`);
        const items = set
          ? await tx.questionSetItem.findMany({ where: { setId: set.id }, orderBy: { position: 'asc' } })
          : [];
        return {
          id: section.id,
          name: section.name,
          description: section.description,
          position: section.position,
          marks: section.marks,
          questionIds: items.map((item) => item.questionId),
        };
      }),
    );
  }

  private async toExamView(tx: Prisma.TransactionClient, exam: Examination): Promise<ExamView> {
    const sections = await this.readSections(tx, exam.tenantId, exam.id);
    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      category: exam.category,
      type: exam.type,
      status: exam.status,
      instructions: exam.instructions,
      durationMinutes: exam.durationMinutes,
      startsAt: exam.startsAt?.toISOString() ?? null,
      endsAt: exam.endsAt?.toISOString() ?? null,
      timezone: exam.timezone,
      maxAttempts: exam.maxAttempts,
      passingMarks: exam.passingMarks,
      totalMarks: exam.totalMarks,
      negativeMarking: exam.negativeMarking,
      randomiseQuestions: exam.randomiseQuestions,
      randomiseOptions: exam.randomiseOptions,
      version: exam.version,
      publishedAt: exam.publishedAt?.toISOString() ?? null,
      questionCount: sections.reduce((sum, section) => sum + section.questionIds.length, 0),
      sections,
      createdAt: exam.createdAt.toISOString(),
    };
  }

  private toQuestionView(question: {
    id: string;
    type: QuestionView['type'];
    prompt: string;
    marks: number;
    negativeMarks: number;
    difficulty: string;
    sectionId: string | null;
    options: Array<{ id: string; label: string; content: string; position: number }>;
  }): QuestionView {
    return {
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      marks: question.marks,
      negativeMarks: question.negativeMarks,
      difficulty: question.difficulty,
      sectionId: question.sectionId,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.label,
        content: option.content,
        position: option.position,
      })),
    };
  }

  private assertOptions(type: string, options: Array<{ label: string; isCorrect?: boolean }>): void {
    if (['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK'].includes(type)) {
      if (!options.some((option) => option.isCorrect)) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Objective questions require at least one correct option',
        });
      }
    }
  }
}
