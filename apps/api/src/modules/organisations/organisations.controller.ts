import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PERMISSIONS,
  type Principal,
} from '@examnexus/shared';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { OrganisationsService } from './organisations.service';
import {
  AcceptInvitationDto,
  AssignRolesDto,
  CreateCandidateDto,
  CreateRoleDto,
  DocumentUploadDto,
  InviteUserDto,
  OrganisationQueryDto,
  RegisterOrganisationDto,
  ReviewOrganisationDto,
  UpdateOrganisationDto,
  UpdateRoleDto,
  UpdateUserStatusDto,
} from './dto/organisation.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('organisations')
@Controller('organisations')
export class OrganisationsController {
  constructor(private readonly organisations: OrganisationsService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Public organisation registration and verification submission' })
  register(@Body() dto: RegisterOrganisationDto) {
    return this.organisations.register(dto);
  }

  @Public()
  @Post('invitations/accept')
  @ApiOperation({ summary: 'Accept an organisation invitation and set a password' })
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.organisations.acceptInvitation(dto);
  }

  @Public()
  @Get('slug/:slug')
  @ApiOperation({ summary: 'Resolve an organisation by slug (public profile data only)' })
  findBySlug(@Param('slug') slug: string) {
    return this.organisations.findBySlug(slug);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_ORGANISATIONS_READ)
  @ApiOperation({ summary: 'List organisations with filters and pagination' })
  list(@Query() query: OrganisationQueryDto) {
    return this.organisations.list(query);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_DASHBOARD_READ)
  @Get('me/dashboard')
  @ApiOperation({ summary: 'Organisation administrator dashboard from live tenant data' })
  dashboard(@CurrentPrincipal() principal: Principal) {
    return this.organisations.dashboard(principal.tenantId!);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_DASHBOARD_READ)
  @Get('me')
  @ApiOperation({ summary: 'Current organisation profile' })
  me(@CurrentPrincipal() principal: Principal) {
    return this.organisations.dashboard(principal.tenantId!);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_PROFILE_MANAGE)
  @Patch('me')
  @ApiOperation({ summary: 'Update organisation profile and branding' })
  updateProfile(@Body() dto: UpdateOrganisationDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.organisations.updateProfile(principal.tenantId!, dto, principal, request);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_USERS_READ)
  @Get('me/users')
  @ApiOperation({ summary: 'List organisation members' })
  listUsers(@Query() query: PaginationDto, @CurrentPrincipal() principal: Principal) {
    return this.organisations.listMembers(principal.tenantId!, query);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_USERS_MANAGE)
  @Post('me/users')
  @ApiOperation({ summary: 'Invite an organisation user' })
  inviteUser(@Body() dto: InviteUserDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.organisations.inviteUser(principal.tenantId!, dto, principal, request);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_USERS_MANAGE)
  @Post('me/users/:userId/status')
  @ApiOperation({ summary: 'Change an organisation user status' })
  updateUserStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.organisations.updateUserStatus(principal.tenantId!, userId, dto, principal, request);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_USERS_MANAGE)
  @Post('me/users/:userId/roles')
  @ApiOperation({ summary: 'Replace an organisation user role assignments' })
  assignRoles(
    @Param('userId') userId: string,
    @Body() dto: AssignRolesDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.organisations.assignRoles(principal.tenantId!, userId, dto, principal, request);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_ROLES_READ)
  @Get('me/permissions')
  @ApiOperation({ summary: 'Global permission catalogue available to tenant roles' })
  permissions() {
    return this.organisations.permissions();
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_ROLES_READ)
  @Get('me/roles')
  @ApiOperation({ summary: 'List organisation roles and their permissions' })
  listRoles(@CurrentPrincipal() principal: Principal) {
    return this.organisations.listRoles(principal.tenantId!);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_ROLES_MANAGE)
  @Post('me/roles')
  @ApiOperation({ summary: 'Create a custom organisation role' })
  createRole(@Body() dto: CreateRoleDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.organisations.createRole(principal.tenantId!, dto, principal, request);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_ROLES_MANAGE)
  @Patch('me/roles/:roleId')
  @ApiOperation({ summary: 'Update a custom organisation role' })
  updateRole(
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.organisations.updateRole(principal.tenantId!, roleId, dto, principal, request);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_ROLES_MANAGE)
  @Delete('me/roles/:roleId')
  @ApiOperation({ summary: 'Delete a custom organisation role' })
  deleteRole(@Param('roleId') roleId: string, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.organisations.deleteRole(principal.tenantId!, roleId, principal, request);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_CANDIDATES_READ)
  @Get('me/candidates')
  @ApiOperation({ summary: 'List candidates in the current organisation' })
  listCandidates(@Query() query: PaginationDto, @CurrentPrincipal() principal: Principal) {
    return this.organisations.listCandidates(principal.tenantId!, query);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_CANDIDATES_MANAGE)
  @Post('me/candidates')
  @ApiOperation({ summary: 'Register a candidate in the current organisation' })
  createCandidate(@Body() dto: CreateCandidateDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.organisations.createCandidate(principal.tenantId!, dto, principal, request);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_CANDIDATES_MANAGE)
  @Post('me/candidates/:candidateId/status')
  @ApiOperation({ summary: 'Update candidate status' })
  updateCandidateStatus(
    @Param('candidateId') candidateId: string,
    @Body() body: { status: string },
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.organisations.updateCandidateStatus(principal.tenantId!, candidateId, body.status, principal, request);
  }

  @TenantScoped()
  @RequirePermissions(PERMISSIONS.ORG_PROFILE_MANAGE)
  @Post('me/documents')
  @ApiOperation({ summary: 'Upload a verification document (base64, max 10 MB)' })
  uploadDocument(
    @Body() dto: DocumentUploadDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.organisations.uploadDocument(principal.tenantId!, principal.tenantId!, dto, principal, request);
  }

  @RequirePermissions(PERMISSIONS.PLATFORM_VERIFICATION_REVIEW)
  @Get(':id/document')
  @ApiOperation({ summary: 'Download a verification document for review' })
  async downloadDocument(
    @Param('id') id: string,
    @Query('key') key: string,
    @CurrentPrincipal() principal: Principal,
    @Res() response: Response,
  ): Promise<void> {
    const document = await this.organisations.readDocument(principal.tenantId, id, key);
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="${document.fileName}"`);
    response.end(document.bytes);
  }

  @RequirePermissions(PERMISSIONS.PLATFORM_ORGANISATIONS_READ)
  @Get(':id')
  @ApiOperation({ summary: 'Organisation detail with verification history and counts' })
  detail(@Param('id') id: string) {
    return this.organisations.detail(id);
  }

  @RequirePermissions(PERMISSIONS.PLATFORM_VERIFICATION_REVIEW, PERMISSIONS.PLATFORM_ORGANISATIONS_MANAGE)
  @Post(':id/review')
  @ApiOperation({ summary: 'Approve, reject, suspend or request more information' })
  review(
    @Param('id') id: string,
    @Body() dto: ReviewOrganisationDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.organisations.review(id, dto, principal, request);
  }
}
