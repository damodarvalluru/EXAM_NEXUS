import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const BACKUP_FORMAT = 'examnexus-logical-backup' as const;
export const BACKUP_VERSION = 1 as const;
export const BACKUP_ALGORITHM = 'aes-256-gcm' as const;

/** Fixed, validated KDF parameters. */
export const SCRYPT = {
  name: 'scrypt',
  N: 32_768,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 64 * 1024 * 1024,
  saltBytes: 32,
} as const;

export interface KdfInfo {
  readonly name: 'scrypt';
  readonly salt: string;
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keylen: number;
  readonly maxmem: number;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function deriveKey(passphrase: string, salt: Buffer, kdf: KdfInfo): Buffer {
  if (
    kdf.name !== SCRYPT.name ||
    kdf.N !== SCRYPT.N ||
    kdf.r !== SCRYPT.r ||
    kdf.p !== SCRYPT.p ||
    kdf.keylen !== SCRYPT.keylen ||
    kdf.maxmem !== SCRYPT.maxmem
  ) {
    throw new Error('Unsupported backup key-derivation parameters');
  }
  return scryptSync(passphrase, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
}

export function newKdfInfo(): KdfInfo {
  return {
    name: 'scrypt',
    salt: randomBytes(SCRYPT.saltBytes).toString('base64'),
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    keylen: SCRYPT.keylen,
    maxmem: SCRYPT.maxmem,
  };
}

export interface SealedPayload {
  readonly kdf: KdfInfo;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: Buffer;
}

export function encryptPayload(plaintext: Buffer, passphrase: string): SealedPayload {
  const kdf = newKdfInfo();
  const iv = randomBytes(12);
  const salt = Buffer.from(kdf.salt, 'base64');
  const cipher = createCipheriv(BACKUP_ALGORITHM, deriveKey(passphrase, salt, kdf), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    kdf,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext,
  };
}

export function decryptPayload(payload: SealedPayload, passphrase: string): Buffer {
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const salt = Buffer.from(payload.kdf.salt, 'base64');
  if (iv.length !== 12 || authTag.length !== 16 || salt.length !== SCRYPT.saltBytes) {
    throw new Error('Invalid backup encryption header');
  }
  const decipher = createDecipheriv(BACKUP_ALGORITHM, deriveKey(passphrase, salt, payload.kdf), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
}

/** Constant-time comparison for the checksum sidecar. */
export function safeHexEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
