import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { cspNonceDirective, ensureCspNonce, type RequestWithContext } from './common/middleware/request-context.middleware';
import { PrismaService } from './database/prisma.service';
import { ApiRequestLogMiddleware } from './modules/integrations/api-request-log.middleware';

async function bootstrap(): Promise<void> {
  // rawBody keeps the exact bytes needed to verify HMAC-signed webhooks.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const requestLogger = new ApiRequestLogMiddleware(app.get(PrismaService));
  app.use((req: Request, res: Response, next: NextFunction) =>
    requestLogger.use(req as RequestWithContext, res, next),
  );

  // The nonce must exist before helmet sends CSP headers. RequestContextMiddleware
  // reuses this value later in the Nest middleware pipeline.
  app.use((req: Request, res: Response, next: NextFunction) => {
    ensureCspNonce(req as RequestWithContext, res);
    next();
  });
  const production = config.get<string>('app.environment') === 'production';
  app.use(
    helmet({
      // Development keeps the previous behaviour (Swagger inline scripts work).
      // Production uses a per-request nonce for scripts and styles.
      contentSecurityPolicy: production
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", cspNonceDirective],
              styleSrc: ["'self'", cspNonceDirective],
              imgSrc: ["'self'", 'data:', 'https:'],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: config.getOrThrow<string>('app.corsOrigin'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ExamNexus API')
    .setDescription('Enterprise multi-tenant examination platform — REST API v1')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.getOrThrow<number>('app.port');
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`ExamNexus API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
