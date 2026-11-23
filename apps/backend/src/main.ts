import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { RequestWithContext } from './common/middleware/request-context.middleware';
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

  app.use(
    helmet({
      // Swagger UI relies on inline scripts; a nonce-based CSP is added with
      // the production hardening phase. HSTS/CSP are enforced at the edge too.
      contentSecurityPolicy: false,
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
