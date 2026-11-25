import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AlertDispatchService } from '../../common/services/alert-dispatch.service';
import { NotificationDispatchService } from '../../common/services/notification-dispatch.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { BillingService } from './billing.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  imports: [CommonModule],
  controllers: [AdminController, PlatformAdminController],
  providers: [AdminService, PlatformAdminService, BillingService, AlertDispatchService, NotificationDispatchService],
  exports: [AdminService, PlatformAdminService, BillingService, AlertDispatchService, NotificationDispatchService],
})
export class AdminModule {}
