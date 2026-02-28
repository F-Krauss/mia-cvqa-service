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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkOrderAiService = void 0;
const common_1 = require("@nestjs/common");
const vertexai_1 = require("@google-cloud/vertexai");
const ai_usage_service_1 = require("./ai-usage.service");
const vertex_retry_1 = require("../common/vertex-retry");
const WORK_ORDER_CHAT_MODEL_ID = process.env.WORK_ORDER_CHAT_MODEL_ID ||
    process.env.WORK_ORDER_AI_MODEL_ID ||
    process.env.AI_WORK_ORDER_MODEL_ID ||
    'gemini-2.5-flash';
const WORK_ORDER_REPORT_MODEL_ID = process.env.WORK_ORDER_REPORT_MODEL_ID ||
    process.env.WORK_ORDER_AI_MODEL_ID ||
    process.env.AI_WORK_ORDER_MODEL_ID ||
    'gemini-2.5-pro';
const TECHNICIAN_CHAT_HISTORY_WINDOW = Math.max(1, Number(process.env.TECHNICIAN_CHAT_SLIDING_WINDOW_EXCHANGES || 5));
const TECHNICIAN_CONTEXT_MAX_MANUAL_SOURCES = Math.max(2, Number(process.env.TECHNICIAN_CONTEXT_MAX_MANUAL_SOURCES || 4));
const TECHNICIAN_CONTEXT_MAX_MANUAL_INSIGHTS = Math.max(2, Number(process.env.TECHNICIAN_CONTEXT_MAX_MANUAL_INSIGHTS || 4));
const TECHNICIAN_CONTEXT_MAX_WORK_INSTRUCTIONS = Math.max(1, Number(process.env.TECHNICIAN_CONTEXT_MAX_WORK_INSTRUCTIONS || 3));
const TECHNICIAN_CONTEXT_MAX_WORK_ORDER_REFS = Math.max(1, Number(process.env.TECHNICIAN_CONTEXT_MAX_WORK_ORDER_REFS || 3));
let WorkOrderAiService = class WorkOrderAiService {
    aiUsageService;
    vertexAI = null;
    chatModel = null;
    reportModel = null;
    constructor(aiUsageService) {
        this.aiUsageService = aiUsageService;
        const projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
        const location = process.env.VERTEX_LOCATION || 'us-central1';
        if (!projectId) {
            console.warn('[WorkOrderAI] VERTEX_PROJECT_ID not found. Work order AI chat will be disabled.');
            return;
        }
        this.vertexAI = new vertexai_1.VertexAI({ project: projectId, location });
        this.chatModel = this.vertexAI.preview.getGenerativeModel({
            model: WORK_ORDER_CHAT_MODEL_ID,
            systemInstruction: {
                role: 'system',
                parts: [
                    {
                        text: `Eres un especialista senior en troubleshooting industrial para técnicos de mantenimiento.
Objetivo: guiar una conversación técnica natural, contextual y accionable para resolver fallas reales en campo.

Reglas obligatorias:
1) Usa lenguaje técnico para técnicos, sin simplificaciones de operador básico.
2) Prioriza seguridad: LOTO, energía cero, permisos y EPP antes de acciones de riesgo.
3) Cada recomendación debe usar contexto completo: síntomas, resultados previos, evidencias y referencias de manual entregadas en el contexto.
4) Propón pasos concretos, verificables y en secuencia (acción + verificación + criterio de resultado).
5) Si una hipótesis falla, descártala explícitamente y propone la siguiente solución con fundamento técnico.
6) Si detectas necesidad de refacción, solicita confirmación para generar pedido y cerrar chat técnico.
7) Si el técnico rechaza generar refacción, pregunta si desea continuar buscando alternativas sin refacción.
8) Cuando se solicite reporte, entrega campos completos de resolución de OT.
9) Si hay documentos técnicos/manuales disponibles, no uses lenguaje probabilístico ("comúnmente", "usualmente", "generalmente", "normalmente", "típicamente", "aprox.").
10) Para valores técnicos (voltaje, corriente, frecuencia, torque, presión, temperatura, tolerancias), responde con dato específico del manual/documento técnico y unidad.
11) Si el valor exacto no está en los documentos disponibles, dilo explícitamente: "No encontré el valor exacto en el manual/documento técnico cargado." y solicita validar en placa de datos o evidencia adicional.
12) No inventes nombres propios. Solo usa nombre de persona si viene explícito en contexto y coincide con la OT; de lo contrario usa "técnico".
13) Mantén tono estrictamente formal y profesional. No uses frases de ánimo o felicitación (por ejemplo: "gran trabajo", "excelente diagnóstico", "muy bien", "felicidades").`,
                    },
                ],
            },
        });
        this.reportModel = this.vertexAI.preview.getGenerativeModel({
            model: WORK_ORDER_REPORT_MODEL_ID,
        });
    }
    ensureChatModel() {
        if (!this.chatModel) {
            throw new common_1.BadRequestException('Vertex AI chat model is not configured.');
        }
        return this.chatModel;
    }
    ensureReportModel() {
        if (!this.reportModel) {
            throw new common_1.BadRequestException('Vertex AI report model is not configured.');
        }
        return this.reportModel;
    }
    async generateContentWithRetry(model, request) {
        return (0, vertex_retry_1.withVertexRetry)(() => model.generateContent(request), {
            operationName: 'WorkOrderAiService.generateContent',
            onRetry: ({ attempt, nextAttempt, maxAttempts, delayMs, statusCode, errorMessage, }) => {
                console.warn(`[WorkOrderAI] Vertex retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                    `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`);
            },
        });
    }
    async generateContentStreamWithRetry(model, request) {
        return (0, vertex_retry_1.withVertexRetry)(() => model.generateContentStream(request), {
            operationName: 'WorkOrderAiService.generateContentStream',
            onRetry: ({ attempt, nextAttempt, maxAttempts, delayMs, statusCode, errorMessage, }) => {
                console.warn(`[WorkOrderAI] Vertex stream retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                    `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`);
            },
        });
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
    normalizeStringArray(value, max = 8) {
        if (!Array.isArray(value))
            return [];
        const deduped = [];
        const seen = new Set();
        for (const raw of value) {
            const item = String(raw || '').trim();
            if (!item)
                continue;
            const key = this.normalizeLooseTextKey(item);
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            deduped.push(item);
            if (deduped.length >= max)
                break;
        }
        return deduped;
    }
    normalizeLooseTextKey(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }
    sanitizeAssistantAddressing(message, context) {
        const text = String(message || '').trim();
        if (!text)
            return '';
        const allowedNameTokens = new Set(String(context?.detectorName || '')
            .split(/\s+/)
            .map((token) => this.normalizeLooseTextKey(token))
            .filter((token) => token.length >= 3));
        return text.replace(/(^|\n)(\s*)(Enterado|Entendido|Perfecto|Correcto|Gracias|De acuerdo),\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\b[.,:]?\s*/gi, (fullMatch, linePrefix, leadingSpaces, intro, name) => {
            const normalizedName = this.normalizeLooseTextKey(name);
            if (normalizedName && allowedNameTokens.has(normalizedName)) {
                return fullMatch;
            }
            return `${linePrefix}${leadingSpaces}${intro}. `;
        });
    }
    enforceManualGroundingLanguage(message, manualSources) {
        const text = String(message || '').trim();
        if (!text)
            return '';
        const hasManualSources = (manualSources || []).some((item) => String(item?.document || '').trim().length > 0);
        if (!hasManualSources)
            return text;
        let normalized = text
            .replace(/(para este tipo de m[aá]quina,\s*)?(com[uú]nmente|usualmente|generalmente|normalmente|t[ií]picamente)\s+(es|son)\b/gi, 'de acuerdo al manual/documento técnico, $3')
            .replace(/\b(en general|por lo regular|habitualmente)\b/gi, 'de acuerdo al manual/documento técnico');
        const stillSpeculative = /\b(com[uú]nmente|usualmente|generalmente|normalmente|t[ií]picamente|aprox(?:imadamente)?|en general|por lo regular|habitualmente)\b/i.test(normalized);
        if (stillSpeculative) {
            normalized = `${normalized}\n\nNo encontré el valor exacto en el manual/documento técnico cargado.`;
        }
        return normalized.trim();
    }
    enforceFormalAssistantTone(message) {
        const raw = String(message || '').trim();
        if (!raw)
            return '';
        let text = raw;
        text = text.replace(/(^|\n)\s*(entendido|perfecto|excelente|muy bien|buen trabajo|gran trabajo|felicidades|felicitaciones|de acuerdo|correcto)[^.\n!?]*[.!?]?\s*/gi, '$1');
        text = text.replace(/\b(tus hallazgos son [^.\n!?]*[.!?])/gi, '');
        text = text.replace(/\bexcelente diagn[oó]stico[^.\n!?]*[.!?]/gi, '');
        text = text.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        return text || 'Se requiere más información técnica para continuar.';
    }
    normalizeCauseProcedurePairs(value, fallbackCauses, fallbackProcedures) {
        const fromPairs = Array.isArray(value)
            ? value
                .map((item) => ({
                cause: String(item?.cause || '').trim(),
                procedure: String(item?.procedure || '').trim(),
            }))
                .filter((item) => item.cause && item.procedure)
            : [];
        const basePairs = fromPairs.length > 0
            ? fromPairs
            : Array.from({ length: Math.min(fallbackCauses.length, fallbackProcedures.length) }, (_, index) => ({
                cause: fallbackCauses[index],
                procedure: fallbackProcedures[index],
            }));
        const deduped = [];
        const seenPairs = new Set();
        const seenProcedures = new Set();
        for (const pair of basePairs) {
            const pairKey = `${this.normalizeLooseTextKey(pair.cause)}::${this.normalizeLooseTextKey(pair.procedure)}`;
            if (!pairKey || seenPairs.has(pairKey))
                continue;
            const procedureKey = this.normalizeLooseTextKey(pair.procedure);
            if (!procedureKey || seenProcedures.has(procedureKey))
                continue;
            seenPairs.add(pairKey);
            seenProcedures.add(procedureKey);
            deduped.push(pair);
            if (deduped.length >= 6)
                break;
        }
        if (deduped.length > 0)
            return deduped;
        return [
            {
                cause: fallbackCauses[0] ||
                    'Causa probable no determinada: requiere validación técnica dirigida.',
                procedure: fallbackProcedures[0] ||
                    'Ejecutar verificación dirigida en campo para confirmar/descartar la hipótesis.',
            },
        ];
    }
    normalizeSourceCitations(value, manualSources) {
        const allowedManualSources = (manualSources || [])
            .map((item) => ({
            document: String(item?.document || '').trim(),
            pages: String(item?.pages || '').trim() || 'N/D',
        }))
            .filter((item) => item.document.length > 0);
        if (allowedManualSources.length === 0) {
            return [];
        }
        const resolveManualDocument = (candidate) => {
            const normalizedCandidate = this.normalizeCitationDocumentKey(candidate);
            if (!normalizedCandidate)
                return null;
            return (allowedManualSources.find((item) => this.normalizeCitationDocumentKey(item.document) === normalizedCandidate) || null);
        };
        const parsed = Array.isArray(value)
            ? value
                .map((item) => {
                const rawDocument = String(item?.document || '').trim();
                const resolvedManual = resolveManualDocument(rawDocument);
                if (!resolvedManual)
                    return null;
                return {
                    document: resolvedManual.document,
                    pages: String(item?.pages || '').trim() ||
                        resolvedManual.pages ||
                        'N/D',
                };
            })
                .filter((item) => Boolean(item && item.document))
            : [];
        const fallback = parsed.length > 0
            ? parsed
            : allowedManualSources.map((item) => ({
                document: item.document,
                pages: item.pages || 'N/D',
            }));
        const deduped = [];
        const seen = new Set();
        for (const citation of fallback) {
            const key = `${citation.document.toLowerCase()}::${(citation.pages || '').toLowerCase()}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            deduped.push({
                document: citation.document,
                pages: citation.pages || 'N/D',
            });
            if (deduped.length >= 6)
                break;
        }
        return deduped;
    }
    normalizeSuggestedPartDetails(value, fallbackDescriptions) {
        const allowedUrgency = new Set(['immediate', 'scheduled', 'monitor']);
        const clean = (input) => String(input || '').trim();
        const parsed = Array.isArray(value)
            ? value
                .map((item) => {
                const description = clean(item?.description) ||
                    clean(item?.partNumber) ||
                    clean(item?.model) ||
                    clean(item?.vendor);
                if (!description)
                    return null;
                const urgencyRaw = clean(item?.urgency).toLowerCase();
                const urgency = allowedUrgency.has(urgencyRaw)
                    ? urgencyRaw
                    : 'scheduled';
                const detail = { description, urgency };
                const partNumber = clean(item?.partNumber);
                const vendor = clean(item?.vendor);
                const model = clean(item?.model);
                const quantity = clean(item?.quantity);
                const sourceDocument = clean(item?.sourceDocument);
                if (partNumber)
                    detail.partNumber = partNumber;
                if (vendor)
                    detail.vendor = vendor;
                if (model)
                    detail.model = model;
                if (quantity)
                    detail.quantity = quantity;
                if (sourceDocument)
                    detail.sourceDocument = sourceDocument;
                return detail;
            })
                .filter((item) => Boolean(item))
            : [];
        const fallback = parsed.length > 0
            ? parsed
            : (fallbackDescriptions || [])
                .map((description) => ({
                description: String(description || '').trim(),
                urgency: 'scheduled',
            }))
                .filter((item) => item.description);
        const deduped = [];
        const seen = new Set();
        for (const item of fallback) {
            const key = this.normalizeLooseTextKey(item.description);
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            deduped.push(item);
            if (deduped.length >= 8)
                break;
        }
        return deduped;
    }
    normalizeMaintenanceRisk(value) {
        const allowedRisk = new Set(['critical', 'high', 'medium', 'low']);
        const allowedProbability = new Set(['likely', 'possible', 'watch']);
        const clean = (input) => String(input || '').trim();
        const parsed = Array.isArray(value)
            ? value
                .map((item) => {
                const component = clean(item?.component);
                const predictedIssue = clean(item?.predictedIssue);
                if (!component || !predictedIssue)
                    return null;
                const riskLevelRaw = clean(item?.riskLevel).toLowerCase();
                const riskLevel = allowedRisk.has(riskLevelRaw)
                    ? riskLevelRaw
                    : 'low';
                const probabilityRaw = clean(item?.probability).toLowerCase();
                const probability = allowedProbability.has(probabilityRaw)
                    ? probabilityRaw
                    : 'possible';
                return {
                    riskLevel,
                    component,
                    predictedIssue,
                    probability,
                    recommendedAction: clean(item?.recommendedAction) || 'N/A',
                    timeframe: clean(item?.timeframe) || 'N/A',
                    basedOn: clean(item?.basedOn) || 'N/A',
                };
            })
                .filter((item) => Boolean(item))
            : [];
        const deduped = [];
        const seen = new Set();
        for (const item of parsed) {
            const key = `${this.normalizeLooseTextKey(item.component)}::${this.normalizeLooseTextKey(item.predictedIssue)}`;
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            deduped.push(item);
            if (deduped.length >= 6)
                break;
        }
        const riskRank = {
            critical: 3,
            high: 2,
            medium: 1,
            low: 0,
        };
        return deduped.sort((a, b) => riskRank[b.riskLevel] - riskRank[a.riskLevel]);
    }
    normalizeCitationDocumentKey(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }
    mapRole(role) {
        return role === 'assistant' ? 'model' : 'user';
    }
    summarizeConversationContext(messages) {
        if (!messages.length)
            return null;
        const priorityPattern = /\b(resultado|medicion|lectura|causa|diagnostico|procedimiento|solucion|refaccion|riesgo|seguridad|loto|torque|temperatura|presion|volt|amp)\b/i;
        const selected = messages
            .map((message) => String(message?.content || '').trim())
            .filter((line) => line.length > 0)
            .filter((line) => priorityPattern.test(line))
            .slice(-6)
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .map((line) => (line.length > 180 ? `${line.slice(0, 177)}...` : line));
        const source = selected.length
            ? selected
            : messages
                .map((message) => String(message?.content || '').trim())
                .filter((line) => line.length > 0)
                .slice(-4)
                .map((line) => (line.length > 180 ? `${line.slice(0, 177)}...` : line));
        if (!source.length)
            return null;
        return source.map((line, index) => `${index + 1}. ${line}`).join('\n');
    }
    buildTechnicianChatHistory(threadHistory = [], context) {
        const maxMessages = TECHNICIAN_CHAT_HISTORY_WINDOW * 2;
        const olderMessages = threadHistory.slice(0, Math.max(0, threadHistory.length - maxMessages));
        const recentMessages = threadHistory.slice(-maxMessages);
        const summaryFromContext = String(context?.compressedConversationContext || '').trim();
        const summarizedOlderContext = summaryFromContext || this.summarizeConversationContext(olderMessages) || '';
        const seededHistory = [];
        const initialDiagnosis = [
            context?.failureDescription
                ? `Falla inicial: ${context.failureDescription}`
                : '',
            (context?.symptoms || []).length
                ? `Síntomas iniciales: ${(context?.symptoms || []).join(', ')}`
                : '',
        ]
            .filter(Boolean)
            .join('\n');
        if (initialDiagnosis) {
            seededHistory.push({
                role: 'user',
                parts: [{ text: `[Diagnóstico inicial OT]\n${initialDiagnosis}` }],
            });
        }
        if (context?.queryIntent) {
            seededHistory.push({
                role: 'user',
                parts: [{ text: `[Intento detectado]\n${context.queryIntent}` }],
            });
        }
        if (summarizedOlderContext) {
            seededHistory.push({
                role: 'user',
                parts: [{ text: `[Resumen de conversación previa]\n${summarizedOlderContext}` }],
            });
        }
        const recentHistory = recentMessages.map((item) => ({
            role: this.mapRole(item.role),
            parts: [{ text: item.content }],
        }));
        return [...seededHistory, ...recentHistory];
    }
    formatContext(context) {
        const c = context || {};
        const header = [
            `OT: ${c.otNumber || c.workOrderId || 'N/A'}`,
            `Planta/Proceso/Subproceso: ${c.plantName || 'N/A'} / ${c.processName || 'N/A'} / ${c.subprocessName || 'N/A'}`,
            `Máquina: ${c.machineCode || ''} ${c.machineName || 'N/A'}`.trim(),
            `Fecha reporte: ${c.reportDate || 'N/A'}`,
            `Detectó falla: ${c.detectorName || 'N/A'}`,
            `Turno: ${c.shift || 'N/A'} | Tipo solicitud: ${c.requestType || 'N/A'}`,
            `Estado máquina: ${c.machineStatus || 'N/A'} | Riesgo seguridad: ${c.safetyRisk || 'N/A'}`,
        ].join('\n');
        const problem = [
            `Descripción falla: ${c.failureDescription || 'N/A'}`,
            `Síntomas: ${(c.symptoms || []).join(', ') || 'N/A'}`,
            `Resultados troubleshooting operador: ${(c.troubleshootingResults || []).join(' | ') || 'N/A'}`,
            `Posibles causas: ${(c.possibleCauses || []).join(' | ') || 'N/A'}`,
        ].join('\n');
        const manualInsightsList = (c.manualInsights || [])
            .filter((i) => i?.trim())
            .slice(0, TECHNICIAN_CONTEXT_MAX_MANUAL_INSIGHTS);
        const manualSourcesList = (c.manualSources || [])
            .filter((s) => s?.document?.trim())
            .slice(0, TECHNICIAN_CONTEXT_MAX_MANUAL_SOURCES);
        const manualBlock = manualInsightsList.length > 0 || manualSourcesList.length > 0
            ? [
                '📘 REFERENCIAS DE MANUALES Y DOCUMENTOS TÉCNICOS:',
                ...manualSourcesList.map((s, i) => `  ${i + 1}. [${String(s.document).trim()}] Páginas: ${String(s.pages || 'N/D').trim()}${s.url ? ` | URL: ${s.url}` : ''}`),
                ...manualInsightsList.map((insight) => `  → ${insight.trim()}`),
            ].join('\n')
            : '📘 REFERENCIAS DE MANUALES: No hay documentos técnicos cargados para esta máquina.';
        const wiList = (c.workInstructions || [])
            .filter((wi) => wi?.title?.trim())
            .slice(0, TECHNICIAN_CONTEXT_MAX_WORK_INSTRUCTIONS);
        const wiBlock = wiList.length > 0
            ? [
                '📋 INSTRUCCIONES DE TRABAJO VINCULADAS:',
                ...wiList.map((wi, i) => {
                    const parts = [`  ${i + 1}. ${wi.title.trim()}`];
                    if (wi.relevance?.trim())
                        parts.push(`     Relevancia: ${wi.relevance.trim()}`);
                    if (wi.summary?.trim())
                        parts.push(`     Resumen: ${wi.summary.trim()}`);
                    if (Array.isArray(wi.steps) && wi.steps.length > 0) {
                        parts.push(`     Pasos detallados:`);
                        wi.steps.slice(0, 3).forEach((step, stepIdx) => {
                            const stepTitle = step.title ? `- ${step.title}` : `- Paso ${stepIdx + 1}`;
                            const stepDesc = step.description
                                ? `: ${this.truncateForPrompt(String(step.description), 160)}`
                                : '';
                            parts.push(`       ${stepTitle}${stepDesc}`);
                            if (Array.isArray(step.media) && step.media.length > 0) {
                                step.media.slice(0, 1).forEach((m) => {
                                    if (m.type === 'image' && m.url) {
                                        parts.push(`         (Referencia visual: ![Imagen Paso ${stepIdx + 1}](${m.url}))`);
                                    }
                                });
                            }
                        });
                    }
                    if (wi.expectedResult) {
                        const expected = wi.expectedResult;
                        if (expected.description)
                            parts.push(`     Resultado Esperado (Muestra Dorada): ${expected.description}`);
                        if (Array.isArray(expected.visualUrls) && expected.visualUrls.length > 0) {
                            expected.visualUrls.forEach((url, uIdx) => {
                                parts.push(`       (Referencia visual Muestra Dorada: ![Imagen Muestra Dorada](${url}))`);
                            });
                        }
                    }
                    return parts.join('\n');
                }),
            ].join('\n')
            : '📋 INSTRUCCIONES DE TRABAJO: Ninguna vinculada.';
        const woList = (c.similarWorkOrders || [])
            .filter((wo) => wo?.otNumber?.trim() || wo?.summary?.trim())
            .slice(0, TECHNICIAN_CONTEXT_MAX_WORK_ORDER_REFS);
        const woBlock = woList.length > 0
            ? [
                '🔧 OTs RESUELTAS SIMILARES (referencia de fixes anteriores):',
                ...woList.map((wo, i) => {
                    const parts = [`  ${i + 1}. [${wo.otNumber || wo.id}]`];
                    if (wo.summary?.trim()) {
                        parts.push(`     Diagnóstico/Solución: ${this.truncateForPrompt(wo.summary.trim(), 180)}`);
                    }
                    if (wo.relevance?.trim())
                        parts.push(`     Relevancia: ${wo.relevance.trim()}`);
                    return parts.join('\n');
                }),
            ].join('\n')
            : '🔧 OTs SIMILARES: No se encontraron OTs previas similares.';
        const techProgress = [
            `Pasos técnicos previos: ${(c.previousTechnicianSteps || []).join(' | ') || 'N/A'}`,
            `Procedimiento técnico activo: ${c.currentSelectedProcedure || 'N/A'}`,
            `Fase activa: ${c.workflowStage || 'N/A'}`,
            `Intención detectada: ${c.queryIntent || 'N/A'}`,
            `Resumen conversación previa: ${this.truncateForPrompt(c.compressedConversationContext || 'N/A', 220)}`,
        ].join('\n');
        const referenceDictionary = String(c.referenceDictionary || '').trim();
        const dictBlock = referenceDictionary && referenceDictionary !== 'N/A'
            ? `📖 DICCIONARIO DE REFERENCIAS CRUZADAS:\n${this.truncateForPrompt(referenceDictionary, 700)}`
            : '';
        return [
            header,
            '',
            problem,
            '',
            manualBlock,
            '',
            wiBlock,
            '',
            woBlock,
            '',
            techProgress,
            dictBlock ? `\n${dictBlock}` : '',
        ].filter((line) => line !== undefined).join('\n');
    }
    truncateForPrompt(value, maxChars = 180) {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
        if (!normalized)
            return '';
        if (normalized.length <= maxChars)
            return normalized;
        return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
    }
    getTechnicianChatJsonSchema() {
        return `{
  "assistantMessage": "string",
  "nextSolutions": ["string"],
  "likelyCauses": ["string"],
  "causeProcedurePairs": [{"cause":"string","procedure":"string"}],
  "toolsAndMaterials": ["string"],
  "sourceCitations": [{"document":"string","pages":"string"}],
  "recommendedThread": "applied_procedure|output|evidence",
  "detectedOutcome": "good|bad|unknown",
  "suggestedOutput": "string",
  "partsRequiredDetected": true,
  "partsRequiredReason": "string",
  "suggestedParts": ["string"],
  "suggestedPartDetails": [
    {
      "description": "string",
      "partNumber": "string",
      "vendor": "string",
      "model": "string",
      "quantity": "string",
      "urgency": "immediate|scheduled|monitor",
      "sourceDocument": "string"
    }
  ],
  "shouldAskToGeneratePieceOrder": true,
  "shouldAskToContinueAfterDecline": false,
  "confidenceLevel": "high|medium|low"
}`;
    }
    buildTechnicianChatPrompt(params) {
        return `Contexto integral de la OT:
${this.formatContext(params.context)}

Entrada del técnico:
- Hilo: ${params.threadType}
- Fase UI: ${params.workflowStage}
- Solución seleccionada: ${params.selectedSolution || 'N/A'}
- Procedimiento aplicado: ${params.appliedProcedure || 'N/A'}
- Resultado / salida observada: ${params.output || 'N/A'}
- Evidencia: ${params.evidence || 'N/A'}
- Override activo: ${params.overrideMode ? 'Sí' : 'No'}
- Decisión refacciones: ${params.partsDecision}

Reglas de flujo adicionales (el resto ya está en systemInstruction):
1) Si no hay solución/procedimiento concreto, propone 3-5 procedimientos en nextSolutions.
2) Si no hay salida observada, guía ejecución segura por pasos y usa recommendedThread="output" cuando toque capturar resultado.
3) Si hay salida observada, clasifica detectedOutcome en good|bad|unknown.
4) Mantén relación causa-procedimiento: cada causa con al menos un procedimiento asociado.
5) Si detectas necesidad de refacción: partsRequiredDetected=true, partsRequiredReason, suggestedParts/suggestedPartDetails y shouldAskToGeneratePieceOrder=true.
6) Si partsDecision="decline_generate_keep_search": shouldAskToContinueAfterDecline=true y propone alternativas no repetidas.
7) Si faltan valores exactos en manuales, escribe literalmente: "No encontré el valor exacto en el manual/documento técnico cargado."
8) sourceCitations solo con documentos técnicos disponibles; si no hay, devuelve [].
9) No inventes nombres propios y mantén tono formal técnico.
10) confidenceLevel es obligatorio (high|medium|low).

