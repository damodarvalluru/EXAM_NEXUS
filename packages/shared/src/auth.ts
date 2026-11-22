import type { AuthMethod, GlobalRole, UserStatus } from './enums';

/** Safe user projection returned by all authentication endpoints. */
export interface UserView {
  id: string;
  email: string | null;
  username: string | null;
  status: UserStatus;
  globalRole: GlobalRole | null;
  tenantId: string | null;
  tenantRoles: string[];
  permissions: string[];
  mfaEnabled: boolean;
  profile: { firstName: string | null; lastName: string | null } | null;
}

export interface AuthenticatedResult {
  status: 'AUTHENTICATED';
  accessToken: string;
  expiresIn: number;
  user: UserView;
}

export interface MfaChallengeResult {
  status: 'MFA_REQUIRED';
  challengeToken: string;
  expiresIn: number;
  /** True when a TOTP factor is configured; false when only recovery codes remain. */
  totpConfigured: boolean;
}

export type LoginResult = AuthenticatedResult | MfaChallengeResult;

export interface SessionView {
  id: string;
  authMethod: AuthMethod;
  ip: string | null;
  deviceLabel: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

export interface MfaEnrollment {
  secret: string;
  otpauthUri: string;
}

export interface RecoveryCodesResult {
  codes: string[];
  warning: string;
}

/** Response for step-up: a short-lived access token carrying a fresh proof. */
export interface StepUpResult {
  accessToken: string;
  expiresIn: number;
  stepUpVerifiedAt: string;
}

export interface AuthEventView {
  id: string;
  email: string | null;
  method: AuthMethod;
  outcome: string;
  ip: string | null;
  location: string | null;
  metadata: unknown;
  createdAt: string;
}
