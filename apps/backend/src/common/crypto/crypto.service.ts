import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** OWASP-recommended Argon2id parameters. */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

@Injectable()
export class CryptoService {
  private readonly encryptionKey: Buffer;

  constructor(config: ConfigService) {
    const raw = config.getOrThrow<string>('security.encryptionMasterKey');
    const decoded = Buffer.from(raw, 'base64');
    // A non-base64 placeholder is still deterministic; derive a fixed 32-byte key
    // so development works, but production must provide a real 32-byte base64 key.
    this.encryptionKey = decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest();
  }

  async hashSecret(secret: string): Promise<string> {
    return hash(secret, ARGON2_OPTIONS);
  }

  async verifySecret(hashValue: string, secret: string): Promise<boolean> {
    try {
      return await verify(hashValue, secret, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }

  /** Opaque token with 256 bits of entropy, safe for URLs and cookies. */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  /** AES-256-GCM with a random IV; output is `v1.<iv>.<tag>.<ciphertext>` (base64url). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Invalid encrypted payload');
    }
    const iv = Buffer.from(parts[1] ?? '', 'base64url');
    const tag = Buffer.from(parts[2] ?? '', 'base64url');
    const ciphertext = Buffer.from(parts[3] ?? '', 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
