import {
  INTEGRATION_LIFECYCLE_ACTIONS,
  type IntegrationLifecycleAction,
  type IntegrationStatus,
} from '@examnexus/shared';

/** Explicit, auditable lifecycle transitions. Any unlisted transition is rejected. */
export const INTEGRATION_STATUS_TRANSITIONS: Record<
  IntegrationStatus,
  Partial<Record<IntegrationLifecycleAction, IntegrationStatus>>
> = {
  NOT_CONNECTED: {
    activate: 'CONFIGURATION_PENDING',
    revoke: 'REVOKED',
    reset: 'NOT_CONNECTED',
  },
  CONFIGURATION_PENDING: {
    activate: 'AUTHENTICATION_PENDING',
    pause: 'SUSPENDED',
    revoke: 'REVOKED',
    reset: 'NOT_CONNECTED',
  },
  AUTHENTICATION_PENDING: {
    activate: 'VERIFICATION_PENDING',
    pause: 'SUSPENDED',
    revoke: 'REVOKED',
    reset: 'NOT_CONNECTED',
  },
  VERIFICATION_PENDING: {
    activate: 'CONNECTED',
    pause: 'SUSPENDED',
    revoke: 'REVOKED',
    reset: 'NOT_CONNECTED',
  },
  CONNECTED: {
    pause: 'SUSPENDED',
    revoke: 'REVOKED',
    reset: 'NOT_CONNECTED',
  },
  SYNC_ACTIVE: {
    pause: 'SUSPENDED',
    revoke: 'REVOKED',
    reset: 'NOT_CONNECTED',
  },
  WARNING: {
    activate: 'CONNECTED',
    pause: 'SUSPENDED',
    revoke: 'REVOKED',
    reset: 'NOT_CONNECTED',
  },
  FAILED: {
    activate: 'VERIFICATION_PENDING',
    pause: 'SUSPENDED',
    revoke: 'REVOKED',
    reset: 'NOT_CONNECTED',
  },
  SUSPENDED: {
    activate: 'CONNECTED',
    revoke: 'REVOKED',
    reset: 'NOT_CONNECTED',
  },
  REVOKED: {
    reset: 'NOT_CONNECTED',
  },
};

export function transitionIntegrationStatus(
  current: string,
  action: IntegrationLifecycleAction,
): IntegrationStatus {
  const next = INTEGRATION_STATUS_TRANSITIONS[current as IntegrationStatus]?.[action];
  if (!next) {
    throw new Error(`Cannot ${action} an integration in ${current} status`);
  }
  return next;
}

export function isLifecycleAction(value: string): value is IntegrationLifecycleAction {
  return (INTEGRATION_LIFECYCLE_ACTIONS as readonly string[]).includes(value);
}