Devuelve SOLO JSON válido con esta estructura exacta:
${this.getTechnicianChatJsonSchema()}`;
    }
    async chat(payload, user, organizationId) {
        const model = this.ensureChatModel();
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const message = payload.message || {};
        const appliedProcedure = String(message.appliedProcedure || '').trim();
        const output = String(message.output || '').trim();
        const evidence = String(message.evidence || '').trim();
        const selectedSolution = String(message.selectedSolution || '').trim();
        const threadType = message.threadType || 'applied_procedure';
        const workflowStage = message.workflowStage ||
            payload.context?.workflowStage ||
            (threadType === 'output' ? 'output' : 'procedure');
        const partsDecision = message.partsDecision || 'none';
        if (!appliedProcedure &&
            !output &&
            !evidence &&
            !selectedSolution &&
            partsDecision === 'none') {
            throw new common_1.BadRequestException('At least one of appliedProcedure, output, evidence or selectedSolution is required.');
        }
        const history = this.buildTechnicianChatHistory(payload.threadHistory || [], payload.context);
        const prompt = this.buildTechnicianChatPrompt({
            threadType,
            workflowStage,
            selectedSolution,
            appliedProcedure,
            output,
            evidence,
            overrideMode: message.overrideMode,
            partsDecision,
            context: payload.context,
        });
        try {
            const chat = model.startChat({ history });
            const result = await chat.sendMessage([{ text: prompt }]);
            const response = await result.response;
            const rawText = response.candidates?.[0]?.content?.parts
                ?.map((part) => part?.text || '')
                .join('\n')
                .trim() || '';
            const parsed = this.extractJsonObject(rawText);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            const recommendedThreadRaw = String(parsed?.recommendedThread || '').trim();
            const recommendedThread = recommendedThreadRaw === 'output'
                ? 'output'
                : recommendedThreadRaw === 'evidence'
                    ? 'evidence'
                    : 'applied_procedure';
            const detectedOutcomeRaw = String(parsed?.detectedOutcome || '')
                .trim()
                .toLowerCase();
            const detectedOutcome = detectedOutcomeRaw === 'good'
                ? 'good'
                : detectedOutcomeRaw === 'bad'
                    ? 'bad'
                    : 'unknown';
            const suggestedOutput = String(parsed?.suggestedOutput || '').trim();
            const normalizedLikelyCauses = this.normalizeStringArray(parsed?.likelyCauses, 6);
            const normalizedNextSolutions = this.normalizeStringArray(parsed?.nextSolutions, 6);
            const causeProcedurePairs = this.normalizeCauseProcedurePairs(parsed?.causeProcedurePairs, normalizedLikelyCauses, normalizedNextSolutions);
            const likelyCauses = causeProcedurePairs.map((pair) => pair.cause);
            const nextSolutions = causeProcedurePairs.map((pair) => pair.procedure);
            const partsRequiredReason = String(parsed?.partsRequiredReason || '').trim();
            const suggestedParts = this.normalizeStringArray(parsed?.suggestedParts, 8);
            const suggestedPartDetails = this.normalizeSuggestedPartDetails(parsed?.suggestedPartDetails, suggestedParts);
            const manualSources = (payload.context?.manualSources || []).map((source) => ({
                document: String(source?.document || '').trim(),
                pages: String(source?.pages || '').trim() || 'N/D',
            })) || [];
            const sourceCitations = this.normalizeSourceCitations(parsed?.sourceCitations, manualSources);
            const inferredPartsRequired = Boolean(parsed?.partsRequiredDetected) ||
                suggestedParts.length > 0 ||
                suggestedPartDetails.length > 0 ||
                /refacci|reemplaz|spare|partes?/i.test(partsRequiredReason);
            const shouldAskToGeneratePieceOrder = Boolean(parsed?.shouldAskToGeneratePieceOrder) || inferredPartsRequired;
            const shouldAskToContinueAfterDecline = Boolean(parsed?.shouldAskToContinueAfterDecline);
            const assistantMessage = this.enforceFormalAssistantTone(this.enforceManualGroundingLanguage(this.sanitizeAssistantAddressing(String(parsed?.assistantMessage || '').trim() ||
                'Analicé el caso. Comparte el resultado medible del paso aplicado para continuar.', payload.context), manualSources));
            return {
                assistantMessage,
                nextSolutions,
                likelyCauses,
                causeProcedurePairs,
                toolsAndMaterials: this.normalizeStringArray(parsed?.toolsAndMaterials, 8),
                recommendedThread,
                detectedOutcome,
                suggestedOutput,
                partsRequiredDetected: inferredPartsRequired,
                partsRequiredReason,
                suggestedParts,
                suggestedPartDetails,
                shouldAskToGeneratePieceOrder,
                shouldAskToContinueAfterDecline,
                sourceCitations,
                confidenceLevel: (['high', 'medium', 'low'].includes(parsed?.confidenceLevel) ? parsed.confidenceLevel : 'medium'),
            };
        }
        catch (error) {
            throw new common_1.InternalServerErrorException(`Work order technician chat failed: ${error?.message || error}`);
        }
    }
    async chatStream(payload, user, organizationId, onChunk) {
        const model = this.ensureChatModel();
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const message = payload.message || {};
        const appliedProcedure = String(message.appliedProcedure || '').trim();
        const output = String(message.output || '').trim();
        const evidence = String(message.evidence || '').trim();
        const selectedSolution = String(message.selectedSolution || '').trim();
        const threadType = message.threadType || 'applied_procedure';
        const workflowStage = message.workflowStage ||
            payload.context?.workflowStage ||
            (threadType === 'output' ? 'output' : 'procedure');
        const partsDecision = message.partsDecision || 'none';
        if (!appliedProcedure &&
            !output &&
            !evidence &&
            !selectedSolution &&
            partsDecision === 'none') {
            throw new common_1.BadRequestException('At least one of appliedProcedure, output, evidence or selectedSolution is required.');
        }
        const history = this.buildTechnicianChatHistory(payload.threadHistory || [], payload.context);
        const prompt = this.buildTechnicianChatPrompt({
            threadType,
            workflowStage,
            selectedSolution,
            appliedProcedure,
            output,
            evidence,
            overrideMode: message.overrideMode,
            partsDecision,
            context: payload.context,
        });
        try {
            const result = await this.generateContentStreamWithRetry(model, {
                contents: [
                    ...history,
                    { role: 'user', parts: [{ text: prompt }] },
                ],
            });
            let fullText = '';
            for await (const chunk of result.stream) {
                const chunkText = chunk.candidates?.[0]?.content?.parts
                    ?.map((part) => part?.text || '')
                    .join('') || '';
                if (chunkText && onChunk) {
                    onChunk(chunkText);
                }
                fullText += chunkText;
            }
            const response = await result.response;
            const parsed = this.extractJsonObject(fullText);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            const recommendedThreadRaw = String(parsed?.recommendedThread || '').trim();
            const recommendedThread = recommendedThreadRaw === 'output'
                ? 'output'
                : recommendedThreadRaw === 'evidence'
                    ? 'evidence'
                    : 'applied_procedure';
            const detectedOutcomeRaw = String(parsed?.detectedOutcome || '')
                .trim()
                .toLowerCase();
            const detectedOutcome = detectedOutcomeRaw === 'good'
                ? 'good'
                : detectedOutcomeRaw === 'bad'
                    ? 'bad'
                    : 'unknown';
            const suggestedOutput = String(parsed?.suggestedOutput || '').trim();
            const normalizedLikelyCauses = this.normalizeStringArray(parsed?.likelyCauses, 6);
            const normalizedNextSolutions = this.normalizeStringArray(parsed?.nextSolutions, 6);
            const causeProcedurePairs = this.normalizeCauseProcedurePairs(parsed?.causeProcedurePairs, normalizedLikelyCauses, normalizedNextSolutions);
            const likelyCauses = causeProcedurePairs.map((pair) => pair.cause);
            const nextSolutions = causeProcedurePairs.map((pair) => pair.procedure);
            const partsRequiredReason = String(parsed?.partsRequiredReason || '').trim();
            const suggestedParts = this.normalizeStringArray(parsed?.suggestedParts, 8);
            const suggestedPartDetails = this.normalizeSuggestedPartDetails(parsed?.suggestedPartDetails, suggestedParts);
            const manualSources = (payload.context?.manualSources || []).map((source) => ({
                document: String(source?.document || '').trim(),
                pages: String(source?.pages || '').trim() || 'N/D',
            })) || [];
            const sourceCitations = this.normalizeSourceCitations(parsed?.sourceCitations, manualSources);
            const inferredPartsRequired = Boolean(parsed?.partsRequiredDetected) ||
                suggestedParts.length > 0 ||
                suggestedPartDetails.length > 0 ||
                /refacci|reemplaz|spare|partes?/i.test(partsRequiredReason);
            const shouldAskToGeneratePieceOrder = Boolean(parsed?.shouldAskToGeneratePieceOrder) || inferredPartsRequired;
            const shouldAskToContinueAfterDecline = Boolean(parsed?.shouldAskToContinueAfterDecline);
            const assistantMessage = this.enforceFormalAssistantTone(this.enforceManualGroundingLanguage(this.sanitizeAssistantAddressing(String(parsed?.assistantMessage || '').trim() ||
                'Analicé el caso. Comparte el resultado medible del paso aplicado para continuar.', payload.context), manualSources));
            return {
                assistantMessage,
                nextSolutions,
                likelyCauses,
                causeProcedurePairs,
                toolsAndMaterials: this.normalizeStringArray(parsed?.toolsAndMaterials, 8),
                recommendedThread,
                detectedOutcome,
                suggestedOutput,
                partsRequiredDetected: inferredPartsRequired,
                partsRequiredReason,
                suggestedParts,
                suggestedPartDetails,
                shouldAskToGeneratePieceOrder,
                shouldAskToContinueAfterDecline,
                sourceCitations,
                confidenceLevel: (['high', 'medium', 'low'].includes(parsed?.confidenceLevel) ? parsed.confidenceLevel : 'medium'),
            };
        }
        catch (error) {
            throw new common_1.InternalServerErrorException(`Work order technician chat stream failed: ${error?.message || error}`);
        }
    }
    async analyzeImage(payload, user, organizationId) {
        const model = this.ensureChatModel();
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const imageBase64 = String(payload?.imageBase64 || '')
            .trim()
            .replace(/^data:[^;]+;base64,/, '')
            .replace(/\s+/g, '');
        const imageMimeType = String(payload?.imageMimeType || '').trim().toLowerCase();
        const technicianQuestion = String(payload?.technicianQuestion || '').trim();
        const selectedProcedure = String(payload?.selectedProcedure || '').trim();
        if (!imageBase64) {
            throw new common_1.BadRequestException('imageBase64 is required.');
        }
        if (!imageMimeType.startsWith('image/')) {
            throw new common_1.BadRequestException('imageMimeType must be image/*.');
        }
        const historyText = this.buildTechnicianChatHistory(payload.threadHistory || [], payload.context)
            .map((item) => {
            const text = item.parts
                ?.map((part) => String(part?.text || '').trim())
                .filter((part) => part.length > 0)
                .join(' ') || '';
            return `${item.role === 'model' ? 'IA' : 'Técnico'}: ${text}`;
        })
            .join('\n');
        const prompt = `Analiza la imagen adjunta dentro del contexto de esta OT y responde como copiloto técnico.

