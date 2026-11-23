/** Contracts for the tenant integration gateway (Phase 5). */

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

export const IntegrationEventType = {
  TEST_CONNECTION: 'TEST_CONNECTION',
  TEST_SYNC: 'TEST_SYNC',
  SYNC: 'SYNC',
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
