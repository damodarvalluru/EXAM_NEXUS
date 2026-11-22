import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Principal } from '@examnexus/shared';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal | null => {
    const request = ctx.switchToHttp().getRequest<{ principal?: Principal }>();
    return request.principal ?? null;
  },
);
