export default () => ({
  app: {
    environment: process.env.NODE_ENV ?? 'development',
    port: Number.parseInt(process.env.API_PORT ?? '3000', 10),
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    cookieDomain: process.env.COOKIE_DOMAIN ?? 'localhost',
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
    directUrl: process.env.DIRECT_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  security: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    encryptionMasterKey: process.env.ENCRYPTION_MASTER_KEY ?? '',
  },
  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local',
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true',
    localPath: process.env.STORAGE_LOCAL_PATH ?? `${process.cwd()}/storage`,
  },
  integrations: {
    // Comma-separated HTTPS hostnames (optionally with leading dot for subdomains).
    // Empty means any public host is permitted; production deployments should pin it.
    outboundAllowlist: process.env.INTEGRATION_OUTBOUND_ALLOWLIST ?? '',
    webhookToleranceSeconds: Math.max(
      1,
      Number.parseInt(process.env.WEBHOOK_TOLERANCE_SECONDS ?? '300', 10) || 300,
    ),
    retryEnabled: (process.env.WEBHOOK_RETRY_ENABLED ?? 'false').toLowerCase() === 'true',
    retryIntervalMs: Math.max(
      1_000,
      Number.parseInt(process.env.WEBHOOK_RETRY_INTERVAL_MS ?? '30000', 10) || 30000,
    ),
    retryBatchSize: Math.max(
      1,
      Number.parseInt(process.env.WEBHOOK_RETRY_BATCH_SIZE ?? '20', 10) || 20,
    ),
    oauthStateTtlSeconds: Math.max(
      60,
      Number.parseInt(process.env.OAUTH_STATE_TTL_SECONDS ?? '600', 10) || 600,
    ),
  },
  alerts: {
    webhookUrl: process.env.ALERT_WEBHOOK_URL ?? '',
    escalationMinutes: Math.max(
      1,
      Number.parseInt(process.env.ALERT_ESCALATION_MINUTES ?? '15', 10) || 15,
    ),
    onCallAlias: process.env.ALERT_ONCALL_ALIAS ?? 'platform-oncall',
    slaMinutes: Math.max(1, Number.parseInt(process.env.ALERT_SLA_MINUTES ?? '60', 10) || 60),
  },
  notifications: {
    emailWebhookUrl: process.env.NOTIFICATION_EMAIL_WEBHOOK_URL ?? '',
    smsWebhookUrl: process.env.NOTIFICATION_SMS_WEBHOOK_URL ?? '',
    fromAddress: process.env.NOTIFICATION_FROM_ADDRESS ?? 'noreply@examnexus.local',
  },
  billing: {
    providerBaseUrl: process.env.BILLING_PROVIDER_BASE_URL ?? '',
    keyId: process.env.BILLING_PROVIDER_KEY_ID ?? '',
    keySecret: process.env.BILLING_PROVIDER_KEY_SECRET ?? '',
    webhookSecret: process.env.BILLING_WEBHOOK_SECRET ?? '',
  },
});
