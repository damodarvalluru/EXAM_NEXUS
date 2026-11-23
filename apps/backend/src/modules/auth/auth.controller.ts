import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { ERROR_CODES } from '@examnexus/shared';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import type { Principal } from '@examnexus/shared';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { AuthService } from './auth.service';
import { SessionService, REFRESH_TOKEN_TTL_SECONDS } from './session.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  MfaConfirmDto,
  MfaVerifyDto,
  PinLoginDto,
  ResetPasswordDto,
  StepUpDto,
  VerifyEmailDto,
  VerifyPhoneDto,
} from './dto/auth.dto';

const REFRESH_COOKIE = 'ex_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Password login for every account type' })
  async login(@Body() dto: LoginDto, @Req() request: RequestWithContext, @Res({ passthrough: true }) response: Response) {
    const outcome = await this.auth.login(dto, request);
    if (outcome.refreshToken) this.setRefreshCookie(response, outcome.refreshToken);
    return outcome.result;
  }

  @Public()
  @Post('pin')
  @ApiOperation({ summary: 'Dedicated Super Admin PIN login (requires MFA)' })
  async pinLogin(@Body() dto: PinLoginDto, @Req() request: RequestWithContext, @Res({ passthrough: true }) response: Response) {
    const outcome = await this.auth.pinLogin(dto, request);
    if (outcome.refreshToken) this.setRefreshCookie(response, outcome.refreshToken);
    return outcome.result;
  }

  @Public()
  @Post('mfa/verify')
  @ApiOperation({ summary: 'Complete an MFA challenge with TOTP or a recovery code' })
  async verifyMfa(
    @Body() dto: MfaVerifyDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.auth.verifyMfa(dto, request);
    this.setRefreshCookie(response, outcome.refreshToken ?? '');
    return outcome.result;
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the refresh cookie and issue a new access token' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertOrigin(request);
    const token = this.readRefreshCookie(request);
    const outcome = await this.auth.refresh(token, request);
    this.setRefreshCookie(response, outcome.refreshToken ?? '');
    return outcome.result;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(principal.sessionId ?? '', request);
    this.clearRefreshCookie(response);
    return { success: true };
  }

  @Get('me')
  @ApiOperation({ summary: 'Current authenticated user' })
  async me(@CurrentPrincipal() principal: Principal) {
    return this.auth.userView(principal.userId);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Active sessions for the current user' })
  async listSessions(@CurrentPrincipal() principal: Principal) {
    return this.sessions.list(principal.userId, principal.sessionId);
  }

  @Post('sessions/:id/revoke')
  @ApiOperation({ summary: 'Revoke one session' })
  async revokeSession(@Param('id') id: string): Promise<{ success: true }> {
    await this.sessions.revoke(id);
    return { success: true };
  }

  @Post('step-up')
  @ApiOperation({ summary: 'Obtain a short-lived step-up token' })
  async stepUp(@Body() dto: StepUpDto, @CurrentPrincipal() principal: Principal, @Req() request: RequestWithContext) {
    return this.auth.stepUp(
      dto,
      {
        userId: principal.userId,
        tenantId: principal.tenantId,
        sessionId: principal.sessionId ?? '',
        authMethod: principal.authMethod ?? 'PASSWORD',
      },
      request,
    );
  }

  @Post('mfa/enroll')
  @ApiOperation({ summary: 'Begin TOTP enrollment' })
  async enrollMfa(@CurrentPrincipal() principal: Principal) {
    return this.auth.enrollMfa(principal.userId);
  }

  @Post('mfa/confirm')
  @ApiOperation({ summary: 'Confirm enrollment and receive one-time recovery codes' })
  async confirmMfa(@Body() dto: MfaConfirmDto, @CurrentPrincipal() principal: Principal) {
    return this.auth.confirmMfa(principal.userId, dto.code);
  }

  @Post('mfa/recovery-codes')
  @ApiOperation({ summary: 'Regenerate recovery codes (requires current TOTP code)' })
  async regenerateRecoveryCodes(@Body() dto: MfaConfirmDto, @CurrentPrincipal() principal: Principal) {
    return this.auth.regenerateRecoveryCodes(principal.userId, dto.code);
  }

  @Post('phone/request')
  @ApiOperation({ summary: 'Request a phone verification OTP' })
  async requestPhoneOtp(@CurrentPrincipal() principal: Principal) {
    return this.auth.requestPhoneOtp(principal.userId);
  }

  @Post('phone/verify')
  @ApiOperation({ summary: 'Verify a phone OTP' })
  async verifyPhone(@Body() dto: VerifyPhoneDto, @CurrentPrincipal() principal: Principal) {
    return this.auth.verifyPhone(principal.userId, dto.code);
  }

  @Post('password/change')
  @ApiOperation({ summary: 'Change password and revoke all sessions' })
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentPrincipal() principal: Principal) {
    return this.auth.changePassword(principal.userId, dto);
  }

  @Public()
  @Post('password/forgot')
  @ApiOperation({ summary: 'Issue a single-use password reset token' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password/reset')
  @ApiOperation({ summary: 'Reset a password with a valid token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @Public()
  @Post('verify-email')
  @ApiOperation({ summary: 'Verify an organisation administrators email address' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    const production = this.config.get<string>('app.environment') === 'production';
    const options: CookieOptions = {
      httpOnly: true,
      secure: production,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    };
    const domain = this.config.get<string>('app.cookieDomain');
    if (domain && domain !== 'localhost') options.domain = domain;
    response.cookie(REFRESH_COOKIE, refreshToken, options);
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  private readRefreshCookie(request: Request): string {
    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const token = cookies[REFRESH_COOKIE];
    if (!token) {
      throw new ForbiddenException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Refresh token is missing',
      });
    }
    return token;
  }

  private assertOrigin(request: Request): void {
    if (this.config.get<string>('app.environment') !== 'production') return;
    const origin = request.header('origin');
    const expected = this.config.getOrThrow<string>('app.corsOrigin');
    if (!origin || origin !== expected) {
      throw new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message: 'Origin check failed' });
    }
  }
}
