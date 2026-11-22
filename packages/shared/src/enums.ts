/**
 * Domain enums shared by API and web. Values MUST remain identical to the
 * corresponding enums in apps/api/prisma/schema.prisma.
 */

export const OrganisationStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  VERIFICATION_REQUIRED: 'VERIFICATION_REQUIRED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type OrganisationStatus = (typeof OrganisationStatus)[keyof typeof OrganisationStatus];

export const UserStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
  LOCKED: 'LOCKED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const GlobalRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  PLATFORM_STAFF: 'PLATFORM_STAFF',
  AUDITOR: 'AUDITOR',
} as const;
export type GlobalRole = (typeof GlobalRole)[keyof typeof GlobalRole];

export const TenantRole = {
  ORG_ADMIN: 'ORG_ADMIN',
  EXAM_ADMIN: 'EXAM_ADMIN',
  INVIGILATOR: 'INVIGILATOR',
  EXAMINER: 'EXAMINER',
  EVALUATOR: 'EVALUATOR',
  CANDIDATE: 'CANDIDATE',
  STAFF: 'STAFF',
} as const;
export type TenantRole = (typeof TenantRole)[keyof typeof TenantRole];

export const AuthMethod = {
  PASSWORD: 'PASSWORD',
  PIN: 'PIN',
  TOTP: 'TOTP',
  WEBAUTHN: 'WEBAUTHN',
  SSO_OIDC: 'SSO_OIDC',
  SSO_SAML: 'SSO_SAML',
  API_KEY: 'API_KEY',
} as const;
export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod];

export const AuditOutcome = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  DENIED: 'DENIED',
  ERROR: 'ERROR',
} as const;
export type AuditOutcome = (typeof AuditOutcome)[keyof typeof AuditOutcome];

export const ExamStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  LIVE: 'LIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ExamStatus = (typeof ExamStatus)[keyof typeof ExamStatus];

export const ExamType = {
  SCHEDULED: 'SCHEDULED',
  IMMEDIATE: 'IMMEDIATE',
  PRACTICE: 'PRACTICE',
  LIVE_ASSESSMENT: 'LIVE_ASSESSMENT',
  REMOTE: 'REMOTE',
  IN_PERSON: 'IN_PERSON',
  HYBRID: 'HYBRID',
} as const;
export type ExamType = (typeof ExamType)[keyof typeof ExamType];

export const QuestionType = {
  SINGLE_CHOICE: 'SINGLE_CHOICE',
  MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
  TRUE_FALSE: 'TRUE_FALSE',
  FILL_BLANK: 'FILL_BLANK',
  SHORT_ANSWER: 'SHORT_ANSWER',
  LONG_ANSWER: 'LONG_ANSWER',
  ESSAY: 'ESSAY',
  CODING: 'CODING',
  SQL: 'SQL',
  IMAGE_BASED: 'IMAGE_BASED',
  AUDIO_BASED: 'AUDIO_BASED',
  VIDEO_BASED: 'VIDEO_BASED',
  MATHEMATICAL: 'MATHEMATICAL',
  FILE_UPLOAD: 'FILE_UPLOAD',
  MATCHING: 'MATCHING',
  ORDERING: 'ORDERING',
  PRACTICAL: 'PRACTICAL',
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

export const AttemptStatus = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  AUTO_SUBMITTED: 'AUTO_SUBMITTED',
  TERMINATED: 'TERMINATED',
  CANCELLED: 'CANCELLED',
} as const;
export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];

export const IntegrationStatus = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  CONFIGURATION_PENDING: 'CONFIGURATION_PENDING',
  AUTHENTICATION_PENDING: 'AUTHENTICATION_PENDING',
  VERIFICATION_PENDING: 'VERIFICATION_PENDING',
  CONNECTED: 'CONNECTED',
  SYNC_ACTIVE: 'SYNC_ACTIVE',
  WARNING: 'WARNING',
  FAILED: 'FAILED',
  SUSPENDED: 'SUSPENDED',
  REVOKED: 'REVOKED',
} as const;
export type IntegrationStatus = (typeof IntegrationStatus)[keyof typeof IntegrationStatus];

export const RiskLevel = {
  NORMAL: 'NORMAL',
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const SecurityProfile = {
  STANDARD_BROWSER: 'STANDARD_BROWSER',
  ENHANCED_MONITORING: 'ENHANCED_MONITORING',
  SECURE_EXAM_BROWSER: 'SECURE_EXAM_BROWSER',
  ANDROID_KIOSK: 'ANDROID_KIOSK',
  APPLE_ASSESSMENT: 'APPLE_ASSESSMENT',
  MANAGED_DEVICE: 'MANAGED_DEVICE',
} as const;
export type SecurityProfile = (typeof SecurityProfile)[keyof typeof SecurityProfile];
