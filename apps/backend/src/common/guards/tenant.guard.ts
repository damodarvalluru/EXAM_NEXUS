import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@examnexus/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TENANT_SCOPED_KEY } from '../decorators/tenant-scoped.decorator';
import type { RequestWithContext } from '../middleware/request-context.middleware';

/**
 * Enforces that a tenant context exists for tenant-scoped handlers.
 * JwtAuthGuard populates req.tenantId from a verified session and membership lookup
 * before this guard runs.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // WebSocket channels enforce tenancy in their handshake/subscription logic.
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const tenantScoped = this.reflector.getAllAndOverride<boolean>(TENANT_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!tenantScoped) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.tenantId) {
      throw new ForbiddenException({
        code: ERROR_CODES.TENANT_ACCESS_DENIED,
        message: 'A verified tenant context is required for this resource',
      });
    }
    return true;
  }
}
