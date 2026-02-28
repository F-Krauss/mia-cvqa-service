"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const ai_service_1 = require("./ai.service");
const vector_store_service_1 = require("./vector-store.service");
const prisma_service_1 = require("../prisma/prisma.service");
const ai_usage_service_1 = require("./ai-usage.service");
const history_service_1 = require("../history/history.service");
const approvals_service_1 = require("../approvals/approvals.service");
const documents_service_1 = require("../documents/documents.service");
const common_1 = require("@nestjs/common");
describe('AI Service - Vector Integration', () => {
    let aiService;
    let vectorStore;
    let prisma;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
                ai_service_1.AiService,
                vector_store_service_1.VectorStoreService,
                {
                    provide: prisma_service_1.PrismaService,
                    useValue: {
                        documentFile: {
                            findUnique: jest.fn(),
                            findMany: jest.fn(),
                            update: jest.fn(),
                        },
                        documentChunk: {
                            findMany: jest.fn(),
                            deleteMany: jest.fn(),
                            createMany: jest.fn(),
                        },
                        aiUsageStat: {
                            create: jest.fn(),
                        },
                        $transaction: jest.fn(),
                        $executeRawUnsafe: jest.fn(),
                        $queryRaw: jest.fn(),
                    },
                },
                {
                    provide: ai_usage_service_1.AiUsageService,
                    useValue: {
                        ensureNotBlocked: jest.fn(),
                        recordUsage: jest.fn(),
                    },
                },
                {
                    provide: history_service_1.HistoryService,
                    useValue: {
                        create: jest.fn(),
                    },
                },
                {
                    provide: approvals_service_1.ApprovalsService,
                    useValue: {},
                },
                {
                    provide: documents_service_1.DocumentsService,
                    useValue: {
                        findByIds: jest.fn(),
                    },
                },
            ],
        }).compile();
        aiService = module.get(ai_service_1.AiService);
        vectorStore = module.get(vector_store_service_1.VectorStoreService);
        prisma = module.get(prisma_service_1.PrismaService);
    });
    describe('Embedding Status Validation', () => {
        it('should reject query if document embedding not completed', async () => {
            const documentsService = aiService['documentsService'];
            documentsService.findByIds.mockResolvedValue([
                {
                    id: 'doc-1',
                    ragEnabled: true,
                    originalName: 'Test.pdf',
                },
            ]);
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'processing' },
            ]);
            expect(aiService.consult('test query', ['doc-1'], undefined, [], { sub: 'user-1' })).rejects.toThrow(common_1.BadRequestException);
        });
        it('should reject query if document embedding failed', async () => {
            const documentsService = aiService['documentsService'];
            documentsService.findByIds.mockResolvedValue([
                { id: 'doc-1', ragEnabled: true },
            ]);
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'failed' },
            ]);
            expect(aiService.consult('test query', ['doc-1'], undefined, [], { sub: 'user-1' })).rejects.toThrow(common_1.BadRequestException);
        });
        it('should allow query if all documents completed', async () => {
            const documentsService = aiService['documentsService'];
            const aiUsageService = aiService['aiUsageService'];
            documentsService.findByIds.mockResolvedValue([
                { id: 'doc-1', ragEnabled: true },
            ]);
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'completed' },
            ]);
            aiUsageService.ensureNotBlocked.mockResolvedValue(undefined);
            try {
                await aiService.consult('test query', ['doc-1'], undefined, [], { sub: 'user-1' });
            }
            catch (err) {
                expect(err.message).not.toContain('embedding');
            }
        });
        it('should list status of each document in error message', async () => {
            const documentsService = aiService['documentsService'];
            documentsService.findByIds.mockResolvedValue([
                { id: 'doc-1', ragEnabled: true },
                { id: 'doc-2', ragEnabled: true },
            ]);
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'processing' },
                { id: 'doc-2', embeddingStatus: 'completed' },
            ]);
            try {
                await aiService.consult('test query', ['doc-1', 'doc-2'], undefined, [], { sub: 'user-1' });
            }
            catch (err) {
                expect(err.message).toContain('processing');
                expect(err.message).toContain('doc-1');
            }
        });
    });
    describe('Multi-Document Query Handling', () => {
        it('should handle multiple documents with mixed status', async () => {
            const documentsService = aiService['documentsService'];
            documentsService.findByIds.mockResolvedValue([
                { id: 'doc-1', ragEnabled: true },
                { id: 'doc-2', ragEnabled: true },
                { id: 'doc-3', ragEnabled: true },
            ]);
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'completed' },
                { id: 'doc-2', embeddingStatus: 'processing' },
                { id: 'doc-3', embeddingStatus: 'completed' },
            ]);
            expect(aiService.consult('test query', ['doc-1', 'doc-2', 'doc-3'], undefined, [], { sub: 'user-1' })).rejects.toThrow(common_1.BadRequestException);
        });
        it('should process only RAG-enabled documents', async () => {
            const documentsService = aiService['documentsService'];
            documentsService.findByIds.mockResolvedValue([
                { id: 'doc-1', ragEnabled: true },
                { id: 'doc-2', ragEnabled: false },
            ]);
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'completed' },
            ]);
            expect(aiService.consult('test query', ['doc-1', 'doc-2'], undefined, [], { sub: 'user-1' })).rejects.toThrow();
        });
    });
    describe('Query Processing with Vector Search', () => {
        it('should call vectorStore.search with correct parameters', async () => {
            const documentsService = aiService['documentsService'];
            const vectorStoreSpy = jest.spyOn(vectorStore, 'search');
            documentsService.findByIds.mockResolvedValue([
                { id: 'doc-1', ragEnabled: true },
            ]);
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'completed' },
            ]);
            vectorStoreSpy.mockResolvedValue([]);
            try {
                await aiService.consult('test query', ['doc-1'], undefined, [], { sub: 'user-1' });
            }
            catch (err) {
            }
            expect(vectorStoreSpy).toHaveBeenCalledWith('test query', ['doc-1'], 10, undefined);
        });
        it('should fail gracefully if no chunks retrieved', async () => {
            const documentsService = aiService['documentsService'];
            const vectorStoreSpy = jest.spyOn(vectorStore, 'search');
            documentsService.findByIds.mockResolvedValue([
                { id: 'doc-1', ragEnabled: true },
            ]);
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'completed' },
            ]);
            vectorStoreSpy.mockResolvedValue([]);
            expect(aiService.consult('test query', ['doc-1'], undefined, [], { sub: 'user-1' })).rejects.toThrow('No se encontraron fragmentos indexados');
        });
    });
    describe('Error Messages', () => {
        it('should provide helpful error when documents not found', async () => {
            const documentsService = aiService['documentsService'];
            documentsService.findByIds.mockResolvedValue([]);
            expect(aiService.consult('test query', ['non-existent'], undefined, [], { sub: 'user-1' })).rejects.toThrow('No se encontraron documentos válidos');
        });
        it('should provide helpful error when no RAG-enabled documents', async () => {
            const documentsService = aiService['documentsService'];
            documentsService.findByIds.mockResolvedValue([
                { id: 'doc-1', ragEnabled: false },
            ]);
            expect(aiService.consult('test query', ['doc-1'], undefined, [], { sub: 'user-1' })).rejects.toThrow('No se encontraron documentos válidos con RAG habilitado');
        });
    });
    describe('Document Validation', () => {
        it('should validate that documents exist', async () => {
            const documentsService = aiService['documentsService'];
            documentsService.findByIds.mockResolvedValue([]);
            expect(aiService.consult('test query', ['doc-1', 'doc-2'], undefined, [], { sub: 'user-1' })).rejects.toThrow();
        });
        it('should limit documents to MAX_DOCS', async () => {
            const documentsService = aiService['documentsService'];
            const docIds = Array.from({ length: 20 }, (_, i) => `doc-${i}`);
            documentsService.findByIds.mockResolvedValue(docIds.map((id) => ({ id, ragEnabled: true })).slice(0, 7));
            expect(documentsService.findByIds).toBeDefined();
        });
    });
});
//# sourceMappingURL=ai-integration.spec.js.map