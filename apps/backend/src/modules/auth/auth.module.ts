import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CommonModule } from '../../common/common.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { PrincipalService } from './principal.service';
import { SessionService } from './session.service';

@Module({
  imports: [CommonModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, PrincipalService, SessionService],
  exports: [AuthService, TokenService, PrincipalService, SessionService],
})
export class AuthModule {}
