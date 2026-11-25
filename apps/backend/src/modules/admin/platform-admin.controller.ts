import { Body, Controller, Get, HttpCode, Param, Post, Patch, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import type { Response } from 'express';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { NotificationDispatchService } from '../../common/services/notification-dispatch.service';
import {
  WEBHOOK_NONCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '../../common/webhooks/webhook-signature';
import { BillingService } from './billing.service';
import { PlatformAdminService } from './platform-admin.service';
import {
  CancelSubscriptionDto,
  CreateCheckoutDto,
  DrainNotificationsDto,
  RestoreSubscriptionDto,
} from './dto/billing.dto';
import {
  CreateSupportTicketDto,
  PlatformAdminQueryDto,
  UpdateAlertDto,
  UpdateIncidentDto,
  UpdateSettingDto,
  UpdateSupportTicketDto,
} from './dto/platform-admin.dto';

@ApiTags('platform-administration')
@Controller('admin')
export class PlatformAdminController {
  constructor(
    private readonly platform: PlatformAdminService,
    private readonly billing: BillingService,
    private readonly notificationDispatcher: NotificationDispatchService,
  ) {}

  @Get('security/alerts')
  @RequirePermissions(PERMISSIONS.PLATFORM_SECURITY_READ)
  @ApiOperation({ summary: 'Search security alerts' })
  alerts(@Query() query: PlatformAdminQueryDto) {
    return this.platform.securityAlerts(query);
  }

  @Patch('security/alerts/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SECURITY_MANAGE)
  @ApiOperation({ summary: 'Update a security alert' })
  updateAlert(@Param('id') id: string, @Body() dto: UpdateAlertDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.platform.updateAlert(id, dto, principal, request);
  }

  @Get('security/incidents')
  @RequirePermissions(PERMISSIONS.PLATFORM_SECURITY_READ)
  @ApiOperation({ summary: 'Search security incidents' })
  incidents(@Query() query: PlatformAdminQueryDto) {
    return this.platform.incidents(query);
  }

  @Patch('security/incidents/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SECURITY_MANAGE)
  @ApiOperation({ summary: 'Update a security incident' })
  updateIncident(@Param('id') id: string, @Body() dto: UpdateIncidentDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.platform.updateIncident(id, dto, principal, request);
  }

  @Get('health')
  @RequirePermissions(PERMISSIONS.PLATFORM_MONITORING_READ)
  @ApiOperation({ summary: 'Live platform health checks' })
  health() {
    return this.platform.systemHealth();
  }

  @Get('analytics')
  @RequirePermissions(PERMISSIONS.PLATFORM_REPORTS_READ)
  @ApiOperation({ summary: 'Cross-tenant analytics report' })
  analytics(@Query('range') range: '7d' | '30d' | '90d' = '30d') {
    return this.platform.analytics(range);
  }

  @Get('analytics/export')
  @RequirePermissions(PERMISSIONS.PLATFORM_REPORTS_READ)
  @ApiOperation({ summary: 'Export a real CSV analytics report' })
  async export(@Query('kind') kind: 'organisations' | 'attempts' | 'alerts', @Query('range') range: '7d' | '30d' | '90d' = '30d', @Res() response: Response) {
    const csv = await this.platform.exportCsv(kind, range);
    response.type('text/csv').setHeader('Content-Disposition', `attachment; filename="examnexus-${kind}-${range}.csv"`).send(csv);
  }

  @Get('notifications')
  @RequirePermissions(PERMISSIONS.PLATFORM_MONITORING_READ)
  @ApiOperation({ summary: 'Search platform notifications' })
  notifications(@Query() query: PlatformAdminQueryDto) {
    return this.platform.notifications(query);
  }

  @Post('notifications/drain')
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.PLATFORM_CONFIGURATION_MANAGE)
  @ApiOperation({ summary: 'Opt-in delivery of pending email/SMS notifications' })
  drainNotifications(@Body() dto: DrainNotificationsDto, @Req() request: RequestWithContext) {
    return this.notificationDispatcher.drainPending(dto.limit ?? 20, request);
  }

  @Get('subscriptions')
  @RequirePermissions(PERMISSIONS.PLATFORM_ORGANISATIONS_READ)
  @ApiOperation({ summary: 'List organisation subscriptions' })
  subscriptions() {
    return this.platform.subscriptions();
  }

  @Post('billing/checkout')
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE)
  @ApiOperation({ summary: 'Create a provider-hosted checkout session (requires step-up authentication)' })
  createCheckout(@Body() dto: CreateCheckoutDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.billing.createCheckout(dto, principal, request);
  }

  @Post('billing/subscriptions/:id/cancel')
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE)
  @ApiOperation({ summary: 'Cancel a subscription (requires step-up authentication)' })
  cancelSubscription(
    @Param('id') id: string,
    @Body() dto: CancelSubscriptionDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.billing.cancelSubscription(id, dto.reason, principal, request);
  }

  @Post('billing/subscriptions/:id/restore')
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE)
  @ApiOperation({ summary: 'Restore a cancelled subscription (requires step-up authentication)' })
  restoreSubscription(
    @Param('id') id: string,
    @Body() dto: RestoreSubscriptionDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.billing.restoreSubscription(id, dto.reason, principal, request);
  }

  @Public()
  @Post('billing/webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Signed billing provider webhook (HMAC verified before any mutation)' })
  billingWebhook(@Req() request: RequestWithContext & { rawBody?: Buffer }) {
    const rawBody = request.rawBody?.toString('utf8') ?? JSON.stringify(request.body ?? {});
    return this.billing.verifyProviderWebhook(rawBody, {
      signature: request.header(WEBHOOK_SIGNATURE_HEADER) ?? undefined,
      timestamp: request.header(WEBHOOK_TIMESTAMP_HEADER) ?? undefined,
      nonce: request.header(WEBHOOK_NONCE_HEADER) ?? undefined,
    }, request);
  }

  @Get('support/tickets')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE)
  @ApiOperation({ summary: 'Search support tickets' })
  tickets(@Query() query: PlatformAdminQueryDto) {
    return this.platform.supportTickets(query);
  }

  @Post('support/tickets')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE)
  @ApiOperation({ summary: 'Create a support ticket' })
  createTicket(@Body() dto: CreateSupportTicketDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.platform.createTicket(dto, principal, request);
  }

  @Patch('support/tickets/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_SUPPORT_MANAGE)
  @ApiOperation({ summary: 'Update a support ticket' })
  updateTicket(@Param('id') id: string, @Body() dto: UpdateSupportTicketDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.platform.updateTicket(id, dto, principal, request);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONFIGURATION_MANAGE)
  @ApiOperation({ summary: 'List platform settings' })
  settings() {
    return this.platform.settings();
  }

  @Patch('settings/:key')
  @RequirePermissions(PERMISSIONS.PLATFORM_CONFIGURATION_MANAGE)
  @ApiOperation({ summary: 'Create or update a platform setting' })
  updateSetting(@Param('key') key: string, @Body() dto: UpdateSettingDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.platform.updateSetting(key, dto, principal, request);
  }

  @Get('live/attempts')
  @RequirePermissions(PERMISSIONS.PLATFORM_MONITORING_READ)
  @ApiOperation({ summary: 'Cross-tenant live examination attempts' })
  liveAttempts() {
    return this.platform.liveAttempts();
  }
}
