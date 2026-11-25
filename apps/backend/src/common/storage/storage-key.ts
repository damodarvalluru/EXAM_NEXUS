import { BadRequestException } from '@nestjs/common';
import { ERROR_CODES } from '@examnexus/shared';
import { basename } from 'node:path';

/** A tenant id or object filename must be one safe path segment. */
export function isSafeStorageSegment(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('..')
    && !value.includes('\0')
    && !/^[A-Za-z]:/.test(value)
    && basename(value) === value;
}

export function invalidDocumentKey(): BadRequestException {
  return new BadRequestException({
    code: ERROR_CODES.VALIDATION_ERROR,
    message: 'Invalid document key',
  });
}

export function assertSafeStorageSegment(value: unknown): asserts value is string {
  if (!isSafeStorageSegment(value)) throw invalidDocumentKey();
}
