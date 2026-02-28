import { CvqaService } from './cvqa.service';
import type { Request } from 'express';
import { AiUsageService } from './ai-usage.service';
import { AiRemoteService } from './ai-remote.service';
type VerifyWorkInstructionStepPayload = {
    goldenSampleUrl: string;
    validationImageUrl: string;
    rules?: Array<{
        id: string;
        description: string;
        highlight?: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        color?: string;
    }>;
};
export declare class CvqaController {
    private readonly cvqaService;
    private readonly aiUsageService;
    private readonly aiRemoteService;
    constructor(cvqaService: CvqaService, aiUsageService: AiUsageService, aiRemoteService: AiRemoteService);
    verifyWorkInstructionStep(payload: VerifyWorkInstructionStepPayload, req: Request): Promise<any>;
}
export {};
