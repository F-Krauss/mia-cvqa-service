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
var SmartDocumentRetrieverService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartDocumentRetrieverService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const vertexai_1 = require("@google-cloud/vertexai");
const vertex_retry_1 = require("../common/vertex-retry");
let SmartDocumentRetrieverService = SmartDocumentRetrieverService_1 = class SmartDocumentRetrieverService {
    prisma;
    logger = new common_1.Logger(SmartDocumentRetrieverService_1.name);
    vertexAI;
    model;
    constructor(prisma) {
        this.prisma = prisma;
        const projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
        const location = process.env.VERTEX_LOCATION || 'us-central1';
        if (!projectId) {
            this.logger.warn('VERTEX_PROJECT_ID (or FIREBASE_PROJECT_ID) not found. Smart retrieval will fall back to basic search.');
            this.vertexAI = null;
            this.model = null;
        }
        else {
            this.vertexAI = new vertexai_1.VertexAI({ project: projectId, location });
            this.model = this.vertexAI.preview.getGenerativeModel({ model: 'gemini-2.5-flash' });
        }
    }
    async findRelevantDocuments(query, candidateDocumentIds, maxResults = 3) {
        if (candidateDocumentIds.length === 0) {
            return [];
        }
        const documents = await this.prisma.documentFile.findMany({
            where: {
                id: { in: candidateDocumentIds },
                ragEnabled: true,
                aiProcessingStatus: 'completed',
            },
            select: {
                id: true,
                originalName: true,
                title: true,
                code: true,
                aiSummary: true,
                aiTags: true,
            },
        });
        if (documents.length === 0) {
            this.logger.warn('No documents with completed AI processing found');
            return candidateDocumentIds.slice(0, maxResults);
        }
        if (!this.model) {
            return this.keywordBasedRetrieval(query, documents, maxResults);
        }
        try {
            const rankedIds = await this.aiBasedRetrieval(query, documents, maxResults);
            return rankedIds;
        }
        catch (error) {
            this.logger.error(`AI-based retrieval failed: ${error.message}`, error.stack);
            return this.keywordBasedRetrieval(query, documents, maxResults);
        }
    }
    async aiBasedRetrieval(query, documents, maxResults) {
        if (!this.model) {
            throw new Error('Gemini model not initialized');
        }
        const docsContext = documents
            .map((doc, idx) => {
            const title = doc.title || doc.code || doc.originalName;
            const summary = doc.aiSummary || 'Sin resumen';
            const tags = doc.aiTags.length > 0 ? doc.aiTags.join(', ') : 'sin tags';
            return `[${idx}] ${title}\nTags: ${tags}\nResumen: ${summary}`;
        })
            .join('\n\n');
        const prompt = `Eres un experto en búsqueda de documentos técnicos. Dada una pregunta del usuario y una lista de documentos con sus resúmenes y tags, identifica los ${maxResults} documentos MÁS RELEVANTES que podrían contener la respuesta.

Responde SOLO con los índices de los documentos ordenados por relevancia (del más al menos relevante), separados por comas. Ejemplo: 0,2,5

Si ningún documento parece relevante, responde con los primeros ${maxResults} documentos en orden: 0,1,2

Pregunta: ${query}

Documentos disponibles:
${docsContext}`;
        let aiResponse;
        try {
            const result = await (0, vertex_retry_1.withVertexRetry)(() => this.model.generateContent(prompt), {
                operationName: 'SmartDocumentRetrieverService.aiBasedRetrieval',
                onRetry: ({ attempt, nextAttempt, maxAttempts, delayMs, statusCode, errorMessage }) => {
                    this.logger.warn(`[SmartRetriever] Vertex retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                        `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`);
                },
            });
            aiResponse = await result.response;
            this.logVertexResponse('smart-retrieval', aiResponse);
        }
        catch (error) {
            this.logVertexError('smart-retrieval', error);
            throw error;
        }
        const response = aiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const indices = response
            .trim()
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n) && n >= 0 && n < documents.length);
        if (indices.length === 0) {
            this.logger.warn('AI returned no valid indices, using first documents');
            return documents.slice(0, maxResults).map((d) => d.id);
        }
        return indices.slice(0, maxResults).map((i) => documents[i].id);
    }
    keywordBasedRetrieval(query, documents, maxResults) {
        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);
        const scored = documents.map((doc) => {
            let score = 0;
            const searchText = [
                doc.title || '',
                doc.code || '',
                doc.originalName || '',
                doc.aiSummary || '',
                ...doc.aiTags,
            ]
                .join(' ')
                .toLowerCase();
            for (const word of queryWords) {
                if (searchText.includes(word)) {
                    score += 1;
                }
            }
            for (const tag of doc.aiTags) {
                if (queryLower.includes(tag.toLowerCase())) {
                    score += 2;
                }
            }
            return { id: doc.id, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return Promise.resolve(scored.slice(0, maxResults).map((s) => s.id));
    }
    logVertexResponse(context, response) {
        const preview = this.extractVertexPreview(response);
        this.logger.log(`[SmartRetriever] Vertex response type (${context}): ${typeof response}`);
        if (preview) {
            this.logger.log(`[SmartRetriever] Vertex response preview (${context}): ${preview}`);
            if (preview.includes('<!DOCTYPE') || preview.includes('<html')) {
                this.logger.error(`[SmartRetriever] CRITICAL: Vertex AI returned HTML in ${context} response. This usually means a region mismatch or API limit.`);
            }
        }
    }
    logVertexError(context, error) {
        const message = typeof error?.message === 'string' ? error.message : String(error ?? '');
        if (message.includes('<!DOCTYPE') || message.includes('<html')) {
            this.logger.error(`[SmartRetriever] CRITICAL: Vertex AI returned HTML in ${context} error. This usually means a region mismatch or API limit.`);
        }
    }
    extractVertexPreview(response) {
        if (!response)
            return '';
        if (typeof response === 'string')
            return response.slice(0, 160);
        const parts = response?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts))
            return '';
        const text = parts
            .map((part) => part?.text)
            .filter(Boolean)
            .join(' ')
            .trim();
        return text ? text.slice(0, 160) : '';
    }
    async getDocumentContext(documentIds) {
        const docs = await this.prisma.documentFile.findMany({
            where: { id: { in: documentIds } },
            select: {
                id: true,
                originalName: true,
                title: true,
                aiSummary: true,
                aiTags: true,
            },
        });
        return docs.map((doc) => ({
            id: doc.id,
            name: doc.title || doc.originalName,
            summary: doc.aiSummary || 'Sin resumen disponible',
            tags: doc.aiTags,
        }));
    }
};
exports.SmartDocumentRetrieverService = SmartDocumentRetrieverService;
exports.SmartDocumentRetrieverService = SmartDocumentRetrieverService = SmartDocumentRetrieverService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SmartDocumentRetrieverService);
//# sourceMappingURL=smart-document-retriever.service.js.map