Contexto integral de la OT:
${this.formatContext(payload.context)}

Contexto conversacional reciente:
${historyText || 'N/A'}

Entrada adicional del técnico:
- Procedimiento técnico activo: ${selectedProcedure || payload.context?.currentSelectedProcedure || 'N/A'}
- Consulta específica: ${technicianQuestion || 'Evaluar si la ejecución visible es correcta, qué está mal y siguiente paso seguro.'}

Objetivo:
1) Evaluar si lo observado en la imagen es consistente con una ejecución correcta del procedimiento.
2) Señalar riesgos, desvíos o indicios de falla visibles.
3) Indicar siguiente paso técnico verificable y seguro.

Reglas de salida:
1) Si la imagen sugiere condición correcta/estable, detectedOutcome="good".
2) Si la imagen sugiere anomalía, daño, riesgo o resultado no esperado, detectedOutcome="bad".
3) Si la imagen no permite concluir por falta de evidencia visual, detectedOutcome="unknown" y pide evidencia puntual.
4) Usa nextSolutions para pasos siguientes concretos y medibles (3-5).
5) En suggestedOutput redacta una salida breve reutilizable para la OT.
6) Completa toolsAndMaterials si aplica para validar/corregir.
7) Si reportas valores/especificaciones técnicas, exprésalos como:
   "De acuerdo al manual/documento técnico: [parámetro] = [valor] [unidad]".
