import { PrismaService } from '../prisma/prisma.service';
import { VectorStoreService } from '../ai/vector-store.service';
import { DoclingParserService } from './docling-parser.service';
export declare class DocumentAiAnalyzerService {
    private readonly prisma;
    private readonly vectorStore;
    private readonly doclingParser;
    private readonly logger;
    private readonly vertexAI;
    private readonly model;
    constructor(prisma: PrismaService, vectorStore: VectorStoreService, doclingParser: DoclingParserService);
    private resolveBucketName;
    private extractText;
    private isSupportedDoclingImageMimeType;
    private cleanSingleLine;
    private normalizeStringArray;
    private extractJsonObject;
    private inferDocTypeBySignals;
    private extractSafetyInstructionsFromText;
    private buildFallbackMetadata;
    private generateMetadata;
    private logVertexResponse;
    private logVertexError;
    private extractVertexPreview;
    analyzeDocument(documentId: string, buffer: Buffer, organizationId?: string): Promise<void>;
    processPendingDocuments(): Promise<void>;
}
