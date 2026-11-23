import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Difficulty, ExamStatus, ExamType, QuestionType, SecurityProfile } from '@examnexus/shared';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateQuestionBankDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;
}

export class QuestionOptionDto {
  @IsString()
  @MaxLength(20)
  label!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class CreateQuestionDto {
  @IsEnum(QuestionType)
  type!: QuestionType;

  @IsString()
  @MinLength(1)
  prompt!: string;

  @IsNumber()
  @Min(0)
  marks!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  negativeMarks?: number;

  @IsOptional()
  @IsEnum(Difficulty)
  difficulty?: Difficulty;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  explanation?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  prompt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  marks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  negativeMarks?: number;

  @IsOptional()
  @IsEnum(Difficulty)
  difficulty?: Difficulty;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  explanation?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];
}

export class BulkQuestionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions!: CreateQuestionDto[];
}

export class ExamSectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsNumber()
  @Min(0)
  marks!: number;

  @IsArray()
  @IsString({ each: true })
  questionIds!: string[];
}

export class ExamSecurityPolicyDto {
  @IsOptional()
  @IsEnum(SecurityProfile)
  profile?: SecurityProfile;

  @IsOptional()
  @IsBoolean()
  requireFullscreen?: boolean;

  @IsOptional()
  @IsBoolean()
  tabSwitchEvents?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  screenCapturePolicy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cameraPolicy?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permittedUrls?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  reconnectionLimit?: number;
}

export class CreateExaminationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsEnum(ExamType)
  type!: ExamType;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  instructions?: string;

  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes!: number;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxAttempts?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  passingMarks?: number;

  @IsNumber()
  @Min(0)
  totalMarks!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  negativeMarking?: number;

  @IsOptional()
  @IsBoolean()
  randomiseQuestions?: boolean;

  @IsOptional()
  @IsBoolean()
  randomiseOptions?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamSectionDto)
  sections?: ExamSectionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ExamSecurityPolicyDto)
  securityPolicy?: ExamSecurityPolicyDto;
}

export class UpdateExaminationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  instructions?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  passingMarks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalMarks?: number;

  @IsOptional()
  @IsBoolean()
  randomiseQuestions?: boolean;

  @IsOptional()
  @IsBoolean()
  randomiseOptions?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamSectionDto)
  sections?: ExamSectionDto[];
}

export class ExaminationQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ExamStatus)
  status?: ExamStatus;
}

export class UpdateExamStatusDto {
  @IsEnum(ExamStatus)
  status!: ExamStatus;
}

export class EligibilityDto {
  @IsArray()
  @MaxLength(500, { each: true })
  @IsString({ each: true })
  candidateIds!: string[];
}

export class CreateCandidateCredentialsDto {
  @IsString()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  password!: string;
}

export class SaveAnswerDto {
  @IsString()
  questionId!: string;

  // Answer shape depends on question type (string | string[] | object).
  @IsObject()
  answer!: { value: unknown };

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;
}

export class SubmitAttemptDto {
  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  clientTime?: string;
}
