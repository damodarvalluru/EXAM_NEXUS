import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ENCRYPTION_MASTER_KEY: z.string().min(16),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_DOMAIN: z.string().default('localhost'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
  STORAGE_LOCAL_PATH: z.string().optional(),
  INTEGRATION_OUTBOUND_ALLOWLIST: z.string().optional(),
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  WEBHOOK_RETRY_ENABLED: z.enum(['true', 'false']).default('false'),
  WEBHOOK_RETRY_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  WEBHOOK_RETRY_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  ALERT_WEBHOOK_URL: z.string().optional(),
  ALERT_ESCALATION_MINUTES: z.coerce.number().int().positive().default(15),
  ALERT_ONCALL_ALIAS: z.string().optional(),
  ALERT_SLA_MINUTES: z.coerce.number().int().positive().default(60),
  NOTIFICATION_EMAIL_WEBHOOK_URL: z.string().optional(),
  NOTIFICATION_SMS_WEBHOOK_URL: z.string().optional(),
  NOTIFICATION_FROM_ADDRESS: z.string().optional(),
  BILLING_PROVIDER_BASE_URL: z.string().optional(),
  BILLING_PROVIDER_KEY_ID: z.string().optional(),
  BILLING_PROVIDER_KEY_SECRET: z.string().optional(),
  BILLING_WEBHOOK_SECRET: z.string().optional(),
});

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data as Record<string, unknown>;
}
