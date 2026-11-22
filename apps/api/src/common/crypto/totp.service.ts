import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const CODE_DIGITS = 6;

/** RFC 4648 Base32 + RFC 6238 TOTP, implemented without extra dependencies. */
@Injectable()
export class TotpService {
  generateSecret(bytes = 20): string {
    const value = randomBytes(bytes);
    let bits = '';
    for (const byte of value) bits += byte.toString(2).padStart(8, '0');
    let secret = '';
    for (let i = 0; i + 5 <= bits.length; i += 5) {
      secret += BASE32_ALPHABET[Number.parseInt(bits.slice(i, i + 5), 2)];
    }
    return secret;
  }

  otpauthUri(secret: string, label: string, issuer = 'ExamNexus'): string {
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: 'SHA1',
      digits: String(CODE_DIGITS),
      period: String(PERIOD_SECONDS),
    });
    return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params.toString()}`;
  }

  generateCode(secret: string, at = Date.now()): string {
    const counter = Math.floor(at / 1000 / PERIOD_SECONDS);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const key = this.decodeBase32(secret);
    const digest = createHmac('sha1', key).update(counterBuffer).digest();
    const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
    const binary =
      (((digest[offset] ?? 0) & 0x7f) << 24) |
      ((digest[offset + 1] ?? 0) << 16) |
      ((digest[offset + 2] ?? 0) << 8) |
      (digest[offset + 3] ?? 0);
    return String(binary % 1_000_000).padStart(CODE_DIGITS, '0');
  }

  /** Accepts a code from the previous or next 30-second window (clock skew tolerance). */
  verify(secret: string, code: string, at = Date.now(), window = 1): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    for (let delta = -window; delta <= window; delta += 1) {
      const expected = this.generateCode(secret, at + delta * PERIOD_SECONDS * 1000);
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return true;
    }
    return false;
  }

  generateRecoveryCodes(count = 10): string[] {
    return Array.from({ length: count }, () => {
      const value = randomBytes(8).toString('hex').toUpperCase();
      return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
    });
  }

  private decodeBase32(secret: string): Buffer {
    const clean = secret.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
    let bits = '';
    for (const character of clean) {
      const index = BASE32_ALPHABET.indexOf(character);
      if (index < 0) throw new Error('Invalid TOTP secret');
      bits += index.toString(2).padStart(5, '0');
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
    }
    return Buffer.from(bytes);
  }
}
