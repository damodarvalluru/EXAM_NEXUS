-- Phase 7: per-question evaluation records and indexes used by advanced
-- reporting, proctoring review and certificate lookups.
ALTER TABLE `evaluations` ADD COLUMN `questionId` VARCHAR(36) NULL;
CREATE INDEX `evaluations_attempt_question_status_idx` ON `evaluations`(`attemptId`, `questionId`, `status`);

CREATE INDEX `results_tenant_examination_status_idx` ON `results`(`tenantId`, `examinationId`, `status`);
CREATE INDEX `certificates_tenant_issued_idx` ON `certificates`(`tenantId`, `issuedAt`);
CREATE INDEX `examination_security_events_tenant_severity_idx` ON `examination_security_events`(`tenantId`, `severity`, `serverTime`);
CREATE INDEX `risk_assessments_tenant_created_idx` ON `risk_assessments`(`tenantId`, `createdAt`);

-- New permission catalogue keys. The application seed service keeps these
-- rows up to date on every boot; the fixed ids make this migration idempotent.
INSERT IGNORE INTO `permissions` (`id`, `key`, `description`, `category`, `createdAt`) VALUES
  ('00000000-0000-4000-8000-000000000501', 'org.evaluation.manage', 'Review subjective answers and approve computed suggestions', 'organisation', NOW()),
  ('00000000-0000-4000-8000-000000000502', 'org.reports.read', 'View and export organisation examination analytics', 'organisation', NOW()),
  ('00000000-0000-4000-8000-000000000503', 'org.proctoring.read', 'Review proctoring events and risk assessments', 'organisation', NOW()),
  ('00000000-0000-4000-8000-000000000504', 'org.certificates.manage', 'Issue, verify and revoke certificates', 'organisation', NOW());

-- Grant the new permissions to existing system roles, mirroring
-- TENANT_ROLE_PERMISSIONS in packages/shared/src/permissions.ts.
INSERT IGNORE INTO `role_permissions` (`id`, `tenantId`, `roleId`, `permissionId`)
SELECT UUID(), r.`tenantId`, r.`id`, p.`id`
FROM `roles` r
JOIN `permissions` p ON p.`key` IN ('org.evaluation.manage', 'org.reports.read', 'org.proctoring.read', 'org.certificates.manage')
WHERE r.`isSystem` = 1 AND r.`name` = 'ORG_ADMIN';

INSERT IGNORE INTO `role_permissions` (`id`, `tenantId`, `roleId`, `permissionId`)
SELECT UUID(), r.`tenantId`, r.`id`, p.`id`
FROM `roles` r
JOIN `permissions` p ON p.`key` IN ('org.reports.read', 'org.proctoring.read')
WHERE r.`isSystem` = 1 AND r.`name` = 'EXAM_ADMIN';

INSERT IGNORE INTO `role_permissions` (`id`, `tenantId`, `roleId`, `permissionId`)
SELECT UUID(), r.`tenantId`, r.`id`, p.`id`
FROM `roles` r
JOIN `permissions` p ON p.`key` = 'org.proctoring.read'
WHERE r.`isSystem` = 1 AND r.`name` = 'INVIGILATOR';

INSERT IGNORE INTO `role_permissions` (`id`, `tenantId`, `roleId`, `permissionId`)
SELECT UUID(), r.`tenantId`, r.`id`, p.`id`
FROM `roles` r
JOIN `permissions` p ON p.`key` = 'org.evaluation.manage'
WHERE r.`isSystem` = 1 AND r.`name` = 'EVALUATOR';
