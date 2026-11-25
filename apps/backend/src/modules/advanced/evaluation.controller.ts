import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { AssignEvaluatorsDto, ReopenEvaluationDto, ReviewEvaluationDto } from './dto';
import { EvaluationService } from './evaluation.service';

@ApiTags('phase-7 evaluation')
@TenantScoped()
@Controller('advanced/evaluations')
export class EvaluationController {
  constructor(private readonly evaluations: EvaluationService) {}

  @Get('queue')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_READ)
  @ApiOperation({ summary: 'Submitted attempts awaiting subjective evaluation' })
  queue(@CurrentPrincipal() principal: Principal) {
    return this.evaluations.queue(principal.tenantId!);
  }

  @Get(':attemptId')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_READ)
  @ApiOperation({ summary: 'Blind-capable subjective answer review detail' })
  detail(
    @Param('attemptId') attemptId: string,
    @Query('blind') blind: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.evaluations.detail(principal.tenantId!, attemptId, blind === 'true', principal);
  }

  @Post(':attemptId/ai-suggestions/:questionId')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Create an explainable AI mark suggestion; never applies marks' })
  suggest(
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.evaluations.suggest(principal.tenantId!, attemptId, questionId, principal, request);
  }

  @Get(':attemptId/history')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_READ)
  @ApiOperation({ summary: 'Immutable marks-change history for an attempt' })
  history(@Param('attemptId') attemptId: string, @CurrentPrincipal() principal: Principal) {
    return this.evaluations.markHistory(principal.tenantId!, attemptId);
  }

  @Post(':attemptId/assign')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Assign subjective questions to evaluators, optionally blind' })
  assign(
    @Param('attemptId') attemptId: string,
    @Body() dto: AssignEvaluatorsDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.evaluations.assignEvaluators(principal.tenantId!, attemptId, dto, principal, request);
  }

  @Post(':attemptId/reopen')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Reopen accepted marks for moderation and re-evaluation' })
  reopen(
    @Param('attemptId') attemptId: string,
    @Body() dto: ReopenEvaluationDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.evaluations.reopen(principal.tenantId!, attemptId, dto, principal, request);
  }

  @Post(':attemptId/review')
  @RequirePermissions(PERMISSIONS.ORG_EVALUATION_MANAGE)
  @ApiOperation({ summary: 'Record human decisions and recompute the result; marks accept two decimals' })
  review(
    @Param('attemptId') attemptId: string,
    @Body() dto: ReviewEvaluationDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.evaluations.review(principal.tenantId!, attemptId, dto, principal, request);
  }
}
