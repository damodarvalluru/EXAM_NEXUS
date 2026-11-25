import { Prisma } from '@prisma/client';

/**
 * JSON value encoding for logical backups. Native JSON types pass through;
 * driver-specific types get a tagged wrapper so a restore can rebuild them.
 * Wrapper-shaped user JSON is escaped with an "Object" tag on export.
 */

const TYPE_KEY = '__examnexus_dr_type__';
const VALUE_KEY = '__examnexus_dr_value__';

type EncodedTag = 'Date' | 'BigInt' | 'Buffer' | 'Decimal' | 'Object';

const KNOWN_TAGS: readonly string[] = ['Date', 'BigInt', 'Buffer', 'Decimal', 'Object'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWrapper(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const tag = value[TYPE_KEY];
  return (
    keys.length === 2 &&
    keys.includes(TYPE_KEY) &&
    keys.includes(VALUE_KEY) &&
    typeof tag === 'string' &&
    KNOWN_TAGS.includes(tag)
  );
}

function wrap(tag: EncodedTag, value: unknown): Record<string, unknown> {
  return { [TYPE_KEY]: tag, [VALUE_KEY]: value };
}

export function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return wrap('Date', value.toISOString());
  if (typeof value === 'bigint') return wrap('BigInt', value.toString());
  if (Buffer.isBuffer(value)) return wrap('Buffer', value.toString('base64'));
  if (value instanceof Prisma.Decimal) return wrap('Decimal', value.toString());
  if (Array.isArray(value)) return value.map((item) => encodeValue(item));
  if (isRecord(value)) {
    // Prevent collision with our own wrapper shape inside user JSON columns.
    const encoded: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) encoded[key] = encodeValue(item);
    return isWrapper(value) ? wrap('Object', encoded) : encoded;
  }
  return value;
}

/** Decodes members without unwrapping the container itself (used for escaped user JSON). */
function decodePlainObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => decodeValue(item));
  if (isRecord(value)) {
    const decoded: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) decoded[key] = decodeValue(item);
    return decoded;
  }
  return decodeValue(value);
}

export function decodeValue(value: unknown): unknown {
  if (isWrapper(value)) {
    const tag = value[TYPE_KEY] as string;
    const inner = value[VALUE_KEY];
    switch (tag) {
      case 'Date': {
        if (typeof inner !== 'string') throw new Error('Invalid Date value in backup');
        const date = new Date(inner);
        if (Number.isNaN(date.getTime())) throw new Error('Invalid Date value in backup');
        return date;
      }
      case 'BigInt': {
        if (typeof inner !== 'string' || !/^-?\d+$/.test(inner)) {
          throw new Error('Invalid BigInt value in backup');
        }
        return BigInt(inner);
      }
      case 'Buffer': {
        if (typeof inner !== 'string') throw new Error('Invalid Buffer value in backup');
        return Buffer.from(inner, 'base64');
      }
      case 'Decimal': {
        if (typeof inner !== 'string' || !/^-?\d+(\.\d+)?$/.test(inner)) {
          throw new Error('Invalid Decimal value in backup');
        }
        return inner;
      }
      case 'Object':
        return decodePlainObject(inner);
      default:
        throw new Error('Unsupported encoded value in backup');
    }
  }
  if (Array.isArray(value)) return value.map((item) => decodeValue(item));
  if (isRecord(value)) {
    const decoded: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) decoded[key] = decodeValue(item);
    return decoded;
  }
  return value;
}

/** Values accepted as bind parameters by Prisma raw queries. */
export type SqlScalar = string | number | bigint | boolean | Date | Uint8Array | null;

/** Converts a decoded JSON value to a safe raw-query bind parameter (never SQL text). */
export function toSqlScalar(value: unknown): SqlScalar {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value;
  if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value);
  throw new Error('Unsupported value type in backup row');
}
