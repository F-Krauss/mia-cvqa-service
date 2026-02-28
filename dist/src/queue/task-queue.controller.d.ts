import { DocumentIndexingService } from '../documents/document-indexing.service';
import { VectorStoreService } from '../ai/vector-store.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
export declare class TaskQueueController {
    private readonly documentIndexing;
    private readonly vectorStore;
    private readonly prisma;
    private readonly aiService;
    private readonly logger;
    constructor(documentIndexing: DocumentIndexingService, vectorStore: VectorStoreService, prisma: PrismaService, aiService: AiService);
    indexDocument(body: {
        documentId: string;
        organizationId?: string;
    }): Promise<{
        documentId: string;
        success: true;
        skipped?: boolean;
        reason?: string;
    } | {
        documentId: string;
        success: true;
        indexed: true;
        skipped?: undefined;
        reason?: undefined;
    } | {
        success: boolean;
        skipped: boolean;
        reason: string;
        documentId: string;
    }>;
    indexWorkOrder(body: {
        workOrderId: string;
        organizationId?: string;
    }): Promise<{
        success: boolean;
        reason: string;
        workOrderId?: undefined;
    } | {
        success: boolean;
        workOrderId: string;
        reason?: undefined;
    }>;
    health(): Promise<{
        status: string;
        timestamp: Date;
    }>;
}