8) No uses lenguaje probabilístico: "comúnmente", "usualmente", "generalmente", "normalmente", "típicamente", "aprox.".
9) Si el valor exacto no es visible o no está en documentos, escribe literalmente:
   "No encontré el valor exacto en el manual/documento técnico cargado."
10) sourceCitations SOLO puede citar documentos del campo "Documentos técnicos disponibles".
11) NO cites "IA", "contexto OT", "manualInsights" ni texto generado.
12) Si no hay documentos técnicos disponibles, devuelve sourceCitations como [].
13) recommendedThread debe ser:
   - "output" cuando solicites registrar resultado medible,
   - "applied_procedure" cuando propongas ejecutar un nuevo paso,
   - "evidence" cuando pidas evidencia adicional específica.
14) No inventes nombres propios. Solo menciona un nombre si viene explícito en el contexto de la OT.
15) confidenceLevel es OBLIGATORIO:
   - "high": respaldado por documento técnico cargado.
   - "medium": basado en contexto del problema sin referencia documental exacta.
   - "low": conocimiento general sin respaldo documental.
   Si es "low", agrega en assistantMessage: "⚠️ Verificar en manual o con ingeniería antes de proceder."
16) Mantén tono estrictamente formal y técnico. Prohibido usar frases de felicitación o ánimo (por ejemplo: "gran trabajo", "excelente diagnóstico", "muy bien", "felicidades").

