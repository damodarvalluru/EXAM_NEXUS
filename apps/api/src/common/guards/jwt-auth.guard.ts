import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@examnexus/shared';
import { TokenService } from '../../modules/auth/token.service';
import { PrincipalService } from '../../modules/auth/principal.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestWithContext } from '../middleware/request-context.middleware';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Authentication is required',
      });
    }

    const payload = await this.tokens.verifyAccess(token);
    const principal = await this.principals.resolve(payload);
    request.principal = principal;
    request.tenantId = principal.tenantId ?? undefined;
    return true;
  }
}
