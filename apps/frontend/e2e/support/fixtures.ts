import type {
  AdvancedReportView,
  AiSuggestionView,
  AnalyticsReportView,
  AttemptView,
  CandidateExamView,
  CandidateResultView,
  CertificateVerificationView,
  CertificateView,
  EvaluationDetailView,
  EvaluationQueueItem,
  ExamView,
  MemberView,
  OrganisationDashboard,
  OrganisationView,
  ProctorAttemptView,
  ReviewOutcomeView,
  RiskAssessmentView,
  SecurityAlertView,
  SecurityEventView,
  SecurityIncidentView,
  SubmitReceipt,
  UserView,
} from '@examnexus/shared';
import {
  E2E_PERMISSIONS,
  file,
  ok,
  route,
  type MockApiRoute,
} from './api';

const FIXED_TIME = '2026-01-01T00:00:00.000Z';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function makeUser(overrides: Partial<UserView>): UserView {
  const base: UserView = {
    id: 'user-e2e',
    email: 'e2e-user@example.test',
    username: null,
    status: 'ACTIVE',
    globalRole: null,
    tenantId: 'tenant-e2e',
    tenantRoles: ['ORG_ADMIN'],
    permissions: [E2E_PERMISSIONS.ORG_DASHBOARD_READ],
    mfaEnabled: false,
    profile: { firstName: 'E2E', lastName: 'User' },
  };
  return {
    ...base,
    ...overrides,
    profile: overrides.profile === undefined ? base.profile : overrides.profile,
  };
}

export const ORG_USER = makeUser({
  id: 'user-org-e2e',
  email: 'org-e2e@example.test',
  profile: { firstName: 'Organisation', lastName: 'Admin' },
  permissions: [
    E2E_PERMISSIONS.ORG_DASHBOARD_READ,
    E2E_PERMISSIONS.ORG_EXAMINATIONS_READ,
    E2E_PERMISSIONS.ORG_EXAMINATIONS_MANAGE,
    E2E_PERMISSIONS.ORG_EVALUATION_READ,
    E2E_PERMISSIONS.ORG_EVALUATION_MANAGE,
    E2E_PERMISSIONS.ORG_PROCTORING_READ,
    E2E_PERMISSIONS.ORG_REPORTS_READ,
    E2E_PERMISSIONS.ORG_CERTIFICATES_MANAGE,
  ],
});

/** Deliberately limited permissions so nav gating is observable offline. */
export const LIMITED_ORG_USER = makeUser({
  id: 'user-limited-e2e',
  email: 'limited-e2e@example.test',
  permissions: [
    E2E_PERMISSIONS.ORG_DASHBOARD_READ,
    E2E_PERMISSIONS.ORG_EXAMINATIONS_READ,
    E2E_PERMISSIONS.ORG_EXAMINATIONS_MANAGE,
    E2E_PERMISSIONS.ORG_EVALUATION_READ,
  ],
});

export const CANDIDATE_USER = makeUser({
  id: 'user-candidate-e2e',
  email: 'candidate-e2e@example.test',
  tenantRoles: ['CANDIDATE'],
  permissions: [],
  profile: { firstName: 'E2E', lastName: 'Candidate' },
});

export const ADMIN_USER = makeUser({
  id: 'user-admin-e2e',
  email: 'admin-e2e@example.test',
  globalRole: 'SUPER_ADMIN',
  tenantId: null,
  tenantRoles: [],
  permissions: ['*'],
  profile: { firstName: 'Platform', lastName: 'Admin' },
});

const ORGANISATION: OrganisationView = {
  id: 'org-e2e-1',
  name: 'E2E Training Organisation',
  slug: 'e2e-training',
  registrationNumber: 'E2E-REG-001',
  officialEmail: 'ops@e2e.test',
  contactPhone: null,
  website: null,
  logoKey: null,
  primaryColour: null,
  address: null,
  status: 'APPROVED',
  verificationSubmittedAt: null,
  approvedAt: FIXED_TIME,
  suspendedAt: null,
  createdAt: FIXED_TIME,
};

