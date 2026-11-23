import { SetMetadata } from '@nestjs/common';

export const TENANT_SCOPED_KEY = 'tenantScoped';

/**
 * Marks a handler as tenant-scoped. The TenantGuard rejects requests without a
 * resolved tenant context. Phase 2 replaces context resolution with validated
 * JWT membership claims.
 */
export const TenantScoped = () => SetMetadata(TENANT_SCOPED_KEY, true);
