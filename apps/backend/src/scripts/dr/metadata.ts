/**
 * Hardcoded table/column allowlist for the logical backup format.
 *
 * Names are the PHYSICAL MySQL names from prisma/schema.prisma (tables via @@map,
 * columns as declared in the models). Nothing read from a backup archive is ever
 * used as a SQL identifier: restore builds SQL from these definitions only.
 */

export interface TableDefinition {
  readonly name: string;
  readonly columns: readonly string[];
}

function table(name: string, columns: string): TableDefinition {
  return {
    name,
    columns: columns.trim().split(/\s+/).map((column) => column.trim()).filter(Boolean),
  };
}

const DEFINITIONS: readonly TableDefinition[] = [
  // Global / reference data (no tenancy FK).
  table('permissions', `
    id key description category createdAt
  `),
  table('platform_settings', `
    key value description updatedBy updatedAt
  `),
  table('system_health_events', `
    id component status latencyMs details detectedAt resolvedAt
  `),
  table('notification_templates', `
    id tenantId key channel subject body variables active createdAt
  `),

  // Tenancy and identity roots.
  table('organisations', `
    id name slug registrationNumber officialEmail contactPhone website logoKey primaryColour
    address status verificationSubmittedAt approvedAt suspendedAt createdAt updatedAt deletedAt
  `),
  table('users', `
    id tenantId email username passwordHash globalRole status emailVerifiedAt phoneVerifiedAt
    failedLoginCount lockedUntil lastLoginAt lastLoginIp passwordChangedAt createdAt updatedAt deletedAt
  `),
  table('organisation_verifications', `
    id tenantId stage status documentKeys notes reviewerId reviewedAt createdAt
  `),
  table('user_profiles', `
    id tenantId userId firstName lastName phone avatarKey locale timezone preferences updatedAt
  `),
  table('organisation_memberships', `
    id tenantId userId isPrimary status invitedBy joinedAt createdAt
  `),
  table('roles', `
    id tenantId name description isSystem createdBy createdAt updatedAt
  `),
  table('role_permissions', `
    id tenantId roleId permissionId
  `),
  table('user_roles', `
    id tenantId userId roleId grantedAt
  `),
  table('user_sessions', `
    id tenantId userId refreshHash familyId authMethod ip userAgent deviceLabel expiresAt
    lastUsedAt revokedAt createdAt
  `),
  table('authentication_events', `
    id tenantId userId email method outcome ip userAgent location riskScore metadata createdAt
  `),
  table('mfa_methods', `
    id tenantId userId type label secretEncrypted credentialId publicKey verifiedAt enabled createdAt
  `),
  table('recovery_codes', `
    id tenantId userId codeHash usedAt createdAt
  `),
  table('super_admin_credentials', `
    id userId pinHash pinUpdatedAt rotationRequired failedAttempts lockedUntil createdAt updatedAt
  `),
  table('departments', `
    id tenantId name code parentId headUserId createdAt
  `),
  table('branches', `
    id tenantId name code address createdAt
  `),

  // Examinations and question banks.
  table('examinations', `
    id tenantId version title description category type status instructions durationMinutes
    startsAt endsAt timezone maxAttempts passingMarks totalMarks negativeMarking
    randomiseQuestions randomiseOptions createdBy publishedAt archivedAt createdAt updatedAt
  `),
  table('question_banks', `
    id tenantId name description category createdBy createdAt updatedAt
  `),
  table('question_sets', `
    id tenantId name description createdBy createdAt updatedAt
  `),
  table('candidates', `
    id tenantId userId candidateCode firstName lastName email phone departmentId branchId status
    verifiedAt photoIdKey createdAt updatedAt
  `),
  table('integrations', `
    id tenantId name provider category status authType config scopes ownerUserId lastConnectedAt
    lastSyncAt healthStatus errorCount createdAt updatedAt
  `),
  table('api_clients', `
    id tenantId name clientId secretHash description status createdBy createdAt revokedAt
  `),
  table('webhook_endpoints', `
    id tenantId integrationId url secretEncrypted events status createdAt disabledAt
  `),
  table('subscriptions', `
    id tenantId plan status seats billingCycle startDate endDate trialEndsAt createdAt updatedAt
  `),
  table('payments', `
    id tenantId subscriptionId provider providerReference amount currency status paidAt createdAt
  `),
  table('file_objects', `
    id tenantId objectKey bucket mimeType sizeBytes checksum purpose uploadedBy createdAt
  `),
  table('device_registrations', `
    id tenantId userId candidateId deviceId platform model osVersion clientVersion integrityStatus
    publicKey registeredAt lastSeenAt revokedAt
  `),
  table('audit_logs', `
    id tenantId actorUserId actorEmail action resourceType resourceId previousValues newValues
    outcome ip userAgent sessionId correlationId requestId createdAt
  `),
  table('security_alerts', `
    id tenantId severity category title description source evidenceRef status assignedTo createdAt resolvedAt
  `),
  table('security_incidents', `
    id tenantId alertId severity classification status assignedTo notes responseActions resolvedAt
    createdAt updatedAt
  `),
  table('support_tickets', `
    id tenantId subject category priority status requesterEmail body assignee resolution resolvedAt
    createdAt updatedAt
  `),
  table('api_request_logs', `
    id tenantId clientId method path statusCode outcome latencyMs createdAt
  `),
  table('notifications', `
    id tenantId userId candidateId channel templateKey recipient subject body status
    providerMessageId sentAt readAt createdAt
  `),

  // Published versions, questions and attempts (parents before children).
  table('examination_versions', `
    id tenantId examinationId version snapshot immutableHash contentHash publishedAt createdAt
  `),
  table('examination_sections', `
    id tenantId examinationId name description position marks questionCount passingMarks
    durationMinutes randomiseQuestions
  `),
  table('examination_security_policies', `
    id tenantId examinationId profile permittedBrowsers requiredClientVersions deviceRequirements
    screenCapturePolicy cameraPolicy permittedUrls applicationRestrictions disconnectionPolicy
    reconnectionLimit riskThresholds requireFullscreen tabSwitchEvents updatedAt
  `),
  table('questions', `
    id tenantId bankId sectionId type difficulty prompt explanation marks negativeMarks tags metadata
    attachmentKeys version isActive createdBy createdAt updatedAt
  `),
  table('question_options', `
    id tenantId questionId label content isCorrect position metadata
  `),
  table('question_set_items', `
    id tenantId setId questionId position
  `),
  table('candidate_examinations', `
    id tenantId candidateId examinationId eligible eligibleAt windowStartAt windowEndAt createdAt
  `),
  table('examination_attempts', `
    id tenantId candidateId examinationId versionId attemptNumber status startedAt serverEndAt
    submittedAt score riskScore metadata createdAt updatedAt
  `),
  table('candidate_answers', `
    id tenantId attemptId questionId answer marksAwarded isCorrect idempotencyKey savedAt createdAt updatedAt
  `),
  table('submissions', `
    id tenantId attemptId idempotencyKey receiptHash clientTime status receipt createdAt
  `),
  table('evaluations', `
    id tenantId attemptId questionId evaluatorId mode blind rubric score maxScore feedback status
    startedAt completedAt createdAt updatedAt
  `),
  table('results', `
    id tenantId attemptId examinationId candidateId score maxScore percentage passed rank status version
    publishedAt approvedBy metadata createdAt updatedAt
  `),
  table('certificates', `
    id tenantId resultId certificateNumber pdfKey verificationCode issuedAt revokedAt
  `),
  table('examination_security_events', `
    id tenantId attemptId eventType category severity evidence clientTime serverTime riskWeight investigated
  `),
  table('risk_assessments', `
    id tenantId attemptId score level rules modelVersion reviewedBy reviewedAt appealStatus createdAt
  `),
  table('exam_sessions', `
    id tenantId attemptId deviceId sessionTokenHash securityProfile secureClientVersion heartbeatAt
    disconnectedAt terminatedAt createdAt
  `),

  // Integration children.
  table('integration_credentials', `
    id tenantId integrationId keyId ciphertext iv authTag algorithm expiresAt rotatedAt revokedAt createdAt
  `),
  table('integration_permissions', `
    id tenantId integrationId permission grantedBy grantedAt revokedAt
  `),
  table('webhook_events', `
    id tenantId endpointId integrationId eventType payload status attempts lastAttemptAt nextAttemptAt
    error createdAt
  `),
  table('api_keys', `
    id tenantId clientId prefix secretHash scopes expiresAt lastUsedAt revokedAt createdAt
  `),
];

/** FK-safe restore order; also the canonical export order. */
export const TABLE_ORDER: readonly string[] = DEFINITIONS.map((definition) => definition.name);

const TABLE_MAP: ReadonlyMap<string, TableDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.name, definition] as const),
);

export function getTableDefinition(name: unknown): TableDefinition | undefined {
  return typeof name === 'string' ? TABLE_MAP.get(name) : undefined;
}

/** Returns the table definition or throws without including untrusted text in the message. */
export function requireTableDefinition(name: unknown): TableDefinition {
  const definition = getTableDefinition(name);
  if (!definition) throw new Error('Backup references an unknown application table');
  return definition;
}

/** Quotes a hardcoded identifier only; rejects anything outside the allowlist pattern. */
export function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error('Invalid SQL identifier in backup tooling');
  }
  return `\`${identifier}\``;
}

/** Canonical column order for an archive entry, taken only from the allowlist. */
export function allowedColumnsInOrder(table: string, archiveColumns: readonly string[]): string[] {
  const definition = requireTableDefinition(table);
  const requested = new Set(archiveColumns);
  return definition.columns.filter((column) => requested.has(column));
}
