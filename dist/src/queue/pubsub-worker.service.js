"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PubSubWorkerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PubSubWorkerService = void 0;
const common_1 = require("@nestjs/common");
const pubsub_1 = require("@google-cloud/pubsub");
const document_indexing_service_1 = require("../documents/document-indexing.service");
let PubSubWorkerService = PubSubWorkerService_1 = class PubSubWorkerService {
    documentIndexing;
    logger = new common_1.Logger(PubSubWorkerService_1.name);
    pubSubClient;
    subscription;
    maxConcurrent = Math.max(1, Number(process.env.PUBSUB_MAX_CONCURRENT || process.env.DATABASE_POOL_MAX || 3));
    inFlight = 0;
    constructor(documentIndexing) {
        this.documentIndexing = documentIndexing;
        const projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
        if (projectId) {
            this.pubSubClient = new pubsub_1.PubSub({ projectId });
        }
        else {
            this.pubSubClient = new pubsub_1.PubSub();
        }
    }
    async onModuleInit() {
        this.logger.log('Initializing Pub/Sub Worker...');
        this.startListening();
    }
    async onModuleDestroy() {
        if (this.subscription) {
            await this.subscription.close();
            this.logger.log('Pub/Sub Subscription closed.');
        }
    }
    isNonRetryableError(error) {
        const statusCode = Number(error?.statusCode ??
            error?.status ??
            error?.response?.statusCode ??
            error?.response?.status);
        if (Number.isFinite(statusCode) && [400, 401, 403, 404, 409, 422].includes(statusCode)) {
            return true;
        }
        const code = String(error?.code || '').toUpperCase().trim();
        if (code === 'P2025' || code === 'NOT_FOUND') {
            return true;
        }
        const message = String(error?.message || '').toLowerCase();
        return [
            'not found',
            'bad request',
            'invalid',
            'malformed',
            'missing',
            'forbidden',
            'unauthorized',
        ].some((token) => message.includes(token));
    }
    startListening() {
        if (!this.pubSubClient)
            return;
        const subscriptionName = process.env.PUBSUB_DOCUMENT_PROCESSING_SUBSCRIPTION || 'document-processing-sub';
        try {
            this.subscription = this.pubSubClient.subscription(subscriptionName, {
                flowControl: { maxMessages: this.maxConcurrent },
            });
            this.subscription.on('message', async (message) => {
                if (this.inFlight >= this.maxConcurrent) {
                    message.nack();
                    return;
                }
                this.inFlight++;
                try {
                    const dataString = message.data.toString();
                    let payload;
                    try {
                        payload = JSON.parse(dataString);
                    }
                    catch (parseError) {
                        this.logger.warn(`[PubSub] Invalid JSON in message ${message.id}. Acking without retry: ${parseError?.message || parseError}`);
                        message.ack();
                        return;
                    }
                    const attempt = Number(message?.deliveryAttempt || 1);
                    this.logger.log(`[PubSub] Received message ${message.id} for doc: ${payload.documentId} (attempt ${attempt}, inFlight: ${this.inFlight}/${this.maxConcurrent})`);
                    if (payload.action !== 'process_embeddings' || !payload.documentId) {
                        this.logger.warn(`[PubSub] Ignoring unsupported payload in message ${message.id}. Acking without retry.`);
                        message.ack();
                        return;
                    }
                    await this.documentIndexing.handleIndexingTask(payload.documentId, payload.organizationId);
                    this.logger.log(`[PubSub] Successfully processed doc: ${payload.documentId}`);
                    message.ack();
                }
                catch (error) {
                    if (this.isNonRetryableError(error)) {
                        this.logger.warn(`[PubSub] Non-retryable failure for message ${message.id}. Acking to avoid poison-loop: ${error?.message || error}`);
                        message.ack();
                    }
                    else {
                        this.logger.error(`[PubSub] Retryable failure for message ${message.id}: ${error?.message}`, error?.stack);
                        message.nack();
                    }
                }
                finally {
                    this.inFlight--;
                }
            });
            this.subscription.on('error', (error) => {
                this.logger.error(`[PubSub] Subscription error: ${error.message}`);
            });
            this.logger.log(`[PubSub] Listening to subscription [${subscriptionName}]`);
        }
        catch (error) {
            this.logger.warn(`[PubSub] Failed to attach to subscription [${subscriptionName}]: ${error?.message}`);
        }
    }
};
exports.PubSubWorkerService = PubSubWorkerService;
exports.PubSubWorkerService = PubSubWorkerService = PubSubWorkerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [document_indexing_service_1.DocumentIndexingService])
], PubSubWorkerService);
//# sourceMappingURL=pubsub-worker.service.js.map