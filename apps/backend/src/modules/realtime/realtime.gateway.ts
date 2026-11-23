import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  PERMISSIONS,
  REALTIME_EVENTS,
  type AttemptClockEvent,
  type AttemptStateEvent,
  type AttemptSubscribePayload,
  type AttemptSubscribedEvent,
  type Principal,
} from '@examnexus/shared';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../database/prisma.service';
import { PrincipalService } from '../auth/principal.service';
import { TokenService } from '../auth/token.service';

type LiveSocket = Socket;
type LiveSocketData = { principal?: Principal };

/** Authenticated, attempt-scoped live channel for exam delivery and monitoring. */
@WebSocketGateway({ namespace: '/live', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly principals: PrincipalService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: LiveSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('Missing access token');

      const payload = await this.tokens.verifyAccess(token);
      const principal = await this.principals.resolve(payload);
      if (!principal.tenantId) throw new Error('Tenant context is required');

      (client.data as LiveSocketData).principal = principal;
      this.logger.debug(`Live socket authenticated: ${client.id}`);
    } catch {
      client.emit(REALTIME_EVENTS.ATTEMPT_ERROR, {
        code: 'UNAUTHENTICATED',
        message: 'A valid active session with a tenant context is required',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: LiveSocket): void {
    this.logger.debug(`Live socket disconnected: ${client.id}`);
  }

  @SubscribeMessage(REALTIME_EVENTS.ATTEMPT_SUBSCRIBE)
  async subscribeAttempt(
    @ConnectedSocket() client: LiveSocket,
    @MessageBody() body: AttemptSubscribePayload,
  ): Promise<void> {
    const principal = (client.data as LiveSocketData).principal;
    if (!principal?.tenantId || !body?.attemptId) {
      client.emit(REALTIME_EVENTS.ATTEMPT_ERROR, {
        code: 'FORBIDDEN',
        message: 'Cannot subscribe to this attempt',
      });
      return;
    }

    const attempt = await this.prisma.withTenant(principal.tenantId, async (tx) => {
      return tx.examinationAttempt.findUnique({
        where: { id: body.attemptId },
        include: { candidate: true },
      });
    });

    const isOwner = attempt?.candidate.userId === principal.userId;
    const isMonitor =
      principal.permissions.includes('*') ||
      principal.permissions.includes(PERMISSIONS.ORG_LIVE_MONITORING) ||
      principal.permissions.includes(PERMISSIONS.ORG_EXAMINATIONS_READ);

    if (!attempt || attempt.tenantId !== principal.tenantId || (!isOwner && !isMonitor)) {
      client.emit(REALTIME_EVENTS.ATTEMPT_ERROR, {
        code: 'FORBIDDEN',
        message: 'Cannot subscribe to this attempt',
      });
      return;
    }

    await client.join(`attempt:${attempt.id}`);
    const event: AttemptSubscribedEvent = {
      attemptId: attempt.id,
      serverTime: new Date().toISOString(),
    };
    client.emit(REALTIME_EVENTS.ATTEMPT_SUBSCRIBED, event);
  }

  emitAttemptClock(event: AttemptClockEvent): void {
    this.server?.to(`attempt:${event.attemptId}`).emit(REALTIME_EVENTS.ATTEMPT_CLOCK, event);
  }

  emitAttemptState(event: AttemptStateEvent): void {
    this.server?.to(`attempt:${event.attemptId}`).emit(REALTIME_EVENTS.ATTEMPT_STATE, event);
  }

  private extractToken(client: LiveSocket): string {
    const auth = client.handshake.auth?.token;
    const header = client.handshake.headers.authorization;
    const query = client.handshake.query.token;
    const candidate = [auth, header, query].find((value): value is string => typeof value === 'string');
    if (!candidate) return '';
    return candidate.startsWith('Bearer ') ? candidate.slice(7).trim() : candidate.trim();
  }
}