export const ORG_DASHBOARD: OrganisationDashboard = {
  organisation: ORGANISATION,
  counts: {
    users: 12,
    activeUsers: 10,
    candidates: 34,
    verifiedCandidates: 30,
    examinations: 6,
    scheduledExaminations: 2,
    liveExaminations: 1,
    completedExaminations: 3,
    integrations: 4,
    connectedIntegrations: 3,
    failedIntegrations: 0,
    attempts: 58,
  },
  recentExaminations: [
    { id: 'exam-e2e-dashboard', title: 'E2E Safety Fundamentals', status: 'LIVE', startsAt: FIXED_TIME },
  ],
  roleDistribution: [{ role: 'ORG_ADMIN', count: 2 }],
};

export function dashboardRoutes(): MockApiRoute[] {
  return [route('GET', '/organisations/me/dashboard', () => ok(ORG_DASHBOARD))];
}

export interface CandidateScenario {
  exam: CandidateExamView;
  attemptId: string;
  questionId: string;
  optionId: string;
  receipt: SubmitReceipt;
  result: CandidateResultView;
  routes: MockApiRoute[];
}

/** Stateful so autosave and submit are reflected in subsequent GETs. */
export function candidateScenario(): CandidateScenario {
  const exam: CandidateExamView = {
    id: 'exam-e2e-candidate',
    title: 'E2E Candidate Assessment',
    description: 'A deterministic two-minute assessment.',
    instructions: 'Answer the question and submit.',
    type: 'IMMEDIATE',
    durationMinutes: 2,
    startsAt: null,
    endsAt: null,
    totalMarks: 10,
    maxAttempts: 2,
    attemptsUsed: 0,
    available: true,
  };
  const attemptId = 'attempt-e2e-candidate';
  const questionId = 'q-e2e-candidate-1';
  const optionId = 'opt-e2e-candidate-b';
  const serverEndAt = new Date(Date.now() + 30 * 60_000).toISOString();

  let attempt: AttemptView = {
    id: attemptId,
    examinationId: exam.id,
    title: exam.title,
    instructions: exam.instructions,
    status: 'IN_PROGRESS',
    attemptNumber: 1,
    startedAt: FIXED_TIME,
    serverEndAt,
    submittedAt: null,
    remainingSeconds: 1800,
    totalMarks: exam.totalMarks,
    questions: [
      {
        id: questionId,
        type: 'SINGLE_CHOICE',
        prompt: 'Which control is advisory rather than an automatic finding?',
        marks: 10,
        negativeMarks: 0,
        difficulty: 'EASY',
        options: [
          { id: 'opt-e2e-candidate-a', label: 'A', content: 'Automatic disqualification', position: 1 },
          { id: optionId, label: 'B', content: 'Proctoring risk signals', position: 2 },
        ],
        sectionId: null,
      },
    ],
    answers: {},
  };

  const receipt: SubmitReceipt = {
    attemptId,
    submissionId: 'submission-e2e-candidate',
    receiptHash: 'receipt-e2e-4f6a9c',
    submittedAt: FIXED_TIME,
    status: 'SUBMITTED',
    score: 10,
    totalMarks: exam.totalMarks,
    duplicate: false,
  };
  const result: CandidateResultView = {
    attemptId,
    examinationId: exam.id,
    examinationTitle: exam.title,
    score: 10,
    totalMarks: exam.totalMarks,
    passingMarks: 5,
    status: 'PUBLISHED',
    publishedAt: FIXED_TIME,
  };

  const routes: MockApiRoute[] = [
    route('GET', '/candidate/exams', () => ok([exam])),
    route('POST', `/candidate/exams/${exam.id}/start`, () => ok(attempt)),
    route('GET', `/candidate/attempts/${attemptId}`, () => ok(attempt)),
    route('PUT', `/candidate/attempts/${attemptId}/answers`, (context) => {
      const payload = context.body as { questionId?: string; answer?: { value?: unknown } };
      if (payload.questionId && payload.answer) {
        attempt = {
          ...attempt,
          answers: { ...attempt.answers, [payload.questionId]: payload.answer.value },
        };
      }
      return ok(null);
    }),
    route('POST', `/candidate/attempts/${attemptId}/submit`, () => {
      attempt = { ...attempt, status: 'SUBMITTED', submittedAt: FIXED_TIME };
      return ok(receipt);
    }),
    route('GET', `/candidate/attempts/${attemptId}/result`, () => ok(result)),
  ];

  return { exam, attemptId, questionId, optionId, receipt, result, routes };
}

