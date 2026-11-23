import { createHash } from 'node:crypto';
import type { QuestionType } from '@examnexus/shared';

export interface GradeableOption {
  id: string;
  label: string;
  content: string;
  isCorrect: boolean;
}

/** Frozen option stored in a published version snapshot; never sent to FILL_BLANK candidates. */
export interface SnapshotOption extends GradeableOption {
  position: number;
}

/** A question frozen into an ExaminationVersion snapshot at publish time. */
export interface SnapshotQuestion {
  id: string;
  sectionId: string | null;
  type: QuestionType;
  prompt: string;
  marks: number;
  negativeMarks: number;
  difficulty: string;
  options: SnapshotOption[];
  /** Hidden comparison value for FILL_BLANK; normalised at publish time and never delivered. */
  expectedAnswer: string | null;
  questionHash: string;
}

/** Complete immutable content of a published examination version. */
export interface ExaminationSnapshot {
  version: number;
  title: string;
  type: string;
  durationMinutes: number;
  instructions: string | null;
  startsAt: string | null;
  endsAt: string | null;
  totalMarks: number;
  passingMarks: number | null;
  negativeMarking: number;
  maxAttempts: number;
  randomiseQuestions: boolean;
  randomiseOptions: boolean;
  sections: Array<{ id: string; name: string; marks: number; questionIds: string[] }>;
  questions: SnapshotQuestion[];
  contentHash: string;
  securityProfile: string;
}

export interface GradeableQuestion {
  id: string;
  type: QuestionType;
  marks: number;
  negativeMarks: number;
  options: GradeableOption[];
  expectedAnswer?: string | null;
}

export interface GradeResult {
  marks: number | null;
  isCorrect: boolean | null;
}

const AUTO_GRADING_TYPES = new Set<QuestionType>([
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'TRUE_FALSE',
  'FILL_BLANK',
]);

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/** Shared normalisation for submitted values and hidden expected answers. */
export function normaliseAnswer(value: unknown): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Deterministic server-side grading. Non-objective types are left for manual evaluation. */
export function gradeAnswer(question: GradeableQuestion, submitted: unknown): GradeResult {
  if (!AUTO_GRADING_TYPES.has(question.type)) return { marks: null, isCorrect: null };

  // FILL_BLANK candidates never receive options/content. Grade only against the
  // hidden normalised expected answer frozen into the published snapshot.
  if (question.type === 'FILL_BLANK') {
    const expected = normaliseAnswer(question.expectedAnswer ?? '');
    if (!expected) return { marks: null, isCorrect: null };
    const value = asArray(submitted)[0];
    if (value === undefined || value === null || value === '') {
      return { marks: 0, isCorrect: false };
    }
    return normaliseAnswer(value) === expected
      ? { marks: question.marks, isCorrect: true }
      : { marks: -question.negativeMarks, isCorrect: false };
  }

  const correct = question.options.filter((option) => option.isCorrect);
  if (!correct.length) return { marks: null, isCorrect: null };

  if (question.type === 'MULTIPLE_CHOICE') {
    // A candidate can repeat a selected id/label in the payload; count each
    // distinct value once so partial credit can never exceed question.marks.
    const selected = [...new Set(asArray(submitted).map(normaliseAnswer))];
    const correctIds = new Set(correct.map((option) => normaliseAnswer(option.id)));
    const correctLabels = new Set(correct.map((option) => normaliseAnswer(option.label)));
    const valid = new Set([...correctIds, ...correctLabels]);
    const picked = selected.filter((value) => valid.has(value));
    const wrong = selected.length - picked.length;
    if (wrong > 0) {
      return { marks: -question.negativeMarks, isCorrect: false };
    }
    const correctCount = correctIds.size || correct.length;
    if (picked.length >= correctCount && correctCount > 0) {
      return { marks: question.marks, isCorrect: true };
    }
    const partial = correctCount
      ? Math.round((question.marks * picked.length * 100) / correctCount) / 100
      : 0;
    return { marks: Math.min(question.marks, Math.max(0, partial)), isCorrect: false };
  }

  const value = asArray(submitted)[0];
  if (value === undefined || value === null || value === '') {
    return { marks: 0, isCorrect: false };
  }
  const normalised = normaliseAnswer(value);
  const matched = correct.some(
    (option) =>
      normaliseAnswer(option.id) === normalised ||
      normaliseAnswer(option.label) === normalised ||
      normaliseAnswer(option.content) === normalised,
  );
  return matched
    ? { marks: question.marks, isCorrect: true }
    : { marks: -question.negativeMarks, isCorrect: false };
}

/** Seeded Fisher-Yates shuffle so an attempt's question/option order is stable across refreshes. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  const next = (): number => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Key-order-independent serialization: MySQL JSON columns canonicalise key order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function snapshotHash(snapshot: unknown): string {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}
