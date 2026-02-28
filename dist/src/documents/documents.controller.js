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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const common_2 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const documents_service_1 = require("./documents.service");
const document_indexing_service_1 = require("./document-indexing.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const vector_store_service_1 = require("../ai/vector-store.service");
let DocumentsController = class DocumentsController {
    documentsService;
    documentIndexing;
    vectorStore;
    constructor(documentsService, documentIndexing, vectorStore) {
        this.documentsService = documentsService;
        this.documentIndexing = documentIndexing;
        this.vectorStore = vectorStore;
    }
    list(req, category, entityId, entityType) {
        return this.documentsService.list({ category, entityId, entityType }, {
            organizationId: req.organizationId,
            userAreas: req.user?.areas,
            roleLevels: req.user?.roleLevels,
            roles: req.user?.roles,
            permissions: req.user?.permissions,
        });
    }
    async upload(req, file, body) {
        if (!file) {
            throw new common_1.BadRequestException('File is required');
        }
        if (!body?.category) {
            throw new common_1.BadRequestException('Category is required');
        }
        const ragEnabled = true;
        const nextReview = body.nextReview ? new Date(body.nextReview) : undefined;
        const areaIds = this.parseAreaIds(body?.areaIds);
        const result = await this.documentsService.create(file, {
            category: body.category,
            entityType: body.entityType,
            entityId: body.entityId,
            title: body.title,
            code: body.code,
            version: body.version,
            status: body.status,
            owner: body.owner,
            nextReview,
            ragEnabled,
            ragStatus: body.ragStatus,
            areaIds,
        }, {
            organizationId: req.organizationId,
        });
        return result;
    }
    async updateMetadata(req, id, body) {
        const updates = {};
        if (body && Object.prototype.hasOwnProperty.call(body, 'originalName')) {
            updates.originalName = body.originalName ?? null;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'title')) {
            updates.title = body.title ?? null;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'code')) {
            updates.code = body.code ?? null;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'version')) {
            updates.version = body.version ?? null;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'status')) {
            updates.status = body.status ?? null;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'owner')) {
            updates.owner = body.owner ?? null;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'nextReview')) {
            if (body.nextReview === null || body.nextReview === '') {
                updates.nextReview = null;
            }
            else if (body.nextReview !== undefined) {
                const parsed = new Date(body.nextReview);
                if (Number.isNaN(parsed.getTime())) {
                    throw new common_1.BadRequestException('Invalid nextReview date.');
                }
                updates.nextReview = parsed;
            }
        }
        updates.ragEnabled = true;
        if (body && Object.prototype.hasOwnProperty.call(body, 'ragStatus')) {
            updates.ragStatus = body.ragStatus ?? null;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'entityType')) {
            updates.entityType = body.entityType ?? null;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'entityId')) {
            updates.entityId = body.entityId ?? null;
        }
        if (body && Object.prototype.hasOwnProperty.call(body, 'areaIds')) {
            updates.areaIds = this.parseAreaIds(body.areaIds) ?? null;
        }
        return this.documentsService.updateMetadata(id, updates, {
            organizationId: req.organizationId,
        });
    }
    async view(req, id, res) {
        const { file, stream } = await this.documentsService.getStream(id, req.user);
        res.set({
            'Content-Type': file.mimeType,
            'Content-Length': file.size.toString(),
            'Content-Disposition': `inline; filename="${file.originalName}"`,
        });
        return new common_2.StreamableFile(stream);
    }
    async download(req, id, res) {
        const { file, stream } = await this.documentsService.getStream(id, req.user);
        res.set({
            'Content-Type': file.mimeType,
            'Content-Length': file.size.toString(),
            'Content-Disposition': `attachment; filename="${file.originalName}"`,
        });
        return new common_2.StreamableFile(stream);
    }
    async getEmbeddingStatus(req, id) {
        const docRecords = await this.documentsService.findByIds([id]);
        if (docRecords.length === 0) {
            throw new common_1.BadRequestException('Document not found');
        }
        const status = await this.vectorStore.getEmbeddingStatus(id);
        return {
            documentId: id,
            status: status || 'unknown',
            ready: status === 'completed',
        };
    }
    async reindexPending(limit) {
        const parsedLimit = Math.max(Number(limit || 50) || 50, 1);
        const queued = await this.documentIndexing.queuePendingDocumentIndexing(Math.min(parsedLimit, 500));
        return { success: true, queued };
    }
    async reindexDocument(req, id) {
        const queued = await this.documentIndexing.requestDocumentIndexing(id, req.organizationId, { force: true });
        return { success: true, queued };
    }
    parseAreaIds(input) {
        if (input === undefined)
            return undefined;
        if (input === null)
            return [];
        if (Array.isArray(input))
            return input.filter(Boolean);
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed)) {
                return parsed.filter(Boolean);
            }
        }
        catch {
        }
        if (typeof input === 'string') {
            return input
                .split(',')
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
        }
        return undefined;
    }
};
exports.DocumentsController = DocumentsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('category')),
    __param(2, (0, common_1.Query)('entityId')),
    __param(3, (0, common_1.Query)('entityType')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], DocumentsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "upload", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "updateMetadata", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "view", null);
__decorate([
    (0, common_1.Get)(':id/download'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "download", null);
__decorate([
    (0, common_1.Get)(':id/embedding-status'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getEmbeddingStatus", null);
__decorate([
    (0, common_1.Post)('reindex-pending'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "reindexPending", null);
__decorate([
    (0, common_1.Post)(':id/reindex'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "reindexDocument", null);
exports.DocumentsController = DocumentsController = __decorate([
    (0, common_1.Controller)('documents'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [documents_service_1.DocumentsService,
        document_indexing_service_1.DocumentIndexingService, typeof (_a = typeof vector_store_service_1.VectorStoreService !== "undefined" && vector_store_service_1.VectorStoreService) === "function" ? _a : Object])
], DocumentsController);
//# sourceMappingURL=documents.controller.js.map