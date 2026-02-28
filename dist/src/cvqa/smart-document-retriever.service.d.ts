import { PrismaService } from '../prisma/prisma.service';
export declare class SmartDocumentRetrieverService {
    private readonly prisma;
    private readonly logger;
    private readonly vertexAI;
    private readonly model;
    constructor(prisma: PrismaService);
    findRelevantDocuments(query: string, candidateDocumentIds: string[], maxResults?: number): Promise<string[]>;
    private aiBasedRetrieval;
    private keywordBasedRetrieval;
    private logVertexResponse;
    private logVertexError;
    private extractVertexPreview;
    getDocumentContext(documentIds: string[]): Promise<Array<{
        id: string;
        name: string;
        summary: string;
        tags: string[];
    }>>;
}
