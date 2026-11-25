/**
 * Phase 7 contracts: AI-assisted/manual evaluation, proctoring, advanced
 * reporting and certificates. All marks produced by the AI evaluator are
 * suggestions only; a human reviewer must accept them before they affect a
 * result. Browser events are advisory signals, never proof of misconduct.
 */
import type { EvaluationMode, EvaluationStatus, ResultStatus, RiskLevel } from './enums';

export interface EvaluationQueueItem {
  attemptId: string;
  examinationId: string;
  examinationTitle: string;
  candidateId: string;
  candidateName: string;
  attemptStatus: string;
  submittedAt: string | null;
  score: number | null;
  totalMarks: number;
  pendingSubjective: number;
  evaluationCount: number;
  resultId: string | null;
  resultStatus: ResultStatus | null;
}

export interface SubjectiveAnswerView {
  questionId: string;
  prompt: string;
  questionType: string;
  maxMarks: number;
  answer: unknown;
  marksAwarded: number | null;
  feedback: string | null;
  evaluations: EvaluationRecordView[];
}

export interface EvaluationRecordView {
  id: string;
  evaluatorId: string | null;
  mode: EvaluationMode;
  blind: boolean;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
  status: EvaluationStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface EvaluationDetailView extends EvaluationQueueItem {
  answers: SubjectiveAnswerView[];
  resultVersion: number | null;
}

export interface RubricCriterionView {
  criterion: string;
  weight: number;
  met: boolean;
  reason: string;
}

/**
 * Deterministic, explainable suggestion. `requiresHumanReview` is always true:
 * the API never applies `suggestedMarks` to an answer or result by itself.
 */
export interface AiSuggestionView {
  evaluationId: string;
  attemptId: string;
  questionId: string;
  suggestedMarks: number;
  maxMarks: number;
  confidence: 'LOW' | 'MODERATE';
  rationale: string;
  rubricBreakdown: RubricCriterionView[];
  modelVersion: string;
  requiresHumanReview: true;
}

export interface ReviewAnswerDto {
  questionId: string;
  marks: number;
  feedback?: string;
  /** COMPLETED accepts the marks; REVISION sends the answer back for re-evaluation. */
  status: 'COMPLETED' | 'REVISION';
}

export interface ReviewEvaluationDto {
  answers: ReviewAnswerDto[];
  note?: string;
}

export interface ReviewOutcomeView {
  attemptId: string;
  resultId: string | null;
  previousScore: number | null;
  score: number;
  resultVersion: number;
  reviewedAnswers: number;
}

export const PROCTOR_EVENT_TYPES = [
  'TAB_HIDDEN',
  'WINDOW_BLUR',
  'FULLSCREEN_EXIT',
  'DISCONNECTED',
  'RECONNECTED',
  'REPEATED_RECONNECT',
  'SCREEN_CAPTURE_SIGNAL',
  'MULTIPLE_SESSION',
  'SESSION_TOKEN_MISMATCH',
  'CLOCK_SKEW',
  'DEVICE_CHANGE',
  'SUSPICIOUS_INTERACTION',
] as const;
export type ProctorEventType = (typeof PROCTOR_EVENT_TYPES)[number];

export interface ProctorEventDto {
  eventType: ProctorEventType;
  clientTime?: string;
  sessionToken?: string;
  evidence?: Record<string, unknown>;
}

export interface RegisterProctorSessionDto {
  attemptId: string;
  deviceId: string;
  platform?: string;
  model?: string;
  osVersion?: string;
  clientVersion?: string;
  integrityAttestation?: string;
}

export interface RotateSessionTokenDto {
  sessionToken: string;
}

export interface SecurityEventView {
  id: string;
  attemptId: string;
  eventType: string;
  category: string;
  severity: string;
  riskWeight: number;
  investigated: boolean;
  clientTime: string | null;
  serverTime: string;
  evidence: unknown;
}

export interface RiskAssessmentView {
  id: string;
  attemptId: string;
  score: number;
  level: RiskLevel;
  rules: unknown;
  modelVersion: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  appealStatus: string | null;
  createdAt: string;
}

export interface ProctorSessionView {
  id: string;
  attemptId: string;
  deviceId: string | null;
  securityProfile: string;
  secureClientVersion: string | null;
  /** Server-issued token; only returned by register/rotate, never by review views. */
  sessionToken: string | null;
  sessionTokenExpiresAt: string | null;
  heartbeatAt: string | null;
  disconnectedAt: string | null;
  terminatedAt: string | null;
}

export interface ProctorAttemptView {
  attemptId: string;
  candidateName: string;
  examinationTitle: string;
  riskScore: number;
  events: SecurityEventView[];
  assessments: RiskAssessmentView[];
  session: ProctorSessionView | null;
}

export interface ReviewRiskDto {
  investigated?: boolean;
  appealStatus?: string;
  note?: string;
}

export interface AdvancedReportView {
  report: 'examination-analytics';
  generatedAt: string;
  scope: { tenantId: string; examinationId: string | null };
  summary: {
    attempts: number;
    submitted: number;
    scored: number;
    passRate: number;
    averageScore: number;
    pendingEvaluation: number;
    averageRiskScore: number;
    highRiskAttempts: number;
  };
  scoreDistribution: Array<{ label: string; count: number }>;
  questionAnalytics: Array<{
    questionId: string;
    prompt: string;
    type: string;
    attempts: number;
    graded: number;
    correct: number;
    accuracy: number;
    averageMarks: number;
    maxMarks: number;
  }>;
  evaluation: { pending: number; approved: number; rejected: number };
  certificates: { issued: number; revoked: number };
}

export type AdvancedReportKind = 'exams' | 'results' | 'questions' | 'risk' | 'certificates';

export interface CertificateView {
  id: string;
  certificateNumber: string;
  verificationCode: string;
  resultId: string;
  candidateName: string;
  examinationTitle: string;
  score: number;
  maxScore: number;
  issuedAt: string;
  revokedAt: string | null;
  pdfAvailable: boolean;
}

export interface CertificateVerificationView {
  valid: boolean;
  reason?: 'NOT_FOUND' | 'REVOKED' | 'RESULT_NOT_PUBLISHED';
  certificateNumber?: string;
  candidateName?: string;
  examinationTitle?: string;
  score?: number;
  maxScore?: number;
  issuedAt?: string;
}

export interface IssueCertificateDto {
  resultId: string;
}
