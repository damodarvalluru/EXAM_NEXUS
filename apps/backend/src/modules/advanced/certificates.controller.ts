import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import type { Response } from 'express';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import type { RequestWithContext } from '../../common/middleware/request-context.middleware';
import { IssueCertificateDto, RevokeCertificateDto } from './dto';
import { CertificatesService } from './certificates.service';

@ApiTags('phase-7 certificates')
@TenantScoped()
@Controller('advanced/certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Public()
  @Get('verify')
  @ApiOperation({ summary: 'Public verification by certificate code' })
  verify(@Query('code') code: string | undefined) {
    return this.certificates.verify(code ?? '');
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ORG_CERTIFICATES_MANAGE)
  @ApiOperation({ summary: 'List issued certificates' })
  list(@Query('resultId') resultId: string | undefined, @CurrentPrincipal() principal: Principal) {
    return this.certificates.list(principal.tenantId!, resultId);
  }

  @Post('issue')
  @RequirePermissions(PERMISSIONS.ORG_CERTIFICATES_MANAGE)
  @ApiOperation({ summary: 'Issue a certificate from a published, passing result' })
  issue(
    @Body() dto: IssueCertificateDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.certificates.issue(principal.tenantId!, dto.resultId, principal, request);
  }

  @Get(':id/pdf')
  @RequirePermissions(PERMISSIONS.ORG_CERTIFICATES_MANAGE)
  @ApiOperation({ summary: 'Download a generated certificate PDF' })
  async pdf(
    @Param('id') id: string,
    @CurrentPrincipal() principal: Principal,
    @Res() response: Response,
  ): Promise<void> {
    const pdf = await this.certificates.pdf(principal.tenantId!, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${pdf.fileName}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.send(pdf.data);
  }

  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.ORG_CERTIFICATES_MANAGE)
  @ApiOperation({ summary: 'Revoke a certificate' })
  revoke(
    @Param('id') id: string,
    @Body() dto: RevokeCertificateDto,
    @CurrentPrincipal() principal: Principal,
    @Req() request: RequestWithContext,
  ) {
    return this.certificates.revoke(principal.tenantId!, id, dto.reason, principal, request);
  }
}
