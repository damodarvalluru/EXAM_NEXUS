import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  identifier!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

export class PinLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  identifier!: string;

  /** PINs are long secrets, never a four-digit bypass. */
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  pin!: string;
}

export class MfaVerifyDto {
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  recoveryCode?: string;
}

export class StepUpDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pin?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;
}

export class MfaConfirmDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;
}

export class VerifyPhoneDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPassword!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPassword!: string;
}
