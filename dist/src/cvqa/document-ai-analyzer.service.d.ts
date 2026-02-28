import { PrismaService } from '../prisma/prisma.service';
export declare class DocumentAiAnalyzerService {
    private readonly prisma;
    private readonly logger;
    private readonly vertexAI;
    private readonly model;
    constructor(prisma: PrismaService);
    private extractText;
    private generateMetadata;
    private logVertexResponse;
    private logVertexError;
    private extractVertexPreview;
    analyzeDocument(documentId: string, buffer: Buffer): Promise<void>;
    processPendingDocuments(): Promise<void>;
}
