export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

export type StorageDriver = 'local' | 's3';

/** Shape returned by an adapter's readiness probe and by the health endpoint. */
export interface StorageHealth {
  status: 'up' | 'down';
  adapter: StorageDriver;
  /** Local filesystem root (local driver only). */
  path?: string;
  /** Configured bucket (S3 driver only). */
  bucket?: string;
  endpoint?: string;
}

/**
 * Tenant objects are addressed by two validated path segments. `fileName` is
 * the flattened object filename used by both drivers; legacy slash-form keys
 * are resolved by the service before they reach an adapter.
 */
export interface StorageAdapter {
  readonly name: StorageDriver;
  /** Value persisted in `fileObject.bucket` (`local` keeps its old meaning). */
  readonly bucket: string;

  put(tenantId: string, fileName: string, bytes: Buffer): Promise<void>;
  get(tenantId: string, fileName: string): Promise<Buffer>;
  delete(tenantId: string, fileName: string): Promise<void>;
  check(): Promise<StorageHealth>;
}
