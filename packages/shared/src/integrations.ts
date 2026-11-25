/** Contracts for the tenant integration gateway (Phase 5). */
import type { IntegrationStatus } from './enums';

export const IntegrationAuthType = {
  API_KEY: 'API_KEY',
  OAUTH2: 'OAUTH2',
  OIDC: 'OIDC',
  SAML: 'SAML',
  WEBHOOK: 'WEBHOOK',
  BASIC: 'BASIC',
  MTLS: 'MTLS',
  SCIM: 'SCIM',
} as const;
export type IntegrationAuthType = (typeof IntegrationAuthType)[keyof typeof IntegrationAuthType];

/** All lifecycle states are defined once in enums.ts and re-exported from the package root. */

export const INTEGRATION_LIFECYCLE_ACTIONS = ['activate', 'pause', 'revoke', 'reset'] as const;
export type IntegrationLifecycleAction = (typeof INTEGRATION_LIFECYCLE_ACTIONS)[number];

/** Curated connector catalogue. Unknown providers remain allowed as custom integrations. */
export interface IntegrationConnector {
  id: string;
  label: string;
  category: string;
  authTypes: readonly IntegrationAuthType[];
  scopes: readonly string[];
  description: string;
}

export const INTEGRATION_CONNECTORS: readonly IntegrationConnector[] = [
  {
    id: 'generic-rest', label: 'Generic REST API', category: 'Custom',
    authTypes: ['API_KEY', 'BASIC', 'OAUTH2', 'OIDC', 'MTLS'],
    scopes: ['candidates:read', 'candidates:write', 'webhooks:read'],
    description: 'SSRF-hardened HTTPS connector for any JSON REST provider.',
  },
  {
    id: 'lms', label: 'Learning Management System', category: 'Education',
    authTypes: ['OAUTH2', 'OIDC', 'API_KEY'],
    scopes: ['candidates:read', 'candidates:write'],
    description: 'LMS course and candidate roster synchronisation.',
  },
  {
    id: 'sis', label: 'Student Information System', category: 'Education',
    authTypes: ['OAUTH2', 'OIDC', 'API_KEY', 'SAML'],
    scopes: ['candidates:read', 'candidates:write'],
    description: 'Student record and enrolment import.',
  },
  {
    id: 'hrms', label: 'HR Management System', category: 'Enterprise',
    authTypes: ['OAUTH2', 'OIDC', 'API_KEY', 'SAML', 'SCIM'],
    scopes: ['candidates:read', 'candidates:write'],
    description: 'Employee and candidate directory synchronisation.',
  },
  {
    id: 'identity-provider', label: 'Identity Provider', category: 'Identity',
    authTypes: ['OIDC', 'SAML', 'SCIM'],
    scopes: ['candidates:read'],
    description: 'External identity and provisioning provider.',
  },
  {
    id: 'question-bank', label: 'External Question Bank', category: 'Content',
    authTypes: ['API_KEY', 'OAUTH2'],
    scopes: ['questions:read'],
    description: 'Imports external question metadata into a tenant bank.',
  },
  {
    id: 'reporting', label: 'Reporting System', category: 'Analytics',
    authTypes: ['API_KEY', 'OAUTH2', 'WEBHOOK'],
    scopes: ['reports:read', 'webhooks:read'],
    description: 'Signed event delivery to an external reporting system.',
  },
];

export const IntegrationEventType = {
  TEST_CONNECTION: 'TEST_CONNECTION',
  TEST_SYNC: 'TEST_SYNC',
  SYNC: 'SYNC',
  IMPORT_CSV: 'IMPORT_CSV',
  VERIFY_MAPPING: 'VERIFY_MAPPING',
  OAUTH_TOKEN: 'OAUTH_TOKEN',
  WEBHOOK_DELIVERY: 'WEBHOOK_DELIVERY',
  OAUTH_CALLBACK: 'OAUTH_CALLBACK',
} as const;
export type IntegrationEventType = (typeof IntegrationEventType)[keyof typeof IntegrationEventType];

