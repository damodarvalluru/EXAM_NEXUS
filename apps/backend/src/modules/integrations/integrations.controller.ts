import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { ApiKeyGuard, RequireApiScopes } from './api-key.guard';
import { ApiManagementService } from './api-management.service';
import { IntegrationCredentialsService } from './credentials.service';
import {
  CreateApiClientDto,
  CreateApiKeyDto,
  CreateIntegrationDto,
  CreateWebhookDto,
  GrantScopesDto,
  IngestCandidatesDto,
  RetryWebhookDto,
  RotateCredentialDto,
  StoreCredentialDto,
  SyncDto,
  TestConnectionDto,
  UpdateIntegrationDto,
  UpdateStatusDto,
} from './dto/integration.dto';
import { IntegrationsService } from './integrations.service';
import { IntegrationWebhooksService } from './webhooks.service';

@ApiTags('integrations')
@Controller('integrations')
@TenantScoped()
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly credentials: IntegrationCredentialsService,
    private readonly webhooks: IntegrationWebhooksService,
    private readonly api: ApiManagementService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_READ)
  @ApiOperation({ summary: 'List tenant integrations' })
  list(@Req() request: RequestWithContext) {
    return this.integrations.list(request.tenantId!);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Create a tenant integration' })
  create(@Body() dto: CreateIntegrationDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.integrations.create(request.tenantId!, dto, principal, request);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_READ)
  @ApiOperation({ summary: 'Get integration details' })
  detail(@Param('id') id: string, @Req() request: RequestWithContext) {
    return this.integrations.detail(request.tenantId!, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Update an integration' })
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.integrations.update(request.tenantId!, id, dto, principal, request);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @RequireStepUp()
  @ApiOperation({ summary: 'Change integration status (requires step-up authentication)' })
  setStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.integrations.setStatus(request.tenantId!, id, dto, principal, request);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @RequireStepUp()
  @ApiOperation({ summary: 'Delete an integration (requires step-up authentication)' })
  remove(@Param('id') id: string, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.integrations.remove(request.tenantId!, id, principal, request);
  }

  @Post(':id/credentials')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @RequireStepUp()
  @ApiOperation({ summary: 'Store an encrypted integration credential' })
  storeCredential(@Param('id') id: string, @Body() dto: StoreCredentialDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.credentials.store(request.tenantId!, id, dto, principal, request);
  }

  @Post(':id/credentials/:credentialId/rotate')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @RequireStepUp()
  @ApiOperation({ summary: 'Rotate an integration credential' })
  rotateCredential(@Param('id') id: string, @Param('credentialId') credentialId: string, @Body() dto: RotateCredentialDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.credentials.rotate(request.tenantId!, id, credentialId, dto, principal, request);
  }

  @Delete(':id/credentials/:credentialId')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @RequireStepUp()
  @ApiOperation({ summary: 'Revoke an integration credential' })
  revokeCredential(@Param('id') id: string, @Param('credentialId') credentialId: string, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.credentials.revoke(request.tenantId!, id, credentialId, principal, request);
  }

  @Post(':id/scopes')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Grant integration scopes' })
  grantScopes(@Param('id') id: string, @Body() dto: GrantScopesDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.integrations.grantScopes(request.tenantId!, id, dto, principal, request);
  }

  @Delete(':id/scopes/:permission')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Revoke an integration scope' })
  revokeScope(@Param('id') id: string, @Param('permission') permission: string, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.integrations.revokeScope(request.tenantId!, id, permission, principal, request);
  }

  @Post(':id/test')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Perform a real HTTPS connection test' })
  test(@Param('id') id: string, @Body() dto: TestConnectionDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.integrations.testConnection(request.tenantId!, id, dto, principal, request);
  }

  @Post(':id/sync')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Synchronise candidate records from an external HTTPS endpoint' })
  sync(@Param('id') id: string, @Body() dto: SyncDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.integrations.sync(request.tenantId!, id, dto, principal, request);
  }

  @Post(':id/webhook')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Create a signed webhook endpoint for an integration' })
  createWebhook(@Param('id') id: string, @Body() dto: CreateWebhookDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.webhooks.createEndpoint(request.tenantId!, id, dto, principal, request);
  }

  @Get(':id/events')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_READ)
  @ApiOperation({ summary: 'List webhook and integration events' })
  events(@Param('id') id: string, @Req() request: RequestWithContext) {
    return this.webhooks.listEvents(request.tenantId!, id);
  }

  @Post(':id/events/:eventId/retry')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Retry failed webhook deliveries' })
  retryEvents(@Param('id') id: string, @Param('eventId') eventId: string, @Body() dto: RetryWebhookDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.webhooks.retry(request.tenantId!, eventId, dto, principal, request);
  }

  @Patch('webhooks/:endpointId')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Enable or disable a webhook endpoint' })
  setWebhookStatus(@Param('endpointId') endpointId: string, @Body() body: { active: boolean }, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.webhooks.setEndpointStatus(request.tenantId!, endpointId, Boolean(body.active), principal, request);
  }

  @Post('webhooks/:endpointId/rotate')
  @RequirePermissions(PERMISSIONS.ORG_INTEGRATIONS_MANAGE)
  @RequireStepUp()
  @ApiOperation({ summary: 'Rotate a webhook signing secret' })
  rotateWebhookSecret(@Param('endpointId') endpointId: string, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.webhooks.rotateSecret(request.tenantId!, endpointId, principal, request);
  }

  @Get('api/clients')
  @RequirePermissions(PERMISSIONS.ORG_API_MANAGE)
  @ApiOperation({ summary: 'List API clients' })
  listClients(@Req() request: RequestWithContext) {
    return this.api.listClients(request.tenantId!);
  }

  @Post('api/clients')
  @RequirePermissions(PERMISSIONS.ORG_API_MANAGE)
  @ApiOperation({ summary: 'Create an API client' })
  createClient(@Body() dto: CreateApiClientDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.api.createClient(request.tenantId!, dto, principal, request);
  }

  @Post('api/clients/:clientId/revoke')
  @RequirePermissions(PERMISSIONS.ORG_API_MANAGE)
  @RequireStepUp()
  @ApiOperation({ summary: 'Revoke an API client and all its keys' })
  revokeClient(@Param('clientId') clientId: string, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.api.revokeClient(request.tenantId!, clientId, principal, request);
  }

  @Get('api/keys')
  @RequirePermissions(PERMISSIONS.ORG_API_MANAGE)
  @ApiOperation({ summary: 'List API keys' })
  listKeys(@Query('clientId') clientId: string | undefined, @Req() request: RequestWithContext) {
    return this.api.listKeys(request.tenantId!, clientId);
  }

  @Post('api/clients/:clientId/keys')
  @RequirePermissions(PERMISSIONS.ORG_API_MANAGE)
  @ApiOperation({ summary: 'Create an API key (returned once)' })
  createKey(@Param('clientId') clientId: string, @Body() dto: CreateApiKeyDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.api.createKey(request.tenantId!, clientId, dto, principal, request);
  }

  @Post('api/keys/:keyId/revoke')
  @RequirePermissions(PERMISSIONS.ORG_API_MANAGE)
  @ApiOperation({ summary: 'Revoke an API key' })
  revokeKey(@Param('keyId') keyId: string, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.api.revokeKey(request.tenantId!, keyId, principal, request);
  }
}

@ApiTags('platform-integrations')
@Controller('platform/integrations')
export class PlatformIntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('monitoring')
  @RequirePermissions(PERMISSIONS.PLATFORM_INTEGRATIONS_READ)
  @ApiOperation({ summary: 'Cross-tenant integration monitoring metrics' })
  monitoring() {
    return this.integrations.monitoring();
  }
}

