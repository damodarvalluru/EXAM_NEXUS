import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@examnexus/shared';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import type { RequestWithContext } from '../middleware/request-context.middleware';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // WebSocket subscriptions authorise the specific attempt/channel.
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const principal = context.switchToHttp().getRequest<RequestWithContext>().principal;
    if (!principal) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'No authenticated principal',
      });
    }
    if (principal.permissions.includes('*')) return true;

    // A tenant role must never be able to grant platform-wide authority even if
    // a bad actor managed to seed a platform.* key into a tenant role row.
    const platformOnly = required.some((permission) => permission.startsWith('platform.'));
    if (platformOnly && (!principal.globalRoles.length || principal.tenantId)) {
      throw new ForbiddenException({
        code: ERROR_CODES.TENANT_ACCESS_DENIED,
        message: 'Platform permissions require a verified platform account',
        details: { required },
      });
    }
    if (required.some((permission) => principal.permissions.includes(permission))) return true;

    throw new ForbiddenException({
      code: ERROR_CODES.FORBIDDEN,
      message: 'You do not have permission to perform this action',
      details: { required },
    });
  }
}
