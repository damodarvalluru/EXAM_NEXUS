import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, type ApiFailure } from '@examnexus/shared';
import type { Response } from 'express';
import type { RequestWithContext } from '../middleware/request-context.middleware';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<RequestWithContext>();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
        code = this.codeForStatus(status);
      } else if (payload && typeof payload === 'object') {
        const body = payload as Record<string, unknown>;
        message = typeof body.message === 'string' ? body.message : exception.message;
        code = typeof body.code === 'string' ? body.code : this.codeForStatus(status);
        details = body.details;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = ERROR_CODES.CONFLICT;
        message = 'A record with these unique values already exists';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = ERROR_CODES.NOT_FOUND;
        message = 'Requested record was not found';
      } else {
        details = { prismaCode: exception.code };
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      code = ERROR_CODES.VALIDATION_ERROR;
      message = 'Invalid database query parameters';
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${status} [${request.requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiFailure = {
      success: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      meta: { requestId: request.requestId, timestamp: new Date().toISOString() },
    };
    response.status(status).json(body);
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ERROR_CODES.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.RATE_LIMITED;
      default:
        return ERROR_CODES.INTERNAL_ERROR;
    }
  }
}
