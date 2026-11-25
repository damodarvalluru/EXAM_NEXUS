import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { InvestigateEventDto, ProctorEventDto, RegisterSessionDto, ReviewRiskDto, RotateSessionTokenDto } from './dto';
import { ProctoringService } from './proctoring.service';

@ApiTags('phase-7 proctoring')
@TenantScoped()
@Controller('advanced/proctoring')
export class ProctoringController {
  constructor(private readonly proctoring: ProctoringService) {}

  @Post('sessions')
  @ApiOperation({ summary: 'Register a candidate exam session and trusted device' })
  registerSession(
    @Body() dto: RegisterSessionDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.proctoring.registerSession(principal.tenantId!, dto, principal, request);
  }

  @Post('sessions/:attemptId/heartbeat')
  @ApiOperation({ summary: 'Keep an active candidate session alive' })
  heartbeat(
    @Param('attemptId') attemptId: string,
    @Body() dto: RotateSessionTokenDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.proctoring.heartbeat(principal.tenantId!, attemptId, dto, principal, request);
  }

  @Post('sessions/:attemptId/rotate')
  @ApiOperation({ summary: 'Rotate a short-lived candidate session token' })
  rotate(
    @Param('attemptId') attemptId: string,
    @Body() dto: RotateSessionTokenDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.proctoring.rotateSessionToken(principal.tenantId!, attemptId, dto, principal, request);
  }

  @Post('attempts/:attemptId/events')
  @ApiOperation({ summary: 'Ingest one advisory proctoring event (candidate owner or reviewer)' })
  ingest(
    @Param('attemptId') attemptId: string,
    @Body() dto: ProctorEventDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.proctoring.ingestEvent(principal.tenantId!, attemptId, dto, principal, request);
  }

  @Get('attempts')
  @RequirePermissions(PERMISSIONS.ORG_PROCTORING_READ)
  @ApiOperation({ summary: 'List attempts with advisory risk signals' })
  list(@CurrentPrincipal() principal: Principal) {
    return this.proctoring.listAttempts(principal.tenantId!);
  }

  @Get('attempts/:attemptId')
  @RequirePermissions(PERMISSIONS.ORG_PROCTORING_READ)
  @ApiOperation({ summary: 'Proctoring detail for one attempt' })
  detail(@Param('attemptId') attemptId: string, @CurrentPrincipal() principal: Principal) {
    return this.proctoring.detail(principal.tenantId!, attemptId);
  }

  @Post('attempts/:attemptId/assess')
  @RequirePermissions(PERMISSIONS.ORG_PROCTORING_READ)
  @ApiOperation({ summary: 'Recompute an explainable risk assessment' })
  assess(
    @Param('attemptId') attemptId: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.proctoring.assess(principal.tenantId!, attemptId, principal, request);
  }

  @Patch('events/:eventId')
  @RequirePermissions(PERMISSIONS.ORG_PROCTORING_READ)
  @ApiOperation({ summary: 'Mark an event investigated or uninvestigated' })
  investigate(
    @Param('eventId') eventId: string,
    @Body() dto: InvestigateEventDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.proctoring.investigateEvent(principal.tenantId!, eventId, dto, principal, request);
  }

  @Post('assessments/:assessmentId/review')
  @RequirePermissions(PERMISSIONS.ORG_PROCTORING_READ)
  @ApiOperation({ summary: 'Record human review of a risk assessment' })
  review(
    @Param('assessmentId') assessmentId: string,
    @Body() dto: ReviewRiskDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.proctoring.reviewAssessment(principal.tenantId!, assessmentId, dto, principal, request);
  }
}
