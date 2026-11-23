import { signWebhookPayload, verifyWebhookSignature } from './webhook-signature';

describe('webhook signatures', () => {
  const secret = 'integration-signing-secret';
  const body = JSON.stringify({ id: 'evt_1', type: 'candidate.created' });
  const timestamp = 1_700_000_000;
  const nonce = 'nonce_abcdefghijklmnop';

  it('accepts a correctly signed payload', () => {
    const signature = signWebhookPayload(secret, timestamp, nonce, body);
    const result = verifyWebhookSignature({
      secret,
      signature,
      timestamp: String(timestamp),
      nonce,
      rawBody: body,
      toleranceSeconds: 300,
      now: timestamp * 1000,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = signWebhookPayload(secret, timestamp, nonce, body);
    const result = verifyWebhookSignature({
      secret,
      signature,
      timestamp: String(timestamp),
      nonce,
      rawBody: `${body} `,
      toleranceSeconds: 300,
      now: timestamp * 1000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature mismatch');
  });

  it('rejects a stale timestamp', () => {
    const signature = signWebhookPayload(secret, timestamp, nonce, body);
    const result = verifyWebhookSignature({
      secret,
      signature,
      timestamp: String(timestamp),
      nonce,
      rawBody: body,
      toleranceSeconds: 30,
      now: (timestamp + 60) * 1000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Timestamp outside the allowed window');
  });
});
