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
var AiPubSubService_1;
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiPubSubService = void 0;
const common_1 = require("@nestjs/common");
const pubsub_1 = require("@google-cloud/pubsub");
const ai_service_1 = require("../ai/ai.service");
const work_order_ai_service_1 = require("../ai/work-order-ai.service");
const TOPIC_NAME = process.env.AI_PUBSUB_TOPIC || 'ai-tasks-topic';
const SUBSCRIPTION_NAME = process.env.AI_PUBSUB_SUBSCRIPTION || 'ai-tasks-sub';
let AiPubSubService = AiPubSubService_1 = class AiPubSubService {
    aiService;
    workOrderAiService;
    logger = new common_1.Logger(AiPubSubService_1.name);
    pubSubClient;
    subscription;
    emitter;
    constructor(aiService, workOrderAiService) {
        this.aiService = aiService;
        this.workOrderAiService = workOrderAiService;
        const projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
        if (projectId) {
            this.pubSubClient = new pubsub_1.PubSub({ projectId });
        }
        else {
            this.pubSubClient = new pubsub_1.PubSub();
        }
    }
    setEmitter(emitter) {
        this.emitter = emitter;
    }
    async onModuleInit() {
        this.logger.log('Initializing AI Pub/Sub Worker...');
        this.startListening();
    }
    async onModuleDestroy() {
        if (this.subscription) {
            await this.subscription.close();
            this.logger.log('AI Pub/Sub Subscription closed.');
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
    async publishTask(message) {
        if (!this.pubSubClient) {
            this.logger.warn('PubSub client not initialized. Falling back to direct execution.');
            await this.processMessage(message);
            return undefined;
        }
        try {
            const dataBuffer = Buffer.from(JSON.stringify(message));
            const messageId = await this.pubSubClient
                .topic(TOPIC_NAME)
                .publishMessage({ data: dataBuffer });
            this.logger.log(`[AI PubSub] Published task ${message.taskType} (msg ${messageId}) for client ${message.clientId}`);
            return messageId;
        }
        catch (error) {
            this.logger.warn(`[AI PubSub] Failed to publish, falling back to direct execution: ${error?.message}`);
            await this.processMessage(message);
            return undefined;
        }
    }
    startListening() {
        if (!this.pubSubClient)
            return;
        try {
            this.subscription = this.pubSubClient.subscription(SUBSCRIPTION_NAME);
            this.subscription.on('message', async (message) => {
                try {
                    let payload;
                    try {
                        payload = JSON.parse(message.data.toString());
                    }
                    catch (parseError) {
                        this.logger.warn(`[AI PubSub] Invalid JSON in message ${message.id}. Acking without retry: ${parseError?.message || parseError}`);
                        message.ack();
                        return;
                    }
                    if (!payload?.taskType || !payload?.clientId) {
                        this.logger.warn(`[AI PubSub] Missing required fields in message ${message.id}. Acking without retry.`);
                        message.ack();
                        return;
                    }
                    this.logger.log(`[AI PubSub] Received ${payload.taskType} for client ${payload.clientId}`);
                    await this.processMessage(payload);
                    message.ack();
                }
                catch (error) {
                    if (this.isNonRetryableError(error)) {
                        this.logger.warn(`[AI PubSub] Non-retryable failure for message ${message.id}. Acking to avoid poison-loop: ${error?.message || error}`);
                        message.ack();
                    }
                    else {
                        this.logger.error(`[AI PubSub] Failed to process message ${message.id}: ${error?.message}`, error?.stack);
                        message.nack();
                    }
                }
            });
            this.subscription.on('error', (error) => {
                this.logger.error(`[AI PubSub] Subscription error: ${error.message}`);
            });
            this.logger.log(`[AI PubSub] Listening to subscription [${SUBSCRIPTION_NAME}]`);
        }
        catch (error) {
            this.logger.warn(`[AI PubSub] Failed to attach to subscription [${SUBSCRIPTION_NAME}]: ${error?.message}`);
        }
    }
    async processMessage(msg) {
        const { taskType, clientId, payload, user, organizationId } = msg;
        const responseEventMap = {
            'diagnosis': { complete: 'diagnosis-complete', error: 'diagnosis-error' },
            'operator-plan': { complete: 'operator-plan-complete', error: 'operator-plan-error' },
            'troubleshooting-step': { complete: 'troubleshooting-step-complete', error: 'troubleshooting-step-error' },
            'resolution-draft': { complete: 'resolution-draft-complete', error: 'resolution-draft-error' },
            'escalation-draft': { complete: 'escalation-draft-complete', error: 'escalation-draft-error' },
            'technician-chat': { complete: 'technician-chat-complete', error: 'technician-chat-error' },
            'technician-image-check': { complete: 'technician-image-check-complete', error: 'technician-image-check-error' },
        };
        const events = responseEventMap[taskType];
        if (!events) {
            this.logger.warn(`[AI PubSub] Unknown task type: ${taskType}`);
            return;
        }
        try {
            let result;
            switch (taskType) {
                case 'diagnosis':
                    result = await this.aiService.generateWorkOrderDiagnosis(payload, user, organizationId);
                    break;
                case 'operator-plan':
                    result = await this.aiService.generateWorkOrderOperatorPlan(payload, user, organizationId);
                    break;
                case 'troubleshooting-step':
                    result = await this.aiService.generateWorkOrderTroubleshootingNextStep(payload, user, organizationId);
                    break;
                case 'resolution-draft':
                    result = await this.aiService.generateWorkOrderResolutionDraft(payload, user, organizationId);
                    break;
                case 'escalation-draft':
                    result = await this.aiService.generateWorkOrderEscalationDraft(payload, user, organizationId);
                    break;
                case 'technician-chat': {
                    const userQuery = payload?.message?.appliedProcedure ||
                        payload?.message?.output ||
                        payload?.message?.evidence ||
                        payload?.message?.selectedSolution ||
                        '';
                    const enrichedContext = await this.aiService.enrichTechnicianContext(payload.context || {}, organizationId, {
                        userQuery,
                        conversationHistory: payload.threadHistory || [],
                    });
                    result = await this.workOrderAiService.chat({ ...payload, context: enrichedContext }, user, organizationId);
                    const selectedProcedure = payload?.message?.selectedSolution ||
                        payload?.message?.appliedProcedure ||
                        payload?.context?.currentSelectedProcedure ||
                        '';
                    if (selectedProcedure.trim()) {
                        this.aiService
                            .recordTechnicianProcedureSelection({
                            workOrderId: payload?.context?.workOrderId,
                            context: enrichedContext,
                            selectedProcedure,
                            organizationId,
                        })
                            .catch((error) => {
                            this.logger.warn(`[AI PubSub] Failed to persist technician selection reinforcement: ${error?.message || error}`);
                        });
                    }
                    break;
                }
                case 'technician-image-check': {
                    const enrichedCtx = await this.aiService.enrichTechnicianContext(payload.context || {}, organizationId, {
                        userQuery: payload.technicianQuestion,
                        conversationHistory: payload.threadHistory || [],
                    });
                    result = await this.workOrderAiService.analyzeImage({ ...payload, context: enrichedCtx }, user, organizationId);
                    break;
                }
            }
            this.emit(clientId, events.complete, { success: true, result });
        }
        catch (error) {
            this.logger.error(`[AI PubSub] Task ${taskType} failed: ${error?.message}`, error?.stack);
            this.emit(clientId, events.error, { message: error?.message || 'AI processing failed' });
        }
    }
    emit(clientId, event, data) {
        if (this.emitter) {
            this.emitter(clientId, event, data);
        }
        else {
            this.logger.warn(`[AI PubSub] No emitter registered. Result for ${clientId} lost.`);
        }
    }
};
exports.AiPubSubService = AiPubSubService;
exports.AiPubSubService = AiPubSubService = AiPubSubService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof ai_service_1.AiService !== "undefined" && ai_service_1.AiService) === "function" ? _a : Object, typeof (_b = typeof work_order_ai_service_1.WorkOrderAiService !== "undefined" && work_order_ai_service_1.WorkOrderAiService) === "function" ? _b : Object])
], AiPubSubService);
//# sourceMappingURL=ai-pubsub.service.js.map