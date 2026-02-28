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
var DocumentAiAnalyzerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentAiAnalyzerService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const vertexai_1 = require("@google-cloud/vertexai");
const mammoth_1 = __importDefault(require("mammoth"));
const pdf_1 = require("../common/utils/pdf");
const vertex_retry_1 = require("../common/vertex-retry");
let DocumentAiAnalyzerService = DocumentAiAnalyzerService_1 = class DocumentAiAnalyzerService {
    prisma;
    logger = new common_1.Logger(DocumentAiAnalyzerService_1.name);
    vertexAI;
    model;
    constructor(prisma) {
        this.prisma = prisma;
        const projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
        const location = process.env.VERTEX_LOCATION || 'us-central1';
        if (!projectId) {
            this.logger.warn('VERTEX_PROJECT_ID (or FIREBASE_PROJECT_ID) not found. AI document analysis will be disabled.');
            this.vertexAI = null;
            this.model = null;
        }
        else {
            this.vertexAI = new vertexai_1.VertexAI({ project: projectId, location });
            this.model = this.vertexAI.preview.getGenerativeModel({ model: 'gemini-2.5-flash' });
        }
    }
    async extractText(buffer, mimeType) {
        try {
            if (mimeType === 'application/pdf' || mimeType.includes('pdf')) {
                return await (0, pdf_1.extractPdfText)(buffer);
            }
            if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                mimeType.includes('word')) {
                const result = await mammoth_1.default.extractRawText({ buffer });
                return result.value;
            }
            if (mimeType.startsWith('text/')) {
                return buffer.toString('utf-8');
            }
            this.logger.warn(`Unsupported MIME type for text extraction: ${mimeType}`);
            return '';
        }
        catch (error) {
            this.logger.error(`Failed to extract text: ${error.message}`, error.stack);
            return '';
        }
    }
    async generateMetadata(text, filename) {
        if (!this.model) {
            this.logger.warn('Skipping AI analysis - no API key configured');
            return { summary: '', tags: [] };
        }
        const truncatedText = text.substring(0, 8000);
        try {
            const prompt = `Eres un experto en análisis de documentos técnicos e industriales.

Analiza el contenido del documento y genera:
1. Un resumen ejecutivo conciso (máximo 3-4 oraciones) que capture los puntos clave
2. Una lista de 5-10 tags/palabras clave relevantes para búsqueda

Responde SOLO en formato JSON con esta estructura exacta:
{
  "summary": "resumen del documento...",
  "tags": ["tag1", "tag2", "tag3"]
}

Documento: ${filename}

Contenido:
${truncatedText}`;
            const result = await (0, vertex_retry_1.withVertexRetry)(() => this.model.generateContent(prompt), {
                operationName: 'DocumentAiAnalyzerService.generateMetadata',
                onRetry: ({ attempt, nextAttempt, maxAttempts, delayMs, statusCode, errorMessage }) => {
                    this.logger.warn(`[DocAI] Vertex retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                        `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`);
                },
            });
            const response = await result.response;
            this.logVertexResponse('document-metadata', response);
            const content = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No valid JSON found in response');
            }
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                summary: parsed.summary || '',
                tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            };
        }
        catch (error) {
            this.logVertexError('document-metadata', error);
            this.logger.error(`AI metadata generation failed: ${error.message}`, error.stack);
            return { summary: '', tags: [] };
        }
    }
    logVertexResponse(context, response) {
        const preview = this.extractVertexPreview(response);
        this.logger.log(`[DocAI] Vertex response type (${context}): ${typeof response}`);
        if (preview) {
            this.logger.log(`[DocAI] Vertex response preview (${context}): ${preview}`);
            if (preview.includes('<!DOCTYPE') || preview.includes('<html')) {
                this.logger.error(`[DocAI] CRITICAL: Vertex AI returned HTML in ${context} response. This usually means a region mismatch or API limit.`);
            }
        }
    }
    logVertexError(context, error) {
        const message = typeof error?.message === 'string' ? error.message : String(error ?? '');
        if (message.includes('<!DOCTYPE') || message.includes('<html')) {
            this.logger.error(`[DocAI] CRITICAL: Vertex AI returned HTML in ${context} error. This usually means a region mismatch or API limit.`);
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
    async analyzeDocument(documentId, buffer) {
        try {
            await this.prisma.documentFile.update({
                where: { id: documentId },
                data: { aiProcessingStatus: 'processing' },
            });
            const doc = await this.prisma.documentFile.findUnique({
                where: { id: documentId },
                select: { originalName: true, mimeType: true },
            });
            if (!doc) {
                throw new Error(`Document ${documentId} not found`);
            }
            this.logger.log(`Analyzing document: ${doc.originalName}`);
            const text = await this.extractText(buffer, doc.mimeType);
            if (!text || text.trim().length === 0) {
                this.logger.warn(`No text extracted from ${doc.originalName}`);
                await this.prisma.documentFile.update({
                    where: { id: documentId },
                    data: {
                        aiProcessingStatus: 'completed',
                        aiProcessedAt: new Date(),
                        aiSummary: 'No se pudo extraer texto de este documento.',
                        aiTags: ['sin-contenido'],
                    },
                });
                return;
            }
            const { summary, tags } = await this.generateMetadata(text, doc.originalName);
            await this.prisma.documentFile.update({
                where: { id: documentId },
                data: {
                    aiSummary: summary || 'Resumen no disponible',
                    aiTags: tags.length > 0 ? tags : ['documento', 'general'],
                    aiProcessedAt: new Date(),
                    aiProcessingStatus: 'completed',
                },
            });
            this.logger.log(`Successfully analyzed document: ${doc.originalName}`);
        }
        catch (error) {
            this.logger.error(`Failed to analyze document ${documentId}: ${error.message}`, error.stack);
            await this.prisma.documentFile.update({
                where: { id: documentId },
                data: { aiProcessingStatus: 'failed' },
            });
        }
    }
    async processPendingDocuments() {
        const pending = await this.prisma.documentFile.findMany({
            where: {
                OR: [
                    { aiProcessingStatus: null },
                    { aiProcessingStatus: 'pending' },
                    { aiProcessingStatus: 'failed' },
                ],
                ragEnabled: true,
            },
            take: 10,
        });
        this.logger.log(`Found ${pending.length} documents pending AI analysis`);
        for (const doc of pending) {
            this.logger.log(`Queued for processing: ${doc.originalName}`);
        }
    }
};
exports.DocumentAiAnalyzerService = DocumentAiAnalyzerService;
exports.DocumentAiAnalyzerService = DocumentAiAnalyzerService = DocumentAiAnalyzerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DocumentAiAnalyzerService);
//# sourceMappingURL=document-ai-analyzer.service.js.map