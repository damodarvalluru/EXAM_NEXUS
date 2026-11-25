import { BadRequestException } from '@nestjs/common';
import { suggestMarks, AI_EVALUATOR_VERSION } from './ai-evaluator';
import { assessRisk, classify, parseThresholds, RISK_MODEL_VERSION } from './risk-engine';
import { buildCertificatePdf } from './certificate-pdf';
import { ResultsService } from './results.service';

describe('Phase 7 deterministic evaluation', () => {
  it('produces an explainable suggestion that always requires human review', () => {
    const suggestion = suggestMarks({
      attemptId: 'attempt-1',
      questionId: 'question-1',
      prompt: 'Explain database indexes and their tradeoffs',
      answer: 'Indexes speed up reads. They also increase write cost because every insert must update the index. Use them selectively.',
      maxMarks: 10,
      questionType: 'LONG_ANSWER',
      evaluationId: 'evaluation-1',
    });

    expect(suggestion.requiresHumanReview).toBe(true);
    expect(suggestion.modelVersion).toBe(AI_EVALUATOR_VERSION);
    expect(suggestion.suggestedMarks).toBeGreaterThanOrEqual(0);
    expect(suggestion.suggestedMarks).toBeLessThanOrEqual(10);
    expect(suggestion.rubricBreakdown).toHaveLength(4);
    expect(suggestion.rationale.length).toBeGreaterThan(0);
  });

  it('never awards marks for an empty answer', () => {
    const suggestion = suggestMarks({
      attemptId: 'attempt-1',
      questionId: 'question-1',
      prompt: 'Explain database indexes and their tradeoffs',
      answer: '',
      maxMarks: 10,
      questionType: 'ESSAY',
      evaluationId: 'evaluation-1',
    });
    expect(suggestion.suggestedMarks).toBe(0);
  });
});

describe('Phase 7 proctoring risk engine', () => {
  // The engine uses a rolling five-minute window, so fixtures must be recent.
  const base = new Date(Date.now() - 30_000);

  it('keeps configured thresholds monotonic', () => {
    expect(parseThresholds({ low: 50, moderate: 10, high: 20, critical: 30 })).toEqual({
      low: 50,
      moderate: 51,
      high: 52,
      critical: 53,
    });
  });

  it('classifies scores consistently', () => {
    expect(classify(0)).toBe('NORMAL');
    expect(classify(20)).toBe('LOW');
    expect(classify(40)).toBe('MODERATE');
    expect(classify(60)).toBe('HIGH');
    expect(classify(80)).toBe('CRITICAL');
  });

  it('caps explainable scores at 100 and records the contributing rules', () => {
    const result = assessRisk(
      [
        { eventType: 'MULTIPLE_SESSION', severity: 'CRITICAL', riskWeight: 30, serverTime: base },
        { eventType: 'MULTIPLE_SESSION', severity: 'CRITICAL', riskWeight: 30, serverTime: base },
        { eventType: 'MULTIPLE_SESSION', severity: 'CRITICAL', riskWeight: 30, serverTime: base },
        { eventType: 'MULTIPLE_SESSION', severity: 'CRITICAL', riskWeight: 30, serverTime: base },
      ],
      parseThresholds(undefined),
    );
    expect(result.modelVersion).toBe(RISK_MODEL_VERSION);
    expect(result.level).toBe('CRITICAL');
    expect(result.score).toBe(100);
    expect(result.rules.some((rule) => rule.rule.startsWith('repeat:'))).toBe(true);
  });
});

describe('Phase 7 certificate document', () => {
  it('emits a single-page PDF with the expected header and trailer', () => {
    const pdf = buildCertificatePdf(['ExamNexus Certificate', 'Candidate']);
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.toString('latin1')).toContain('/Type /Catalog');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });
});

describe('ResultsService publication guard', () => {
  const resultRow = {
    id: 'result-1',
    attemptId: 'attempt-1',
    examinationId: 'exam-1',
    candidateId: 'candidate-1',
    score: 10,
    maxScore: 20,
    percentage: 50,
    passed: true,
    status: 'PENDING' as const,
    version: 1,
    publishedAt: null,
    approvedBy: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    examination: { title: 'Exam', totalMarks: 20 },
    candidate: { firstName: 'Ada', lastName: 'Lovelace', candidateCode: 'C-1' },
  };
  const attemptRow = {
    id: 'attempt-1',
    examinationId: 'exam-1',
    versionId: 'version-1',
    answers: [{ questionId: 'question-1' }],
    evaluations: [] as Array<{ questionId: string | null; status: string; score: number | null }>,
  };

  function buildService(evaluations: typeof attemptRow.evaluations) {
    const tx = {
      result: {
        findUnique: jest.fn().mockResolvedValue(resultRow),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...resultRow,
          ...data,
        })),
      },
      examinationAttempt: {
        findUnique: jest.fn().mockResolvedValue({ ...attemptRow, evaluations }),
      },
    };
    const prisma = { withTenant: jest.fn(async (_tenant: string, work: (tx: unknown) => Promise<unknown>) => work(tx)) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const examinations = {
      loadSnapshot: jest.fn().mockResolvedValue({
        questions: [{ id: 'question-1', type: 'ESSAY', marks: 10 }],
      }),
    };
    const service = new ResultsService(
      prisma as never,
      audit as never,
      examinations as never,
    );
    return { service, tx, audit };
  }

  const principal = {
    userId: 'reviewer-1',
    email: 'reviewer@example.test',
    tenantId: 'tenant-1',
    globalRoles: [],
    tenantRoles: ['EVALUATOR'],
    permissions: [],
    sessionId: 'session-1',
    authMethod: 'PASSWORD',
    stepUpVerifiedAt: null,
  };
  const request = { header: () => undefined } as never;

  it('refuses to approve a result with an unreviewed subjective answer', async () => {
    const { service, tx, audit } = buildService([]);
    await expect(
      service.approve('tenant-1', 'result-1', { publish: true }, principal as never, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.result.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('publishes a result after a completed human evaluation exists', async () => {
    const { service, tx, audit } = buildService([
      { questionId: 'question-1', status: 'COMPLETED', score: 8 },
    ]);
    const view = await service.approve(
      'tenant-1',
      'result-1',
      { publish: true, note: 'Reviewed' },
      principal as never,
      request,
    );
    expect(view.status).toBe('PUBLISHED');
    expect(tx.result.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PUBLISHED' }),
    }));
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});
