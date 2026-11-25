/**
 * Evaluation rows are an append-only audit history. The mark that counts is
 * the newest row for a question, not any historical COMPLETED row. This keeps
 * revisions and moderation reopens from silently preserving a superseded mark.
 */
export interface EvaluationState {
  id: string;
  questionId: string | null;
  status: string;
  score: number | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

function timestamp(value: Date | null | undefined, fallback: number): number {
  const time = value instanceof Date ? value.getTime() : Number.NaN;
  return Number.isFinite(time) ? time : fallback;
}

export function latestEvaluationByQuestion<T extends EvaluationState>(rows: readonly T[]): Map<string, T> {
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byCreated = timestamp(a.row.createdAt, a.index) - timestamp(b.row.createdAt, b.index);
      if (byCreated !== 0) return byCreated;
      const byUpdated = timestamp(a.row.updatedAt, a.index) - timestamp(b.row.updatedAt, b.index);
      return byUpdated !== 0 ? byUpdated : a.index - b.index;
    });
  const current = new Map<string, T>();
  for (const { row } of ordered) {
    if (row.questionId) current.set(row.questionId, row);
  }
  return current;
}

export function isAcceptedEvaluation(
  row: EvaluationState | undefined,
): row is EvaluationState & { score: number } {
  return Boolean(
    row &&
      row.status === 'COMPLETED' &&
      typeof row.score === 'number' &&
      Number.isFinite(row.score),
  );
}
