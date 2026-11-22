import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';

/** Transport skeleton. Phase 4 adds authenticated, attempt-scoped event channels. */
@WebSocketGateway({ namespace: '/live', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(@ConnectedSocket() client: Socket): void {
    this.logger.debug(`Live socket connected: ${client.id}`);
  }

  handleDisconnect(@ConnectedSocket() client: Socket): void {
    this.logger.debug(`Live socket disconnected: ${client.id}`);
  }
}
