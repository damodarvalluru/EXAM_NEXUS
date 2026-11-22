/** Request-scoped identity and tenant context shared by API modules. */
export interface Principal {
  userId: string;
  email: string | null;
  tenantId: string | null;
  globalRoles: string[];
  tenantRoles: string[];
  permissions: string[];
  sessionId: string | null;
  authMethod: string | null;
  stepUpVerifiedAt: string | null;
}

export interface TenantContext {
  tenantId: string;
  organisationSlug: string | null;
  isElevated: boolean;
}
