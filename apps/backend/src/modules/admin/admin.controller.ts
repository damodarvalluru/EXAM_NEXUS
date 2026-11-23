import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireStepUp } from '../../common/decorators/require-step-up.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { AdminService } from './admin.service';
import {
  AdminQueryDto,
  CreatePlatformUserDto,
  RotatePinDto,
  UpdatePlatformUserRoleDto,
  UpdatePlatformUserStatusDto,
} from './dto/admin.dto';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.PLATFORM_ORGANISATIONS_READ)
  @ApiOperation({ summary: 'Live platform overview metrics' })
  overview() {
    return this.admin.overview();
  }

  @Get('users')
  @RequirePermissions(PERMISSIONS.PLATFORM_USERS_READ)
  @ApiOperation({ summary: 'List platform users with filters and pagination' })
  users(@Query() query: AdminQueryDto) {
    return this.admin.listUsers(query);
  }

  @Post('users')
  @RequirePermissions(PERMISSIONS.PLATFORM_USERS_MANAGE)
  @ApiOperation({ summary: 'Create a platform user' })
  createUser(@Body() dto: CreatePlatformUserDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.admin.createPlatformUser(dto, principal, request);
  }

  @Patch('users/:id/status')
  @RequirePermissions(PERMISSIONS.PLATFORM_USERS_MANAGE)
  @ApiOperation({ summary: 'Change a platform user status' })
  updateUserStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePlatformUserStatusDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.updateUserStatus(id, dto.status, principal, request);
  }

  @Patch('users/:id/role')
  @RequirePermissions(PERMISSIONS.PLATFORM_USERS_MANAGE)
  @ApiOperation({ summary: 'Change a platform user global role' })
  updateUserRole(
    @Param('id') id: string,
    @Body() dto: UpdatePlatformUserRoleDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.updatePlatformUserRole(id, dto, principal, request);
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.PLATFORM_ROLES_READ)
  @ApiOperation({ summary: 'Global role catalogue' })
  roles(@Query() query: AdminQueryDto) {
    return this.admin.roles(query);
  }

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.PLATFORM_ROLES_READ)
  @ApiOperation({ summary: 'Permission catalogue' })
  permissions() {
    return this.admin.permissions();
  }

  @Get('auth-events')
  @RequirePermissions(PERMISSIONS.PLATFORM_AUTH_EVENTS_READ)
  @ApiOperation({ summary: 'Search authentication events' })
  authEvents(@Query() query: AdminQueryDto) {
    return this.admin.authEvents(query);
  }

  @Get('audit-logs')
  @RequirePermissions(PERMISSIONS.PLATFORM_AUDIT_READ)
  @ApiOperation({ summary: 'Search platform audit logs' })
  auditLogs(@Query() query: AdminQueryDto) {
    return this.admin.auditLogs(query);
  }

  @Post('super-admins/:id/rotate-pin')
  @RequireStepUp()
  @RequirePermissions(PERMISSIONS.PLATFORM_SECURITY_MANAGE)
  @ApiOperation({ summary: 'Rotate a Super Admin PIN (requires step-up authentication)' })
  rotatePin(
    @Param('id') id: string,
    @Body() dto: RotatePinDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.admin.rotatePin(id, dto, principal, request);
  }
}
