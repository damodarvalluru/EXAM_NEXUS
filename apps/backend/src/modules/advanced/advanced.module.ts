import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { ExaminationsModule } from '../examinations/examinations.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { ProctoringController } from './proctoring.controller';
import { ProctoringService } from './proctoring.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

/** Phase 7: AI-assisted evaluation, proctoring, advanced reporting and certificates. */
@Module({
  imports: [CommonModule, ExaminationsModule],
  controllers: [
    EvaluationController,
    ResultsController,
    ProctoringController,
    ReportsController,
    CertificatesController,
  ],
  providers: [
    EvaluationService,
    ResultsService,
    ProctoringService,
    ReportsService,
    CertificatesService,
  ],
  exports: [
    EvaluationService,
    ResultsService,
    ProctoringService,
    ReportsService,
    CertificatesService,
  ],
})
export class AdvancedModule {}
