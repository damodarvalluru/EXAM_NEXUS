# Disaster recovery (DR) CLI — usage and runbook

This documents the **intended CLI contract** for the backup commands to be added to
`apps/backend` (package `@examnexus/api`). It is tooling documentation, not proof that a backup,
verification, restore or rehearsal has succeeded. **No production restore has been claimed.**

## Commands

```powershell
pnpm --filter @examnexus/api backup:create
pnpm --filter @examnexus/api backup:verify
pnpm --filter @examnexus/api backup:restore -- --file <path-to-backup>
```

- `backup:create` — writes an encrypted archive plus a checksum sidecar into `BACKUP_DIR` and prints
  the generated file path and manifest summary.
- `backup:verify` — verifies the SHA-256 checksum and decrypts the archive **in memory** using
  `BACKUP_PASSPHRASE` (no plaintext file is written). This confirms integrity and readability,
  **not restorability**. An optional `--file <path>` selects an archive; otherwise the newest
  `.enc` file in `BACKUP_DIR` is used.
- `backup:restore -- --file <path>` — restores rows into the database identified by `DATABASE_URL`.
  Treat this as destructive: run it only against a **staging database with the schema applied and no
  application rows**. There is no `--confirm` flag; set `BACKUP_RESTORE_CONFIRM=EMPTY_STAGING`
  exactly. The command refuses obvious production/live host or database names, a missing schema and
  any target that already contains application rows. The backup contains no DDL, so migrations must
  be applied to the empty target first.

## Required environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | MySQL-protocol connection string for the source database on create, or the **empty target** database on restore. Runtime uses a least-privilege user; never the cluster root/`DIRECT_URL`. |
| `BACKUP_PASSPHRASE` | Passphrase used to derive the AES-256-GCM key. Supply from a secret manager/CI secret; never commit it, log it or store it beside the archive. |
| `BACKUP_DIR` | Directory where archives and `.sha256` sidecars are written/read. Must be on durable, access-controlled storage. |
| `BACKUP_RESTORE_CONFIRM` | Must equal `EMPTY_STAGING` for `backup:restore`. This is the documented operator confirmation; the CLI has no `--confirm` flag. |

Example (PowerShell, values from your secret store — do not hard-code):

```powershell
$env:DATABASE_URL      = '<mysql://...sslaccept=strict>'
$env:BACKUP_PASSPHRASE = '<from secret manager>'
$env:BACKUP_DIR        = 'D:\examnexus-backups'
```

## Encryption, integrity and retention

- Encryption: **AES-256-GCM** with a fresh random IV and auth tag per archive. The passphrase is
  never stored in the archive or manifest. Any modification to ciphertext, IV or tag fails decrypt.
- Checksum: a `SHA-256` sidecar (`<archive>.sha256`) is produced at create time and checked by both
  `backup:verify` and `backup:restore` before any write. Compute it again with `Get-FileHash` when
  investigating a discrepancy.
- Retention (suggested baseline, confirm with the system owner): keep **7 daily**, **4 weekly**
  and **3 monthly** successful archives; never delete the newest known-good archive. Retention
  enforcement belongs to the storage lifecycle policy, not to the API process.
- Access: restrict `BACKUP_DIR` to the DR role, enable object-versioning/immutability where
  available, and monitor deletion or checksum failures.
- TiDB Cloud platform snapshots can complement these logical archives, but are a separate control
  with their own RPO/RTO. Record both in the DR register.

## Included and excluded

Included (tenant-scoped logical data and metadata):

- Schema/migration state and reference/permission/role seed metadata.
- Organisations, memberships, users (hashes only), candidates and verification records.
- Question banks, questions/options, published immutable versions and hashes.
- Examinations, eligibility, attempts, answers, submissions, results and audit records.
- Integration definitions, encrypted credential ciphertext, webhook endpoints/events, API client
  and key metadata (hashes/prefixes only).
- Platform settings, notifications, subscriptions and support tickets.

Excluded:

- Redis ephemeral state: access/refresh session caches, rate-limit counters, MFA challenges,
  webhook nonce replay set and BullMQ queue contents. These must be rebuilt after a restore.
- Plaintext secrets: credentials remain AES-256-GCM ciphertext; they are not re-encrypted with a
  new key by the backup command.
- Local file objects (verification documents, generated certificates/exports) unless a separate
  object-storage backup is configured and evidenced. Record that gap explicitly in the rehearsal.
- Application logs, metrics and browser/proctor client state.

## DR runbook — rehearsal and measurement

Perform on **staging**, never production. Record every command output under `evidence/phase-08/dr/`.

1. **Pre-flight:** record target URL/build SHA, source database identifier, current UTC time and
   the newest successful backup file plus its checksum. Confirm `BACKUP_PASSPHRASE` is available
   from the secret store.
2. **Create:** run `backup:create`; save the printed path, manifest summary and SHA-256 sidecar.
3. **Verify integrity:** run `backup:verify`; save output. A pass here is necessary but not
   sufficient — it does not prove a restore works.
4. **Prepare empty target:** create a **new** staging database and a least-privilege `DATABASE_URL`
   pointing at it. Apply the migrations to create the schema, then confirm all application tables
   exist and contain zero rows before continuing.
5. **Restore:** start the clock (`T_start`) and run `backup:restore -- --file <path>`.
6. **Bring up the app:** start the API against the restored database with the staging Redis
   instance; confirm `/health/ready` is healthy and run
   `node tests/security/smoke-checks.mjs` (expected: all checks pass, including the Phase 7/8
   module-status check).
7. **Functional spot checks:** log in as a seeded staging user, verify tenant isolation, open a
   candidate exam attempt, verify one saved answer and one submission receipt, and verify an
   encrypted integration credential still decrypts.
8. **Measure:** record `T_healthy` when `/health/ready` and the smoke checks first pass.
   - Observed **RTO** = `T_healthy − T_start` (restore start to usable service).
   - Observed **RPO** = `T_incident − T_last_successful_backup` (data loss window for a
     hypothetical incident at `T_incident`; use the rehearsal's declared incident time).
   - Record both values and compare with the agreed targets (targets: **PENDING — owner to set**).
9. **Close out:** document gaps (for example excluded file objects or queue state), assign owners,
   attach raw outputs, and record reviewer/date. Re-run the rehearsal after any backup-format
   change.

**Verification standard:** a backup is only considered restorable after step 4–7 succeed against an
**empty staging database**. `backup:verify` alone is not enough. No production database has been
restored or tested as part of this documentation, and no RPO/RTO figures are claimed until a
rehearsal is actually executed and recorded.
