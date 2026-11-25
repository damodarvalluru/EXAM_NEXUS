import { ForbiddenException } from '@nestjs/common';
import { isAcceptedEvaluation, latestEvaluationByQuestion } from './current-evaluation';
import { issueProctorToken, verifyProctorToken } from './proctor-token';
import { csvCell } from './reports.service';
import { ProctoringService } from './proctoring.service';

const SECRET = 'phase7-unit-test-secret-key';

describe('Evaluation history integrity', () => {
  it('uses only the latest evaluation for a question', () => {
    const rows = [
      { id: 'old', questionId: 'q1', status: 'COMPLETED', score: 9, createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'new', questionId: 'q1', status: 'REVISION', score: null, createdAt: new Date('2026-01-02T00:00:00Z') },
    ];
    const current = latestEvaluationByQuestion(rows);
    expect(current.get('q1')?.id).toBe('new');
    expect(isAcceptedEvaluation(current.get('q1'))).toBe(false);
  });

  it('keeps a completed mark when it is still the latest row', () => {
    const current = latestEvaluationByQuestion([
      { id: 'a', questionId: 'q1', status: 'COMPLETED', score: 7, createdAt: new Date('2026-01-02T00:00:00Z') },
      { id: 'b', questionId: 'q1', status: 'PENDING', score: null, createdAt: new Date('2026-01-01T00:00:00Z') },
    ]);
    expect(isAcceptedEvaluation(current.get('q1'))).toBe(true);
  });
});

describe('Short-lived proctoring tokens', () => {
  it('issues a token bound to one tenant and attempt', () => {
    const { token, expiresAt } = issueProctorToken(SECRET, 'tenant-1', 'attempt-1');
    expect(verifyProctorToken(SECRET, 'tenant-1', 'attempt-1', token)).toBe(true);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(verifyProctorToken(SECRET, 'tenant-2', 'attempt-1', token)).toBe(false);
    expect(verifyProctorToken(SECRET, 'tenant-1', 'attempt-2', token)).toBe(false);
  });

  it('rejects expired and tampered tokens', () => {
    const { token } = issueProctorToken(SECRET, 'tenant-1', 'attempt-1', Date.now() - 31 * 60_000);
    expect(verifyProctorToken(SECRET, 'tenant-1', 'attempt-1', token)).toBe(false);
    const valid = issueProctorToken(SECRET, 'tenant-1', 'attempt-1').token;
    expect(verifyProctorToken(SECRET, 'tenant-1', 'attempt-1', `${valid}x`)).toBe(false);
  });
});

describe('CSV export safety', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('normal, text')).toBe('"normal, text"');
  });
});

describe('Proctoring token mismatch evidence', () => {
  const principal = {
    userId: 'candidate-user',
    email: 'candidate@example.test',
    tenantId: 'tenant-1',
    globalRoles: [],
    tenantRoles: ['CANDIDATE'],
    permissions: [],
    sessionId: 'session-1',
    authMethod: 'PASSWORD',
    stepUpVerifiedAt: null,
  };
  const request = { header: () => undefined } as never;

  function buildService() {
    const tx = {
      examinationAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attempt-1',
          candidateId: 'candidate-1',
          status: 'IN_PROGRESS',
          examination: { securityPolicy: null },
        }),
      },
      candidate: { findFirst: jest.fn().mockResolvedValue({ id: 'candidate-1' }) },
      examSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 'session-row', sessionTokenHash: 'old-hash', terminatedAt: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      examinationSecurityEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event-1', eventType: 'SESSION_TOKEN_MISMATCH' }),
      },
    };
    const prisma = { withTenant: jest.fn(async (_tenant: string, work: (client: unknown) => Promise<unknown>) => work(tx)) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };
    return {
      service: new ProctoringService(prisma as never, audit as never, config as never),
      tx,
      audit,
    };
  }

  it('persists a mismatch event and then returns forbidden', async () => {
    const { service, tx, audit } = buildService();
    await expect(
      service.ingestEvent(
        'tenant-1',
        'attempt-1',
        { eventType: 'TAB_HIDDEN', sessionToken: 'not-a-valid-token' },
        principal as never,
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.examinationSecurityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'SESSION_TOKEN_MISMATCH' }) }),
    );
    expect(tx.examSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ terminatedAt: expect.any(Date) }) }),
    );
    expect(audit.record).toHaveBeenCalled();
  });
});
