import type { AttemptStatus, ExamStatus, ExamType, QuestionType } from './enums';

/** Views returned by the Phase 4 examination APIs. No correct answers are ever exposed to candidates. */
export interface QuestionOptionView {
  id: string;
  label: string;
  content: string;
  position: number;
}

export interface QuestionView {
  id: string;
  type: QuestionType;
  prompt: string;
  marks: number;
  negativeMarks: number;
  difficulty: string;
  options: QuestionOptionView[];
  sectionId: string | null;
}

export interface QuestionBankView {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  questionCount: number;
  createdAt: string;
}

export interface ExamSectionView {
  id: string;
  name: string;
  description: string | null;
  position: number;
  marks: number;
  questionIds: string[];
}

export interface ExamView {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  type: ExamType;
  status: ExamStatus;
  instructions: string | null;
  durationMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  maxAttempts: number;
  passingMarks: number | null;
  totalMarks: number;
  negativeMarking: number;
  randomiseQuestions: boolean;
  randomiseOptions: boolean;
  version: number;
  publishedAt: string | null;
  questionCount: number;
  sections: ExamSectionView[];
  createdAt: string;
}

export interface EligibilityView {
  id: string;
  candidateId: string;
  candidateCode: string;
  candidateName: string;
  eligible: boolean;
  windowStartAt: string | null;
  windowEndAt: string | null;
}

export interface AttemptSummaryView {
  id: string;
  candidateId: string;
  candidateName: string;
  examinationId: string;
  examinationTitle: string;
  attemptNumber: number;
  status: AttemptStatus;
  startedAt: string | null;
  serverEndAt: string | null;
  submittedAt: string | null;
  score: number | null;
  riskScore: number;
}

export interface CandidateExamView {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  type: ExamType;
  durationMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
  totalMarks: number;
  maxAttempts: number;
  attemptsUsed: number;
  available: boolean;
  reason?: string;
}

export interface AttemptView {
  id: string;
  examinationId: string;
  title: string;
  instructions: string | null;
  status: AttemptStatus;
  attemptNumber: number;
  startedAt: string | null;
  serverEndAt: string | null;
  submittedAt: string | null;
  remainingSeconds: number;
  totalMarks: number;
  questions: QuestionView[];
  answers: Record<string, unknown>;
}

export interface SubmitReceipt {
  attemptId: string;
  submissionId: string;
  receiptHash: string;
  submittedAt: string;
  status: AttemptStatus;
  score: number | null;
  totalMarks: number;
  /** True when the same idempotency key was already submitted. */
  duplicate: boolean;
}

export interface CandidateCredentialsResult {
  candidateId: string;
  email: string;
  enabled: boolean;
}

export interface CandidateResultView {
  attemptId: string;
  examinationId: string;
  examinationTitle: string;
  score: number;
  totalMarks: number;
  passingMarks: number | null;
  status: string;
  publishedAt: string | null;
}

/** Attempt-scoped realtime channel contract used by the candidate workspace. */
export const REALTIME_EVENTS = {
  ATTEMPT_SUBSCRIBE: 'attempt:subscribe',
  ATTEMPT_SUBSCRIBED: 'attempt:subscribed',
  ATTEMPT_CLOCK: 'attempt:clock',
  ATTEMPT_STATE: 'attempt:state',
  ATTEMPT_ERROR: 'attempt:error',
} as const;

export interface AttemptSubscribePayload {
  attemptId: string;
}

export interface AttemptSubscribedEvent {
  attemptId: string;
  serverTime: string;
}

export interface AttemptClockEvent {
  attemptId: string;
  serverTime: string;
  serverEndAt: string | null;
  remainingSeconds: number;
  reason?: 'START' | 'ANSWER_SAVED' | 'SUBMITTED' | 'EXPIRED';
}

export interface AttemptStateEvent {
  attemptId: string;
  status: AttemptStatus;
  score: number | null;
  submittedAt: string | null;
}
