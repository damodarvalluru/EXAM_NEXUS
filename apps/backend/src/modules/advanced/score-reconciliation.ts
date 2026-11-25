import { Prisma, type Result } from '@prisma/client';
import type { ResultStatus } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { ExaminationsService } from '../examinations/examinations.service';
import { gradeAnswer, isAutomaticallyGradable, type GradeableQuestion } from '../examinations/grading';
import { isAcceptedEvaluation, latestEvaluationByQuestion } from './current-evaluation';

export interface ReconciliationOutcome {
  result: Result;
  score: number;
  previousScore: number | null;
  reviewedAnswers: number;
}

/**
 * Rebuild an attempt score from the frozen examination version plus accepted
 * evaluations. Objective answers are always re-graded from the snapshot;
 * subjective answers only use the latest accepted (COMPLETED) evaluation for
 * each question, so an AI suggestion or superseded mark can never affect a
 * score without current human acceptance.
 */
export async function recomputeAttemptScore(
  prisma: PrismaService,
  examinations: ExaminationsService,
  tenantId: string,
  attemptId: string,
  actorUserId: string | null,
  status: ResultStatus = 'UNDER_REVIEW',
): Promise<ReconciliationOutcome> {
  return prisma.withTenant(tenantId, async (tx) => {
    const attempt = await tx.examinationAttempt.findUnique({
      where: { id: attemptId },
      include: {
        examination: true,
        answers: true,
        results: { orderBy: { version: 'desc' } },
        evaluations: true,
      },
    });
    if (!attempt) throw new Error('Attempt not found');
    const snapshot = await examinations.loadSnapshot(tx, tenantId, attempt.examinationId, attempt.versionId);
    const frozenById = new Map(snapshot.questions.map((question) => [question.id, question]));
    const previousScore = attempt.score;
    const currentEvaluations = latestEvaluationByQuestion(attempt.evaluations);
    let score = 0;
    let reviewedAnswers = 0;
    const seen = new Set<string>();

    for (const answer of attempt.answers) {
      if (seen.has(answer.questionId)) continue;
      seen.add(answer.questionId);
      const frozen = frozenById.get(answer.questionId);
      if (!frozen) {
        await tx.candidateAnswer.update({
          where: { id: answer.id },
          data: { marksAwarded: 0, isCorrect: false },
        });
        continue;
      }
      if (isAutomaticallyGradable(frozen.type)) {
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
        continue;
      }

      const current = currentEvaluations.get(answer.questionId);
      if (!isAcceptedEvaluation(current)) {
        // A superseded mark (revision/moderation) must not leak into the score.
        await tx.candidateAnswer.update({
          where: { id: answer.id },
          data: { marksAwarded: 0, isCorrect: null },
        });
        continue;
      }
      reviewedAnswers += 1;
      const capped = Math.max(0, Math.min(frozen.marks, Math.round((current.score ?? 0) * 100) / 100));
      score += capped;
      await tx.candidateAnswer.update({
        where: { id: answer.id },
        data: { marksAwarded: capped, isCorrect: null },
      });
    }

    score = Math.max(0, Math.min(attempt.examination.totalMarks, Math.round(score * 100) / 100));
    await tx.examinationAttempt.update({ where: { id: attempt.id }, data: { score } });

    const version = (attempt.results[0]?.version ?? 0) + 1;
    const result = await tx.result.create({
      data: {
        tenantId,
        attemptId: attempt.id,
        examinationId: attempt.examinationId,
        candidateId: attempt.candidateId,
        score,
        maxScore: attempt.examination.totalMarks,
        percentage: attempt.examination.totalMarks > 0
          ? Math.round((score / attempt.examination.totalMarks) * 10_000) / 100
          : 0,
        passed: attempt.examination.passingMarks !== null && score >= attempt.examination.passingMarks,
        status,
        version,
        metadata: {
          source: 'evaluation-review',
          recomputedAt: new Date().toISOString(),
          actorUserId,
          previousScore,
        } as Prisma.InputJsonValue,
      },
    });
    return { result, score, previousScore, reviewedAnswers };
  });
}
