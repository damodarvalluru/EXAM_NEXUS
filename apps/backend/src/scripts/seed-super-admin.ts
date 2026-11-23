import { Algorithm, hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function generateTotpSecret(bytes = 20): string {
  const value = randomBytes(bytes);
  let bits = '';
  for (const byte of value) bits += byte.toString(2).padStart(8, '0');
  let secret = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += BASE32_ALPHABET[Number.parseInt(bits.slice(i, i + 5), 2)];
  }
  return secret;
}

function otpauthUri(secret: string, label: string, issuer = 'ExamNexus'): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?${params.toString()}`;
}

function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const value = randomBytes(8).toString('hex').toUpperCase();
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encryptionKey(): Buffer {
  const raw = required('ENCRYPTION_MASTER_KEY');
  const decoded = Buffer.from(raw, 'base64');
  return decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest();
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function currentTotpCode(secret: string): string {
  const clean = secret.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid TOTP secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));

  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counterBuffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function main(): Promise<void> {
  const email = required('SUPER_ADMIN_EMAIL').toLowerCase();
  const password = required('SUPER_ADMIN_PASSWORD');
  const pin = required('SUPER_ADMIN_PIN');
  if (password.length < 12) throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters');
  if (pin.length < 12) throw new Error('SUPER_ADMIN_PIN must be at least 12 characters');

  const [passwordHash, pinHash] = await Promise.all([hash(password, ARGON2_OPTIONS), hash(pin, ARGON2_OPTIONS)]);
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const now = new Date();

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash,
        globalRole: 'SUPER_ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: now,
        passwordChangedAt: now,
      },
      update: {
        passwordHash,
        globalRole: 'SUPER_ADMIN',
        status: 'ACTIVE',
        deletedAt: null,
        emailVerifiedAt: now,
        passwordChangedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      select: { id: true, email: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.superAdminCredential.upsert({
        where: { userId: user.id },
        create: { userId: user.id, pinHash, pinUpdatedAt: now, rotationRequired: false, failedAttempts: 0, lockedUntil: null },
        update: { pinHash, pinUpdatedAt: now, rotationRequired: false, failedAttempts: 0, lockedUntil: null },
      });
      await tx.mfaMethod.deleteMany({ where: { userId: user.id, type: 'TOTP' } });
      await tx.mfaMethod.create({
        data: {
          userId: user.id,
          tenantId: null,
          type: 'TOTP',
          label: 'Authenticator app',
          secretEncrypted: encrypt(secret),
          enabled: true,
          verifiedAt: now,
        },
      });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: recoveryCodes.map((code) => ({ userId: user.id, tenantId: null, codeHash: sha256(code) })),
      });
    });

    console.log(
      JSON.stringify(
        {
          message: 'Super Admin bootstrap complete. Store the secret and recovery codes offline; they are shown only once.',
          email: user.email,
          totpSecret: secret,
          otpauthUri: otpauthUri(secret, user.email),
          currentTotpCode: currentTotpCode(secret),
          recoveryCodes,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
