import { Type } from 'class-transformer';
import {
  IsArray,
  IsBase64,
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import type { ReviewDecision } from '@examnexus/shared';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class RegisterAdminDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;

  @IsString()
  @MaxLength(120)
  firstName!: string;

  @IsString()
  @MaxLength(120)
  lastName!: string;
}

export class RegisterDocumentDto {
  @IsString()
  @MaxLength(120)
  documentType!: string;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  mimeType?: string;

  @IsString()
  @IsBase64()
  @MaxLength(12_000_000)
  contentBase64!: string;
}

export class RegisterOrganisationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @IsString()
  @Matches(SLUG_PATTERN)
  @MaxLength(120)
  slug!: string;

  @IsEmail()
  @MaxLength(320)
  officialEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  documentKeys?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterDocumentDto)
  documents?: RegisterDocumentDto[];

  @IsObject()
  admin!: RegisterAdminDto;
}

export class OrganisationQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED'])
  status?: string;
}

export class ReviewOrganisationDto {
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_INFO', 'SUSPEND', 'REACTIVATE'])
  decision!: ReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class UpdateOrganisationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  primaryColour?: string;

  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;
}

export class DocumentUploadDto {
  @IsString()
  @MaxLength(120)
  documentType!: string;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  mimeType?: string;

  @IsString()
  @IsBase64()
  @MaxLength(12_000_000)
  contentBase64!: string;
}

export class InviteUserDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MaxLength(120)
  firstName!: string;

  @IsString()
  @MaxLength(120)
  lastName!: string;

  @IsArray()
  @IsString({ each: true })
  roleNames!: string[];
}

export class AssignRolesDto {
  @IsArray()
  @IsString({ each: true })
  roleNames!: string[];
}

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
  status!: string;
}

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateRoleDto extends CreateRoleDto {}

export class CreateCandidateDto {
  @IsString()
  @MaxLength(80)
  candidateCode!: string;

  @IsString()
  @MaxLength(120)
  firstName!: string;

  @IsString()
  @MaxLength(120)
  lastName!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}

export class AcceptInvitationDto {
  @IsString()
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;
}

export class InviteQueryDto extends PaginationDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  verified?: boolean;
}
