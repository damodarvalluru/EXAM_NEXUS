import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithContext extends Request {
  requestId: string;
  /** Set only by authenticated tenant resolution, never from a client header. */
  tenantId?: string;
  tenantSlugHint?: string;
  principal?: import('@examnexus/shared').Principal;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestWithContext, res: Response, next: NextFunction): void {
    const supplied = req.header('x-request-id');
    req.requestId = supplied && /^[a-zA-Z0-9-]{1,120}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader('x-request-id', req.requestId);

    // A slug hint is accepted for UI routing only. It is NEVER treated as proof
    // of tenant membership; the auth layer resolves and verifies the tenant.
    const slug = req.header('x-tenant-slug');
    if (slug && /^[a-z0-9-]{1,120}$/.test(slug)) {
      req.tenantSlugHint = slug;
    }
    next();
  }
}
