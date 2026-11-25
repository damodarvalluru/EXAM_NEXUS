import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

export const CSP_NONCE_LOCAL = 'cspNonce';

export interface RequestWithContext extends Request {
  requestId: string;
  /** Per-request CSP nonce; never accepted from a client header. */
  cspNonce?: string;
  /** Set only by authenticated tenant resolution, never from a client header. */
  tenantId?: string;
  tenantSlugHint?: string;
  principal?: import('@examnexus/shared').Principal;
}

/**
 * Creates (or preserves) the request's CSP nonce and mirrors it onto res.locals
 * so helmet directives can read it without depending on Nest middleware order.
 */
export function ensureCspNonce(req: RequestWithContext, res: Response): string {
  const local = res.locals?.[CSP_NONCE_LOCAL];
  const existing = req.cspNonce ?? (typeof local === 'string' ? local : undefined);
  const nonce =
    existing && /^[A-Za-z0-9+/=_-]{16,128}$/.test(existing)
      ? existing
      : randomBytes(16).toString('base64');
  req.cspNonce = nonce;
  if (res.locals) res.locals[CSP_NONCE_LOCAL] = nonce;
  return nonce;
}

/** Getter for handlers/templates that need to emit nonce-bearing markup. */
export function getCspNonce(req: RequestWithContext): string | null {
  return req.cspNonce ?? null;
}

/** Helmet directive value: fails closed to 'none' if no nonce was installed. */
export function cspNonceDirective(_req: IncomingMessage, res: ServerResponse): string {
  const locals = (res as ServerResponse & { locals?: Record<string, unknown> }).locals;
  const nonce = locals?.[CSP_NONCE_LOCAL];
  return typeof nonce === 'string' && /^[A-Za-z0-9+/=_-]{16,128}$/.test(nonce)
    ? `'nonce-${nonce}'`
    : "'none'";
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestWithContext, res: Response, next: NextFunction): void {
    const supplied = req.header('x-request-id');
    req.requestId = supplied && /^[a-zA-Z0-9-]{1,120}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader('x-request-id', req.requestId);
    ensureCspNonce(req, res);

    // A slug hint is accepted for UI routing only. It is NEVER treated as proof
    // of tenant membership; the auth layer resolves and verifies the tenant.
    const slug = req.header('x-tenant-slug');
    if (slug && /^[a-z0-9-]{1,120}$/.test(slug)) {
      req.tenantSlugHint = slug;
    }
    next();
  }
}
