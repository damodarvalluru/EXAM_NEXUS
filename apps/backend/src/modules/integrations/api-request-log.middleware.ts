import { Injectable, Logger } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { PrismaService } from '../../database/prisma.service';

type ApiCredentialContext = {
  apiClientId?: string;
  apiKeyId?: string;
};

/** Paths that read or write the log itself must not generate more log rows. */
const LOG_PATH_PATTERNS = [/\/api\/v\d+\/integrations\/api\/request-logs(?:\/|$)/];

function outcomeFor(status: number): string {
  if (status >= 500) return 'SERVER_ERROR';
  if (status >= 400) return 'CLIENT_ERROR';
  return 'SUCCESS';
}

/**
 * Records every API request (including requests rejected by guards) after the
 * response completes, so latency and status code are the real ones. The write
 * is deliberately detached from the request: database problems must never
 * change the response the caller receives.
 */
@Injectable()
export class ApiRequestLogMiddleware {
  private readonly logger = new Logger(ApiRequestLogMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  use(request: RequestWithContext & ApiCredentialContext, response: Response, next: NextFunction): void {
    const path = (request.originalUrl ?? request.url).split('?')[0] ?? '';
    if (!(path === '/api' || path.startsWith('/api/')) || LOG_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      next();
      return;
    }

    const startedAt = Date.now();
    let recorded = false;
    const recordOnce = (): void => {
      if (recorded) return;
      recorded = true;
      this.record({
        tenantId: request.tenantId ?? null,
        clientId: request.apiClientId?.slice(0, 36) ?? null,
        method: (request.method ?? 'GET').slice(0, 10),
        path: path.slice(0, 500),
        statusCode: response.statusCode || 500,
        outcome: outcomeFor(response.statusCode || 500),
        latencyMs: Math.max(0, Date.now() - startedAt),
      });
    };

    response.once('finish', recordOnce);
    response.once('close', recordOnce);
    next();
  }

  private record(entry: {
    tenantId: string | null;
    clientId: string | null;
    method: string;
    path: string;
    statusCode: number;
    outcome: string;
    latencyMs: number;
  }): void {
    try {
      void this.prisma.withElevated(async (tx) => {
        await tx.apiRequestLog.create({
          data: {
            tenantId: entry.tenantId,
            clientId: entry.clientId,
            method: entry.method,
            path: entry.path,
            statusCode: entry.statusCode,
            outcome: entry.outcome,
            latencyMs: entry.latencyMs,
          },
        });
      }).catch((error: unknown) => {
        this.logger.debug(`Could not record API request log: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
    } catch (error) {
      // Never let telemetry break a request.
      this.logger.debug(`Could not record API request log: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}
