import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@examnexus/shared';
import { REQUIRE_STEP_UP_KEY } from '../decorators/require-step-up.decorator';
import type { RequestWithContext } from '../middleware/request-context.middleware';

export const STEP_UP_MAX_AGE_MS = 10 * 60 * 1000;

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Realtime connections are authorised by the gateway handshake.
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const principal = context.switchToHttp().getRequest<RequestWithContext>().principal;
    const verifiedAt = principal?.stepUpVerifiedAt ? Date.parse(principal.stepUpVerifiedAt) : 0;
    if (!verifiedAt || Date.now() - verifiedAt > STEP_UP_MAX_AGE_MS) {
      throw new ForbiddenException({
        code: ERROR_CODES.STEP_UP_REQUIRED,
        message: 'Step-up authentication is required for this action',
      });
    }
    return true;
  }
}
