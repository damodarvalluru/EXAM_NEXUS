import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Principal } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/services/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AttemptsService } from '../examinations/attempts.service';
import { ExaminationsService } from '../examinations/examinations.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { CreateExaminationDto, EligibilityDto, SaveAnswerDto, SubmitAttemptDto } from '../examinations/dto/examination.dto';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { CertificatesService } from './certificates.service';
import { EvaluationService } from './evaluation.service';
import { ProctoringService } from './proctoring.service';
import { ResultsService } from './results.service';

/** Opt-in end-to-end Phase 7 service flow against the configured TiDB Cloud database. */
const describeLive = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeLive('phase 7 flow (live database)', () => {
  let prisma: PrismaService;
  let examinations: ExaminationsService;
  let attempts: AttemptsService;
  let evaluations: EvaluationService;
  let results: ResultsService;
  let proctoring: ProctoringService;
  let certificates: CertificatesService;
  let tenantId: string;
  let candidateId: string;
  let evaluatorId: string;
  let candidatePrincipal: Principal;
  let evaluatorPrincipal: Principal;
  let examId: string;
  let questionId: string;
  const request = { header: () => undefined } as unknown as RequestWithContext;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for live Phase 7 tests');
    const config = {
      getOrThrow: (key: string) =>
        key === 'security.encryptionMasterKey'
          ? Buffer.from('phase7-test-encryption-key').toString('base64')
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
    evaluations = new EvaluationService(prisma, audit, examinations);
    results = new ResultsService(prisma, audit, examinations);
    proctoring = new ProctoringService(prisma, audit, config);
    certificates = new CertificatesService(prisma, audit);

    tenantId = await prisma.withElevated((tx) =>
      tx.organisation.create({
        data: {
          name: 'Phase 7 flow test',
          slug: `phase7-flow-${suffix}`,
          officialEmail: `phase7-flow-${suffix}@example.invalid`,
          status: 'APPROVED',
        },
      }).then((row) => row.id),
    );

    const makeUser = async (label: string, tenantRoles: string[]): Promise<{ id: string; principal: Principal }> => {
      const email = `${label}-${suffix}@example.invalid`;
      const id = await prisma.withElevated((tx) =>
        tx.user.create({ data: { email, status: 'ACTIVE', tenantId } }).then((row) => row.id),
      );
      return {
        id,
        principal: {
          userId: id,
          email,
          tenantId,
          globalRoles: [],
          tenantRoles: tenantRoles as Principal['tenantRoles'],
          permissions: [],
          sessionId: `session-${label}`,
          authMethod: 'PASSWORD',
          stepUpVerifiedAt: null,
        } as Principal,
      };
    };

    const candidate = await makeUser('candidate', ['CANDIDATE']);
    candidateId = await prisma.withElevated((tx) =>
      tx.candidate.create({
        data: {
          tenantId,
          userId: candidate.id,
          candidateCode: `P7-${suffix}`,
          firstName: 'Phase',
          lastName: 'Candidate',
          email: candidate.principal.email ?? `candidate-${suffix}@example.invalid`,
        },
      }).then((row) => row.id),
    );
    candidatePrincipal = candidate.principal;

    const evaluator = await makeUser('evaluator', ['EVALUATOR']);
    evaluatorId = evaluator.id;
    evaluatorPrincipal = evaluator.principal;

    const bank = await examinations.createBank(
      tenantId,
      { name: 'Phase 7 bank', description: 'Temporary', category: 'TEST' },
      evaluatorPrincipal,
      request,
    );
    const [question] = await examinations.createQuestions(tenantId, bank.id, {
      questions: [{ type: 'LONG_ANSWER' as never, prompt: 'Explain the tradeoffs of indexes.', marks: 10 }],
    } as never, evaluatorPrincipal, request);
    questionId = question!.id;

    const exam = await examinations.create(tenantId, {
      title: 'Phase 7 live examination',
      type: 'IMMEDIATE',
      durationMinutes: 30,
      totalMarks: 10,
      passingMarks: 5,
      sections: [{ name: 'Main', marks: 10, questionIds: [questionId] }],
    } as CreateExaminationDto, evaluatorPrincipal, request);
    examId = exam.id;
    await examinations.publish(tenantId, examId, evaluatorPrincipal, request);
    await examinations.setEligibility(
      tenantId,
      examId,
      { candidateIds: [candidateId] } as EligibilityDto,
      evaluatorPrincipal,
      request,
    );
  }, 240_000);

  afterAll(async () => {
    if (!prisma) return;
    if (tenantId) {
      await prisma.withElevated((tx) => tx.auditLog.deleteMany({ where: { tenantId } }));
      await prisma.withElevated((tx) => tx.organisation.deleteMany({ where: { id: tenantId } }));
    }
    await prisma.onModuleDestroy();
  }, 240_000);

  it('reviews, publishes, certifies and verifies a subjective result', async () => {
    const view = await attempts.start(tenantId, examId, candidatePrincipal, request);
    const session = await proctoring.registerSession(tenantId, {
      attemptId: view.id,
      deviceId: `phase7-device-${randomUUID().slice(0, 8)}`,
      platform: 'TEST',
    } as never, candidatePrincipal, request);
    expect(session.sessionToken).toBeTruthy();
    expect(session.sessionTokenExpiresAt).toBeTruthy();

    const event = await proctoring.ingestEvent(tenantId, view.id, {
      eventType: 'TAB_HIDDEN',
      sessionToken: session.sessionToken!,
    } as never, candidatePrincipal, request);
    expect(event.event.eventType).toBe('TAB_HIDDEN');
    expect(event.assessment.modelVersion).toBeTruthy();

    await attempts.saveAnswer(tenantId, view.id, {
      questionId,
      answer: { value: 'Indexes improve reads but slow writes because each insert updates the index.' },
      idempotencyKey: `phase7:${view.id}:${questionId}`,
    } as SaveAnswerDto, candidatePrincipal);
    const receipt = await attempts.submit(tenantId, view.id, {
      idempotencyKey: `phase7-submit:${view.id}`,
      clientTime: new Date().toISOString(),
    } as SubmitAttemptDto, candidatePrincipal, request);
    expect(receipt.score).toBe(0);

    const initialResult = await prisma.withTenant(tenantId, async (tx) =>
      tx.result.findFirst({ where: { attemptId: view.id }, orderBy: { version: 'desc' } }),
    );
    expect(initialResult?.status).toBe('PENDING');
    await expect(attempts.result(tenantId, view.id, candidatePrincipal)).rejects.toThrow('not published');

    const queue = await evaluations.queue(tenantId);
    expect(queue.some((item) => item.attemptId === view.id)).toBe(true);
    const detail = await evaluations.detail(tenantId, view.id, true, evaluatorPrincipal);
    expect(detail.candidateName).toContain('Withheld');
    expect(detail.answers).toHaveLength(1);

    const suggestion = await evaluations.suggest(tenantId, view.id, questionId, evaluatorPrincipal, request);
    expect(suggestion.requiresHumanReview).toBe(true);
    await expect(
      results.approve(tenantId, initialResult!.id, { publish: true }, evaluatorPrincipal, request),
    ).rejects.toThrow('human evaluation');

    const reviewed = await evaluations.review(tenantId, view.id, {
      answers: [{ questionId, marks: 8, status: 'COMPLETED', feedback: 'Good tradeoff discussion' }],
      note: 'Accepted after human review',
    } as never, evaluatorPrincipal, request);
    expect(reviewed.score).toBe(8);
    expect(reviewed.resultVersion).toBe(2);

    const published = await results.approve(tenantId, reviewed.resultId!, { publish: true }, evaluatorPrincipal, request);
    expect(published.status).toBe('PUBLISHED');
    const candidateResult = await attempts.result(tenantId, view.id, candidatePrincipal);
    expect(candidateResult.score).toBe(8);

    const certificate = await certificates.issue(tenantId, published.id, evaluatorPrincipal, request);
    expect(certificate.score).toBe(8);
    const verification = await certificates.verify(certificate.verificationCode);
    expect(verification).toMatchObject({ valid: true, score: 8 });
    const pdf = await certificates.pdf(tenantId, certificate.id);
    expect(pdf.data.subarray(0, 4).toString('latin1')).toBe('%PDF');

    const proctorDetail = await proctoring.detail(tenantId, view.id);
    expect(proctorDetail.events.length).toBeGreaterThan(0);
    expect(proctorDetail.assessments.length).toBeGreaterThan(0);

    // Keep references used so cleanup analysis does not discard setup values.
    expect([evaluatorId, tenantId]).toContain(tenantId);
  }, 240_000);
});
