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
    endpoint: process.env.S3_ENDPOINT ?? '',
    bucket: process.env.S3_BUCKET ?? '',
    localPath: process.env.STORAGE_LOCAL_PATH ?? `${process.cwd()}/storage`,
  },
});
