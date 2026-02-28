import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  VertexAI,
  GenerativeModelPreview,
} from '@google-cloud/vertexai';
import { resolveVertexLocation } from '../common/vertex-location';
import { withVertexRetry } from '../common/vertex-retry';

const MODEL_ID = process.env.AI_MODEL_ID || process.env.VERTEX_MODEL_ID || 'gemini-1.5-flash';

@Injectable()
export class CvqaService {
  private readonly vertexAI: VertexAI | null = null;
  private readonly model: GenerativeModelPreview | null = null;

  constructor() {
    const projectId = process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const locationResolution = resolveVertexLocation([
      'VERTEX_AI_LOCATION',
      'VERTEX_LOCATION',
    ]);
    const location = locationResolution.location;
    if (!projectId) {
      console.warn('VERTEX_PROJECT_ID (or FIREBASE_PROJECT_ID) not found. AI features will be disabled.');
    } else {
      if (locationResolution.configuredLocationUnsupported) {
        const configuredFrom =
          locationResolution.configuredEnv || 'VERTEX_LOCATION';
        console.warn(
          `[CVQA] ${configuredFrom}="${locationResolution.configuredLocation}" is not supported for these Vertex AI model calls. Using "${locationResolution.location}".`,
        );
      }
      this.vertexAI = new VertexAI({ project: projectId, location });
      this.model = this.vertexAI.preview.getGenerativeModel({
        model: MODEL_ID,
      });
    }
  }

  private async generateContentWithRetry(
    request: Parameters<GenerativeModelPreview['generateContent']>[0],
  ): Promise<Awaited<ReturnType<GenerativeModelPreview['generateContent']>>> {
    if (!this.model) {
      throw new BadRequestException('Vertex AI is not configured.');
    }
    return withVertexRetry(
      () => this.model!.generateContent(request),
      {
        operationName: 'CvqaService.generateContent',
        onRetry: ({
          attempt,
          nextAttempt,
          maxAttempts,
          delayMs,
          statusCode,
          errorMessage,
        }) => {
          console.warn(
            `[CVQA] Vertex retry ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
            `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`,
          );
        },
      },
    );
  }

  async verifyWorkInstructionStep(
    payload: {
      goldenSampleUrl: string;
      validationImageUrl: string;
      rules?: Array<{
        id: string;
        description: string;
        highlight?: { x: number; y: number; w: number; h: number };
        color?: string;
      }>;
    },
    user?: any,
    organizationId?: string,
  ) {
    if (!this.model) {
      throw new BadRequestException('Vertex AI is not configured.');
    }

    try {
      const fetchImageBase64 = async (url: string) => {
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
      } catch (e) {
        console.error('[CVQA] QA Vision parse error:', responseText);
        jsonResult = {
          status: 'UNCLEAR',
          message: 'Error procesando la respuesta de la IA.',
          correction_advice: 'Por favor intenta de nuevo.',
        };
      }

      return jsonResult;
    } catch (error: any) {
      console.error('[CVQA] QA Vision Error:', error.message || error);
      throw new InternalServerErrorException('Error en la validación por IA: ' + (error.message || ''));
    }
  }
}