@ApiTags('public-api')
// The global 'api' prefix and URI versioning already produce /api/v1.
@Controller('integrations')
export class PublicIngestController {
  constructor(
    private readonly api: ApiManagementService,
    private readonly webhooks: IntegrationWebhooksService,
  ) {}

  @Post('ingest/candidates')
  @Public()
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('candidates:write')
  @ApiOperation({ summary: 'Ingest candidates using a scoped API key or client credentials' })
  ingest(@Body() dto: IngestCandidatesDto, @Req() request: RequestWithContext) {
    const context = request as RequestWithContext & { apiKeyId?: string };
    return this.api.ingestCandidates(request.tenantId!, context.apiKeyId ?? null, dto);
  }

  @Get('api/candidates/:candidateCode')
  @Public()
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('candidates:read')
  @ApiOperation({ summary: 'Read one candidate using the candidates:read scope' })
  readCandidate(@Param('candidateCode') candidateCode: string, @Req() request: RequestWithContext) {
    return this.api.readCandidate(request.tenantId!, candidateCode);
  }

  @Get('api/webhook-events')
  @Public()
  @UseGuards(ApiKeyGuard)
  @RequireApiScopes('webhooks:read')
  @ApiOperation({ summary: 'List webhook events using the webhooks:read scope' })
  listWebhookEvents(@Query('limit') limit: string | undefined, @Req() request: RequestWithContext) {
    const parsed = limit ? Number.parseInt(limit, 10) : 50;
    return this.webhooks.listTenantEvents(request.tenantId!, Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50);
  }

  /** Public receiver. The raw body is required because HMAC covers exact bytes. */
  @Post('webhooks/inbound/:endpointId')
  @Public()
  @HttpCode(202)
  @ApiOperation({ summary: 'Verify and record a signed inbound webhook' })
  async receiveInbound(
    @Param('endpointId') endpointId: string,
    @Req() request: RequestWithContext & { rawBody?: string | Buffer },
  ) {
    const rawBody = Buffer.isBuffer(request.rawBody)
      ? request.rawBody.toString('utf8')
      : request.rawBody ?? '';
    return this.webhooks.receiveInbound(endpointId, request.headers, rawBody);
  }
}