Devuelve SOLO JSON válido con esta estructura:
{
  "assistantMessage": "string",
  "nextSolutions": ["string"],
  "likelyCauses": ["string"],
  "causeProcedurePairs": [{"cause":"string","procedure":"string"}],
  "toolsAndMaterials": ["string"],
  "sourceCitations": [{"document":"string","pages":"string"}],
  "recommendedThread": "applied_procedure|output|evidence",
  "detectedOutcome": "good|bad|unknown",
  "suggestedOutput": "string",
  "partsRequiredDetected": false,
  "partsRequiredReason": "string",
  "suggestedParts": ["string"],
  "suggestedPartDetails": [
    {
      "description": "string",
      "partNumber": "string",
      "vendor": "string",
      "model": "string",
      "quantity": "string",
      "urgency": "immediate|scheduled|monitor",
      "sourceDocument": "string"
    }
  ],
  "shouldAskToGeneratePieceOrder": false,
  "shouldAskToContinueAfterDecline": false,
  "confidenceLevel": "high|medium|low"
}`;
        try {
            const result = await this.generateContentWithRetry(model, {
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: imageMimeType,
                                    data: imageBase64,
                                },
                            },
                        ],
                    },
                ],
            });
            const response = await result.response;
            const rawText = response.candidates?.[0]?.content?.parts
                ?.map((part) => part?.text || '')
                .join('\n')
                .trim() || '';
            const parsed = this.extractJsonObject(rawText);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            const recommendedThreadRaw = String(parsed?.recommendedThread || '').trim();
            const recommendedThread = recommendedThreadRaw === 'output'
                ? 'output'
                : recommendedThreadRaw === 'evidence'
                    ? 'evidence'
                    : 'applied_procedure';
            const detectedOutcomeRaw = String(parsed?.detectedOutcome || '')
                .trim()
                .toLowerCase();
            const detectedOutcome = detectedOutcomeRaw === 'good'
                ? 'good'
                : detectedOutcomeRaw === 'bad'
                    ? 'bad'
                    : 'unknown';
            const normalizedLikelyCauses = this.normalizeStringArray(parsed?.likelyCauses, 6);
            const normalizedNextSolutions = this.normalizeStringArray(parsed?.nextSolutions, 6);
            const causeProcedurePairs = this.normalizeCauseProcedurePairs(parsed?.causeProcedurePairs, normalizedLikelyCauses, normalizedNextSolutions);
            const likelyCauses = causeProcedurePairs.map((pair) => pair.cause);
            const nextSolutions = causeProcedurePairs.map((pair) => pair.procedure);
            const partsRequiredReason = String(parsed?.partsRequiredReason || '').trim();
            const suggestedParts = this.normalizeStringArray(parsed?.suggestedParts, 8);
            const suggestedPartDetails = this.normalizeSuggestedPartDetails(parsed?.suggestedPartDetails, suggestedParts);
            const manualSources = (payload.context?.manualSources || []).map((source) => ({
                document: String(source?.document || '').trim(),
                pages: String(source?.pages || '').trim() || 'N/D',
            })) || [];
            const sourceCitations = this.normalizeSourceCitations(parsed?.sourceCitations, manualSources);
            const inferredPartsRequired = Boolean(parsed?.partsRequiredDetected) ||
                suggestedParts.length > 0 ||
                suggestedPartDetails.length > 0 ||
                /refacci|reemplaz|spare|partes?/i.test(partsRequiredReason);
            const shouldAskToGeneratePieceOrder = Boolean(parsed?.shouldAskToGeneratePieceOrder) || inferredPartsRequired;
            const assistantMessage = this.enforceFormalAssistantTone(this.enforceManualGroundingLanguage(this.sanitizeAssistantAddressing(String(parsed?.assistantMessage || '').trim() ||
                'Imagen analizada. Comparte una medición adicional o salida observada para confirmar el diagnóstico.', payload.context), manualSources));
            return {
                assistantMessage,
                nextSolutions,
                likelyCauses,
                causeProcedurePairs,
                toolsAndMaterials: this.normalizeStringArray(parsed?.toolsAndMaterials, 8),
                recommendedThread,
                detectedOutcome,
                suggestedOutput: String(parsed?.suggestedOutput || '').trim(),
                partsRequiredDetected: inferredPartsRequired,
                partsRequiredReason,
                suggestedParts,
                suggestedPartDetails,
                shouldAskToGeneratePieceOrder,
                shouldAskToContinueAfterDecline: Boolean(parsed?.shouldAskToContinueAfterDecline),
                sourceCitations,
                confidenceLevel: (['high', 'medium', 'low'].includes(parsed?.confidenceLevel) ? parsed.confidenceLevel : 'medium'),
            };
        }
        catch (error) {
            throw new common_1.InternalServerErrorException(`Work order technician image check failed: ${error?.message || error}`);
        }
    }
    async generateReport(payload, user, organizationId) {
        const model = this.ensureReportModel();
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const threads = payload.threads || {};
        const flattenThread = (messages) => (messages || [])
            .map((msg) => `${msg.role === 'assistant' ? 'IA' : 'Técnico'}: ${msg.content}`)
            .join('\n');
        const prompt = `Genera un reporte técnico final para OT basado en estas conversaciones.

