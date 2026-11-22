/**
 * Canonical permission catalogue. Permission rows are seeded into the database
 * at startup; both API guards and the web UI reference these stable keys.
 */
export const PERMISSIONS = {
  PLATFORM_ORGANISATIONS_READ: 'platform.organisations.read',
  PLATFORM_ORGANISATIONS_MANAGE: 'platform.organisations.manage',
  PLATFORM_VERIFICATION_REVIEW: 'platform.verification.review',
  PLATFORM_USERS_READ: 'platform.users.read',
  PLATFORM_USERS_MANAGE: 'platform.users.manage',
  PLATFORM_ROLES_READ: 'platform.roles.read',
  PLATFORM_ROLES_MANAGE: 'platform.roles.manage',
  PLATFORM_AUDIT_READ: 'platform.audit.read',
  PLATFORM_AUTH_EVENTS_READ: 'platform.auth_events.read',
  PLATFORM_SECURITY_MANAGE: 'platform.security.manage',
  ORG_DASHBOARD_READ: 'org.dashboard.read',
  ORG_PROFILE_MANAGE: 'org.profile.manage',
  ORG_USERS_READ: 'org.users.read',
  ORG_USERS_MANAGE: 'org.users.manage',
  ORG_ROLES_READ: 'org.roles.read',
  ORG_ROLES_MANAGE: 'org.roles.manage',
  ORG_CANDIDATES_READ: 'org.candidates.read',
  ORG_CANDIDATES_MANAGE: 'org.candidates.manage',
  ORG_EXAMINATIONS_READ: 'org.examinations.read',
  ORG_EXAMINATIONS_MANAGE: 'org.examinations.manage',
  ORG_QUESTION_BANK_READ: 'org.question_bank.read',
  ORG_QUESTION_BANK_MANAGE: 'org.question_bank.manage',
  ORG_EVALUATION_READ: 'org.evaluation.read',
  ORG_LIVE_MONITORING: 'org.live_monitoring',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOGUE: ReadonlyArray<{
  key: PermissionKey;
  description: string;
  category: string;
}> = [
  { key: PERMISSIONS.PLATFORM_ORGANISATIONS_READ, description: 'View organisations and verification applications', category: 'platform' },
  { key: PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE, description: 'Approve, reject, suspend or reactivate organisations', category: 'platform' },
  { key: PERMISSIONS.PLATFORM_VERIFICATION_REVIEW, description: 'Review organisation verification evidence', category: 'platform' },
  { key: PERMISSIONS.PLATFORM_USERS_READ, description: 'View platform users', category: 'platform' },
  { key: PERMISSIONS.PLATFORM_USERS_MANAGE, description: 'Change platform user status and roles', category: 'platform' },
  { key: PERMISSIONS.PLATFORM_ROLES_READ, description: 'View roles and the permission catalogue', category: 'platform' },
  { key: PERMISSIONS.PLATFORM_ROLES_MANAGE, description: 'Create and modify roles', category: 'platform' },
  { key: PERMISSIONS.PLATFORM_AUDIT_READ, description: 'Search the tamper-resistant audit trail', category: 'platform' },
  { key: PERMISSIONS.PLATFORM_AUTH_EVENTS_READ, description: 'Search authentication events', category: 'platform' },
  { key: PERMISSIONS.PLATFORM_SECURITY_MANAGE, description: 'Manage platform security controls', category: 'platform' },
  { key: PERMISSIONS.ORG_DASHBOARD_READ, description: 'View the organisation dashboard', category: 'organisation' },
  { key: PERMISSIONS.ORG_PROFILE_MANAGE, description: 'Update organisation profile and branding', category: 'organisation' },
  { key: PERMISSIONS.ORG_USERS_READ, description: 'View organisation users', category: 'organisation' },
  { key: PERMISSIONS.ORG_USERS_MANAGE, description: 'Invite and manage organisation users', category: 'organisation' },
  { key: PERMISSIONS.ORG_ROLES_READ, description: 'View organisation roles', category: 'organisation' },
  { key: PERMISSIONS.ORG_ROLES_MANAGE, description: 'Create and manage organisation roles', category: 'organisation' },
  { key: PERMISSIONS.ORG_CANDIDATES_READ, description: 'View candidates', category: 'organisation' },
  { key: PERMISSIONS.ORG_CANDIDATES_MANAGE, description: 'Create and manage candidates', category: 'organisation' },
  { key: PERMISSIONS.ORG_EXAMINATIONS_READ, description: 'View examinations', category: 'organisation' },
  { key: PERMISSIONS.ORG_EXAMINATIONS_MANAGE, description: 'Create and manage examinations', category: 'organisation' },
  { key: PERMISSIONS.ORG_QUESTION_BANK_READ, description: 'View question banks', category: 'organisation' },
  { key: PERMISSIONS.ORG_QUESTION_BANK_MANAGE, description: 'Manage question banks', category: 'organisation' },
  { key: PERMISSIONS.ORG_EVALUATION_READ, description: 'View evaluation work queues', category: 'organisation' },
  { key: PERMISSIONS.ORG_LIVE_MONITORING, description: 'Monitor live examinations', category: 'organisation' },
];

/** Default tenant roles created for every verified organisation. */
export const TENANT_ROLE_PERMISSIONS: Readonly<Record<string, readonly PermissionKey[]>> = {
  ORG_ADMIN: [
    PERMISSIONS.ORG_DASHBOARD_READ,
    PERMISSIONS.ORG_PROFILE_MANAGE,
    PERMISSIONS.ORG_USERS_READ,
    PERMISSIONS.ORG_USERS_MANAGE,
    PERMISSIONS.ORG_ROLES_READ,
    PERMISSIONS.ORG_ROLES_MANAGE,
    PERMISSIONS.ORG_CANDIDATES_READ,
    PERMISSIONS.ORG_CANDIDATES_MANAGE,
    PERMISSIONS.ORG_EXAMINATIONS_READ,
    PERMISSIONS.ORG_EXAMINATIONS_MANAGE,
    PERMISSIONS.ORG_QUESTION_BANK_READ,
    PERMISSIONS.ORG_QUESTION_BANK_MANAGE,
    PERMISSIONS.ORG_EVALUATION_READ,
    PERMISSIONS.ORG_LIVE_MONITORING,
  ],
  EXAM_ADMIN: [
    PERMISSIONS.ORG_DASHBOARD_READ,
    PERMISSIONS.ORG_CANDIDATES_READ,
    PERMISSIONS.ORG_CANDIDATES_MANAGE,
    PERMISSIONS.ORG_EXAMINATIONS_READ,
    PERMISSIONS.ORG_EXAMINATIONS_MANAGE,
    PERMISSIONS.ORG_QUESTION_BANK_READ,
    PERMISSIONS.ORG_QUESTION_BANK_MANAGE,
    PERMISSIONS.ORG_LIVE_MONITORING,
  ],
  INVIGILATOR: [PERMISSIONS.ORG_DASHBOARD_READ, PERMISSIONS.ORG_LIVE_MONITORING, PERMISSIONS.ORG_EXAMINATIONS_READ],
  EXAMINER: [PERMISSIONS.ORG_DASHBOARD_READ, PERMISSIONS.ORG_QUESTION_BANK_READ, PERMISSIONS.ORG_QUESTION_BANK_MANAGE],
  EVALUATOR: [PERMISSIONS.ORG_DASHBOARD_READ, PERMISSIONS.ORG_EVALUATION_READ],
  CANDIDATE: [],
  STAFF: [PERMISSIONS.ORG_DASHBOARD_READ],
};
