-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganisationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'LOCKED');

-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('SUPER_ADMIN', 'PLATFORM_STAFF', 'AUDITOR');

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('PASSWORD', 'PIN', 'TOTP', 'WEBAUTHN', 'SSO_OIDC', 'SSO_SAML', 'API_KEY');

-- CreateEnum
CREATE TYPE "MfaType" AS ENUM ('TOTP', 'WEBAUTHN', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED', 'ERROR');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('SCHEDULED', 'IMMEDIATE', 'PRACTICE', 'LIVE_ASSESSMENT', 'REMOTE', 'IN_PERSON', 'HYBRID');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT_ANSWER', 'LONG_ANSWER', 'ESSAY', 'CODING', 'SQL', 'IMAGE_BASED', 'AUDIO_BASED', 'VIDEO_BASED', 'MATHEMATICAL', 'FILE_UPLOAD', 'MATCHING', 'ORDERING', 'PRACTICAL');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'TERMINATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvaluationMode" AS ENUM ('AUTOMATIC', 'MANUAL', 'HYBRID', 'RUBRIC');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REVISION');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'REVISION', 'WITHHELD');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONNECTED', 'CONFIGURATION_PENDING', 'AUTHENTICATION_PENDING', 'VERIFICATION_PENDING', 'CONNECTED', 'SYNC_ACTIVE', 'WARNING', 'FAILED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "IntegrationAuthType" AS ENUM ('API_KEY', 'OAUTH2', 'OIDC', 'SAML', 'WEBHOOK', 'BASIC', 'MTLS', 'SCIM');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "SecurityProfile" AS ENUM ('STANDARD_BROWSER', 'ENHANCED_MONITORING', 'SECURE_EXAM_BROWSER', 'ANDROID_KIOSK', 'APPLE_ASSESSMENT', 'MANAGED_DEVICE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('NORMAL', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'IN_APP', 'WEBHOOK', 'PUSH');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN');