export interface EvaluationScenario {
  attemptId: string;
  questionId: string;
  detail: EvaluationDetailView;
  suggestion: AiSuggestionView;
  outcome: ReviewOutcomeView;
  routes: MockApiRoute[];
}

export function evaluationScenario(): EvaluationScenario {
  const attemptId = 'attempt-e2e-evaluation';
  const questionId = 'q-e2e-evaluation-1';
  const queue: EvaluationQueueItem = {
    attemptId,
    examinationId: 'exam-e2e-evaluation',
    examinationTitle: 'E2E Written Assessment',
    candidateId: 'candidate-e2e-evaluation',
    candidateName: 'E2E Essay Candidate',
    attemptStatus: 'SUBMITTED',
    submittedAt: FIXED_TIME,
    score: 32,
    totalMarks: 50,
    pendingSubjective: 1,
    evaluationCount: 0,
    resultId: 'result-e2e-evaluation',
    resultStatus: 'PENDING',
  };
  const detail: EvaluationDetailView = {
    ...queue,
    resultVersion: 1,
    answers: [
      {
        questionId,
        prompt: 'Explain the difference between an advisory signal and a finding.',
        questionType: 'ESSAY',
        maxMarks: 10,
        answer: 'Advisory signals require human review; findings are recorded decisions.',
        marksAwarded: null,
        feedback: null,
        evaluations: [],
      },
    ],
  };
  const suggestion: AiSuggestionView = {
    evaluationId: 'evaluation-e2e-suggestion',
    attemptId,
    questionId,
    suggestedMarks: 8,
    maxMarks: 10,
    confidence: 'MODERATE',
    rationale: 'The answer distinguishes advisory signals from recorded findings.',
    rubricBreakdown: [
      { criterion: 'Uses the correct distinction', weight: 1, met: true, reason: 'Explicitly described.' },
    ],
    modelVersion: 'e2e-rules-v1',
    requiresHumanReview: true,
  };
  const outcome: ReviewOutcomeView = {
    attemptId,
    resultId: queue.resultId,
    previousScore: 32,
    score: 40,
    resultVersion: 2,
    reviewedAnswers: 1,
  };
  const evaluator: MemberView = {
    id: 'member-e2e-evaluator',
    userId: 'user-e2e-evaluator',
    email: 'evaluator-e2e@example.test',
    firstName: 'E2E',
    lastName: 'Evaluator',
    status: 'ACTIVE',
    roles: ['EVALUATOR'],
    isPrimary: false,
    joinedAt: FIXED_TIME,
    createdAt: FIXED_TIME,
  };

  const routes: MockApiRoute[] = [
    route('GET', '/advanced/evaluations/queue', () => ok([queue])),
    route('GET', `/advanced/evaluations/${attemptId}`, () => ok(detail)),
    route('GET', `/advanced/evaluations/${attemptId}/history`, () => ok([])),
    route('GET', '/organisations/me/users', () => ok<Paged<MemberView>>({ items: [evaluator], total: 1, page: 1, pageSize: 100 })),
    route('POST', `/advanced/evaluations/${attemptId}/ai-suggestions/${questionId}`, () => ok(suggestion)),
    route('POST', `/advanced/evaluations/${attemptId}/review`, () => ok(outcome)),
  ];

  return { attemptId, questionId, detail, suggestion, outcome, routes };
}

export interface ProctoringScenario {
  attemptId: string;
  eventId: string;
  assessmentId: string;
  assessment: RiskAssessmentView;
  routes: MockApiRoute[];
}

