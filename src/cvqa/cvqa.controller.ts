import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CvqaService } from './cvqa.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class CvqaController {
  constructor(
    private readonly cvqaService: CvqaService,
  ) { }

  @Post('vision/compare')
  @ApiOperation({ summary: 'Compare vision quality using manual, object, and golden files' })
  @ApiResponse({ status: 200, description: 'Comparison complete' })
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'manual', maxCount: 1 },
    { name: 'object_file', maxCount: 1 },
    { name: 'golden', maxCount: 1 },
  ]))
  async compareVisionQuality(
    @UploadedFiles() files: {
      manual?: Express.Multer.File[],
      object_file?: Express.Multer.File[],
      golden?: Express.Multer.File[]
    },
    @Body('params') paramsString: string,
    @Req() req: any,
  ) {
    if (!files?.object_file?.[0] && !files?.manual?.[0]) {
      throw new BadRequestException('At least object_file or manual is required');
    }
    const user = req.user;
    const organizationId = req.organizationId || user?.organizationId;
    return this.cvqaService.compareVisionQuality(files, paramsString, user, organizationId);
  }
}
