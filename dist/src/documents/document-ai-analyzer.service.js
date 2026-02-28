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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentAiAnalyzerService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const vertexai_1 = require("@google-cloud/vertexai");
const mammoth_1 = __importDefault(require("mammoth"));
const vector_store_service_1 = require("../ai/vector-store.service");
const pdf_1 = require("../common/utils/pdf");
const docling_parser_service_1 = require("./docling-parser.service");
const vertex_retry_1 = require("../common/vertex-retry");
const DOCUMENT_METADATA_MODEL_ID = process.env.DOCUMENT_AI_MODEL_ID || 'gemini-2.5-flash';
const DOCLING_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/tiff',
    'image/bmp',
]);
let DocumentAiAnalyzerService = DocumentAiAnalyzerService_1 = class DocumentAiAnalyzerService {
    prisma;
    vectorStore;
    doclingParser;
    logger = new common_1.Logger(DocumentAiAnalyzerService_1.name);
    vertexAI;
    model;
    constructor(prisma, vectorStore, doclingParser) {
        this.prisma = prisma;
        this.vectorStore = vectorStore;
        this.doclingParser = doclingParser;
        const projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
        const location = process.env.VERTEX_LOCATION || 'us-central1';
        const apiKey = process.env.VERTEX_API_KEY ||
            process.env['VERTEX-AI-API-KEY'];
        if (!projectId) {
            this.logger.warn('VERTEX_PROJECT_ID (or FIREBASE_PROJECT_ID) not found. AI document analysis will be disabled.');
            this.vertexAI = null;
            this.model = null;
        }
        else {
            const clientOptions = {
                project: projectId,
                location
            };
            if (apiKey) {
                clientOptions.googleAuthOptions = { apiKey };
            }
            this.vertexAI = new vertexai_1.VertexAI(clientOptions);
            this.model = this.vertexAI.preview.getGenerativeModel({
                model: DOCUMENT_METADATA_MODEL_ID,
            });
        }
    }
    async resolveBucketName(organizationId) {
        const defaultBucket = process.env.GCS_STORAGE_BUCKET || 'mia-docs-prod';
        if (!organizationId)
            return defaultBucket;
        try {
            const org = await this.prisma.organization.findUnique({
                where: { id: organizationId },
                select: { name: true },
            });
            if (!org)
                return defaultBucket;
            return `mia-docs-${org.name}`;
        }
        catch {
            return defaultBucket;
        }
    }
    async extractText(buffer, mimeType, gcsBucket, storageKey) {
        const normalizedMimeType = String(mimeType || '').toLowerCase().trim();
        try {
            if (normalizedMimeType === 'application/pdf' || normalizedMimeType.includes('pdf')) {
                if (this.doclingParser.isEnabled && gcsBucket && storageKey) {
                    try {
                        return await this.doclingParser.parseGcsDocument(gcsBucket, storageKey);
                    }
                    catch (error) {
                        this.logger.warn(`[Docling] Parse failed, falling back to pdf-parse: ${error?.message}`);
                    }
                }
                return await (0, pdf_1.extractPdfText)(buffer);
            }
            if (this.isSupportedDoclingImageMimeType(normalizedMimeType)) {
                if (!this.doclingParser.isEnabled || !gcsBucket || !storageKey) {
                    const missingConfigError = new Error(`Docling image parsing requires DOCLING_SERVICE_URL and GCS context (bucket/key). mime=${normalizedMimeType}`);
                    missingConfigError.doclingImageRetryable = true;
                    throw missingConfigError;
                }
                this.logger.log(`[Docling] Requesting parse for image: gs://${gcsBucket}/${storageKey}`);
                try {
                    const markdown = await this.doclingParser.parseGcsDocument(gcsBucket, storageKey);
                    this.logger.log(`[Docling] Image parse success: ${storageKey} (${markdown.length} chars)`);
                    return markdown;
                }
                catch (error) {
                    this.logger.warn(`[Docling] Image parse failure -> retry: ${error?.message || error}`);
                    const retryableError = new Error(`Docling image parse failed for ${storageKey}: ${error?.message || error}`);
                    retryableError.doclingImageRetryable = true;
                    throw retryableError;
                }
            }
            if (normalizedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                normalizedMimeType.includes('word')) {
                const result = await mammoth_1.default.extractRawText({ buffer });
                return result.value;
            }
            if (normalizedMimeType.startsWith('text/')) {
                return buffer.toString('utf-8');
            }
            this.logger.warn(`Unsupported MIME type for text extraction: ${mimeType}`);
            return '';
        }
        catch (error) {
            if (error?.doclingImageRetryable) {
                throw error;
            }
            this.logger.error(`Failed to extract text: ${error.message}`, error.stack);
            return '';
        }
    }
    isSupportedDoclingImageMimeType(mimeType) {
        if (!mimeType.startsWith('image/'))
            return false;
        return DOCLING_IMAGE_MIME_TYPES.has(mimeType);
    }
    cleanSingleLine(value, max = 260) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max);
    }
    normalizeStringArray(value, maxItems = 10, maxItemLength = 180) {
        if (!Array.isArray(value))
            return [];
        const normalized = value
            .map((item) => this.cleanSingleLine(String(item || ''), maxItemLength))
            .filter((item) => item.length > 0);
        return Array.from(new Set(normalized)).slice(0, maxItems);
    }
    extractJsonObject(raw) {
        const text = String(raw || '').trim();
        if (!text)
            return {};
        const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
        if (fenced?.[1]) {
            try {
                return JSON.parse(fenced[1]);
            }
            catch {
            }
        }
        try {
            return JSON.parse(text);
        }
        catch {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try {
                    return JSON.parse(text.slice(start, end + 1));
                }
                catch {
                    return {};
                }
            }
            return {};
        }
    }
    inferDocTypeBySignals(params) {
        const fromModel = this.cleanSingleLine(String(params.suggestedType || '').toLowerCase(), 80);
        const title = this.cleanSingleLine(`${params.title || ''} ${params.filename || ''}`.toLowerCase(), 220);
        const textPreview = this.cleanSingleLine(String(params.sourceText || '').toLowerCase(), 600);
        const signal = [fromModel, title, textPreview].join(' ');
        if (signal.includes('manual'))
            return 'manual';
        if (signal.includes('procedimiento') || signal.includes('procedure')) {
            return 'procedure';
        }
        if (signal.includes('seguridad') ||
            signal.includes('safety') ||
            signal.includes('loto') ||
            signal.includes('bloqueo')) {
            return 'safety';
        }
        if (signal.includes('troubleshoot') ||
            signal.includes('diagnost') ||
            signal.includes('falla')) {
            return 'troubleshooting';
        }
        if (signal.includes('checklist') || signal.includes('lista de verificación')) {
            return 'checklist';
        }
        if (signal.includes('especificación') ||
            signal.includes('specification') ||
            signal.includes('datasheet')) {
            return 'specification';
        }
        if (signal.includes('instrucción') || signal.includes('instruction')) {
            return 'instruction';
        }
        if (signal.includes('evidencia') || signal.includes('evidence')) {
            return 'evidence';
        }
        if (signal.includes('reporte') || signal.includes('report')) {
            return 'report';
        }
        if (params.category === 'MACHINE')
            return 'manual';
        if (params.category === 'PROCEDURE')
            return 'procedure';
        if (params.category === 'WORK_INSTRUCTION')
            return 'instruction';
        if (params.category === 'WORK_ORDER_EVIDENCE')
            return 'evidence';
        if (params.category === 'PRODUCTION_REPORT')
            return 'report';
        if (params.category === 'CERTIFICATION')
            return 'certification';
        return 'other';
    }
    extractSafetyInstructionsFromText(text, max = 8) {
        if (!text || text.trim().length === 0)
            return [];
        const compact = text
            .replace(/\r/g, '\n')
            .split(/\n+/)
            .map((line) => this.cleanSingleLine(line, 220))
            .filter((line) => line.length >= 15);
        const safetyKeywords = [
            'seguridad',
            'riesgo',
            'advertencia',
            'peligro',
            'precauc',
            'bloqueo',
            'etiquetado',
            'loto',
            'paro de emergencia',
            'energía residual',
            'fuerza atrapada',
            'fuerzas atrapadas',
            'epp',
            'aislar',
            'desenerg',
        ];
        const selected = compact.filter((line) => safetyKeywords.some((keyword) => line.toLowerCase().includes(keyword)));
        return Array.from(new Set(selected)).slice(0, max);
    }
    buildFallbackMetadata(params) {
        const compactText = this.cleanSingleLine(params.text, 900);
        const summary = compactText ||
            `Documento ${params.title || params.filename} cargado para referencia técnica.`;
        const docType = this.inferDocTypeBySignals({
            category: params.category,
            filename: params.filename,
            title: params.title,
            sourceText: params.text,
        });
        const resume = this.cleanSingleLine(summary, 220);
        const extractedSafety = this.extractSafetyInstructionsFromText(params.text);
        const baseTags = [
            docType,
            params.category?.toLowerCase() || 'documento',
            ...(params.title ? [this.cleanSingleLine(params.title.toLowerCase(), 40)] : []),
            ...(params.filename
                ? [this.cleanSingleLine(params.filename.toLowerCase().replace(/\.[a-z0-9]+$/, ''), 40)]
                : []),
            ...(extractedSafety.length > 0 ? ['seguridad'] : []),
        ]
            .map((tag) => this.cleanSingleLine(tag, 40))
            .filter((tag) => tag.length > 0);
        return {
            summary: this.cleanSingleLine(summary, 500),
            resume,
            tags: Array.from(new Set(baseTags)).slice(0, 10),
            docType,
            safetyInstructions: extractedSafety,
            equipmentModels: [],
            partNumbers: [],
            vendors: [],
            maintenanceIntervals: [],
            technicalSpecs: [],
            procedureNames: [],
        };
    }
    async generateMetadata(params) {
        if (!this.model) {
            this.logger.warn('Skipping AI analysis - no model configured, using fallback metadata');
            return this.buildFallbackMetadata(params);
        }
        const truncatedText = params.text.substring(0, 9000);
        try {
            const prompt = `Eres un experto en documentación técnica industrial.
Analiza el documento y responde SOLO JSON válido con esta estructura:
{
  "summary": "resumen ejecutivo claro en 2-4 oraciones",
  "resume": "resumen ultra corto para búsqueda rápida (máx 220 caracteres)",
  "docType": "manual|procedure|instruction|safety|troubleshooting|checklist|specification|report|evidence|certification|other",
  "tags": ["tag1", "tag2", "tag3"],
  "safetyInstructions": ["instrucción concreta de seguridad"],
  "equipmentModels": ["Marca Modelo Serie", "otro modelo"],
  "partNumbers": ["Número-de-parte-exacto", "otro-numero"],
  "vendors": ["Nombre Proveedor", "otro proveedor"],
  "maintenanceIntervals": ["Descripción del intervalo ej: Cambio aceite cada 2000h"],
  "technicalSpecs": ["Paramétro: valor unidad ej: Torque máx: 45 N\u00b7m", "Presión: 6 bar"],
  "procedureNames": ["Nombre del procedimiento ej: Cambio de banda de transmisión"]
}

Reglas:
- tags: útiles para búsqueda semántica de fallas industriales.
- safetyInstructions: solo instrucciones explícitas o altamente inferibles. Si no hay, devuelve [].
- equipmentModels: modelos, marcas y series mencionados explícitamente (ej: "SEW Eurodrive SA47", "Siemens S7-1200").
- partNumbers: números de parte, códigos de refacción o referencias exactas (ej: "6ES7 214-1AG40", "SKF 6205-2RS1").
- vendors: marcas/proveedores que se puedan identificar como fabricantes o distribuidores.
- maintenanceIntervals: cualquier frecuencia o plazo de mantenimiento mencionado (ej: "Cada 500 horas", "Anual").
- technicalSpecs: valores numéricos con unidades (voltaje, corriente, presión, torque, RPM, temperatura, tolerancias).
- procedureNames: nombres de procedimientos o instrucciones de trabajo identificados.
- Si algún campo no aplica o no se encuentra, devuelve [].
- docType debe ser uno de los valores permitidos.

Contexto del documento:
- Nombre archivo: ${params.filename}
- Título: ${params.title || 'N/A'}
- Categoría del sistema: ${params.category || 'N/A'}

Contenido:
${truncatedText}`;
            const result = await (0, vertex_retry_1.withVertexRetry)(() => this.model.generateContent(prompt), {
                operationName: 'Documents.DocumentAiAnalyzerService.generateMetadata',
                onRetry: ({ attempt, nextAttempt, maxAttempts, delayMs, statusCode, errorMessage }) => {
                    this.logger.warn(`[DocAI] Vertex retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                        `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`);
                },
            });
            const response = await result.response;
            this.logVertexResponse('document-metadata', response);
            const content = response.candidates?.[0]?.content?.parts
                ?.map((part) => part?.text || '')
                .join('\n')
                .trim() || '';
            const parsed = this.extractJsonObject(content);
            const fallback = this.buildFallbackMetadata(params);
            const summary = this.cleanSingleLine(String(parsed?.summary || fallback.summary), 500);
            const resume = this.cleanSingleLine(String(parsed?.resume || summary || fallback.resume), 220);
            const docType = this.inferDocTypeBySignals({
                category: params.category,
                filename: params.filename,
                title: params.title,
                suggestedType: String(parsed?.docType || ''),
                sourceText: params.text,
            });
            const tags = this.normalizeStringArray(parsed?.tags, 12, 60);
            const safetyFromModel = this.normalizeStringArray(parsed?.safetyInstructions, 10, 220);
            const safetyInstructions = safetyFromModel.length > 0
                ? safetyFromModel
                : this.extractSafetyInstructionsFromText(params.text, 8);
            const equipmentModels = this.normalizeStringArray(parsed?.equipmentModels, 20, 120);
            const partNumbers = this.normalizeStringArray(parsed?.partNumbers, 30, 80);
            const vendors = this.normalizeStringArray(parsed?.vendors, 15, 80);
            const maintenanceIntervals = this.normalizeStringArray(parsed?.maintenanceIntervals, 20, 200);
            const technicalSpecs = this.normalizeStringArray(parsed?.technicalSpecs, 30, 200);
            const procedureNames = this.normalizeStringArray(parsed?.procedureNames, 20, 150);
            return {
                summary: summary || fallback.summary,
                resume: resume || fallback.resume,
                tags: tags.length > 0 ? tags : fallback.tags,
                docType,
                safetyInstructions,
                equipmentModels,
                partNumbers,
                vendors,
                maintenanceIntervals,
                technicalSpecs,
                procedureNames,
            };
        }
        catch (error) {
            this.logVertexError('document-metadata', error);
            this.logger.error(`AI metadata generation failed: ${error?.message || error}`, error?.stack);
            const fallback = this.buildFallbackMetadata(params);
            return {
                ...fallback,
                equipmentModels: [],
                partNumbers: [],
                vendors: [],
                maintenanceIntervals: [],
                technicalSpecs: [],
                procedureNames: [],
            };
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
    async analyzeDocument(documentId, buffer, organizationId) {
        try {
            await this.prisma.documentFile.update({
                where: { id: documentId },
                data: { aiProcessingStatus: 'processing' },
            });
            const doc = await this.prisma.documentFile.findUnique({
                where: { id: documentId },
                select: {
                    originalName: true,
                    mimeType: true,
                    category: true,
                    title: true,
                    storageKey: true,
                },
            });
            if (!doc) {
                throw new Error(`Document ${documentId} not found`);
            }
            this.logger.log(`Analyzing document: ${doc.originalName}`);
            const bucketName = await this.resolveBucketName(organizationId);
            const text = await this.extractText(buffer, doc.mimeType, bucketName, doc.storageKey);
            if (!text || text.trim().length === 0) {
                this.logger.warn(`No text extracted from ${doc.originalName}`);
                const fallback = this.buildFallbackMetadata({
                    text: '',
                    filename: doc.originalName,
                    category: doc.category,
                    title: doc.title,
                });
                await this.prisma.documentFile.update({
                    where: { id: documentId },
                    data: {
                        aiProcessingStatus: 'completed',
                        aiProcessedAt: new Date(),
                        embeddingStatus: 'completed',
                        embeddingProcessedAt: new Date(),
                        aiSummary: 'No se pudo extraer texto de este documento.',
                        aiResume: fallback.resume,
                        aiDocType: fallback.docType,
                        aiSafetyInstructions: [],
                        aiTags: ['sin-contenido', fallback.docType],
                    },
                });
                return;
            }
            const { summary, resume, tags, docType, safetyInstructions, equipmentModels, partNumbers, vendors, maintenanceIntervals, technicalSpecs, procedureNames, } = await this.generateMetadata({
                text,
                filename: doc.originalName,
                category: doc.category,
                title: doc.title,
            });
            const summaryForIndex = resume || summary;
            if (summaryForIndex) {
                try {
                    await this.vectorStore.indexDocumentSummary(documentId, summaryForIndex);
                }
                catch (err) {
                    this.logger.warn(`Summary indexing failed for ${documentId}: ${err?.message || err}`);
                }
            }
            await this.vectorStore.indexDocument(documentId, text);
            await this.prisma.documentFile.update({
                where: { id: documentId },
                data: {
                    aiSummary: summary || 'Resumen no disponible',
                    aiResume: resume || summary || 'Resumen no disponible',
                    aiDocType: docType || 'other',
                    aiSafetyInstructions: safetyInstructions.length > 0 ? safetyInstructions : [],
                    aiTags: tags.length > 0 ? tags : ['documento', 'general'],
                    aiEquipmentModels: equipmentModels,
                    aiPartNumbers: partNumbers,
                    aiVendors: vendors,
                    aiMaintenanceIntervals: maintenanceIntervals,
                    aiTechnicalSpecs: technicalSpecs,
                    aiProcedureNames: procedureNames,
                    aiProcessedAt: new Date(),
                    aiProcessingStatus: 'completed',
                },
            });
            this.logger.log(`Successfully analyzed document: ${doc.originalName}`);
        }
        catch (error) {
            this.logger.error(`Failed to analyze document ${documentId}: ${error?.message || error}`, error?.stack);
            try {
                const existing = await this.prisma.documentFile.findUnique({
                    where: { id: documentId },
                    select: { embeddingStatus: true },
                });
                await this.prisma.documentFile.update({
                    where: { id: documentId },
                    data: {
                        aiProcessingStatus: 'failed',
                        ...(existing?.embeddingStatus === 'completed'
                            ? {}
                            : { embeddingStatus: 'failed' }),
                    },
                });
            }
            catch (statusError) {
                this.logger.error(`Failed to set failed statuses for ${documentId}: ${statusError?.message || statusError}`, statusError?.stack);
            }
            throw error;
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
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, typeof (_a = typeof vector_store_service_1.VectorStoreService !== "undefined" && vector_store_service_1.VectorStoreService) === "function" ? _a : Object, docling_parser_service_1.DoclingParserService])
], DocumentAiAnalyzerService);
//# sourceMappingURL=document-ai-analyzer.service.js.map