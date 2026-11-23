-- CreateTable
CREATE TABLE `organisations` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `registrationNumber` VARCHAR(120) NULL,
    `officialEmail` VARCHAR(320) NOT NULL,
    `contactPhone` VARCHAR(32) NULL,
    `website` VARCHAR(500) NULL,
    `logoKey` VARCHAR(512) NULL,
    `primaryColour` VARCHAR(16) NULL,
    `address` JSON NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED') NOT NULL DEFAULT 'DRAFT',
    `verificationSubmittedAt` DATETIME(3) NULL,
    `approvedAt` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `organisations_slug_key`(`slug`),
    UNIQUE INDEX `organisations_registrationNumber_key`(`registrationNumber`),
    INDEX `organisations_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organisation_verifications` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `stage` VARCHAR(80) NOT NULL,
    `status` VARCHAR(40) NOT NULL,
    `documentKeys` JSON NULL,
    `notes` TEXT NULL,
    `reviewerId` VARCHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `organisation_verifications_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `email` VARCHAR(320) NOT NULL,
    `username` VARCHAR(120) NULL,
    `passwordHash` TEXT NULL,
    `globalRole` ENUM('SUPER_ADMIN', 'PLATFORM_STAFF', 'AUDITOR') NULL,
    `status` ENUM('PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'LOCKED') NOT NULL DEFAULT 'PENDING_VERIFICATION',
    `emailVerifiedAt` DATETIME(3) NULL,
    `phoneVerifiedAt` DATETIME(3) NULL,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(64) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_status_idx`(`status`),
    INDEX `users_globalRole_idx`(`globalRole`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_profiles` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `userId` VARCHAR(36) NOT NULL,
    `firstName` VARCHAR(120) NULL,
    `lastName` VARCHAR(120) NULL,
    `phone` VARCHAR(32) NULL,
    `avatarKey` VARCHAR(512) NULL,
    `locale` VARCHAR(16) NOT NULL DEFAULT 'en',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
    `preferences` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_profiles_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organisation_memberships` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    `invitedBy` VARCHAR(36) NULL,
    `joinedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `organisation_memberships_userId_status_idx`(`userId`, `status`),
    UNIQUE INDEX `organisation_memberships_tenantId_userId_key`(`tenantId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(36) NOT NULL,
    `key` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `roleId` VARCHAR(36) NOT NULL,
    `permissionId` VARCHAR(36) NOT NULL,

    INDEX `role_permissions_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `role_permissions_roleId_permissionId_key`(`roleId`, `permissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `roleId` VARCHAR(36) NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_roles_tenantId_userId_roleId_key`(`tenantId`, `userId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_sessions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `userId` VARCHAR(36) NOT NULL,
    `refreshHash` TEXT NOT NULL,
    `familyId` VARCHAR(36) NOT NULL,
    `authMethod` ENUM('PASSWORD', 'PIN', 'TOTP', 'WEBAUTHN', 'SSO_OIDC', 'SSO_SAML', 'API_KEY') NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` TEXT NULL,
    `deviceLabel` VARCHAR(200) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_sessions_userId_revokedAt_idx`(`userId`, `revokedAt`),
    INDEX `user_sessions_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `authentication_events` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `userId` VARCHAR(36) NULL,
    `email` VARCHAR(320) NULL,
    `method` ENUM('PASSWORD', 'PIN', 'TOTP', 'WEBAUTHN', 'SSO_OIDC', 'SSO_SAML', 'API_KEY') NOT NULL,
    `outcome` ENUM('SUCCESS', 'FAILURE', 'DENIED', 'ERROR') NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` TEXT NULL,
    `location` VARCHAR(200) NULL,
    `riskScore` INTEGER NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `authentication_events_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `authentication_events_email_createdAt_idx`(`email`, `createdAt`),
    INDEX `authentication_events_outcome_createdAt_idx`(`outcome`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mfa_methods` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `userId` VARCHAR(36) NOT NULL,
    `type` ENUM('TOTP', 'WEBAUTHN', 'SMS', 'EMAIL') NOT NULL,
    `label` VARCHAR(120) NULL,
    `secretEncrypted` TEXT NULL,
    `credentialId` VARCHAR(255) NULL,
    `publicKey` TEXT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mfa_methods_userId_enabled_idx`(`userId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recovery_codes` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `userId` VARCHAR(36) NOT NULL,
    `codeHash` TEXT NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recovery_codes_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `super_admin_credentials` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `pinHash` TEXT NOT NULL,
    `pinUpdatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `rotationRequired` BOOLEAN NOT NULL DEFAULT false,
    `failedAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `super_admin_credentials_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(40) NULL,
    `parentId` VARCHAR(36) NULL,
    `headUserId` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `departments_tenantId_parentId_idx`(`tenantId`, `parentId`),
    UNIQUE INDEX `departments_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branches` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `code` VARCHAR(40) NULL,
    `address` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `branches_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `examinations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(120) NULL,
    `type` ENUM('SCHEDULED', 'IMMEDIATE', 'PRACTICE', 'LIVE_ASSESSMENT', 'REMOTE', 'IN_PERSON', 'HYBRID') NOT NULL DEFAULT 'SCHEDULED',
    `status` ENUM('DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `instructions` TEXT NULL,
    `durationMinutes` INTEGER NOT NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
    `maxAttempts` INTEGER NOT NULL DEFAULT 1,
    `passingMarks` DOUBLE NULL,
    `totalMarks` DOUBLE NOT NULL,
    `negativeMarking` DOUBLE NOT NULL DEFAULT 0,
    `randomiseQuestions` BOOLEAN NOT NULL DEFAULT false,
    `randomiseOptions` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(36) NULL,
    `publishedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `examinations_tenantId_status_startsAt_idx`(`tenantId`, `status`, `startsAt`),
    INDEX `examinations_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `examination_versions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `examinationId` VARCHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `immutableHash` VARCHAR(128) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `examination_versions_examinationId_version_key`(`examinationId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `examination_sections` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `examinationId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `marks` DOUBLE NOT NULL,
    `questionCount` INTEGER NULL,
    `passingMarks` DOUBLE NULL,
    `durationMinutes` INTEGER NULL,
    `randomiseQuestions` BOOLEAN NOT NULL DEFAULT false,

    INDEX `examination_sections_examinationId_position_idx`(`examinationId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `examination_security_policies` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `examinationId` VARCHAR(36) NOT NULL,
    `profile` ENUM('STANDARD_BROWSER', 'ENHANCED_MONITORING', 'SECURE_EXAM_BROWSER', 'ANDROID_KIOSK', 'APPLE_ASSESSMENT', 'MANAGED_DEVICE') NOT NULL DEFAULT 'STANDARD_BROWSER',
    `permittedBrowsers` JSON NULL,
    `requiredClientVersions` JSON NULL,
    `deviceRequirements` JSON NULL,
    `screenCapturePolicy` VARCHAR(40) NOT NULL DEFAULT 'ALLOW',
    `cameraPolicy` VARCHAR(40) NOT NULL DEFAULT 'OPTIONAL',
    `permittedUrls` JSON NULL,
    `applicationRestrictions` JSON NULL,
    `disconnectionPolicy` VARCHAR(60) NOT NULL DEFAULT 'ALLOW_RECONNECT',
    `reconnectionLimit` INTEGER NOT NULL DEFAULT 3,
    `riskThresholds` JSON NULL,
    `requireFullscreen` BOOLEAN NOT NULL DEFAULT false,
    `tabSwitchEvents` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `examination_security_policies_examinationId_key`(`examinationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_banks` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(120) NULL,
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `question_banks_tenantId_category_idx`(`tenantId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `questions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `bankId` VARCHAR(36) NULL,
    `sectionId` VARCHAR(36) NULL,
    `type` ENUM('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT_ANSWER', 'LONG_ANSWER', 'ESSAY', 'CODING', 'SQL', 'IMAGE_BASED', 'AUDIO_BASED', 'VIDEO_BASED', 'MATHEMATICAL', 'FILE_UPLOAD', 'MATCHING', 'ORDERING', 'PRACTICAL') NOT NULL,
    `difficulty` ENUM('EASY', 'MEDIUM', 'HARD') NOT NULL DEFAULT 'MEDIUM',
    `prompt` TEXT NOT NULL,
    `explanation` TEXT NULL,
    `marks` DOUBLE NOT NULL DEFAULT 1,
    `negativeMarks` DOUBLE NOT NULL DEFAULT 0,
    `tags` JSON NULL,
    `metadata` JSON NULL,
    `attachmentKeys` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `questions_tenantId_type_difficulty_idx`(`tenantId`, `type`, `difficulty`),
    INDEX `questions_bankId_idx`(`bankId`),
    INDEX `questions_sectionId_idx`(`sectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_options` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `questionId` VARCHAR(36) NOT NULL,
    `label` VARCHAR(20) NOT NULL,
    `content` TEXT NOT NULL,
    `isCorrect` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL DEFAULT 0,
    `metadata` JSON NULL,

    INDEX `question_options_questionId_position_idx`(`questionId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_sets` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `question_sets_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_set_items` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `setId` VARCHAR(36) NOT NULL,
    `questionId` VARCHAR(36) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `question_set_items_setId_questionId_key`(`setId`, `questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidates` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NULL,
    `candidateCode` VARCHAR(80) NOT NULL,
    `firstName` VARCHAR(120) NOT NULL,
    `lastName` VARCHAR(120) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `departmentId` VARCHAR(36) NULL,
    `branchId` VARCHAR(36) NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    `verifiedAt` DATETIME(3) NULL,
    `photoIdKey` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `candidates_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `candidates_tenantId_candidateCode_key`(`tenantId`, `candidateCode`),
    UNIQUE INDEX `candidates_tenantId_email_key`(`tenantId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidate_examinations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `candidateId` VARCHAR(36) NOT NULL,
    `examinationId` VARCHAR(36) NOT NULL,
    `eligible` BOOLEAN NOT NULL DEFAULT false,
    `eligibleAt` DATETIME(3) NULL,
    `windowStartAt` DATETIME(3) NULL,
    `windowEndAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `candidate_examinations_tenantId_eligible_idx`(`tenantId`, `eligible`),
    UNIQUE INDEX `candidate_examinations_candidateId_examinationId_key`(`candidateId`, `examinationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `examination_attempts` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `candidateId` VARCHAR(36) NOT NULL,
    `examinationId` VARCHAR(36) NOT NULL,
    `attemptNumber` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'TERMINATED', 'CANCELLED') NOT NULL DEFAULT 'NOT_STARTED',
    `startedAt` DATETIME(3) NULL,
    `serverEndAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `score` DOUBLE NULL,
    `riskScore` INTEGER NOT NULL DEFAULT 0,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `examination_attempts_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `examination_attempts_candidateId_examinationId_attemptNumber_key`(`candidateId`, `examinationId`, `attemptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidate_answers` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `attemptId` VARCHAR(36) NOT NULL,
    `questionId` VARCHAR(36) NOT NULL,
    `answer` JSON NOT NULL,
    `marksAwarded` DOUBLE NULL,
    `isCorrect` BOOLEAN NULL,
    `idempotencyKey` VARCHAR(80) NOT NULL,
    `savedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `candidate_answers_attemptId_questionId_idx`(`attemptId`, `questionId`),
    UNIQUE INDEX `candidate_answers_attemptId_idempotencyKey_key`(`attemptId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `submissions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `attemptId` VARCHAR(36) NOT NULL,
    `idempotencyKey` VARCHAR(80) NOT NULL,
    `receiptHash` VARCHAR(128) NOT NULL,
    `clientTime` DATETIME(3) NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'ACCEPTED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `submissions_attemptId_key`(`attemptId`),
    UNIQUE INDEX `submissions_tenantId_idempotencyKey_key`(`tenantId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `attemptId` VARCHAR(36) NOT NULL,
    `evaluatorId` VARCHAR(36) NULL,
    `mode` ENUM('AUTOMATIC', 'MANUAL', 'HYBRID', 'RUBRIC') NOT NULL,
    `blind` BOOLEAN NOT NULL DEFAULT false,
    `rubric` JSON NULL,
    `score` DOUBLE NULL,
    `maxScore` DOUBLE NULL,
    `feedback` TEXT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REVISION') NOT NULL DEFAULT 'PENDING',
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `evaluations_attemptId_status_idx`(`attemptId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `results` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `attemptId` VARCHAR(36) NOT NULL,
    `examinationId` VARCHAR(36) NOT NULL,
    `candidateId` VARCHAR(36) NOT NULL,
    `score` DOUBLE NOT NULL,
    `maxScore` DOUBLE NOT NULL,
    `percentage` DOUBLE NOT NULL,
    `passed` BOOLEAN NOT NULL,
    `rank` INTEGER NULL,
    `status` ENUM('PENDING', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'REVISION', 'WITHHELD') NOT NULL DEFAULT 'PENDING',
    `version` INTEGER NOT NULL DEFAULT 1,
    `publishedAt` DATETIME(3) NULL,
    `approvedBy` VARCHAR(36) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `results_tenantId_examinationId_status_idx`(`tenantId`, `examinationId`, `status`),
    UNIQUE INDEX `results_attemptId_version_key`(`attemptId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certificates` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `resultId` VARCHAR(36) NOT NULL,
    `certificateNumber` VARCHAR(80) NOT NULL,
    `pdfKey` VARCHAR(512) NULL,
    `verificationCode` VARCHAR(120) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `certificates_resultId_key`(`resultId`),
    UNIQUE INDEX `certificates_verificationCode_key`(`verificationCode`),
    INDEX `certificates_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integrations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `provider` VARCHAR(120) NOT NULL,
    `category` VARCHAR(120) NULL,
    `status` ENUM('NOT_CONNECTED', 'CONFIGURATION_PENDING', 'AUTHENTICATION_PENDING', 'VERIFICATION_PENDING', 'CONNECTED', 'SYNC_ACTIVE', 'WARNING', 'FAILED', 'SUSPENDED', 'REVOKED') NOT NULL DEFAULT 'NOT_CONNECTED',
    `authType` ENUM('API_KEY', 'OAUTH2', 'OIDC', 'SAML', 'WEBHOOK', 'BASIC', 'MTLS', 'SCIM') NOT NULL DEFAULT 'API_KEY',
    `config` JSON NULL,
    `scopes` JSON NULL,
    `ownerUserId` VARCHAR(36) NULL,
    `lastConnectedAt` DATETIME(3) NULL,
    `lastSyncAt` DATETIME(3) NULL,
    `healthStatus` ENUM('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `errorCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `integrations_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_credentials` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `integrationId` VARCHAR(36) NOT NULL,
    `keyId` VARCHAR(120) NOT NULL,
    `ciphertext` TEXT NOT NULL,
    `iv` VARCHAR(64) NOT NULL,
    `authTag` VARCHAR(64) NOT NULL,
    `algorithm` VARCHAR(40) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `rotatedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `integration_credentials_integrationId_revokedAt_idx`(`integrationId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_permissions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `integrationId` VARCHAR(36) NOT NULL,
    `permission` VARCHAR(160) NOT NULL,
    `grantedBy` VARCHAR(36) NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `integration_permissions_integrationId_permission_key`(`integrationId`, `permission`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_clients` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `clientId` VARCHAR(120) NOT NULL,
    `secretHash` TEXT NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `api_clients_clientId_key`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `clientId` VARCHAR(36) NULL,
    `prefix` VARCHAR(40) NOT NULL,
    `secretHash` TEXT NOT NULL,
    `scopes` JSON NULL,
    `expiresAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_keys_prefix_idx`(`prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_endpoints` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `integrationId` VARCHAR(36) NULL,
    `url` VARCHAR(1000) NOT NULL,
    `secretEncrypted` TEXT NOT NULL,
    `events` JSON NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `disabledAt` DATETIME(3) NULL,

    UNIQUE INDEX `webhook_endpoints_integrationId_key`(`integrationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_events` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `endpointId` VARCHAR(36) NULL,
    `integrationId` VARCHAR(36) NULL,
    `eventType` VARCHAR(120) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastAttemptAt` DATETIME(3) NULL,
    `nextAttemptAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `webhook_events_tenantId_status_nextAttemptAt_idx`(`tenantId`, `status`, `nextAttemptAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `actorUserId` VARCHAR(36) NULL,
    `actorEmail` VARCHAR(320) NULL,
    `action` VARCHAR(160) NOT NULL,
    `resourceType` VARCHAR(120) NOT NULL,
    `resourceId` VARCHAR(120) NULL,
    `previousValues` JSON NULL,
    `newValues` JSON NULL,
    `outcome` ENUM('SUCCESS', 'FAILURE', 'DENIED', 'ERROR') NOT NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` TEXT NULL,
    `sessionId` VARCHAR(36) NULL,
    `correlationId` VARCHAR(120) NULL,
    `requestId` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `audit_logs_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    INDEX `audit_logs_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `security_alerts` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `severity` ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    `category` VARCHAR(120) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `source` VARCHAR(160) NULL,
    `evidenceRef` VARCHAR(512) NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'OPEN',
    `assignedTo` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `security_alerts_tenantId_severity_status_idx`(`tenantId`, `severity`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `security_incidents` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `alertId` VARCHAR(36) NULL,
    `severity` ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    `classification` VARCHAR(120) NOT NULL,
    `status` ENUM('OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED', 'FALSE_POSITIVE') NOT NULL DEFAULT 'OPEN',
    `assignedTo` VARCHAR(36) NULL,
    `notes` TEXT NULL,
    `responseActions` JSON NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `security_incidents_tenantId_status_severity_idx`(`tenantId`, `status`, `severity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `examination_security_events` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `attemptId` VARCHAR(36) NOT NULL,
    `eventType` VARCHAR(120) NOT NULL,
    `category` VARCHAR(120) NOT NULL,
    `severity` ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL,
    `evidence` JSON NULL,
    `clientTime` DATETIME(3) NULL,
    `serverTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `riskWeight` DOUBLE NOT NULL DEFAULT 0,
    `investigated` BOOLEAN NOT NULL DEFAULT false,

    INDEX `examination_security_events_attemptId_serverTime_idx`(`attemptId`, `serverTime`),
    INDEX `examination_security_events_tenantId_eventType_serverTime_idx`(`tenantId`, `eventType`, `serverTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_assessments` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `attemptId` VARCHAR(36) NOT NULL,
    `score` INTEGER NOT NULL,
    `level` ENUM('NORMAL', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL') NOT NULL,
    `rules` JSON NULL,
    `modelVersion` VARCHAR(60) NULL,
    `reviewedBy` VARCHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `appealStatus` VARCHAR(40) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `risk_assessments_attemptId_createdAt_idx`(`attemptId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_registrations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NULL,
    `candidateId` VARCHAR(36) NULL,
    `deviceId` VARCHAR(200) NOT NULL,
    `platform` VARCHAR(60) NULL,
    `model` VARCHAR(160) NULL,
    `osVersion` VARCHAR(120) NULL,
    `clientVersion` VARCHAR(60) NULL,
    `integrityStatus` VARCHAR(60) NOT NULL DEFAULT 'UNKNOWN',
    `publicKey` TEXT NULL,
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `device_registrations_tenantId_deviceId_key`(`tenantId`, `deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exam_sessions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `attemptId` VARCHAR(36) NOT NULL,
    `deviceId` VARCHAR(36) NULL,
    `sessionTokenHash` TEXT NOT NULL,
    `securityProfile` ENUM('STANDARD_BROWSER', 'ENHANCED_MONITORING', 'SECURE_EXAM_BROWSER', 'ANDROID_KIOSK', 'APPLE_ASSESSMENT', 'MANAGED_DEVICE') NOT NULL DEFAULT 'STANDARD_BROWSER',
    `secureClientVersion` VARCHAR(60) NULL,
    `heartbeatAt` DATETIME(3) NULL,
    `disconnectedAt` DATETIME(3) NULL,
    `terminatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `exam_sessions_attemptId_key`(`attemptId`),
    INDEX `exam_sessions_tenantId_heartbeatAt_idx`(`tenantId`, `heartbeatAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_templates` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `key` VARCHAR(160) NOT NULL,
    `channel` ENUM('EMAIL', 'SMS', 'IN_APP', 'WEBHOOK', 'PUSH') NOT NULL,
    `subject` VARCHAR(300) NULL,
    `body` TEXT NOT NULL,
    `variables` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notification_templates_tenantId_key_channel_key`(`tenantId`, `key`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `userId` VARCHAR(36) NULL,
    `candidateId` VARCHAR(36) NULL,
    `channel` ENUM('EMAIL', 'SMS', 'IN_APP', 'WEBHOOK', 'PUSH') NOT NULL,
    `templateKey` VARCHAR(160) NULL,
    `recipient` VARCHAR(320) NOT NULL,
    `subject` VARCHAR(300) NULL,
    `body` TEXT NOT NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    `providerMessageId` VARCHAR(200) NULL,
    `sentAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `notifications_userId_readAt_idx`(`userId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `plan` VARCHAR(80) NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'TRIAL',
    `seats` INTEGER NULL,
    `billingCycle` VARCHAR(40) NOT NULL DEFAULT 'MONTHLY',
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endDate` DATETIME(3) NULL,
    `trialEndsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscriptions_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `subscriptionId` VARCHAR(36) NULL,
    `provider` VARCHAR(80) NOT NULL,
    `providerReference` VARCHAR(200) NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'INR',
    `status` VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `file_objects` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `objectKey` VARCHAR(512) NOT NULL,
    `bucket` VARCHAR(160) NOT NULL,
    `mimeType` VARCHAR(160) NOT NULL,
    `sizeBytes` BIGINT NOT NULL,
    `checksum` VARCHAR(128) NULL,
    `purpose` VARCHAR(80) NOT NULL,
    `uploadedBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `file_objects_tenantId_purpose_idx`(`tenantId`, `purpose`),
    UNIQUE INDEX `file_objects_bucket_objectKey_key`(`bucket`, `objectKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_health_events` (
    `id` VARCHAR(36) NOT NULL,
    `component` VARCHAR(120) NOT NULL,
    `status` ENUM('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN') NOT NULL,
    `latencyMs` INTEGER NULL,
    `details` JSON NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `system_health_events_component_detectedAt_idx`(`component`, `detectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `organisation_verifications` ADD CONSTRAINT `organisation_verifications_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organisation_memberships` ADD CONSTRAINT `organisation_memberships_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organisation_memberships` ADD CONSTRAINT `organisation_memberships_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `authentication_events` ADD CONSTRAINT `authentication_events_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mfa_methods` ADD CONSTRAINT `mfa_methods_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recovery_codes` ADD CONSTRAINT `recovery_codes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `super_admin_credentials` ADD CONSTRAINT `super_admin_credentials_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `branches` ADD CONSTRAINT `branches_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `examinations` ADD CONSTRAINT `examinations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `examinations` ADD CONSTRAINT `examinations_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `examination_versions` ADD CONSTRAINT `examination_versions_examinationId_fkey` FOREIGN KEY (`examinationId`) REFERENCES `examinations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `examination_sections` ADD CONSTRAINT `examination_sections_examinationId_fkey` FOREIGN KEY (`examinationId`) REFERENCES `examinations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `examination_security_policies` ADD CONSTRAINT `examination_security_policies_examinationId_fkey` FOREIGN KEY (`examinationId`) REFERENCES `examinations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_banks` ADD CONSTRAINT `question_banks_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_bankId_fkey` FOREIGN KEY (`bankId`) REFERENCES `question_banks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_sectionId_fkey` FOREIGN KEY (`sectionId`) REFERENCES `examination_sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_options` ADD CONSTRAINT `question_options_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_sets` ADD CONSTRAINT `question_sets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_set_items` ADD CONSTRAINT `question_set_items_setId_fkey` FOREIGN KEY (`setId`) REFERENCES `question_sets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_set_items` ADD CONSTRAINT `question_set_items_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidate_examinations` ADD CONSTRAINT `candidate_examinations_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidate_examinations` ADD CONSTRAINT `candidate_examinations_examinationId_fkey` FOREIGN KEY (`examinationId`) REFERENCES `examinations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `examination_attempts` ADD CONSTRAINT `examination_attempts_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `examination_attempts` ADD CONSTRAINT `examination_attempts_examinationId_fkey` FOREIGN KEY (`examinationId`) REFERENCES `examinations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidate_answers` ADD CONSTRAINT `candidate_answers_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `examination_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidate_answers` ADD CONSTRAINT `candidate_answers_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `examination_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluations` ADD CONSTRAINT `evaluations_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `examination_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluations` ADD CONSTRAINT `evaluations_evaluatorId_fkey` FOREIGN KEY (`evaluatorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `results` ADD CONSTRAINT `results_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `examination_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `results` ADD CONSTRAINT `results_examinationId_fkey` FOREIGN KEY (`examinationId`) REFERENCES `examinations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `results` ADD CONSTRAINT `results_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_resultId_fkey` FOREIGN KEY (`resultId`) REFERENCES `results`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integrations` ADD CONSTRAINT `integrations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_credentials` ADD CONSTRAINT `integration_credentials_integrationId_fkey` FOREIGN KEY (`integrationId`) REFERENCES `integrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_permissions` ADD CONSTRAINT `integration_permissions_integrationId_fkey` FOREIGN KEY (`integrationId`) REFERENCES `integrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `integration_permissions` ADD CONSTRAINT `integration_permissions_grantedBy_fkey` FOREIGN KEY (`grantedBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_clients` ADD CONSTRAINT `api_clients_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_clients` ADD CONSTRAINT `api_clients_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `api_clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_endpoints` ADD CONSTRAINT `webhook_endpoints_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_endpoints` ADD CONSTRAINT `webhook_endpoints_integrationId_fkey` FOREIGN KEY (`integrationId`) REFERENCES `integrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_events` ADD CONSTRAINT `webhook_events_endpointId_fkey` FOREIGN KEY (`endpointId`) REFERENCES `webhook_endpoints`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_events` ADD CONSTRAINT `webhook_events_integrationId_fkey` FOREIGN KEY (`integrationId`) REFERENCES `integrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_alerts` ADD CONSTRAINT `security_alerts_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_incidents` ADD CONSTRAINT `security_incidents_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `security_incidents` ADD CONSTRAINT `security_incidents_alertId_fkey` FOREIGN KEY (`alertId`) REFERENCES `security_alerts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `examination_security_events` ADD CONSTRAINT `examination_security_events_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `examination_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_assessments` ADD CONSTRAINT `risk_assessments_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `examination_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_registrations` ADD CONSTRAINT `device_registrations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_registrations` ADD CONSTRAINT `device_registrations_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `candidates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_sessions` ADD CONSTRAINT `exam_sessions_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `examination_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exam_sessions` ADD CONSTRAINT `exam_sessions_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `device_registrations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `candidates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_objects` ADD CONSTRAINT `file_objects_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

