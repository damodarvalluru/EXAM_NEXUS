import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { ExaminationsService } from './examinations.service';
import {
  BulkQuestionsDto,
  CreateCandidateCredentialsDto,
  CreateExaminationDto,
  CreateQuestionBankDto,
  EligibilityDto,
  ExaminationQueryDto,
  UpdateExamStatusDto,
  UpdateExaminationDto,
  UpdateQuestionDto,
} from './dto/examination.dto';

@ApiTags('examinations')
@TenantScoped()
@Controller('examinations')
export class ExaminationsController {
  constructor(private readonly examinations: ExaminationsService) {}

  @Get('question-banks')
  @RequirePermissions(PERMISSIONS.ORG_QUESTION_BANK_READ)
  @ApiOperation({ summary: 'List tenant question banks' })
  banks(@CurrentPrincipal() principal: Principal) {
    return this.examinations.listBanks(principal.tenantId!);
  }

  @Post('question-banks')
  @RequirePermissions(PERMISSIONS.ORG_QUESTION_BANK_MANAGE)
  @ApiOperation({ summary: 'Create a question bank' })
  createBank(@Body() dto: CreateQuestionBankDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.examinations.createBank(principal.tenantId!, dto, principal, request);
  }

  @Post('question-banks/:bankId/questions')
  @RequirePermissions(PERMISSIONS.ORG_QUESTION_BANK_MANAGE)
  @ApiOperation({ summary: 'Add one or many questions to a bank (max 200)' })
  createQuestions(
    @Param('bankId') bankId: string,
    @Body() dto: BulkQuestionsDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.examinations.createQuestions(principal.tenantId!, bankId, dto, principal, request);
  }

  @Get('questions')
  @RequirePermissions(PERMISSIONS.ORG_QUESTION_BANK_READ)
  @ApiOperation({ summary: 'List questions, optionally filtered by bank' })
  questions(@Query('bankId') bankId: string | undefined, @CurrentPrincipal() principal: Principal) {
    return this.examinations.listQuestions(principal.tenantId!, bankId);
  }

  @Patch('questions/:questionId')
  @RequirePermissions(PERMISSIONS.ORG_QUESTION_BANK_MANAGE)
  @ApiOperation({ summary: 'Update a question and its options' })
  updateQuestion(
    @Param('questionId') questionId: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.examinations.updateQuestion(principal.tenantId!, questionId, dto, principal, request);
  }

  @Delete('questions/:questionId')
  @RequirePermissions(PERMISSIONS.ORG_QUESTION_BANK_MANAGE)
  @ApiOperation({ summary: 'Delete an unused question' })
  deleteQuestion(
    @Param('questionId') questionId: string,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.examinations.deleteQuestion(principal.tenantId!, questionId, principal, request);
  }

  @Get('attempts')
  @RequirePermissions(PERMISSIONS.ORG_EXAMINATIONS_READ)
  @ApiOperation({ summary: 'List examination attempts for live monitoring' })
  attempts(@Query('examinationId') examId: string | undefined, @CurrentPrincipal() principal: Principal) {
    return this.examinations.listAttempts(principal.tenantId!, examId);
  }

  @Post('candidates/:candidateId/credentials')
  @RequirePermissions(PERMISSIONS.ORG_CANDIDATES_MANAGE)
  @ApiOperation({ summary: 'Enable candidate portal access with a password' })
  createCredentials(
    @Param('candidateId') candidateId: string,
    @Body() dto: CreateCandidateCredentialsDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.examinations.createCandidateCredentials(principal.tenantId!, candidateId, dto, principal, request);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ORG_EXAMINATIONS_READ)
  @ApiOperation({ summary: 'List examinations with filters and pagination' })
  list(@Query() query: ExaminationQueryDto, @CurrentPrincipal() principal: Principal) {
    return this.examinations.list(principal.tenantId!, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ORG_EXAMINATIONS_MANAGE)
  @ApiOperation({ summary: 'Create a draft examination with sections and security policy' })
  create(@Body() dto: CreateExaminationDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.examinations.create(principal.tenantId!, dto, principal, request);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ORG_EXAMINATIONS_READ)
  @ApiOperation({ summary: 'Examination detail including sections and question count' })
  detail(@Param('id') id: string, @CurrentPrincipal() principal: Principal) {
    return this.examinations.detail(principal.tenantId!, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ORG_EXAMINATIONS_MANAGE)
  @ApiOperation({ summary: 'Update a draft examination' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExaminationDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.examinations.update(principal.tenantId!, id, dto, principal, request);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.ORG_EXAMINATIONS_MANAGE)
  @ApiOperation({ summary: 'Validate and publish an immutable examination version' })
  publish(@Param('id') id: string, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.examinations.publish(principal.tenantId!, id, principal, request);
  }

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.ORG_EXAMINATIONS_MANAGE)
  @ApiOperation({ summary: 'Transition examination status (LIVE, PAUSED, COMPLETED, CANCELLED)' })
  status(
    @Param('id') id: string,
    @Body() dto: UpdateExamStatusDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.examinations.updateStatus(principal.tenantId!, id, dto, principal, request);
  }

  @Get(':id/eligibility')
  @RequirePermissions(PERMISSIONS.ORG_EXAMINATIONS_READ)
  @ApiOperation({ summary: 'List candidates eligible for an examination' })
  eligibility(@Param('id') id: string, @CurrentPrincipal() principal: Principal) {
    return this.examinations.listEligibility(principal.tenantId!, id);
  }

  @Post(':id/eligibility')
  @RequirePermissions(PERMISSIONS.ORG_EXAMINATIONS_MANAGE)
  @ApiOperation({ summary: 'Replace the eligible candidate list' })
  setEligibility(
    @Param('id') id: string,
    @Body() dto: EligibilityDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.examinations.setEligibility(principal.tenantId!, id, dto, principal, request);
  }

  @Get(':id/attempts')
  @RequirePermissions(PERMISSIONS.ORG_LIVE_MONITORING)
  @ApiOperation({ summary: 'List attempts for a single examination' })
  examAttempts(@Param('id') id: string, @CurrentPrincipal() principal: Principal) {
    return this.examinations.listAttempts(principal.tenantId!, id);
  }
}
