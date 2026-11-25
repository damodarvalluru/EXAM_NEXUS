import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { assertSafeStorageSegment, invalidDocumentKey } from './storage-key';
import type { StorageAdapter, StorageHealth } from './storage.types';

/** Filesystem implementation: `<root>/<tenantId>/<fileName>`. */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local' as const;
  readonly bucket = 'local';

  constructor(private readonly root: string) {}

  private resolveObject(tenantId: string, fileName: string): string {
    assertSafeStorageSegment(tenantId);
    assertSafeStorageSegment(fileName);
    const base = resolve(this.root);
    const target = resolve(base, tenantId, fileName);
    const inside = relative(base, target);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw invalidDocumentKey();
    }
    return target;
  }

  async put(tenantId: string, fileName: string, bytes: Buffer): Promise<void> {
    const target = this.resolveObject(tenantId, fileName);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async get(tenantId: string, fileName: string): Promise<Buffer> {
    return readFile(this.resolveObject(tenantId, fileName));
  }

  async delete(tenantId: string, fileName: string): Promise<void> {
    await rm(this.resolveObject(tenantId, fileName), { force: true });
  }

  async check(): Promise<StorageHealth> {
    const path = resolve(this.root);
    try {
      const info = await stat(path);
      return { status: info.isDirectory() ? 'up' : 'down', adapter: this.name, path };
    } catch {
      return { status: 'down', adapter: this.name, path };
    }
  }
}
