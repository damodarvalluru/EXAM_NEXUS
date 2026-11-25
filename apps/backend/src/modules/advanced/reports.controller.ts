import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Principal } from '@examnexus/shared';
import type { Response } from 'express';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScoped } from '../../common/decorators/tenant-scoped.decorator';
import { ReportQueryDto } from './dto';
import { ReportsService } from './reports.service';

@ApiTags('phase-7 reporting')
@TenantScoped()
@Controller('advanced/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('exams')
  @RequirePermissions(PERMISSIONS.ORG_REPORTS_READ)
  @ApiOperation({ summary: 'Tenant examination analytics built from persisted records' })
  exams(@Query() query: ReportQueryDto, @CurrentPrincipal() principal: Principal) {
    return this.reports.examinationAnalytics(principal.tenantId!, query);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.ORG_REPORTS_READ)
  @ApiOperation({ summary: 'Export the selected report section as CSV' })
  async export(
    @Query() query: ReportQueryDto,
    @CurrentPrincipal() principal: Principal,
    @Res() response: Response,
  ): Promise<void> {
    const csv = await this.reports.exportCsv(principal.tenantId!, query);
    const suffix = query.examinationId ? `-${query.examinationId.slice(0, 8)}` : '';
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="examnexus-${query.kind ?? 'exams'}${suffix}.csv"`);
    response.setHeader('Cache-Control', 'no-store');
    response.send(csv);
  }
}
