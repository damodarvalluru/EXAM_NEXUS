import { EventEmitter } from 'node:events';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import type { PrismaService } from '../../database/prisma.service';
import { ApiRequestLogMiddleware } from './api-request-log.middleware';

describe('API request logging middleware', () => {
  let create: jest.Mock;
  let middleware: ApiRequestLogMiddleware;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    const prisma = {
      withElevated: jest.fn().mockImplementation((work) => work({ apiRequestLog: { create } })),
    } as unknown as PrismaService;
    middleware = new ApiRequestLogMiddleware(prisma);
  });

  function responseWithStatus(statusCode: number): Response {
    const response = new EventEmitter() as Response;
    response.statusCode = statusCode;
    return response;
  }

  function request(path: string): RequestWithContext & { apiClientId?: string } {
    return {
      originalUrl: path,
      url: path,
      method: 'POST',
      tenantId: 'tenant-1',
      apiClientId: 'enx_c_abcdefghijklmnopqrstuvwx',
    } as RequestWithContext & { apiClientId?: string };
  }

  it('records failed requests with their real status and latency', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_085);
    const response = responseWithStatus(401);
    const next = jest.fn() as NextFunction;
    middleware.use(request('/api/v1/integrations/ingest/candidates?dryRun=true'), response, next);
    expect(next).toHaveBeenCalledTimes(1);

    response.emit('finish');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        clientId: 'enx_c_abcdefghijklmnopqrstuvwx',
        method: 'POST',
        path: '/api/v1/integrations/ingest/candidates',
        statusCode: 401,
        outcome: 'CLIENT_ERROR',
        latencyMs: 85,
      }),
    });
    jest.restoreAllMocks();
  });

  it('does not log non-API routes', () => {
    const response = responseWithStatus(200);
    middleware.use(request('/health/live'), response, jest.fn());
    response.emit('finish');
    expect(create).not.toHaveBeenCalled();
  });

  it('never propagates database errors into the request path', () => {
    create.mockRejectedValueOnce(new Error('database down'));
    const response = responseWithStatus(201);
    expect(() => {
      middleware.use(request('/api/v1/integrations'), response, jest.fn());
      response.emit('finish');
    }).not.toThrow();
  });
});
