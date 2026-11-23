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
