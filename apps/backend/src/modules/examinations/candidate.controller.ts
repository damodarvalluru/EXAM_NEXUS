import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@examnexus/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { AttemptsService } from './attempts.service';
import { SaveAnswerDto, SubmitAttemptDto } from './dto/examination.dto';

/** Candidate-facing examination portal. Access is tied to the linked candidate profile. */
@ApiTags('candidate-examinations')
@TenantScoped()
@Controller('candidate')
export class CandidateController {
  constructor(private readonly attempts: AttemptsService) {}

  @Get('exams')
  @ApiOperation({ summary: 'List examinations available to the current candidate' })
  availableExams(@CurrentPrincipal() principal: Principal) {
    return this.attempts.availableExams(principal.tenantId!, principal);
  }

  @Post('exams/:examId/start')
  @ApiOperation({ summary: 'Start or resume an examination attempt' })
  start(
    @Param('examId') examId: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.attempts.start(principal.tenantId!, examId, principal, request);
  }

  @Get('attempts')
  @ApiOperation({ summary: 'List the current candidate’s attempts' })
  history(@CurrentPrincipal() principal: Principal) {
    return this.attempts.history(principal.tenantId!, principal);
  }

  @Get('attempts/:attemptId')
  @ApiOperation({ summary: 'Get an attempt with candidate-safe questions and saved answers' })
  attempt(@Param('attemptId') attemptId: string, @CurrentPrincipal() principal: Principal) {
    return this.attempts.getAttempt(principal.tenantId!, attemptId, principal);
  }

  @Put('attempts/:attemptId/answers')
  @ApiOperation({ summary: 'Autosave an answer with idempotency protection' })
  saveAnswer(
    @Param('attemptId') attemptId: string,
    @Body() dto: SaveAnswerDto,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.attempts.saveAnswer(principal.tenantId!, attemptId, dto, principal);
  }

  @Post('attempts/:attemptId/submit')
  @ApiOperation({ summary: 'Submit an attempt and receive a receipt hash' })
  submit(
    @Param('attemptId') attemptId: string,
    @Body() dto: SubmitAttemptDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.attempts.submit(principal.tenantId!, attemptId, dto, principal, request);
  }

  @Get('attempts/:attemptId/result')
  @ApiOperation({ summary: 'Get a published candidate result' })
  result(@Param('attemptId') attemptId: string, @CurrentPrincipal() principal: Principal) {
    return this.attempts.result(principal.tenantId!, attemptId, principal);
  }
}