export function proctoringScenario(): ProctoringScenario {
  const attemptId = 'attempt-e2e-proctoring';
  const eventId = 'event-e2e-proctoring';
  const assessmentId = 'assessment-e2e-proctoring';

  let event: SecurityEventView = {
    id: eventId,
    attemptId,
    eventType: 'TAB_HIDDEN',
    category: 'ATTENTION',
    severity: 'MODERATE',
    riskWeight: 12,
    investigated: false,
    clientTime: FIXED_TIME,
    serverTime: FIXED_TIME,
    evidence: { hiddenForMs: 2500 },
  };
  const assessment: RiskAssessmentView = {
    id: assessmentId,
    attemptId,
    score: 24,
    level: 'MODERATE',
    rules: [{ rule: 'TAB_HIDDEN', weight: 12 }],
    modelVersion: 'e2e-rules-v1',
    reviewedBy: null,
    reviewedAt: null,
    appealStatus: null,
    createdAt: FIXED_TIME,
  };
  let attempt: ProctorAttemptView = {
    attemptId,
    candidateName: 'E2E Proctored Candidate',
    examinationTitle: 'E2E Remote Assessment',
    riskScore: 24,
    events: [event],
    assessments: [assessment],
    session: {
      id: 'session-e2e-proctoring',
      attemptId,
      deviceId: 'device-e2e-1',
      securityProfile: 'STANDARD',
      secureClientVersion: 'e2e-1.0',
      sessionToken: null,
      sessionTokenExpiresAt: null,
      heartbeatAt: FIXED_TIME,
      disconnectedAt: null,
      terminatedAt: null,
    },
  };

  const routes: MockApiRoute[] = [
    route('GET', '/advanced/proctoring/attempts', () => ok([attempt])),
    route('GET', `/advanced/proctoring/attempts/${attemptId}`, () => ok(attempt)),
    route('PATCH', `/advanced/proctoring/events/${eventId}`, () => {
      event = { ...event, investigated: true };
      attempt = { ...attempt, events: [event] };
      return ok(event);
    }),
    route('POST', `/advanced/proctoring/attempts/${attemptId}/assess`, () => ok(assessment)),
    route('POST', `/advanced/proctoring/assessments/${assessmentId}/review`, (context) => {
      const payload = context.body as { investigated?: boolean; appealStatus?: string; note?: string };
      const reviewed: RiskAssessmentView = {
        ...assessment,
        reviewedBy: 'user-org-e2e',
        reviewedAt: FIXED_TIME,
        appealStatus: payload.appealStatus ?? null,
      };
      attempt = { ...attempt, assessments: [reviewed] };
      return ok(reviewed);
    }),
  ];

  return { attemptId, eventId, assessmentId, assessment, routes };
}

export const REPORT: AdvancedReportView = {
  report: 'examination-analytics',
  generatedAt: FIXED_TIME,
  scope: { tenantId: 'tenant-e2e', examinationId: null },
  summary: {
    attempts: 12,
    submitted: 10,
    scored: 9,
    passRate: 75,
    averageScore: 68,
    pendingEvaluation: 1,
    averageRiskScore: 18,
    highRiskAttempts: 2,
  },
  scoreDistribution: [
    { label: '0–49', count: 2 },
    { label: '50–69', count: 3 },
    { label: '70–100', count: 5 },
  ],
  questionAnalytics: [
    {
      questionId: 'q-e2e-report-1',
      prompt: 'Explain advisory risk signals.',
      type: 'ESSAY',
      attempts: 10,
      graded: 9,
      correct: 7,
      accuracy: 78,
      averageMarks: 7,
      maxMarks: 10,
    },
  ],
  evaluation: { pending: 1, approved: 8, rejected: 0 },
  certificates: { issued: 6, revoked: 1 },
};

export const REPORT_CSV = 'kind,label,value\nexams,attempts,12\nexams,submitted,10\n';

export function reportRoutes(): MockApiRoute[] {
  return [
    route('GET', '/advanced/reports/exams', () => ok(REPORT)),
    route('GET', '/examinations', () => ok<Paged<ExamView>>({ items: [], total: 0, page: 1, pageSize: 100 })),
    route('GET', '/advanced/reports/export', () => file(REPORT_CSV, 'text/csv', 'examnexus-report-exams.csv')),
  ];
}

