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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var DocumentIndexingService_1;
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentIndexingService = void 0;
const common_1 = require("@nestjs/common");
const storage_1 = require("@google-cloud/storage");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
const prisma_service_1 = require("../prisma/prisma.service");
const document_ai_analyzer_service_1 = require("./document-ai-analyzer.service");
const cloud_tasks_service_1 = require("../queue/cloud-tasks.service");
const vector_store_service_1 = require("../ai/vector-store.service");
let DocumentIndexingService = DocumentIndexingService_1 = class DocumentIndexingService {
    prisma;
    aiAnalyzer;
    cloudTasks;
    vectorStore;
    gcsStorage;
    bucketName;
    storageDriver;
    localRoot;
    logger = new common_1.Logger(DocumentIndexingService_1.name);
    sweepEnabled;
    sweepIntervalMs;
    sweepBatchSize;
    sweepTimer = null;
    isSweepRunning = false;
    constructor(prisma, aiAnalyzer, cloudTasks, vectorStore) {
        this.prisma = prisma;
        this.aiAnalyzer = aiAnalyzer;
        this.cloudTasks = cloudTasks;
        this.vectorStore = vectorStore;
        const isProduction = process.env.NODE_ENV === 'production';
        const driver = process.env.DOCUMENTS_STORAGE_DRIVER;
        this.storageDriver = driver === 'local' ? 'local' : 'gcs';
        this.bucketName = process.env.GCS_STORAGE_BUCKET || 'mia-docs-prod';
        this.localRoot =
            process.env.LOCAL_STORAGE_PATH || node_path_1.default.resolve(process.cwd(), 'storage');
        if (this.storageDriver === 'gcs') {
            const projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
            const apiKey = process.env.GCS_API_KEY;
            if (!projectId) {
                if (isProduction) {
                    throw new Error('VERTEX_PROJECT_ID or FIREBASE_PROJECT_ID is required for GCS storage in production.');
                }
                this.logger.warn('[Indexing] No GCS project configured, falling back to local storage');
                this.storageDriver = 'local';
            }
            else {
                this.gcsStorage = new storage_1.Storage({
                    projectId,
                    ...(apiKey ? { apiKey } : {}),
                });
                this.logger.log(`[Indexing] Using GCS bucket: ${this.bucketName}`);
            }
        }
        this.sweepEnabled =
            (process.env.DOCUMENT_VECTOR_SWEEP_ENABLED || 'true')
                .toLowerCase()
                .trim() !== 'false';
        this.sweepIntervalMs = Math.max(Number(process.env.DOCUMENT_VECTOR_SWEEP_INTERVAL_MS || 60_000), 15_000);
        this.sweepBatchSize = Math.min(Math.max(Number(process.env.DOCUMENT_VECTOR_SWEEP_BATCH_SIZE || 300), 1), 500);
    }
    onModuleInit() {
        if (!this.sweepEnabled) {
            this.logger.log('[Indexing] Vector sweep disabled by config');
            return;
        }
        setImmediate(() => {
            this.queuePendingDocumentIndexing().catch((error) => {
                this.logger.warn(`[Indexing] Initial vector sweep failed: ${error?.message || error}`);
            });
        });
        this.sweepTimer = setInterval(() => {
            this.queuePendingDocumentIndexing().catch((error) => {
                this.logger.warn(`[Indexing] Scheduled vector sweep failed: ${error?.message || error}`);
            });
        }, this.sweepIntervalMs);
        this.sweepTimer.unref?.();
    }
    onModuleDestroy() {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
        }
    }
    bucket(bucketName) {
        if (!this.gcsStorage) {
            throw new Error('GCS Storage client is not configured.');
        }
        return this.gcsStorage.bucket(bucketName || this.bucketName);
    }
    async resolveBucketName(organizationId) {
        if (!organizationId)
            return this.bucketName;
        try {
            const org = await this.prisma.organization.findUnique({
                where: { id: organizationId },
                select: { name: true },
            });
            if (!org)
                return this.bucketName;
            return `mia-docs-${org.name}`;
        }
        catch {
            return this.bucketName;
        }
    }
    async resolveDocumentOrganizationId(documentId) {
        try {
            const rows = await this.prisma.$queryRawUnsafe('SELECT "organizationId" FROM "DocumentFile" WHERE "id" = $1 LIMIT 1', documentId);
            const organizationId = String(rows?.[0]?.organizationId || '').trim();
            return organizationId || undefined;
        }
        catch {
            return undefined;
        }
    }
    async readDocumentBuffer(documentId, organizationId) {
        const doc = await this.prisma.documentFile.findUnique({
            where: { id: documentId },
            select: { storageKey: true },
        });
        if (!doc) {
            throw new common_1.NotFoundException(`Document ${documentId} not found`);
        }
        if (this.storageDriver === 'local') {
            const targetPath = node_path_1.default.join(this.localRoot, doc.storageKey);
            try {
                return await node_fs_1.promises.readFile(targetPath);
            }
            catch (error) {
                throw new common_1.NotFoundException(`Stored file ${doc.storageKey} not found`);
            }
        }
        const inferredOrganizationId = await this.resolveDocumentOrganizationId(documentId);
        const bucketCandidates = Array.from(new Set((await Promise.all([
            this.resolveBucketName(organizationId),
            inferredOrganizationId
                ? this.resolveBucketName(inferredOrganizationId)
                : Promise.resolve(undefined),
        ]))
            .concat(this.bucketName)
            .filter((value) => Boolean(value && value.trim()))));
        for (const bucketName of bucketCandidates) {
            try {
                this.logger.log(`[Indexing] Fetching ${doc.storageKey} from bucket: ${bucketName}`);
                const gcsFile = this.bucket(bucketName).file(doc.storageKey);
                const [buffer] = await gcsFile.download();
                return buffer;
            }
            catch (error) {
                this.logger.warn(`[Indexing] File ${doc.storageKey} not found in bucket ${bucketName}`);
            }
        }
        throw new common_1.NotFoundException(`Stored file ${doc.storageKey} not found`);
    }
    async setFailedIndexingStatuses(documentId) {
        try {
            const existing = await this.prisma.documentFile.findUnique({
                where: { id: documentId },
                select: { embeddingStatus: true },
            });
            if (!existing)
                return;
            await this.prisma.documentFile.update({
                where: { id: documentId },
                data: {
                    aiProcessingStatus: 'failed',
                    ...(existing.embeddingStatus === 'completed'
                        ? {}
                        : { embeddingStatus: 'failed' }),
                },
            });
        }
        catch (statusError) {
            this.logger.error(`Failed to set failed statuses for ${documentId}: ${statusError?.message || statusError}`, statusError?.stack);
        }
    }
    async setPendingIndexingStatuses(documentId) {
        await this.prisma.documentFile.update({
            where: { id: documentId },
            data: {
                aiProcessingStatus: 'pending',
                embeddingStatus: 'pending',
                embeddingProcessedAt: null,
            },
        });
    }
    async queueOrAnalyzeDocument(documentId, organizationId, sourceBuffer, options) {
        const allowDirectFallback = (process.env.DOCUMENT_INDEXING_ALLOW_FALLBACK || 'true')
            .toLowerCase()
            .trim() !== 'false';
        const resolvedOrganizationId = organizationId || (await this.resolveDocumentOrganizationId(documentId));
        if (!options?.preferDirect && this.cloudTasks.isAvailable()) {
            try {
                const queued = await this.cloudTasks.queueDocumentIndexing(documentId, resolvedOrganizationId);
                if (queued)
                    return;
                this.logger.warn(`[Indexing] Cloud Tasks returned empty task id for ${documentId}; falling back to direct analysis`);
            }
            catch (error) {
                this.logger.warn(`[Indexing] Failed to queue indexing for ${documentId}: ${error?.message || error}. Falling back to direct analysis`);
            }
        }
        if (!allowDirectFallback) {
            this.logger.warn(`[Indexing] Direct fallback disabled. Skipping local indexing for ${documentId}`);
            return;
        }
        const buffer = sourceBuffer ||
            (await this.readDocumentBuffer(documentId, resolvedOrganizationId));
        await this.aiAnalyzer.analyzeDocument(documentId, buffer, resolvedOrganizationId);
    }
    async requestDocumentIndexing(documentId, organizationId, options) {
        const doc = await this.prisma.documentFile.findUnique({
            where: { id: documentId },
            select: {
                id: true,
                ragEnabled: true,
                aiProcessingStatus: true,
                embeddingStatus: true,
            },
        });
        if (!doc) {
            throw new common_1.NotFoundException(`Document ${documentId} not found`);
        }
        if (!doc.ragEnabled) {
            return false;
        }
        const isAlreadyProcessing = doc.aiProcessingStatus === 'processing' ||
            doc.embeddingStatus === 'processing';
        if (isAlreadyProcessing && !options?.force) {
            return false;
        }
        await this.setPendingIndexingStatuses(documentId);
        await this.queueOrAnalyzeDocument(documentId, organizationId, options?.sourceBuffer, { preferDirect: options?.preferDirect });
        return true;
    }
    async queuePendingDocumentIndexing(limit = this.sweepBatchSize) {
        if (this.isSweepRunning)
            return 0;
        this.isSweepRunning = true;
        try {
            try {
                await this.vectorStore.processPendingEmbeddings(300);
            }
            catch (embErr) {
                this.logger.warn(`Failed to process pending embeddings in sweep: ${embErr?.message || embErr}`);
            }
            const staleProcessingMinutes = Math.max(Number(process.env.DOCUMENT_INDEXING_STALE_MINUTES || 30) || 30, 1);
            const staleCutoff = new Date(Date.now() - staleProcessingMinutes * 60 * 1000);
            const pendingDocs = await this.prisma.documentFile.findMany({
                where: {
                    ragEnabled: true,
                    OR: [
                        { aiProcessingStatus: null },
                        { aiProcessingStatus: 'pending' },
                        { aiProcessingStatus: 'failed' },
                        {
                            aiProcessingStatus: 'processing',
                            updatedAt: { lt: staleCutoff },
                        },
                    ],
                },
                select: {
                    id: true,
                    updatedAt: true,
                    aiProcessingStatus: true,
                    embeddingStatus: true,
                },
                orderBy: { updatedAt: 'asc' },
                take: limit,
            });
            for (const doc of pendingDocs) {
                try {
                    const isStaleProcessing = doc.updatedAt < staleCutoff &&
                        doc.aiProcessingStatus === 'processing';
                    const isStalePendingOrFailed = doc.updatedAt < staleCutoff &&
                        (doc.aiProcessingStatus === 'pending' ||
                            doc.aiProcessingStatus === 'failed');
                    const shouldPreferDirect = isStaleProcessing || isStalePendingOrFailed;
                    await this.requestDocumentIndexing(doc.id, undefined, isStaleProcessing || shouldPreferDirect
                        ? { force: isStaleProcessing, preferDirect: shouldPreferDirect }
                        : undefined);
                }
                catch (error) {
                    this.logger.warn(`[Indexing] Failed indexing retry for ${doc.id}: ${error?.message || error}`);
                }
            }
            if (pendingDocs.length > 0) {
                this.logger.log(`[Indexing] Queued/retried indexing for ${pendingDocs.length} pending documents`);
            }
            return pendingDocs.length;
        }
        finally {
            this.isSweepRunning = false;
        }
    }
    async handleIndexingTask(documentId, organizationId) {
        if (!documentId) {
            throw new common_1.BadRequestException('documentId is required');
        }
        const doc = await this.prisma.documentFile.findUnique({
            where: { id: documentId },
            select: { id: true, ragEnabled: true },
        });
        if (!doc) {
            throw new common_1.BadRequestException(`Document ${documentId} not found`);
        }
        if (!doc.ragEnabled) {
            return { success: true, skipped: true, reason: 'RAG disabled' };
        }
        try {
            const resolvedOrganizationId = organizationId ||
                (await this.resolveDocumentOrganizationId(documentId));
            const buffer = await this.readDocumentBuffer(documentId, resolvedOrganizationId);
            this.logger.log(`[Indexing] File loaded for ${documentId}, size: ${buffer.length} bytes`);
            await this.aiAnalyzer.analyzeDocument(documentId, buffer, resolvedOrganizationId);
        }
        catch (error) {
            await this.setFailedIndexingStatuses(documentId);
            this.logger.error(`[Indexing] Error processing document ${documentId}: ${error?.message || error}`, error?.stack);
            if (error instanceof common_1.BadRequestException || error instanceof common_1.NotFoundException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException(error?.message || 'Document indexing failed');
        }
        return { success: true, indexed: true };
    }
};
exports.DocumentIndexingService = DocumentIndexingService;
exports.DocumentIndexingService = DocumentIndexingService = DocumentIndexingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        document_ai_analyzer_service_1.DocumentAiAnalyzerService,
        cloud_tasks_service_1.CloudTasksService, typeof (_a = typeof vector_store_service_1.VectorStoreService !== "undefined" && vector_store_service_1.VectorStoreService) === "function" ? _a : Object])
], DocumentIndexingService);
//# sourceMappingURL=document-indexing.service.js.map