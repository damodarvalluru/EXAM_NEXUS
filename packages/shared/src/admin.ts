import type { AuditOutcome } from './enums';

export interface PlatformOverview {
  organisations: {
    total: number;
    verified: number;
    pending: number;
    suspended: number;
    byStatus: Array<{ status: string; count: number }>;
  };
  users: {
    total: number;
    active: number;
    superAdmins: number;
  };
  examinations: {
    total: number;
    live: number;
    scheduled: number;
    completed: number;
    cancelled: number;
    attempts: number;
  };
  integrations: {
    total: number;
    connected: number;
    syncActive: number;
    pending: number;
    failed: number;
    health: Array<{ status: string; count: number }>;
    lastSyncAt: string | null;
  };
  candidates: {
    total: number;
    active: number;
  };
  api: {
    requests24Hours: number;
    failures24Hours: number;
  };
  security: {
    openAlerts: number;
    criticalAlerts: number;
    openIncidents: number;
  };
  examinationsByType: Array<{ type: string; count: number }>;
  authentication: {
    last24Hours: number;
    failedLast24Hours: number;
    byOutcome: Array<{ outcome: string; count: number }>;
  };
  audit: {
    last24Hours: number;
  };
}

export interface AuditLogView {
  id: string;
  tenantId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: AuditOutcome;
  ip: string | null;
  correlationId: string | null;
  createdAt: string;
}

export interface PermissionView {
  id: string;
  key: string;
  description: string | null;
  category: string | null;
}

export interface PlatformUserView {
  id: string;
  email: string | null;
  username: string | null;
  globalRole: string | null;
  status: string;
  tenantId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}
