import { Prisma, PrismaClient } from '@prisma/client';
import { MigrationMarker } from './manifest';
import { quoteIdentifier } from './metadata';

const MIGRATIONS_TABLE = '_prisma_migrations';

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** Explicitly binds Prisma to DATABASE_URL; DIRECT_URL is never read. */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: requiredEnv('DATABASE_URL') } } });
}

const RESTORE_CONFIRM_VALUE = 'EMPTY_STAGING';

export const RESTORE_SAFETY_NOTICE = [
  'Restore safety requirements:',
  `  1. BACKUP_RESTORE_CONFIRM=${RESTORE_CONFIRM_VALUE} must be set exactly (the documented contract has no --confirm flag).`,
  '  2. DATABASE_URL must point to a staging database with the schema applied and no application rows.',
  '  3. Obvious production/live hosts or database names are refused automatically.',
  '  The runtime uses DATABASE_URL only; DIRECT_URL is never used.',
].join('\n');

export function assertRestoreConfirmation(): void {
  if (process.env.BACKUP_RESTORE_CONFIRM !== RESTORE_CONFIRM_VALUE) {
    throw new Error(
      `Refusing restore: set BACKUP_RESTORE_CONFIRM=${RESTORE_CONFIRM_VALUE} before running this command. ` +
        'The documented CLI has no --confirm flag, so this environment variable is the explicit operator confirmation.',
    );
  }
}

/** Cheap guard only; it is not a substitute for operator confirmation. Never logs the URL. */
export function guardRestoreTarget(): void {
  let parsed: URL;
  try {
    parsed = new URL(requiredEnv('DATABASE_URL'));
  } catch {
    throw new Error('Refusing restore: DATABASE_URL is not a valid connection URL');
  }
  if (parsed.protocol !== 'mysql:') {
    throw new Error('Refusing restore: DATABASE_URL must use the mysql protocol');
  }
  const host = parsed.hostname.toLowerCase();
  let database = '';
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase();
  } catch {
    throw new Error('Refusing restore: DATABASE_URL contains an invalid database name');
  }
  const suspicious = ['prod', 'live'];
  if (suspicious.some((word) => host.includes(word) || database.includes(word))) {
    throw new Error(
      'Refusing restore: DATABASE_URL host or database name looks like production/live. ' +
        `Use a dedicated empty staging database and set BACKUP_RESTORE_CONFIRM=${RESTORE_CONFIRM_VALUE} only for staging.`,
    );
  }
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function readMigrationMarker(prisma: PrismaClient): Promise<{
  markerSource: 'prisma_migrations' | 'unavailable';
  migrations: MigrationMarker[];
}> {
  const exists = await prisma.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
    SELECT TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${MIGRATIONS_TABLE}
  `);
  if (exists.length === 0) return { markerSource: 'unavailable', migrations: [] };

  const rows = await prisma.$queryRaw<Array<{ migrationName: string; finishedAt: Date | string | null }>>(Prisma.sql`
    SELECT migration_name AS migrationName, finished_at AS finishedAt
    FROM ${Prisma.raw(quoteIdentifier(MIGRATIONS_TABLE))}
    ORDER BY finished_at
  `);
  return {
    markerSource: 'prisma_migrations',
    migrations: rows.map((row) => ({ name: String(row.migrationName), finishedAt: toIsoOrNull(row.finishedAt) })),
  };
}

/**
 * The backup contains rows but no DDL, so the target must already have the schema applied.
 * Reject a target that is missing allowlisted tables or that contains any application rows.
 */
export async function assertEmptyApplicationSchema(
  prisma: PrismaClient,
  tableNames: readonly string[],
): Promise<void> {
  if (tableNames.length === 0) throw new Error('Backup contains no application tables');
  const rows = await prisma.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
    SELECT TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join(tableNames)})
  `);
  const existing = new Set(rows.map((row) => String(row.tableName)));
  const missing = tableNames.filter((name) => !existing.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Refusing restore: target schema is missing ${missing.length} application table(s) ` +
        `(${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}). ` +
        'Apply the migrations to the empty target before restoring.',
    );
  }

  const nonEmpty: string[] = [];
  for (const name of tableNames) {
    const counts = await prisma.$queryRaw<Array<{ rowCount: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS rowCount FROM ${Prisma.raw(quoteIdentifier(name))}
    `);
    if (Number(counts[0]?.rowCount ?? 0) > 0) nonEmpty.push(name);
  }
  if (nonEmpty.length > 0) {
    throw new Error(
      `Refusing restore: target database already contains rows in ${nonEmpty.length} application ` +
        `table(s) (${nonEmpty.slice(0, 10).join(', ')}${nonEmpty.length > 10 ? ', …' : ''}). ` +
        'Use a new, empty staging database.',
    );
  }
}