Contexto OT:
${this.formatContext(payload.context)}

Conversación - Procedimiento aplicado:
${flattenThread(threads.appliedProcedure)}

Conversación - Resultados/salidas:
${flattenThread(threads.output)}

Conversación - Evidencias:
${flattenThread(threads.evidence)}

Observaciones adicionales técnico:
${payload.technicianObservations || 'N/A'}

Solución que funcionó:
${payload.workingSolution || 'N/A'}

¿Se requieren refacciones?
${payload.needsParts ? 'Sí' : 'No'}

Inteligencia de mantenimiento predictivo:
- Analiza la conversación completa (procedimiento, salidas, evidencias).
- Cruza síntomas con OTs similares listadas en el contexto.
- Identifica síntomas secundarios o patrones que indiquen riesgo futuro.
- Devuelve maintenanceRisk[] ordenado de mayor riesgo a menor. Si no hay riesgos, devuelve [].

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "summary": "string",
  "recommendation": "close|hold_for_parts",
  "requiredParts": ["string"],
  "reportText": "string",
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
  },
  "feedbackLearnings": [
    {
      "procedure": "string (nombre técnico del paso o acción intentada)",
      "outcome": "good|bad",
      "rationale": "string (justificación breve de por qué funcionó o falló según la conversación)"
    }
  ],
  "maintenanceRisk": [
    {
      "riskLevel": "critical|high|medium|low",
      "component": "string",
      "predictedIssue": "string",
      "probability": "likely|possible|watch",
      "recommendedAction": "string",
      "timeframe": "string",
      "basedOn": "string"
    }
  ]
}`;
        try {
            const result = await this.generateContentWithRetry(model, {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            const response = await result.response;
            const rawText = response.candidates?.[0]?.content?.parts
                ?.map((part) => part?.text || '')
                .join('\n')
                .trim() || '';
            const parsed = this.extractJsonObject(rawText);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            const recommendation = String(parsed?.recommendation || '').trim() === 'hold_for_parts'
                ? 'hold_for_parts'
                : payload.needsParts
                    ? 'hold_for_parts'
                    : 'close';
            const report = parsed?.technicalReport || {};
            const supplies = Array.isArray(report?.supplies)
                ? report.supplies
                    .map((item) => ({
                    description: String(item?.description || '').trim(),
                    quantity: String(item?.quantity || '').trim() || '1',
                }))
                    .filter((item) => item.description.length > 0)
                    .slice(0, 12)
                : [];
            const technicalReport = {
                inspections: String(report?.inspections || '').trim(),
                measurements: String(report?.measurements || '').trim(),
                observations: String(report?.observations || '').trim(),
                diagnosis: String(report?.diagnosis || '').trim(),
                rootCause: String(report?.rootCause || '').trim(),
                actions: this.normalizeStringArray(report?.actions, 10),
                otherActionDetail: String(report?.otherActionDetail || '').trim(),
                supplies: supplies.map((s) => ({
                    description: String(s?.description || '').trim(),
                    quantity: String(s?.quantity || '').trim(),
                })),
                preventiveMeasures: String(report?.preventiveMeasures || '').trim(),
            };
            const parsedLearnings = Array.isArray(parsed?.feedbackLearnings)
                ? parsed.feedbackLearnings
                : [];
            const feedbackLearnings = parsedLearnings.map((item) => ({
                procedure: String(item?.procedure || '').trim(),
                outcome: String(item?.outcome || '') === 'good' ? 'good' : 'bad',
                rationale: String(item?.rationale || '').trim(),
            })).filter((item) => item.procedure && item.rationale);
            const maintenanceRisk = this.normalizeMaintenanceRisk(parsed?.maintenanceRisk);
            return {
                summary: String(parsed?.summary || '').trim() || 'Reporte técnico generado automáticamente con base en la conversación.',
                recommendation,
                requiredParts: this.normalizeStringArray(parsed?.requiredParts, 10),
                reportText: String(parsed?.reportText || '').trim(),
                technicalReport,
                feedbackLearnings,
                maintenanceRisk,
            };
        }
        catch (error) {
            throw new common_1.InternalServerErrorException(`Work order technician report failed: ${error?.message || error}`);
        }
    }
    async generateReportStream(payload, user, organizationId, onChunk) {
        const model = this.ensureReportModel();
        await this.aiUsageService.ensureNotBlocked(user?.sub, organizationId);
        const threads = payload.threads || {};
        const flattenThread = (messages) => (messages || [])
            .map((msg) => `${msg.role === 'assistant' ? 'IA' : 'Técnico'}: ${msg.content}`)
            .join('\n');
        const prompt = `Genera un reporte técnico final para OT basado en estas conversaciones.

