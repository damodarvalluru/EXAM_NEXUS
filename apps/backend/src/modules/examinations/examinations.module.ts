import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AttemptsService } from './attempts.service';
import { CandidateController } from './candidate.controller';
import { ExaminationsController } from './examinations.controller';
import { ExaminationsService } from './examinations.service';

/** Phase 4: question banks, exam engine, attempts, submissions, candidate portal and live delivery. */
@Module({
  imports: [CommonModule, RealtimeModule],
  controllers: [ExaminationsController, CandidateController],
  providers: [ExaminationsService, AttemptsService],
  exports: [ExaminationsService, AttemptsService],
})
export class ExaminationsModule {}
