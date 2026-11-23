import { Body, Controller, Get, Param, Post, Patch, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import type { Response } from 'express';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { PlatformAdminService } from './platform-admin.service';
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
  constructor(private readonly platform: PlatformAdminService) {}

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

  @Get('subscriptions')
  @RequirePermissions(PERMISSIONS.PLATFORM_ORGANISATIONS_READ)
  @ApiOperation({ summary: 'List organisation subscriptions' })
  subscriptions() {
    return this.platform.subscriptions();
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
