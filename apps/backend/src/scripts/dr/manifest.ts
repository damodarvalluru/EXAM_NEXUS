import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BACKUP_ALGORITHM,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  decryptPayload,
  encryptPayload,
  KdfInfo,
  safeHexEqual,
  sha256Hex,
} from './crypto';
import { getTableDefinition, requireTableDefinition, TABLE_ORDER } from './metadata';
import { encodeValue } from './values';

const MAGIC = Buffer.from('EXAMNEXUS-DR-ARCHIVE\n', 'utf8');
const HEADER_LENGTH_BYTES = 4;

export interface MigrationMarker {
  readonly name: string;
  readonly finishedAt: string | null;
}

export interface BackupSchemaInfo {
  readonly provider: 'mysql';
  readonly markerSource: 'prisma_migrations' | 'unavailable';
  readonly migrations: readonly MigrationMarker[];
}

export interface TableCounts {
  readonly [table: string]: number;
}

export interface PlaintextHeader {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: typeof BACKUP_VERSION;
  readonly algorithm: typeof BACKUP_ALGORITHM;
  readonly kdf: KdfInfo;
  readonly iv: string;
  readonly authTag: string;
  readonly generatedAt: string;
  readonly tableCounts: TableCounts;
  readonly schema: BackupSchemaInfo;
}

export interface BackupRow {
  readonly [column: string]: unknown;
}

export interface BackupTable {
  readonly table: string;
  readonly rowCount: number;
  readonly columns: readonly string[];
  readonly rows: readonly BackupRow[];
}

export interface BackupManifest {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: typeof BACKUP_VERSION;
  readonly generatedAt: string;
  readonly schema: BackupSchemaInfo;
  readonly tableOrder: readonly string[];
  readonly tables: readonly BackupTable[];
  readonly counts: TableCounts;
}

export interface CreatedArchive {
  readonly archivePath: string;
  readonly sidecarPath: string;
  readonly checksum: string;
  readonly header: PlaintextHeader;
}

export interface LoadedArchive {
  readonly archivePath: string;
  readonly sidecarPath: string;
  readonly checksum: string;
  readonly header: PlaintextHeader;
  readonly manifest: BackupManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label} in backup`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label} in backup`);
  return value;
}

function requireTimestamp(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (Number.isNaN(Date.parse(text))) throw new Error(`Invalid ${label} in backup`);
  return text;
}

function requireCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label} in backup`);
  }
  return value;
}

function validateSchemaInfo(value: unknown): BackupSchemaInfo {
  const record = requireRecord(value, 'schema metadata');
  if (record.provider !== 'mysql') throw new Error('Unsupported backup schema provider');
  if (record.markerSource !== 'prisma_migrations' && record.markerSource !== 'unavailable') {
    throw new Error('Invalid schema migration marker in backup');
  }
  if (!Array.isArray(record.migrations)) throw new Error('Invalid schema migration marker in backup');
  const migrations = record.migrations.map((entry: unknown) => {
    const marker = requireRecord(entry, 'migration marker');
    const name = requireString(marker.name, 'migration name');
    const finishedAt = marker.finishedAt === null ? null : requireTimestamp(marker.finishedAt, 'migration timestamp');
    return { name, finishedAt };
  });
  return { provider: 'mysql', markerSource: record.markerSource, migrations };
}

function validateCounts(value: unknown): TableCounts {
  const record = requireRecord(value, 'table counts');
  const counts: Record<string, number> = {};
  for (const [table, count] of Object.entries(record)) {
    requireTableDefinition(table);
    counts[table] = requireCount(count, `count for table ${table}`);
  }
  return counts;
}

function countsEqual(left: TableCounts, right: TableCounts): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

export function validateHeader(value: unknown): PlaintextHeader {
  const record = requireRecord(value, 'archive header');
  if (record.format !== BACKUP_FORMAT) throw new Error('Unrecognised backup format');
  if (record.version !== BACKUP_VERSION) throw new Error('Unsupported backup version');
  if (record.algorithm !== BACKUP_ALGORITHM) throw new Error('Unsupported backup encryption algorithm');

  const kdfRecord = requireRecord(record.kdf, 'key-derivation metadata');
  if (kdfRecord.name !== 'scrypt') throw new Error('Unsupported backup key-derivation function');
  const kdf: KdfInfo = {
    name: 'scrypt',
    salt: requireString(kdfRecord.salt, 'key-derivation salt'),
    N: requireCount(kdfRecord.N, 'key-derivation N'),
    r: requireCount(kdfRecord.r, 'key-derivation r'),
    p: requireCount(kdfRecord.p, 'key-derivation p'),
    keylen: requireCount(kdfRecord.keylen, 'key-derivation length'),
    maxmem: requireCount(kdfRecord.maxmem, 'key-derivation memory'),
  };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    algorithm: BACKUP_ALGORITHM,
    kdf,
    iv: requireString(record.iv, 'initialisation vector'),
    authTag: requireString(record.authTag, 'authentication tag'),
    generatedAt: requireTimestamp(record.generatedAt, 'generation timestamp'),
    tableCounts: validateCounts(record.tableCounts),
    schema: validateSchemaInfo(record.schema),
  };
}

function validateTable(value: unknown): BackupTable {
  const record = requireRecord(value, 'table entry');
  const definition = requireTableDefinition(record.table);
  const rowCount = requireCount(record.rowCount, `row count for table ${definition.name}`);
  if (!Array.isArray(record.columns)) throw new Error('Invalid column list in backup');
  const columns = record.columns.map((column) => {
    if (typeof column !== 'string' || !definition.columns.includes(column)) {
      throw new Error('Backup references an unknown application column');
    }
    return column;
  });
  if (new Set(columns).size !== columns.length) throw new Error('Duplicate column in backup');
  if (!Array.isArray(record.rows)) throw new Error('Invalid row list in backup');
  if (record.rows.length !== rowCount) throw new Error('Row count mismatch in backup');

  const declared = new Set(columns);
  const rows = record.rows.map((row: unknown) => {
    const rowRecord = requireRecord(row, 'row');
    for (const column of Object.keys(rowRecord)) {
      if (!declared.has(column)) throw new Error('Row contains an undeclared column');
    }
    return rowRecord as BackupRow;
  });

  return { table: definition.name, rowCount, columns, rows };
}

export function validateManifest(value: unknown): BackupManifest {
  const record = requireRecord(value, 'manifest');
  if (record.format !== BACKUP_FORMAT) throw new Error('Unrecognised backup format');
  if (record.version !== BACKUP_VERSION) throw new Error('Unsupported backup version');
  const generatedAt = requireTimestamp(record.generatedAt, 'generation timestamp');
  const schema = validateSchemaInfo(record.schema);

  if (!Array.isArray(record.tableOrder)) throw new Error('Invalid table order in backup');
  const tableOrder = record.tableOrder.map((name) => requireTableDefinition(name).name);
  if (new Set(tableOrder).size !== tableOrder.length) throw new Error('Duplicate table in backup');
  const expectedOrder = TABLE_ORDER.filter((name) => tableOrder.includes(name));
  if (expectedOrder.join('|') !== tableOrder.join('|')) {
    throw new Error('Backup table order is not FK-safe');
  }

  if (!Array.isArray(record.tables)) throw new Error('Invalid table list in backup');
  const tables = record.tables.map((entry) => validateTable(entry));
  if (tables.length !== tableOrder.length) throw new Error('Backup table list is incomplete');
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for (const entry of tables) {
    if (seen.has(entry.table)) throw new Error('Duplicate table in backup');
    seen.add(entry.table);
    counts[entry.table] = entry.rowCount;
  }
  for (const name of tableOrder) {
    if (!seen.has(name)) throw new Error('Backup table list is incomplete');
  }

  const manifestCounts = validateCounts(record.counts);
  if (!countsEqual(manifestCounts, counts)) throw new Error('Manifest table counts do not match rows');

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    generatedAt,
    schema,
    tableOrder,
    tables,
    counts: manifestCounts,
  };
}

function serializeArchive(header: PlaintextHeader, ciphertext: Buffer): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  if (headerBytes.length > 0xffff_ffff) throw new Error('Backup header is too large');
  const prefix = Buffer.alloc(MAGIC.length + HEADER_LENGTH_BYTES);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(headerBytes.length, MAGIC.length);
  return Buffer.concat([prefix, headerBytes, ciphertext]);
}

function parseArchive(bytes: Buffer): { header: PlaintextHeader; ciphertext: Buffer } {
  if (bytes.length < MAGIC.length + HEADER_LENGTH_BYTES) throw new Error('Backup archive is truncated');
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unrecognised backup archive');
  const headerLength = bytes.readUInt32BE(MAGIC.length);
  const start = MAGIC.length + HEADER_LENGTH_BYTES;
  const end = start + headerLength;
  if (!Number.isSafeInteger(end) || end > bytes.length) throw new Error('Backup archive is truncated');

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.subarray(start, end).toString('utf8'));
  } catch {
    throw new Error('Backup header is not valid JSON');
  }
  return { header: validateHeader(parsed), ciphertext: bytes.subarray(end) };
}

export function buildBackupManifest(
  generatedAt: string,
  schema: BackupSchemaInfo,
  tables: readonly BackupTable[],
): BackupManifest {
  const counts: Record<string, number> = {};
  for (const entry of tables) counts[entry.table] = entry.rowCount;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    generatedAt,
    schema,
    tableOrder: TABLE_ORDER.filter((name) => name in counts),
    tables,
    counts,
  };
}

export function buildBackupTable(
  table: string,
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): BackupTable {
  const definition = requireTableDefinition(table);
  const canonicalColumns = definition.columns.filter((column) => columns.includes(column));
  return {
    table: definition.name,
    rowCount: rows.length,
    columns: canonicalColumns,
    rows: rows.map((row) => {
      const encoded: Record<string, unknown> = {};
      for (const column of canonicalColumns) encoded[column] = encodeValue(row[column]);
      return encoded;
    }),
  };
}

export async function writeArchive(backupDir: string, manifest: BackupManifest, passphrase: string): Promise<CreatedArchive> {
  const plaintext = Buffer.from(JSON.stringify(manifest), 'utf8');
  const sealed = encryptPayload(plaintext, passphrase);
  const header: PlaintextHeader = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    algorithm: BACKUP_ALGORITHM,
    kdf: sealed.kdf,
    iv: sealed.iv,
    authTag: sealed.authTag,
    generatedAt: manifest.generatedAt,
    tableCounts: manifest.counts,
    schema: manifest.schema,
  };
  const archiveBytes = serializeArchive(header, sealed.ciphertext);
  const checksum = sha256Hex(archiveBytes);
  const directory = path.resolve(backupDir);
  const stamp = manifest.generatedAt.replace(/[^0-9]/g, '').slice(0, 14);
  const archivePath = path.join(directory, `examnexus-backup-${stamp}-${Date.now().toString(36)}.enc`);
  const sidecarPath = `${archivePath}.sha256`;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(archivePath, archiveBytes, { mode: 0o600 });
  await writeFile(sidecarPath, `${checksum}  ${path.basename(archivePath)}\n`, { mode: 0o600 });
  return { archivePath, sidecarPath, checksum, header };
}

async function verifyChecksum(archivePath: string, bytes: Buffer): Promise<string> {
  const sidecarPath = `${archivePath}.sha256`;
  let sidecar: string;
  try {
    sidecar = await readFile(sidecarPath, 'utf8');
  } catch {
    throw new Error('Missing SHA-256 sidecar for archive');
  }
  const firstLine = sidecar.split(/\r?\n/, 1)[0] ?? '';
  const match = /^([a-fA-F0-9]{64})\s{2}(\S.*)$/.exec(firstLine);
  if (!match) throw new Error('Invalid SHA-256 sidecar format');
  const expected = (match[1] ?? '').toLowerCase();
  const recordedName = (match[2] ?? '').trim();
  if (recordedName !== path.basename(archivePath)) {
    throw new Error('SHA-256 sidecar refers to a different file');
  }
  const actual = sha256Hex(bytes);
  if (!safeHexEqual(expected, actual)) throw new Error('SHA-256 checksum mismatch');
  return actual;
}

export async function loadArchive(archivePath: string, passphrase: string): Promise<LoadedArchive> {
  let bytes: Buffer;
  try {
    bytes = await readFile(archivePath);
  } catch {
    throw new Error('Cannot read backup archive');
  }
  const checksum = await verifyChecksum(archivePath, bytes);
  const { header, ciphertext } = parseArchive(bytes);
  let decrypted: Buffer;
  try {
    decrypted = decryptPayload(
      { kdf: header.kdf, iv: header.iv, authTag: header.authTag, ciphertext },
      passphrase,
    );
  } catch (error) {
    throw new Error(
      `Backup decryption failed (${error instanceof Error ? error.message : 'unknown crypto error'}). ` +
        'Check BACKUP_PASSPHRASE and archive integrity.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new Error('Decrypted backup payload is not valid JSON');
  }
  const manifest = validateManifest(parsed);
  if (manifest.generatedAt !== header.generatedAt) throw new Error('Header/manifest timestamp mismatch');
  if (!countsEqual(header.tableCounts, manifest.counts)) throw new Error('Header/manifest table count mismatch');
  if (manifest.tableOrder.some((name) => !getTableDefinition(name))) {
    throw new Error('Backup references an unknown application table');
  }

  return {
    archivePath: path.resolve(archivePath),
    sidecarPath: `${archivePath}.sha256`,
    checksum,
    header,
    manifest,
  };
}

export async function findLatestArchive(backupDir: string): Promise<string> {
  const directory = path.resolve(backupDir);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new Error('Cannot read BACKUP_DIR');
  }
  let latest: { path: string; mtimeMs: number } | undefined;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.enc')) continue;
    const fullPath = path.join(directory, entry.name);
    const info = await stat(fullPath);
    if (!latest || info.mtimeMs > latest.mtimeMs) latest = { path: fullPath, mtimeMs: info.mtimeMs };
  }
  if (!latest) throw new Error('No backup archives found in BACKUP_DIR; use --file <path>');
  return latest.path;
}
