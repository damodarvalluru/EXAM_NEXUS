import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Principal } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AttemptsService } from './attempts.service';
import { ExaminationsService } from './examinations.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type {
  CreateExaminationDto,
  EligibilityDto,
  SaveAnswerDto,
  SubmitAttemptDto,
} from './dto/examination.dto';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';

/** Opt-in end-to-end service flow against the configured TiDB Cloud database. */
const describeLive = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeLive('examination flow (live database)', () => {
  let prisma: PrismaService;
  let examinations: ExaminationsService;
  let attempts: AttemptsService;
  let tenantId: string;
  let candidateId: string;
  let userId: string;
  let examId: string;
  let questionId: string;
  let bankId: string;
  let principal: Principal;
  const extraUserIds: string[] = [];
  const request = { header: () => undefined } as unknown as RequestWithContext;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for live examination tests');
    const config = {
      getOrThrow: (key: string) =>
        key === 'security.encryptionMasterKey'
          ? Buffer.from('phase4-test-encryption-key').toString('base64')
          : process.env.DATABASE_URL,
      get: () => undefined,
    } as unknown as ConfigService;
    prisma = new PrismaService(config);
    await prisma.onModuleInit();

    const suffix = randomUUID().slice(0, 8);
    const audit = new AuditService(prisma);
    const crypto = new CryptoService(config);
    const realtime = { emitAttemptClock: jest.fn(), emitAttemptState: jest.fn() } as unknown as RealtimeGateway;
    examinations = new ExaminationsService(prisma, audit, crypto);
    attempts = new AttemptsService(prisma, audit, examinations, realtime);

    tenantId = await prisma.withElevated((tx) =>
      tx.organisation.create({
        data: {
          name: 'Examination flow test',
          slug: `exam-flow-${suffix}`,
          officialEmail: `exam-flow-${suffix}@example.invalid`,
          status: 'APPROVED',
        },
      }).then((row) => row.id),
    );

    userId = await prisma.withElevated((tx) =>
      tx.user.create({
        data: { email: `candidate-${suffix}@example.invalid`, status: 'ACTIVE', tenantId },
      }).then((row) => row.id),
    );
    candidateId = await prisma.withElevated((tx) =>
      tx.candidate.create({
        data: {
          tenantId,
          userId,
          candidateCode: `C-${suffix}`,
          firstName: 'Live',
          lastName: 'Candidate',
          email: `candidate-${suffix}@example.invalid`,
        },
      }).then((row) => row.id),
    );
    principal = {
      userId,
      email: `candidate-${suffix}@example.invalid`,
      tenantId,
      globalRoles: [],
      tenantRoles: ['CANDIDATE'],
      permissions: [],
      sessionId: 'test-session',
      authMethod: 'PASSWORD',
      stepUpVerifiedAt: null,
    } as Principal;

    const bank = await examinations.createBank(
      tenantId,
      { name: 'Flow bank', description: 'Temporary', category: 'TEST' },
      principal,
      request,
    );
    bankId = bank.id;
    const [question] = await examinations.createQuestions(tenantId, bankId, {
      questions: [{
        type: 'SINGLE_CHOICE' as never,
        prompt: 'What is 2 + 2?',
        marks: 10,
        options: [
          { label: 'A', content: '3', isCorrect: false },
          { label: 'B', content: '4', isCorrect: true },
        ],
      }],
    } as never, principal, request);
    questionId = question!.id;

    const exam = await examinations.create(tenantId, {
      title: 'Live flow examination',
      type: 'IMMEDIATE',
      durationMinutes: 30,
      totalMarks: 10,
      passingMarks: 5,
      sections: [{ name: 'Main', marks: 10, questionIds: [questionId] }],
    } as CreateExaminationDto, principal, request);
    examId = exam.id;
  }, 180_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.withElevated((tx) => tx.auditLog.deleteMany({ where: { tenantId } }));
    if (extraUserIds.length) {
      await prisma.withElevated((tx) => tx.user.deleteMany({ where: { id: { in: extraUserIds } } }));
    }
    if (userId) await prisma.withElevated((tx) => tx.user.deleteMany({ where: { id: userId } }));
    if (tenantId) await prisma.withElevated((tx) => tx.organisation.deleteMany({ where: { id: tenantId } }));
    await prisma.onModuleDestroy();
  }, 180_000);

  async function makeCandidate(label: string): Promise<{ id: string; principal: Principal }> {
    const suffix = randomUUID().slice(0, 8);
    const email = `${label.toLowerCase()}-${suffix}@example.invalid`;
    const id = await prisma.withElevated((tx) =>
      tx.user.create({ data: { email, status: 'ACTIVE', tenantId } }).then((row) => row.id),
    );
    extraUserIds.push(id);
    const candidate = await prisma.withElevated((tx) =>
      tx.candidate.create({
        data: { tenantId, userId: id, candidateCode: `${label}-${suffix}`, firstName: label, lastName: 'Candidate', email },
      }).then((row) => row.id),
    );
    return {
      id: candidate,
      principal: { ...principal, userId: id, email } as Principal,
    };
  }

  async function makeQuestion(
    prompt: string,
    marks: number,
    options: Array<{ label: string; content: string; isCorrect: boolean }>,
    type = 'SINGLE_CHOICE',
  ): Promise<string> {
    const [question] = await examinations.createQuestions(tenantId, bankId, {
      questions: [{ type: type as never, prompt, marks, options }],
    } as never, principal, request);
    return question!.id;
  }

  async function makePublishedExam(options: {
    title: string;
    questionIds: string[];
    totalMarks: number;
    candidateId: string;
    candidatePrincipal: Principal;
    durationMinutes?: number;
  }): Promise<string> {
    const exam = await examinations.create(tenantId, {
      title: options.title,
      type: 'IMMEDIATE',
      durationMinutes: options.durationMinutes ?? 30,
      totalMarks: options.totalMarks,
      passingMarks: 0,
      sections: [{ name: 'Main', marks: options.totalMarks, questionIds: options.questionIds }],
    } as CreateExaminationDto, options.candidatePrincipal, request);
    await examinations.publish(tenantId, exam.id, options.candidatePrincipal, request);
    await examinations.setEligibility(
      tenantId,
      exam.id,
      { candidateIds: [options.candidateId] } as EligibilityDto,
      options.candidatePrincipal,
      request,
    );
    return exam.id;
  }

  it('takes a candidate from eligible exam to graded result with a stable receipt', async () => {
    await examinations.publish(tenantId, examId, principal, request);
    await examinations.setEligibility(tenantId, examId, { candidateIds: [candidateId] } as EligibilityDto, principal, request);

    const available = await attempts.availableExams(tenantId, principal);
    expect(available.find((exam) => exam.id === examId)?.available).toBe(true);

    const view = await attempts.start(tenantId, examId, principal, request);
    expect(view.status).toBe('IN_PROGRESS');
    expect(view.questions).toHaveLength(1);
    expect(view.questions[0]?.options.every((option) => !('isCorrect' in option))).toBe(true);

    await attempts.saveAnswer(tenantId, view.id, {
      questionId,
      answer: { value: 'B' },
      idempotencyKey: `live:${view.id}:${questionId}`,
    } as SaveAnswerDto, principal);

    const receipt = await attempts.submit(tenantId, view.id, {
      idempotencyKey: `live-submit:${view.id}`,
      clientTime: new Date().toISOString(),
    } as SubmitAttemptDto, principal, request);
    expect(receipt.score).toBe(10);
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/);

    const duplicate = await attempts.submit(tenantId, view.id, {
      idempotencyKey: `live-submit:${view.id}`,
      clientTime: new Date(Date.now() + 60_000).toISOString(),
    } as SubmitAttemptDto, principal, request);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.submissionId).toBe(receipt.submissionId);
    expect(duplicate.receiptHash).toBe(receipt.receiptHash);
    expect(duplicate.submittedAt).toBe(receipt.submittedAt);
    expect(duplicate.status).toBe(receipt.status);
    expect(duplicate.score).toBe(receipt.score);

    const result = await attempts.result(tenantId, view.id, principal);
    expect(result.score).toBe(10);
    expect(result.totalMarks).toBe(10);
  }, 180_000);

  it('freezes published content and refuses mutation or deletion of published questions', async () => {
    const frozenId = await makeQuestion('Capital of France?', 7, [
      { label: 'A', content: 'Paris', isCorrect: true },
      { label: 'B', content: 'London', isCorrect: false },
    ]);
    const frozenExamId = await makePublishedExam({
      title: 'Frozen snapshot examination',
      questionIds: [frozenId],
      totalMarks: 7,
      candidateId,
      candidatePrincipal: principal,
    });

    // Simulate an out-of-band edit: delivery and grading must still use the snapshot.
    await prisma.withElevated((tx) =>
      tx.question.update({
        where: { id: frozenId },
        data: {
          prompt: 'Tampered prompt',
          marks: 99,
          options: {
            deleteMany: {},
            create: [
              { tenantId, label: 'A', content: 'Tampered', isCorrect: false, position: 0 },
              { tenantId, label: 'B', content: 'London', isCorrect: true, position: 1 },
            ],
          },
        },
      }),
    );
    await expect(
      examinations.updateQuestion(tenantId, frozenId, { prompt: 'Another edit' }, principal, request),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      examinations.deleteQuestion(tenantId, frozenId, principal, request),
    ).rejects.toMatchObject({ status: 409 });

    const view = await attempts.start(tenantId, frozenExamId, principal, request);
    const delivered = view.questions[0]!;
    expect(delivered.prompt).toBe('Capital of France?');
    expect(delivered.marks).toBe(7);
    expect(delivered.options.map((option) => option.content)).toEqual(['Paris', 'London']);

    await attempts.saveAnswer(tenantId, view.id, {
      questionId: frozenId,
      answer: { value: delivered.options[0]!.id },
      idempotencyKey: `frozen:${view.id}`,
    } as SaveAnswerDto, principal);
    const receipt = await attempts.submit(tenantId, view.id, {
      idempotencyKey: `frozen-submit:${view.id}`,
    } as SubmitAttemptDto, principal, request);
    expect(receipt.score).toBe(7);
  }, 180_000);

  it('never sends fill-in-the-blank options and grades the hidden expected answer', async () => {
    const blankId = await makeQuestion('Capital of India?', 5, [
      { label: 'A', content: 'New Delhi', isCorrect: true },
    ], 'FILL_BLANK');
    const candidate = await makeCandidate('Blank');
    const blankExamId = await makePublishedExam({
      title: 'Fill blank examination',
      questionIds: [blankId],
      totalMarks: 5,
      candidateId: candidate.id,
      candidatePrincipal: candidate.principal,
    });

    const view = await attempts.start(tenantId, blankExamId, candidate.principal, request);
    expect(view.questions[0]?.options).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('New Delhi');

    await attempts.saveAnswer(tenantId, view.id, {
      questionId: blankId,
      answer: { value: '  new DELHI ' },
      idempotencyKey: `blank:${view.id}`,
    } as SaveAnswerDto, candidate.principal);
    const receipt = await attempts.submit(tenantId, view.id, {
      idempotencyKey: `blank-submit:${view.id}`,
    } as SubmitAttemptDto, candidate.principal, request);
    expect(receipt.score).toBe(5);
  }, 180_000);

  it('allows one answer per question and rejects a changed idempotency key with 409', async () => {
    const firstId = await makeQuestion('First question?', 6, [
      { label: 'A', content: 'Right', isCorrect: true },
      { label: 'B', content: 'Wrong', isCorrect: false },
    ]);
    const secondId = await makeQuestion('Second question?', 6, [
      { label: 'A', content: 'Right', isCorrect: true },
      { label: 'B', content: 'Wrong', isCorrect: false },
    ]);
    const candidate = await makeCandidate('Single');
    const exam = await makePublishedExam({
      title: 'Single answer examination',
      questionIds: [firstId, secondId],
      totalMarks: 12,
      candidateId: candidate.id,
      candidatePrincipal: candidate.principal,
    });

    const view = await attempts.start(tenantId, exam, candidate.principal, request);
    const correctIds = new Map(view.questions.map((question) => [
      question.id,
      question.options.find((option, index) => index === 0)!.id,
    ]));
    await attempts.saveAnswer(tenantId, view.id, {
      questionId: firstId,
      answer: { value: correctIds.get(firstId) },
      idempotencyKey: `single:${view.id}:first`,
    } as SaveAnswerDto, candidate.principal);

    await expect(attempts.saveAnswer(tenantId, view.id, {
      questionId: firstId,
      answer: { value: 'wrong' },
      idempotencyKey: `single:${view.id}:first:changed`,
    } as SaveAnswerDto, candidate.principal)).rejects.toMatchObject({ status: 409 });
    await expect(attempts.saveAnswer(tenantId, view.id, {
      questionId: secondId,
      answer: { value: correctIds.get(secondId) },
      idempotencyKey: `single:${view.id}:first`,
    } as SaveAnswerDto, candidate.principal)).rejects.toMatchObject({ status: 409 });

    await attempts.saveAnswer(tenantId, view.id, {
      questionId: secondId,
      answer: { value: correctIds.get(secondId) },
      idempotencyKey: `single:${view.id}:second`,
    } as SaveAnswerDto, candidate.principal);
    const receipt = await attempts.submit(tenantId, view.id, {
      idempotencyKey: `single-submit:${view.id}`,
    } as SubmitAttemptDto, candidate.principal, request);
    expect(receipt.score).toBe(12);
    const saved = await prisma.withTenant(tenantId, (tx) =>
      tx.candidateAnswer.count({ where: { attemptId: view.id } }),
    );
    expect(saved).toBe(2);
  }, 180_000);

  it('does not return another attempt receipt when an idempotency key is reused', async () => {
    const questionA = await makeQuestion('Exam A?', 3, [
      { label: 'A', content: 'Yes', isCorrect: true },
    ]);
    const questionB = await makeQuestion('Exam B?', 3, [
      { label: 'A', content: 'Yes', isCorrect: true },
    ]);
    const candidate = await makeCandidate('Reuse');
    const examA = await makePublishedExam({
      title: 'Reuse key exam A', questionIds: [questionA], totalMarks: 3,
      candidateId: candidate.id, candidatePrincipal: candidate.principal,
    });
    const examB = await makePublishedExam({
      title: 'Reuse key exam B', questionIds: [questionB], totalMarks: 3,
      candidateId: candidate.id, candidatePrincipal: candidate.principal,
    });
    const sharedKey = `reused:${randomUUID()}`;

    const attemptA = await attempts.start(tenantId, examA, candidate.principal, request);
    const receiptA = await attempts.submit(tenantId, attemptA.id, {
      idempotencyKey: sharedKey,
    } as SubmitAttemptDto, candidate.principal, request);
    expect(receiptA.duplicate).toBe(false);

    const attemptB = await attempts.start(tenantId, examB, candidate.principal, request);
    const receiptB = await attempts.submit(tenantId, attemptB.id, {
      idempotencyKey: sharedKey,
    } as SubmitAttemptDto, candidate.principal, request);
    expect(receiptB.duplicate).toBe(false);
    expect(receiptB.attemptId).toBe(attemptB.id);
    expect(receiptB.submissionId).not.toBe(receiptA.submissionId);
  }, 180_000);

  it('never settles another candidate’s expired attempt', async () => {
    const owner = await makeCandidate('Owner');
    const peer = await makeCandidate('Peer');
    const ownedQuestion = await makeQuestion('Owned question?', 4, [
      { label: 'A', content: 'Yes', isCorrect: true },
    ]);
    const exam = await makePublishedExam({
      title: 'Ownership examination',
      questionIds: [ownedQuestion],
      totalMarks: 4,
      candidateId: owner.id,
      candidatePrincipal: owner.principal,
    });
    const view = await attempts.start(tenantId, exam, owner.principal, request);
    await prisma.withElevated((tx) =>
      tx.examinationAttempt.update({
        where: { id: view.id },
        data: { serverEndAt: new Date(Date.now() - 60_000) },
      }),
    );

    await expect(attempts.getAttempt(tenantId, view.id, peer.principal)).rejects.toMatchObject({ status: 404 });
    await expect(attempts.saveAnswer(tenantId, view.id, {
      questionId: ownedQuestion,
      answer: { value: 'A' },
      idempotencyKey: `peer:${view.id}`,
    } as SaveAnswerDto, peer.principal)).rejects.toMatchObject({ status: 404 });
    await expect(attempts.submit(tenantId, view.id, {
      idempotencyKey: `peer-submit:${view.id}`,
    } as SubmitAttemptDto, peer.principal, request)).rejects.toMatchObject({ status: 404 });

    const raw = await prisma.withElevated((tx) =>
      tx.examinationAttempt.findUniqueOrThrow({ where: { id: view.id } }),
    );
    expect(raw.status).toBe('IN_PROGRESS');
    expect(await prisma.withElevated((tx) => tx.submission.count({ where: { attemptId: view.id } }))).toBe(0);
  }, 180_000);
});
