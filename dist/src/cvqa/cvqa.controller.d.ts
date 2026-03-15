import { CvqaService } from './cvqa.service';
export declare class CvqaController {
    private readonly cvqaService;
    constructor(cvqaService: CvqaService);
    compareVisionQuality(files: {
        manual?: Express.Multer.File[];
        object_file?: Express.Multer.File[];
        golden?: Express.Multer.File[];
    }, paramsString: string, req: any): Promise<{
        status: string;
        summary: any;
        issues: string[];
        missing: string[];
        confidence: any;
        checks: any;
    }>;
    validateRulesLogic(rules: any[]): Promise<{
        status: "valid" | "invalid";
        message?: string;
    }>;
    submitVisionFeedback(payload: {
        inputPayload: any;
        originalOutput: any;
        correctedOutput: any;
    }, req: any): Promise<{
        success: boolean;
        exampleId: any;
    }>;
}
