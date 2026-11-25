import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EvaluationStatus, PROCTOR_EVENT_TYPES, type ProctorEventType } from '@examnexus/shared';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;
}

export class ReviewAnswerDto {
  @IsString()
  @MaxLength(36)
  questionId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000)
  marks!: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  feedback?: string;

  @IsEnum({ COMPLETED: EvaluationStatus.COMPLETED, REVISION: EvaluationStatus.REVISION })
  status!: 'COMPLETED' | 'REVISION';
}

export class ReviewEvaluationDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReviewAnswerDto)
  answers!: ReviewAnswerDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class EvaluatorAssignmentItemDto {
  @IsString()
  @MaxLength(36)
  questionId!: string;

  @IsString()
  @MaxLength(36)
  evaluatorId!: string;

  @IsOptional()
  @IsBoolean()
  blind?: boolean;
}

export class AssignEvaluatorsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EvaluatorAssignmentItemDto)
  assignments!: EvaluatorAssignmentItemDto[];
}

export class ReopenEvaluationDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(36, { each: true })
  questionIds?: string[];

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class SchedulePublicationDto {
  @IsDateString()
  publishAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

const PROCTOR_EVENT_ENUM: Record<string, string> = Object.fromEntries(
  PROCTOR_EVENT_TYPES.map((value) => [value, value]),
);

export class ProctorEventDto {
  @IsEnum(PROCTOR_EVENT_ENUM)
  eventType!: ProctorEventType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  sessionToken?: string;

  @IsOptional()
  evidence?: Record<string, unknown>;
}

export class RegisterSessionDto {
  @IsString()
  @MaxLength(36)
  attemptId!: string;

  @IsString()
  @MaxLength(200)
  deviceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  clientVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  integrityAttestation?: string;
}

export class RotateSessionTokenDto {
  @IsString()
  @MinLength(16)
  @MaxLength(1024)
  sessionToken!: string;
}

export class ReviewRiskDto {
  @IsOptional()
  @IsBoolean()
  investigated?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appealStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class IssueCertificateDto {
  @IsString()
  @MaxLength(36)
  resultId!: string;
}

export class ApproveResultDto {
  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class PublishResultDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RejectResultDto {
  @IsString()
  @MaxLength(2000)
  note!: string;
}

export class WithholdResultDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RevokeCertificateDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ReportQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(36)
  examinationId?: string;

  @IsOptional()
  @IsEnum({ EXAMS: 'exams', RESULTS: 'results', QUESTIONS: 'questions', RISK: 'risk', CERTIFICATES: 'certificates' })
  kind?: 'exams' | 'results' | 'questions' | 'risk' | 'certificates';
}

export class ResultQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(36)
  examinationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  departmentId?: string;

  @IsOptional()
  @IsEnum({ PENDING: 'PENDING', UNDER_REVIEW: 'UNDER_REVIEW', APPROVED: 'APPROVED', PUBLISHED: 'PUBLISHED', REVISION: 'REVISION', WITHHELD: 'WITHHELD' })
  status?: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'REVISION' | 'WITHHELD';
}

export class InvestigateEventDto {
  @IsBoolean()
  investigated!: boolean;
}
