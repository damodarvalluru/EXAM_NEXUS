import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  imports: [CommonModule],
  controllers: [AdminController, PlatformAdminController],
  providers: [AdminService, PlatformAdminService],
  exports: [AdminService, PlatformAdminService],
})
export class AdminModule {}
