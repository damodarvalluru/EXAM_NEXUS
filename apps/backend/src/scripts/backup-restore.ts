import { Prisma } from '@prisma/client';
import { fail, parseFileArg, printJson } from './dr/cli';
import {
  assertEmptyApplicationSchema,
  assertRestoreConfirmation,
  createPrismaClient,
  guardRestoreTarget,
  requiredEnv,
  RESTORE_SAFETY_NOTICE,
} from './dr/database';
import { loadArchive } from './dr/manifest';
import { allowedColumnsInOrder, quoteIdentifier, TABLE_ORDER } from './dr/metadata';
import { decodeValue, toSqlScalar } from './dr/values';

const USAGE = 'pnpm --filter @examnexus/api backup:restore -- --file <path-to-backup>';

async function main(): Promise<void> {
  console.log(RESTORE_SAFETY_NOTICE);
  const file = parseFileArg(process.argv.slice(2), USAGE, true);
  if (file === undefined) throw new Error(`Missing --file <path>. Usage: ${USAGE}`);
  assertRestoreConfirmation();
  guardRestoreTarget();
  const passphrase = requiredEnv('BACKUP_PASSPHRASE');

  const archive = await loadArchive(file, passphrase);
  const prisma = createPrismaClient();
  const restoredCounts: Record<string, number> = {};

  try {
    // Superset of the manifest: require the schema but refuse any existing application rows.
    const knownTables = [...new Set([...TABLE_ORDER, ...archive.manifest.tableOrder])];
    await assertEmptyApplicationSchema(prisma, knownTables);

    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SET FOREIGN_KEY_CHECKS = 0`);
        try {
          for (const entry of archive.manifest.tables) {
            const columns = allowedColumnsInOrder(entry.table, entry.columns);
            if (columns.length === 0) throw new Error('Backup table has no allowlisted columns');
            const columnList = columns.map((column) => quoteIdentifier(column)).join(', ');
            const table = quoteIdentifier(entry.table);

            for (const row of entry.rows) {
              const values = columns.map((column) => toSqlScalar(decodeValue(row[column])));
              await tx.$executeRaw(Prisma.sql`
                INSERT INTO ${Prisma.raw(table)} (${Prisma.raw(columnList)})
                VALUES (${Prisma.join(values)})
              `);
            }
            restoredCounts[entry.table] = entry.rows.length;
          }
        } finally {
          // Session-scoped: always reset, even on failure.
          await tx.$executeRaw(Prisma.sql`SET FOREIGN_KEY_CHECKS = 1`);
        }
      },
      { maxWait: 10_000, timeout: 600_000 },
    );

    const totalRows = Object.values(restoredCounts).reduce((sum, count) => sum + count, 0);
    printJson({
      message:
        'RESTORE COMPLETE — rows were inserted into the empty target database. ' +
        'This command did not start the API or run health, smoke or functional checks.',
      archive: archive.archivePath,
      checksum: archive.checksum,
      generatedAt: archive.header.generatedAt,
      schemaMarker: archive.header.schema,
      restoredTables: Object.keys(restoredCounts).length,
      totalRows,
      restoredCounts,
      postRestoreSteps: [
        'Confirm the target schema matches the manifest migration marker; run `pnpm --filter @examnexus/api prisma:migrate:deploy` only if required.',
        'Start the API against the restored database and staging Redis, then confirm /health/ready.',
        'Run `node tests/security/smoke-checks.mjs` and the documented functional spot checks (tenant isolation, saved answer, submission, encrypted credential).',
        'Rebuild excluded state: Redis sessions/rate limits/MFA challenges, webhook nonce set, BullMQ queues and any local file objects.',
        'Record T_start and T_healthy to calculate observed RTO; no RPO/RTO figures are claimed by this command.',
      ],
      note: 'No passphrase, connection URL or row contents were logged.',
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => fail('RESTORE FAILED —', error));
