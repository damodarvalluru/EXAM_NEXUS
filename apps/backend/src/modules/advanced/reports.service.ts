import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODES, type AdvancedReportView } from '@examnexus/shared';
import { PrismaService } from '../../database/prisma.service';
import { ExaminationsService } from '../examinations/examinations.service';
import {
  gradeAnswer,
  isAutomaticallyGradable,
  type ExaminationSnapshot,
  type GradeableQuestion,
} from '../examinations/grading';
import type { ReportQueryDto } from './dto';
import { isAcceptedEvaluation, latestEvaluationByQuestion } from './current-evaluation';

/** Tenant-only analytics built from persisted records. No figures are invented. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly examinations: ExaminationsService,
  ) {}

  async examinationAnalytics(tenantId: string, query: ReportQueryDto): Promise<AdvancedReportView> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (query.examinationId) {
        const exam = await tx.examination.findUnique({ where: { id: query.examinationId } });
        if (!exam) throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Examination not found' });
      }
      const attemptWhere: Prisma.ExaminationAttemptWhereInput = {
        ...(query.examinationId ? { examinationId: query.examinationId } : {}),
      };
      const attempts = await tx.examinationAttempt.findMany({
        where: attemptWhere,
        include: { results: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      });
      const latest = attempts.map((attempt) => attempt.results[0] ?? null).filter((row) => row !== null);
      const submitted = attempts.filter((attempt) => attempt.status === 'SUBMITTED' || attempt.status === 'AUTO_SUBMITTED').length;
      const scored = latest.filter((row) => typeof row.score === 'number').length;
      const passed = latest.filter((row) => row.passed).length;
      const scoreSum = latest.reduce((sum, row) => sum + row.score, 0);
      const riskSum = attempts.reduce((sum, attempt) => sum + attempt.riskScore, 0);
      const highRisk = attempts.filter((attempt) => attempt.riskScore >= 60).length;
      const buckets = [0, 0, 0, 0, 0];
      for (const row of latest) {
        const index = Math.min(4, Math.max(0, Math.floor(row.percentage / 20)));
        buckets[index] = (buckets[index] ?? 0) + 1;
      }

      const evaluationWhere: Prisma.EvaluationWhereInput = {
        ...(query.examinationId
          ? { attempt: { examinationId: query.examinationId } }
          : {}),
      };
      const evaluations = await tx.evaluation.findMany({
        where: evaluationWhere,
        select: { id: true, questionId: true, status: true, score: true, createdAt: true, updatedAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 20_000,
      });
      const currentEvaluations = [...latestEvaluationByQuestion(evaluations).values()];
      const pendingEvaluations = currentEvaluations.filter((row) => row.status === 'PENDING').length;
      const approvedEvaluations = currentEvaluations.filter((row) => isAcceptedEvaluation(row)).length;
      const rejectedEvaluations = currentEvaluations.filter((row) => row.status === 'REVISION').length;
      const certificateWhere: Prisma.CertificateWhereInput = query.examinationId
        ? { result: { examinationId: query.examinationId } }
        : {};
      const [issued, revoked] = await Promise.all([
        tx.certificate.count({ where: { ...certificateWhere, revokedAt: null } }),
        tx.certificate.count({ where: { ...certificateWhere, revokedAt: { not: null } } }),
      ]);

      return {
        report: 'examination-analytics',
        generatedAt: new Date().toISOString(),
        scope: { tenantId, examinationId: query.examinationId ?? null },
        summary: {
          attempts: attempts.length,
          submitted,
          scored,
          passRate: scored ? Math.round((passed / scored) * 10_000) / 100 : 0,
          averageScore: scored ? Math.round((scoreSum / scored) * 100) / 100 : 0,
          pendingEvaluation: pendingEvaluations,
          averageRiskScore: attempts.length ? Math.round((riskSum / attempts.length) * 100) / 100 : 0,
          highRiskAttempts: highRisk,
        },
        scoreDistribution: buckets.map((count, index) => ({ label: `${index * 20}-${index * 20 + 19}%`, count })),
        questionAnalytics: await this.questionAnalytics(tx, tenantId, query.examinationId),
        evaluation: { pending: pendingEvaluations, approved: approvedEvaluations, rejected: rejectedEvaluations },
        certificates: { issued, revoked },
      };
    });
  }

  async exportCsv(tenantId: string, query: ReportQueryDto): Promise<string> {
    const report = await this.examinationAnalytics(tenantId, query);
    const rows: string[][] = [];
    const kind = query.kind ?? 'exams';
    rows.push(['report', report.report, 'generatedAt', report.generatedAt, 'examinationId', report.scope.examinationId ?? '']);
    rows.push([]);

    if (kind === 'questions') {
      rows.push(['questionId', 'prompt', 'type', 'attempts', 'graded', 'correct', 'accuracy', 'averageMarks', 'maxMarks']);
      for (const item of report.questionAnalytics) {
        rows.push([
          item.questionId, item.prompt, item.type, String(item.attempts), String(item.graded),
          String(item.correct), String(item.accuracy), String(item.averageMarks), String(item.maxMarks),
        ]);
      }
    } else if (kind === 'risk') {
      rows.push(['metric', 'value']);
      rows.push(['averageRiskScore', String(report.summary.averageRiskScore)]);
      rows.push(['highRiskAttempts', String(report.summary.highRiskAttempts)]);
      rows.push(['pendingEvaluation', String(report.summary.pendingEvaluation)]);
    } else if (kind === 'certificates') {
      rows.push(['metric', 'value']);
      rows.push(['issued', String(report.certificates.issued)]);
      rows.push(['revoked', String(report.certificates.revoked)]);
    } else if (kind === 'results') {
      rows.push(['band', 'count']);
      for (const item of report.scoreDistribution) rows.push([item.label, String(item.count)]);
    } else {
      rows.push(['metric', 'value']);
      rows.push(['attempts', String(report.summary.attempts)]);
      rows.push(['submitted', String(report.summary.submitted)]);
      rows.push(['scored', String(report.summary.scored)]);
      rows.push(['passRate', String(report.summary.passRate)]);
      rows.push(['averageScore', String(report.summary.averageScore)]);
    }
    return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
  }

  private async questionAnalytics(
    tx: Prisma.TransactionClient,
    tenantId: string,
    examinationId: string | undefined,
  ): Promise<AdvancedReportView['questionAnalytics']> {
    const answers = await tx.candidateAnswer.findMany({
      where: {
        ...(examinationId ? { attempt: { examinationId } } : {}),
      },
      include: { attempt: { select: { examinationId: true, versionId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });
    const snapshots = new Map<string, ExaminationSnapshot>();
    const aggregate = new Map<string, AdvancedReportView['questionAnalytics'][number]>();

    for (const answer of answers) {
      const versionKey = answer.attempt.versionId ?? answer.attempt.examinationId;
      let snapshot = snapshots.get(versionKey);
      if (!snapshot) {
        snapshot = await this.examinations.loadSnapshot(tx, tenantId, answer.attempt.examinationId, answer.attempt.versionId);
        snapshots.set(versionKey, snapshot);
      }
      const frozen = snapshot.questions.find((question) => question.id === answer.questionId);
      if (!frozen) continue;
      let row = aggregate.get(frozen.id);
      if (!row) {
        row = {
          questionId: frozen.id,
          prompt: frozen.prompt,
          type: frozen.type,
          attempts: 0,
          graded: 0,
          correct: 0,
          accuracy: 0,
          averageMarks: 0,
          maxMarks: frozen.marks,
        };
        aggregate.set(frozen.id, row);
      }
      row.attempts += 1;
      const payload = answer.answer as { value?: unknown };
      if (isAutomaticallyGradable(frozen.type)) {
        const gradeable: GradeableQuestion = {
          id: frozen.id,
          type: frozen.type,
          marks: frozen.marks,
          negativeMarks: frozen.negativeMarks,
          options: frozen.options,
          expectedAnswer: frozen.expectedAnswer,
        };
        const outcome = gradeAnswer(gradeable, payload?.value);
        if (outcome.marks !== null) {
          row.graded += 1;
          if (outcome.isCorrect) row.correct += 1;
        }
      } else if (typeof answer.marksAwarded === 'number') {
        row.graded += 1;
      }
      if (typeof answer.marksAwarded === 'number') {
        row.averageMarks += answer.marksAwarded;
      }
    }

    return [...aggregate.values()]
      .map((row) => ({
        ...row,
        accuracy: row.graded ? Math.round((row.correct / row.graded) * 10_000) / 100 : 0,
        averageMarks: row.attempts ? Math.round((row.averageMarks / row.attempts) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 200);
  }
}

export function csvCell(value: string): string {
  // Neutralise spreadsheet formula injection from candidate/examiner text.
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (!/[",\n\r]/.test(safe)) return safe;
  return `"${safe.replace(/"/g, '""')}"`;
}
