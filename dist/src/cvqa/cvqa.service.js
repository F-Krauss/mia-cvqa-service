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
exports.CvqaService = void 0;
const common_1 = require("@nestjs/common");
const vertexai_1 = require("@google-cloud/vertexai");
const vertex_location_1 = require("../common/vertex-location");
const vertex_retry_1 = require("../common/vertex-retry");
const MODEL_ID = process.env.AI_MODEL_ID || process.env.VERTEX_MODEL_ID || 'gemini-1.5-flash';
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
    async verifyWorkInstructionStep(payload, user, organizationId) {
        if (!this.model) {
            throw new common_1.BadRequestException('Vertex AI is not configured.');
        }
        try {
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
                model: MODEL_ID,
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
                console.error('[CVQA] QA Vision parse error:', responseText);
                jsonResult = {
                    status: 'UNCLEAR',
                    message: 'Error procesando la respuesta de la IA.',
                    correction_advice: 'Por favor intenta de nuevo.',
                };
            }
            return jsonResult;
        }
        catch (error) {
            console.error('[CVQA] QA Vision Error:', error.message || error);
            throw new common_1.InternalServerErrorException('Error en la validación por IA: ' + (error.message || ''));
        }
    }
};
exports.CvqaService = CvqaService;
exports.CvqaService = CvqaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], CvqaService);
//# sourceMappingURL=cvqa.service.js.map