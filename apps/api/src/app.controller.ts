import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('platform')
@Controller()
export class AppController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Platform identity' })
  info() {
    return { platform: 'ExamNexus', apiVersion: 'v1', phase: 3 };
  }
}
