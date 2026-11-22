import { Module } from '@nestjs/common';
import { CryptoService } from './crypto/crypto.service';
import { TotpService } from './crypto/totp.service';
import { AuditService } from './services/audit.service';
import { AuthEventService } from './services/auth-event.service';
import { RateLimitService } from './services/rate-limit.service';
import { PermissionSeedService } from './services/permission-seed.service';

@Module({
  providers: [CryptoService, TotpService, AuditService, AuthEventService, RateLimitService, PermissionSeedService],
  exports: [CryptoService, TotpService, AuditService, AuthEventService, RateLimitService, PermissionSeedService],
})
export class CommonModule {}
