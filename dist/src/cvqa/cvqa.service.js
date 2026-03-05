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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CvqaService = void 0;
const common_1 = require("@nestjs/common");
const vertexai_1 = require("@google-cloud/vertexai");
const sharp_1 = __importDefault(require("sharp"));
const vertex_location_1 = require("../common/vertex-location");
const vertex_retry_1 = require("../common/vertex-retry");
const MODEL_ID = process.env.AI_MODEL_ID || process.env.VERTEX_MODEL_ID || 'gemini-2.5-flash';
let CvqaService = class CvqaService {
    vertexAI = null;
    model = null;
    constructor() {
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
                console.warn(`[CVQA] ${configuredFrom}="${locationResolution.configuredLocation}" is not supported for these Vertex AI model calls. Using "${locationResolution.location}".`);
            }
            this.vertexAI = new vertexai_1.VertexAI({ project: projectId, location });
            this.model = this.vertexAI.preview.getGenerativeModel({
                model: MODEL_ID,
            });
        }
    }
    async generateContentWithRetry(request) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        return (0, vertex_retry_1.withVertexRetry)(() => this.model.generateContent(request), {
            operationName: 'CvqaService.generateContent',
            onRetry: ({ attempt, nextAttempt, maxAttempts, delayMs, statusCode, errorMessage, }) => {
                console.warn(`[CVQA] Vertex retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                    `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`);
            },
        });
    }
    async compareVisionQuality(files, paramsString, user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        try {
            let params = {};
            if (paramsString) {
                try {
                    params = JSON.parse(paramsString);
                }
                catch (e) {
                    throw new common_1.BadRequestException('Invalid params JSON');
                }
            }
            const buildQualityPrompt = (p) => {
                const specName = p.specName || "manual";
                const specVersion = p.specVersion || "";
                const specVersionText = specVersion ? ` (version ${specVersion})` : "";
                const rules = p.rules || [];
                const rulesText = rules.length > 0
                    ? rules.map((r) => {
                        if (typeof r === 'string')
                            return `- ${r}`;
                        return `- ${r.description || 'Regla'} ${r.color ? `(Color de zona a revisar: ${r.color})` : ''}`;
                    }).join('\n')
                    : "- Usa el manual/especificación como referencia principal.";
                const tolerances = p.tolerances || {};
                const alignmentMm = tolerances.alignmentMm;
                const dimensionPct = tolerances.dimensionPercent;
                const gapMm = tolerances.gapMm;
                const confidenceThreshold = p.confidenceThreshold;
                const extraNotes = p.notes || "";
                const checks = p.checks || {};
                const checksText = Object.keys(checks).filter(k => checks[k]).join(', ') || "validacion general";
                const toleranceLines = [];
                if (alignmentMm !== undefined && alignmentMm !== null)
                    toleranceLines.push(`- Tolerancia de alineacion: ${alignmentMm} mm.`);
                if (dimensionPct !== undefined && dimensionPct !== null)
                    toleranceLines.push(`- Tolerancia dimensional: ${dimensionPct} %.`);
                if (gapMm !== undefined && gapMm !== null)
                    toleranceLines.push(`- Tolerancia de separacion/holgura: ${gapMm} mm.`);
                if (confidenceThreshold !== undefined && confidenceThreshold !== null)
                    toleranceLines.push(`- Umbral minimo de confianza: ${confidenceThreshold}.`);
                const toleranceText = toleranceLines.length > 0 ? toleranceLines.join('\n') : "- Usa tolerancias razonables segun el manual.";
                const notesText = extraNotes ? `\nNotas adicionales del operador:\n${extraNotes}\n` : "";
                const pastSteps = p.pastSteps || [];
                const pastStepsText = pastSteps.length > 0
                    ? `\nContexto de pasos previos (para referencia de estado histórico):\n` + pastSteps.map((s, idx) => {
                        return `Paso previo ${idx + 1}: ${s.title}\nDescripción: ${s.description}\ntiene foto: ${s.hasPhoto ? 'Sí' : 'No'}`;
                    }).join('\n\n')
                    : "";
                return `Eres un inspector de control de calidad industrial. A continuación se te proporcionarán imágenes etiquetadas (Manual, Objeto real, Golden Sample según existan, y posiblemente fotos de los pasos previos como contexto histórico). Compara la pieza a inspeccionar con el manual y/o golden sample.\n\nManual de referencia: ${specName}${specVersionText}\nReglas de inspección:\n${rulesText}\n${pastStepsText}\n\nChecks solicitados: ${checksText}.\nTolerancias:\n${toleranceText}\n${notesText}Responde SOLO JSON valido con:\n{ "status": "PASS|FAIL|REVIEW", "summary": "texto corto", "issues": ["lista"], "missing": ["lista"], "confidence": 0.0-1.0, "checks": {"check": true} }\nSi hay dudas o las reglas no son claras, usa status REVIEW.`;
            };
            const promptText = params.prompt && typeof params.prompt === 'string' && params.prompt.trim() !== ''
                ? params.prompt
                : buildQualityPrompt(params);
            const parts = [{ text: promptText }];
            const compressImage = async (buffer) => {
                try {
                    return await (0, sharp_1.default)(buffer)
                        .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 90 })
                        .toBuffer();
                }
                catch (err) {
                    console.warn('[CVQA] Image compression failed, using original buffer', err);
                    return buffer;
                }
            };
            const addFilePart = async (label, fileObj) => {
                if (fileObj) {
                    const optimizedBuffer = await compressImage(fileObj.buffer);
                    parts.push({ text: label });
                    parts.push({
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: optimizedBuffer.toString('base64'),
                        }
                    });
                }
            };
            await addFilePart("Archivo 1 (Manual/Especificación):", files.manual?.[0]);
            const objectFiles = files.object_file || [];
            if (objectFiles.length > 0) {
                await addFilePart("Archivo a Inspeccionar (Objeto real final):", objectFiles[0]);
                for (let i = 1; i < objectFiles.length; i++) {
                    await addFilePart(`Contexto Histórico: Foto de paso previo ${i}:`, objectFiles[i]);
                }
            }
            await addFilePart("Archivo de Referencia (Golden Sample):", files.golden?.[0]);
            const request = {
                model: MODEL_ID,
                contents: [
                    {
                        role: 'user',
                        parts,
                    },
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0,
                },
            };
            const result = await this.generateContentWithRetry(request);
            const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            let jsonResult;
            try {
                jsonResult = JSON.parse(responseText.replace(/```json\n?|\n?```/g, ''));
            }
            catch (e) {
                console.error('[CVQA] QA Vision parse error:', responseText);
                jsonResult = {
                    status: 'REVIEW',
                    summary: 'Error procesando la respuesta de la IA.',
                    issues: ['Error interno al leer JSON'],
                };
            }
            let statusRaw = jsonResult.status || jsonResult.result || jsonResult.decision || 'REVIEW';
            let status = String(statusRaw).toUpperCase();
            if (!['PASS', 'FAIL', 'REVIEW'].includes(status)) {
                status = 'REVIEW';
            }
            const listify = (v) => {
                if (!v)
                    return [];
                if (Array.isArray(v))
                    return v.map(String);
                return [String(v)];
            };
            return {
                status,
                summary: jsonResult.summary || jsonResult.notes || jsonResult.reason,
                issues: listify(jsonResult.issues || jsonResult.defects || jsonResult.findings),
                missing: listify(jsonResult.missing || jsonResult.missing_parts || jsonResult.missingParts),
                confidence: typeof jsonResult.confidence === 'number' ? jsonResult.confidence : (typeof jsonResult.score === 'number' ? jsonResult.score : null),
                checks: jsonResult.checks || null,
            };
        }
        catch (error) {
            console.error('[CVQA] QA Vision Error:', error.message || error);
            throw new common_1.InternalServerErrorException('Error en la validación por IA: ' + (error.message || ''));
        }
    }
    async validateRulesLogic(rules) {
        try {
            const promptText = `
        Eres un experto inspector de calidad industrial. 
        Tengo una lista de reglas visuales de inspección. Revisa si hay alguna regla que sea:
        1. Lógicamente imposible o contradictoria (ej: "las piezas A deben medir más que las piezas A").
        2. Ambigua sin contexto real o incoherente con otras reglas ("Los circulos azules deben ser de color rojo").
        3. Físicamente irrealizable.
        
        Reglas a verificar:
        ${JSON.stringify(rules.map(r => r.description), null, 2)}

        Responde ÚNICAMENTE con un JSON en este formato estricto:
        {
          "status": "valid" | "invalid",
          "message": "Si es 'invalid', explica brevemente por qué la regla específica es contradictoria, ambigua o imposible y sugiere cómo corregirla de forma lógica. Si es 'valid', omite este campo."
        }
      `;
            const request = {
                model: MODEL_ID,
                contents: [{ role: 'user', parts: [{ text: promptText }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0,
                },
            };
            const result = await this.generateContentWithRetry(request);
            const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            let jsonResult;
            try {
                jsonResult = JSON.parse(responseText.replace(/```json\n?|\n?```/g, ''));
            }
            catch (e) {
                console.error('[CVQA] Rules validation parse error:', responseText);
                return { status: 'invalid', message: 'No se pudo analizar la respuesta de validación.' };
            }
            return jsonResult;
        }
        catch (error) {
            console.error('[CVQA] Rules Validation Error:', error.message || error);
            throw new common_1.InternalServerErrorException('Error al pre-validar las reglas con IA: ' + (error.message || ''));
        }
    }
};
exports.CvqaService = CvqaService;
exports.CvqaService = CvqaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], CvqaService);
//# sourceMappingURL=cvqa.service.js.map