import type { MappingFieldResult } from '@examnexus/shared';

export interface MappingInputRecord {
  [field: string]: unknown;
}

/** Aggregate field presence across a sample without modifying the source records. */
export function verifyMapping(
  mapping: Record<string, string>,
  samples: readonly MappingInputRecord[],
  requiredTargets: readonly string[] = [],
): MappingFieldResult[] {
  const targets = [...new Set([...Object.keys(mapping), ...requiredTargets])];
  return targets.map((target) => {
    const source = mapping[target] ?? '';
    const present = samples.filter((sample) => {
      if (!source || !Object.prototype.hasOwnProperty.call(sample, source)) return false;
      const value = sample[source];
      return value !== undefined && value !== null && value !== '';
    }).length;
    return {
      target,
      source,
      present,
      missing: samples.length - present,
      ok: samples.length > 0 && present === samples.length,
    };
  });
}

export function applyMapping<T extends Record<string, unknown>>(
  mapping: Record<string, string>,
  record: MappingInputRecord,
  allowedTargets?: readonly string[],
): Partial<T> {
  const mapped: Record<string, unknown> = {};
  for (const [target, source] of Object.entries(mapping)) {
    if (allowedTargets && !allowedTargets.includes(target)) continue;
    if (Object.prototype.hasOwnProperty.call(record, source)) {
      mapped[target] = record[source];
    }
  }
  return mapped as Partial<T>;
}
