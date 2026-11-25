import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import {
  ApproveResultDto,
  PublishResultDto,
  RejectResultDto,
  ResultQueryDto,
  SchedulePublicationDto,
  WithholdResultDto,
} from './dto';
import { ResultsService } from './results.service';

@ApiTags('phase-7 results approval')
@TenantScoped()
@Controller('advanced/results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_READ)
  @ApiOperation({ summary: 'List results for human review and publication' })
  list(@Query() query: ResultQueryDto, @CurrentPrincipal() principal: Principal) {
    return this.results.list(principal.tenantId!, query);
  }

  @Get('analytics')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_READ)
  @ApiOperation({ summary: 'Published results grouped by department and examination' })
  analytics(@CurrentPrincipal() principal: Principal) {
    return this.results.analytics(principal.tenantId!);
  }

  @Get('rank/:examinationId')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_READ)
  @ApiOperation({ summary: 'Competition rank list from the latest published results' })
  rank(@Param('examinationId') examinationId: string, @CurrentPrincipal() principal: Principal) {
    return this.results.rankList(principal.tenantId!, examinationId);
  }

  @Post('rank/:examinationId')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Persist competition ranks from the latest published results' })
  persistRanks(
    @Param('examinationId') examinationId: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.results.persistRanks(principal.tenantId!, examinationId, principal, request);
  }

  @Post('publish-due')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Publish approved results whose scheduled time has arrived' })
  publishDue(@CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.results.publishDue(principal.tenantId!, principal, request);
  }

  @Get(':resultId/scorecard')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_READ)
  @ApiOperation({ summary: 'Per-question scorecard from the frozen examination version' })
  scorecard(@Param('resultId') resultId: string, @CurrentPrincipal() principal: Principal) {
    return this.results.scorecard(principal.tenantId!, resultId);
  }

  @Get(':resultId')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_READ)
  @ApiOperation({ summary: 'Result review detail' })
  detail(@Param('resultId') resultId: string, @CurrentPrincipal() principal: Principal) {
    return this.results.detail(principal.tenantId!, resultId);
  }

  @Post(':resultId/approve')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Approve a reviewed result, optionally publishing it' })
  approve(
    @Param('resultId') resultId: string,
    @Body() dto: ApproveResultDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.results.approve(principal.tenantId!, resultId, dto, principal, request);
  }

  @Post(':resultId/publish')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Publish an approved result to the candidate' })
  publish(
    @Param('resultId') resultId: string,
    @Body() dto: PublishResultDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.results.publish(principal.tenantId!, resultId, dto, principal, request);
  }

  @Post(':resultId/schedule')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Schedule an approved result for later publication' })
  schedule(
    @Param('resultId') resultId: string,
    @Body() dto: SchedulePublicationDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.results.schedule(principal.tenantId!, resultId, dto, principal, request);
  }

  @Post(':resultId/reject')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Send a result back for revision' })
  reject(
    @Param('resultId') resultId: string,
    @Body() dto: RejectResultDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.results.reject(principal.tenantId!, resultId, dto, principal, request);
  }

  @Post(':resultId/withhold')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Withhold a result from publication with an audit record' })
  withhold(
    @Param('resultId') resultId: string,
    @Body() dto: WithholdResultDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.results.withhold(principal.tenantId!, resultId, dto, principal, request);
  }
}
