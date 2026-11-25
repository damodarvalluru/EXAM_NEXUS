import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto/crypto.service';
import { TotpService } from './crypto/totp.service';
import { AuditService } from './services/audit.service';
import { AuthEventService } from './services/auth-event.service';
import { RateLimitService } from './services/rate-limit.service';
import { PermissionSeedService } from './services/permission-seed.service';
import { OutboundHttpService } from './net/outbound-http.service';
import { getStorageAdapter } from './storage/storage.factory';
import { STORAGE_ADAPTER } from './storage/storage.types';

@Module({
  imports: [ConfigModule],
  providers: [
    CryptoService, TotpService, AuditService, AuthEventService, RateLimitService,
    PermissionSeedService, OutboundHttpService,
    { provide: STORAGE_ADAPTER, useFactory: getStorageAdapter, inject: [ConfigService] },
  ],
  exports: [
    CryptoService, TotpService, AuditService, AuthEventService, RateLimitService,
    PermissionSeedService, OutboundHttpService, STORAGE_ADAPTER,
  ],
})
export class CommonModule {}
