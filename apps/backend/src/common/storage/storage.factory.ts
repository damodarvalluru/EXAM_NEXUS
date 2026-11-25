import type { ConfigService } from '@nestjs/config';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import type { StorageAdapter, StorageDriver } from './storage.types';

export function readStorageDriver(config: ConfigService): StorageDriver {
  const driver = config.get<string>('storage.driver') ?? 'local';
  if (driver !== 'local' && driver !== 's3') {
    throw new Error(`Unsupported storage driver: ${driver}`);
  }
  return driver;
}

/** Create a fresh adapter; primarily used by unit tests and DI factories. */
export function createStorageAdapter(config: ConfigService): StorageAdapter {
  const driver = readStorageDriver(config);
  if (driver === 'local') {
    return new LocalStorageAdapter(config.getOrThrow<string>('storage.localPath'));
  }
  return new S3StorageAdapter({
    endpoint: config.get<string>('storage.endpoint') ?? '',
    region: config.get<string>('storage.region') ?? 'us-east-1',
    bucket: config.getOrThrow<string>('storage.bucket'),
    accessKeyId: config.get<string>('storage.accessKeyId') ?? '',
    secretAccessKey: config.get<string>('storage.secretAccessKey') ?? '',
    forcePathStyle: config.get<boolean>('storage.forcePathStyle') ?? true,
  });
}

/** One adapter per ConfigService instance, so DI and health share a client. */
const adapters = new WeakMap<ConfigService, StorageAdapter>();

export function getStorageAdapter(config: ConfigService): StorageAdapter {
  let adapter = adapters.get(config);
  if (!adapter) {
    adapter = createStorageAdapter(config);
    adapters.set(config, adapter);
  }
  return adapter;
}
