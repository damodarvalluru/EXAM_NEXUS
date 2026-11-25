import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { PrismaModule } from '../../database/prisma.module';
import { ApiKeyGuard } from './api-key.guard';
import { ApiManagementService } from './api-management.service';
import { IntegrationCredentialsService } from './credentials.service';
import {
  IntegrationsController,
  PlatformIntegrationsController,
  PublicIngestController,
} from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationWebhooksService } from './webhooks.service';
import { OAuthFlowService } from './oauth-flow.service';
import { WebhookRetryProcessor } from './webhook-retry.processor';

/** Phase 5: connector framework, encrypted credentials, webhooks and API gateway. */
@Module({
  imports: [CommonModule, PrismaModule],
  controllers: [IntegrationsController, PlatformIntegrationsController, PublicIngestController],
  providers: [
    IntegrationsService,
    IntegrationCredentialsService,
    IntegrationWebhooksService,
    WebhookRetryProcessor,
    OAuthFlowService,
    ApiManagementService,
    ApiKeyGuard,
  ],
  exports: [IntegrationsService, IntegrationWebhooksService, ApiManagementService],
})
export class IntegrationsModule {}