export interface IntegrationCredentialView {
  id: string;
  keyId: string;
  algorithm: string;
  expiresAt: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface IntegrationPermissionView {
  id: string;
  permission: string;
  grantedBy: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

export interface WebhookEndpointView {
  id: string;
  url: string;
  events: string[];
  status: string;
  createdAt: string;
  disabledAt: string | null;
  /** Returned once on creation, never stored or returned in plaintext afterwards. */
  secret?: string;
}

export interface IntegrationEventView {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface IntegrationView {
  id: string;
  tenantId: string;
  name: string;
  provider: string;
  category: string | null;
  status: string;
  authType: IntegrationAuthType;
  config: Record<string, unknown>;
  scopes: string[];
  lastConnectedAt: string | null;
  lastSyncAt: string | null;
  healthStatus: string;
  errorCount: number;
  /** Organisation owner of this integration, derived from tenant membership. */
  owner: { userId: string | null; email: string | null } | null;
  /** Tenant request volume and failed request count for the last 24 hours. */
  apiRequests24Hours: number;
  failedRequests24Hours: number;
  webhookDeliveries24Hours: number;
  webhookFailures24Hours: number;
  createdAt: string;
  updatedAt: string;
  credentialCount?: number;
  activeCredentialCount?: number;
  webhook?: WebhookEndpointView | null;
  recentEvents?: IntegrationEventView[];
}

export interface IntegrationDetail extends IntegrationView {
  credentials: IntegrationCredentialView[];
  permissions: IntegrationPermissionView[];
}

export interface TestConnectionResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  message: string;
  checkedAt: string;
}

export interface SyncResult {
  processed: number;
  created: number;
  updated: number;
  failed: number;
  errors: string[];
  completedAt: string;
}

/** OAuth 2.0 / OIDC token exchange outcome. Access tokens are never returned. */
export interface OAuthTokenResult {
  integrationId: string;
  tokenType: string;
  scopes: string[];
  expiresAt: string | null;
  credentialId: string;
  tokenEndpoint: string;
  acquiredAt: string;
}

export interface MappingFieldResult {
  target: string;
  source: string;
  present: number;
  missing: number;
  ok: boolean;
}

/** Non-destructive identity/field mapping verification against a live sample. */
export interface MappingVerificationView {
  integrationId: string;
  sampleCount: number;
  fields: MappingFieldResult[];
  ok: boolean;
  verifiedAt: string;
}

export interface CsvImportResult extends SyncResult {
  dryRun: boolean;
}

export interface LifecycleResult {
  integrationId: string;
  previousStatus: IntegrationStatus;
  status: IntegrationStatus;
  action: IntegrationLifecycleAction;
  sideEffects: string[];
  changedAt: string;
}

export interface ApiClientView {
  id: string;
  name: string;
  clientId: string;
  description: string | null;
  status: string;
  createdAt: string;
  revokedAt: string | null;
  keys: ApiKeyView[];
}

export interface ApiKeyView {
  id: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyResult extends ApiKeyView {
  /** Plaintext secret, returned exactly once. */
  secret: string;
}

export interface IntegrationMonitoringView {
  generatedAt: string;
  totals: {
    integrations: number;
    connected: number;
    syncActive: number;
    warning: number;
    failed: number;
    suspended: number;
    revoked: number;
  };
  health: Array<{ status: string; count: number }>;
  byProvider: Array<{ provider: string; count: number; failed: number }>;
  byOrganisation: Array<{
    tenantId: string;
    organisation: string;
    total: number;
    connected: number;
    failed: number;
  }>;
  apiRequests24Hours: number;
  apiFailures24Hours: number;
  webhookEvents24Hours: number;
  webhookFailures24Hours: number;
  lastSyncAt: string | null;
  recentEvents: IntegrationEventView[];
}
