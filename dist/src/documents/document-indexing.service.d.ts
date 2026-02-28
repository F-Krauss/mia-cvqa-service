import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentAiAnalyzerService } from './document-ai-analyzer.service';
import { CloudTasksService } from '../queue/cloud-tasks.service';
import { VectorStoreService } from '../ai/vector-store.service';
export declare class DocumentIndexingService implements OnModuleInit, OnModuleDestroy {
    private readonly prisma;
    private readonly aiAnalyzer;
    private readonly cloudTasks;
    private readonly vectorStore;
    private readonly gcsStorage?;
    private readonly bucketName;
    private storageDriver;
    private readonly localRoot;
    private readonly logger;
    private readonly sweepEnabled;
    private readonly sweepIntervalMs;
    private readonly sweepBatchSize;
    private sweepTimer;
    private isSweepRunning;
    constructor(prisma: PrismaService, aiAnalyzer: DocumentAiAnalyzerService, cloudTasks: CloudTasksService, vectorStore: VectorStoreService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    private bucket;
    private resolveBucketName;
    private resolveDocumentOrganizationId;
    private readDocumentBuffer;
    private setFailedIndexingStatuses;
    private setPendingIndexingStatuses;
    private queueOrAnalyzeDocument;
    requestDocumentIndexing(documentId: string, organizationId?: string, options?: {
        force?: boolean;
        sourceBuffer?: Buffer;
        preferDirect?: boolean;
    }): Promise<boolean>;
    queuePendingDocumentIndexing(limit?: number): Promise<number>;
    handleIndexingTask(documentId: string, organizationId?: string): Promise<{
        success: true;
        skipped?: boolean;
        reason?: string;
    } | {
        success: true;
        indexed: true;
    }>;
}
