export declare class CvqaService {
    private readonly vertexAI;
    private readonly model;
    constructor();
    private generateContentWithRetry;
    verifyWorkInstructionStep(payload: {
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
    }, user?: any, organizationId?: string): Promise<any>;
}
