import type { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { OutboundHttpService } from './outbound-http.service';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

const lookupMock = jest.mocked(lookup);

function service(allowlist = ''): OutboundHttpService {
  return new OutboundHttpService({ get: () => allowlist } as unknown as ConfigService);
}

describe('outbound HTTP SSRF policy', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('rejects plaintext HTTP URLs', async () => {
    await expect(service().assertSafeUrl('http://example.com')).rejects.toThrow('HTTPS');
  });

  it('rejects credentials embedded in URLs', async () => {
    await expect(service().assertSafeUrl('https://user:pass@example.com')).rejects.toThrow('Credentials');
  });

  it('rejects private IP literals', async () => {
    await expect(service().assertSafeUrl('https://127.0.0.1')).rejects.toThrow('restricted address');
    await expect(service().assertSafeUrl('https://10.0.0.5')).rejects.toThrow('restricted address');
  });

  it('rejects DNS answers that resolve to private addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(service().assertSafeUrl('https://rebind.example.com')).rejects.toThrow('restricted address');
  });

  it('pins the connection to the validated DNS answer', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const target = await service().assertSafeUrl('https://public.example.com');
    expect(target.address).toBe('93.184.216.34');

    const callback = jest.fn();
    service().pinnedLookup(target)('attacker.example.com', { family: 4 }, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('drops credential headers when a redirect changes host', () => {
    const headers = service().stripSensitiveHeaders({
      authorization: 'Bearer secret',
      Cookie: 'session=secret',
      'Proxy-Authorization': 'Basic secret',
      'x-api-key': 'scoped-key',
      'x-trace': 'keep-me',
    });
    expect(headers).toEqual({ 'x-api-key': 'scoped-key', 'x-trace': 'keep-me' });
  });

  it('enforces an optional hostname allowlist', async () => {
    await expect(service('trusted.example.com').assertSafeUrl('https://other.example.com')).rejects.toThrow('allowlist');
    await expect(service('1.1.1.1').assertSafeUrl('https://1.1.1.1')).resolves.toBeDefined();
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await expect(service('.example.com').assertSafeUrl('https://api.example.com')).resolves.toBeDefined();
  });
});
