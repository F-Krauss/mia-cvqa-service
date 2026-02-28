export declare class CvqaService {
    private readonly vertexAI;
    private readonly model;
    constructor();
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
}
