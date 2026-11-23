import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { ApiSuccess } from '@examnexus/shared';
import type { RequestWithContext } from '../middleware/request-context.middleware';
import { map, type Observable } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    return next.handle().pipe(
      map((data: unknown) => {
        if (data !== null && typeof data === 'object' && 'success' in data) {
          return data;
        }
        const envelope: ApiSuccess<unknown> = {
          success: true,
          data: data ?? null,
          meta: { requestId: request.requestId, timestamp: new Date().toISOString() },
        };
        return envelope;
      }),
    );
  }
}
