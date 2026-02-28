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
var DocumentsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentsService = void 0;
const common_1 = require("@nestjs/common");
const storage_1 = require("@google-cloud/storage");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_stream_1 = require("node:stream");
const prisma_service_1 = require("../prisma/prisma.service");
const document_indexing_service_1 = require("./document-indexing.service");
const documentSelect = {
    id: true,
    storageKey: true,
    originalName: true,
    mimeType: true,
    size: true,
    category: true,
    entityType: true,
    entityId: true,
    title: true,
    code: true,
    version: true,
    status: true,
    owner: true,
    nextReview: true,
    ragEnabled: true,
    ragStatus: true,
    aiSummary: true,
    aiResume: true,
    aiDocType: true,
    aiSafetyInstructions: true,
    aiTags: true,
    aiProcessedAt: true,
    aiProcessingStatus: true,
    embeddingStatus: true,
    embeddingProcessedAt: true,
    createdAt: true,
    updatedAt: true,
    areas: {
        select: {
            areaId: true,
            area: { select: { id: true, name: true, description: true } },
        },
    },
};
let DocumentsService = DocumentsService_1 = class DocumentsService {
    prisma;
    documentIndexing;
    gcsStorage;
    bucketName;
    storageDriver;
    localRoot;
    logger = new common_1.Logger(DocumentsService_1.name);
    constructor(prisma, documentIndexing) {
        this.prisma = prisma;
        this.documentIndexing = documentIndexing;
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
                console.warn('[Documents] No GCS project configured, falling back to local storage');
                this.storageDriver = 'local';
            }
            else {
                this.gcsStorage = new storage_1.Storage({
                    projectId,
                    ...(apiKey ? { apiKey } : {}),
                });
                console.log(`[Documents] Using GCS bucket: ${this.bucketName}`);
            }
        }
    }
    async resolveBucketName(organizationId) {
        try {
            const org = await this.prisma.organization.findUnique({
                where: { id: organizationId },
                select: { name: true },
            });
            if (!org) {
                throw new Error(`Organization ${organizationId} not found`);
            }
            return `mia-docs-${org.name}`;
        }
        catch (error) {
            console.error(`Failed to resolve bucket for org ${organizationId}:`, error?.message);
            throw error;
        }
    }
    bucket(bucketName) {
        if (!this.gcsStorage) {
            throw new Error('GCS Storage client is not configured.');
        }
        const name = bucketName || this.bucketName;
        return this.gcsStorage.bucket(name);
    }
    async storeLocalFile(storageKey, file) {
        const targetPath = node_path_1.default.join(this.localRoot, storageKey);
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(targetPath), { recursive: true });
        await node_fs_1.promises.writeFile(targetPath, file.buffer);
    }
    async getLocalFileStream(storageKey) {
        const targetPath = node_path_1.default.join(this.localRoot, storageKey);
        try {
            await node_fs_1.promises.access(targetPath);
        }
        catch {
            throw new common_1.NotFoundException(`Stored file ${storageKey} not found`);
        }
        return (0, node_fs_1.createReadStream)(targetPath);
    }
    buildStorageKey(category, originalName) {
        const extension = node_path_1.default.extname(originalName);
        const safeCategory = category.toLowerCase();
        const filename = `${(0, node_crypto_1.randomUUID)()}${extension}`;
        return `${safeCategory}/${filename}`;
    }
    async create(file, metadata, context) {
        console.log('[Documents] Creating document with metadata:', {
            title: metadata.title,
            code: metadata.code,
            originalName: file.originalname,
            size: file.size,
        });
        const storageKey = this.buildStorageKey(metadata.category, file.originalname);
        const { areaIds, ...fileData } = metadata;
        const ragEnabled = true;
        let fileHash = null;
        try {
            fileHash = (0, node_crypto_1.createHash)('sha256').update(file.buffer).digest('hex');
            console.log('[Documents] Computed file hash:', fileHash.substring(0, 16) + '...');
        }
        catch (err) {
            console.warn('[Documents] Failed to compute file hash:', err?.message || err);
        }
        if (this.storageDriver === 'local') {
            console.log('[Documents] Storing file locally:', storageKey);
            await this.storeLocalFile(storageKey, file);
        }
        else {
            console.log('[Documents] Uploading to GCS:', storageKey);
            try {
                const bucketName = await this.resolveBucketName(context?.organizationId || '');
                const gcsFile = this.bucket(bucketName).file(storageKey);
                await gcsFile.save(file.buffer, {
                    contentType: file.mimetype,
                    resumable: false,
                });
                console.log('[Documents] GCS upload successful');
            }
            catch (error) {
                console.error('[Documents] GCS upload error:', error);
                throw new common_1.InternalServerErrorException(`GCS upload failed: ${error?.message || error}`);
            }
        }
        console.log('[Documents] Creating DocumentFile record in database');
        const documentData = {
            storageKey,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            ...fileData,
            ragEnabled,
            aiProcessingStatus: ragEnabled ? 'pending' : null,
            embeddingStatus: ragEnabled ? 'pending' : null,
        };
        if (fileHash !== null) {
            documentData.fileHash = fileHash;
        }
        const created = await this.prisma.documentFile.create({
            data: documentData,
            select: { id: true },
        });
        console.log('[Documents] DocumentFile created with id:', created.id);
        if (areaIds) {
            console.log('[Documents] Assigning areas to document:', areaIds);
            await this.replaceDocumentAreas(created.id, areaIds, context?.organizationId);
        }
        if (ragEnabled) {
            this.documentIndexing.requestDocumentIndexing(created.id, context?.organizationId, {
                force: true,
                sourceBuffer: file.buffer,
            }).catch((err) => {
                this.logger.error(`Background AI analysis failed for ${created.id}: ${err?.message || err}`, err?.stack);
            });
        }
        console.log('[Documents] Fetching complete document with areas');
        const result = await this.findOneWithAreas(created.id);
        console.log('[Documents] Document upload complete, id:', result.id);
        return result;
    }
    async updateMetadata(id, updates, context) {
        const data = {};
        if ('originalName' in updates)
            data.originalName = updates.originalName;
        if ('title' in updates)
            data.title = updates.title;
        if ('code' in updates)
            data.code = updates.code;
        if ('version' in updates)
            data.version = updates.version;
        if ('status' in updates)
            data.status = updates.status;
        if ('owner' in updates)
            data.owner = updates.owner;
        if ('nextReview' in updates)
            data.nextReview = updates.nextReview;
        if ('ragEnabled' in updates) {
            data.ragEnabled = updates.ragEnabled;
        }
        if ('ragStatus' in updates)
            data.ragStatus = updates.ragStatus;
        if ('entityType' in updates)
            data.entityType = updates.entityType;
        if ('entityId' in updates)
            data.entityId = updates.entityId;
        if (Object.keys(data).length > 0) {
            await this.prisma.documentFile.update({
                where: { id },
                data,
            });
        }
        if (updates.areaIds !== undefined) {
            await this.replaceDocumentAreas(id, updates.areaIds || [], context?.organizationId);
        }
        return this.findOneWithAreas(id);
    }
    async findOne(id) {
        const file = await this.prisma.documentFile.findUnique({ where: { id } });
        if (!file) {
            throw new common_1.NotFoundException(`Document ${id} not found`);
        }
        return file;
    }
    async findOneWithAreas(id, retries = 3) {
        let lastError = null;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const file = await this.prisma.documentFile.findUnique({
                    where: { id },
                    select: documentSelect,
                });
                if (file) {
                    return file;
                }
                lastError = new common_1.NotFoundException(`Document ${id} not found`);
            }
            catch (error) {
                lastError = error;
            }
            if (attempt < retries - 1) {
                const delayMs = Math.pow(2, attempt) * 50;
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        throw lastError || new common_1.NotFoundException(`Document ${id} not found after ${retries} attempts`);
    }
    async findByIds(ids, organizationId) {
        const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
        if (uniqueIds.length === 0) {
            return [];
        }
        return this.prisma.documentFile.findMany({
            where: {
                id: { in: uniqueIds },
                ...(organizationId
                    ? {
                        OR: [
                            { areas: { none: {} } },
                            { areas: { some: { area: { organizationId } } } },
                        ],
                    }
                    : {}),
            },
            select: {
                id: true,
                ragEnabled: true,
                title: true,
                originalName: true,
            },
        });
    }
    async getStream(id, user, retries = 3, options) {
        let lastError = null;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const file = await this.prisma.documentFile.findUnique({
                    where: { id },
                    select: documentSelect,
                });
                if (!file) {
                    lastError = new common_1.NotFoundException('Document not found');
                    if (attempt < retries - 1) {
                        const delayMs = Math.pow(2, attempt) * 100;
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                        continue;
                    }
                    throw lastError;
                }
                const documentAreas = file.areas?.map((a) => a.areaId) || [];
                const roleLevels = Array.isArray(user?.roleLevels)
                    ? user?.roleLevels
                    : [];
                const roles = Array.isArray(user?.roles) ? user?.roles : [];
                const permissions = Array.isArray(user?.permissions)
                    ? user?.permissions
                    : [];
                const isAdmin = roleLevels.includes('SYSTEM_ADMIN') ||
                    roleLevels.includes('ORG_ADMIN') ||
                    roles.includes('Admin') ||
                    roles.includes('System Administrator') ||
                    permissions.includes('*');
                if (documentAreas.length > 0 && !isAdmin && !options?.bypassAreaCheck) {
                    const overlap = user?.areas && user.areas.some((areaId) => documentAreas.includes(areaId));
                    if (!overlap) {
                        throw new common_1.NotFoundException('Document not found');
                    }
                }
                if (this.storageDriver === 'local') {
                    return { file, stream: await this.getLocalFileStream(file.storageKey) };
                }
                try {
                    const gcsFile = this.bucket().file(file.storageKey);
                    const [buffer] = await gcsFile.download();
                    return { file, stream: node_stream_1.Readable.from(buffer) };
                }
                catch (error) {
                    throw new common_1.NotFoundException(`Stored file ${file.storageKey} not found`);
                }
            }
            catch (error) {
                lastError = error;
                if (error instanceof common_1.NotFoundException && attempt < retries - 1) {
                    const delayMs = Math.pow(2, attempt) * 100;
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }
                throw error;
            }
        }
        throw lastError || new common_1.NotFoundException('Document not found');
    }
    async list(filters, context) {
        const where = {
            category: filters.category,
            entityId: filters.entityId,
            entityType: filters.entityType,
        };
        const roleLevels = Array.isArray(context?.roleLevels)
            ? context?.roleLevels
            : [];
        const roles = Array.isArray(context?.roles) ? context?.roles : [];
        const permissions = Array.isArray(context?.permissions)
            ? context?.permissions
            : [];
        const isAdmin = roleLevels.includes('SYSTEM_ADMIN') ||
            roleLevels.includes('ORG_ADMIN') ||
            roles.includes('Admin') ||
            roles.includes('System Administrator') ||
            permissions.includes('*');
        if (!isAdmin) {
            if (context?.userAreas && context.userAreas.length > 0) {
                where.OR = [
                    { areas: { none: {} } },
                    { areas: { some: { areaId: { in: context.userAreas } } } },
                ];
            }
            else {
                where.areas = { none: {} };
            }
        }
        return this.prisma.documentFile.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            select: documentSelect,
        });
    }
    async overwriteFileContent(id, buffer, options) {
        const file = await this.prisma.documentFile.findUnique({
            where: { id },
            select: { storageKey: true, mimeType: true },
        });
        if (!file) {
            throw new common_1.NotFoundException(`Document ${id} not found`);
        }
        const mimeType = options?.mimeType || file.mimeType;
        if (this.storageDriver === 'local') {
            const targetPath = node_path_1.default.join(this.localRoot, file.storageKey);
            await node_fs_1.promises.mkdir(node_path_1.default.dirname(targetPath), { recursive: true });
            await node_fs_1.promises.writeFile(targetPath, buffer);
        }
        else {
            try {
                const gcsFile = this.bucket().file(file.storageKey);
                await gcsFile.save(buffer, {
                    contentType: mimeType,
                    resumable: false,
                });
            }
            catch (error) {
                throw new common_1.InternalServerErrorException(`GCS upload failed: ${error?.message || error}`);
            }
        }
        await this.prisma.documentFile.update({
            where: { id },
            data: {
                size: buffer.length,
                mimeType,
            },
        });
    }
    async replaceDocumentAreas(documentId, areaIds, organizationId) {
        const uniqueAreaIds = Array.from(new Set(areaIds.filter(Boolean)));
        if (uniqueAreaIds.length === 0) {
            await this.prisma.documentArea.deleteMany({ where: { documentId } });
            return;
        }
        const validAreas = await this.prisma.area.findMany({
            where: {
                id: { in: uniqueAreaIds },
                organizationId: organizationId || undefined,
            },
            select: { id: true },
        });
        const validIds = validAreas.map((a) => a.id);
        if (validIds.length === 0) {
            await this.prisma.documentArea.deleteMany({
                where: { documentId },
            });
            return;
        }
        await this.prisma.$transaction([
            this.prisma.documentArea.deleteMany({
                where: { documentId, areaId: { notIn: validIds } },
            }),
            this.prisma.documentArea.createMany({
                data: validIds.map((id) => ({ documentId, areaId: id })),
                skipDuplicates: true,
            }),
        ]);
    }
};
exports.DocumentsService = DocumentsService;
exports.DocumentsService = DocumentsService = DocumentsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        document_indexing_service_1.DocumentIndexingService])
], DocumentsService);
//# sourceMappingURL=documents.service.js.map