Contexto OT:
${this.formatContext(payload.context)}

Conversación - Procedimiento aplicado:
${flattenThread(threads.appliedProcedure)}

Conversación - Resultados/salidas:
${flattenThread(threads.output)}

Conversación - Evidencias:
${flattenThread(threads.evidence)}

Observaciones adicionales técnico:
${payload.technicianObservations || 'N/A'}

Solución que funcionó:
${payload.workingSolution || 'N/A'}

¿Se requieren refacciones?
${payload.needsParts ? 'Sí' : 'No'}

Inteligencia de mantenimiento predictivo:
- Analiza la conversación completa (procedimiento, salidas, evidencias).
- Cruza síntomas con OTs similares listadas en el contexto.
- Identifica síntomas secundarios o patrones que indiquen riesgo futuro.
- Devuelve maintenanceRisk[] ordenado de mayor riesgo a menor. Si no hay riesgos, devuelve [].

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "summary": "string",
  "recommendation": "close|hold_for_parts",
  "requiredParts": ["string"],
  "reportText": "string",
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
  },
  "feedbackLearnings": [
    {
      "procedure": "string (nombre técnico del paso o acción intentada)",
      "outcome": "good|bad",
      "rationale": "string (justificación breve de por qué funcionó o falló según la conversación)"
    }
  ],
  "maintenanceRisk": [
    {
      "riskLevel": "critical|high|medium|low",
      "component": "string",
      "predictedIssue": "string",
      "probability": "likely|possible|watch",
      "recommendedAction": "string",
      "timeframe": "string",
      "basedOn": "string"
    }
  ]
}`;
        try {
            const result = await this.generateContentStreamWithRetry(model, {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            let fullText = '';
            for await (const chunk of result.stream) {
                const chunkText = typeof chunk.text === 'function' ? chunk.text() : '';
                fullText += chunkText;
                if (onChunk && chunkText) {
                    onChunk(chunkText);
                }
            }
            const response = await result.response;
            const parsed = this.extractJsonObject(fullText);
            const tokens = response.usageMetadata?.totalTokenCount || 0;
            await this.aiUsageService.recordUsage({
                userId: user?.sub,
                organizationId,
                tokens,
                occurredAt: new Date(),
            });
            const recommendation = String(parsed?.recommendation || '').trim() === 'hold_for_parts'
                ? 'hold_for_parts'
                : payload.needsParts
                    ? 'hold_for_parts'
                    : 'close';
            const report = parsed?.technicalReport || {};
            const supplies = Array.isArray(report?.supplies)
                ? report.supplies
                    .map((item) => ({
                    description: String(item?.description || '').trim(),
                    quantity: String(item?.quantity || '').trim() || '1',
                }))
                    .filter((item) => item.description.length > 0)
                    .slice(0, 12)
                : [];
            const technicalReport = {
                inspections: String(report?.inspections || '').trim(),
                measurements: String(report?.measurements || '').trim(),
                observations: String(report?.observations || '').trim(),
                diagnosis: String(report?.diagnosis || '').trim(),
                rootCause: String(report?.rootCause || '').trim(),
                actions: this.normalizeStringArray(report?.actions, 10),
                otherActionDetail: String(report?.otherActionDetail || '').trim(),
                supplies: supplies.map((s) => ({
                    description: String(s?.description || '').trim(),
                    quantity: String(s?.quantity || '').trim(),
                })),
                preventiveMeasures: String(report?.preventiveMeasures || '').trim(),
            };
            const parsedLearnings = Array.isArray(parsed?.feedbackLearnings)
                ? parsed.feedbackLearnings
                : [];
            const feedbackLearnings = parsedLearnings.map((item) => ({
                procedure: String(item?.procedure || '').trim(),
                outcome: String(item?.outcome || '') === 'good' ? 'good' : 'bad',
                rationale: String(item?.rationale || '').trim(),
            })).filter((item) => item.procedure && item.rationale);
            const maintenanceRisk = this.normalizeMaintenanceRisk(parsed?.maintenanceRisk);
            return {
                summary: String(parsed?.summary || '').trim() || 'Reporte técnico generado automáticamente con base en la conversación.',
                recommendation,
                requiredParts: this.normalizeStringArray(parsed?.requiredParts, 10),
                reportText: String(parsed?.reportText || '').trim(),
                technicalReport,
                feedbackLearnings,
                maintenanceRisk,
            };
        }
        catch (error) {
            throw new common_1.InternalServerErrorException(`Work order technician report stream failed: ${error?.message || error}`);
        }
    }
};
exports.WorkOrderAiService = WorkOrderAiService;
exports.WorkOrderAiService = WorkOrderAiService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [ai_usage_service_1.AiUsageService])
], WorkOrderAiService);
//# sourceMappingURL=work-order-ai.service.js.map