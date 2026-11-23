import { IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class PlatformAdminQueryDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(80) status?: string;
  @IsOptional() @IsString() @MaxLength(80) severity?: string;
  @IsOptional() @IsString() @MaxLength(80) tenantId?: string;
  @IsOptional() @IsIn(['7d', '30d', '90d']) range?: '7d' | '30d' | '90d';
}

export class UpdateAlertDto {
  @IsString() @IsIn(['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED', 'FALSE_POSITIVE'])
  status!: string;

  @IsOptional() @IsString() @MaxLength(36) assignee?: string;
}

export class UpdateIncidentDto {
  @IsOptional() @IsString() @IsIn(['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED', 'FALSE_POSITIVE'])
  status?: string;

  @IsOptional() @IsString() @MaxLength(36) assignee?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsArray() @IsString({ each: true }) @MaxLength(20) responseActions?: string[];
}

export class CreateSupportTicketDto {
  @IsString() @IsNotEmpty() @MaxLength(300) subject!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) category!: string;
  @IsString() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) priority!: string;
  @IsString() @IsNotEmpty() @MaxLength(10000) body!: string;
  @IsOptional() @IsString() @MaxLength(36) tenantId?: string;
}

export class UpdateSupportTicketDto {
  @IsOptional() @IsString() @IsIn(['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']) status?: string;
  @IsOptional() @IsString() @MaxLength(36) assignee?: string;
  @IsOptional() @IsString() @MaxLength(10000) resolution?: string;
}

export class UpdateSettingDto {
  @IsObject() value!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}
