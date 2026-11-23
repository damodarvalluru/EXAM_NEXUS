-- Exam integrity hardening.
-- Additive/safe for TiDB Cloud: no unrelated rows are removed and only duplicate
-- answers (same attempt + question) are deduplicated before the unique index.
--
-- `contentHash` was added by an earlier failed attempt at this migration and is
-- therefore added conditionally. All other statements are applied exactly once.
SET @has_content_hash := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'examination_versions' AND COLUMN_NAME = 'contentHash'
);
SET @add_content_hash := IF(
  @has_content_hash = 0,
  'ALTER TABLE `examination_versions` ADD COLUMN `contentHash` VARCHAR(128) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @add_content_hash;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Frozen snapshot metadata and the attempt -> published version binding.
ALTER TABLE `examination_attempts`
  ADD COLUMN `versionId` VARCHAR(36) NULL;

-- Original receipt is persisted so idempotent retries never return live values.
ALTER TABLE `submissions`
  ADD COLUMN `receipt` JSON NULL;

-- Published versions created before this migration stored only question IDs.
-- Recover their frozen question data from the current rows where possible.
UPDATE `examination_versions`
SET `snapshot` = JSON_SET(`snapshot`, '$.questions', JSON_ARRAY())
WHERE `publishedAt` IS NOT NULL AND JSON_EXTRACT(`snapshot`, '$.questions') IS NULL;

UPDATE `examination_versions` ev
INNER JOIN (
  SELECT
    v.id AS versionId,
    JSON_ARRAYAGG(
      JSON_OBJECT(
        'id', q.id,
        'sectionId', q.sectionId,
        'type', q.type,
        'prompt', q.prompt,
        'marks', q.marks,
        'negativeMarks', q.negativeMarks,
        'difficulty', q.difficulty,
        'expectedAnswer', CASE
          WHEN q.type = 'FILL_BLANK'
            THEN LOWER(TRIM(COALESCE((
              SELECT o2.content FROM `question_options` o2
              WHERE o2.questionId = q.id AND o2.tenantId = q.tenantId AND o2.isCorrect = 1
              LIMIT 1
            ), '')))
          ELSE NULL
        END,
        'options', COALESCE((
          SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'id', o.id,
            'label', o.label,
            'content', o.content,
            'position', o.position,
            'isCorrect', JSON_EXTRACT(IF(o.isCorrect = 1, 'true', 'false'), '$')
          ))
          FROM `question_options` o
          WHERE o.questionId = q.id AND o.tenantId = q.tenantId
        ), JSON_ARRAY()),
        'questionHash', ''
      )
    ) AS questionsJson
  FROM `examination_versions` v
  INNER JOIN `examination_sections` s ON s.examinationId = v.examinationId AND s.tenantId = v.tenantId
  INNER JOIN `question_sets` qs
    ON qs.tenantId = v.tenantId
   AND qs.name = CONCAT('exam:', v.examinationId, ':section:', s.id)
  INNER JOIN `question_set_items` qsi ON qsi.setId = qs.id AND qsi.tenantId = v.tenantId
  INNER JOIN `questions` q ON q.id = qsi.questionId AND q.tenantId = v.tenantId
  WHERE v.publishedAt IS NOT NULL
  GROUP BY v.id
) backfill ON backfill.versionId = ev.id
SET ev.snapshot = JSON_SET(ev.snapshot, '$.questions', backfill.questionsJson),
    ev.contentHash = CONCAT('legacy:', MD5(CAST(backfill.questionsJson AS CHAR)));

-- Bind in-flight attempts to the version recorded in their metadata (or the
-- examination's current version) so delivery never silently follows live rows.
UPDATE `examination_attempts` a
INNER JOIN `examinations` e ON e.id = a.examinationId AND e.tenantId = a.tenantId
INNER JOIN `examination_versions` v
  ON v.examinationId = a.examinationId
 AND v.tenantId = a.tenantId
 AND v.version = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.snapshotVersion')) AS UNSIGNED), e.version)
SET a.versionId = v.id
WHERE a.versionId IS NULL;

ALTER TABLE `examination_attempts`
  ADD INDEX `examination_attempts_versionId_idx`(`versionId`);

ALTER TABLE `examination_attempts`
  ADD CONSTRAINT `examination_attempts_versionId_fkey`
  FOREIGN KEY (`versionId`) REFERENCES `examination_versions`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- One answer per question per attempt. Keep the earliest row in each duplicate
-- group; no other candidate answer data is touched.
DELETE a
FROM `candidate_answers` a
INNER JOIN `candidate_answers` keep
  ON keep.attemptId = a.attemptId
 AND keep.questionId = a.questionId
 AND (keep.createdAt < a.createdAt OR (keep.createdAt = a.createdAt AND keep.id < a.id));

ALTER TABLE `candidate_answers`
  DROP INDEX `candidate_answers_attemptId_questionId_idx`,
  ADD UNIQUE INDEX `candidate_answers_attemptId_questionId_key`(`attemptId`, `questionId`);

-- Idempotency keys are scoped to an attempt; a key reused on another attempt is
-- a different submission and must never return the first attempt's receipt.
ALTER TABLE `submissions`
  DROP INDEX `submissions_tenantId_idempotencyKey_key`,
  ADD UNIQUE INDEX `submissions_attemptId_idempotencyKey_key`(`attemptId`, `idempotencyKey`);
