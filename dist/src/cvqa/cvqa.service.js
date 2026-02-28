"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const vertexai_1 = require("@google-cloud/vertexai");
const XLSX = __importStar(require("xlsx"));
const mammoth_1 = __importDefault(require("mammoth"));
const documents_service_1 = require("../documents/documents.service");
const document_indexing_service_1 = require("../documents/document-indexing.service");
const ai_usage_service_1 = require("./ai-usage.service");
const history_service_1 = require("../history/history.service");
const approvals_service_1 = require("../approvals/approvals.service");
const prisma_service_1 = require("../prisma/prisma.service");
const vector_store_service_1 = require("./vector-store.service");
const pdf_1 = require("../common/utils/pdf");
const vertex_location_1 = require("../common/vertex-location");
const vertex_retry_1 = require("../common/vertex-retry");
const cache_service_1 = require("../common/cache.service");
const MODEL_ID = process.env.AI_MODEL_ID || process.env.VERTEX_MODEL_ID || 'gemini-2.5-flash';
const MAX_DOCS = 7;
const MAX_WORK_ORDER_DOCS = 4;
const TECHNICIAN_CHAT_SLIDING_WINDOW_EXCHANGES = Math.max(1, Number(process.env.TECHNICIAN_CHAT_SLIDING_WINDOW_EXCHANGES || 5));
const TECHNICIAN_RRF_K = Math.max(10, Number(process.env.TECHNICIAN_RRF_K || 60));
const MAX_WORK_INSTRUCTION_REFERENCE_LINES = Math.max(2, Number(process.env.AI_WO_MAX_WORK_INSTRUCTION_REFERENCES || 4));
const MAX_SIMILAR_WORK_ORDER_REFERENCE_LINES = Math.max(2, Number(process.env.AI_WO_MAX_SIMILAR_WORK_ORDER_REFERENCES || 4));
const MAX_RELATED_DOCUMENT_REFERENCE_LINES = Math.max(3, Number(process.env.AI_WO_MAX_RELATED_DOCUMENT_REFERENCES || 6));
const MAX_REFERENCE_DICTIONARY_DOC_LINES = Math.max(3, Number(process.env.AI_WO_MAX_REFERENCE_DICTIONARY_DOCS || 6));
const MAX_REFERENCE_LINE_CHARS = Math.max(80, Number(process.env.AI_WO_REFERENCE_LINE_MAX_CHARS || 180));
const TECHNICIAN_CACHE_EXPANSION_COOLDOWN_MS = Math.max(15_000, Number(process.env.TECHNICIAN_CACHE_EXPANSION_COOLDOWN_MS || 45_000));
const TECHNICAL_JARGON_EXPANSIONS = {
    hvac: ['climatizacion', 'aire', 'acondicionado', 'ventilacion'],
    plc: ['controlador', 'logico', 'programable', 'control'],
    hmi: ['interfaz', 'operador', 'panel'],
    vfd: ['variador', 'frecuencia', 'inverter'],
    rpm: ['velocidad', 'rotacion'],
    psi: ['presion'],
    loto: ['lockout', 'tagout', 'bloqueo', 'etiquetado', 'energia', 'cero'],
};
class LruCache {
    maxEntries;
    map = new Map();
    constructor(maxEntries) {
        this.maxEntries = maxEntries;
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
        if (this.map.has(key)) {
            this.map.delete(key);
        }
        this.map.set(key, value);
        if (this.map.size > this.maxEntries) {
            const firstKey = this.map.keys().next().value;
            this.map.delete(firstKey);
        }
    }
}
let AiService = class AiService {
    documentsService;
    documentIndexing;
    aiUsageService;
    vectorStore;
    historyService;
    approvalsService;
    prisma;
    cacheService;
    vertexAI = null;
    model = null;
    answerCache = new LruCache(500);
    answerCacheTtlSeconds = Math.max(Number(process.env.AI_CONSULT_CACHE_TTL_SECONDS || 1800), 60);
    referenceEmbeddingCache = new LruCache(5000);
    referenceContextCache = new LruCache(1000);
    warnedMissingWorkOrderReferenceFields = false;
    warnedMissingWorkInstructionDocumentLinks = false;
    constructor(documentsService, documentIndexing, aiUsageService, vectorStore, historyService, approvalsService, prisma, cacheService) {
        this.documentsService = documentsService;
        this.documentIndexing = documentIndexing;
        this.aiUsageService = aiUsageService;
        this.vectorStore = vectorStore;
        this.historyService = historyService;
        this.approvalsService = approvalsService;
        this.prisma = prisma;
        this.cacheService = cacheService;
        const projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
        const locationResolution = (0, vertex_location_1.resolveVertexLocation)([
            'VERTEX_AI_LOCATION',
            'VERTEX_LOCATION',
        ]);
        const location = locationResolution.location;
        if (!projectId) {
            console.warn('VERTEX_PROJECT_ID (or FIREBASE_PROJECT_ID) not found. AI features will be disabled.');
        }
        else {
            if (locationResolution.configuredLocationUnsupported) {
                const configuredFrom = locationResolution.configuredEnv || 'VERTEX_LOCATION';
                console.warn(`[AI] ${configuredFrom}="${locationResolution.configuredLocation}" is not supported for these Vertex AI model calls. Using "${locationResolution.location}".`);
            }
            this.vertexAI = new vertexai_1.VertexAI({ project: projectId, location });
            this.model = this.vertexAI.preview.getGenerativeModel({
                model: MODEL_ID,
                systemInstruction: {
                    role: 'system',
                    parts: [{
                            text: `Eres un experto asistente de documentación industrial y técnica. Tu objetivo es ayudar a los usuarios a comprender, analizar y extraer información de documentos corporativos, procedimientos, manuales y certificaciones.

CAPACIDADES Y TIPOS DE CONSULTA:

1. **RESÚMENES**: Proporciona resúmenes concisos y precisos de documentos, destacando:
   - Objetivo y alcance del documento
   - Puntos clave y conclusiones principales
   - Información crítica o de cumplimiento

2. **EXPLICACIONES**: Explica conceptos, procedimientos o requisitos en lenguaje claro:
   - Interpreta lenguaje técnico o normativo
   - Desglosa procesos complejos paso a paso
   - Aclara términos específicos del documento

3. **EXTRACCIÓN DE INFORMACIÓN**: Encuentra datos específicos como:
   - Responsables, fechas, versiones
   - Especificaciones técnicas o parámetros
   - Referencias a normas o documentos relacionados
   - Requisitos de cumplimiento

4. **ANÁLISIS COMPARATIVO**: Compara información entre documentos cuando se proporcionen múltiples:
   - Identifica diferencias y similitudes
   - Señala actualizaciones entre versiones
   - Detecta inconsistencias

5. **SOPORTE TÉCNICO**: Resuelve problemas operativos usando los manuales:
   - Diagnóstico de fallas
   - Procedimientos de mantenimiento
   - Solución de problemas (troubleshooting)

DIRECTRICES GENERALES:

✅ **CITAS OBLIGATORIAS**: Cada afirmación debe incluir su fuente: [Nombre Doc, pág X] o [Nombre Doc, sección Y]
✅ **ANÁLISIS PROFUNDO**: Busca información relacionada si la respuesta exacta no está explícita
✅ **ACTITUD RESOLUTIVA**: Si no hay respuesta directa, proporciona la información más relevante disponible
✅ **CLARIDAD**: Usa lenguaje claro y organiza respuestas de forma estructurada
✅ **CONTEXTO**: Considera el tipo de consulta y adapta el formato de respuesta

FORMATOS DE RESPUESTA ADAPTABLES:

Para **RESÚMENES**:
📄 Resumen del Documento:
• Objetivo: [...]
• Alcance: [...]
• Puntos Clave:
  - [Punto 1] (Fuente: Doc, pág X)
  - [Punto 2] (Fuente: Doc, pág X)
• Conclusión: [...]

Para **EXPLICACIONES**:
💡 Explicación:
[Concepto o proceso explicado en términos claros]
(Fuente: Doc, pág X)

Para **PROBLEMAS TÉCNICOS**:
🔍 Análisis Técnico:
[Diagnóstico de los posibles problemas]

✅ Solución / Procedimiento:
1. [Paso 1] (Fuente: Doc, pág X)
2. [Paso 2] (Fuente: Doc, pág X)

⚠️ Precauciones:
[Advertencias de seguridad del manual]

Para **INFORMACIÓN ESPECÍFICA**:
🔎 Información Encontrada:
• [Dato solicitado]: [Valor] (Fuente: Doc, pág X)
• [Contexto adicional si es relevante]

Si NO HAY información relacionada, sé honesto pero ofrece alternativas:
"No encontré información específica sobre [tema]. Sin embargo, los documentos contienen información relacionada sobre [tema relacionado] que podría ser útil..."`
                        }]
                }
            });
        }
    }
    async generateContentWithRetry(request) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        return (0, vertex_retry_1.withVertexRetry)(() => this.model.generateContent(request), {
            operationName: 'AiService.generateContent',
            onRetry: ({ attempt, nextAttempt, maxAttempts, delayMs, statusCode, errorMessage, }) => {
                console.warn(`[AI] Vertex retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                    `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`);
            },
        });
    }
    async sendChatMessageWithRetry(chat, parts) {
        return (0, vertex_retry_1.withVertexRetry)(() => chat.sendMessage(parts), {
            operationName: 'AiService.chat.sendMessage',
            onRetry: ({ attempt, nextAttempt, maxAttempts, delayMs, statusCode, errorMessage, }) => {
                console.warn(`[AI] Vertex chat retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                    `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`);
            },
        });
    }
    async generateWorkOrderSummary(rawText) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        try {
            const prompt = `Analiza la siguiente información extraída de una Orden de Trabajo industrial y genera un resumen conciso y estructurado. Este resumen se usará para búsqueda en base de datos vectorial (embeddings).
      
      DEBES INCLUIR, SI EXISTEN:
      1. Síntomas reportados
      2. Máquina o componente afectado
      3. Diagnóstico o Causa Raíz
      4. Acciones correctivas tomadas (Resolución)
      5. Piezas cambiadas o herramientas usadas

      Mantén el formato de texto plano y describe los problemas como un técnico industrial para maximizar la similitud vectorial con futuros reportes similares. Resumen consolidado:
      
      Datos crudos de la Orden de Trabajo:
      ${rawText}
      `;
            const result = await this.generateContentWithRetry({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            const response = await result.response;
            return response.candidates?.[0]?.content?.parts?.[0]?.text || rawText.slice(0, 1000);
        }
        catch (error) {
            console.error('[AI] Failed to generate work order summary with Gemini', error);
            return rawText.slice(0, 1000);
        }
    }
    async consult(query, documentIds, contextLabel, history = [], user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const uniqueIds = Array.from(new Set(documentIds)).slice(0, MAX_DOCS);
        const docRecords = await this.documentsService.findByIds(uniqueIds, organizationId);
        const validIds = docRecords
            .filter(doc => doc.ragEnabled)
            .map(doc => doc.id);
        if (validIds.length === 0) {
            throw new common_1.BadRequestException('No se encontraron documentos válidos con RAG habilitado.');
        }
        const embeddingStatuses = await Promise.all(validIds.map(async (id) => ({
            id,
            status: await this.vectorStore.getEmbeddingStatus(id),
        })));
        const readyIds = embeddingStatuses
            .filter((d) => d.status === 'completed')
            .map((d) => d.id);
        const notReadyIds = embeddingStatuses
            .filter((d) => d.status !== 'completed')
            .map((d) => d.id);
        if (notReadyIds.length > 0) {
            await Promise.allSettled(notReadyIds.map((id) => this.documentIndexing.requestDocumentIndexing(id, organizationId)));
        }
        const documentsToUse = validIds;
        const allowDirectFallbackOverride = process.env.AI_CONSULT_ALLOW_DIRECT_FALLBACK;
        const allowDirectFallback = allowDirectFallbackOverride != null
            ? ['true', '1', 'yes', 'on'].includes(allowDirectFallbackOverride.toLowerCase().trim())
            : documentsToUse.length <= 2;
        let retrievedChunks = [];
        if (readyIds.length > 0) {
            retrievedChunks = await this.vectorStore.search(query, readyIds, 8, organizationId);
        }
        const useDirectFallback = !retrievedChunks.length && allowDirectFallback;
        const directDocs = useDirectFallback
            ? await Promise.all(documentsToUse.slice(0, 2).map((id) => this.loadDocument(id, user)))
            : [];
        const fallbackNotice = directDocs.length > 0
            ? notReadyIds.length > 0
                ? 'algunos documentos siguen indexándose; usando contenido completo temporalmente'
                : 'sin coincidencias vectoriales directas; usando contenido completo del documento'
            : notReadyIds.length > 0
                ? 'algunos documentos siguen indexándose; se priorizó contexto vectorial disponible'
                : null;
        const cacheKey = this.buildAnswerCacheKey(query, documentsToUse, retrievedChunks.map((c) => c.id), contextLabel, [
            ...directDocs.map((doc) => doc.id),
        ]);
        const cached = this.answerCache.get(cacheKey);
        if (cached) {
            return { answer: cached.answer, notice: fallbackNotice };
        }
        const distributedCacheKey = `ai:consult:${cacheKey}`;
        const distributedCached = await this.cacheService.getJson(distributedCacheKey);
        if (distributedCached?.answer) {
            this.answerCache.set(cacheKey, distributedCached);
            return { answer: distributedCached.answer, notice: fallbackNotice };
        }
        const historyParts = history.map(h => ({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.content }]
        }));
        const currentParts = [];
        if (contextLabel) {
            currentParts.push({ text: `Contexto seleccionado: ${contextLabel}.` });
        }
        for (const chunk of retrievedChunks) {
            const title = chunk.title || chunk.originalName || 'Documento';
            currentParts.push({
                text: `Fuente: ${title} (fragmento ${chunk.chunkIndex + 1})\n${chunk.text}`,
            });
        }
        for (const doc of directDocs) {
            currentParts.push({ text: `Documento completo: ${doc.title}` });
            currentParts.push(doc.part);
        }
        currentParts.push({ text: `Pregunta: ${query}` });
        try {
            const chat = this.model.startChat({
                history: historyParts,
            });
            const result = await this.sendChatMessageWithRetry(chat, currentParts);
            const response = await result.response;
            this.logVertexResponse('consult', response);
            const answer = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            this.answerCache.set(cacheKey, { answer, tokens });
            this.cacheService
                .setJson(distributedCacheKey, { answer, tokens }, this.answerCacheTtlSeconds)
                .catch((error) => {
                console.warn(`[AI] Failed to write distributed consult cache: ${error?.message || error}`);
            });
            const uniqueChunkDocs = Array.from(new Map(retrievedChunks.map((chunk) => [
                chunk.documentId,
                {
                    id: chunk.documentId,
                    title: chunk.title || chunk.originalName || 'Documento',
                },
            ])).values());
            const uniqueDirectDocs = Array.from(new Map(directDocs.map((doc) => [
                doc.id,
                { id: doc.id, title: doc.title || 'Documento' },
            ])).values());
            const allDocsForHistory = uniqueDirectDocs.length > 0
                ? uniqueDirectDocs
                : uniqueChunkDocs;
            try {
                const title = query.length > 80 ? `${query.slice(0, 80)}…` : query;
                const hierarchy = contextLabel ? `IA / ${contextLabel}` : 'IA / Consultas';
                const details = {
                    query,
                    answerPreview: answer.slice(0, 400),
                    tokens,
                    documents: allDocsForHistory,
                    contextLabel,
                    model: MODEL_ID,
                    mode: directDocs.length
                        ? 'direct'
                        : retrievedChunks.length > 0
                            ? 'vector'
                            : 'none',
                };
                await this.historyService.create({
                    eventType: 'Consulta IA',
                    title,
                    user: user?.email || user?.sub || 'Usuario',
                    timestamp: new Date().toISOString(),
                    criticality: 'info',
                    details,
                    hierarchy,
                });
            }
            catch (err) {
                console.warn('[AI] Failed to log history event', err?.message || err);
            }
            return {
                answer,
                sources: retrievedChunks,
                notice: fallbackNotice,
                mode: directDocs.length
                    ? 'direct'
                    : retrievedChunks.length > 0
                        ? 'vector'
                        : 'none',
            };
        }
        catch (error) {
            this.logVertexError('consult', error);
            console.error('[AI] Vertex AI request failed:', error);
            throw new common_1.InternalServerErrorException(`AI request failed: ${error?.message || error}`);
        }
    }
    async loadDocument(id, user) {
        console.log(`[AI] Loading document: ${id}`);
        const { file, stream } = await this.documentsService.getStream(id, user);
        console.log(`[AI] Document metadata: ${file.originalName}, mime: ${file.mimeType}, ragEnabled: ${file.ragEnabled}`);
        const buffer = await this.streamToBuffer(stream);
        console.log(`[AI] Stream converted to buffer: ${buffer.length} bytes`);
        const title = file.title || file.originalName || file.code || 'Documento';
        const part = await this.extractContentPart(file.mimeType, file.originalName, buffer);
        return { id, title, part };
    }
    async extractContentPart(mimeType, originalName, buffer) {
        const nameLower = originalName.toLowerCase();
        const normalized = mimeType.toLowerCase();
        if (normalized === 'application/pdf' || nameLower.endsWith('.pdf')) {
            console.log(`[AI] Extracting text from PDF: ${originalName}`);
            try {
                const text = this.trimText(await (0, pdf_1.extractPdfText)(buffer));
                return { text: text || ' ' };
            }
            catch (err) {
                console.error(`[AI] PDF extraction failed for ${originalName}`, err);
                return { text: ' ' };
            }
        }
        let text = '';
        try {
            if (normalized === 'text/csv' ||
                nameLower.endsWith('.csv') ||
                normalized === 'application/vnd.ms-excel') {
                console.log(`[AI] Extracting CSV text from: ${originalName}`);
                text = this.trimText(buffer.toString('utf8'));
            }
            else if (normalized ===
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                nameLower.endsWith('.docx') ||
                normalized.includes('wordprocessingml')) {
                console.log(`[AI] Extracting Word text from: ${originalName}`);
                const result = await mammoth_1.default.extractRawText({ buffer });
                text = this.trimText(result.value || '');
            }
            else if (normalized ===
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                nameLower.endsWith('.xlsx')) {
                console.log(`[AI] Extracting Excel text from: ${originalName}`);
                const workbook = XLSX.read(buffer, { type: 'buffer' });
                const sheetTexts = workbook.SheetNames.map((sheetName) => {
                    const sheetText = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
                    return `<<SHEET ${sheetName}>>\n${sheetText}`;
                }).join('\n');
                text = this.trimText(sheetTexts);
            }
            else if (normalized.startsWith('text/')) {
                console.log(`[AI] Extracting text from: ${originalName}`);
                text = this.trimText(buffer.toString('utf8'));
            }
            else {
                console.warn(`[AI] Unsupported type ${mimeType}, treating as empty text.`);
                text = '';
            }
        }
        catch (e) {
            console.error(`[AI] Text extraction failed for ${originalName}`, e);
            text = '';
        }
        return { text: text || ' ' };
    }
    extractTextFromPart(part) {
        const partText = part?.text;
        return typeof partText === 'string' ? partText : '';
    }
    buildComparisonSnippet(text, maxChars = 12000) {
        const normalized = this.trimText(text || '');
        if (!normalized)
            return '';
        return normalized.slice(0, maxChars);
    }
    parseScore(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed))
            return null;
        return Math.max(0, Math.min(100, Math.round(parsed)));
    }
    calculateLexicalSimilarity(previousText, currentText) {
        const prevTokens = this.tokenizeForSimilarity(previousText);
        const currTokens = this.tokenizeForSimilarity(currentText);
        if (!prevTokens.size || !currTokens.size)
            return null;
        let intersection = 0;
        for (const token of prevTokens) {
            if (currTokens.has(token))
                intersection += 1;
        }
        const union = prevTokens.size + currTokens.size - intersection;
        if (union <= 0)
            return null;
        return intersection / union;
    }
    tokenizeForSimilarity(text) {
        if (!text)
            return new Set();
        const normalized = text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ');
        const tokens = normalized
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 3)
            .slice(0, 5000);
        return new Set(tokens);
    }
    trimText(text) {
        return text.replace(/\s+/g, ' ').trim().slice(0, 300000);
    }
    buildAnswerCacheKey(query, documentIds, chunkIds, contextLabel, directDocIds = []) {
        const docsKey = [...documentIds].sort().join('|');
        const chunksKey = [...chunkIds].sort().join('|');
        const directKey = directDocIds.length
            ? `|direct:${[...directDocIds].sort().join('|')}`
            : '';
        return `${MODEL_ID}|${contextLabel || ''}|${query}|${docsKey}|${chunksKey}${directKey}`;
    }
    logVertexResponse(context, response) {
        const preview = this.extractVertexPreview(response);
        console.log(`[AI] Vertex response type (${context}):`, typeof response);
        if (preview) {
            console.log(`[AI] Vertex response preview (${context}):`, preview);
            if (preview.includes('<!DOCTYPE') || preview.includes('<html')) {
                console.error(`[AI] CRITICAL: Vertex AI returned HTML in ${context} response. This usually means a region mismatch or API limit.`);
            }
        }
    }
    logVertexError(context, error) {
        const message = typeof error?.message === 'string' ? error.message : String(error ?? '');
        if (message.includes('<!DOCTYPE') || message.includes('<html')) {
            console.error(`[AI] CRITICAL: Vertex AI returned HTML in ${context} error. This usually means a region mismatch or API limit.`);
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
    streamToBuffer(stream) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
    }
    normalizeSearchText(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    tokenizeSearchText(value) {
        return this.normalizeSearchText(value)
            .split(' ')
            .map((word) => word.trim())
            .filter((word) => word.length >= 3)
            .slice(0, 50);
    }
    expandSearchTextWithJargon(value) {
        const normalized = this.normalizeSearchText(value);
        if (!normalized)
            return normalized;
        const tokens = normalized.split(' ').filter(Boolean);
        const expanded = new Set(tokens);
        for (const token of tokens) {
            if (!Object.prototype.hasOwnProperty.call(TECHNICAL_JARGON_EXPANSIONS, token)) {
                continue;
            }
            const synonyms = TECHNICAL_JARGON_EXPANSIONS[token];
            if (!Array.isArray(synonyms) || synonyms.length === 0)
                continue;
            for (const synonym of synonyms) {
                if (typeof synonym !== 'string')
                    continue;
                const normalizedSynonym = this.normalizeSearchText(synonym);
                if (!normalizedSynonym)
                    continue;
                expanded.add(normalizedSynonym);
            }
        }
        return Array.from(expanded).join(' ');
    }
    buildTokenSet(value) {
        const expanded = this.expandSearchTextWithJargon(value);
        return new Set(this.tokenizeSearchText(expanded));
    }
    classifyTechnicianQuery(query, context) {
        const normalized = this.normalizeSearchText(query);
        if (!normalized)
            return 'diagnostic';
        if (/\b(seguridad|safety|loto|lockout|tagout|bloqueo|etiquetado|riesgo|epp|permiso)\b/.test(normalized)) {
            return 'safety_question';
        }
        if (/\b(refaccion|refacciones|pieza|piezas|spare|part|parts|part number|numero de parte|proveedor|vendor|reemplazo|cambiar)\b/.test(normalized)) {
            return 'parts_check';
        }
        if (/\b(procedimiento|paso|steps|step by step|instruccion|instruction|como hago|how to|ejecutar|validar)\b/.test(normalized)) {
            return 'procedure_request';
        }
        if (/\b(aclara|aclarar|explica|explicame|explain|why|por que|porque|confirmar|duda|clarifica)\b/.test(normalized)) {
            return 'clarification';
        }
        if (context?.workflowStage === 'output' &&
            /\b(resultado|output|salida|medicion|valor|lectura)\b/.test(normalized)) {
            return 'clarification';
        }
        if (this.normalizeSearchText(context?.safetyRisk || '').includes('alto') &&
            /\b(paro|falla|riesgo)\b/.test(normalized)) {
            return 'safety_question';
        }
        return 'diagnostic';
    }
    summarizeConversationContext(history = []) {
        if (!Array.isArray(history) || history.length === 0)
            return null;
        const maxWindowMessages = TECHNICIAN_CHAT_SLIDING_WINDOW_EXCHANGES * 2;
        const older = history.slice(0, Math.max(0, history.length - maxWindowMessages));
        if (!older.length)
            return null;
        const priorityPattern = /\b(resultado|medicion|lectura|causa|diagnostico|solucion|procedimiento|refaccion|riesgo|seguridad|loto|presion|volt|amp|torque|temperatura)\b/i;
        const candidateLines = older
            .map((item) => String(item?.content || '').trim())
            .filter((text) => text.length > 0)
            .slice(-18);
        const focused = candidateLines.filter((line) => priorityPattern.test(line));
        const selected = (focused.length > 0 ? focused : candidateLines)
            .slice(-6)
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter((line) => line.length > 0)
            .map((line) => (line.length > 180 ? `${line.slice(0, 177)}...` : line));
        if (!selected.length)
            return null;
        return selected.map((line, idx) => `${idx + 1}. ${line}`).join('\n');
    }
    buildStructuredSignalTokens(payload) {
        const formData = payload.formData || {};
        return this.buildTokenSet([
            payload.machineModel || '',
            payload.machineName || '',
            payload.machineManufacturer || '',
            ...(formData.symptoms || []),
            formData.failureDescription || '',
        ]
            .filter(Boolean)
            .join(' '));
    }
    fuseRrfScores(candidates, keyResolver, scoreResolvers) {
        const fused = new Map();
        for (const resolver of scoreResolvers) {
            const ranked = candidates
                .map((candidate) => ({
                key: keyResolver(candidate),
                score: resolver(candidate),
            }))
                .filter((item) => item.key && Number.isFinite(item.score) && item.score > 0)
                .sort((a, b) => b.score - a.score);
            ranked.forEach((item, index) => {
                const rank = index + 1;
                const boost = 1 / (TECHNICIAN_RRF_K + rank);
                fused.set(item.key, (fused.get(item.key) || 0) + boost);
            });
        }
        return fused;
    }
    scoreTokenOverlap(queryTokens, candidateTokens) {
        if (queryTokens.size === 0 || candidateTokens.size === 0) {
            return { score: 0, matches: [] };
        }
        let matchCount = 0;
        const matches = [];
        queryTokens.forEach((token) => {
            if (!candidateTokens.has(token))
                return;
            matchCount += 1;
            if (matches.length < 6)
                matches.push(token);
        });
        const score = matchCount / Math.sqrt(candidateTokens.size);
        return { score, matches };
    }
    buildReferenceContextCacheKey(payload, queryText, organizationId, intent = 'diagnostic') {
        const querySignature = this.normalizeSearchText(queryText).slice(0, 600);
        const historySignature = (payload.troubleshootingHistory || [])
            .slice(-4)
            .map((entry) => [
            String(entry?.stepNumber ?? ''),
            String(entry?.title || ''),
            String(entry?.operatorInputText || ''),
        ].join('|'))
            .join('||');
        return [
            organizationId || 'default',
            payload.workOrderId || '',
            payload.machineId || '',
            payload.plantId || '',
            payload.processId || '',
            payload.subprocessId || '',
            (payload.machineDocumentIds || []).slice().sort().join(','),
            querySignature,
            historySignature,
            intent,
        ].join('::');
    }
    isMissingWorkOrderContextCacheTable(error) {
        if (!error)
            return false;
        const code = typeof error?.code === 'string' ? error.code.toUpperCase() : '';
        const message = typeof error?.message === 'string' ? error.message : String(error ?? '');
        if (code === 'P2021' && message.includes('WorkOrderContextCache')) {
            return true;
        }
        return (message.includes('WorkOrderContextCache') &&
            /does not exist|doesn't exist|not exist/i.test(message));
    }
    async safeFindWorkOrderContextCache(workOrderId) {
        try {
            return await this.prisma.workOrderContextCache.findUnique({
                where: { workOrderId },
            });
        }
        catch (error) {
            if (this.isMissingWorkOrderContextCacheTable(error)) {
                console.warn('[AI] WorkOrderContextCache table missing; continuing without technician context cache.');
                return null;
            }
            throw error;
        }
    }
    async safeUpdateWorkOrderContextCache(workOrderId, data) {
        try {
            await this.prisma.workOrderContextCache.update({
                where: { workOrderId },
                data,
            });
        }
        catch (error) {
            if (this.isMissingWorkOrderContextCacheTable(error)) {
                console.warn(`[AI] Skipping WorkOrderContextCache update for ${workOrderId}; table missing.`);
                return;
            }
            throw error;
        }
    }
    async safeUpsertWorkOrderContextCache(args) {
        try {
            await this.prisma.workOrderContextCache.upsert(args);
        }
        catch (error) {
            if (this.isMissingWorkOrderContextCacheTable(error)) {
                const workOrderId = String(args?.where?.workOrderId || 'N/A');
                console.warn(`[AI] Skipping WorkOrderContextCache upsert for ${workOrderId}; table missing.`);
                return;
            }
            throw error;
        }
    }
    buildReferenceEmbeddingText(value, maxChars = 2400) {
        const normalized = this.trimText(String(value || ''));
        if (!normalized)
            return '';
        return normalized.slice(0, maxChars);
    }
    cosineSimilarity(a, b) {
        if (!a.length || !b.length)
            return 0;
        const minLen = Math.min(a.length, b.length);
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < minLen; i += 1) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        if (!denominator)
            return 0;
        return dot / denominator;
    }
    async embedReferenceQuery(queryText, organizationId) {
        if (!queryText.trim().length)
            return [];
        try {
            const [embedding] = await this.vectorStore.embedTexts([queryText], {
                taskType: 'RETRIEVAL_QUERY',
                organizationId,
            });
            return embedding || [];
        }
        catch (error) {
            console.warn(`[AI] Query embedding failed for reference retrieval: ${error?.message || error}`);
            return [];
        }
    }
    async embedReferenceCandidates(candidates, organizationId) {
        const result = new Map();
        const missing = [];
        for (const candidate of candidates) {
            const cached = this.referenceEmbeddingCache.get(candidate.cacheKey);
            if (cached?.length) {
                result.set(candidate.cacheKey, cached);
                continue;
            }
            if (!candidate.text.length)
                continue;
            missing.push(candidate);
        }
        if (missing.length === 0)
            return result;
        try {
            const embedded = await this.vectorStore.embedTexts(missing.map((item) => item.text), {
                taskType: 'RETRIEVAL_DOCUMENT',
                organizationId,
            });
            missing.forEach((item, index) => {
                const vector = embedded[index] || [];
                if (!vector.length)
                    return;
                this.referenceEmbeddingCache.set(item.cacheKey, vector);
                result.set(item.cacheKey, vector);
            });
        }
        catch (error) {
            console.warn(`[AI] Candidate embedding failed for reference retrieval: ${error?.message || error}`);
        }
        return result;
    }
    buildReferenceRelevance(matches, vectorSimilarity) {
        const parts = [];
        if (vectorSimilarity > 0) {
            parts.push(`Similitud vector: ${(vectorSimilarity * 100).toFixed(0)}%`);
        }
        if (matches.length > 0) {
            parts.push(`Coincide con: ${matches.slice(0, 4).join(', ')}`);
        }
        return parts.join(' · ') || 'Relacionada por contexto';
    }
    buildWorkOrderReferenceQuery(payload) {
        const formData = payload.formData || {};
        const historyText = (payload.troubleshootingHistory || [])
            .map((entry) => {
            const title = String(entry?.title || '').trim();
            const instruction = String(entry?.instruction || '').trim();
            const result = String(entry?.operatorInputText || '').trim();
            return [title, instruction, result].filter(Boolean).join(' ');
        })
            .filter((item) => item.length > 0)
            .join(' ');
        return [
            payload.machineName || '',
            payload.machineModel || '',
            payload.machineManufacturer || '',
            formData.failureDescription || '',
            ...(formData.symptoms || []),
            formData.alarmCodes || '',
            formData.alarmMessages || '',
            formData.currentStatus || '',
            formData.safetyRisk || '',
            ...(payload.possibleProblems || []),
            ...(payload.safetyInstructions || []),
            historyText,
        ]
            .filter(Boolean)
            .join(' ');
    }
    buildWorkInstructionSearchText(instruction) {
        const steps = Array.isArray(instruction.steps) ? instruction.steps : [];
        const stepText = steps
            .slice(0, 6)
            .map((step) => `${step?.title || ''} ${step?.description || ''}`.trim())
            .filter((item) => item.length > 0)
            .join(' ');
        return [
            instruction.title || '',
            instruction.objective || '',
            stepText,
            ...(instruction.tools || []),
            ...(instruction.supplies || []),
        ]
            .filter(Boolean)
            .join(' ');
    }
    buildWorkInstructionSummary(instruction) {
        const steps = Array.isArray(instruction.steps) ? instruction.steps : [];
        const stepTitles = steps
            .slice(0, 3)
            .map((step) => String(step?.title || '').trim())
            .filter((title) => title.length > 0);
        const tools = (instruction.tools || []).slice(0, 3);
        return [
            instruction.objective ? `Objetivo: ${instruction.objective}` : '',
            stepTitles.length > 0 ? `Pasos clave: ${stepTitles.join(' | ')}` : '',
            tools.length > 0 ? `Herramientas: ${tools.join(', ')}` : '',
        ]
            .filter((item) => item.length > 0)
            .join(' · ');
    }
    buildWorkOrderSearchText(order) {
        return [
            order.description || '',
            ...(order.symptoms || []),
            order.aiData?.classification || '',
            order.aiData?.operatorInstructions || '',
            ...(order.aiData?.referencedDocumentIds || []),
            ...(order.aiData?.referencedWorkInstructionIds || []),
            ...(order.aiData?.referencedWorkOrderIds || []),
            order.technicalReport?.diagnosis || '',
            order.technicalReport?.rootCause || '',
            ...(order.technicalReport?.actions || []),
        ]
            .filter(Boolean)
            .join(' ');
    }
    buildWorkOrderSummary(order) {
        const actions = (order.technicalReport?.actions || []).slice(0, 3);
        return [
            order.description ? `Falla: ${order.description}` : '',
            order.technicalReport?.diagnosis
                ? `Diagnostico: ${order.technicalReport.diagnosis}`
                : '',
            order.technicalReport?.rootCause
                ? `Causa raiz: ${order.technicalReport.rootCause}`
                : '',
            actions.length > 0 ? `Acciones: ${actions.join(', ')}` : '',
        ]
            .filter((item) => item.length > 0)
            .join(' | ');
    }
    truncateReferenceText(value, maxChars = MAX_REFERENCE_LINE_CHARS) {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
        if (!normalized)
            return '';
        if (normalized.length <= maxChars)
            return normalized;
        return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
    }
    formatWorkInstructionReferences(items) {
        if (!items.length)
            return 'N/A';
        const limited = items.slice(0, MAX_WORK_INSTRUCTION_REFERENCE_LINES);
        const lines = limited
            .map((item, index) => {
            const title = this.truncateReferenceText(item.title || '', 80);
            const extra = [
                this.truncateReferenceText(item.relevance || '', 90),
                this.truncateReferenceText(item.summary || '', 120),
            ]
                .filter((value) => value.length > 0)
                .join(' | ');
            return `${index + 1}. ${title || item.id}${extra ? ` (${extra})` : ''}`;
        })
            .join('\n');
        if (items.length <= limited.length)
            return lines;
        return `${lines}\n... (${items.length - limited.length} referencias adicionales omitidas)`;
    }
    formatWorkOrderReferences(items) {
        if (!items.length)
            return 'N/A';
        const limited = items.slice(0, MAX_SIMILAR_WORK_ORDER_REFERENCE_LINES);
        const lines = limited
            .map((item, index) => {
            const label = this.truncateReferenceText(item.otNumber || item.id, 50);
            const extra = [
                this.truncateReferenceText(item.relevance || '', 90),
                this.truncateReferenceText(item.summary || '', 120),
            ]
                .filter((value) => value.length > 0)
                .join(' | ');
            return `${index + 1}. ${label}${extra ? ` (${extra})` : ''}`;
        })
            .join('\n');
        if (items.length <= limited.length)
            return lines;
        return `${lines}\n... (${items.length - limited.length} OTs adicionales omitidas)`;
    }
    uniqueStrings(values) {
        const seen = new Set();
        const unique = [];
        for (const value of values) {
            const normalized = String(value || '').trim();
            if (!normalized || seen.has(normalized))
                continue;
            seen.add(normalized);
            unique.push(normalized);
        }
        return unique;
    }
    mergeManualSources(base = [], extra = [], max = 8) {
        const merged = [];
        const seen = new Set();
        for (const source of [...base, ...extra]) {
            const document = String(source?.document || '').trim();
            if (!document)
                continue;
            const key = document.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            merged.push({
                document,
                pages: String(source?.pages || '').trim() || 'N/D',
                url: source?.url,
            });
            if (merged.length >= max)
                break;
        }
        return merged;
    }
    mergeWorkInstructionRefs(base = [], extra = [], max = 6) {
        const merged = [];
        const seen = new Set();
        for (const item of [...base, ...extra]) {
            const id = String(item?.id || '').trim();
            const title = String(item?.title || '').trim();
            const key = id || title.toLowerCase();
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            merged.push({
                id: id || title,
                title: title || id,
                relevance: item?.relevance,
                summary: item?.summary,
                steps: item?.steps,
                expectedResult: item?.expectedResult,
            });
            if (merged.length >= max)
                break;
        }
        return merged;
    }
    mergeWorkOrderRefs(base = [], extra = [], max = 6) {
        const merged = [];
        const seen = new Set();
        for (const item of [...base, ...extra]) {
            const id = String(item?.id || '').trim();
            const label = String(item?.otNumber || '').trim();
            const key = id || label.toLowerCase();
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            const summary = String(item?.summary || '').trim() || 'Sin resumen disponible.';
            merged.push({
                id: id || label,
                otNumber: label || id,
                relevance: item?.relevance,
                summary,
            });
            if (merged.length >= max)
                break;
        }
        return merged;
    }
    buildManualInsightsFromDocuments(docs) {
        return docs
            .map((doc) => {
            const title = doc.title || doc.originalName || '';
            const summary = (doc.aiResume || doc.aiSummary || '').trim();
            if (!title || !summary)
                return '';
            return `${title}: ${summary}`;
        })
            .filter((item) => item.length > 0)
            .slice(0, 6);
    }
    extractDocumentIdFromEvidenceUrl(url) {
        const raw = String(url || '').trim();
        if (!raw)
            return null;
        const match = raw.match(/\/documents\/([^/?#]+)(?:\/download)?(?:[?#].*)?$/i);
        return match?.[1] ? decodeURIComponent(match[1]) : null;
    }
    extractEvidenceDocumentIds(evidenceFiles) {
        if (!Array.isArray(evidenceFiles) || evidenceFiles.length === 0)
            return [];
        return this.uniqueStrings(evidenceFiles
            .map((entry) => this.extractDocumentIdFromEvidenceUrl(entry))
            .filter((id) => Boolean(id)));
    }
    formatCrossReferencedDocuments(items) {
        if (!items.length)
            return 'N/A';
        const limited = items.slice(0, MAX_RELATED_DOCUMENT_REFERENCE_LINES);
        const lines = limited
            .map((item, index) => {
            const links = [];
            if (item.linkedToMachine)
                links.push('máquina');
            if (item.linkedWorkInstructionIds.length > 0) {
                links.push(`IT: ${item.linkedWorkInstructionIds.slice(0, 2).join(', ')}`);
            }
            if (item.linkedWorkOrderIds.length > 0) {
                links.push(`OT: ${item.linkedWorkOrderIds.slice(0, 2).join(', ')}`);
            }
            const extra = [
                this.truncateReferenceText(links.join(' | '), 80),
                this.truncateReferenceText(item.relevance || '', 90),
                this.truncateReferenceText(item.summary || '', 120),
            ]
                .filter((value) => value.length > 0)
                .join(' | ');
            const title = this.truncateReferenceText(item.title || item.id, 80);
            return `${index + 1}. ${title}${extra ? ` (${extra})` : ''}`;
        })
            .join('\n');
        if (items.length <= limited.length)
            return lines;
        return `${lines}\n... (${items.length - limited.length} documentos adicionales omitidos)`;
    }
    buildReferenceDictionaryText(workInstructions, similarWorkOrders, relatedDocuments) {
        if (!relatedDocuments.length)
            return 'N/A';
        const docById = new Map(relatedDocuments.map((item) => [item.id, item]));
        const limitedWorkInstructions = workInstructions.slice(0, MAX_WORK_INSTRUCTION_REFERENCE_LINES);
        const limitedWorkOrders = similarWorkOrders.slice(0, MAX_SIMILAR_WORK_ORDER_REFERENCE_LINES);
        const limitedRelatedDocs = relatedDocuments.slice(0, MAX_REFERENCE_DICTIONARY_DOC_LINES);
        const workInstructionLines = limitedWorkInstructions
            .map((instruction) => {
            const linkedDocs = limitedRelatedDocs
                .filter((doc) => doc.linkedWorkInstructionIds.includes(instruction.id))
                .map((doc) => this.truncateReferenceText(doc.title, 54))
                .slice(0, 4);
            if (!linkedDocs.length)
                return '';
            return `- ${this.truncateReferenceText(instruction.title, 54)}: ${linkedDocs.join(' | ')}`;
        })
            .filter((line) => line.length > 0);
        const workOrderLines = limitedWorkOrders
            .map((order) => {
            const linkedDocTitles = this.uniqueStrings((order.referencedDocumentIds || [])
                .map((docId) => docById.get(docId)?.title || '')
                .filter((title) => title.length > 0))
                .map((title) => this.truncateReferenceText(title, 54))
                .slice(0, 4);
            if (!linkedDocTitles.length)
                return '';
            return `- ${this.truncateReferenceText(order.otNumber, 44)}: ${linkedDocTitles.join(' | ')}`;
        })
            .filter((line) => line.length > 0);
        const compactDocList = limitedRelatedDocs
            .map((doc) => `- ${this.truncateReferenceText(doc.title, 64)}`)
            .join('\n');
        return [
            'Documentos clave:',
            compactDocList || '- N/A',
            'IT -> documentos:',
            workInstructionLines.join('\n') || '- N/A',
            'OT -> documentos:',
            workOrderLines.join('\n') || '- N/A',
        ].join('\n');
    }
    async resolveWorkInstructionLinkedDocuments(workInstructionIds) {
        const uniqueIds = this.uniqueStrings(workInstructionIds);
        if (!uniqueIds.length)
            return new Map();
        let links = [];
        try {
            links = await this.prisma.workInstructionDocument.findMany({
                where: { workInstructionId: { in: uniqueIds } },
                select: {
                    workInstructionId: true,
                    machineDocument: {
                        select: {
                            fileId: true,
                        },
                    },
                },
            });
        }
        catch (error) {
            if (!this.warnedMissingWorkInstructionDocumentLinks) {
                console.warn(`[AI] WorkInstructionDocument links unavailable, skipping linked-doc lookup: ${error?.message || error}`);
                this.warnedMissingWorkInstructionDocumentLinks = true;
            }
            return new Map();
        }
        const docMap = new Map();
        for (const id of uniqueIds)
            docMap.set(id, []);
        for (const link of links) {
            const fileId = String(link.machineDocument?.fileId || '').trim();
            if (!fileId)
                continue;
            const current = docMap.get(link.workInstructionId) || [];
            current.push(fileId);
            docMap.set(link.workInstructionId, current);
        }
        for (const [instructionId, docIds] of docMap.entries()) {
            docMap.set(instructionId, this.uniqueStrings(docIds));
        }
        return docMap;
    }
    async resolveCrossReferencedDocuments(payload, queryText, queryTokens, workInstructions, similarWorkOrders, organizationId, intent = 'diagnostic') {
        const machineDocIds = this.uniqueStrings(payload.machineDocumentIds || []);
        const instructionIds = this.uniqueStrings(workInstructions.map((item) => item.id));
        const referencedInstructionIdsFromOrders = this.uniqueStrings(similarWorkOrders.flatMap((item) => item.referencedWorkInstructionIds || []));
        const allInstructionIds = this.uniqueStrings([
            ...instructionIds,
            ...referencedInstructionIdsFromOrders,
        ]);
        const instructionDocMap = await this.resolveWorkInstructionLinkedDocuments(allInstructionIds);
        const workOrderDocMap = new Map();
        for (const order of similarWorkOrders) {
            const directDocIds = this.uniqueStrings(order.referencedDocumentIds || []);
            const viaInstructions = this.uniqueStrings((order.referencedWorkInstructionIds || []).flatMap((instructionId) => instructionDocMap.get(instructionId) || []));
            workOrderDocMap.set(order.id, this.uniqueStrings([...directDocIds, ...viaInstructions]));
        }
        const candidateDocIds = this.uniqueStrings([
            ...machineDocIds,
            ...Array.from(instructionDocMap.values()).flat(),
            ...Array.from(workOrderDocMap.values()).flat(),
        ]).slice(0, 120);
        if (!candidateDocIds.length)
            return [];
        const docs = await this.prisma.documentFile.findMany({
            where: { id: { in: candidateDocIds } },
            select: {
                id: true,
                title: true,
                originalName: true,
                aiSummary: true,
                aiResume: true,
                aiDocType: true,
                aiSafetyInstructions: true,
                aiTags: true,
                aiProcessingStatus: true,
            },
        });
        if (!docs.length)
            return [];
        const docToInstructionIds = new Map();
        for (const [instructionId, docIds] of instructionDocMap.entries()) {
            for (const docId of docIds) {
                if (!docToInstructionIds.has(docId))
                    docToInstructionIds.set(docId, new Set());
                docToInstructionIds.get(docId).add(instructionId);
            }
        }
        const docToWorkOrderIds = new Map();
        for (const [workOrderId, docIds] of workOrderDocMap.entries()) {
            for (const docId of docIds) {
                if (!docToWorkOrderIds.has(docId))
                    docToWorkOrderIds.set(docId, new Set());
                docToWorkOrderIds.get(docId).add(workOrderId);
            }
        }
        const machineDocSet = new Set(machineDocIds);
        const [queryEmbedding, candidateEmbeddings] = await Promise.all([
            this.embedReferenceQuery(queryText, organizationId),
            this.embedReferenceCandidates(docs.map((doc) => ({
                cacheKey: `doc-ref:${doc.id}:${doc.aiProcessingStatus || 'na'}`,
                text: this.buildReferenceEmbeddingText([
                    doc.title || '',
                    doc.originalName || '',
                    doc.aiResume || '',
                    doc.aiSummary || '',
                    doc.aiDocType || '',
                    ...(doc.aiTags || []),
                    ...(doc.aiSafetyInstructions || []),
                ].join(' ')),
            })), organizationId),
        ]);
        const workInstructionSet = new Set(instructionIds);
        const structuredTokens = this.buildStructuredSignalTokens(payload);
        const candidates = docs
            .map((doc) => {
            const searchText = [
                doc.title || '',
                doc.originalName || '',
                doc.aiResume || '',
                doc.aiSummary || '',
                doc.aiDocType || '',
                ...(doc.aiTags || []),
                ...(doc.aiSafetyInstructions || []),
            ].join(' ');
            const candidateTokens = this.buildTokenSet(searchText);
            const overlap = this.scoreTokenOverlap(queryTokens, candidateTokens);
            const structuredOverlap = this.scoreTokenOverlap(structuredTokens, candidateTokens);
            const candidateEmbedding = candidateEmbeddings.get(`doc-ref:${doc.id}:${doc.aiProcessingStatus || 'na'}`) || [];
            const vectorSimilarity = queryEmbedding.length && candidateEmbedding.length
                ? Math.max(0, this.cosineSimilarity(queryEmbedding, candidateEmbedding))
                : 0;
            const linkedInstructionIds = this.uniqueStrings(Array.from(docToInstructionIds.get(doc.id) || []));
            const linkedWorkOrderIds = this.uniqueStrings(Array.from(docToWorkOrderIds.get(doc.id) || []));
            const linkedToMachine = machineDocSet.has(doc.id);
            let sourceBoost = 0;
            if (linkedToMachine)
                sourceBoost += 2;
            const linkedTopInstructions = linkedInstructionIds.filter((id) => workInstructionSet.has(id));
            sourceBoost += Math.min(1.6, linkedTopInstructions.length * 0.6);
            sourceBoost += Math.min(1.4, linkedWorkOrderIds.length * 0.5);
            const normalizedDocType = this.normalizeSearchText(doc.aiDocType || '');
            const hasSafetyHints = normalizedDocType.includes('safety') ||
                normalizedDocType.includes('seguridad') ||
                (doc.aiSafetyInstructions || []).length > 0;
            const hasProcedureHints = normalizedDocType.includes('procedure') ||
                normalizedDocType.includes('instruction') ||
                normalizedDocType.includes('troubleshooting');
            const hasPartsHints = normalizedDocType.includes('parts') ||
                normalizedDocType.includes('refaccion') ||
                normalizedDocType.includes('spare') ||
                (doc.aiTags || []).some((tag) => /\b(part|pieza|refacci|spare|vendor|proveedor)\b/i.test(String(tag || '')));
            const intentBoost = intent === 'safety_question'
                ? hasSafetyHints
                    ? 3.4
                    : 0
                : intent === 'procedure_request'
                    ? hasProcedureHints
                        ? 2.4
                        : 0
                    : intent === 'parts_check'
                        ? hasPartsHints
                            ? 2.6
                            : 0
                        : intent === 'clarification'
                            ? 1.0
                            : 1.5;
            const keywordSignal = overlap.score;
            const structuredSignal = sourceBoost + structuredOverlap.score * 2 + intentBoost;
            if (keywordSignal <= 0 && vectorSimilarity <= 0 && structuredSignal <= 0) {
                return null;
            }
            const title = doc.title || doc.originalName || doc.id;
            const summary = (doc.aiResume || doc.aiSummary || 'Sin resumen IA').trim();
            const relevanceDetails = [];
            if (vectorSimilarity > 0) {
                relevanceDetails.push(`Similitud ${(vectorSimilarity * 100).toFixed(0)}%`);
            }
            if (overlap.matches.length > 0) {
                relevanceDetails.push(`Coincide con: ${overlap.matches.slice(0, 4).join(', ')}`);
            }
            if (linkedToMachine)
                relevanceDetails.push('Vinculado a máquina');
            if (linkedTopInstructions.length > 0)
                relevanceDetails.push('Vinculado a IT');
            if (linkedWorkOrderIds.length > 0)
                relevanceDetails.push('Referenciado por OT');
            if (intentBoost > 0)
                relevanceDetails.push(`Prioridad por intención: ${intent}`);
            if (structuredOverlap.matches.length > 0) {
                relevanceDetails.push(`Filtro estructura: ${structuredOverlap.matches.slice(0, 3).join(', ')}`);
            }
            return {
                id: doc.id,
                title,
                keywordSignal,
                vectorSignal: vectorSimilarity,
                structuredSignal,
                relevance: relevanceDetails.join(' · ') || 'Relacionada por contexto',
                summary,
                linkedToMachine,
                linkedWorkInstructionIds: linkedInstructionIds,
                linkedWorkOrderIds,
            };
        })
            .filter((item) => Boolean(item));
        const rrfScores = this.fuseRrfScores(candidates, (candidate) => candidate.id, [
            (candidate) => candidate.vectorSignal,
            (candidate) => candidate.keywordSignal,
            (candidate) => candidate.structuredSignal,
        ]);
        const scored = candidates
            .map((candidate) => ({
            ...candidate,
            fusedScore: rrfScores.get(candidate.id) || 0,
        }))
            .sort((a, b) => {
            if (b.fusedScore !== a.fusedScore)
                return b.fusedScore - a.fusedScore;
            return b.vectorSignal - a.vectorSignal;
        })
            .slice(0, 10)
            .map(({ keywordSignal, vectorSignal, structuredSignal, fusedScore, ...rest }) => rest);
        return scored;
    }
    async resolveWorkInstructionReferences(payload, queryText, queryTokens, organizationId, intent = 'diagnostic') {
        const locationWhere = {
            ...(payload.subprocessId ? { subprocessId: payload.subprocessId } : undefined),
            ...(payload.processId ? { processId: payload.processId } : undefined),
            ...(payload.plantId ? { plantId: payload.plantId } : undefined),
        };
        const organizationScopeWhere = organizationId
            ? {
                OR: [
                    { plant: { is: { organizationId } } },
                    { process: { is: { plant: { is: { organizationId } } } } },
                    { subprocess: { is: { process: { is: { plant: { is: { organizationId } } } } } } },
                    { machine: { is: { plant: { is: { organizationId } } } } },
                    { machine: { is: { process: { is: { plant: { is: { organizationId } } } } } } },
                    {
                        machine: {
                            is: {
                                subprocess: { is: { process: { is: { plant: { is: { organizationId } } } } } },
                            },
                        },
                    },
                ],
            }
            : undefined;
        const hasLocationScope = Boolean(payload.subprocessId || payload.processId || payload.plantId);
        const instructions = await this.prisma.workInstruction.findMany({
            where: {
                status: 'active',
                ...(organizationScopeWhere ? { AND: [organizationScopeWhere] } : undefined),
                ...(hasLocationScope ? locationWhere : undefined),
            },
            select: {
                id: true,
                title: true,
                objective: true,
                tools: true,
                supplies: true,
                steps: true,
                expectedResult: true,
                plantId: true,
                processId: true,
                subprocessId: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: hasLocationScope ? 48 : 24,
        });
        if (!instructions.length)
            return [];
        const structuredTokens = this.buildStructuredSignalTokens(payload);
        const candidates = instructions.map((instruction) => {
            const searchText = this.buildWorkInstructionSearchText(instruction);
            const candidateTokens = this.buildTokenSet(searchText);
            const overlap = this.scoreTokenOverlap(queryTokens, candidateTokens);
            const structuredOverlap = this.scoreTokenOverlap(structuredTokens, candidateTokens);
            const cacheKey = `wi:${instruction.id}:${instruction.updatedAt.toISOString()}`;
            const locationBoost = payload.subprocessId && instruction.subprocessId === payload.subprocessId
                ? 1.5
                : payload.processId && instruction.processId === payload.processId
                    ? 1
                    : payload.plantId && instruction.plantId === payload.plantId
                        ? 0.5
                        : 0;
            return {
                instruction,
                cacheKey,
                overlap,
                structuredOverlap,
                locationBoost,
                embeddingText: this.buildReferenceEmbeddingText(searchText),
            };
        });
        const [queryEmbedding, candidateEmbeddings] = await Promise.all([
            this.embedReferenceQuery(queryText, organizationId),
            this.embedReferenceCandidates(candidates.map((candidate) => ({
                cacheKey: candidate.cacheKey,
                text: candidate.embeddingText,
            })), organizationId),
        ]);
        const scored = candidates
            .map((candidate) => {
            const candidateEmbedding = candidateEmbeddings.get(candidate.cacheKey) || [];
            const vectorSimilarity = queryEmbedding.length && candidateEmbedding.length
                ? Math.max(0, this.cosineSimilarity(queryEmbedding, candidateEmbedding))
                : 0;
            const normalized = this.normalizeSearchText(`${candidate.instruction.title || ''} ${candidate.instruction.objective || ''}`);
            const hasProcedureHints = /\b(procedimiento|instruccion|paso|troubleshooting|diagnostico)\b/.test(normalized) || Array.isArray(candidate.instruction.steps);
            const hasSafetyHints = /\b(seguridad|loto|lockout|tagout|epp)\b/.test(normalized);
            const hasPartsHints = /\b(parte|pieza|refacci|spare|component|reemplazo)\b/.test(normalized);
            const intentBoost = intent === 'safety_question'
                ? hasSafetyHints
                    ? 2.8
                    : 0
                : intent === 'procedure_request'
                    ? hasProcedureHints
                        ? 2.6
                        : 0
                    : intent === 'parts_check'
                        ? hasPartsHints
                            ? 2.2
                            : 0
                        : intent === 'clarification'
                            ? 0.8
                            : 1.2;
            const keywordSignal = candidate.overlap.score;
            const structuredSignal = candidate.locationBoost + candidate.structuredOverlap.score * 2 + intentBoost;
            if (keywordSignal <= 0 && vectorSimilarity <= 0 && structuredSignal <= 0) {
                return null;
            }
            return {
                instruction: candidate.instruction,
                keywordSignal,
                vectorSignal: vectorSimilarity,
                structuredSignal,
                matches: candidate.overlap.matches,
                structuredMatches: candidate.structuredOverlap.matches,
                vectorSimilarity,
            };
        })
            .filter((item) => Boolean(item));
        const rrfScores = this.fuseRrfScores(scored, (item) => item.instruction.id, [
            (item) => item.vectorSignal,
            (item) => item.keywordSignal,
            (item) => item.structuredSignal,
        ]);
        const ranked = scored
            .map((item) => ({
            ...item,
            fusedScore: rrfScores.get(item.instruction.id) || 0,
        }))
            .sort((a, b) => {
            if (b.fusedScore !== a.fusedScore)
                return b.fusedScore - a.fusedScore;
            return b.vectorSignal - a.vectorSignal;
        })
            .slice(0, 4);
        return ranked.map((item) => ({
            id: item.instruction.id,
            title: item.instruction.title || item.instruction.id,
            relevance: this.buildReferenceRelevance([...item.matches, ...item.structuredMatches], item.vectorSimilarity),
            summary: this.buildWorkInstructionSummary(item.instruction),
            steps: item.instruction.steps,
            expectedResult: item.instruction.expectedResult,
        }));
    }
    async resolveSimilarWorkOrders(payload, queryText, queryTokens, organizationId, intent = 'diagnostic') {
        if (!queryText.trim())
            return [];
        let vectorResults = [];
        try {
            vectorResults = await this.vectorStore.searchWorkOrderSummaries(queryText, 8, organizationId);
        }
        catch (err) {
            console.warn(`[AI] Vector search for work orders failed: ${err?.message || err}`);
        }
        const vectorFiltered = payload.workOrderId
            ? vectorResults.filter((r) => r.workOrderId !== payload.workOrderId)
            : vectorResults;
        const keywordTokens = Array.from(queryTokens).slice(0, 6);
        const organizationScopeWhere = organizationId
            ? {
                OR: [
                    { plant: { is: { organizationId } } },
                    { process: { is: { plant: { is: { organizationId } } } } },
                    { subprocess: { is: { process: { is: { plant: { is: { organizationId } } } } } } },
                    { machine: { is: { plant: { is: { organizationId } } } } },
                    { machine: { is: { process: { is: { plant: { is: { organizationId } } } } } } },
                    {
                        machine: {
                            is: {
                                subprocess: { is: { process: { is: { plant: { is: { organizationId } } } } } },
                            },
                        },
                    },
                ],
            }
            : undefined;
        const keywordRows = keywordTokens.length > 0
            ? await this.prisma.workOrder.findMany({
                where: {
                    ...(organizationScopeWhere ? { AND: [organizationScopeWhere] } : undefined),
                    ...(payload.workOrderId
                        ? { id: { not: payload.workOrderId } }
                        : undefined),
                    OR: [
                        ...keywordTokens.map((token) => ({
                            description: { contains: token, mode: 'insensitive' },
                        })),
                        { symptoms: { hasSome: keywordTokens } },
                    ],
                },
                select: {
                    id: true,
                    otNumber: true,
                    description: true,
                    symptoms: true,
                    machineId: true,
                    plantId: true,
                    processId: true,
                    subprocessId: true,
                    safetyRisk: true,
                    aiData: {
                        select: {
                            referencedDocumentIds: true,
                            referencedWorkInstructionIds: true,
                        },
                    },
                },
                orderBy: { updatedAt: 'desc' },
                take: 16,
            })
            : [];
        const candidateMap = new Map();
        for (const row of keywordRows) {
            const searchText = [
                row.description || '',
                ...(row.symptoms || []),
            ].join(' ');
            const overlap = this.scoreTokenOverlap(queryTokens, this.buildTokenSet(searchText));
            let structuredSignal = 0;
            if (payload.machineId && row.machineId === payload.machineId)
                structuredSignal += 2.4;
            if (payload.subprocessId && row.subprocessId === payload.subprocessId)
                structuredSignal += 1.5;
            if (payload.processId && row.processId === payload.processId)
                structuredSignal += 1.0;
            if (payload.plantId && row.plantId === payload.plantId)
                structuredSignal += 0.6;
            const riskText = this.normalizeSearchText(row.safetyRisk || '');
            if (intent === 'safety_question' && (riskText.includes('alto') || riskText.includes('high'))) {
                structuredSignal += 2.2;
            }
            if (intent === 'parts_check' &&
                /\b(refacci|pieza|spare|part|reemplazo)\b/i.test(searchText)) {
                structuredSignal += 1.8;
            }
            candidateMap.set(row.id, {
                id: row.id,
                otNumber: row.otNumber || row.id,
                summary: row.description || 'Sin resumen detallado.',
                referencedDocumentIds: this.uniqueStrings(row.aiData?.referencedDocumentIds || []),
                referencedWorkInstructionIds: this.uniqueStrings(row.aiData?.referencedWorkInstructionIds || []),
                vectorSignal: 0,
                keywordSignal: overlap.score,
                structuredSignal,
            });
        }
        for (const vectorResult of vectorFiltered) {
            const existing = candidateMap.get(vectorResult.workOrderId);
            if (existing) {
                existing.vectorSignal = Math.max(existing.vectorSignal, vectorResult.similarity || 0);
                if (!existing.summary || existing.summary === 'Sin resumen detallado.') {
                    existing.summary = vectorResult.summary || existing.summary;
                }
                continue;
            }
            candidateMap.set(vectorResult.workOrderId, {
                id: vectorResult.workOrderId,
                otNumber: vectorResult.otNumber || vectorResult.workOrderId,
                summary: vectorResult.summary || 'Sin resumen detallado.',
                referencedDocumentIds: [],
                referencedWorkInstructionIds: [],
                vectorSignal: vectorResult.similarity || 0,
                keywordSignal: 0,
                structuredSignal: 0,
            });
        }
        const candidates = Array.from(candidateMap.values());
        if (!candidates.length)
            return [];
        const rrfScores = this.fuseRrfScores(candidates, (candidate) => candidate.id, [
            (candidate) => candidate.vectorSignal,
            (candidate) => candidate.keywordSignal,
            (candidate) => candidate.structuredSignal,
        ]);
        return candidates
            .map((candidate) => ({
            ...candidate,
            fusedScore: rrfScores.get(candidate.id) || 0,
        }))
            .filter((candidate) => candidate.fusedScore > 0)
            .sort((a, b) => {
            if (b.fusedScore !== a.fusedScore)
                return b.fusedScore - a.fusedScore;
            return b.vectorSignal - a.vectorSignal;
        })
            .slice(0, 4)
            .map((candidate) => ({
            id: candidate.id,
            otNumber: candidate.otNumber,
            relevance: `RRF ${(candidate.fusedScore * 1000).toFixed(1)} · similitud ${(candidate.vectorSignal * 100).toFixed(0)}%`,
            summary: candidate.summary || 'Sin resumen detallado.',
            referencedDocumentIds: candidate.referencedDocumentIds,
            referencedWorkInstructionIds: candidate.referencedWorkInstructionIds,
        }));
    }
    async resolveWorkOrderReferenceContext(payload, organizationId, intent = 'diagnostic', userQuery) {
        const queryText = [this.buildWorkOrderReferenceQuery(payload), userQuery || '']
            .filter((part) => String(part || '').trim().length > 0)
            .join(' ')
            .trim();
        const queryTokens = this.buildTokenSet(queryText);
        if (queryTokens.size === 0) {
            return {
                workInstructionsText: 'N/A',
                similarWorkOrdersText: 'N/A',
                relatedDocumentsText: 'N/A',
                referenceDictionaryText: 'N/A',
                relatedDocumentIds: [],
                workInstructions: [],
                similarWorkOrders: [],
                relatedDocuments: [],
            };
        }
        const cacheKey = this.buildReferenceContextCacheKey(payload, queryText, organizationId, intent);
        const cached = this.referenceContextCache.get(cacheKey);
        if (cached)
            return cached;
        const [workInstructions, similarWorkOrders] = await Promise.all([
            this.resolveWorkInstructionReferences(payload, queryText, queryTokens, organizationId, intent),
            this.resolveSimilarWorkOrders(payload, queryText, queryTokens, organizationId, intent),
        ]);
        const relatedDocuments = await this.resolveCrossReferencedDocuments(payload, queryText, queryTokens, workInstructions, similarWorkOrders, organizationId, intent);
        const context = {
            workInstructionsText: this.formatWorkInstructionReferences(workInstructions),
            similarWorkOrdersText: this.formatWorkOrderReferences(similarWorkOrders),
            relatedDocumentsText: this.formatCrossReferencedDocuments(relatedDocuments),
            referenceDictionaryText: this.buildReferenceDictionaryText(workInstructions, similarWorkOrders, relatedDocuments),
            relatedDocumentIds: relatedDocuments.map((item) => item.id),
            workInstructions,
            similarWorkOrders,
            relatedDocuments,
        };
        this.referenceContextCache.set(cacheKey, context);
        return context;
    }
    parseBooleanFlag(value) {
        const raw = String(value ?? '').trim().toLowerCase();
        if (!raw)
            return false;
        return (raw.includes('yes') ||
            raw.includes('si') ||
            raw.includes('sí') ||
            raw.includes('true') ||
            raw.includes('1'));
    }
    mergeReferenceRecords(existing = [], incoming = [], keyResolver, max = 12) {
        const merged = [];
        const seen = new Set();
        for (const item of [...existing, ...incoming]) {
            const key = keyResolver(item);
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            merged.push(item);
            if (merged.length >= max)
                break;
        }
        return merged;
    }
    async persistAutoReferenceSnapshot(payload, refs) {
        const workOrderId = String(payload.workOrderId || '').trim();
        if (!workOrderId)
            return;
        const workInstructions = refs.workInstructions || [];
        const similarWorkOrders = refs.similarWorkOrders || [];
        const relatedDocuments = refs.relatedDocuments || [];
        const selectedDocumentIds = refs.selectedDocumentIds || [];
        const referencedWorkInstructionIds = this.uniqueStrings(workInstructions.map((item) => item.id)).slice(0, 30);
        const referencedWorkOrderIds = this.uniqueStrings(similarWorkOrders
            .map((item) => item.id)
            .filter((id) => id && id !== workOrderId)).slice(0, 30);
        const referencedDocumentIds = this.uniqueStrings([
            ...relatedDocuments.map((item) => item.id),
            ...similarWorkOrders.flatMap((item) => item.referencedDocumentIds || []),
            ...(payload.machineDocumentIds || []),
            ...selectedDocumentIds,
        ]).slice(0, 40);
        if (referencedWorkInstructionIds.length === 0 &&
            referencedWorkOrderIds.length === 0 &&
            referencedDocumentIds.length === 0) {
            return;
        }
        try {
            const workOrder = await this.prisma.workOrder.findUnique({
                where: { id: workOrderId },
                select: {
                    id: true,
                    machineName: true,
                    machineStatus: true,
                    safetyRisk: true,
                    impactProduction: true,
                    impactQuality: true,
                    aiData: {
                        select: {
                            classification: true,
                            priority: true,
                            riskLevel: true,
                            productionImpact: true,
                            qualityImpact: true,
                            operatorInstructions: true,
                            rootCauses: true,
                            suggestedActions: true,
                            referencedWorkInstructionIds: true,
                            referencedDocumentIds: true,
                            referencedWorkOrderIds: true,
                            aiReferences: true,
                        },
                    },
                },
            });
            if (!workOrder)
                return;
            const existingAiData = workOrder.aiData;
            const mergedInstructionIds = this.uniqueStrings([
                ...(existingAiData?.referencedWorkInstructionIds || []),
                ...referencedWorkInstructionIds,
            ]).slice(0, 40);
            const mergedDocumentIds = this.uniqueStrings([
                ...(existingAiData?.referencedDocumentIds || []),
                ...referencedDocumentIds,
            ]).slice(0, 60);
            const mergedWorkOrderIds = this.uniqueStrings([
                ...(existingAiData?.referencedWorkOrderIds || []),
                ...referencedWorkOrderIds,
            ]).slice(0, 40);
            const existingReferences = existingAiData?.aiReferences &&
                typeof existingAiData.aiReferences === 'object' &&
                !Array.isArray(existingAiData.aiReferences)
                ? existingAiData.aiReferences
                : {};
            const relatedDocMap = new Map(relatedDocuments.map((item) => [item.id, item]));
            const incomingDocumentRefs = mergedDocumentIds.map((id) => {
                const related = relatedDocMap.get(id);
                return {
                    id,
                    title: related?.title || id,
                    type: related?.linkedToMachine ? 'machine_document' : 'related_document',
                    relevance: related?.relevance || 'Relacionado por contexto',
                    summary: related?.summary || '',
                };
            });
            const incomingWorkInstructionRefs = workInstructions.map((item) => ({
                id: item.id,
                title: item.title,
                relevance: item.relevance,
                summary: item.summary,
            }));
            const incomingWorkOrderRefs = similarWorkOrders.map((item) => ({
                id: item.id,
                otNumber: item.otNumber,
                relevance: item.relevance,
                summary: item.summary,
            }));
            const mergedWorkInstructionRefs = this.mergeReferenceRecords(Array.isArray(existingReferences.workInstructions)
                ? existingReferences.workInstructions
                : [], incomingWorkInstructionRefs, (item) => this.normalizeSearchText(String(item?.id || item?.title || '')), 15);
            const mergedDocumentRefs = this.mergeReferenceRecords(Array.isArray(existingReferences.documents)
                ? existingReferences.documents
                : [], incomingDocumentRefs, (item) => this.normalizeSearchText(String(item?.id || item?.title || '')), 20);
            const mergedWorkOrderRefs = this.mergeReferenceRecords(Array.isArray(existingReferences.workOrders)
                ? existingReferences.workOrders
                : [], incomingWorkOrderRefs, (item) => this.normalizeSearchText(String(item?.id || item?.otNumber || '')), 15);
            const referenceDictionary = this.buildReferenceDictionaryText(workInstructions, similarWorkOrders, relatedDocuments);
            const mergedAiReferences = {
                ...existingReferences,
                workInstructions: mergedWorkInstructionRefs,
                documents: mergedDocumentRefs,
                workOrders: mergedWorkOrderRefs,
                referenceDictionary: referenceDictionary !== 'N/A'
                    ? referenceDictionary
                    : existingReferences.referenceDictionary,
                autoPersistedAt: new Date().toISOString(),
            };
            const formData = payload.formData || {};
            const fallbackPriority = this.fallbackPriority(formData.currentStatus || workOrder.machineStatus || '', formData.safetyRisk || workOrder.safetyRisk || '');
            const fallbackRisk = this.fallbackRisk(formData.safetyRisk || workOrder.safetyRisk || '');
            const fallbackQualityImpact = this.parseBooleanFlag(formData.qualityImpact || workOrder.impactQuality || '');
            const existingRootCauses = Array.isArray(existingAiData?.rootCauses)
                ? existingAiData?.rootCauses
                : [];
            const existingSuggestedActions = Array.isArray(existingAiData?.suggestedActions)
                ? existingAiData?.suggestedActions
                : [];
            const upsertPayload = {
                classification: existingAiData?.classification ||
                    `Diagnóstico preliminar de ${payload.machineName || workOrder.machineName || 'equipo'}`,
                priority: existingAiData?.priority || fallbackPriority,
                riskLevel: existingAiData?.riskLevel || fallbackRisk,
                productionImpact: existingAiData?.productionImpact ||
                    formData.productionImpact ||
                    workOrder.impactProduction ||
                    'Sin impacto reportado',
                qualityImpact: typeof existingAiData?.qualityImpact === 'boolean'
                    ? existingAiData.qualityImpact
                    : fallbackQualityImpact,
                operatorInstructions: existingAiData?.operatorInstructions ||
                    'Referencias técnicas vinculadas automáticamente.',
                rootCauses: existingRootCauses.length > 0
                    ? existingRootCauses
                    : [{ cause: 'Análisis de referencia documental', probability: 'N/D' }],
                suggestedActions: existingSuggestedActions,
                referencedWorkInstructionIds: mergedInstructionIds,
                referencedDocumentIds: mergedDocumentIds,
                referencedWorkOrderIds: mergedWorkOrderIds,
                aiReferences: mergedAiReferences,
            };
            await this.prisma.workOrderAIData.upsert({
                where: { workOrderId },
                create: {
                    ...upsertPayload,
                    workOrder: { connect: { id: workOrderId } },
                },
                update: upsertPayload,
            });
        }
        catch (error) {
            console.warn(`[AI] Failed to persist auto reference snapshot for work order ${workOrderId}: ${error?.message || error}`);
        }
    }
    async buildSelectionPayloadFromTechnicianContext(context) {
        if (!context)
            return null;
        let machineId = context.machineId;
        let plantId = context.plantId;
        let processId = context.processId;
        let subprocessId = context.subprocessId;
        let machineName = context.machineName;
        let machineModel = context.machineModel;
        let machineManufacturer = context.machineManufacturer;
        if (context.workOrderId) {
            const workOrder = await this.prisma.workOrder.findUnique({
                where: { id: context.workOrderId },
                select: {
                    machineId: true,
                    plantId: true,
                    processId: true,
                    subprocessId: true,
                    machine: {
                        select: {
                            name: true,
                            model: true,
                            manufacturer: true,
                        },
                    },
                },
            });
            if (workOrder) {
                machineId = machineId || workOrder.machineId || undefined;
                plantId = plantId || workOrder.plantId || undefined;
                processId = processId || workOrder.processId || undefined;
                subprocessId = subprocessId || workOrder.subprocessId || undefined;
                machineName = machineName || workOrder.machine?.name || undefined;
                machineModel = machineModel || workOrder.machine?.model || undefined;
                machineManufacturer =
                    machineManufacturer || workOrder.machine?.manufacturer || undefined;
            }
        }
        let machineDocumentIds = [];
        if (machineId) {
            const machineDocs = await this.prisma.machineDocument.findMany({
                where: { machineId },
                select: { fileId: true },
            });
            machineDocumentIds = this.uniqueStrings(machineDocs
                .map((doc) => String(doc.fileId || '').trim())
                .filter((id) => id.length > 0));
        }
        const formData = {
            failureDescription: context.failureDescription,
            symptoms: context.symptoms,
            currentStatus: context.machineStatus,
            safetyRisk: context.safetyRisk,
        };
        return {
            workOrderId: context.workOrderId,
            machineId,
            plantId,
            processId,
            subprocessId,
            machineName,
            machineModel,
            machineManufacturer,
            machineDocumentIds,
            formData,
            possibleProblems: context.possibleCauses,
            troubleshootingHistory: (context.troubleshootingResults || []).map((result, index) => ({
                stepNumber: index + 1,
                title: 'Resultado previo',
                instruction: String(result || '').trim(),
            })),
        };
    }
    async enrichTechnicianContext(context, organizationId, options) {
        const selectionPayload = await this.buildSelectionPayloadFromTechnicianContext(context);
        if (!selectionPayload)
            return context;
        const queryText = [this.buildWorkOrderReferenceQuery(selectionPayload), options?.userQuery || '']
            .filter((part) => String(part || '').trim().length > 0)
            .join(' ')
            .trim();
        const queryTokens = this.buildTokenSet(queryText);
        if (queryTokens.size === 0)
            return context;
        const intent = this.classifyTechnicianQuery(options?.userQuery || queryText, context);
        const compressedConversationContext = this.summarizeConversationContext(options?.conversationHistory || []);
        const [workInstructions, similarWorkOrders] = await Promise.all([
            this.resolveWorkInstructionReferences(selectionPayload, queryText, queryTokens, organizationId, intent),
            this.resolveSimilarWorkOrders(selectionPayload, queryText, queryTokens, organizationId, intent),
        ]);
        const relatedDocuments = await this.resolveCrossReferencedDocuments(selectionPayload, queryText, queryTokens, workInstructions, similarWorkOrders, organizationId, intent);
        const referenceDictionary = this.buildReferenceDictionaryText(workInstructions, similarWorkOrders, relatedDocuments);
        const relatedDocsForInsights = relatedDocuments.length
            ? await this.prisma.documentFile.findMany({
                where: { id: { in: relatedDocuments.map((item) => item.id) } },
                select: {
                    id: true,
                    title: true,
                    originalName: true,
                    aiSummary: true,
                    aiResume: true,
                },
            })
            : [];
        const generatedInsights = this.buildManualInsightsFromDocuments(relatedDocsForInsights);
        const generatedSources = relatedDocuments.map((doc) => ({
            document: doc.title,
            pages: 'N/D',
        }));
        await this.persistAutoReferenceSnapshot(selectionPayload, {
            workInstructions,
            similarWorkOrders,
            relatedDocuments,
            selectedDocumentIds: selectionPayload.machineDocumentIds || [],
        });
        if (context.workOrderId) {
            await this.safeUpsertWorkOrderContextCache({
                where: { workOrderId: context.workOrderId },
                create: {
                    workOrderId: context.workOrderId,
                    organizationId,
                    relevanceQuery: queryText,
                    queryIntent: intent,
                    compressedConversationContext: compressedConversationContext || undefined,
                    preloadCompleted: false,
                    preloadAttempts: 0,
                    lastEnrichedAt: new Date(),
                },
                update: {
                    relevanceQuery: queryText,
                    queryIntent: intent,
                    compressedConversationContext: compressedConversationContext || undefined,
                    lastEnrichedAt: new Date(),
                },
            });
        }
        return {
            ...context,
            queryIntent: intent,
            compressedConversationContext: compressedConversationContext || context.compressedConversationContext,
            manualInsights: this.uniqueStrings([
                ...(context.manualInsights || []),
                ...generatedInsights,
            ]).slice(0, 8),
            manualSources: this.mergeManualSources(context.manualSources || [], generatedSources),
            workInstructions: this.mergeWorkInstructionRefs(context.workInstructions || [], workInstructions),
            similarWorkOrders: this.mergeWorkOrderRefs(context.similarWorkOrders || [], similarWorkOrders),
            referenceDictionary: referenceDictionary !== 'N/A'
                ? referenceDictionary
                : context.referenceDictionary,
        };
    }
    async preloadWorkOrderContext(workOrderId, context, organizationId) {
        console.log(`[preloadWorkOrderContext] Starting for WO: ${workOrderId}`);
        try {
            const existing = await this.safeFindWorkOrderContextCache(workOrderId);
            if (existing?.preloadCompleted) {
                console.log(`[preloadWorkOrderContext] Already preloaded for WO: ${workOrderId}`);
                return;
            }
            const selectionPayload = await this.buildSelectionPayloadFromTechnicianContext(context);
            if (!selectionPayload) {
                console.warn(`[preloadWorkOrderContext] No selection payload for WO: ${workOrderId}`);
                return;
            }
            const queryText = this.buildWorkOrderReferenceQuery(selectionPayload);
            const queryTokens = this.buildTokenSet(queryText);
            const intent = this.classifyTechnicianQuery(queryText, context);
            if (queryTokens.size === 0) {
                console.warn(`[preloadWorkOrderContext] Empty query tokens for WO: ${workOrderId}`);
                return;
            }
            const [workInstructions, similarWorkOrders] = await Promise.all([
                this.resolveWorkInstructionReferences(selectionPayload, queryText, queryTokens, organizationId, intent),
                this.resolveSimilarWorkOrders(selectionPayload, queryText, queryTokens, organizationId, intent),
            ]);
            const relatedDocuments = await this.resolveCrossReferencedDocuments(selectionPayload, queryText, queryTokens, workInstructions, similarWorkOrders, organizationId, intent);
            const relatedDocsForInsights = relatedDocuments.length
                ? await this.prisma.documentFile.findMany({
                    where: { id: { in: relatedDocuments.map((item) => item.id) } },
                    select: {
                        id: true,
                        title: true,
                        originalName: true,
                        aiSummary: true,
                        aiResume: true,
                    },
                })
                : [];
            const generatedInsights = this.buildManualInsightsFromDocuments(relatedDocsForInsights);
            const generatedSources = relatedDocuments.map((doc) => ({
                document: doc.title,
                pages: 'N/D',
            }));
            const referenceDictionary = this.buildReferenceDictionaryText(workInstructions, similarWorkOrders, relatedDocuments);
            let queryEmbedding = null;
            try {
                queryEmbedding = await this.vectorStore.embedQuery(queryText, organizationId || 'default');
                console.log(`[preloadWorkOrderContext] Generated query embedding (${queryEmbedding.length} dims)`);
            }
            catch (embError) {
                console.warn(`[preloadWorkOrderContext] Failed to generate query embedding:`, embError?.message);
            }
            await this.safeUpsertWorkOrderContextCache({
                where: { workOrderId },
                create: {
                    workOrderId,
                    organizationId,
                    cachedWorkInstructions: workInstructions,
                    cachedSimilarWorkOrders: similarWorkOrders,
                    cachedDocuments: relatedDocuments.map(doc => ({
                        id: doc.id,
                        title: doc.title,
                    })),
                    cachedManualInsights: generatedInsights,
                    cachedManualSources: generatedSources,
                    cachedReferenceDictionary: referenceDictionary,
                    relevanceQuery: queryText,
                    queryEmbedding: queryEmbedding,
                    queryIntent: intent,
                    preloadCompleted: true,
                    preloadAttempts: 1,
                    lastEnrichedAt: new Date(),
                },
                update: {
                    cachedWorkInstructions: workInstructions,
                    cachedSimilarWorkOrders: similarWorkOrders,
                    cachedDocuments: relatedDocuments.map(doc => ({
                        id: doc.id,
                        title: doc.title,
                    })),
                    cachedManualInsights: generatedInsights,
                    cachedManualSources: generatedSources,
                    cachedReferenceDictionary: referenceDictionary,
                    relevanceQuery: queryText,
                    queryEmbedding: queryEmbedding,
                    queryIntent: intent,
                    preloadCompleted: true,
                    preloadAttempts: (existing?.preloadAttempts || 0) + 1,
                    lastEnrichedAt: new Date(),
                },
            });
            console.log(`[preloadWorkOrderContext] Completed for WO: ${workOrderId}`);
        }
        catch (error) {
            console.error(`[preloadWorkOrderContext] Failed for WO ${workOrderId}:`, error?.message || error);
            await this.safeUpsertWorkOrderContextCache({
                where: { workOrderId },
                create: {
                    workOrderId,
                    organizationId,
                    preloadCompleted: false,
                    preloadAttempts: 1,
                },
                update: {
                    preloadAttempts: { increment: 1 },
                },
            }).catch(() => {
            });
        }
    }
    async enrichTechnicianContextWithCache(workOrderId, context, userQuery, organizationId, conversationHistory = []) {
        const intent = this.classifyTechnicianQuery(userQuery || this.buildWorkOrderReferenceQuery({
            machineName: context.machineName,
            machineModel: context.machineModel,
            machineManufacturer: context.machineManufacturer,
            formData: {
                failureDescription: context.failureDescription,
                symptoms: context.symptoms,
                currentStatus: context.machineStatus,
                safetyRisk: context.safetyRisk,
            },
        }), context);
        const compressedConversationContext = this.summarizeConversationContext(conversationHistory);
        const cached = await this.safeFindWorkOrderContextCache(workOrderId);
        if (cached?.preloadCompleted) {
            if (userQuery && userQuery.trim()) {
                const isSemanticMatch = await this.checkSemanticCacheMatch(userQuery, cached.queryEmbedding, cached.relevanceQuery, cached.similarCachedQueries, organizationId);
                if (isSemanticMatch) {
                    console.log(`[enrichTechnicianContextWithCache] Semantic cache HIT for WO: ${workOrderId}`);
                    await this.safeUpdateWorkOrderContextCache(workOrderId, {
                        similarCachedQueries: {
                            push: userQuery,
                        },
                        queryIntent: intent,
                        compressedConversationContext: compressedConversationContext ||
                            cached.compressedConversationContext,
                        lastEnrichedAt: new Date(),
                    });
                }
                else {
                    console.log(`[enrichTechnicianContextWithCache] Semantic cache MISS, checking expansion for WO: ${workOrderId}`);
                    const shouldExpand = await this.shouldExpandCache(userQuery, [...(cached.expansionQueries || []), cached.relevanceQuery || ''].filter(Boolean), cached.cachedDocuments);
                    const lastEnrichedAtMs = cached.lastEnrichedAt
                        ? new Date(cached.lastEnrichedAt).getTime()
                        : 0;
                    const recentlyEnriched = lastEnrichedAtMs > 0 &&
                        Date.now() - lastEnrichedAtMs < TECHNICIAN_CACHE_EXPANSION_COOLDOWN_MS;
                    if (shouldExpand && !recentlyEnriched) {
                        console.log(`[enrichTechnicianContextWithCache] Expanding cache for new query: ${userQuery}`);
                        const enrichedContext = {
                            ...context,
                            manualInsights: cached.cachedManualInsights || [],
                            manualSources: cached.cachedManualSources || [],
                            workInstructions: cached.cachedWorkInstructions || [],
                            similarWorkOrders: cached.cachedSimilarWorkOrders || [],
                            referenceDictionary: cached.cachedReferenceDictionary || undefined,
                        };
                        return await this.expandCachedContext(workOrderId, enrichedContext, userQuery, organizationId, intent);
                    }
                    if (shouldExpand && recentlyEnriched) {
                        console.log(`[enrichTechnicianContextWithCache] Expansion skipped by cooldown (${TECHNICIAN_CACHE_EXPANSION_COOLDOWN_MS}ms) for WO: ${workOrderId}`);
                    }
                }
            }
            console.log(`[enrichTechnicianContextWithCache] Using cached context for WO: ${workOrderId}`);
            await this.safeUpdateWorkOrderContextCache(workOrderId, {
                queryIntent: intent,
                compressedConversationContext: compressedConversationContext ||
                    cached.compressedConversationContext,
                lastEnrichedAt: new Date(),
            });
            return {
                ...context,
                queryIntent: cached.queryIntent || intent,
                compressedConversationContext: compressedConversationContext ||
                    cached.compressedConversationContext ||
                    context.compressedConversationContext,
                manualInsights: cached.cachedManualInsights || [],
                manualSources: cached.cachedManualSources || [],
                workInstructions: cached.cachedWorkInstructions || [],
                similarWorkOrders: cached.cachedSimilarWorkOrders || [],
                referenceDictionary: cached.cachedReferenceDictionary || undefined,
            };
        }
        console.log(`[enrichTechnicianContextWithCache] No cache found, using regular enrichment for WO: ${workOrderId}`);
        return await this.enrichTechnicianContext(context, organizationId, {
            userQuery,
            conversationHistory,
        });
    }
    async checkSemanticCacheMatch(newQuery, cachedEmbedding, originalQuery, similarQueries, organizationId) {
        if (!cachedEmbedding || !originalQuery) {
            return false;
        }
        const normalizedQuery = this.normalizeSearchText(newQuery);
        const normalizedOriginal = this.normalizeSearchText(originalQuery || '');
        if (!normalizedQuery) {
            return true;
        }
        const quickTokens = this.tokenizeSearchText(normalizedQuery);
        if (quickTokens.length <= 2 && normalizedQuery.length <= 32) {
            if (normalizedOriginal.includes(normalizedQuery) || normalizedQuery.includes(normalizedOriginal)) {
                return true;
            }
        }
        try {
            const newEmbedding = await this.vectorStore.embedQuery(newQuery, organizationId || 'default');
            const similarity = this.cosineSimilarity(newEmbedding, cachedEmbedding);
            console.log(`[checkSemanticCacheMatch] Similarity: ${similarity.toFixed(4)} (threshold: 0.85)`);
            return similarity > 0.85;
        }
        catch (error) {
            console.error(`[checkSemanticCacheMatch] Error:`, error?.message);
            return false;
        }
    }
    async shouldExpandCache(newQuery, previousQueries, cachedDocuments) {
        const queryTokens = this.buildTokenSet(newQuery);
        if (queryTokens.size === 0)
            return false;
        if (queryTokens.size <= 2)
            return false;
        if (!previousQueries.length)
            return false;
        const cachedTokens = this.buildTokenSet(previousQueries.join(' '));
        let overlapCount = 0;
        queryTokens.forEach(token => {
            if (cachedTokens.has(token)) {
                overlapCount++;
            }
        });
        const overlapRatio = queryTokens.size > 0 ? overlapCount / queryTokens.size : 1;
        return overlapRatio < 0.5;
    }
    async expandCachedContext(workOrderId, currentContext, newQuery, organizationId, intent = 'diagnostic') {
        try {
            const queryTokens = this.buildTokenSet(newQuery);
            const selectionPayload = await this.buildSelectionPayloadFromTechnicianContext(currentContext);
            if (!selectionPayload) {
                return currentContext;
            }
            const [newWorkInstructions, newDocuments] = await Promise.all([
                this.resolveWorkInstructionReferences(selectionPayload, newQuery, queryTokens, organizationId, intent),
                this.resolveCrossReferencedDocuments(selectionPayload, newQuery, queryTokens, (currentContext.workInstructions || []).map(wi => ({
                    id: wi.id,
                    title: wi.title,
                    relevance: wi.relevance || 'N/D',
                    summary: wi.summary || '',
                })), (currentContext.similarWorkOrders || []).map(wo => ({
                    id: wo.id,
                    otNumber: wo.otNumber,
                    relevance: wo.relevance || 'N/D',
                    summary: wo.summary || '',
                    referencedDocumentIds: [],
                    referencedWorkInstructionIds: [],
                })), organizationId, intent),
            ]);
            const mergedWorkInstructions = this.mergeWorkInstructionRefs(currentContext.workInstructions || [], newWorkInstructions);
            const newDocumentIds = newDocuments.map(doc => doc.id);
            const newManualSources = newDocuments.map(doc => ({
                document: doc.title,
                pages: 'N/D',
            }));
            const mergedManualSources = this.mergeManualSources(currentContext.manualSources || [], newManualSources);
            await this.safeUpdateWorkOrderContextCache(workOrderId, {
                expansionQueries: { push: newQuery },
                dynamicallyAddedDocuments: { push: newDocumentIds },
                dynamicallyAddedInstructions: { push: newWorkInstructions.map(wi => wi.id) },
                cachedWorkInstructions: mergedWorkInstructions,
                cachedManualSources: mergedManualSources,
                lastEnrichedAt: new Date(),
                queryIntent: intent,
            });
            console.log(`[expandCachedContext] Expanded cache for WO: ${workOrderId} with query: ${newQuery}`);
            return {
                ...currentContext,
                queryIntent: intent,
                workInstructions: mergedWorkInstructions,
                manualSources: mergedManualSources,
            };
        }
        catch (error) {
            console.error(`[expandCachedContext] Failed for WO ${workOrderId}:`, error?.message);
            return currentContext;
        }
    }
    async recordTechnicianProcedureSelection(payload) {
        const selectedProcedure = String(payload.selectedProcedure || '').trim();
        if (selectedProcedure.length < 6)
            return;
        try {
            const context = payload.context || {};
            const workOrderId = String(payload.workOrderId || context.workOrderId || '').trim();
            const selectionPayload = await this.buildSelectionPayloadFromTechnicianContext(context);
            const candidateDocIds = this.uniqueStrings(selectionPayload?.machineDocumentIds || []);
            let cachedDocIds = [];
            if (workOrderId) {
                const cache = await this.safeFindWorkOrderContextCache(workOrderId);
                const docsRaw = Array.isArray(cache?.cachedDocuments)
                    ? cache?.cachedDocuments
                    : [];
                cachedDocIds = this.uniqueStrings(docsRaw
                    .map((item) => String(item?.id || '').trim())
                    .filter((id) => id.length > 0));
            }
            const docIds = this.uniqueStrings([...candidateDocIds, ...cachedDocIds]).slice(0, 40);
            if (!docIds.length)
                return;
            const tokenList = Array.from(this.buildTokenSet(selectedProcedure)).slice(0, 8);
            const chunkWhere = {
                documentId: { in: docIds },
                ...(tokenList.length
                    ? {
                        OR: tokenList.map((token) => ({
                            text: { contains: token, mode: 'insensitive' },
                        })),
                    }
                    : undefined),
            };
            const candidateChunks = await this.prisma.documentChunk.findMany({
                where: chunkWhere,
                select: {
                    id: true,
                    documentId: true,
                    chunkIndex: true,
                    text: true,
                    embedding: true,
                    technicianSelectionCount: true,
                },
                take: 200,
            });
            if (!candidateChunks.length)
                return;
            let selectionEmbedding = [];
            try {
                selectionEmbedding = await this.vectorStore.embedQuery(selectedProcedure, payload.organizationId);
            }
            catch (error) {
                console.warn(`[AI] Failed to generate embedding for technician selection feedback: ${error?.message || error}`);
            }
            const scored = candidateChunks
                .map((chunk) => {
                const keywordOverlap = this.scoreTokenOverlap(new Set(tokenList), this.buildTokenSet(chunk.text || '')).score;
                const embeddingArray = Array.isArray(chunk.embedding)
                    ? chunk.embedding
                    : [];
                const vectorSimilarity = selectionEmbedding.length && embeddingArray.length
                    ? Math.max(0, this.cosineSimilarity(selectionEmbedding, embeddingArray))
                    : 0;
                const baseScore = keywordOverlap * 2.2 + vectorSimilarity * 4;
                return {
                    id: chunk.id,
                    score: baseScore,
                };
            })
                .filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 8);
            if (!scored.length)
                return;
            await Promise.all(scored.map((item) => this.prisma.documentChunk.update({
                where: { id: item.id },
                data: { technicianSelectionCount: { increment: 1 } },
                select: { id: true },
            })));
            console.log(`[AI] Reinforcement feedback applied to ${scored.length} chunk(s) for selected technician procedure.`);
        }
        catch (error) {
            console.warn(`[AI] Failed to record technician procedure selection feedback: ${error?.message || error}`);
        }
    }
    async backfillClosedWorkOrderReferences(options = {}) {
        const limitRaw = Number(options.limit);
        const limit = Number.isFinite(limitRaw)
            ? Math.min(500, Math.max(1, Math.round(limitRaw)))
            : 100;
        const force = Boolean(options.force);
        const result = {
            processed: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            errors: [],
        };
        const closedOrders = await this.prisma.workOrder.findMany({
            where: {
                status: { equals: 'closed', mode: 'insensitive' },
            },
            select: {
                id: true,
                machineId: true,
                plantId: true,
                processId: true,
                subprocessId: true,
                machineName: true,
                machineStatus: true,
                safetyRisk: true,
                description: true,
                symptoms: true,
                alarmCodes: true,
                alarmMessages: true,
                sinceWhen: true,
                frequency: true,
                operatingHours: true,
                recentAdjustments: true,
                adjustmentsDetail: true,
                impactProduction: true,
                impactQuality: true,
                defectType: true,
                defectDescription: true,
                machine: {
                    select: {
                        model: true,
                        manufacturer: true,
                    },
                },
                aiData: {
                    select: {
                        referencedDocumentIds: true,
                        referencedWorkInstructionIds: true,
                        referencedWorkOrderIds: true,
                    },
                },
            },
            orderBy: [{ closedAt: 'desc' }, { updatedAt: 'desc' }],
            take: limit,
        });
        if (closedOrders.length === 0) {
            return result;
        }
        const machineIds = this.uniqueStrings(closedOrders
            .map((order) => String(order.machineId || '').trim())
            .filter((id) => id.length > 0));
        const machineDocRows = machineIds.length > 0
            ? await this.prisma.machineDocument.findMany({
                where: { machineId: { in: machineIds } },
                select: { machineId: true, fileId: true },
            })
            : [];
        const machineDocMap = new Map();
        machineDocRows.forEach((row) => {
            const machineId = String(row.machineId || '').trim();
            const fileId = String(row.fileId || '').trim();
            if (!machineId || !fileId)
                return;
            const current = machineDocMap.get(machineId) || [];
            current.push(fileId);
            machineDocMap.set(machineId, current);
        });
        for (const [machineId, fileIds] of machineDocMap.entries()) {
            machineDocMap.set(machineId, this.uniqueStrings(fileIds));
        }
        for (const order of closedOrders) {
            result.processed += 1;
            const existingRefs = order.aiData;
            const alreadyHasRefs = Boolean(existingRefs?.referencedDocumentIds?.length) ||
                Boolean(existingRefs?.referencedWorkInstructionIds?.length) ||
                Boolean(existingRefs?.referencedWorkOrderIds?.length);
            if (alreadyHasRefs && !force) {
                result.skipped += 1;
                continue;
            }
            try {
                const machineId = String(order.machineId || '').trim();
                const machineDocumentIds = machineId
                    ? machineDocMap.get(machineId) || []
                    : [];
                const payload = {
                    workOrderId: order.id,
                    machineId: order.machineId || undefined,
                    plantId: order.plantId || undefined,
                    processId: order.processId || undefined,
                    subprocessId: order.subprocessId || undefined,
                    machineName: order.machineName || undefined,
                    machineModel: order.machine?.model || undefined,
                    machineManufacturer: order.machine?.manufacturer || undefined,
                    machineDocumentIds,
                    formData: {
                        failureDescription: order.description || '',
                        symptoms: order.symptoms || [],
                        currentStatus: order.machineStatus || '',
                        safetyRisk: order.safetyRisk || '',
                        alarmCodes: order.alarmCodes || '',
                        alarmMessages: order.alarmMessages || '',
                        sinceWhen: order.sinceWhen || '',
                        frequency: order.frequency || '',
                        operatingHours: order.operatingHours || '',
                        recentAdjustments: order.recentAdjustments || '',
                        adjustmentsDetail: order.adjustmentsDetail || '',
                        productionImpact: order.impactProduction || '',
                        qualityImpact: order.impactQuality || '',
                        defectType: order.defectType || '',
                        defectDescription: order.defectDescription || '',
                    },
                };
                const context = await this.resolveWorkOrderReferenceContext(payload);
                const hasComputedRefs = context.workInstructions.length > 0 ||
                    context.similarWorkOrders.length > 0 ||
                    context.relatedDocuments.length > 0 ||
                    machineDocumentIds.length > 0;
                if (!hasComputedRefs) {
                    result.skipped += 1;
                    continue;
                }
                await this.persistAutoReferenceSnapshot(payload, {
                    workInstructions: context.workInstructions,
                    similarWorkOrders: context.similarWorkOrders,
                    relatedDocuments: context.relatedDocuments,
                    selectedDocumentIds: machineDocumentIds,
                });
                result.updated += 1;
            }
            catch (error) {
                result.failed += 1;
                result.errors.push({
                    workOrderId: order.id,
                    message: String(error?.message || error),
                });
            }
        }
        return result;
    }
    buildWorkOrderDocQuery(payload) {
        const formData = payload.formData || {};
        return [
            payload.machineName || '',
            payload.machineModel || '',
            payload.machineManufacturer || '',
            formData.failureDescription || '',
            ...(formData.symptoms || []),
            formData.alarmCodes || '',
            formData.alarmMessages || '',
            formData.currentStatus || '',
            formData.safetyRisk || '',
            ...(payload.possibleProblems || []),
            ...(payload.safetyInstructions || []),
        ]
            .filter(Boolean)
            .join(' ');
    }
    scoreWorkOrderDocument(doc, queryWords, requiresSafety) {
        const searchable = this.normalizeSearchText([
            doc.title || '',
            doc.originalName || '',
            doc.aiSummary || '',
            doc.aiResume || '',
            doc.aiDocType || '',
            ...(doc.aiTags || []),
            ...(doc.aiSafetyInstructions || []),
        ].join(' '));
        let score = 0;
        for (const word of queryWords) {
            if (searchable.includes(word))
                score += 1.5;
        }
        const docType = this.normalizeSearchText(doc.aiDocType || '');
        if (docType.includes('manual'))
            score += 2;
        if (docType.includes('procedure') || docType.includes('instruction'))
            score += 1.5;
        if (docType.includes('troubleshooting'))
            score += 2;
        if (requiresSafety) {
            if ((doc.aiSafetyInstructions || []).length > 0)
                score += 4;
            if (docType.includes('safety'))
                score += 3;
        }
        if (doc.aiProcessingStatus === 'completed') {
            score += 1;
        }
        return score;
    }
    async rankWorkOrderDocumentIds(payload, docs, organizationId, maxDocs = MAX_WORK_ORDER_DOCS) {
        if (!docs.length)
            return [];
        const query = this.buildWorkOrderDocQuery(payload);
        const queryWords = this.tokenizeSearchText(query);
        const requiresSafety = queryWords.some((word) => [
            'seguridad',
            'riesgo',
            'emergencia',
            'bloqueo',
            'loto',
            'atrapada',
            'atrapadas',
        ].includes(word));
        let vectorScores = new Map();
        try {
            const vectorRanked = await this.vectorStore.searchDocumentsByRelevance(query, docs.map((doc) => doc.id), Math.min(maxDocs + 2, docs.length), organizationId);
            vectorScores = new Map(vectorRanked.map((item) => [item.documentId, item.similarity || 0]));
        }
        catch (error) {
            console.warn(`[AI] Vector relevance ranking failed, fallback to metadata ranking: ${error?.message || error}`);
        }
        const scored = docs
            .map((doc) => {
            const heuristic = this.scoreWorkOrderDocument(doc, queryWords, requiresSafety);
            const vectorBoost = (vectorScores.get(doc.id) || 0) * 12;
            return { id: doc.id, score: heuristic + vectorBoost };
        })
            .sort((a, b) => b.score - a.score);
        const selected = scored.slice(0, maxDocs).map((item) => item.id);
        if (selected.length > 0)
            return selected;
        return docs.slice(0, maxDocs).map((doc) => doc.id);
    }
    buildWorkOrderDocInsights(docs) {
        if (!docs.length) {
            return 'No hay metadatos de documentos disponibles para este equipo.';
        }
        return docs
            .map((doc, index) => {
            const title = doc.title || doc.originalName || doc.id;
            const resume = (doc.aiResume || doc.aiSummary || 'Sin resumen IA').trim();
            const docType = (doc.aiDocType || 'other').trim();
            const safety = doc.aiSafetyInstructions.length > 0
                ? doc.aiSafetyInstructions.slice(0, 4).join(' | ')
                : 'Sin instrucciones de seguridad explícitas';
            return `${index + 1}. ${title}\nTipo: ${docType}\nResumen: ${resume}\nSeguridad relevante: ${safety}`;
        })
            .join('\n\n');
    }
    async resolveWorkOrderDocumentContext(payload, user, organizationId, extraCandidateDocIds = [], maxDocs = MAX_WORK_ORDER_DOCS, options) {
        const includeDocumentBodies = options?.includeDocumentBodies !== false;
        const uniqueDocIds = this.uniqueStrings([
            ...((payload.machineDocumentIds || []).filter((id) => Boolean(id)) || []),
            ...(extraCandidateDocIds || []).filter((id) => Boolean(id)),
        ]).slice(0, 24);
        if (uniqueDocIds.length === 0) {
            return {
                selectedDocIds: [],
                docInsightsText: 'No hay manuales o documentos vinculados a la máquina o referencias cruzadas.',
                machineDocs: [],
            };
        }
        const metadata = await this.prisma.documentFile.findMany({
            where: { id: { in: uniqueDocIds } },
            select: {
                id: true,
                title: true,
                originalName: true,
                aiSummary: true,
                aiResume: true,
                aiDocType: true,
                aiSafetyInstructions: true,
                aiTags: true,
                aiProcessingStatus: true,
            },
        });
        if (!metadata.length) {
            return {
                selectedDocIds: uniqueDocIds.slice(0, maxDocs),
                docInsightsText: 'No se encontraron metadatos IA para los documentos de la máquina.',
                machineDocs: [],
            };
        }
        const rankedIds = await this.rankWorkOrderDocumentIds(payload, metadata, organizationId, maxDocs);
        const rankedSet = new Set(rankedIds);
        const selectedMetadata = metadata
            .filter((doc) => rankedSet.has(doc.id))
            .sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));
        if (!includeDocumentBodies) {
            return {
                selectedDocIds: rankedIds,
                docInsightsText: this.buildWorkOrderDocInsights(selectedMetadata),
                machineDocs: [],
            };
        }
        const machineDocs = (await Promise.all(selectedMetadata.map(async (doc) => {
            try {
                return await this.loadDocument(doc.id, user);
            }
            catch (error) {
                console.warn(`[AI] Failed to load selected machine document ${doc.id}: ${error?.message || error}`);
                return null;
            }
        }))).filter((doc) => Boolean(doc));
        return {
            selectedDocIds: rankedIds,
            docInsightsText: this.buildWorkOrderDocInsights(selectedMetadata),
            machineDocs,
        };
    }
    async generateWorkOrderDiagnosis(payload, user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const machineName = (payload.machineName || '').trim();
        const failureDescription = (payload.formData?.failureDescription || '').trim();
        if (!machineName || !failureDescription) {
            throw new common_1.BadRequestException('machineName and formData.failureDescription are required');
        }
        const { workInstructionsText, similarWorkOrdersText, relatedDocumentsText, referenceDictionaryText, relatedDocumentIds, workInstructions, similarWorkOrders, relatedDocuments, } = await this.resolveWorkOrderReferenceContext(payload, organizationId);
        const { machineDocs, docInsightsText, selectedDocIds } = await this.resolveWorkOrderDocumentContext(payload, user, organizationId, relatedDocumentIds, MAX_WORK_ORDER_DOCS, { includeDocumentBodies: false });
        const formData = payload.formData || {};
        const prompt = `Eres un especialista en mantenimiento industrial.
Genera diagnóstico para orden de trabajo de forma precisa y accionable.

Datos de la máquina:
- Nombre: ${machineName}
- Modelo: ${payload.machineModel || 'No especificado'}
- Fabricante: ${payload.machineManufacturer || 'No especificado'}

Reporte del usuario:
- Falla: ${failureDescription}
- Síntomas: ${(formData.symptoms || []).join(', ') || 'No especificados'}
- Estado actual: ${formData.currentStatus || 'No especificado'}
- Riesgo de seguridad: ${formData.safetyRisk || 'No especificado'}
- Momento de falla: ${formData.failureMoment || 'No especificado'}
- Códigos de alarma: ${formData.alarmCodes || 'No especificado'}
- Mensajes de alarma: ${formData.alarmMessages || 'No especificado'}
- Desde cuándo: ${formData.sinceWhen || 'No especificado'}
- Frecuencia: ${formData.frequency || 'No especificado'}
- Horas de operación: ${formData.operatingHours || 'No especificado'}
- Ajustes recientes: ${formData.recentAdjustments || 'No especificado'}
- Detalle ajustes: ${formData.adjustmentsDetail || 'No especificado'}
- Impacto producción: ${formData.productionImpact || 'No especificado'}
- Impacto calidad: ${formData.qualityImpact || 'No especificado'}
- Tipo defecto: ${formData.defectType || 'No especificado'}
- Detalle defecto: ${formData.defectDescription || 'No especificado'}

Si hay manuales, prioriza esa evidencia técnica.
Contexto rápido de documentos seleccionados:
${docInsightsText}

Instrucciones de trabajo vinculadas:
${workInstructionsText}

OTs resueltas similares:
${similarWorkOrdersText}

Documentos relacionados por referencias cruzadas:
${relatedDocumentsText}

Diccionario de referencias cruzadas:
${referenceDictionaryText}

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "classification": "string",
  "priority": "P1|P2|P3",
  "riskLevel": "Alto|Medio|Bajo",
  "productionImpact": "string",
  "qualityImpact": true,
  "operatorInstructions": "string",
  "rootCauses": [{"cause":"string","probability":"string"}],
  "suggestedActions": ["string"],
  "diagnosisDetails": "string",
  "stepsToFix": [
    {
      "step": 1,
      "title": "string",
      "description": "string",
      "tools": ["string"],
      "safetyPrecautions": ["string"],
      "estimatedTime": "string"
    }
  ]
}`;
        const parts = [{ text: prompt }];
        for (const doc of machineDocs) {
            parts.push({ text: `Manual / documento: ${doc.title}` });
            parts.push(doc.part);
        }
        try {
            const result = await this.generateContentWithRetry({
                contents: [{ role: 'user', parts }],
            });
            const response = await result.response;
            this.logVertexResponse('work-order-diagnosis', response);
            const rawText = response.candidates?.[0]?.content?.parts
                ?.map((part) => part?.text || '')
                .join('\n')
                .trim() || '';
            const parsed = this.extractJsonObject(rawText);
            const normalized = this.normalizeWorkOrderDiagnosis(parsed, payload);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            await this.persistAutoReferenceSnapshot(payload, {
                workInstructions,
                similarWorkOrders,
                relatedDocuments,
                selectedDocumentIds: selectedDocIds,
            });
            return normalized;
        }
        catch (error) {
            this.logVertexError('work-order-diagnosis', error);
            throw new common_1.InternalServerErrorException(`AI work-order diagnosis failed: ${error?.message || error}`);
        }
    }
    async generateWorkOrderOperatorPlan(payload, user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const machineName = (payload.machineName || '').trim();
        const failureDescription = (payload.formData?.failureDescription || '').trim();
        if (!machineName || !failureDescription) {
            throw new common_1.BadRequestException('machineName and formData.failureDescription are required');
        }
        const { workInstructionsText, similarWorkOrdersText, relatedDocumentsText, referenceDictionaryText, relatedDocumentIds, workInstructions, similarWorkOrders, relatedDocuments, } = await this.resolveWorkOrderReferenceContext(payload, organizationId);
        const { machineDocs, docInsightsText, selectedDocIds } = await this.resolveWorkOrderDocumentContext(payload, user, organizationId, relatedDocumentIds, MAX_WORK_ORDER_DOCS, { includeDocumentBodies: false });
        const formData = payload.formData || {};
        const prompt = `Eres un especialista en seguridad industrial y troubleshooting para operador.
Analiza el caso y genera un plan inicial para operador NO técnico.

Contexto:
- Planta: ${payload.plantName || 'No especificada'}
- Proceso: ${payload.processName || 'No especificado'}
- Subproceso: ${payload.subprocessName || 'No especificado'}
- Máquina: ${machineName}
- Modelo: ${payload.machineModel || 'No especificado'}
- Fabricante: ${payload.machineManufacturer || 'No especificado'}
- Falla reportada: ${failureDescription}
- Síntomas: ${(formData.symptoms || []).join(', ') || 'No especificados'}
- Estado actual: ${formData.currentStatus || 'No especificado'}
- Riesgo de seguridad: ${formData.safetyRisk || 'No especificado'}
- Momento de falla: ${formData.failureMoment || 'No especificado'}
- Códigos de alarma: ${formData.alarmCodes || 'No especificado'}
- Mensajes de alarma: ${formData.alarmMessages || 'No especificado'}
- Desde cuándo: ${formData.sinceWhen || 'No especificado'}
- Frecuencia: ${formData.frequency || 'No especificado'}
- Horas de operación: ${formData.operatingHours || 'No especificado'}
- Ajustes recientes: ${formData.recentAdjustments || 'No especificado'}
- Detalle ajustes: ${formData.adjustmentsDetail || 'No especificado'}
- Impacto producción: ${formData.productionImpact || 'No especificado'}
- Impacto calidad: ${formData.qualityImpact || 'No especificado'}
- Tipo defecto: ${formData.defectType || 'No especificado'}
- Detalle defecto: ${formData.defectDescription || 'No especificado'}

Contexto rápido de documentos seleccionados:
${docInsightsText}

Instrucciones de trabajo vinculadas:
${workInstructionsText}

OTs resueltas similares:
${similarWorkOrdersText}

Documentos relacionados por referencias cruzadas:
${relatedDocumentsText}

Diccionario de referencias cruzadas:
${referenceDictionaryText}

Reglas:
1) Entrega SOLO instrucciones de seguridad que realmente apliquen.
2) Incluye instrucciones de paro de emergencia y eliminación de fuerzas atrapadas SOLO si aplica al caso.
3) Define si existe troubleshooting básico para operador.
4) Si sí existe troubleshooting, entrega SOLO el primer paso (simple, seguro y claro).
5) Lista posibles fallas y herramientas/materiales posibles para un técnico.
6) Devuelve SOLO JSON válido con estructura exacta:
{
  "classification": "string",
  "priority": "P1|P2|P3",
  "riskLevel": "Alto|Medio|Bajo",
  "productionImpact": "string",
  "qualityImpact": true,
  "safetyInstructions": ["string"],
  "hasBasicTroubleshooting": true,
  "troubleshootingTitle": "string",
  "firstStep": {
    "stepNumber": 1,
    "title": "string",
    "instruction": "string",
    "expectedOperatorInput": "text|image|text_or_image"
  },
  "maxTroubleshootingSteps": 4,
  "possibleProblems": ["string"],
  "suggestedToolsAndMaterials": ["string"]
}`;
        const parts = [{ text: prompt }];
        for (const doc of machineDocs) {
            parts.push({ text: `Manual / documento: ${doc.title}` });
            parts.push(doc.part);
        }
        try {
            const result = await this.generateContentWithRetry({
                contents: [{ role: 'user', parts }],
            });
            const response = await result.response;
            this.logVertexResponse('work-order-operator-plan', response);
            const rawText = response.candidates?.[0]?.content?.parts
                ?.map((part) => part?.text || '')
                .join('\n')
                .trim() || '';
            const parsed = this.extractJsonObject(rawText);
            const normalized = this.normalizeWorkOrderOperatorPlan(parsed, payload);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            await this.persistAutoReferenceSnapshot(payload, {
                workInstructions,
                similarWorkOrders,
                relatedDocuments,
                selectedDocumentIds: selectedDocIds,
            });
            return normalized;
        }
        catch (error) {
            this.logVertexError('work-order-operator-plan', error);
            throw new common_1.InternalServerErrorException(`AI work-order operator plan failed: ${error?.message || error}`);
        }
    }
    async generateWorkOrderTroubleshootingNextStep(payload, user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const machineName = (payload.machineName || '').trim();
        const failureDescription = (payload.formData?.failureDescription || '').trim();
        const history = Array.isArray(payload.troubleshootingHistory)
            ? payload.troubleshootingHistory
            : [];
        if (!machineName || !failureDescription) {
            throw new common_1.BadRequestException('machineName and formData.failureDescription are required');
        }
        if (!history.length) {
            throw new common_1.BadRequestException('troubleshootingHistory is required');
        }
        const maxSteps = this.normalizeMaxTroubleshootingSteps(payload.maxTroubleshootingSteps);
        if (history.length >= maxSteps) {
            return {
                shouldEscalate: true,
                reason: 'Se alcanzó el número máximo de pasos seguros para operador sin resolver la falla.',
                maxStepsReached: true,
            };
        }
        const referencePayload = {
            ...payload,
            troubleshootingHistory: [],
        };
        const { workInstructionsText, similarWorkOrdersText, relatedDocumentsText, referenceDictionaryText, relatedDocumentIds, workInstructions, similarWorkOrders, relatedDocuments, } = await this.resolveWorkOrderReferenceContext(referencePayload, organizationId);
        const { machineDocs, docInsightsText, selectedDocIds } = await this.resolveWorkOrderDocumentContext(referencePayload, user, organizationId, relatedDocumentIds, MAX_WORK_ORDER_DOCS, { includeDocumentBodies: false });
        const prompt = `Eres un especialista en troubleshooting para operador no técnico.
Con base en el contexto y los pasos ejecutados, decide el siguiente paso seguro.

Contexto:
- Planta: ${payload.plantName || 'No especificada'}
- Proceso: ${payload.processName || 'No especificado'}
- Subproceso: ${payload.subprocessName || 'No especificado'}
- Máquina: ${machineName}
- Modelo: ${payload.machineModel || 'No especificado'}
- Fabricante: ${payload.machineManufacturer || 'No especificado'}
- Falla reportada: ${failureDescription}
- Síntomas: ${(payload.formData?.symptoms || []).join(', ') || 'No especificados'}
- Estado actual: ${payload.formData?.currentStatus || 'No especificado'}
- Riesgo de seguridad: ${payload.formData?.safetyRisk || 'No especificado'}
- Posibles problemas: ${(payload.possibleProblems || []).join(', ') || 'No definidos'}
- Herramientas/materiales sugeridos: ${(payload.suggestedToolsAndMaterials || []).join(', ') || 'No definidos'}
- Máximo pasos: ${maxSteps}

Contexto rápido de documentos seleccionados:
${docInsightsText}

Instrucciones de trabajo vinculadas:
${workInstructionsText}

OTs resueltas similares:
${similarWorkOrdersText}

Documentos relacionados por referencias cruzadas:
${relatedDocumentsText}

Diccionario de referencias cruzadas:
${referenceDictionaryText}

Instrucciones de seguridad vigentes:
${(payload.safetyInstructions || []).map((item, index) => `${index + 1}. ${item}`).join('\n') || 'No definidas'}

Historial:
${this.formatTroubleshootingHistory(payload.troubleshootingHistory)}

Reglas:
1) Mantén pasos seguros para operador (sin desarme complejo ni trabajos eléctricos internos).
2) Si no hay avance claro o se detecta riesgo, marca escalamiento.
3) Si procede, entrega un solo siguiente paso claro y verificable.
4) Devuelve SOLO JSON válido con esta estructura exacta:
{
  "shouldEscalate": false,
  "reason": "string",
  "maxStepsReached": false,
  "nextStep": {
    "stepNumber": 2,
    "title": "string",
    "instruction": "string",
    "expectedOperatorInput": "text|image|text_or_image"
  }
}`;
        const parts = [{ text: prompt }];
        for (const doc of machineDocs) {
            parts.push({ text: `Manual / documento: ${doc.title}` });
            parts.push(doc.part);
        }
        try {
            const result = await this.generateContentWithRetry({
                contents: [{ role: 'user', parts }],
            });
            const response = await result.response;
            this.logVertexResponse('work-order-troubleshooting-next-step', response);
            const rawText = response.candidates?.[0]?.content?.parts
                ?.map((part) => part?.text || '')
                .join('\n')
                .trim() || '';
            const parsed = this.extractJsonObject(rawText);
            const normalized = this.normalizeTroubleshootingStepResult(parsed, history.length + 1, maxSteps);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            await this.persistAutoReferenceSnapshot(payload, {
                workInstructions,
                similarWorkOrders,
                relatedDocuments,
                selectedDocumentIds: selectedDocIds,
            });
            return normalized;
        }
        catch (error) {
            this.logVertexError('work-order-troubleshooting-next-step', error);
            throw new common_1.InternalServerErrorException(`AI troubleshooting step failed: ${error?.message || error}`);
        }
    }
    async generateWorkOrderResolutionDraft(payload, user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const machineName = (payload.machineName || '').trim();
        const failureDescription = (payload.formData?.failureDescription || '').trim();
        if (!machineName || !failureDescription) {
            throw new common_1.BadRequestException('machineName and formData.failureDescription are required');
        }
        const { workInstructionsText, similarWorkOrdersText, relatedDocumentsText, referenceDictionaryText, relatedDocumentIds, workInstructions, similarWorkOrders, relatedDocuments, } = await this.resolveWorkOrderReferenceContext(payload, organizationId);
        const { machineDocs, docInsightsText, selectedDocIds } = await this.resolveWorkOrderDocumentContext(payload, user, organizationId, relatedDocumentIds);
        const prompt = `Eres un técnico senior de mantenimiento.
Genera un borrador de resolución de OT usando el contexto y el troubleshooting ejecutado por operador.

Contexto:
- Máquina: ${machineName}
- Falla reportada: ${failureDescription}
- Estado actual: ${payload.formData?.currentStatus || 'No especificado'}
- Riesgo de seguridad: ${payload.formData?.safetyRisk || 'No especificado'}
- Posibles problemas: ${(payload.possibleProblems || []).join(', ') || 'No definidos'}
- Nota final operador: ${payload.finalOperatorNote || 'No especificada'}

Contexto rápido de documentos seleccionados:
${docInsightsText}

Instrucciones de trabajo vinculadas:
${workInstructionsText}

OTs resueltas similares:
${similarWorkOrdersText}

Documentos relacionados por referencias cruzadas:
${relatedDocumentsText}

Diccionario de referencias cruzadas:
${referenceDictionaryText}

Historial troubleshooting:
${this.formatTroubleshootingHistory(payload.troubleshootingHistory)}

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "resolutionSummary": "string",
  "technicalReport": {
    "inspections": "string",
    "measurements": "string",
    "observations": "string",
    "diagnosis": "string",
    "rootCause": "string",
    "actions": ["string"],
    "otherActionDetail": "string",
    "supplies": [{"description":"string","quantity":"string"}],
    "preventiveMeasures": "string"
  }
}`;
        const parts = [{ text: prompt }];
        for (const doc of machineDocs) {
            parts.push({ text: `Manual / documento: ${doc.title}` });
            parts.push(doc.part);
        }
        try {
            const result = await this.generateContentWithRetry({
                contents: [{ role: 'user', parts }],
            });
            const response = await result.response;
            this.logVertexResponse('work-order-resolution-draft', response);
            const rawText = response.candidates?.[0]?.content?.parts
                ?.map((part) => part?.text || '')
                .join('\n')
                .trim() || '';
            const parsed = this.extractJsonObject(rawText);
            const normalized = this.normalizeWorkOrderResolutionDraft(parsed, payload);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            await this.persistAutoReferenceSnapshot(payload, {
                workInstructions,
                similarWorkOrders,
                relatedDocuments,
                selectedDocumentIds: selectedDocIds,
            });
            return normalized;
        }
        catch (error) {
            this.logVertexError('work-order-resolution-draft', error);
            throw new common_1.InternalServerErrorException(`AI work-order resolution draft failed: ${error?.message || error}`);
        }
    }
    async generateWorkOrderEscalationDraft(payload, user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const machineName = (payload.machineName || '').trim();
        const failureDescription = (payload.formData?.failureDescription || '').trim();
        if (!machineName || !failureDescription) {
            throw new common_1.BadRequestException('machineName and formData.failureDescription are required');
        }
        const { workInstructionsText, similarWorkOrdersText, relatedDocumentsText, referenceDictionaryText, relatedDocumentIds, workInstructions, similarWorkOrders, relatedDocuments, } = await this.resolveWorkOrderReferenceContext(payload, organizationId);
        const { machineDocs, docInsightsText, selectedDocIds } = await this.resolveWorkOrderDocumentContext(payload, user, organizationId, relatedDocumentIds);
        const prompt = `Eres un ingeniero de mantenimiento.
Genera borrador de correo para escalar una falla a técnico.

Contexto:
- Fecha/hora reporte: ${payload.reportDate || new Date().toISOString()}
- Planta: ${payload.plantName || 'No especificada'}
- Proceso: ${payload.processName || 'No especificado'}
- Subproceso: ${payload.subprocessName || 'No especificado'}
- Máquina: ${machineName}
- Código máquina: ${payload.machineCode || 'No especificado'}
- Detectó falla: ${payload.detectorName || payload.operatorName || 'No especificado'}
- Turno: ${payload.shift || 'No especificado'}
- Tipo solicitud: ${payload.requestType || 'No especificado'}
- Falla reportada: ${failureDescription}
- Síntomas: ${(payload.formData?.symptoms || []).join(', ') || 'No especificados'}
- Riesgo de seguridad: ${payload.formData?.safetyRisk || 'No especificado'}
- Posibles problemas previos: ${(payload.possibleProblems || []).join(', ') || 'No definidos'}
- Herramientas/materiales previos: ${(payload.suggestedToolsAndMaterials || []).join(', ') || 'No definidos'}

Contexto rápido de documentos seleccionados:
${docInsightsText}

Instrucciones de trabajo vinculadas:
${workInstructionsText}

OTs resueltas similares:
${similarWorkOrdersText}

Documentos relacionados por referencias cruzadas:
${relatedDocumentsText}

Diccionario de referencias cruzadas:
${referenceDictionaryText}

Historial troubleshooting y resultados:
${this.formatTroubleshootingHistory(payload.troubleshootingHistory)}

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "subjectLine": "string",
  "quickSummary": "string",
  "possibleProblems": ["string"],
  "toolsAndMaterials": ["string"],
  "fullContext": "string"
}`;
        const parts = [{ text: prompt }];
        for (const doc of machineDocs) {
            parts.push({ text: `Manual / documento: ${doc.title}` });
            parts.push(doc.part);
        }
        try {
            const result = await this.generateContentWithRetry({
                contents: [{ role: 'user', parts }],
            });
            const response = await result.response;
            this.logVertexResponse('work-order-escalation-draft', response);
            const rawText = response.candidates?.[0]?.content?.parts
                ?.map((part) => part?.text || '')
                .join('\n')
                .trim() || '';
            const parsed = this.extractJsonObject(rawText);
            const normalized = this.normalizeWorkOrderEscalationDraft(parsed, payload);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            await this.persistAutoReferenceSnapshot(payload, {
                workInstructions,
                similarWorkOrders,
                relatedDocuments,
                selectedDocumentIds: selectedDocIds,
            });
            return normalized;
        }
        catch (error) {
            this.logVertexError('work-order-escalation-draft', error);
            throw new common_1.InternalServerErrorException(`AI work-order escalation draft failed: ${error?.message || error}`);
        }
    }
    extractJsonObject(raw) {
        const text = raw.trim();
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
                const candidate = text.slice(start, end + 1);
                try {
                    return JSON.parse(candidate);
                }
                catch {
                    return {};
                }
            }
            return {};
        }
    }
    normalizeWorkOrderDiagnosis(data, payload) {
        const formData = payload.formData || {};
        const normalizedPriority = data?.priority === 'P1' || data?.priority === 'P2' || data?.priority === 'P3'
            ? data.priority
            : this.fallbackPriority(formData.currentStatus, formData.safetyRisk);
        const riskRaw = String(data?.riskLevel || '').toLowerCase();
        const normalizedRisk = riskRaw.includes('alto')
            ? 'Alto'
            : riskRaw.includes('bajo')
                ? 'Bajo'
                : riskRaw.includes('medio')
                    ? 'Medio'
                    : this.fallbackRisk(formData.safetyRisk);
        const qualityRaw = data?.qualityImpact;
        const normalizedQuality = typeof qualityRaw === 'boolean'
            ? qualityRaw
            : String(qualityRaw || formData.qualityImpact || '')
                .toLowerCase()
                .includes('yes') ||
                String(qualityRaw || formData.qualityImpact || '')
                    .toLowerCase()
                    .includes('sí') ||
                String(qualityRaw || formData.qualityImpact || '')
                    .toLowerCase()
                    .includes('si') ||
                String(qualityRaw || formData.qualityImpact || '')
                    .toLowerCase()
                    .includes('true');
        const rootCauses = Array.isArray(data?.rootCauses)
            ? data.rootCauses
                .map((item) => ({
                cause: String(item?.cause || '').trim(),
                probability: String(item?.probability || '').trim() || 'N/D',
            }))
                .filter((item) => item.cause.length > 0)
                .slice(0, 5)
            : [];
        const suggestedActions = Array.isArray(data?.suggestedActions)
            ? data.suggestedActions
                .map((item) => String(item || '').trim())
                .filter((item) => item.length > 0)
                .slice(0, 8)
            : [];
        const stepsToFix = Array.isArray(data?.stepsToFix)
            ? data.stepsToFix
                .map((step, index) => ({
                step: typeof step?.step === 'number' && Number.isFinite(step.step)
                    ? step.step
                    : index + 1,
                title: String(step?.title || '').trim() || `Paso ${index + 1}`,
                description: String(step?.description || '').trim() || 'Sin descripción.',
                tools: Array.isArray(step?.tools)
                    ? step.tools.map((tool) => String(tool || '').trim()).filter(Boolean)
                    : [],
                safetyPrecautions: Array.isArray(step?.safetyPrecautions)
                    ? step.safetyPrecautions
                        .map((precaution) => String(precaution || '').trim())
                        .filter(Boolean)
                    : [],
                estimatedTime: step?.estimatedTime
                    ? String(step.estimatedTime).trim()
                    : undefined,
            }))
                .slice(0, 10)
            : [];
        const classification = String(data?.classification || '').trim() ||
            `Diagnóstico preliminar de ${payload.machineName || 'equipo'}`;
        const diagnosisDetails = String(data?.diagnosisDetails || '').trim() ||
            `Falla reportada: ${formData.failureDescription || 'Sin descripción'}.`;
        const operatorInstructions = String(data?.operatorInstructions || '').trim() ||
            (suggestedActions.length
                ? suggestedActions.map((action, index) => `${index + 1}. ${action}`).join('\n')
                : 'Aplicar LOTO y contactar mantenimiento.');
        const productionImpact = String(data?.productionImpact || '').trim() ||
            formData.productionImpact ||
            'Sin impacto reportado';
        return {
            classification,
            priority: normalizedPriority,
            riskLevel: normalizedRisk,
            productionImpact,
            qualityImpact: normalizedQuality,
            operatorInstructions,
            rootCauses: rootCauses.length > 0
                ? rootCauses
                : [{ cause: 'Análisis de causa pendiente', probability: 'N/D' }],
            suggestedActions: suggestedActions.length > 0
                ? suggestedActions
                : ['Inspección visual', 'Verificación de parámetros operativos'],
            diagnosisDetails,
            stepsToFix,
        };
    }
    fallbackPriority(currentStatus, safetyRisk) {
        const status = String(currentStatus || '').toLowerCase();
        const risk = String(safetyRisk || '').toLowerCase();
        if (status.includes('paro total') || risk.includes('alto'))
            return 'P1';
        if (status.includes('falla') || risk.includes('medio'))
            return 'P2';
        return 'P3';
    }
    fallbackRisk(safetyRisk) {
        const risk = String(safetyRisk || '').toLowerCase();
        if (risk.includes('alto'))
            return 'Alto';
        if (risk.includes('bajo'))
            return 'Bajo';
        return 'Medio';
    }
    normalizeStringArray(value, max = 8) {
        if (!Array.isArray(value))
            return [];
        return value
            .map((item) => String(item || '').trim())
            .filter((item) => item.length > 0)
            .slice(0, max);
    }
    normalizeOperatorInputType(value) {
        const input = String(value || '').toLowerCase();
        if (input.includes('image') && input.includes('text'))
            return 'text_or_image';
        if (input.includes('image'))
            return 'image';
        if (input.includes('texto') && input.includes('imagen'))
            return 'text_or_image';
        if (input.includes('imagen'))
            return 'image';
        if (input.includes('text') || input.includes('texto'))
            return 'text';
        return 'text_or_image';
    }
    normalizeTroubleshootingStep(step, fallbackStepNumber) {
        return {
            stepNumber: typeof step?.stepNumber === 'number' && Number.isFinite(step.stepNumber)
                ? Math.max(1, Math.floor(step.stepNumber))
                : fallbackStepNumber,
            title: String(step?.title || '').trim() ||
                `Paso ${Math.max(1, Math.floor(fallbackStepNumber))}`,
            instruction: String(step?.instruction || '').trim() || 'Validar condición reportada.',
            expectedOperatorInput: this.normalizeOperatorInputType(step?.expectedOperatorInput),
        };
    }
    normalizeMaxTroubleshootingSteps(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed))
            return 4;
        return Math.min(8, Math.max(2, Math.round(parsed)));
    }
    formatTroubleshootingHistory(history) {
        if (!Array.isArray(history) || history.length === 0)
            return 'Sin historial.';
        return history
            .map((entry, index) => {
            const stepNumber = typeof entry?.stepNumber === 'number' && Number.isFinite(entry.stepNumber)
                ? entry.stepNumber
                : index + 1;
            const title = String(entry?.title || '').trim() || `Paso ${stepNumber}`;
            const instruction = String(entry?.instruction || '').trim() || 'Sin instrucción.';
            const text = String(entry?.operatorInputText || '').trim() || 'Sin texto';
            const images = this.normalizeStringArray(entry?.operatorImageNotes, 10);
            return [
                `Paso ${stepNumber}: ${title}`,
                `- Instrucción: ${instruction}`,
                `- Resultado operador: ${text}`,
                `- Evidencia imagen: ${images.length ? images.join(', ') : 'Sin imagen'}`,
            ].join('\n');
        })
            .join('\n\n');
    }
    normalizeWorkOrderOperatorPlan(data, payload) {
        const formData = payload.formData || {};
        const normalizedPriority = data?.priority === 'P1' || data?.priority === 'P2' || data?.priority === 'P3'
            ? data.priority
            : this.fallbackPriority(formData.currentStatus, formData.safetyRisk);
        const normalizedRisk = this.fallbackRisk(String(data?.riskLevel || formData.safetyRisk || ''));
        const qualityRaw = String(data?.qualityImpact ?? formData.qualityImpact ?? '')
            .toLowerCase()
            .trim();
        const qualityImpact = typeof data?.qualityImpact === 'boolean'
            ? data.qualityImpact
            : qualityRaw.includes('yes') ||
                qualityRaw.includes('si') ||
                qualityRaw.includes('sí') ||
                qualityRaw.includes('true');
        const failureText = `${formData.failureDescription || ''} ${(formData.alarmMessages || '')}`
            .toLowerCase();
        const safetyInstructions = this.normalizeStringArray(data?.safetyInstructions, 10);
        if (!safetyInstructions.some((item) => item.toLowerCase().includes('emergencia') || item.toLowerCase().includes('paro')) &&
            (normalizedRisk === 'Alto' || failureText.includes('atasc') || failureText.includes('golpe'))) {
            safetyInstructions.unshift('Si existe riesgo inmediato, active el paro de emergencia y detenga la operación.');
        }
        const trappedEnergyHints = ['hidraulic', 'neumatic', 'presion', 'resorte', 'fuerza', 'atrap'];
        if (trappedEnergyHints.some((hint) => failureText.includes(hint)) &&
            !safetyInstructions.some((item) => item.toLowerCase().includes('fuerza atrap') ||
                item.toLowerCase().includes('energía atrap'))) {
            safetyInstructions.push('Antes de intervenir, verifique eliminación de fuerzas/energías atrapadas (presión, tensión o gravedad).');
        }
        if (!safetyInstructions.length) {
            safetyInstructions.push('Aplicar LOTO y validar condición segura antes de manipular el equipo.');
        }
        const hasBasicTroubleshooting = typeof data?.hasBasicTroubleshooting === 'boolean'
            ? data.hasBasicTroubleshooting
            : true;
        const maxTroubleshootingSteps = this.normalizeMaxTroubleshootingSteps(data?.maxTroubleshootingSteps);
        const firstStepRaw = data?.firstStep && typeof data.firstStep === 'object'
            ? this.normalizeTroubleshootingStep(data.firstStep, 1)
            : undefined;
        const firstStep = hasBasicTroubleshooting
            ? firstStepRaw || {
                stepNumber: 1,
                title: 'Verificación inicial',
                instruction: 'Confirme el estado actual de la máquina y describa exactamente qué observa en panel y operación.',
                expectedOperatorInput: 'text_or_image',
            }
            : undefined;
        const possibleProblems = this.normalizeStringArray(data?.possibleProblems, 8);
        const suggestedToolsAndMaterials = this.normalizeStringArray(data?.suggestedToolsAndMaterials, 10);
        return {
            classification: String(data?.classification || '').trim() ||
                `Diagnóstico preliminar de ${payload.machineName || 'equipo'}`,
            priority: normalizedPriority,
            riskLevel: normalizedRisk,
            productionImpact: String(data?.productionImpact || '').trim() ||
                formData.productionImpact ||
                'Sin impacto reportado',
            qualityImpact,
            safetyInstructions: safetyInstructions.slice(0, 10),
            hasBasicTroubleshooting,
            troubleshootingTitle: String(data?.troubleshootingTitle || '').trim() ||
                'Troubleshooting básico para operador',
            firstStep,
            maxTroubleshootingSteps,
            possibleProblems: possibleProblems.length > 0
                ? possibleProblems
                : ['Falla pendiente de confirmación técnica.'],
            suggestedToolsAndMaterials: suggestedToolsAndMaterials.length > 0
                ? suggestedToolsAndMaterials
                : ['Multímetro', 'Llaves de ajuste', 'Elementos de limpieza'],
            operatorInstructions: safetyInstructions
                .map((item, index) => `${index + 1}. ${item}`)
                .join('\n'),
        };
    }
    normalizeTroubleshootingStepResult(data, expectedStepNumber, maxSteps) {
        const nextStepRaw = data?.nextStep && typeof data.nextStep === 'object'
            ? this.normalizeTroubleshootingStep(data.nextStep, expectedStepNumber)
            : undefined;
        const maxStepsReached = Boolean(data?.maxStepsReached) || expectedStepNumber > maxSteps;
        const shouldEscalate = Boolean(data?.shouldEscalate) || maxStepsReached;
        if (shouldEscalate) {
            return {
                shouldEscalate: true,
                reason: String(data?.reason || '').trim() ||
                    'No se logró resolver de forma segura para operador. Escalar a técnico.',
                maxStepsReached,
            };
        }
        return {
            shouldEscalate: false,
            reason: String(data?.reason || '').trim() || 'Continuar troubleshooting guiado.',
            maxStepsReached: false,
            nextStep: nextStepRaw || {
                stepNumber: expectedStepNumber,
                title: `Paso ${expectedStepNumber}`,
                instruction: 'Realice una verificación básica adicional y describa el resultado observado.',
                expectedOperatorInput: 'text_or_image',
            },
        };
    }
    normalizeWorkOrderResolutionDraft(data, payload) {
        const report = data?.technicalReport || {};
        const actions = this.normalizeStringArray(report?.actions, 8);
        const supplies = Array.isArray(report?.supplies)
            ? report.supplies
                .map((item) => ({
                description: String(item?.description || '').trim(),
                quantity: String(item?.quantity || '').trim() || '1',
            }))
                .filter((item) => item.description.length > 0)
                .slice(0, 10)
            : [];
        return {
            resolutionSummary: String(data?.resolutionSummary || '').trim() ||
                'Falla estabilizada por troubleshooting de operador.',
            technicalReport: {
                inspections: String(report?.inspections || '').trim() ||
                    'Inspección visual y funcional inicial realizada por operador.',
                measurements: String(report?.measurements || '').trim() ||
                    'Sin mediciones instrumentales detalladas en etapa de operador.',
                observations: String(report?.observations || '').trim() ||
                    `Se ejecutó troubleshooting básico para ${payload.machineName || 'equipo'} y se recuperó la operación.`,
                diagnosis: String(report?.diagnosis || '').trim() ||
                    'Falla operativa corregida con procedimiento básico.',
                rootCause: String(report?.rootCause || '').trim() ||
                    'Condición operativa fuera de parámetro pendiente de validación técnica.',
                actions: actions.length > 0
                    ? actions
                    : ['Verificación de alarmas', 'Normalización de parámetros'],
                otherActionDetail: String(report?.otherActionDetail || '').trim(),
                supplies,
                preventiveMeasures: String(report?.preventiveMeasures || '').trim() ||
                    'Mantener checklist de verificación y monitoreo de alarmas al arranque.',
            },
        };
    }
    normalizeWorkOrderEscalationDraft(data, payload) {
        const possibleProblems = this.normalizeStringArray(data?.possibleProblems, 10);
        const toolsAndMaterials = this.normalizeStringArray(data?.toolsAndMaterials, 12);
        const location = [payload.plantName, payload.processName, payload.subprocessName]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(' / ');
        return {
            subjectLine: String(data?.subjectLine || '').trim() ||
                `Escalamiento técnico - ${payload.machineCode || payload.machineName || 'OT'}`,
            quickSummary: String(data?.quickSummary || '').trim() ||
                `Hora: ${payload.reportDate || new Date().toISOString()}. Máquina: ${payload.machineName || 'No especificada'}. Ubicación: ${location || 'No especificada'}. Falla: ${payload.formData?.failureDescription || 'No especificada'}.`,
            possibleProblems: possibleProblems.length > 0
                ? possibleProblems
                : ['Diagnóstico técnico pendiente por validación en campo.'],
            toolsAndMaterials: toolsAndMaterials.length > 0
                ? toolsAndMaterials
                : ['Kit básico de herramientas mecánicas y eléctricas'],
            fullContext: String(data?.fullContext || '').trim() ||
                this.formatTroubleshootingHistory(payload.troubleshootingHistory),
        };
    }
    async compareProcedureVersions(approvalId, user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const approvalDetails = await this.approvalsService.getApprovalDetails({ approvalId });
        if (!approvalDetails.currentVersion || !approvalDetails.currentVersion.fileId) {
            throw new common_1.BadRequestException('No current version found for this approval');
        }
        const currentVersion = approvalDetails.currentVersion;
        const previousVersion = approvalDetails.previousVersion;
        if (!previousVersion || !previousVersion.fileId) {
            throw new common_1.BadRequestException('No previous version available for comparison');
        }
        console.log('[AI] Loading current version:', currentVersion.fileName);
        const currentFileId = currentVersion.fileId;
        const currentDoc = await this.loadDocumentVersion(currentFileId, currentVersion.fileName || 'current', user);
        console.log('[AI] Loading previous version:', previousVersion.fileName);
        const previousFileId = previousVersion.fileId;
        const previousDoc = await this.loadDocumentVersion(previousFileId, previousVersion.fileName || 'previous', user);
        const procedure = await this.prisma.procedure.findUnique({
            where: { id: approvalDetails.procedure.id },
            include: {
                documents: true,
                reviewer: true,
                responsible: true,
            },
        });
        if (!procedure) {
            throw new common_1.BadRequestException('Procedure not found');
        }
        const metadataComparison = {
            procedureName: {
                current: procedure.title,
                previous: procedure.title,
            },
            documentName: {
                current: currentVersion.fileName || 'unknown',
                previous: previousVersion.fileName || 'unknown',
            },
            version: {
                current: currentVersion.version || '1.0',
                previous: previousVersion.version || '1.0',
            },
            uploadDate: {
                current: currentVersion.uploadDate,
                previous: previousVersion.uploadDate,
            },
            status: {
                current: currentVersion.status || 'unknown',
                previous: previousVersion.status || 'unknown',
            },
            documentsCount: procedure.documents?.length || 0,
        };
        const comparisonPrompt = `Compara las versiones del procedimiento "${procedure.title}" y genera un resumen CORTO y PUNTUAL.

Versión Anterior: ${previousVersion.version} (${previousVersion.fileName})
Versión Actual: ${currentVersion.version} (${currentVersion.fileName})

**INSTRUCCIONES:**
- Lista SOLO los cambios detectados (máximo 5-7 puntos principales)
- Sé breve y directo (1 línea por cambio)
- Si no hay cambios, responde: "Sin cambios detectados"
- Omite secciones sin cambios

**FORMATO:**
✏️ **[Sección]**: Descripción breve del cambio
➕ **[Sección]**: Contenido añadido  
❌ **[Sección]**: Contenido eliminado
⚠️ **Cambio crítico**: Solo si afecta seguridad/calidad

**RESUMEN FINAL:**
- Total: X cambios
- Impacto: Crítico/Alto/Medio/Bajo`;
        try {
            const parts = [
                { text: comparisonPrompt },
                { text: '\n\n--- DOCUMENTO ANTERIOR (v' + previousVersion.version + ') ---\n' },
                previousDoc.part,
                { text: '\n\n--- DOCUMENTO ACTUAL (v' + currentVersion.version + ') ---\n' },
                currentDoc.part,
            ];
            const result = await this.generateContentWithRetry({
                contents: [{ role: 'user', parts }],
            });
            const response = await result.response;
            this.logVertexResponse('compare-procedure-versions', response);
            const analysis = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            try {
                await this.historyService.create({
                    eventType: 'Comparación IA',
                    title: `Comparación: ${procedure.title} (v${previousVersion.version} → v${currentVersion.version})`,
                    user: user?.email || user?.sub || 'Usuario',
                    timestamp: new Date().toISOString(),
                    criticality: 'info',
                    details: {
                        approvalId,
                        procedureTitle: procedure.title,
                        currentVersion: currentVersion.version,
                        previousVersion: previousVersion.version,
                        tokens,
                        model: MODEL_ID,
                    },
                    hierarchy: 'IA / Comparaciones',
                });
            }
            catch (err) {
                console.warn('[AI] Failed to log history event', err?.message || err);
            }
            return {
                analysis,
                metadata: metadataComparison,
                currentVersion: {
                    version: currentVersion.version,
                    fileName: currentVersion.fileName,
                    uploadDate: currentVersion.uploadDate,
                },
                previousVersion: {
                    version: previousVersion.version,
                    fileName: previousVersion.fileName,
                    uploadDate: previousVersion.uploadDate,
                },
            };
        }
        catch (error) {
            this.logVertexError('compare-procedure-versions', error);
            console.error('[AI] Comparison request failed:', error);
            throw new common_1.InternalServerErrorException(`AI comparison failed: ${error?.message || error}`);
        }
    }
    async quickVersionCheck(params, user, organizationId) {
        if (!params.currentFileId || !params.previousFileId) {
            throw new common_1.BadRequestException('currentFileId and previousFileId are required');
        }
        console.log('[AI] Quick version check (lightweight) - fetching metadata only');
        const [currentMeta, previousMeta] = await Promise.all([
            this.prisma.documentFile.findUnique({
                where: { id: params.currentFileId },
                select: { id: true, size: true, originalName: true, mimeType: true },
            }),
            this.prisma.documentFile.findUnique({
                where: { id: params.previousFileId },
                select: { id: true, size: true, originalName: true, mimeType: true },
            }),
        ]);
        if (!currentMeta || !previousMeta) {
            throw new common_1.NotFoundException('One or both documents not found');
        }
        let currentHash = null;
        let previousHash = null;
        try {
            const [currentWithHash, previousWithHash] = await Promise.all([
                this.prisma.documentFile.findUnique({
                    where: { id: params.currentFileId },
                    select: { fileHash: true },
                }),
                this.prisma.documentFile.findUnique({
                    where: { id: params.previousFileId },
                    select: { fileHash: true },
                }),
            ]);
            currentHash = currentWithHash?.fileHash || null;
            previousHash = previousWithHash?.fileHash || null;
        }
        catch (err) {
            console.warn('[AI] Could not fetch fileHash (migration may be pending):', err?.message || '');
        }
        if (currentHash && previousHash && currentHash === previousHash) {
            console.log('[AI] Quick check: Identical file hash detected');
            return {
                requiresConfirmation: false,
                differenceLevel: 'low',
                reason: 'Archivo idéntico detectado (mismo contenido).',
                highlights: ['El archivo subido es exactamente igual a la versión anterior.'],
                scores: {
                    lexicalSimilarity: 1.0,
                    aiDifferenceScore: 0,
                },
            };
        }
        const sizeDiffPercent = Math.abs(currentMeta.size - previousMeta.size) / previousMeta.size;
        if (sizeDiffPercent > 0.15) {
            console.log('[AI] Quick check: Large size difference detected:', (sizeDiffPercent * 100).toFixed(1) + '%');
            return {
                requiresConfirmation: true,
                differenceLevel: 'high',
                reason: `Diferencia significativa de tamaño detectada (${(sizeDiffPercent * 100).toFixed(0)}%).`,
                highlights: [
                    `Archivo anterior: ${(previousMeta.size / 1024).toFixed(1)} KB`,
                    `Archivo nuevo: ${(currentMeta.size / 1024).toFixed(1)} KB`,
                    'Puede ser un documento completamente diferente.',
                ],
                scores: {
                    lexicalSimilarity: null,
                    aiDifferenceScore: Math.min(100, Math.round(sizeDiffPercent * 200)),
                },
            };
        }
        console.log('[AI] Quick check: Similar size, different hash - likely minor changes');
        const estimatedSimilarity = 1.0 - (sizeDiffPercent * 2);
        return {
            requiresConfirmation: false,
            differenceLevel: sizeDiffPercent > 0.05 ? 'medium' : 'low',
            reason: 'Cambios menores detectados en el archivo.',
            highlights: [
                `Diferencia de tamaño: ${(sizeDiffPercent * 100).toFixed(1)}%`,
                'El archivo parece ser una actualización de la versión anterior.',
            ],
            scores: {
                lexicalSimilarity: estimatedSimilarity,
                aiDifferenceScore: Math.round(sizeDiffPercent * 100),
            },
        };
    }
    async generateDocumentResume(fileId, fileName, user) {
        try {
            if (!this.model) {
                console.warn('[AI Resume] Vertex AI not configured, skipping resume generation');
                return null;
            }
            console.log(`[AI Resume] Generating resume for document: ${fileName} (fileId: ${fileId})`);
            const { file, stream } = await this.documentsService.getStream(fileId, user);
            const buffer = await this.streamToBuffer(stream);
            const part = await this.extractContentPart(file.mimeType, fileName, buffer);
            const result = await this.generateContentWithRetry({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                text: `Analiza el siguiente documento y genera un resumen BREVE y CONCISO (máximo 200 caracteres) que incluya:
- Tema principal del documento
- Área o departamento relacionado (si es aplicable)
- Contenido o propósito principal
- Que sea directo y específico

Responde SOLO con el resumen, sin explicaciones adicionales.`,
                            },
                            part,
                        ],
                    },
                ],
            });
            const response = await result.response;
            this.logVertexResponse('document-resume', response);
            const candidate = response.candidates?.[0];
            const textPart = candidate?.content?.parts?.[0];
            const fullText = textPart?.text || '';
            const resume = fullText
                .split('\n')[0]
                ?.trim()
                ?.substring(0, 500) || null;
            console.log(`[AI Resume] Generated resume: "${resume}"`);
            if (resume) {
                await this.prisma.documentFile.update({
                    where: { id: fileId },
                    data: {
                        aiResume: resume,
                        aiProcessingStatus: 'completed',
                    },
                });
                console.log(`[AI Resume] Resume saved to document ${fileId}`);
            }
            return resume;
        }
        catch (error) {
            console.error(`[AI Resume] Error generating resume: ${error?.message || error}`);
            await this.prisma.documentFile
                .update({
                where: { id: fileId },
                data: { aiProcessingStatus: 'failed' },
            })
                .catch((e) => console.error('[AI Resume] Failed to update processing status:', e));
            return null;
        }
    }
    async loadDocumentVersion(fileId, fileName, user) {
        console.log(`[AI] Loading document version: ${fileName} (fileId: ${fileId})`);
        const { file, stream } = await this.documentsService.getStream(fileId, user);
        const buffer = await this.streamToBuffer(stream);
        const part = await this.extractContentPart(file.mimeType, file.originalName, buffer);
        return { id: fileId, title: fileName, part };
    }
    async saveFeedback(payload) {
        if (!payload.userId || !payload.organizationId) {
            throw new common_1.BadRequestException('User ID and Organization ID are required for feedback.');
        }
        try {
            const feedback = await this.prisma.aIFeedback.create({
                data: {
                    userId: payload.userId,
                    organizationId: payload.organizationId,
                    query: payload.query,
                    response: payload.response,
                    rating: payload.rating,
                    documentIds: payload.documentIds,
                },
            });
            return feedback;
        }
        catch (error) {
            console.error('[AI] Failed to save AI feedback', error);
            throw new common_1.InternalServerErrorException('Failed to save feedback');
        }
    }
    async verifyWorkInstructionStep(payload, user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        try {
            await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
            const fetchImageBase64 = async (url) => {
                if (url.startsWith('data:image/')) {
                    const mimeType = url.substring('data:'.length, url.indexOf(';base64,'));
                    const data = url.substring(url.indexOf(';base64,') + 8);
                    return { mimeType, data };
                }
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch image: ${response.statusText}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const mimeType = response.headers.get('content-type') || 'image/jpeg';
                return { mimeType, data: buffer.toString('base64') };
            };
            const [goldenImage, validationImage] = await Promise.all([
                fetchImageBase64(payload.goldenSampleUrl),
                fetchImageBase64(payload.validationImageUrl),
            ]);
            const rulesText = payload.rules?.length
                ? payload.rules.map((rule, idx) => {
                    const colorText = rule.color ? ` (color ${rule.color})` : '';
                    const coordsText = rule.highlight
                        ? ` en las coordenadas relativas x:${Math.round(rule.highlight.x)}%, y:${Math.round(rule.highlight.y)}%, ancho:${Math.round(rule.highlight.w)}%, alto:${Math.round(rule.highlight.h)}%`
                        : '';
                    return `Regla ${idx + 1}${colorText}${coordsText}: "${rule.description}"`;
                }).join('\n')
                : 'Verifica que la acción se haya completado correctamente según la muestra ideal.';
            const promptText = `Eres un inspector experto de Control de Calidad (QA) visual en una fábrica industrial.
Se te proporcionan dos imágenes:
1. Una imagen "Muestra Ideal" (Golden Sample) cargada primero.
2. Una imagen "Validación" tomada por un operario cargada después.

Tu trabajo es verificar si la imagen de Validación cumple con los criterios descritos por el supervisor, basándote en la Muestra Ideal.
Debes ser robusto a cambios en el ángulo de la cámara, la iluminación y la escala.

Criterios y áreas de inspección:
${rulesText}

Evalúa la imagen de Validación y responde ÚNICAMENTE en el siguiente formato JSON estricto:
{
  "status": "VALIDATED" | "FAILED" | "UNCLEAR",
  "message": "Tu mensaje de retroalimentación en español para el operario (ej. 'La foto muestra claramente el componente ensamblado' o 'Falta el tornillo en la esquina superior')",
  "correction_advice": "Solo si es UNCLEAR, explica cómo el operario puede tomar una mejor foto (ej. 'Por favor toma la foto desde arriba con mejor iluminación'). Si no es UNCLEAR, devuelve un string vacío."
}`;
            const request = {
                model: 'gemini-1.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: promptText },
                            {
                                inlineData: {
                                    mimeType: goldenImage.mimeType,
                                    data: goldenImage.data,
                                },
                            },
                            {
                                inlineData: {
                                    mimeType: validationImage.mimeType,
                                    data: validationImage.data,
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.1,
                },
            };
            const result = await this.generateContentWithRetry(request);
            const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            let jsonResult;
            try {
                jsonResult = JSON.parse(responseText.replace(/```json\n?|\n?```/g, ''));
            }
            catch (e) {
                console.error('[AI] QA Vision parse error:', responseText);
                jsonResult = {
                    status: 'UNCLEAR',
                    message: 'Error procesando la respuesta de la IA.',
                    correction_advice: 'Por favor intenta de nuevo.',
                };
            }
            return jsonResult;
        }
        catch (error) {
            console.error('[AI] QA Vision Error:', error.message || error);
            throw new common_1.InternalServerErrorException('Error en la validación por IA: ' + (error.message || ''));
        }
    }
};
exports.AiService = AiService;
exports.AiService = AiService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [documents_service_1.DocumentsService,
        document_indexing_service_1.DocumentIndexingService,
        ai_usage_service_1.AiUsageService,
        vector_store_service_1.VectorStoreService,
        history_service_1.HistoryService,
        approvals_service_1.ApprovalsService,
        prisma_service_1.PrismaService,
        cache_service_1.CacheService])
], AiService);
//# sourceMappingURL=cvqa.service.js.map