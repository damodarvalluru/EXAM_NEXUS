import type { NextFunction, Request, Response } from 'express';
import {
  CSP_NONCE_LOCAL,
  cspNonceDirective,
  ensureCspNonce,
  getCspNonce,
  RequestContextMiddleware,
  type RequestWithContext,
} from './request-context.middleware';

function request(headers: Record<string, string> = {}) {
  return {
    header: jest.fn((name: string) => headers[name.toLowerCase()]),
  } as unknown as RequestWithContext;
}

function response() {
  return {
    locals: {} as Record<string, unknown>,
    setHeader: jest.fn(),
  } as unknown as Response;
}

const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]{16,128}$/;

describe('RequestContextMiddleware CSP nonce', () => {
  it('generates a nonce per request and mirrors it onto res.locals', () => {
    const req = request();
    const res = response();
    const next = jest.fn() as NextFunction;

    new RequestContextMiddleware().use(req, res, next);

    expect(req.cspNonce).toMatch(NONCE_PATTERN);
    expect(res.locals[CSP_NONCE_LOCAL]).toBe(req.cspNonce);
    expect(getCspNonce(req)).toBe(req.cspNonce);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves an existing valid nonce and ignores a client-supplied nonce header', () => {
    const nonce = 'abcdefghijklmnopqrstuvwxyzABCDEF==';
    const req = request({ 'x-csp-nonce': 'client-controlled-value' });
    req.cspNonce = nonce;
    const res = response();

    ensureCspNonce(req, res);

    expect(req.cspNonce).toBe(nonce);
    expect(res.locals[CSP_NONCE_LOCAL]).toBe(nonce);
  });

  it('replaces an invalid nonce instead of emitting it into a CSP header', () => {
    const req = request();
    req.cspNonce = '"><script>alert(1)</script>';
    const res = response();

    ensureCspNonce(req, res);

    expect(req.cspNonce).toMatch(NONCE_PATTERN);
    expect(req.cspNonce).not.toContain('<');
    expect(res.locals[CSP_NONCE_LOCAL]).toBe(req.cspNonce);
  });

  it('returns null when a handler has no request nonce', () => {
    expect(getCspNonce(request())).toBeNull();
  });

  it('builds a nonce directive only from a valid response-local nonce', () => {
    const req = request();
    const res = response();
    res.locals[CSP_NONCE_LOCAL] = 'invalid nonce';

    expect(cspNonceDirective(req as unknown as Request, res as unknown as import('node:http').ServerResponse)).toBe("'none'");

    const nonce = ensureCspNonce(req, res);
    expect(cspNonceDirective(req as unknown as Request, res as unknown as import('node:http').ServerResponse)).toBe(`'nonce-${nonce}'`);
  });
});
