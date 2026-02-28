import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CvqaService } from './cvqa.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { Request } from 'express';

type VerifyWorkInstructionStepPayload = {
  goldenSampleUrl: string;
  validationImageUrl: string;
  rules?: Array<{
    id: string;
    description: string;
    highlight?: { x: number; y: number; w: number; h: number };
    color?: string;
  }>;
};

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class CvqaController {
  constructor(
    private readonly cvqaService: CvqaService,
  ) { }

  @Post('verify-step')
  @ApiOperation({ summary: 'Verifies a work instruction step using Computer Vision QA' })
  @ApiResponse({ status: 200, description: 'Step verification complete' })
  async verifyWorkInstructionStep(
    @Body() payload: VerifyWorkInstructionStepPayload,
    @Req() req: Request,
  ) {
    if (!payload?.goldenSampleUrl || !payload?.validationImageUrl) {
      throw new BadRequestException('goldenSampleUrl and validationImageUrl are required');
    }
    const user = (req as any).user;
    const organizationId = (req as any).organizationId || user?.organizationId;
    return this.cvqaService.verifyWorkInstructionStep(payload, user, organizationId);
  }
}
