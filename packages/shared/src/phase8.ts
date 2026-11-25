/** Phase 8 contracts: evaluation assignment, moderation, scorecards and result analytics. */
import type { EvaluationMode, EvaluationStatus } from './enums';

export interface EvaluatorAssignmentDto {
  questionId: string;
  evaluatorId: string;
  blind?: boolean;
}

export interface EvaluatorAssignmentView {
  attemptId: string;
  questionId: string;
  evaluatorId: string;
  blind: boolean;
  assignedBy: string | null;
  assignedAt: string;
  status: EvaluationStatus;
}

export interface MarkChangeView {
  evaluationId: string;
  attemptId: string;
  questionId: string | null;
  evaluatorId: string | null;
  mode: EvaluationMode;
  previousScore: number | null;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
  status: EvaluationStatus;
  changedAt: string;
}

export interface ReopenEvaluationDto {
  questionIds?: string[];
  reason: string;
}

export interface SchedulePublicationDto {
  publishAt: string;
  note?: string;
}

export interface ScheduledPublicationView {
  resultId: string;
  publishAt: string;
  scheduledBy: string | null;
  scheduledAt: string;
  status: string;
}

export interface PublishDueResult {
  resultId: string;
  status: 'PUBLISHED' | 'SKIPPED';
  reason?: string;
}

export interface PublishDueView {
  processedAt: string;
  published: number;
  skipped: number;
  results: PublishDueResult[];
}

export interface ScorecardAnswerView {
  questionId: string;
  prompt: string;
  type: string;
  maxMarks: number;
  marksAwarded: number | null;
  evaluationCount: number;
  evaluationStatus: EvaluationStatus | 'UNSCORED';
  feedback: string | null;
}

export interface ScorecardView {
  resultId: string;
  attemptId: string;
  examinationId: string;
  examinationTitle: string;
  candidateId: string;
  candidateName: string;
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  resultStatus: string;
  publishedAt: string | null;
  certificateId: string | null;
  answers: ScorecardAnswerView[];
  generatedAt: string;
}

export interface RankEntryView {
  rank: number;
  resultId: string;
  candidateId: string;
  candidateName: string;
  candidateCode: string;
  score: number;
  maxScore: number;
  percentage: number;
  publishedAt: string | null;
}

export interface RankListView {
  examinationId: string;
  generatedAt: string;
  entries: RankEntryView[];
}

export interface ResultGroupView {
  key: string;
  label: string;
  results: number;
  passed: number;
  passRate: number;
  averageScore: number;
  averagePercentage: number;
}

export interface ResultAnalyticsView {
  generatedAt: string;
  totals: {
    publishedResults: number;
    passed: number;
    passRate: number;
    averageScore: number;
    averagePercentage: number;
  };
  byDepartment: ResultGroupView[];
  byExamination: ResultGroupView[];
}
