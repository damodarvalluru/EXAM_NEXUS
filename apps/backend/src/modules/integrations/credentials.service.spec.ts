import type { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../common/crypto/crypto.service';
import { IntegrationCredentialsService } from './credentials.service';
import type { PrismaService } from '../../database/prisma.service';

describe('integration credential vault', () => {
  const crypto = new CryptoService({ getOrThrow: () => 'v1.'.repeat(10) } as unknown as ConfigService);
  const audit = { record: jest.fn() };
  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'cred_1', keyId: data.keyId, algorithm: data.algorithm,
    expiresAt: null, rotatedAt: null, revokedAt: null, createdAt: new Date(),
  }));
  const prisma = {
    withTenant: async (tenantId: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        integration: {
          findUnique: async () => ({ id: 'int_1', tenantId }),
          update: async () => ({}),
        },
        integrationCredential: { create },
      }),
  } as unknown as PrismaService;
  const service = new IntegrationCredentialsService(prisma, crypto, audit as never);

  it('stores Credentials as split AES-256-GCM parts and never returns plaintext', async () => {
    const view = await service.store(
      'tenant_1',
      'int_1',
      { keyId: 'primary', secret: 'super-secret-value' },
      { userId: 'user_1', email: 'admin@example.com' } as never,
      { requestId: 'req_1' } as never,
    );
    expect(view.keyId).toBe('primary');
    expect(JSON.stringify(view)).not.toContain('super-secret-value');
    const stored = create.mock.calls[0]?.[0].data as Record<string, string>;
    expect(stored.algorithm).toBe('aes-256-gcm');
    expect(stored.ciphertext).not.toContain('super-secret-value');
    expect(stored.iv).toBeTruthy();
    expect(stored.authTag).toBeTruthy();
    expect(service.decryptSecret({
      ciphertext: stored.ciphertext!, iv: stored.iv!, authTag: stored.authTag!, algorithm: stored.algorithm!,
    })).toBe('super-secret-value');
  });
});
