/** Small shared CLI helpers; no secrets or URL values are ever printed. */

export function parseFileArg(
  argv: readonly string[],
  usage: string,
  required: boolean,
): string | undefined {
  let file: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file') {
      if (file !== undefined) throw new Error(`Duplicate --file argument. Usage: ${usage}`);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --file. Usage: ${usage}`);
      file = value;
      index += 1;
    } else if (argument.startsWith('--file=')) {
      if (file !== undefined) throw new Error(`Duplicate --file argument. Usage: ${usage}`);
      const value = argument.slice('--file='.length);
      if (!value) throw new Error(`Missing value for --file. Usage: ${usage}`);
      file = value;
    } else {
      throw new Error(`Unexpected argument '${argument}'. Usage: ${usage}`);
    }
  }
  if (required && file === undefined) throw new Error(`Missing --file <path>. Usage: ${usage}`);
  return file;
}

export function printJson(value: Record<string, unknown>): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Defensive redaction in case a dependency echoes credentials in an error. */
function redact(message: string): string {
  let result = message;
  const passphrase = process.env.BACKUP_PASSPHRASE?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (passphrase && passphrase.length >= 4) result = result.split(passphrase).join('[REDACTED]');
  if (databaseUrl && databaseUrl.length >= 4) result = result.split(databaseUrl).join('[REDACTED]');
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      for (const part of [parsed.password, parsed.username]) {
        if (part && part.length >= 4) result = result.split(part).join('[REDACTED]');
      }
    } catch {
      // Ignore malformed URLs here; guardRestoreTarget reports those.
    }
  }
  return result;
}

export function fail(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${label} ${redact(message)}`);
  process.exitCode = 1;
}
