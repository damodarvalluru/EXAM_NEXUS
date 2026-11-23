import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'x-examnexus-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-examnexus-timestamp';
export const WEBHOOK_NONCE_HEADER = 'x-examnexus-nonce';

export const webhookSignatureHeader = WEBHOOK_SIGNATURE_HEADER;
export const webhookTimestampHeader = WEBHOOK_TIMESTAMP_HEADER;
export const webhookNonceHeader = WEBHOOK_NONCE_HEADER;

/** v1 signatures bind the timestamp, nonce and raw body to prevent replay/substitution. */
export function signWebhookPayload(
  secret: string,
  timestamp: number,
  nonce: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${nonce}.${rawBody}`).digest('hex');
}

export interface VerifySignatureInput {
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
  rawBody: string;
  toleranceSeconds: number;
  now?: number;
}

export function verifyWebhookSignature(input: VerifySignatureInput): { valid: boolean; reason?: string } {
  const { secret, signature, timestamp, nonce, rawBody, toleranceSeconds } = input;
  if (!signature || !timestamp || !nonce) return { valid: false, reason: 'Missing signature headers' };
  if (!/^[a-f0-9]{64}$/i.test(signature)) return { valid: false, reason: 'Malformed signature' };
  if (!/^\d{10}$/.test(timestamp)) return { valid: false, reason: 'Malformed timestamp' };
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return { valid: false, reason: 'Malformed nonce' };

  const sentAt = Number.parseInt(timestamp, 10) * 1000;
  const now = input.now ?? Date.now();
  if (Math.abs(now - sentAt) > toleranceSeconds * 1000) {
    return { valid: false, reason: 'Timestamp outside the allowed window' };
  }

  const expected = signWebhookPayload(secret, Number.parseInt(timestamp, 10), nonce, rawBody);
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(signature, 'hex');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { valid: false, reason: 'Signature mismatch' };
  }
  return { valid: true };
}
