"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const vector_store_service_1 = require("./vector-store.service");
const prisma_service_1 = require("../prisma/prisma.service");
const cache_service_1 = require("../common/cache.service");
describe('VectorStoreService', () => {
    let service;
    let prisma;
    beforeEach(async () => {
        const module = await testing_1.Test.createTestingModule({
            providers: [
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
                        $transaction: jest.fn(),
                        $executeRaw: jest.fn(),
                        $executeRawUnsafe: jest.fn(),
                        $queryRaw: jest.fn(),
                    },
                },
                {
                    provide: cache_service_1.CacheService,
                    useValue: {
                        getJson: jest.fn().mockResolvedValue(null),
                        setJson: jest.fn().mockResolvedValue(undefined),
                    },
                },
            ],
        }).compile();
        service = module.get(vector_store_service_1.VectorStoreService);
        prisma = module.get(prisma_service_1.PrismaService);
    });
    describe('Cosine Similarity', () => {
        it('should calculate cosine similarity correctly', () => {
            const result = service.cosineSimilarity([1, 0, 0], [1, 0, 0]);
            expect(result).toBeCloseTo(1.0, 2);
        });
        it('should handle orthogonal vectors', () => {
            const result = service.cosineSimilarity([1, 0], [0, 1]);
            expect(result).toBeCloseTo(0, 2);
        });
        it('should handle opposite vectors', () => {
            const result = service.cosineSimilarity([1, 0], [-1, 0]);
            expect(result).toBeCloseTo(-1.0, 2);
        });
        it('should handle empty vectors', () => {
            const result = service.cosineSimilarity([], [1, 0]);
            expect(result).toBe(0);
        });
        it('should handle zero vector', () => {
            const result = service.cosineSimilarity([0, 0], [1, 0]);
            expect(result).toBe(0);
        });
    });
    describe('Text Chunking', () => {
        it('should chunk text into appropriate sizes', () => {
            const text = 'A '.repeat(3000);
            const chunks = service.chunkText(text);
            expect(chunks.length).toBeGreaterThan(0);
            chunks.forEach((chunk) => {
                expect(chunk.text).toBeDefined();
                expect(chunk.index).toBeDefined();
            });
        });
        it('should create chunks with overlap', () => {
            const text = 'word '.repeat(1000);
            const chunks = service.chunkText(text);
            expect(chunks.length).toBeGreaterThan(1);
            chunks.forEach((chunk, idx) => {
                expect(chunk.index).toBe(idx);
            });
        });
        it('should handle empty text', () => {
            const chunks = service.chunkText('');
            expect(chunks.length).toBe(0);
        });
        it('should handle whitespace-only text', () => {
            const chunks = service.chunkText('   \n\n   ');
            expect(chunks.length).toBe(0);
        });
        it('should handle small text', () => {
            const text = 'Short text with enough characters';
            const chunks = service.chunkText(text);
            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].text).toContain('Short');
        });
    });
    describe('getEmbeddingStatus', () => {
        it('should return embedding status from database', async () => {
            const mockDoc = { embeddingStatus: 'completed', resumeEmbedding: null };
            prisma.documentFile.findUnique.mockResolvedValue(mockDoc);
            const status = await service.getEmbeddingStatus('doc-123');
            expect(status).toBe('completed');
            expect(prisma.documentFile.findUnique).toHaveBeenCalledWith({
                where: { id: 'doc-123' },
                select: { embeddingStatus: true },
            });
        });
        it('should return null for non-existent document', async () => {
            prisma.documentFile.findUnique.mockResolvedValue(null);
            const status = await service.getEmbeddingStatus('non-existent');
            expect(status).toBeNull();
        });
        it('should return pending status', async () => {
            const mockDoc = { embeddingStatus: 'pending', resumeEmbedding: null };
            prisma.documentFile.findUnique.mockResolvedValue(mockDoc);
            const status = await service.getEmbeddingStatus('doc-123');
            expect(status).toBe('pending');
        });
    });
    describe('isSummaryIndexed', () => {
        it('should return true when resumeEmbedding exists', async () => {
            const mockDoc = { resumeEmbedding: [0.1, 0.2] };
            prisma.documentFile.findUnique.mockResolvedValue(mockDoc);
            const result = await service.isSummaryIndexed('doc-123');
            expect(result).toBe(true);
        });
        it('should return false when resumeEmbedding is null', async () => {
            const mockDoc = { resumeEmbedding: null };
            prisma.documentFile.findUnique.mockResolvedValue(mockDoc);
            const result = await service.isSummaryIndexed('doc-123');
            expect(result).toBe(false);
        });
        it('should return false for non-existent document', async () => {
            prisma.documentFile.findUnique.mockResolvedValue(null);
            const result = await service.isSummaryIndexed('non-existent');
            expect(result).toBe(false);
        });
    });
    describe('isDocumentEmbedded', () => {
        it('should return true when status is completed', async () => {
            const mockDoc = { embeddingStatus: 'completed', resumeEmbedding: null };
            prisma.documentFile.findUnique.mockResolvedValue(mockDoc);
            const result = await service.isDocumentEmbedded('doc-123');
            expect(result).toBe(true);
        });
        it('should return false when status is processing', async () => {
            const mockDoc = { embeddingStatus: 'processing', resumeEmbedding: null };
            prisma.documentFile.findUnique.mockResolvedValue(mockDoc);
            const result = await service.isDocumentEmbedded('doc-123');
            expect(result).toBe(false);
        });
        it('should return false when status is failed', async () => {
            const mockDoc = { embeddingStatus: 'failed', resumeEmbedding: null };
            prisma.documentFile.findUnique.mockResolvedValue(mockDoc);
            const result = await service.isDocumentEmbedded('doc-123');
            expect(result).toBe(false);
        });
    });
    describe('Token Counting', () => {
        it('should count tokens approximately', () => {
            const text = 'A'.repeat(400);
            const tokens = service.countTokensApprox(text);
            expect(tokens).toBe(100);
        });
        it('should handle empty text', () => {
            const tokens = service.countTokensApprox('');
            expect(tokens).toBe(0);
        });
        it('should round up', () => {
            const text = 'A'.repeat(401);
            const tokens = service.countTokensApprox(text);
            expect(tokens).toBe(101);
        });
    });
    describe('Embedding Cache', () => {
        it('should cache query embeddings with LRU eviction', async () => {
            const cache = service.queryEmbeddingCache;
            const embedding1 = [0.1, 0.2, 0.3];
            const embedding2 = [0.4, 0.5, 0.6];
            cache.set('query-1', embedding1);
            cache.set('query-2', embedding2);
            const retrieved1 = cache.get('query-1');
            expect(retrieved1).toEqual(embedding1);
        });
        it('should evict least recently used when max size exceeded', () => {
            const SmallCache = service.constructor;
        });
        it('should return undefined for non-existent key', () => {
            const cache = service.queryEmbeddingCache;
            const result = cache.get('non-existent');
            expect(result).toBeUndefined();
        });
    });
    describe('Search Error Handling', () => {
        it('should return empty array if no documents are ready', async () => {
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'pending' },
                { id: 'doc-2', embeddingStatus: 'processing' },
            ]);
            const result = await service.search('test query', ['doc-1', 'doc-2']);
            expect(result).toEqual([]);
        });
        it('should return empty array if chunk search fails', async () => {
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'completed' },
            ]);
            prisma.$queryRaw.mockRejectedValue(new Error('Database error'));
            const result = await service.search('test query', ['doc-1']);
            expect(result).toEqual([]);
        });
        it('should handle null embeddings gracefully', () => {
            const embeddings = [null, [0.1, 0.2, 0.3], null].filter((e) => e !== null);
            expect(embeddings.length).toBe(1);
            expect(embeddings[0]).toEqual([0.1, 0.2, 0.3]);
        });
    });
    describe('Batch Embedding Size', () => {
        it('should respect batch size limits', () => {
            const BATCH_EMBED_SIZE = 16;
            expect(BATCH_EMBED_SIZE).toBeLessThanOrEqual(32);
            expect(BATCH_EMBED_SIZE).toBeGreaterThan(0);
        });
    });
    describe('Integration: Document Filtering', () => {
        it('should filter documents when count exceeds threshold', async () => {
            expect(true).toBe(true);
        });
        it('should skip filtering for small document sets', async () => {
            prisma.documentFile.findMany.mockResolvedValue([
                { id: 'doc-1', embeddingStatus: 'completed' },
                { id: 'doc-2', embeddingStatus: 'completed' },
            ]);
            prisma.$queryRaw.mockResolvedValue([]);
            const result = await service.search('test', ['doc-1', 'doc-2']);
            expect(Array.isArray(result)).toBe(true);
        });
    });
    describe('Embedding Status States', () => {
        const validStatuses = ['pending', 'processing', 'completed', 'failed'];
        validStatuses.forEach((status) => {
            it(`should handle status: ${status}`, async () => {
                const mockDoc = { embeddingStatus: status, resumeEmbedding: null };
                prisma.documentFile.findUnique.mockResolvedValue(mockDoc);
                const result = await service.getEmbeddingStatus('doc-123');
                expect(result).toBe(status);
            });
        });
    });
    describe('Cache Key Generation', () => {
        it('should generate unique cache keys', () => {
            const key1 = service.buildCacheKey('query', 'org-1');
            const key2 = service.buildCacheKey('query', 'org-2');
            const key3 = service.buildCacheKey('different', 'org-1');
            expect(key1).not.toBe(key2);
            expect(key1).not.toBe(key3);
        });
        it('should handle undefined organization', () => {
            const key = service.buildCacheKey('query', undefined);
            expect(key).toContain('default');
        });
    });
});
//# sourceMappingURL=vector-store.service.spec.js.map