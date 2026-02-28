export declare class CloudTasksService {
    private readonly logger;
    private client;
    private project;
    private queue;
    private location;
    private taskApiUrl;
    constructor();
    private initializeClient;
    queueDocumentIndexing(documentId: string, organizationId?: string): Promise<string | null>;
    queueWorkOrderIndexing(workOrderId: string, organizationId?: string): Promise<string | null>;
    isAvailable(): boolean;
    getQueueInfo(): {
        project: string;
        location: string;
        queue: string;
        url: string | null;
    } | null;
}
