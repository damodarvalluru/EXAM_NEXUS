export interface CsvRow {
  line: number;
  values: string[];
}

/** Small RFC-4180-style parser: quoted fields, escaped quotes, CRLF and BOM. */
export function parseCsv(text: string, delimiter = ','): CsvRow[] {
  const rows: CsvRow[] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let line = 1;

  const pushField = (): void => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    if (row.some((value) => value.length > 0)) rows.push({ line, values: row });
    row = [];
  };

  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === '\n') {
      pushRow();
      line += 1;
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (field.length || row.length) pushRow();
  return rows;
}

export interface CandidateImportRecord {
  candidateCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

export interface NormalisedCsv {
  records: CandidateImportRecord[];
  errors: string[];
}

const DEFAULT_MAPPING: Record<string, string> = {
  candidateCode: 'candidateCode',
  firstName: 'firstName',
  lastName: 'lastName',
  email: 'email',
  phone: 'phone',
};

/** Map CSV headers to candidate fields and validate every row before any write. */
export function normaliseCandidateCsv(rows: CsvRow[], mapping: Record<string, string> = {}): NormalisedCsv {
  if (!rows.length) throw new Error('CSV file is empty');
  const headers = rows[0]!.values;
  const effective = { ...DEFAULT_MAPPING, ...mapping };
  const columnIndex = new Map<string, number>();
  for (const [target, source] of Object.entries(effective)) {
    const index = headers.findIndex((header) => header.toLowerCase() === source.toLowerCase());
    if (index >= 0) columnIndex.set(target, index);
  }
  if (!columnIndex.has('candidateCode') || !columnIndex.has('email')) {
    throw new Error('CSV must contain candidateCode and email columns');
  }

  const records: CandidateImportRecord[] = [];
  const errors: string[] = [];
  for (const row of rows.slice(1)) {
    const value = (target: string): string => {
      const index = columnIndex.get(target);
      return index === undefined ? '' : (row.values[index] ?? '').trim();
    };
    const candidateCode = value('candidateCode');
    const email = value('email').toLowerCase();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!candidateCode || !validEmail) {
      errors.push(`Line ${row.line}: invalid candidateCode or email`);
      continue;
    }
    records.push({
      candidateCode,
      firstName: value('firstName') || 'Unknown',
      lastName: value('lastName') || 'Candidate',
      email,
      phone: value('phone') || null,
    });
  }
  return { records, errors };
}
