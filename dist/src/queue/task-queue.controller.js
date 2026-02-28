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
var TaskQueueController_1;
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskQueueController = void 0;
const common_1 = require("@nestjs/common");
const document_indexing_service_1 = require("../documents/document-indexing.service");
const vector_store_service_1 = require("../ai/vector-store.service");
const prisma_service_1 = require("../prisma/prisma.service");
const ai_service_1 = require("../ai/ai.service");
let TaskQueueController = TaskQueueController_1 = class TaskQueueController {
    documentIndexing;
    vectorStore;
    prisma;
    aiService;
    logger = new common_1.Logger(TaskQueueController_1.name);
    constructor(documentIndexing, vectorStore, prisma, aiService) {
        this.documentIndexing = documentIndexing;
        this.vectorStore = vectorStore;
        this.prisma = prisma;
        this.aiService = aiService;
    }
    async indexDocument(body) {
        const { documentId, organizationId } = body;
        try {
            this.logger.log(`[TaskQueue] Processing document indexing for ${documentId}`);
            const result = await this.documentIndexing.handleIndexingTask(documentId, organizationId);
            this.logger.log(`[TaskQueue] Document ${documentId} indexing completed successfully`);
            return { ...result, documentId };
        }
        catch (error) {
            if (error?.message?.includes('not found') || error?.statusCode === 400) {
                this.logger.warn(`[TaskQueue] Document ${documentId} not found (likely deleted). Skipping indexing.`);
                return { success: true, skipped: true, reason: 'document_deleted', documentId };
            }
            this.logger.error(`[TaskQueue] Error processing document ${documentId}: ${error?.message || error}`, error?.stack);
            throw error;
        }
    }
    async indexWorkOrder(body) {
        const { workOrderId } = body;
        try {
            this.logger.log(`[TaskQueue] Processing work order indexing for ${workOrderId}`);
            const workOrder = await this.prisma.workOrder.findUnique({
                where: { id: workOrderId },
                select: {
                    description: true,
                    technicalReport: true,
                    symptoms: true,
                },
            });
            if (!workOrder) {
                this.logger.warn(`[TaskQueue] Work Order ${workOrderId} not found`);
                return { success: false, reason: 'not_found' };
            }
            const technicalReport = workOrder.technicalReport;
            const rawText = [
                workOrder.symptoms?.join(', '),
                workOrder.description,
                technicalReport?.diagnosis,
                technicalReport?.rootCause,
                Array.isArray(technicalReport?.actions) ? technicalReport.actions.join(', ') : '',
                technicalReport?.preventiveMeasures,
            ].filter(Boolean).join(' | ');
            const summary = await this.aiService.generateWorkOrderSummary(rawText);
            await this.vectorStore.indexWorkOrderSummary(workOrderId, summary);
            this.logger.log(`[TaskQueue] Work order ${workOrderId} indexing completed successfully`);
            return { success: true, workOrderId };
        }
        catch (error) {
            this.logger.error(`[TaskQueue] Error processing work order ${workOrderId}: ${error?.message || error}`, error?.stack);
            throw error;
        }
    }
    async health() {
        return { status: 'ok', timestamp: new Date() };
    }
};
exports.TaskQueueController = TaskQueueController;
__decorate([
    (0, common_1.Post)('index-document'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TaskQueueController.prototype, "indexDocument", null);
__decorate([
    (0, common_1.Post)('index-work-order'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TaskQueueController.prototype, "indexWorkOrder", null);
__decorate([
    (0, common_1.Post)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TaskQueueController.prototype, "health", null);
exports.TaskQueueController = TaskQueueController = TaskQueueController_1 = __decorate([
    (0, common_1.Controller)('tasks'),
    __metadata("design:paramtypes", [document_indexing_service_1.DocumentIndexingService, typeof (_a = typeof vector_store_service_1.VectorStoreService !== "undefined" && vector_store_service_1.VectorStoreService) === "function" ? _a : Object, prisma_service_1.PrismaService, typeof (_b = typeof ai_service_1.AiService !== "undefined" && ai_service_1.AiService) === "function" ? _b : Object])
], TaskQueueController);
//# sourceMappingURL=task-queue.controller.js.map