export const CERTIFICATE: CertificateView = {
  id: 'certificate-e2e-1',
  certificateNumber: 'E2E-CERT-001',
  verificationCode: 'verify-e2e-code-001',
  resultId: 'result-e2e-certificate',
  candidateName: 'E2E Certified Candidate',
  examinationTitle: 'E2E Certification Exam',
  score: 88,
  maxScore: 100,
  issuedAt: FIXED_TIME,
  revokedAt: null,
  pdfAvailable: true,
};

export const VERIFICATION: CertificateVerificationView = {
  valid: true,
  certificateNumber: CERTIFICATE.certificateNumber,
  candidateName: CERTIFICATE.candidateName,
  examinationTitle: CERTIFICATE.examinationTitle,
  score: CERTIFICATE.score,
  maxScore: CERTIFICATE.maxScore,
  issuedAt: CERTIFICATE.issuedAt,
};

export function certificateRoutes(): MockApiRoute[] {
  return [
    route('GET', '/advanced/certificates', () => ok([CERTIFICATE])),
    route('GET', '/advanced/certificates/verify', () => ok(VERIFICATION)),
  ];
}

export const ANALYTICS: AnalyticsReportView = {
  range: '30d',
  from: '2025-12-02T00:00:00.000Z',
  to: FIXED_TIME,
  generatedAt: FIXED_TIME,
  summary: {
    organisations: 3,
    examinations: 9,
    attempts: 42,
    submittedAttempts: 38,
    candidates: 120,
    averageScore: 71,
    passRate: 80,
    failedLogins: 2,
    securityAlerts: 1,
  },
  series: {
    organisations: [{ label: '2025-12-31', value: 3 }],
    examinations: [{ label: '2025-12-31', value: 9 }],
    attempts: [{ label: '2025-12-31', value: 42 }],
    results: [{ label: '2025-12-31', value: 38 }],
    failedLogins: [{ label: '2025-12-31', value: 2 }],
  },
  byOrganisation: [
    { tenantId: 'tenant-e2e', organisation: ORGANISATION.name, examinations: 9, attempts: 42, candidates: 120 },
  ],
  byExamination: [
    { examinationId: 'exam-e2e-dashboard', title: 'E2E Safety Fundamentals', attempts: 42, averageScore: 71, passRate: 80 },
  ],
};

export const ANALYTICS_CSV = 'kind,range,attempts\nattempts,30d,42\n';

export const SECURITY_ALERT: SecurityAlertView = {
  id: 'alert-e2e-1',
  tenantId: null,
  organisation: null,
  severity: 'HIGH',
  category: 'ACCESS',
  title: 'E2E unusual sign-in pattern',
  description: 'Deterministic alert used by browser E2E.',
  source: 'e2e',
  evidenceRef: 'e2e-evidence-1',
  status: 'OPEN',
  assignedTo: null,
  createdAt: FIXED_TIME,
  resolvedAt: null,
  incidentCount: 1,
};

export const SECURITY_INCIDENT: SecurityIncidentView = {
  id: 'incident-e2e-1',
  tenantId: null,
  organisation: null,
  alertId: SECURITY_ALERT.id,
  severity: 'HIGH',
  classification: 'E2E ACCESS ANOMALY',
  status: 'OPEN',
  assignedTo: null,
  notes: null,
  responseActions: [],
  resolvedAt: null,
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
};

export function adminRoutes(): MockApiRoute[] {
  let alert = SECURITY_ALERT;
  return [
    route('GET', '/admin/analytics', () => ok(ANALYTICS)),
    route('GET', '/admin/analytics/export', () => file(ANALYTICS_CSV, 'text/csv', 'examnexus-attempts-30d.csv')),
    route('GET', '/admin/security/alerts', () => ok<Paged<SecurityAlertView>>({ items: [alert], total: 1, page: 1, pageSize: 25 })),
    route('GET', '/admin/security/incidents', () => ok<Paged<SecurityIncidentView>>({ items: [SECURITY_INCIDENT], total: 1, page: 1, pageSize: 25 })),
    route('PATCH', `/admin/security/alerts/${SECURITY_ALERT.id}`, () => {
      alert = { ...alert, status: 'INVESTIGATING' };
      return ok(alert);
    }),
  ];
}
