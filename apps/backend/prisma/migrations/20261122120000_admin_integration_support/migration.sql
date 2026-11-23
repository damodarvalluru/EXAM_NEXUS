-- Platform administration tables introduced in Phases 5 and 6.
-- Additive only: no existing table or column is modified.

-- CreateTable
CREATE TABLE `support_tickets` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `subject` VARCHAR(300) NOT NULL,
    `category` VARCHAR(80) NOT NULL,
    `priority` VARCHAR(40) NOT NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'OPEN',
    `requesterEmail` VARCHAR(320) NOT NULL,
    `body` TEXT NOT NULL,
    `assignee` VARCHAR(36) NULL,
    `resolution` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `support_tickets_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_settings` (
    `key` VARCHAR(160) NOT NULL,
    `value` JSON NOT NULL,
    `description` TEXT NULL,
    `updatedBy` VARCHAR(36) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_request_logs` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `clientId` VARCHAR(36) NULL,
    `method` VARCHAR(10) NOT NULL,
    `path` VARCHAR(500) NOT NULL,
    `statusCode` INTEGER NOT NULL,
    `outcome` VARCHAR(40) NOT NULL,
    `latencyMs` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_request_logs_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `api_request_logs_createdAt_outcome_idx`(`createdAt`, `outcome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `organisations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
