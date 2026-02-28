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

  async compareVisionQuality(
    files: {
      manual?: Express.Multer.File[];
      object_file?: Express.Multer.File[];
      golden?: Express.Multer.File[];
    },
    paramsString: string,
    user?: any,
    organizationId?: string,
  ) {
    if (!this.model) {
      throw new BadRequestException('Vertex AI is not configured.');
    }

    try {
      let params: Record<string, any> = {};
      if (paramsString) {
        try {
          params = JSON.parse(paramsString);
        } catch (e) {
          throw new BadRequestException('Invalid params JSON');
        }
      }

      const buildQualityPrompt = (p: any): string => {
        const specName = p.specName || "manual";
        const specVersion = p.specVersion || "";
        const specVersionText = specVersion ? ` (version ${specVersion})` : "";

        const rules: string[] = p.rules || [];
        const rulesText = rules.length > 0 ? rules.map((r: string) => `- ${r}`).join('\n') : "- Usa el manual/especificación como referencia principal.";

        const tolerances = p.tolerances || {};
        const alignmentMm = tolerances.alignmentMm;
        const dimensionPct = tolerances.dimensionPercent;
        const gapMm = tolerances.gapMm;
        const confidenceThreshold = p.confidenceThreshold;
        const extraNotes = p.notes || "";

        const checks = p.checks || {};
        const checksText = Object.keys(checks).filter(k => checks[k]).join(', ') || "validacion general";

        const toleranceLines: string[] = [];
        if (alignmentMm !== undefined && alignmentMm !== null) toleranceLines.push(`- Tolerancia de alineacion: ${alignmentMm} mm.`);
        if (dimensionPct !== undefined && dimensionPct !== null) toleranceLines.push(`- Tolerancia dimensional: ${dimensionPct} %.`);
        if (gapMm !== undefined && gapMm !== null) toleranceLines.push(`- Tolerancia de separacion/holgura: ${gapMm} mm.`);
        if (confidenceThreshold !== undefined && confidenceThreshold !== null) toleranceLines.push(`- Umbral minimo de confianza: ${confidenceThreshold}.`);

        const toleranceText = toleranceLines.length > 0 ? toleranceLines.join('\n') : "- Usa tolerancias razonables segun el manual.";
        const notesText = extraNotes ? `\nNotas adicionales del operador:\n${extraNotes}\n` : "";

        return `Eres un inspector de control de calidad industrial. El primer archivo es el manual/especificacion del producto${specVersionText}. El segundo archivo es la pieza a inspeccionar. Si hay un tercer archivo, es un golden sample (pieza correcta). Compara la pieza con el manual y/o golden sample.\n\nManual de referencia: ${specName}${specVersionText}\nReglas del manual:\n${rulesText}\n\nChecks solicitados: ${checksText}.\nTolerancias:\n${toleranceText}\n${notesText}Responde SOLO JSON valido con:\n{ "status": "PASS|FAIL|REVIEW", "summary": "texto corto", "issues": ["lista"], "missing": ["lista"], "confidence": 0.0-1.0, "checks": {"check": true} }\nSi hay dudas o el manual no es claro, usa status REVIEW.`;
      };

      const promptText = params.prompt && typeof params.prompt === 'string' && params.prompt.trim() !== ''
        ? params.prompt
        : buildQualityPrompt(params);

      const parts: any[] = [];

      const addFilePart = (fileObj?: Express.Multer.File[]) => {
        if (fileObj?.[0]) {
          parts.push({
            inlineData: {
              mimeType: fileObj[0].mimetype || 'image/jpeg',
              data: fileObj[0].buffer.toString('base64'),
            }
          });
        }
      };

      addFilePart(files.manual);
      addFilePart(files.object_file);
      addFilePart(files.golden);

      parts.push({ text: promptText });

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

      const listify = (v: any): string[] => {
        if (!v) return [];
        if (Array.isArray(v)) return v.map(String);
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
    } catch (error: any) {
      console.error('[CVQA] QA Vision Error:', error.message || error);
      throw new InternalServerErrorException('Error en la validación por IA: ' + (error.message || ''));
    }
  }
}
