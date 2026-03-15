import { PrismaService } from '../prisma/prisma.service';
export declare class CvqaService {
    private readonly prisma;
    private readonly vertexAI;
    private readonly model;
    constructor(prisma: PrismaService);
    private generateContentWithRetry;
    compareVisionQuality(files: {
        manual?: Express.Multer.File[];
        object_file?: Express.Multer.File[];
        golden?: Express.Multer.File[];
    }, paramsString: string, user?: any, organizationId?: string): Promise<{
        status: string;
        summary: any;
        issues: string[];
        missing: string[];
        confidence: any;
        checks: any;
    }>;
    validateRulesLogic(rules: any[]): Promise<{
        status: 'valid' | 'invalid';
        message?: string;
    }>;
    saveTrainingExample(organizationId: string, userId: string, inputPayload: any, originalOutput: any, correctedOutput: any): Promise<{
        success: boolean;
        exampleId: any;
    }>;
}
