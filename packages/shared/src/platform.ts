/** Contracts for the Super Admin administration modules (Phase 6). */

export const AlertSeverity = {
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];

export const IncidentStatus = {
  OPEN: 'OPEN',
  INVESTIGATING: 'INVESTIGATING',
  CONTAINED: 'CONTAINED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
} as const;
export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];

export const HealthStatus = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  DOWN: 'DOWN',
  UNKNOWN: 'UNKNOWN',
} as const;
export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

export const SupportTicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING: 'WAITING',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;
export type SupportTicketStatus = (typeof SupportTicketStatus)[keyof typeof SupportTicketStatus];

export interface SecurityAlertView {
  id: string;
  tenantId: string | null;
  organisation: string | null;
  severity: AlertSeverity;
  category: string;
  title: string;
  description: string | null;
  source: string | null;
  evidenceRef: string | null;
  status: string;
  assignedTo: string | null;
  createdAt: string;
  resolvedAt: string | null;
  incidentCount?: number;
}

export interface SecurityIncidentView {
  id: string;
  tenantId: string | null;
  organisation: string | null;
  alertId: string | null;
  severity: AlertSeverity;
  classification: string;
  status: IncidentStatus;
  assignedTo: string | null;
  notes: string | null;
  responseActions: string[];
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentHealthView {
  component: string;
  status: HealthStatus;
  latencyMs: number | null;
  details: Record<string, unknown> | null;
  detectedAt: string;
}

export interface SystemHealthView {
  generatedAt: string;
  api: {
    status: HealthStatus;
    uptimeSeconds: number;
    memoryRssBytes: number;
    memoryHeapUsedBytes: number;
    nodeVersion: string;
  };
  components: ComponentHealthView[];
  events: ComponentHealthView[];
  queues: Array<{ name: string; waiting: number; active: number; failed: number }>;
  storage: { objects: number; bytes: number };
}

export interface ReportPoint {
  label: string;
  value: number;
}

export interface AnalyticsReportView {
  range: string;
  from: string;
  to: string;
  generatedAt: string;
  summary: {
    organisations: number;
    examinations: number;
    attempts: number;
    submittedAttempts: number;
    candidates: number;
    averageScore: number;
    passRate: number;
    failedLogins: number;
    securityAlerts: number;
  };
  series: {
    organisations: ReportPoint[];
    examinations: ReportPoint[];
    attempts: ReportPoint[];
    results: ReportPoint[];
    failedLogins: ReportPoint[];
  };
  byOrganisation: Array<{
    tenantId: string;
    organisation: string;
    examinations: number;
    attempts: number;
    candidates: number;
  }>;
  byExamination: Array<{
    examinationId: string;
    title: string;
    attempts: number;
    averageScore: number;
    passRate: number;
  }>;
}

export interface NotificationView {
  id: string;
  tenantId: string | null;
  channel: string;
  templateKey: string | null;
  recipient: string;
  subject: string | null;
  status: string;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SubscriptionView {
  id: string;
  tenantId: string;
  organisation: string;
  plan: string;
  status: string;
  seats: number | null;
  billingCycle: string;
  startDate: string;
  endDate: string | null;
  trialEndsAt: string | null;
}

export interface SupportTicketView {
  id: string;
  tenantId: string | null;
  organisation: string | null;
  subject: string;
  category: string;
  priority: string;
  status: SupportTicketStatus;
  requesterEmail: string;
  body: string;
  assignee: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface PlatformSettingView {
  key: string;
  value: Record<string, unknown>;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface LiveAttemptView {
  id: string;
  tenantId: string;
  organisation: string;
  candidate: string;
  examination: string;
  status: string;
  startedAt: string | null;
  serverEndAt: string | null;
  riskScore: number;
  lastHeartbeatAt: string | null;
}
