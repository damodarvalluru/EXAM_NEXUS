import { Prisma } from '@prisma/client';
import { fail, printJson } from './dr/cli';
import { createPrismaClient, readMigrationMarker, requiredEnv } from './dr/database';
import { BackupTable, buildBackupManifest, buildBackupTable, writeArchive } from './dr/manifest';
import { quoteIdentifier, requireTableDefinition, TABLE_ORDER } from './dr/metadata';

async function main(): Promise<void> {
  const passphrase = requiredEnv('BACKUP_PASSPHRASE');
  const backupDir = requiredEnv('BACKUP_DIR');
  const generatedAt = new Date().toISOString();
  const prisma = createPrismaClient();

  try {
    const schema = { provider: 'mysql' as const, ...(await readMigrationMarker(prisma)) };
    const tables: BackupTable[] = [];
    // Repeatable read keeps all application tables on one consistent snapshot.
    await prisma.$transaction(
      async (tx) => {
        for (const name of TABLE_ORDER) {
          const definition = requireTableDefinition(name);
          const rows = await tx.$queryRaw<Record<string, unknown>[]>(
            Prisma.sql`SELECT * FROM ${Prisma.raw(quoteIdentifier(name))}`,
          );
          const columns = new Set<string>();
          for (const row of rows) {
            for (const column of Object.keys(row)) {
              if (!definition.columns.includes(column)) {
                throw new Error(`Unexpected column in source table ${name}; backup aborted`);
              }
              columns.add(column);
            }
          }
          const exportColumns = columns.size > 0 ? [...columns] : [...definition.columns];
          tables.push(buildBackupTable(name, rows, exportColumns));
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 600_000,
      },
    );

    const manifest = buildBackupManifest(generatedAt, schema, tables);
    const result = await writeArchive(backupDir, manifest, passphrase);
    const totalRows = tables.reduce((sum, entry) => sum + entry.rowCount, 0);

    printJson({
      message: 'Encrypted logical backup created. No restore or rehearsal was performed.',
      archive: result.archivePath,
      sidecar: result.sidecarPath,
      checksum: result.checksum,
      manifest: {
        format: result.header.format,
        version: result.header.version,
        algorithm: result.header.algorithm,
        kdf: {
          name: result.header.kdf.name,
          N: result.header.kdf.N,
          r: result.header.kdf.r,
          p: result.header.kdf.p,
          keylen: result.header.kdf.keylen,
        },
        generatedAt: result.header.generatedAt,
        schema: result.header.schema,
        tableCount: tables.length,
        totalRows,
        tableCounts: result.header.tableCounts,
      },
      note:
        'The archive header (crypto parameters and table counts) is plaintext; all rows are AES-256-GCM encrypted. ' +
        'No passphrase, connection URL or row contents were logged.',
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => fail('BACKUP CREATE FAILED —', error));
