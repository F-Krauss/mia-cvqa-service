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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AiGateway_1;
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const work_order_ai_service_1 = require("./work-order-ai.service");
const ai_pubsub_service_1 = require("../queue/ai-pubsub.service");
const ai_service_1 = require("./ai.service");
const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL
    || process.env.COMPLIANCE_API_BASE_URL
    || process.env.VITE_OCR_API_BASE_URL
    || 'http://localhost:8000';
const CHAT_CONTEXT_ENRICH_TIMEOUT_MS = Math.max(500, Number(process.env.CHAT_CONTEXT_ENRICH_TIMEOUT_MS || 1_800));
let AiGateway = AiGateway_1 = class AiGateway {
    aiService;
    workOrderAiService;
    aiPubSubService;
    server;
    logger = new common_1.Logger(AiGateway_1.name);
    constructor(aiService, workOrderAiService, aiPubSubService) {
        this.aiService = aiService;
        this.workOrderAiService = workOrderAiService;
        this.aiPubSubService = aiPubSubService;
    }
    buildUserQuery(payload) {
        const message = payload?.message || {};
        return (String(message?.appliedProcedure || '').trim() ||
            String(message?.output || '').trim() ||
            String(message?.evidence || '').trim());
    }
    async enrichTechnicianChatPayload(payload, user, organizationId) {
        const context = payload?.context || {};
        const userQuery = this.buildUserQuery(payload);
        const threadHistory = Array.isArray(payload?.threadHistory)
            ? payload.threadHistory
            : [];
        if (!context?.machineName || !context?.failureDescription) {
            return payload;
        }
        try {
            const enrichmentPromise = context?.workOrderId
                ? this.aiService.enrichTechnicianContextWithCache(context.workOrderId, context, userQuery, organizationId, threadHistory)
                : this.aiService.enrichTechnicianContext(context, organizationId, {
                    userQuery,
                    conversationHistory: threadHistory,
                });
            const enrichedContextOrTimeout = await Promise.race([
                enrichmentPromise,
                new Promise((resolve) => setTimeout(() => resolve('__timeout__'), CHAT_CONTEXT_ENRICH_TIMEOUT_MS)),
            ]);
            if (enrichedContextOrTimeout === '__timeout__') {
                this.logger.warn(`Technician context enrichment timed out at ${CHAT_CONTEXT_ENRICH_TIMEOUT_MS}ms; proceeding with base context.`);
                if (context?.workOrderId) {
                    this.aiService
                        .preloadWorkOrderContext(context.workOrderId, context, organizationId)
                        .catch((error) => this.logger.warn(`Background preload after enrichment timeout failed: ${error?.message || error}`));
                }
                return payload;
            }
            const enrichedContext = enrichedContextOrTimeout;
            return { ...payload, context: enrichedContext };
        }
        catch (error) {
            this.logger.warn(`Technician context enrichment failed for gateway stream: ${error?.message || error}`);
            return payload;
        }
    }
    afterInit() {
        this.aiPubSubService.setEmitter((clientId, event, data) => {
            this.server.to(clientId).emit(event, data);
        });
        this.logger.log('AI Gateway initialized. Pub/Sub emitter registered.');
    }
    handleConnection(client) {
        this.logger.log(`Client connected: ${client.id}`);
    }
    handleDisconnect(client) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }
    async handleRequestReport(data, client) {
        this.logger.log(`Received request-report from ${client.id}`);
        try {
            const result = await this.workOrderAiService.generateReportStream(data.payload, data.user, data.organizationId, (chunk) => {
                client.emit('report-chunk', { chunk });
            });
            this.logger.log(`Report stream completed for ${client.id}`);
            client.emit('report-complete', { success: true, result });
        }
        catch (error) {
            this.logger.error(`Error generating report stream for ${client.id}:`, error);
            client.emit('report-error', { message: error.message });
        }
    }
    async handleRequestChatStream(data, client) {
        this.logger.log(`Received request-chat-stream from ${client.id}`);
        try {
            const organizationId = data.organizationId || data.user?.organizationId;
            const safePayload = data?.payload || {};
            const enrichedPayload = await this.enrichTechnicianChatPayload(safePayload, data.user, organizationId);
            const result = await this.workOrderAiService.chatStream(enrichedPayload, data.user, organizationId, (chunk) => {
                client.emit('chat-chunk', { chunk });
                client.emit('chat-stream-chunk', { chunk });
            });
            const selectedProcedure = safePayload?.message?.selectedSolution ||
                safePayload?.message?.appliedProcedure ||
                enrichedPayload?.context?.currentSelectedProcedure ||
                '';
            if (String(selectedProcedure || '').trim()) {
                this.aiService
                    .recordTechnicianProcedureSelection({
                    workOrderId: enrichedPayload?.context?.workOrderId,
                    context: enrichedPayload?.context,
                    selectedProcedure,
                    organizationId,
                })
                    .catch((error) => this.logger.warn(`Failed to update technician selection reinforcement from stream: ${error?.message || error}`));
            }
            this.logger.log(`Chat stream completed for ${client.id}`);
            client.emit('chat-complete', { success: true, result });
            client.emit('chat-stream-complete', { success: true, result });
        }
        catch (error) {
            this.logger.error(`Error generating chat stream for ${client.id}:`, error);
            client.emit('chat-error', { message: error.message });
            client.emit('chat-stream-error', { message: error.message });
        }
    }
    async dispatchAiTask(taskType, data, client) {
        client.emit(`${taskType}-ack`, { queued: true });
        await this.aiPubSubService.publishTask({
            taskType,
            clientId: client.id,
            payload: data.payload,
            user: data.user,
            organizationId: data.organizationId,
        });
    }
    async handleRequestDiagnosis(data, client) {
        this.logger.log(`Received request-diagnosis from ${client.id}`);
        await this.dispatchAiTask('diagnosis', data, client);
    }
    async handleRequestOperatorPlan(data, client) {
        this.logger.log(`Received request-operator-plan from ${client.id}`);
        await this.dispatchAiTask('operator-plan', data, client);
    }
    async handleRequestTroubleshootingStep(data, client) {
        this.logger.log(`Received request-troubleshooting-step from ${client.id}`);
        await this.dispatchAiTask('troubleshooting-step', data, client);
    }
    async handleRequestResolutionDraft(data, client) {
        this.logger.log(`Received request-resolution-draft from ${client.id}`);
        await this.dispatchAiTask('resolution-draft', data, client);
    }
    async handleRequestEscalationDraft(data, client) {
        this.logger.log(`Received request-escalation-draft from ${client.id}`);
        await this.dispatchAiTask('escalation-draft', data, client);
    }
    async handleRequestTechnicianChat(data, client) {
        this.logger.log(`Received request-technician-chat from ${client.id}`);
        await this.dispatchAiTask('technician-chat', data, client);
    }
    async handleRequestTechnicianImageCheck(data, client) {
        this.logger.log(`Received request-technician-image-check from ${client.id}`);
        await this.dispatchAiTask('technician-image-check', data, client);
    }
    async handleOcrTemplate(data, client) {
        this.logger.log(`Received request-ocr-template from ${client.id}`);
        client.emit('ocr-template-progress', { status: 'Processing image...', stage: 'preprocessing' });
        try {
            const formData = this.buildOcrFormData(data);
            if (data.options?.accuracy_mode)
                formData.append('accuracy_mode', data.options.accuracy_mode);
            if (data.options?.confidence_threshold)
                formData.append('confidence_threshold', data.options.confidence_threshold);
            client.emit('ocr-template-progress', { status: 'Generating template with AI...', stage: 'ai_processing' });
            const result = await this.forwardToOcrService('/compliance/templates', formData);
            this.logger.log(`OCR template completed for ${client.id}`);
            client.emit('ocr-template-complete', { success: true, result });
        }
        catch (error) {
            this.logger.error(`OCR template error for ${client.id}:`, error);
            client.emit('ocr-template-error', { message: error.message || 'OCR template generation failed' });
        }
    }
    async handleOcrExtract(data, client) {
        this.logger.log(`Received request-ocr-extract from ${client.id}`);
        client.emit('ocr-extract-progress', { status: 'Processing image...', stage: 'preprocessing' });
        try {
            const formData = this.buildOcrFormData(data);
            formData.append('schema', JSON.stringify(data.schema));
            if (data.options?.accuracy_mode)
                formData.append('accuracy_mode', data.options.accuracy_mode);
            if (data.options?.confidence_threshold)
                formData.append('confidence_threshold', data.options.confidence_threshold);
            if (data.options?.verify_extraction)
                formData.append('verify_extraction', data.options.verify_extraction);
            client.emit('ocr-extract-progress', { status: 'Extracting data with AI...', stage: 'ai_processing' });
            const result = await this.forwardToOcrService('/compliance/extract', formData);
            this.logger.log(`OCR extract completed for ${client.id}`);
            client.emit('ocr-extract-complete', { success: true, result });
        }
        catch (error) {
            this.logger.error(`OCR extract error for ${client.id}:`, error);
            client.emit('ocr-extract-error', { message: error.message || 'OCR data extraction failed' });
        }
    }
    async handleOcrVerify(data, client) {
        this.logger.log(`Received request-ocr-verify from ${client.id}`);
        client.emit('ocr-verify-progress', { status: 'Preparing verification...', stage: 'preprocessing' });
        try {
            const formData = this.buildOcrFormData(data);
            formData.append('extracted_data', JSON.stringify(data.extractedData));
            formData.append('schema', JSON.stringify(data.schema));
            if (data.options?.accuracy_mode)
                formData.append('accuracy_mode', data.options.accuracy_mode);
            if (data.options?.strict_validation)
                formData.append('strict_validation', data.options.strict_validation);
            if (data.options?.auto_correct_threshold)
                formData.append('auto_correct_threshold', data.options.auto_correct_threshold);
            client.emit('ocr-verify-progress', { status: 'Verifying extraction with AI...', stage: 'ai_processing' });
            const result = await this.forwardToOcrService('/compliance/verify-ocr', formData);
            this.logger.log(`OCR verify completed for ${client.id}`);
            client.emit('ocr-verify-complete', { success: true, result });
        }
        catch (error) {
            this.logger.error(`OCR verify error for ${client.id}:`, error);
            client.emit('ocr-verify-error', { message: error.message || 'OCR verification failed' });
        }
    }
    buildOcrFormData(data) {
        const buffer = Buffer.from(data.fileBase64, 'base64');
        const blob = new Blob([buffer], { type: data.mimeType });
        const formData = new FormData();
        formData.append('file', blob, data.fileName);
        return formData;
    }
    async forwardToOcrService(path, formData) {
        const url = `${OCR_SERVICE_URL}${path}`;
        const response = await fetch(url, {
            method: 'POST',
            body: formData,
        });
        const text = await response.text();
        if (!response.ok) {
            let message = text;
            try {
                const parsed = JSON.parse(text);
                if (parsed?.detail)
                    message = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
                else if (parsed?.message)
                    message = parsed.message;
            }
            catch {
            }
            throw new Error(message || `OCR service returned ${response.status}`);
        }
        return text ? JSON.parse(text) : undefined;
    }
};
exports.AiGateway = AiGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], AiGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-report'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleRequestReport", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-chat-stream'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleRequestChatStream", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-diagnosis'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleRequestDiagnosis", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-operator-plan'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleRequestOperatorPlan", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-troubleshooting-step'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleRequestTroubleshootingStep", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-resolution-draft'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleRequestResolutionDraft", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-escalation-draft'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleRequestEscalationDraft", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-technician-chat'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleRequestTechnicianChat", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-technician-image-check'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleRequestTechnicianImageCheck", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-ocr-template'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleOcrTemplate", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-ocr-extract'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleOcrExtract", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('request-ocr-verify'),
    __param(0, (0, websockets_1.MessageBody)()),
    __param(1, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], AiGateway.prototype, "handleOcrVerify", null);
exports.AiGateway = AiGateway = AiGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: {
            origin: '*',
        },
    }),
    __metadata("design:paramtypes", [typeof (_a = typeof ai_service_1.AiService !== "undefined" && ai_service_1.AiService) === "function" ? _a : Object, work_order_ai_service_1.WorkOrderAiService,
        ai_pubsub_service_1.AiPubSubService])
], AiGateway);
//# sourceMappingURL=ai.gateway.js.map