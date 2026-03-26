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
    { name: 'object_file', maxCount: 4 },
    { name: 'golden', maxCount: 4 },
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

  @Post('vision/validate-rules')
  @ApiOperation({ summary: 'Pre-validate physical and semantic logic of AI visual rules' })
  @ApiResponse({ status: 200, description: 'Rules validation complete' })
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'reference_image', maxCount: 1 },
  ]))
  async validateRulesLogic(
    @UploadedFiles() files: { reference_image?: Express.Multer.File[] },
    @Body('payload') payloadString?: string,
    @Body('rules') legacyRules?: any[],
  ) {
    let payload: Record<string, any> = { rules: legacyRules };
    if (payloadString) {
      try {
        payload = JSON.parse(payloadString);
      } catch (error) {
        throw new BadRequestException('Invalid payload JSON');
      }
    }
    if (!payload?.rules || !Array.isArray(payload.rules)) {
      throw new BadRequestException('Rules payload must be an array');
    }
    return this.cvqaService.validateRulesLogic(payload, files?.reference_image?.[0]);
  }

  @Post('vision/feedback')
  @ApiOperation({ summary: 'Save an AI training example when a CVQA result is manually overridden' })
  @ApiResponse({ status: 201, description: 'Training example saved' })
  async submitVisionFeedback(
    @Body() payload: { inputPayload: any; originalOutput: any; correctedOutput: any },
    @Req() req: any,
  ) {
    if (!payload.inputPayload || !payload.correctedOutput) {
      throw new BadRequestException('inputPayload and correctedOutput are required');
    }
    const user = req.user;
    const organizationId = req.organizationId || user?.organizationId;
    if (!user?.sub || !organizationId) {
      throw new BadRequestException('User and Organization ID required for feedback tracking');
    }
    return this.cvqaService.saveTrainingExample(
      organizationId,
      user.sub,
      payload.inputPayload,
      payload.originalOutput,
      payload.correctedOutput
    );
  }
}
