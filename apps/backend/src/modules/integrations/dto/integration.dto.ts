import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IntegrationAuthType } from '@examnexus/shared';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class IntegrationQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  status?: string;
}

export class CreateIntegrationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  provider!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsEnum(IntegrationAuthType)
  authType!: IntegrationAuthType;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: false })
  webhookUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  webhookEvents?: string[];
}

export class UpdateIntegrationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateStatusDto {
  @IsString()
  @IsIn(['CONFIGURATION_PENDING', 'AUTHENTICATION_PENDING', 'VERIFICATION_PENDING', 'CONNECTED', 'SYNC_ACTIVE', 'WARNING', 'FAILED', 'SUSPENDED', 'REVOKED', 'NOT_CONNECTED'])
  status!: string;
}

export class StoreCredentialDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  keyId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  secret!: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class RotateCredentialDto {
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  secret!: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

export class GrantScopesDto {
  @IsArray()
  @MaxLength(50)
  @IsString({ each: true })
  permissions!: string[];
}

export class TestConnectionDto {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: false })
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  method?: 'GET' | 'POST';
}

export class SyncDto {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: false })
  url?: string;

  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class CreateWebhookDto {
  @IsUrl({ protocols: ['https'], require_tld: false })
  url!: string;

  @IsArray()
  @MinLength(1, { each: true })
  @MaxLength(20, { each: true })
  events!: string[];
}

export class CreateApiClientDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class CreateApiKeyDto {
  @IsArray()
  @MinLength(1, { each: true })
  @MaxLength(50, { each: true })
  scopes!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class IngestCandidateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  candidateCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName!: string;

  @IsString()
  @MinLength(1)
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

export class IngestCandidatesDto {
  @IsArray()
  @MaxLength(500)
  @ValidateNested({ each: true })
  @Type(() => IngestCandidateDto)
  candidates!: IngestCandidateDto[];

  /** Optional client-credentials grant; also accepted via headers or HTTP Basic. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientSecret?: string;
}

export class RevokeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RetryWebhookDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export class AcquireTokenDto {
  @IsIn(['CLIENT_CREDENTIALS', 'AUTHORIZATION_CODE'])
  grantType!: 'CLIENT_CREDENTIALS' | 'AUTHORIZATION_CODE';

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: false })
  tokenUrl?: string;

  /** OIDC issuer; when supplied the token endpoint is discovered over HTTPS. */
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: false })
  issuer?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  clientId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  clientSecret!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  code?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: false })
  redirectUri?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  codeVerifier?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  keyId?: string;
}

/** Starts the browser-based authorization-code (PKCE) flow for an integration. */
export class CreateOAuthAuthorizeDto {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: false })
  authorizeUrl?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  clientId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  clientSecret!: string;

  /** Browser redirect target. HTTPS is required except for local development loopback. */
  @IsUrl({ protocols: ['https', 'http'], require_tld: false })
  redirectUri!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}

/** Callback values read from the provider redirect and posted by the authenticated UI. */
export class OAuthCallbackDto {
  @IsString()
  @MinLength(10)
  @MaxLength(256)
  state!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}

export class VerifyMappingDto {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: false })
  url?: string;

  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  sampleLimit?: number;
}

export class ImportCsvDto {
  @IsString()
  @MaxLength(2_000_000)
  csv!: string;

  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsIn([',', ';', '\t'])
  delimiter?: ',' | ';' | '\t';
}

export class LifecycleDto {
  @IsIn(['activate', 'pause', 'revoke', 'reset'])
  action!: 'activate' | 'pause' | 'revoke' | 'reset';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
