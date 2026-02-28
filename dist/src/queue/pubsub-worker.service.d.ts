import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DocumentIndexingService } from '../documents/document-indexing.service';
export declare class PubSubWorkerService implements OnModuleInit, OnModuleDestroy {
    private readonly documentIndexing;
    private readonly logger;
    private pubSubClient?;
    private subscription?;
    private readonly maxConcurrent;
    private inFlight;
    constructor(documentIndexing: DocumentIndexingService);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    private isNonRetryableError;
    private startListening;
}
