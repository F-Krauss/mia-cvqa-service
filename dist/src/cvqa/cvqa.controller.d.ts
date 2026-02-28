import { CvqaService } from './cvqa.service';
import type { Request } from 'express';
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
    constructor(cvqaService: CvqaService);
    verifyWorkInstructionStep(payload: VerifyWorkInstructionStepPayload, req: Request): Promise<any>;
}
export {};
