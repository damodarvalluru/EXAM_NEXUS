import { parseFileArg, printJson, fail } from './dr/cli';
import { requiredEnv } from './dr/database';
import { findLatestArchive, loadArchive } from './dr/manifest';

const USAGE = 'pnpm --filter @examnexus/api backup:verify [--file <path-to-backup>]';

async function main(): Promise<void> {
  const file = parseFileArg(process.argv.slice(2), USAGE, false);
  const passphrase = requiredEnv('BACKUP_PASSPHRASE');
  const archivePath = file ?? (await findLatestArchive(requiredEnv('BACKUP_DIR')));
  const archive = await loadArchive(archivePath, passphrase);
  const totalRows = Object.values(archive.manifest.counts).reduce((sum, count) => sum + count, 0);

  console.log('PASS — checksum, plaintext header, structure, version, table counts and AES-256-GCM decryption verified.');
  console.log('This confirms integrity and readability only. It does NOT claim restorability or that a restore was performed.');
  printJson({
    archive: archive.archivePath,
    checksum: archive.checksum,
    format: archive.header.format,
    version: archive.header.version,
    algorithm: archive.header.algorithm,
    generatedAt: archive.header.generatedAt,
    tableCount: archive.manifest.tables.length,
    totalRows,
    tableCounts: archive.manifest.counts,
    schema: archive.header.schema,
  });
}

main().catch((error: unknown) => fail('FAIL — backup verification failed:', error));
