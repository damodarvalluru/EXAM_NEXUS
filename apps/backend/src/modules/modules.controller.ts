import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

const MODULE_STATUS = [
  { module: 'health', phase: 1, implemented: true },
  { module: 'auth', phase: 2, implemented: true },
  { module: 'organisations', phase: 3, implemented: true },
  { module: 'examinations', phase: 4, implemented: true },
  { module: 'integrations', phase: 5, implemented: true },
  { module: 'admin', phase: 2, implemented: true },
  { module: 'platform-administration', phase: 6, implemented: true },
  { module: 'realtime', phase: 4, implemented: true },
  { module: 'ai-evaluation', phase: 7, implemented: true },
  { module: 'results-approval', phase: 7, implemented: true },
  { module: 'proctoring', phase: 7, implemented: true },
  { module: 'advanced-reporting', phase: 7, implemented: true },
  { module: 'certificates', phase: 7, implemented: true },
  { module: 'load-testing', phase: 8, implemented: true },
  { module: 'disaster-recovery-tools', phase: 8, implemented: true },
  { module: 'penetration-testing', phase: 8, implemented: false },
  { module: 'independent-review', phase: 8, implemented: false },
] as const;

@Public()
@ApiTags('platform')
@Controller('modules')
export class ModulesController {
  @Get()
  @ApiOperation({ summary: 'Honest implementation status of backend modules' })
  status() {
    return MODULE_STATUS;
  }
}