-- CreateTable
CREATE TABLE "organisations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "registrationNumber" VARCHAR(120),
    "officialEmail" VARCHAR(320) NOT NULL,
    "contactPhone" VARCHAR(32),
    "website" VARCHAR(500),
    "logoKey" VARCHAR(512),
    "primaryColour" VARCHAR(16),
    "address" JSONB,
    "status" "OrganisationStatus" NOT NULL DEFAULT 'DRAFT',
    "verificationSubmittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_verifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "stage" VARCHAR(80) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "documentKeys" TEXT[],
    "notes" TEXT,
    "reviewerId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "email" VARCHAR(320) NOT NULL,
    "username" VARCHAR(120),
    "passwordHash" TEXT,
    "globalRole" "GlobalRole",
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" VARCHAR(64),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID NOT NULL,
    "firstName" VARCHAR(120),
    "lastName" VARCHAR(120),
    "phone" VARCHAR(32),
    "avatarKey" VARCHAR(512),
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "preferences" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation_memberships" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    "invitedBy" UUID,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisation_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "authMethod" "AuthMethod" NOT NULL,
    "ip" VARCHAR(64),
    "userAgent" TEXT,
    "deviceLabel" VARCHAR(200),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authentication_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID,
    "email" VARCHAR(320),
    "method" "AuthMethod" NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "ip" VARCHAR(64),
    "userAgent" TEXT,
    "location" VARCHAR(200),
    "riskScore" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_methods" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID NOT NULL,
    "type" "MfaType" NOT NULL,
    "label" VARCHAR(120),
    "secretEncrypted" TEXT,
    "credentialId" VARCHAR(255),
    "publicKey" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "super_admin_credentials" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "pinHash" TEXT NOT NULL,
    "pinUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotationRequired" BOOLEAN NOT NULL DEFAULT false,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "super_admin_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(40),
    "parentId" UUID,
    "headUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(40),
    "address" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examinations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(120),
    "type" "ExamType" NOT NULL DEFAULT 'SCHEDULED',
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "instructions" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "passingMarks" DOUBLE PRECISION,
    "totalMarks" DOUBLE PRECISION NOT NULL,
    "negativeMarking" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "randomiseQuestions" BOOLEAN NOT NULL DEFAULT false,
    "randomiseOptions" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "examinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examination_versions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "examinationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "immutableHash" VARCHAR(128) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "examination_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examination_sections" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "examinationId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "marks" DOUBLE PRECISION NOT NULL,
    "questionCount" INTEGER,
    "passingMarks" DOUBLE PRECISION,
    "durationMinutes" INTEGER,
    "randomiseQuestions" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "examination_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examination_security_policies" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "examinationId" UUID NOT NULL,
    "profile" "SecurityProfile" NOT NULL DEFAULT 'STANDARD_BROWSER',
    "permittedBrowsers" TEXT[],
    "requiredClientVersions" TEXT[],
    "deviceRequirements" JSONB,
    "screenCapturePolicy" VARCHAR(40) NOT NULL DEFAULT 'ALLOW',
    "cameraPolicy" VARCHAR(40) NOT NULL DEFAULT 'OPTIONAL',
    "permittedUrls" TEXT[],
    "applicationRestrictions" JSONB,
    "disconnectionPolicy" VARCHAR(60) NOT NULL DEFAULT 'ALLOW_RECONNECT',
    "reconnectionLimit" INTEGER NOT NULL DEFAULT 3,
    "riskThresholds" JSONB,
    "requireFullscreen" BOOLEAN NOT NULL DEFAULT false,
    "tabSwitchEvents" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "examination_security_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_banks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(120),
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bankId" UUID,
    "sectionId" UUID,
    "type" "QuestionType" NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "prompt" TEXT NOT NULL,
    "explanation" TEXT,
    "marks" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "negativeMarks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "metadata" JSONB,
    "attachmentKeys" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "label" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_sets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_set_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "setId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "question_set_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "candidateCode" VARCHAR(80) NOT NULL,
    "firstName" VARCHAR(120) NOT NULL,
    "lastName" VARCHAR(120) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(32),
    "departmentId" UUID,
    "branchId" UUID,
    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    "verifiedAt" TIMESTAMP(3),
    "photoIdKey" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_examinations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "examinationId" UUID NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "eligibleAt" TIMESTAMP(3),
    "windowStartAt" TIMESTAMP(3),
    "windowEndAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_examinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examination_attempts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "examinationId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "AttemptStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "serverEndAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "examination_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_answers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "answer" JSONB NOT NULL,
    "marksAwarded" DOUBLE PRECISION,
    "isCorrect" BOOLEAN,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "receiptHash" VARCHAR(128) NOT NULL,
    "clientTime" TIMESTAMP(3),
    "status" VARCHAR(40) NOT NULL DEFAULT 'ACCEPTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "evaluatorId" UUID,
    "mode" "EvaluationMode" NOT NULL,
    "blind" BOOLEAN NOT NULL DEFAULT false,
    "rubric" JSONB,
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "feedback" TEXT,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "examinationId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "rank" INTEGER,
    "status" "ResultStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "approvedBy" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "certificateNumber" VARCHAR(80) NOT NULL,
    "pdfKey" VARCHAR(512),
    "verificationCode" VARCHAR(120) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "provider" VARCHAR(120) NOT NULL,
    "category" VARCHAR(120),
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "authType" "IntegrationAuthType" NOT NULL DEFAULT 'API_KEY',
    "config" JSONB,
    "scopes" TEXT[],
    "ownerUserId" UUID,
    "lastConnectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "healthStatus" "HealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "keyId" VARCHAR(120) NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" VARCHAR(64) NOT NULL,
    "authTag" VARCHAR(64) NOT NULL,
    "algorithm" VARCHAR(40) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_permissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "permission" VARCHAR(160) NOT NULL,
    "grantedBy" UUID,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "integration_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_clients" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "name" VARCHAR(200) NOT NULL,
    "clientId" VARCHAR(120) NOT NULL,
    "secretHash" TEXT NOT NULL,
    "description" TEXT,
    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "clientId" UUID,
    "prefix" VARCHAR(40) NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "integrationId" UUID,
    "url" VARCHAR(1000) NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "events" TEXT[],
    "status" VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "endpointId" UUID,
    "integrationId" UUID,
    "eventType" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "actorUserId" UUID,
    "actorEmail" VARCHAR(320),
    "action" VARCHAR(160) NOT NULL,
    "resourceType" VARCHAR(120) NOT NULL,
    "resourceId" VARCHAR(120),
    "previousValues" JSONB,
    "newValues" JSONB,
    "outcome" "AuditOutcome" NOT NULL,
    "ip" VARCHAR(64),
    "userAgent" TEXT,
    "sessionId" UUID,
    "correlationId" VARCHAR(120),
    "requestId" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_alerts" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "severity" "AlertSeverity" NOT NULL,
    "category" VARCHAR(120) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "source" VARCHAR(160),
    "evidenceRef" VARCHAR(512),
    "status" VARCHAR(40) NOT NULL DEFAULT 'OPEN',
    "assignedTo" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_incidents" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "alertId" UUID,
    "severity" "AlertSeverity" NOT NULL,
    "classification" VARCHAR(120) NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" UUID,
    "notes" TEXT,
    "responseActions" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "examination_security_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "category" VARCHAR(120) NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "evidence" JSONB,
    "clientTime" TIMESTAMP(3),
    "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "riskWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "investigated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "examination_security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "rules" JSONB,
    "modelVersion" VARCHAR(60),
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "appealStatus" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_registrations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "candidateId" UUID,
    "deviceId" VARCHAR(200) NOT NULL,
    "platform" VARCHAR(60),
    "model" VARCHAR(160),
    "osVersion" VARCHAR(120),
    "clientVersion" VARCHAR(60),
    "integrityStatus" VARCHAR(60) NOT NULL DEFAULT 'UNKNOWN',
    "publicKey" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "device_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "deviceId" UUID,
    "sessionTokenHash" TEXT NOT NULL,
    "securityProfile" "SecurityProfile" NOT NULL DEFAULT 'STANDARD_BROWSER',
    "secureClientVersion" VARCHAR(60),
    "heartbeatAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "key" VARCHAR(160) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subject" VARCHAR(300),
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID,
    "candidateId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "templateKey" VARCHAR(160),
    "recipient" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(300),
    "body" TEXT NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "providerMessageId" VARCHAR(200),
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "plan" VARCHAR(80) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "seats" INTEGER,
    "billingCycle" VARCHAR(40) NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID,
    "provider" VARCHAR(80) NOT NULL,
    "providerReference" VARCHAR(200),
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'INR',
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_objects" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "bucket" VARCHAR(160) NOT NULL,
    "mimeType" VARCHAR(160) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" VARCHAR(128),
    "purpose" VARCHAR(80) NOT NULL,
    "uploadedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_health_events" (
    "id" UUID NOT NULL,
    "component" VARCHAR(120) NOT NULL,
    "status" "HealthStatus" NOT NULL,
    "latencyMs" INTEGER,
    "details" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "system_health_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisations_slug_key" ON "organisations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organisations_registrationNumber_key" ON "organisations"("registrationNumber");

-- CreateIndex
CREATE INDEX "organisations_status_createdAt_idx" ON "organisations"("status", "createdAt");

-- CreateIndex
CREATE INDEX "organisation_verifications_tenantId_createdAt_idx" ON "organisation_verifications"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_globalRole_idx" ON "users"("globalRole");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE INDEX "organisation_memberships_userId_status_idx" ON "organisation_memberships"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_memberships_tenantId_userId_key" ON "organisation_memberships"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_name_key" ON "roles"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "role_permissions_tenantId_idx" ON "role_permissions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_tenantId_userId_roleId_key" ON "user_roles"("tenantId", "userId", "roleId");

-- CreateIndex
CREATE INDEX "user_sessions_userId_revokedAt_idx" ON "user_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "user_sessions_familyId_idx" ON "user_sessions"("familyId");

-- CreateIndex
CREATE INDEX "authentication_events_userId_createdAt_idx" ON "authentication_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "authentication_events_email_createdAt_idx" ON "authentication_events"("email", "createdAt");

-- CreateIndex
CREATE INDEX "authentication_events_outcome_createdAt_idx" ON "authentication_events"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "mfa_methods_userId_enabled_idx" ON "mfa_methods"("userId", "enabled");

-- CreateIndex
CREATE INDEX "recovery_codes_userId_idx" ON "recovery_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "super_admin_credentials_userId_key" ON "super_admin_credentials"("userId");

-- CreateIndex
CREATE INDEX "departments_tenantId_parentId_idx" ON "departments"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_code_key" ON "departments"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenantId_code_key" ON "branches"("tenantId", "code");

-- CreateIndex
CREATE INDEX "examinations_tenantId_status_startsAt_idx" ON "examinations"("tenantId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "examinations_tenantId_createdAt_idx" ON "examinations"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "examination_versions_examinationId_version_key" ON "examination_versions"("examinationId", "version");

-- CreateIndex
CREATE INDEX "examination_sections_examinationId_position_idx" ON "examination_sections"("examinationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "examination_security_policies_examinationId_key" ON "examination_security_policies"("examinationId");

-- CreateIndex
CREATE INDEX "question_banks_tenantId_category_idx" ON "question_banks"("tenantId", "category");

-- CreateIndex
CREATE INDEX "questions_tenantId_type_difficulty_idx" ON "questions"("tenantId", "type", "difficulty");

-- CreateIndex
CREATE INDEX "questions_bankId_idx" ON "questions"("bankId");

-- CreateIndex
CREATE INDEX "questions_sectionId_idx" ON "questions"("sectionId");

-- CreateIndex
CREATE INDEX "question_options_questionId_position_idx" ON "question_options"("questionId", "position");

-- CreateIndex
CREATE INDEX "question_sets_tenantId_idx" ON "question_sets"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "question_set_items_setId_questionId_key" ON "question_set_items"("setId", "questionId");

-- CreateIndex
CREATE INDEX "candidates_tenantId_status_idx" ON "candidates"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_tenantId_candidateCode_key" ON "candidates"("tenantId", "candidateCode");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_tenantId_email_key" ON "candidates"("tenantId", "email");

-- CreateIndex
CREATE INDEX "candidate_examinations_tenantId_eligible_idx" ON "candidate_examinations"("tenantId", "eligible");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_examinations_candidateId_examinationId_key" ON "candidate_examinations"("candidateId", "examinationId");

-- CreateIndex
CREATE INDEX "examination_attempts_tenantId_status_createdAt_idx" ON "examination_attempts"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "examination_attempts_candidateId_examinationId_attemptNumbe_key" ON "examination_attempts"("candidateId", "examinationId", "attemptNumber");

-- CreateIndex
CREATE INDEX "candidate_answers_attemptId_questionId_idx" ON "candidate_answers"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_answers_attemptId_idempotencyKey_key" ON "candidate_answers"("attemptId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_attemptId_key" ON "submissions"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_tenantId_idempotencyKey_key" ON "submissions"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "evaluations_attemptId_status_idx" ON "evaluations"("attemptId", "status");

-- CreateIndex
CREATE INDEX "results_tenantId_examinationId_status_idx" ON "results"("tenantId", "examinationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "results_attemptId_version_key" ON "results"("attemptId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_resultId_key" ON "certificates"("resultId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_verificationCode_key" ON "certificates"("verificationCode");

-- CreateIndex
CREATE INDEX "certificates_tenantId_idx" ON "certificates"("tenantId");

-- CreateIndex
CREATE INDEX "integrations_tenantId_status_idx" ON "integrations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "integration_credentials_integrationId_revokedAt_idx" ON "integration_credentials"("integrationId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_permissions_integrationId_permission_key" ON "integration_permissions"("integrationId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_clientId_key" ON "api_clients"("clientId");

-- CreateIndex
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_endpoints_integrationId_key" ON "webhook_endpoints"("integrationId");

-- CreateIndex
CREATE INDEX "webhook_events_tenantId_status_nextAttemptAt_idx" ON "webhook_events"("tenantId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "security_alerts_tenantId_severity_status_idx" ON "security_alerts"("tenantId", "severity", "status");

-- CreateIndex
CREATE INDEX "security_incidents_tenantId_status_severity_idx" ON "security_incidents"("tenantId", "status", "severity");

-- CreateIndex
CREATE INDEX "examination_security_events_attemptId_serverTime_idx" ON "examination_security_events"("attemptId", "serverTime");

-- CreateIndex
CREATE INDEX "examination_security_events_tenantId_eventType_serverTime_idx" ON "examination_security_events"("tenantId", "eventType", "serverTime");

-- CreateIndex
CREATE INDEX "risk_assessments_attemptId_createdAt_idx" ON "risk_assessments"("attemptId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_registrations_tenantId_deviceId_key" ON "device_registrations"("tenantId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sessions_attemptId_key" ON "exam_sessions"("attemptId");

-- CreateIndex
CREATE INDEX "exam_sessions_tenantId_heartbeatAt_idx" ON "exam_sessions"("tenantId", "heartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_tenantId_key_channel_key" ON "notification_templates"("tenantId", "key", "channel");

-- CreateIndex
CREATE INDEX "notifications_tenantId_createdAt_idx" ON "notifications"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "subscriptions"("tenantId");

-- CreateIndex
CREATE INDEX "payments_tenantId_createdAt_idx" ON "payments"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "file_objects_tenantId_purpose_idx" ON "file_objects"("tenantId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_bucket_objectKey_key" ON "file_objects"("bucket", "objectKey");

-- CreateIndex
CREATE INDEX "system_health_events_component_detectedAt_idx" ON "system_health_events"("component", "detectedAt");

-- AddForeignKey
ALTER TABLE "organisation_verifications" ADD CONSTRAINT "organisation_verifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_methods" ADD CONSTRAINT "mfa_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "super_admin_credentials" ADD CONSTRAINT "super_admin_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examinations" ADD CONSTRAINT "examinations_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_versions" ADD CONSTRAINT "examination_versions_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "examinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_sections" ADD CONSTRAINT "examination_sections_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "examinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_security_policies" ADD CONSTRAINT "examination_security_policies_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "examinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "question_banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "examination_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_sets" ADD CONSTRAINT "question_sets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_set_items" ADD CONSTRAINT "question_set_items_setId_fkey" FOREIGN KEY ("setId") REFERENCES "question_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_set_items" ADD CONSTRAINT "question_set_items_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_examinations" ADD CONSTRAINT "candidate_examinations_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_examinations" ADD CONSTRAINT "candidate_examinations_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "examinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_attempts" ADD CONSTRAINT "examination_attempts_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_attempts" ADD CONSTRAINT "examination_attempts_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "examinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_answers" ADD CONSTRAINT "candidate_answers_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "examination_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_answers" ADD CONSTRAINT "candidate_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "examination_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "examination_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "examination_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_examinationId_fkey" FOREIGN KEY ("examinationId") REFERENCES "examinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_permissions" ADD CONSTRAINT "integration_permissions_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_permissions" ADD CONSTRAINT "integration_permissions_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_incidents" ADD CONSTRAINT "security_incidents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_incidents" ADD CONSTRAINT "security_incidents_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "security_alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_security_events" ADD CONSTRAINT "examination_security_events_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "examination_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "examination_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "examination_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "device_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

