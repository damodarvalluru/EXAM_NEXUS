import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AdminQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  outcome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tenantId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class UpdatePlatformUserStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'LOCKED'])
  status!: string;
}

export class RotatePinDto {
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPin!: string;
}

export class CreatePlatformUserDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;

  @IsIn(['SUPER_ADMIN', 'PLATFORM_STAFF', 'AUDITOR'])
  globalRole!: 'SUPER_ADMIN' | 'PLATFORM_STAFF' | 'AUDITOR';
}

export class UpdatePlatformUserRoleDto {
  @IsIn(['SUPER_ADMIN', 'PLATFORM_STAFF', 'AUDITOR'])
  globalRole!: 'SUPER_ADMIN' | 'PLATFORM_STAFF' | 'AUDITOR';
}
