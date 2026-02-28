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
var VectorStoreService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VectorStoreService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const aiplatform_1 = require("@google-cloud/aiplatform");
const vertexai_1 = require("@google-cloud/vertexai");
const supabase_js_1 = require("@supabase/supabase-js");
const prisma_service_1 = require("../prisma/prisma.service");
const vertex_retry_1 = require("../common/vertex-retry");
const cache_service_1 = require("../common/cache.service");
const parsePositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const CHUNK_APPROX_CHARS_PER_TOKEN = parsePositiveNumber(process.env.VECTOR_CHUNK_CHARS_PER_TOKEN, 4);
const EMBEDDING_APPROX_CHARS_PER_TOKEN = parsePositiveNumber(process.env.VECTOR_EMBED_CHARS_PER_TOKEN, 2.6);
const BATCH_EMBED_SIZE = Math.max(1, Math.floor(parsePositiveNumber(process.env.VECTOR_EMBED_BATCH_SIZE, 5)));
const EMBEDDING_MAX_RETRIES = 5;
const EMBEDDING_BACKOFF_BASE_MS = 1000;
const EMBEDDING_CACHE_MAX = 2048;
const QUERY_EMBEDDING_CACHE_TTL_SECONDS = Math.max(Number(process.env.VECTOR_QUERY_EMBED_CACHE_TTL_SECONDS || 21600), 300);
const EMBEDDING_BATCH_TOKEN_TARGET = Math.max(2000, Math.floor(parsePositiveNumber(process.env.VECTOR_EMBED_TOKEN_TARGET, 12000)));
const DEFAULT_CHUNK_TOKENS = Math.max(256, Math.floor(parsePositiveNumber(process.env.VECTOR_CHUNK_TOKENS, 640)));
const DEFAULT_CHUNK_OVERLAP_TOKENS = Math.max(0, Math.floor(parsePositiveNumber(process.env.VECTOR_CHUNK_OVERLAP_TOKENS, 64)));
const EMBEDDING_DIMENSION = 768;
const DEFAULT_VECTOR_BUCKET = 'mia-docs-vectors';
const DEFAULT_CHUNK_INDEX = 'document-chunks';
const DEFAULT_SUMMARY_INDEX = 'document-summaries';
const DEFAULT_VECTOR_SCHEMA = 'mia-docs-vectors';
const VECTOR_CHUNK_TABLE = 'document_chunk_vectors';
const VECTOR_SUMMARY_TABLE = 'document_summary_vectors';
const VECTOR_WORK_ORDER_SUMMARY_TABLE = 'work_order_summary_vectors';
const VECTOR_UPSERT_MAX_RETRIES = 3;
const VECTOR_UPSERT_RETRY_BASE_MS = 500;
const DEFAULT_WORK_ORDER_SUMMARY_INDEX = 'work-order-summaries';
const RERANK_MODEL_ID = process.env.RERANK_MODEL_ID || 'gemini-2.0-flash';
const RERANK_TOP_K = Math.max(3, Math.floor(parsePositiveNumber(process.env.RERANK_TOP_K, 8)));
class LRUEmbeddingCache {
    maxSize;
    map = new Map();
    constructor(maxSize) {
        this.maxSize = maxSize;
    }
    get(key) {
        const value = this.map.get(key);
        if (value === undefined)
            return undefined;
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }
    set(key, value) {
        if (this.map.has(key))
            this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size > this.maxSize) {
            const firstKey = this.map.keys().next().value;
            this.map.delete(firstKey);
        }
    }
    clear() {
        this.map.clear();
    }
}
let VectorStoreService = VectorStoreService_1 = class VectorStoreService {
    prisma;
    cacheService;
    logger = new common_1.Logger(VectorStoreService_1.name);
    projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    location = process.env.VERTEX_LOCATION || 'us-central1';
    embeddingModel = process.env.AI_EMBEDDING_MODEL_ID || 'text-embedding-004';
    predictionClient;
    rerankModel;
    infraReady;
    vectorBackend;
    supabase = null;
    vectorBucketName;
    chunkIndexName;
    summaryIndexName;
    workOrderSummaryIndexName;
    vectorSchema;
    queryEmbeddingCache = new LRUEmbeddingCache(EMBEDDING_CACHE_MAX);
    constructor(prisma, cacheService) {
        this.prisma = prisma;
        this.cacheService = cacheService;
        this.vectorSchema = this.resolveVectorSchema();
        this.vectorBucketName = this.resolveVectorBucketName();
        this.chunkIndexName = this.resolveChunkIndexName();
        this.summaryIndexName = this.resolveSummaryIndexName();
        this.workOrderSummaryIndexName = this.resolveWorkOrderSummaryIndexName();
        if (!this.projectId) {
            this.logger.warn('VERTEX_PROJECT_ID (or FIREBASE_PROJECT_ID) not found. Vector store disabled.');
            this.predictionClient = null;
            this.rerankModel = null;
            this.vectorBackend = 'none';
            this.infraReady = Promise.resolve();
            return;
        }
        this.predictionClient = new aiplatform_1.v1.PredictionServiceClient({
            apiEndpoint: `${this.location}-aiplatform.googleapis.com`,
        });
        try {
            const vertexAI = new vertexai_1.VertexAI({ project: this.projectId, location: this.location });
            this.rerankModel = vertexAI.preview.getGenerativeModel({
                model: RERANK_MODEL_ID,
                generationConfig: { temperature: 0, maxOutputTokens: 2048 },
            });
            this.logger.log(`Reranking model initialized: ${RERANK_MODEL_ID}`);
        }
        catch (e) {
            this.logger.warn(`Reranking model unavailable: ${e?.message}`);
            this.rerankModel = null;
        }
        const supabaseUrl = process.env.SUPABASE_URL?.trim();
        const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY?.trim();
        const supabaseKey = supabaseServiceRoleKey || supabaseServiceKey;
        const supabaseKeySource = supabaseServiceRoleKey
            ? 'SUPABASE_SERVICE_ROLE_KEY'
            : supabaseServiceKey
                ? 'SUPABASE_SERVICE_KEY'
                : null;
        if (supabaseUrl && supabaseKey) {
            this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey, {
                auth: { persistSession: false, autoRefreshToken: false },
            });
            this.vectorBackend = 'supabase';
            this.infraReady = this.ensureSupabaseVectorInfrastructure();
            this.logger.log(`Vector backend: supabase (bucket: ${this.vectorBucketName}, index: ${this.chunkIndexName}, key: ${supabaseKeySource})`);
        }
        else {
            if (!supabaseUrl || !supabaseKey) {
                this.logger.warn('Supabase vectors not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY). Falling back to pgvector.');
            }
            this.vectorBackend = 'pgvector';
            this.infraReady = this.ensurePgVectorInfrastructure();
            this.logger.log(`Vector backend: pgvector (schema: ${this.vectorSchema})`);
        }
    }
    async indexDocumentSummary(documentId, summary) {
        if (!this.predictionClient)
            return;
        if (!summary || summary.trim().length === 0)
            return;
        try {
            await this.infraReady;
            const [embedding] = await this.embedBatchEfficient([summary.slice(0, 500)], 'RETRIEVAL_DOCUMENT');
            if (embedding.length === 0)
                return;
            try {
                await this.upsertSummaryEmbedding(documentId, embedding);
            }
            catch (error) {
                this.logger.warn(`Failed to store summary embedding for ${documentId}: ${error?.message || error}`);
            }
            await this.prisma.documentFile.update({
                where: { id: documentId },
                data: {
                    resumeEmbedding: embedding,
                },
            });
        }
        catch (error) {
            this.logger.error(`Failed to index summary for ${documentId}: ${error?.message || error}`);
        }
    }
    async indexWorkOrderSummary(workOrderId, summary) {
        if (!this.predictionClient)
            return;
        if (!summary || summary.trim().length === 0)
            return;
        try {
            await this.infraReady;
            const [embedding] = await this.embedBatchEfficient([summary.slice(0, 1000)], 'RETRIEVAL_DOCUMENT');
            if (embedding.length === 0)
                return;
            try {
                await this.upsertWorkOrderSummaryEmbedding(workOrderId, embedding);
            }
            catch (error) {
                this.logger.warn(`Failed to store work order summary embedding for ${workOrderId}: ${error?.message || error}`);
            }
        }
        catch (error) {
            this.logger.error(`Failed to index work order summary for ${workOrderId}: ${error?.message || error}`);
        }
    }
    async indexDocument(documentId, text, options) {
        if (!this.predictionClient) {
            this.logger.warn('Skipping indexing because prediction client is unavailable');
            return;
        }
        await this.infraReady;
        try {
            await this.prisma.documentFile.update({
                where: { id: documentId },
                data: { embeddingStatus: 'processing' },
            });
            const chunks = this.chunkText(text, options);
            if (chunks.length === 0) {
                this.logger.warn(`No chunks generated for document ${documentId}`);
                await this.prisma.documentFile.update({
                    where: { id: documentId },
                    data: {
                        embeddingStatus: 'completed',
                        embeddingProcessedAt: new Date(),
                    },
                });
                return;
            }
            this.logger.log(`Saving ${chunks.length} pending chunks for document ${documentId}`);
            const chunkRows = chunks.map((chunk) => ({
                documentId,
                chunkIndex: chunk.index,
                text: chunk.text,
                tokenCount: this.countTokensApprox(chunk.text),
            }));
            if (this.vectorBackend === 'supabase') {
                const embeddings = await this.embedBatchEfficient(chunkRows.map((chunk) => chunk.text), 'RETRIEVAL_DOCUMENT');
                if (embeddings.length !== chunkRows.length) {
                    throw new Error(`Embedding count mismatch for ${documentId}: chunks=${chunkRows.length}, embeddings=${embeddings.length}`);
                }
                await this.replaceChunkEmbeddingsSupabase(documentId, chunkRows, embeddings);
                await this.prisma.documentFile.update({
                    where: { id: documentId },
                    data: {
                        embeddingStatus: 'completed',
                        embeddingProcessedAt: new Date(),
                    },
                });
                this.logger.log(`Successfully indexed ${chunkRows.length} chunks for document ${documentId} (supabase)`);
                return;
            }
            await this.insertPendingChunks(documentId, chunkRows);
            this.logger.log(`Successfully queued ${chunkRows.length} chunks for document ${documentId} (Embeddings pending)`);
        }
        catch (error) {
            this.logger.error(`Document chunking failed for document ${documentId}: ${error?.message || error}`);
            try {
                await this.prisma.documentFile.update({
                    where: { id: documentId },
                    data: { embeddingStatus: 'failed' },
                });
            }
            catch (updateError) {
                this.logger.error(`Failed to update embedding status for ${documentId}: ${updateError?.message || updateError}`);
            }
            throw error;
        }
    }
    async processPendingEmbeddings(batchLimit = 300) {
        if (!this.predictionClient)
            return 0;
        await this.infraReady;
        if (this.vectorBackend !== 'pgvector') {
            this.logger.warn('Async embedding processing is only supported for pgvector backend currently.');
            return 0;
        }
        const maxParallelDocs = Math.min(Math.max(Math.floor(Number(process.env.DOCUMENT_VECTOR_SWEEP_MAX_PARALLEL_DOCS || 4) || 4), 1), 16);
        const configuredChunksPerDoc = Math.min(Math.max(Number(process.env.DOCUMENT_VECTOR_SWEEP_CHUNKS_PER_DOC || 10) || 10, 1), 50);
        const chunksPerDoc = Math.min(configuredChunksPerDoc, Math.max(1, Math.floor(batchLimit / maxParallelDocs)));
        try {
            const table = this.vectorTable(VECTOR_CHUNK_TABLE);
            const pendingDocs = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT document_id as "documentId"
                   FROM ${table}
                   WHERE embedding IS NULL
                   GROUP BY document_id
                   ORDER BY MIN(created_at) ASC
                   LIMIT ${maxParallelDocs}`);
            if (pendingDocs.length === 0)
                return 0;
            this.logger.log(`[VectorSweep] ${pendingDocs.length} doc(s) pending — processing in parallel (${chunksPerDoc} chunks/doc).`);
            const results = await Promise.allSettled(pendingDocs.map(({ documentId }) => this.embedChunkBatchForDocument(table, documentId, chunksPerDoc)));
            let totalUpdated = 0;
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    totalUpdated += result.value;
                }
                else {
                    this.logger.error(`[VectorSweep] A document embedding job failed: ${result.reason?.message || result.reason}`);
                }
            }
            if (totalUpdated > 0) {
                this.logger.log(`[VectorSweep] Saved ${totalUpdated} chunk embeddings across ${pendingDocs.length} document(s).`);
            }
            return totalUpdated;
        }
        catch (error) {
            this.logger.error(`Failed to process pending embeddings: ${error?.message || error}`, error?.stack);
            return 0;
        }
    }
    async embedChunkBatchForDocument(table, documentId, batchSize) {
        const pendingChunks = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT document_id as "documentId", chunk_index as "chunkIndex", text
                 FROM ${table}
                 WHERE document_id = ${documentId} AND embedding IS NULL
                 LIMIT ${batchSize}`);
        if (pendingChunks.length === 0)
            return 0;
        const texts = pendingChunks.map((c) => c.text);
        const embeddings = await this.embedBatchEfficient(texts, 'RETRIEVAL_DOCUMENT');
        if (embeddings.length !== pendingChunks.length) {
            this.logger.error(`[VectorSweep] Embedding count mismatch for doc ${documentId}: expected ${pendingChunks.length}, got ${embeddings.length}`);
            return 0;
        }
        const updateValues = pendingChunks.map((chunk, i) => {
            const vec = this.toVectorLiteral(embeddings[i]);
            return client_1.Prisma.sql `(${chunk.documentId}::text, ${chunk.chunkIndex}::int, ${vec}::public.vector)`;
        });
        await this.prisma.$executeRaw(client_1.Prisma.sql `UPDATE ${table} AS t
                 SET embedding = v.embedding
                 FROM (VALUES ${client_1.Prisma.join(updateValues)}) AS v(document_id, chunk_index, embedding)
                 WHERE t.document_id = v.document_id AND t.chunk_index = v.chunk_index`);
        const remaining = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT 1 FROM ${table} WHERE document_id = ${documentId} AND embedding IS NULL LIMIT 1`);
        if (remaining.length === 0) {
            try {
                await this.prisma.documentFile.update({
                    where: { id: documentId },
                    data: { embeddingStatus: 'completed', embeddingProcessedAt: new Date() },
                });
                this.logger.log(`[VectorSweep] Document ${documentId} fully embedded ✅`);
            }
            catch (err) {
                this.logger.warn(`[VectorSweep] Could not mark doc ${documentId} completed: ${err?.message}`);
            }
        }
        else {
            this.logger.log(`[VectorSweep] Doc ${documentId}: embedded ${pendingChunks.length} chunks, more remain.`);
        }
        return pendingChunks.length;
    }
    async search(query, documentIds, topK = 30, organizationId) {
        if (!this.predictionClient) {
            this.logger.warn('Vector search skipped: prediction client unavailable');
            return [];
        }
        if (!documentIds?.length)
            return [];
        await this.infraReady;
        const docStatus = await this.prisma.documentFile.findMany({
            where: { id: { in: documentIds } },
            select: {
                id: true,
                embeddingStatus: true,
            },
        });
        const readyDocs = docStatus
            .filter((d) => d.embeddingStatus === 'completed')
            .map((d) => d.id);
        if (readyDocs.length === 0) {
            this.logger.warn(`No documents with completed embeddings for search in ${documentIds}`);
            return [];
        }
        const queryEmbedding = await this.embedQuery(query, organizationId);
        if (!queryEmbedding.length) {
            this.logger.warn('Empty query embedding; returning no chunks');
            return [];
        }
        try {
            let docsToSearch = readyDocs;
            if (readyDocs.length > 5) {
                const relevantDocs = await this.findMostRelevantDocuments(queryEmbedding, readyDocs, Math.min(5, Math.ceil(readyDocs.length / 2)));
                if (relevantDocs.length > 0) {
                    docsToSearch = relevantDocs;
                    this.logger.log(`Filtered ${readyDocs.length} documents to ${relevantDocs.length} relevant for query`);
                }
            }
            const chunks = await this.searchChunkEmbeddings(docsToSearch, queryEmbedding, topK);
            if (chunks.length === 0) {
                this.logger.warn(`No chunks found for documents: ${docsToSearch}`);
                if (this.vectorBackend === 'supabase') {
                    this.markSupabaseDocsPendingIfChunksExist(docsToSearch).catch((err) => {
                        this.logger.warn(`Failed to mark missing Supabase vectors as pending: ${err?.message || err}`);
                    });
                }
                return [];
            }
            const chunkDocIds = Array.from(new Set(chunks.map((chunk) => chunk.documentId)));
            const docs = await this.prisma.documentFile.findMany({
                where: { id: { in: chunkDocIds } },
                select: { id: true, title: true, originalName: true },
            });
            const docLookup = new Map(docs.map((doc) => [doc.id, doc]));
            const mappedChunks = chunks.map((chunk) => {
                const meta = docLookup.get(chunk.documentId);
                return {
                    id: `${chunk.documentId}:${chunk.chunkIndex}`,
                    documentId: chunk.documentId,
                    chunkIndex: chunk.chunkIndex,
                    text: chunk.text,
                    distance: chunk.distance,
                    title: meta?.title ?? null,
                    originalName: meta?.originalName ?? null,
                };
            });
            const boostedChunks = await this.applyTechnicianSelectionBoost(mappedChunks);
            if (this.rerankModel && boostedChunks.length > RERANK_TOP_K) {
                try {
                    return await this.rerankChunks(query, boostedChunks, RERANK_TOP_K);
                }
                catch (rerankError) {
                    this.logger.warn(`Reranking failed, using cosine order: ${rerankError?.message}`);
                }
            }
            return boostedChunks;
        }
        catch (error) {
            this.logger.error(`Vector search failed: ${error?.message || error}`, error?.stack);
            return [];
        }
    }
    async applyTechnicianSelectionBoost(chunks) {
        if (!chunks.length)
            return chunks;
        try {
            const uniquePairs = Array.from(new Map(chunks.map((chunk) => [
                `${chunk.documentId}:${chunk.chunkIndex}`,
                { documentId: chunk.documentId, chunkIndex: chunk.chunkIndex },
            ])).values());
            const selectionRows = uniquePairs.length > 0
                ? await this.prisma.documentChunk.findMany({
                    where: {
                        OR: uniquePairs.map((pair) => ({
                            documentId: pair.documentId,
                            chunkIndex: pair.chunkIndex,
                        })),
                    },
                    select: {
                        documentId: true,
                        chunkIndex: true,
                        technicianSelectionCount: true,
                    },
                })
                : [];
            const selectionCountMap = new Map(selectionRows.map((row) => [
                `${row.documentId}:${row.chunkIndex}`,
                Number(row.technicianSelectionCount || 0),
            ]));
            return chunks
                .map((chunk) => {
                const selectionCount = selectionCountMap.get(`${chunk.documentId}:${chunk.chunkIndex}`) || 0;
                const distance = Number.isFinite(chunk.distance) ? chunk.distance : 1;
                const baseScore = 1 / (1 + Math.max(0, distance));
                const boostedScore = baseScore * (1 + 0.2 * selectionCount);
                return {
                    ...chunk,
                    technicianSelectionCount: selectionCount,
                    boostedScore,
                };
            })
                .sort((a, b) => (b.boostedScore || 0) - (a.boostedScore || 0));
        }
        catch (error) {
            this.logger.warn(`Technician selection boost failed, using base vector ranking: ${error?.message || error}`);
            return chunks;
        }
    }
    async markSupabaseDocsPendingIfChunksExist(documentIds) {
        if (!documentIds.length)
            return;
        const chunkGroups = await this.prisma.documentChunk.groupBy({
            by: ['documentId'],
            where: { documentId: { in: documentIds } },
            _count: { _all: true },
        });
        const candidates = chunkGroups
            .filter((row) => row._count._all > 0)
            .map((row) => row.documentId);
        if (!candidates.length)
            return;
        const updated = await this.prisma.documentFile.updateMany({
            where: {
                id: { in: candidates },
                embeddingStatus: 'completed',
            },
            data: { embeddingStatus: 'pending' },
        });
        if (updated.count > 0) {
            this.logger.warn(`Marked ${updated.count} document(s) as pending because Supabase vector hits were missing`);
        }
    }
    async getEmbeddingStatus(documentId) {
        const doc = await this.prisma.documentFile.findUnique({
            where: { id: documentId },
            select: { embeddingStatus: true },
        });
        return doc?.embeddingStatus || null;
    }
    async isDocumentEmbedded(documentId) {
        const status = await this.getEmbeddingStatus(documentId);
        return status === 'completed';
    }
    async isSummaryIndexed(documentId) {
        const doc = await this.prisma.documentFile.findUnique({
            where: { id: documentId },
            select: { resumeEmbedding: true },
        });
        return !!doc?.resumeEmbedding;
    }
    async findMostRelevantDocuments(queryEmbedding, documentIds, topK) {
        if (documentIds.length === 0)
            return [];
        try {
            const docs = await this.prisma.documentFile.findMany({
                where: {
                    id: { in: documentIds },
                    resumeEmbedding: { not: client_1.Prisma.DbNull },
                },
                select: {
                    id: true,
                    resumeEmbedding: true,
                },
            });
            if (!docs.length)
                return documentIds;
            const scored = docs
                .map((doc) => {
                const embeddingArray = Array.isArray(doc.resumeEmbedding)
                    ? doc.resumeEmbedding
                    : [];
                const similarity = this.cosineSimilarity(queryEmbedding, embeddingArray);
                return { id: doc.id, similarity };
            })
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, topK)
                .map((d) => d.id);
            return scored.length > 0 ? scored : documentIds;
        }
        catch (error) {
            this.logger.warn(`Document filtering failed, using all documents: ${error?.message || error}`);
            return documentIds;
        }
    }
    async ensurePgVectorInfrastructure() {
        const schemaIdentifier = this.schemaIdentifier();
        const chunkTable = this.tableIdentifier(VECTOR_CHUNK_TABLE);
        const summaryTable = this.tableIdentifier(VECTOR_SUMMARY_TABLE);
        const workOrderSummaryTable = this.tableIdentifier(VECTOR_WORK_ORDER_SUMMARY_TABLE);
        try {
            await this.prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
            this.logger.log('pgvector extension ensured');
        }
        catch (err) {
            this.logger.error(`Failed to ensure vector extension: ${err?.message || err}`);
        }
        try {
            await this.prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schemaIdentifier}`);
            this.logger.log(`Vector schema ensured: ${this.vectorSchema}`);
        }
        catch (err) {
            this.logger.error(`Failed to ensure vector schema: ${err?.message || err}`);
        }
        try {
            await this.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${chunkTable} (
          document_id TEXT NOT NULL,
          chunk_index INT NOT NULL,
          text TEXT NOT NULL,
          token_count INT,
          embedding public.vector(${EMBEDDING_DIMENSION}),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (document_id, chunk_index)
        )`);
            try {
                await this.prisma.$executeRawUnsafe(`ALTER TABLE ${chunkTable} ALTER COLUMN embedding DROP NOT NULL`);
            }
            catch (alterErr) {
            }
            await this.prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS document_chunk_vectors_document_id_idx
         ON ${chunkTable} (document_id)`);
            this.logger.log('Vector chunk table ensured (using exact search operations)');
        }
        catch (err) {
            this.logger.warn(`Vector chunk infrastructure skipped: ${err?.message || err}`);
        }
        try {
            await this.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${summaryTable} (
          document_id TEXT PRIMARY KEY,
          embedding public.vector(${EMBEDDING_DIMENSION}) NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
            this.logger.log('Vector summary table ensured');
        }
        catch (err) {
            this.logger.warn(`Vector summary infrastructure skipped: ${err?.message || err}`);
        }
        try {
            await this.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${workOrderSummaryTable} (
          work_order_id TEXT PRIMARY KEY,
          embedding public.vector(${EMBEDDING_DIMENSION}) NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
            this.logger.log('Vector work order summary table ensured');
        }
        catch (err) {
            this.logger.warn(`Vector work order summary infrastructure skipped: ${err?.message || err}`);
        }
    }
    async ensureSupabaseVectorInfrastructure() {
        const vectors = this.getVectorsClient();
        if (!vectors) {
            this.logger.error('Supabase vectors client not available. Check @supabase/supabase-js version and configuration.');
            return;
        }
        try {
            const bucketResult = await vectors.createBucket(this.vectorBucketName);
            if (bucketResult?.error &&
                !this.isSupabaseVectorConflict(bucketResult.error)) {
                this.logger.warn(`Failed to create vector bucket ${this.vectorBucketName}: ${bucketResult.error.message}`);
            }
            else if (!bucketResult?.error) {
                this.logger.log(`Vector bucket ensured: ${this.vectorBucketName}`);
            }
        }
        catch (error) {
            this.logger.warn(`Vector bucket ensure failed (${this.vectorBucketName}): ${error?.message || error}`);
        }
        const bucket = this.getVectorBucketScope();
        if (!bucket)
            return;
        const ensureIndex = async (indexName) => {
            try {
                const indexResult = await bucket.createIndex({
                    indexName,
                    dataType: 'float32',
                    dimension: EMBEDDING_DIMENSION,
                    distanceMetric: 'cosine',
                });
                if (indexResult?.error &&
                    !this.isSupabaseVectorConflict(indexResult.error)) {
                    this.logger.warn(`Failed to create vector index ${indexName}: ${indexResult.error.message}`);
                }
                else if (!indexResult?.error) {
                    this.logger.log(`Vector index ensured: ${indexName}`);
                }
            }
            catch (error) {
                this.logger.warn(`Vector index ensure failed (${indexName}): ${error?.message || error}`);
            }
        };
        await ensureIndex(this.chunkIndexName);
        await ensureIndex(this.summaryIndexName);
        await ensureIndex(this.workOrderSummaryIndexName);
    }
    resolveWorkOrderSummaryIndexName() {
        return process.env.VECTOR_WORK_ORDER_SUMMARY_INDEX || DEFAULT_WORK_ORDER_SUMMARY_INDEX;
    }
    async embedBatchEfficient(texts, taskType = 'RETRIEVAL_DOCUMENT') {
        if (!this.predictionClient || texts.length === 0)
            return [];
        const allEmbeddings = [];
        const filteredTexts = texts
            .map((text) => String(text ?? '').trim())
            .filter((text) => text.length > 0);
        if (filteredTexts.length === 0)
            return [];
        const batches = this.buildEmbeddingBatches(filteredTexts);
        for (const batchTexts of batches) {
            const batchEmbeddings = await this.embedBatchWithAdaptiveSizing(batchTexts, taskType);
            allEmbeddings.push(...batchEmbeddings);
        }
        return allEmbeddings;
    }
    buildEmbeddingBatches(texts) {
        const batches = [];
        let currentBatch = [];
        let currentTokens = 0;
        for (const text of texts) {
            const textTokens = this.estimateEmbeddingTokens(text);
            const exceedsCount = currentBatch.length >= BATCH_EMBED_SIZE;
            const exceedsTokenBudget = currentBatch.length > 0 &&
                currentTokens + textTokens > EMBEDDING_BATCH_TOKEN_TARGET;
            if (exceedsCount || exceedsTokenBudget) {
                batches.push(currentBatch);
                currentBatch = [];
                currentTokens = 0;
            }
            currentBatch.push(text);
            currentTokens += textTokens;
        }
        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }
        return batches;
    }
    async embedBatchWithAdaptiveSizing(batchTexts, taskType) {
        if (batchTexts.length === 0)
            return [];
        for (let attempt = 1; attempt <= EMBEDDING_MAX_RETRIES; attempt += 1) {
            try {
                return await this.callVertexEmbedding(batchTexts, taskType);
            }
            catch (error) {
                const message = this.extractErrorMessage(error);
                const isTokenLimitError = this.isInvalidArgumentError(error) &&
                    /input token count|supports up to/i.test(message);
                if (isTokenLimitError && batchTexts.length > 1) {
                    const midpoint = Math.ceil(batchTexts.length / 2);
                    this.logger.warn(`Embedding batch exceeded model token limit; splitting ${batchTexts.length} texts into ${midpoint} and ${batchTexts.length - midpoint}.`);
                    const first = await this.embedBatchWithAdaptiveSizing(batchTexts.slice(0, midpoint), taskType);
                    const second = await this.embedBatchWithAdaptiveSizing(batchTexts.slice(midpoint), taskType);
                    return [...first, ...second];
                }
                const retryable = this.isRetryableEmbeddingError(error);
                if (!retryable || attempt === EMBEDDING_MAX_RETRIES) {
                    this.logger.error(`Failed to embed batch after retries: ${message}`);
                    throw error;
                }
                const delayMs = this.getEmbeddingRetryDelay(attempt);
                this.logger.warn(`Embedding batch retry ${attempt}/${EMBEDDING_MAX_RETRIES} in ${delayMs}ms: ${message}`);
                await this.delay(delayMs);
            }
        }
        return [];
    }
    async callVertexEmbedding(texts, taskType) {
        if (!this.predictionClient)
            return [];
        const endpoint = `projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.embeddingModel}`;
        const predict = async (taskField) => {
            const instances = texts.map((text) => taskField
                ? { content: text, [taskField]: taskType }
                : { content: text });
            const response = await this.predictionClient.predict({
                endpoint,
                instances: instances.map((instance) => aiplatform_1.helpers.toValue(instance)),
            });
            const rawPredictions = (response[0]?.predictions || []);
            const predictions = rawPredictions.map((prediction) => {
                try {
                    return aiplatform_1.helpers.fromValue(prediction);
                }
                catch {
                    return prediction;
                }
            });
            const embeddings = predictions.map((prediction) => this.extractEmbedding(prediction));
            if (embeddings.length !== texts.length || embeddings.some((e) => !e.length)) {
                throw new Error(`INVALID_EMBEDDING_RESPONSE: expected ${texts.length}, got ${embeddings.length}`);
            }
            return embeddings;
        };
        try {
            return await predict('task_type');
        }
        catch (errorTaskTypeSnake) {
            if (!this.isInvalidArgumentError(errorTaskTypeSnake)) {
                throw errorTaskTypeSnake;
            }
            this.logger.warn('[VectorStoreService] Embedding request rejected task_type, retrying with taskType.');
        }
        try {
            return await predict('taskType');
        }
        catch (errorTaskTypeCamel) {
            if (!this.isInvalidArgumentError(errorTaskTypeCamel)) {
                throw errorTaskTypeCamel;
            }
            this.logger.warn('[VectorStoreService] Embedding request rejected taskType, retrying without task type.');
        }
        try {
            return await predict(null);
        }
        catch (error) {
            const message = typeof error?.message === 'string' ? error.message : String(error ?? '');
            if (this.isInvalidArgumentError(error)) {
                this.logger.error(`[VectorStoreService] Embedding request failed with INVALID_ARGUMENT. Check model/location compatibility (${this.embeddingModel} @ ${this.location}) and payload format. Details: ${message}`);
            }
            throw error;
        }
    }
    async embedQuery(query, organizationId) {
        const cacheKey = this.buildCacheKey(query, organizationId);
        const cached = this.queryEmbeddingCache.get(cacheKey);
        if (cached)
            return cached;
        const distributedCacheKey = `ai:query-embedding:${cacheKey}`;
        const distributedCached = await this.cacheService.getJson(distributedCacheKey);
        if (Array.isArray(distributedCached) && distributedCached.length > 0) {
            this.queryEmbeddingCache.set(cacheKey, distributedCached);
            return distributedCached;
        }
        const [embedding] = await this.embedBatchEfficient([query], 'RETRIEVAL_QUERY');
        if (embedding?.length) {
            this.queryEmbeddingCache.set(cacheKey, embedding);
            this.cacheService
                .setJson(distributedCacheKey, embedding, QUERY_EMBEDDING_CACHE_TTL_SECONDS)
                .catch((error) => {
                this.logger.warn(`[VectorStoreService] Failed to write distributed embedding cache: ${error?.message || error}`);
            });
        }
        return embedding || [];
    }
    chunkText(text, options) {
        const chunkTokens = options?.chunkTokens ?? DEFAULT_CHUNK_TOKENS;
        const chunkChars = chunkTokens * CHUNK_APPROX_CHARS_PER_TOKEN;
        if (!text || !text.trim())
            return [];
        const sections = this.splitIntoSections(text);
        if (sections.length === 0)
            return [];
        const chunks = [];
        let buffer = '';
        let currentSection = '';
        let index = 0;
        for (const section of sections) {
            const candidate = buffer ? `${buffer}\n\n${section.text}` : section.text;
            if (candidate.length > chunkChars && buffer.length > 0) {
                chunks.push({ text: buffer.trim(), index, section: currentSection });
                index++;
                buffer = section.text;
                currentSection = section.header || '';
            }
            else if (candidate.length > chunkChars && buffer.length === 0) {
                const subChunks = this.splitLargeSection(section.text, chunkChars);
                for (const sub of subChunks) {
                    chunks.push({ text: sub.trim(), index, section: section.header || '' });
                    index++;
                }
                buffer = '';
                currentSection = '';
            }
            else {
                buffer = candidate;
                if (!currentSection && section.header)
                    currentSection = section.header;
            }
        }
        if (buffer.trim()) {
            chunks.push({ text: buffer.trim(), index, section: currentSection });
        }
        return chunks.filter((c) => c.text.length > 20);
    }
    splitIntoSections(text) {
        const sectionPattern = /(?:^|\n)(?=(?:#{1,4}\s|(?:\d+\.)+\s+[A-ZÁÉÍÓÚ]|CAP[ÍI]TULO\s|SECCI[OÓ]N\s|PROCEDIMIENTO\s|TABLA\s+\d|Paso\s+\d|Step\s+\d|NOTA\s*:|ADVERTENCIA\s*:|PRECAUCI[OÓ]N\s*:|WARNING\s*:|CAUTION\s*:|\*{2,}[^*]+\*{2,}|={3,}|-{3,}))/gim;
        const splits = text.split(sectionPattern).filter((s) => s.trim().length > 0);
        if (splits.length <= 1) {
            return text
                .split(/\n\s*\n/)
                .filter((p) => p.trim().length > 0)
                .map((p) => {
                const headerMatch = p.match(/^(.{0,120}?)[\n.]/);
                return { text: p.trim(), header: headerMatch?.[1]?.trim() || '' };
            });
        }
        return splits.map((section) => {
            const firstLine = section.split('\n')[0]?.trim() || '';
            const isHeader = /^(?:(?:\d+\.)+\s|#{1,4}\s|CAP|SECCI|PROCED|TABLA|Paso|Step)/i.test(firstLine);
            return {
                text: section.trim(),
                header: isHeader ? firstLine.slice(0, 120) : '',
            };
        });
    }
    splitLargeSection(text, maxChars) {
        const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
        if (paragraphs.length > 1) {
            return this.mergeUpTo(paragraphs, maxChars);
        }
        const sentences = text.split(/(?<=[.!?;])\s+/).filter((s) => s.trim());
        if (sentences.length > 1) {
            return this.mergeUpTo(sentences, maxChars);
        }
        const result = [];
        let start = 0;
        while (start < text.length) {
            const end = Math.min(text.length, start + maxChars);
            result.push(text.slice(start, end).trim());
            if (end >= text.length)
                break;
            start = Math.max(0, end - Math.floor(maxChars * 0.1));
        }
        return result;
    }
    mergeUpTo(units, maxChars) {
        const result = [];
        let buffer = '';
        for (const unit of units) {
            const candidate = buffer ? `${buffer}\n\n${unit}` : unit;
            if (candidate.length > maxChars && buffer) {
                result.push(buffer.trim());
                buffer = unit;
            }
            else {
                buffer = candidate;
            }
        }
        if (buffer.trim())
            result.push(buffer.trim());
        return result;
    }
    extractEmbedding(prediction) {
        if (!prediction)
            return [];
        const values = prediction?.embeddings?.values ||
            prediction?.embedding?.values ||
            prediction?.embedding?.value ||
            prediction?.embeddings ||
            prediction?.values ||
            prediction?.data?.[0]?.embedding?.value ||
            prediction?.data?.[0]?.embedding?.values ||
            prediction?.data?.[0]?.embeddings?.values;
        if (!values || !Array.isArray(values))
            return [];
        return values.map((v) => Number(v)).slice(0, EMBEDDING_DIMENSION);
    }
    countTokensApprox(text) {
        return Math.ceil(text.length / CHUNK_APPROX_CHARS_PER_TOKEN);
    }
    estimateEmbeddingTokens(text) {
        const normalized = String(text || '').trim();
        if (!normalized)
            return 1;
        const charsEstimate = Math.ceil(normalized.length / EMBEDDING_APPROX_CHARS_PER_TOKEN);
        const wordsEstimate = Math.ceil(normalized.split(/\s+/).length * 1.15);
        return Math.max(charsEstimate, wordsEstimate, 1);
    }
    async rerankChunks(query, chunks, topK) {
        if (!this.rerankModel || chunks.length === 0)
            return chunks.slice(0, topK);
        const numberedPassages = chunks
            .map((c, i) => `[${i}] (${c.title || c.originalName || 'Documento'}): ${c.text.slice(0, 500)}`)
            .join('\n\n');
        const prompt = `Eres un sistema de reranking para mantenimiento industrial. Se te da una consulta de un técnico y ${chunks.length} pasajes de documentación técnica.

Consulta del técnico:
"${query}"

Pasajes candidatos:
${numberedPassages}

Devuelve SOLO un arreglo JSON con los índices de los ${topK} pasajes MÁS relevantes para resolver el problema del técnico, ordenados del más al menos relevante.
Evalúa relevancia por:
- ¿Contiene procedimientos, valores o mediciones específicas para este problema?
- ¿Menciona la máquina, componente o síntoma descrito?
- ¿Incluye instrucciones paso-a-paso aplicables?
- Prefiere pasajes con datos concretos (mediciones, torques, RPM) sobre descripciones genéricas.

Responde SOLO con el arreglo JSON, ejemplo: [2, 5, 0, 7, 1, 3, 6, 4]`;
        try {
            const result = await (0, vertex_retry_1.withVertexRetry)(() => this.rerankModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            }), {
                operationName: 'VectorStoreService.rerankChunks',
                onRetry: ({ attempt, nextAttempt, maxAttempts, delayMs, statusCode, errorMessage, }) => {
                    this.logger.warn(`[VectorStoreService] Vertex rerank retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                        `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`);
                },
            });
            const rawText = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonMatch = rawText.match(/\[([\d,\s]+)\]/);
            if (!jsonMatch) {
                this.logger.warn('Reranking: could not parse response, using cosine order');
                return chunks.slice(0, topK);
            }
            const indices = JSON.parse(jsonMatch[0]);
            const reranked = [];
            const seen = new Set();
            for (const idx of indices) {
                if (idx >= 0 && idx < chunks.length && !seen.has(idx)) {
                    seen.add(idx);
                    reranked.push(chunks[idx]);
                    if (reranked.length >= topK)
                        break;
                }
            }
            if (reranked.length < topK) {
                for (let i = 0; i < chunks.length && reranked.length < topK; i++) {
                    if (!seen.has(i))
                        reranked.push(chunks[i]);
                }
            }
            this.logger.log(`Reranked ${chunks.length} chunks → top ${reranked.length}`);
            return reranked;
        }
        catch (error) {
            this.logger.warn(`Reranking model error: ${error?.message}`);
            return chunks.slice(0, topK);
        }
    }
    cosineSimilarity(a, b) {
        if (!a.length || !b.length)
            return 0;
        const minLen = Math.min(a.length, b.length);
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < minLen; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
    isMissingCosineDistanceOperator(error) {
        const message = typeof error?.message === 'string' ? error.message : String(error ?? '');
        return /operator does not exist/i.test(message) && (message.includes('<=>') || message.includes('<->'));
    }
    distanceToSimilarity(distance, metric) {
        if (!Number.isFinite(distance))
            return 0;
        if (metric === 'cosine') {
            return Math.max(0, 1 - distance);
        }
        return 1 / (1 + Math.max(0, distance));
    }
    toVectorLiteral(values) {
        return `[${values.map((v) => (Number.isFinite(v) ? v : 0)).join(',')}]`;
    }
    resolveVectorBucketName() {
        const raw = process.env.VECTOR_BUCKET_NAME || DEFAULT_VECTOR_BUCKET;
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : DEFAULT_VECTOR_BUCKET;
    }
    resolveChunkIndexName() {
        const raw = process.env.VECTOR_CHUNKS_INDEX || DEFAULT_CHUNK_INDEX;
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : DEFAULT_CHUNK_INDEX;
    }
    resolveSummaryIndexName() {
        const raw = process.env.VECTOR_SUMMARY_INDEX || DEFAULT_SUMMARY_INDEX;
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : DEFAULT_SUMMARY_INDEX;
    }
    resolveVectorSchema() {
        const raw = process.env.VECTOR_DB_SCHEMA || DEFAULT_VECTOR_SCHEMA;
        const trimmed = raw.trim();
        if (!trimmed)
            return DEFAULT_VECTOR_SCHEMA;
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
            this.logger.warn(`VECTOR_DB_SCHEMA "${trimmed}" is invalid; using ${DEFAULT_VECTOR_SCHEMA}`);
            return DEFAULT_VECTOR_SCHEMA;
        }
        return trimmed;
    }
    getVectorsClient() {
        return this.supabase?.storage?.vectors;
    }
    getVectorBucketScope() {
        const vectors = this.getVectorsClient();
        return vectors?.from?.(this.vectorBucketName);
    }
    getChunkIndexScope() {
        const bucket = this.getVectorBucketScope();
        return bucket?.index?.(this.chunkIndexName);
    }
    getSummaryIndexScope() {
        const bucket = this.getVectorBucketScope();
        return bucket?.index?.(this.summaryIndexName);
    }
    getWorkOrderSummaryIndexScope() {
        const bucket = this.getVectorBucketScope();
        return bucket?.index?.(this.workOrderSummaryIndexName);
    }
    buildChunkVectorKey(documentId, chunkIndex) {
        return `${documentId}:${chunkIndex}`;
    }
    parseChunkVectorKey(key) {
        if (!key)
            return null;
        const lastColon = key.lastIndexOf(':');
        if (lastColon <= 0 || lastColon === key.length - 1)
            return null;
        const documentId = key.slice(0, lastColon);
        const chunkIndex = Number.parseInt(key.slice(lastColon + 1), 10);
        if (!Number.isFinite(chunkIndex))
            return null;
        return { documentId, chunkIndex };
    }
    schemaIdentifier() {
        return `"${this.vectorSchema.replace(/"/g, '""')}"`;
    }
    tableIdentifier(tableName) {
        return `${this.schemaIdentifier()}."${tableName}"`;
    }
    vectorTable(tableName) {
        return client_1.Prisma.raw(this.tableIdentifier(tableName));
    }
    async insertPendingChunks(documentId, chunks) {
        if (chunks.length === 0)
            return;
        if (this.vectorBackend !== 'pgvector') {
            this.logger.warn('Direct chunk insert without embeddings is only implemented for pgvector');
            return;
        }
        const table = this.vectorTable(VECTOR_CHUNK_TABLE);
        const deleteVectorsQuery = this.prisma.$executeRaw(client_1.Prisma.sql `DELETE FROM ${table} WHERE document_id = ${documentId}`);
        const values = chunks.map((chunk) => {
            return client_1.Prisma.sql `(${chunk.documentId}, ${chunk.chunkIndex}, ${chunk.text}, ${chunk.tokenCount ?? null}, NULL)`;
        });
        const insertVectorsQuery = this.prisma.$executeRaw(client_1.Prisma.sql `INSERT INTO ${table} (document_id, chunk_index, text, token_count, embedding)
                 VALUES ${client_1.Prisma.join(values)}
                 ON CONFLICT (document_id, chunk_index)
                 DO UPDATE SET text = EXCLUDED.text, token_count = EXCLUDED.token_count, embedding = EXCLUDED.embedding`);
        await this.prisma.$transaction([
            deleteVectorsQuery,
            insertVectorsQuery,
            this.prisma.documentChunk.deleteMany({ where: { documentId } }),
            this.prisma.documentChunk.createMany({ data: chunks, skipDuplicates: true }),
        ]);
    }
    async replaceChunkEmbeddings(documentId, chunks, embeddings) {
        if (chunks.length === 0)
            return;
        if (embeddings.length !== chunks.length) {
            throw new Error(`Embedding count mismatch: chunks=${chunks.length}, embeddings=${embeddings.length}`);
        }
        if (this.vectorBackend === 'supabase') {
            await this.replaceChunkEmbeddingsSupabase(documentId, chunks, embeddings);
            return;
        }
        if (this.vectorBackend !== 'pgvector')
            return;
        const table = this.vectorTable(VECTOR_CHUNK_TABLE);
        const deleteVectorsQuery = this.prisma.$executeRaw(client_1.Prisma.sql `DELETE FROM ${table} WHERE document_id = ${documentId}`);
        const values = chunks.map((chunk, idx) => {
            const vectorLiteral = this.toVectorLiteral(embeddings[idx]);
            return client_1.Prisma.sql `(${chunk.documentId}, ${chunk.chunkIndex}, ${chunk.text}, ${chunk.tokenCount ?? null}, ${vectorLiteral}::public.vector)`;
        });
        const insertVectorsQuery = this.prisma.$executeRaw(client_1.Prisma.sql `INSERT INTO ${table} (document_id, chunk_index, text, token_count, embedding)
                 VALUES ${client_1.Prisma.join(values)}
                 ON CONFLICT (document_id, chunk_index)
                 DO UPDATE SET text = EXCLUDED.text, token_count = EXCLUDED.token_count, embedding = EXCLUDED.embedding`);
        await this.prisma.$transaction([
            deleteVectorsQuery,
            insertVectorsQuery,
            this.prisma.documentChunk.deleteMany({ where: { documentId } }),
            this.prisma.documentChunk.createMany({ data: chunks, skipDuplicates: true }),
        ]);
    }
    async replaceChunkEmbeddingsSupabase(documentId, chunks, embeddings) {
        const index = this.getChunkIndexScope();
        if (!index) {
            this.logger.warn('Supabase chunk index is unavailable');
            return;
        }
        const existing = await this.prisma.documentChunk.findMany({
            where: { documentId },
            select: { chunkIndex: true },
        });
        const existingKeys = existing.map((chunk) => this.buildChunkVectorKey(documentId, chunk.chunkIndex));
        await this.deleteVectorKeys(index, existingKeys);
        const vectors = chunks.map((chunk, idx) => ({
            key: this.buildChunkVectorKey(documentId, chunk.chunkIndex),
            data: { float32: embeddings[idx] },
            metadata: { documentId },
        }));
        await this.putVectorsInBatches(index, vectors);
        await this.prisma.$transaction([
            this.prisma.documentChunk.deleteMany({ where: { documentId } }),
            this.prisma.documentChunk.createMany({ data: chunks, skipDuplicates: true }),
        ]);
    }
    async deleteVectorKeys(index, keys) {
        if (!keys.length)
            return;
        const batches = this.chunkArray(keys, 500);
        for (const batch of batches) {
            const result = await index.deleteVectors({ keys: batch });
            if (result?.error) {
                this.logger.warn(`Vector delete failed: ${result.error.message || 'unknown error'}`);
            }
        }
    }
    async putVectorsInBatches(index, vectors) {
        if (!vectors.length)
            return;
        const batches = this.chunkArray(vectors, 500);
        for (const batch of batches) {
            let lastError = 'unknown error';
            for (let attempt = 1; attempt <= VECTOR_UPSERT_MAX_RETRIES; attempt += 1) {
                const result = await index.putVectors({ vectors: batch });
                if (!result?.error) {
                    break;
                }
                lastError = result.error.message || 'unknown error';
                if (attempt < VECTOR_UPSERT_MAX_RETRIES) {
                    this.logger.warn(`Vector upsert failed (attempt ${attempt}/${VECTOR_UPSERT_MAX_RETRIES}): ${lastError}`);
                    await this.delay(VECTOR_UPSERT_RETRY_BASE_MS * attempt);
                    continue;
                }
                throw new Error(`Vector upsert failed after ${VECTOR_UPSERT_MAX_RETRIES} attempts: ${lastError}`);
            }
        }
    }
    chunkArray(values, size) {
        if (values.length <= size)
            return [values];
        const result = [];
        for (let i = 0; i < values.length; i += size) {
            result.push(values.slice(i, i + size));
        }
        return result;
    }
    async upsertSummaryEmbedding(documentId, embedding) {
        if (this.vectorBackend === 'supabase') {
            const index = this.getSummaryIndexScope();
            if (!index) {
                this.logger.warn('Supabase summary index is unavailable');
                return;
            }
            await this.putVectorsInBatches(index, [
                {
                    key: documentId,
                    data: { float32: embedding },
                    metadata: { documentId },
                },
            ]);
            return;
        }
        if (this.vectorBackend !== 'pgvector')
            return;
        const table = this.vectorTable(VECTOR_SUMMARY_TABLE);
        const vectorLiteral = this.toVectorLiteral(embedding);
        await this.prisma.$executeRaw(client_1.Prisma.sql `INSERT INTO ${table} (document_id, embedding, updated_at)
                 VALUES (${documentId}, ${vectorLiteral}::public.vector, NOW())
                 ON CONFLICT (document_id)
                 DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = NOW()`);
    }
    async upsertWorkOrderSummaryEmbedding(workOrderId, embedding) {
        if (this.vectorBackend === 'supabase') {
            const index = this.getWorkOrderSummaryIndexScope();
            if (!index) {
                this.logger.warn('Supabase work order summary index is unavailable');
                return;
            }
            await this.putVectorsInBatches(index, [
                {
                    key: workOrderId,
                    data: { float32: embedding },
                    metadata: { workOrderId },
                },
            ]);
            return;
        }
        if (this.vectorBackend !== 'pgvector')
            return;
        const table = this.vectorTable(VECTOR_WORK_ORDER_SUMMARY_TABLE);
        const vectorLiteral = this.toVectorLiteral(embedding);
        await this.prisma.$executeRaw(client_1.Prisma.sql `INSERT INTO ${table} (work_order_id, embedding, updated_at)
                 VALUES (${workOrderId}, ${vectorLiteral}::public.vector, NOW())
                 ON CONFLICT (work_order_id)
                 DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = NOW()`);
    }
    async searchChunkEmbeddings(documentIds, queryEmbedding, topK = 30) {
        if (documentIds.length === 0)
            return [];
        if (this.vectorBackend === 'supabase') {
            return this.searchChunkEmbeddingsSupabase(documentIds, queryEmbedding, topK);
        }
        if (this.vectorBackend !== 'pgvector')
            return [];
        const table = this.vectorTable(VECTOR_CHUNK_TABLE);
        const vectorLiteral = this.toVectorLiteral(queryEmbedding);
        const docIdsSql = client_1.Prisma.join(documentIds.map((id) => client_1.Prisma.sql `${id}`));
        let rows;
        try {
            rows = (await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT document_id, chunk_index, text,
                         embedding <=> ${vectorLiteral}::public.vector AS distance
                  FROM ${table}
                  WHERE document_id IN (${docIdsSql})
                  ORDER BY embedding <=> ${vectorLiteral}::public.vector
                  LIMIT ${topK}`));
        }
        catch (error) {
            if (!this.isMissingCosineDistanceOperator(error)) {
                throw error;
            }
            this.logger.warn('pgvector cosine operator (<=>) is unavailable. Falling back to Euclidean distance (<->).');
            try {
                rows = (await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT document_id, chunk_index, text,
                           embedding <-> ${vectorLiteral}::public.vector AS distance
                    FROM ${table}
                    WHERE document_id IN (${docIdsSql})
                    ORDER BY embedding <-> ${vectorLiteral}::public.vector
                    LIMIT ${topK}`));
            }
            catch (fallbackError) {
                if (!this.isMissingCosineDistanceOperator(fallbackError)) {
                    throw fallbackError;
                }
                this.logger.warn('pgvector distance operators are unavailable for chunk search. Falling back to in-memory cosine scan.');
                return this.searchChunkEmbeddingsInMemory(table, documentIds, queryEmbedding, topK);
            }
        }
        return rows.map((row) => ({
            documentId: row.document_id,
            chunkIndex: Number(row.chunk_index),
            text: row.text,
            distance: Number(row.distance),
        }));
    }
    async searchChunkEmbeddingsSupabase(documentIds, queryEmbedding, topK) {
        const index = this.getChunkIndexScope();
        if (!index) {
            this.logger.warn('Supabase chunk index is unavailable');
            return [];
        }
        const results = [];
        for (const documentId of documentIds) {
            const response = await index.queryVectors({
                queryVector: { float32: queryEmbedding },
                topK,
                filter: { documentId },
                returnDistance: true,
                returnMetadata: true,
            });
            if (response?.error) {
                this.logger.warn(`Vector query failed for ${documentId}: ${response.error.message || 'unknown error'}`);
                continue;
            }
            const vectors = response?.data?.vectors || [];
            for (const match of vectors) {
                const metadata = match.metadata || {};
                const parsed = this.parseChunkVectorKey(match.key);
                const chunkDocumentId = metadata.documentId || parsed?.documentId || documentId;
                const chunkIndexRaw = parsed?.chunkIndex ?? 0;
                const chunkIndex = Number(chunkIndexRaw);
                const text = typeof metadata.text === 'string' ? metadata.text : '';
                const distance = typeof match.distance === 'number' ? match.distance : 1;
                results.push({
                    documentId: chunkDocumentId,
                    chunkIndex: Number.isFinite(chunkIndex) ? chunkIndex : 0,
                    text,
                    distance,
                });
            }
        }
        const ranked = results.sort((a, b) => a.distance - b.distance).slice(0, topK);
        const missingText = ranked.filter((item) => !item.text);
        if (!missingText.length)
            return ranked;
        const uniquePairs = Array.from(new Map(missingText.map((item) => [
            this.buildChunkVectorKey(item.documentId, item.chunkIndex),
            { documentId: item.documentId, chunkIndex: item.chunkIndex },
        ])).values());
        const chunkRows = uniquePairs.length
            ? await this.prisma.documentChunk.findMany({
                where: {
                    OR: uniquePairs.map((item) => ({
                        documentId: item.documentId,
                        chunkIndex: item.chunkIndex,
                    })),
                },
                select: {
                    documentId: true,
                    chunkIndex: true,
                    text: true,
                },
            })
            : [];
        const chunkTextMap = new Map(chunkRows.map((row) => [
            this.buildChunkVectorKey(row.documentId, row.chunkIndex),
            row.text || '',
        ]));
        return ranked.map((item) => {
            if (item.text)
                return item;
            const text = chunkTextMap.get(this.buildChunkVectorKey(item.documentId, item.chunkIndex)) || '';
            return { ...item, text };
        });
    }
    async embedTexts(texts, options) {
        if (!this.predictionClient)
            return texts.map(() => []);
        const taskType = options?.taskType || 'RETRIEVAL_DOCUMENT';
        const normalized = texts.map((text) => String(text ?? '').trim());
        if (normalized.length === 0)
            return [];
        if (taskType === 'RETRIEVAL_QUERY') {
            return Promise.all(normalized.map((text) => text.length
                ? this.embedQuery(text, options?.organizationId)
                : Promise.resolve([])));
        }
        const nonEmpty = normalized.filter((text) => text.length > 0);
        if (nonEmpty.length === 0)
            return normalized.map(() => []);
        const embedded = await this.embedBatchEfficient(nonEmpty, taskType);
        let cursor = 0;
        return normalized.map((text) => {
            if (!text.length)
                return [];
            const vector = embedded[cursor] || [];
            cursor += 1;
            return vector;
        });
    }
    buildCacheKey(query, organizationId) {
        return `${organizationId || 'default'}|${query}`;
    }
    isSupabaseVectorConflict(error) {
        const statusCode = String(error?.statusCode || '').trim();
        const message = String(error?.message || '').toLowerCase();
        return (statusCode === 'S3VectorConflictException' ||
            message.includes('already exists'));
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    extractErrorMessage(error) {
        if (!error)
            return 'unknown error';
        if (typeof error?.message === 'string' && error.message.trim().length > 0) {
            return error.message;
        }
        if (typeof error === 'string')
            return error;
        try {
            return JSON.stringify(error);
        }
        catch {
            return String(error);
        }
    }
    isInvalidArgumentError(error) {
        const message = this.extractErrorMessage(error).toUpperCase();
        return (message.includes('INVALID_ARGUMENT') ||
            String(error?.code || '').toUpperCase() === 'INVALID_ARGUMENT' ||
            Number(error?.code) === 3);
    }
    isRetryableEmbeddingError(error) {
        const message = this.extractErrorMessage(error).toUpperCase();
        const numericCode = Number(error?.code);
        if (numericCode === 429 || numericCode === 8 || numericCode === 14 || numericCode === 4) {
            return true;
        }
        return (message.includes('429') ||
            message.includes('RESOURCE_EXHAUSTED') ||
            message.includes('TOO MANY REQUESTS') ||
            message.includes('UNAVAILABLE') ||
            message.includes('DEADLINE_EXCEEDED') ||
            message.includes('ETIMEDOUT') ||
            message.includes('ECONNRESET'));
    }
    getEmbeddingRetryDelay(attempt) {
        const exponential = EMBEDDING_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 250);
        return exponential + jitter;
    }
    async searchDocumentsByRelevance(query, documentIds, topK = 5, organizationId) {
        if (!this.predictionClient || documentIds.length === 0)
            return [];
        const queryEmbedding = await this.embedQuery(query, organizationId);
        if (queryEmbedding.length === 0)
            return [];
        const docs = await this.prisma.documentFile.findMany({
            where: {
                id: { in: documentIds },
                resumeEmbedding: { not: client_1.Prisma.DbNull },
            },
            select: {
                id: true,
                title: true,
                originalName: true,
                resumeEmbedding: true,
            },
        });
        const scored = docs
            .map((doc) => {
            const embeddingArray = Array.isArray(doc.resumeEmbedding)
                ? doc.resumeEmbedding
                : [];
            const similarity = this.cosineSimilarity(queryEmbedding, embeddingArray);
            return {
                documentId: doc.id,
                similarity,
                title: doc.title,
                originalName: doc.originalName,
            };
        })
            .filter((d) => d.similarity > 0.3)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
        return scored;
    }
    async searchWorkOrderSummaries(query, topK = 5, organizationId) {
        if (!this.predictionClient)
            return [];
        const queryEmbedding = await this.embedQuery(query, organizationId);
        if (queryEmbedding.length === 0)
            return [];
        if (this.vectorBackend === 'supabase') {
            const index = this.getWorkOrderSummaryIndexScope();
            if (!index) {
                this.logger.warn('Supabase work order summary index is unavailable');
                return [];
            }
            const response = await index.queryVectors({
                queryVector: { float32: queryEmbedding },
                topK,
                returnDistance: true,
                returnMetadata: true,
            });
            if (response?.error) {
                this.logger.warn(`Work order vector query failed: ${response.error.message || 'unknown error'}`);
                return [];
            }
            const vectors = response?.data?.vectors || [];
            const workOrderIds = vectors.map((v) => v.metadata?.workOrderId || v.key).filter(Boolean);
            if (workOrderIds.length === 0)
                return [];
            const workOrders = await this.prisma.workOrder.findMany({
                where: { id: { in: workOrderIds } },
                select: { id: true, otNumber: true, technicalReport: true, description: true, symptoms: true },
            });
            const woLookup = new Map(workOrders.map((wo) => [wo.id, wo]));
            const results = vectors.map((v) => {
                const id = v.metadata?.workOrderId || v.key;
                const distance = typeof v.distance === 'number' ? v.distance : 1;
                const wo = woLookup.get(id);
                let summary = wo?.technicalReport?.diagnosis || wo?.technicalReport?.rootCause || wo?.description || null;
                return {
                    workOrderId: id,
                    otNumber: wo?.otNumber || 'UNKNOWN',
                    similarity: Math.max(0, 1 - distance),
                    summary,
                };
            });
            return results.filter((r) => r.similarity > 0).sort((a, b) => b.similarity - a.similarity).slice(0, topK);
        }
        if (this.vectorBackend === 'pgvector') {
            const table = this.vectorTable(VECTOR_WORK_ORDER_SUMMARY_TABLE);
            const vectorLiteral = this.toVectorLiteral(queryEmbedding);
            let metric = 'cosine';
            let rows;
            try {
                rows = (await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT work_order_id,
                           embedding <=> ${vectorLiteral}::public.vector AS distance
                    FROM ${table}
                    ORDER BY embedding <=> ${vectorLiteral}::public.vector
                    LIMIT ${topK}`));
            }
            catch (error) {
                if (!this.isMissingCosineDistanceOperator(error)) {
                    throw error;
                }
                metric = 'l2';
                this.logger.warn('pgvector cosine operator (<=>) is unavailable for work order search. Falling back to Euclidean distance (<->).');
                try {
                    rows = (await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT work_order_id,
                             embedding <-> ${vectorLiteral}::public.vector AS distance
                      FROM ${table}
                      ORDER BY embedding <-> ${vectorLiteral}::public.vector
                      LIMIT ${topK}`));
                }
                catch (fallbackError) {
                    if (!this.isMissingCosineDistanceOperator(fallbackError)) {
                        throw fallbackError;
                    }
                    this.logger.warn('pgvector distance operators are unavailable for work order search. Falling back to in-memory cosine scan.');
                    metric = 'cosine';
                    rows = await this.searchWorkOrderEmbeddingsInMemory(table, queryEmbedding, topK);
                }
            }
            if (rows.length === 0)
                return [];
            const workOrderIds = rows.map((r) => r.work_order_id);
            const workOrders = await this.prisma.workOrder.findMany({
                where: { id: { in: workOrderIds } },
                select: { id: true, otNumber: true, technicalReport: true, description: true, symptoms: true },
            });
            const woLookup = new Map(workOrders.map((wo) => [wo.id, wo]));
            const results = rows.map((row) => {
                const wo = woLookup.get(row.work_order_id);
                let summary = wo?.technicalReport?.diagnosis || wo?.technicalReport?.rootCause || wo?.description || null;
                return {
                    workOrderId: row.work_order_id,
                    otNumber: wo?.otNumber || 'UNKNOWN',
                    similarity: this.distanceToSimilarity(Number(row.distance), metric),
                    summary,
                };
            });
            return results.filter((r) => r.similarity > 0).sort((a, b) => b.similarity - a.similarity);
        }
        return [];
    }
    async searchChunkEmbeddingsInMemory(table, documentIds, queryEmbedding, topK) {
        if (!documentIds.length)
            return [];
        const docIdsSql = client_1.Prisma.join(documentIds.map((id) => client_1.Prisma.sql `${id}`));
        const rows = (await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT document_id, chunk_index, text, embedding::text AS embedding_text
                 FROM ${table}
                 WHERE document_id IN (${docIdsSql})`));
        const scored = rows
            .map((row) => {
            const embedding = this.parsePgVectorText(row.embedding_text);
            const similarity = this.cosineSimilarity(queryEmbedding, embedding);
            return {
                documentId: row.document_id,
                chunkIndex: Number(row.chunk_index),
                text: row.text,
                distance: Math.max(0, 1 - similarity),
                similarity,
            };
        })
            .filter((row) => Number.isFinite(row.similarity) && row.similarity > 0)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK)
            .map(({ similarity: _similarity, ...row }) => row);
        return scored;
    }
    async searchWorkOrderEmbeddingsInMemory(table, queryEmbedding, topK) {
        const rows = (await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT work_order_id, embedding::text AS embedding_text
                 FROM ${table}`));
        return rows
            .map((row) => {
            const embedding = this.parsePgVectorText(row.embedding_text);
            const similarity = this.cosineSimilarity(queryEmbedding, embedding);
            return {
                work_order_id: row.work_order_id,
                distance: Math.max(0, 1 - similarity),
                similarity,
            };
        })
            .filter((row) => Number.isFinite(row.similarity) && row.similarity > 0)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK)
            .map(({ similarity: _similarity, ...row }) => row);
    }
    parsePgVectorText(raw) {
        if (typeof raw !== 'string')
            return [];
        const trimmed = raw.trim();
        if (!trimmed.startsWith('[') || !trimmed.endsWith(']'))
            return [];
        const body = trimmed.slice(1, -1).trim();
        if (!body)
            return [];
        return body
            .split(',')
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isFinite(value));
    }
};
exports.VectorStoreService = VectorStoreService;
exports.VectorStoreService = VectorStoreService = VectorStoreService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        cache_service_1.CacheService])
], VectorStoreService);
//# sourceMappingURL=vector-store.service.js.map