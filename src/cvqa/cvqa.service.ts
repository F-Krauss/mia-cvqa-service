import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  VertexAI,
  GenerativeModelPreview,
} from '@google-cloud/vertexai';
import sharp from 'sharp';
import { resolveVertexLocation } from '../common/vertex-location';
import {
  extractErrorMessage,
  extractStatusCode,
  withVertexRetry,
} from '../common/vertex-retry';
import { PrismaService } from '../prisma/prisma.service';

const MODEL_ID =
  process.env.CVQA_MODEL_ID ||
  process.env.VERTEX_MODEL_ID ||
  'gemini-2.5-flash';

type VisionValidationRule = {
  id?: string;
  description?: string;
  color?: string;
  highlight?: { x?: number; y?: number; w?: number; h?: number };
  paths?: Array<Array<{ x?: number; y?: number }>>;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const normalizePercentNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampPercent(parsed) : undefined;
};

const normalizeVisionValidationRules = (rules: unknown): VisionValidationRule[] => {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule: any) => {
      if (!rule || typeof rule !== 'object') return null;
      const description =
        typeof rule.description === 'string' ? rule.description.trim() : '';
      const highlight =
        rule.highlight && typeof rule.highlight === 'object'
          ? {
              x: normalizePercentNumber(rule.highlight.x),
              y: normalizePercentNumber(rule.highlight.y),
              w: normalizePercentNumber(rule.highlight.w),
              h: normalizePercentNumber(rule.highlight.h),
            }
          : undefined;
      const normalizedHighlight =
        highlight &&
        highlight.x != null &&
        highlight.y != null &&
        highlight.w != null &&
        highlight.h != null
          ? highlight
          : undefined;
      const paths = Array.isArray(rule.paths)
        ? rule.paths
            .map((path: any) =>
              Array.isArray(path)
                ? path
                    .map((point: any) => {
                      const x = normalizePercentNumber(point?.x);
                      const y = normalizePercentNumber(point?.y);
                      return x == null || y == null ? null : { x, y };
                    })
                    .filter(Boolean)
                : [],
            )
            .filter((path: any[]) => path.length > 0)
        : [];
      if (!description && !normalizedHighlight && paths.length === 0) return null;
      return {
        id: typeof rule.id === 'string' ? rule.id : undefined,
        description,
        color: typeof rule.color === 'string' && rule.color.trim() ? rule.color.trim() : '#3b82f6',
        highlight: normalizedHighlight,
        paths,
      };
    })
    .filter(Boolean) as VisionValidationRule[];
};

const getRulePathBounds = (rule: VisionValidationRule) => {
  const points = (rule.paths || []).flat();
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x as number);
  const ys = points.map((point) => point.y as number);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    w: Math.max(2, maxX - minX),
    h: Math.max(2, maxY - minY),
  };
};

const getRuleFocusBounds = (rule: VisionValidationRule) =>
  rule.highlight || getRulePathBounds(rule);

const formatRuleRegionSummary = (rule: VisionValidationRule) => {
  const segments: string[] = [];
  if (rule.highlight) {
    segments.push(
      `rectángulo x:${Math.round(rule.highlight.x ?? 0)}%, y:${Math.round(rule.highlight.y ?? 0)}%, ancho:${Math.round(rule.highlight.w ?? 0)}%, alto:${Math.round(rule.highlight.h ?? 0)}%`,
    );
  }
  const strokeCount = (rule.paths || []).filter((path) => path.length > 0).length;
  if (strokeCount > 0) {
    const bounds = getRulePathBounds(rule);
    const strokeSummary = [`${strokeCount} trazo(s)`];
    if (bounds) {
      strokeSummary.push(
        `área aprox. x:${Math.round(bounds.x)}%, y:${Math.round(bounds.y)}%, ancho:${Math.round(bounds.w)}%, alto:${Math.round(bounds.h)}%`,
      );
    }
    segments.push(strokeSummary.join(', '));
  }
  return segments.length > 0 ? ` [Zona marcada: ${segments.join(' | ')}]` : ' [Sin zona marcada]';
};

const escapeSvgText = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildRuleOverlaySvg = (
  width: number,
  height: number,
  rules: VisionValidationRule[],
) => {
  const shapes = rules
    .map((rule, index) => {
      const color = rule.color || '#3b82f6';
      const parts: string[] = [];
      if (rule.highlight) {
        const x = (rule.highlight.x! / 100) * width;
        const y = (rule.highlight.y! / 100) * height;
        const w = (rule.highlight.w! / 100) * width;
        const h = (rule.highlight.h! / 100) * height;
        parts.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="6" rx="12" ry="12" />`,
        );
      }
      (rule.paths || []).forEach((path) => {
        if (path.length === 0) return;
        const points = path
          .map((point) => `${(point.x! / 100) * width},${(point.y! / 100) * height}`)
          .join(' ');
        parts.push(
          `<polyline points="${points}" fill="none" stroke="${color}" stroke-opacity="0.85" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />`,
        );
      });
      const bounds = getRuleFocusBounds(rule);
      if (bounds) {
        const labelX = ((bounds.x ?? 0) / 100) * width;
        const labelY = ((bounds.y ?? 0) / 100) * height;
        parts.push(
          `<g transform="translate(${labelX}, ${Math.max(32, labelY - 8)})"><rect x="0" y="0" width="40" height="24" rx="12" ry="12" fill="${color}" /><text x="20" y="16" text-anchor="middle" font-size="12" font-family="Arial, sans-serif" font-weight="700" fill="#ffffff">${escapeSvgText(String(index + 1))}</text></g>`,
        );
      }
      return parts.join('');
    })
    .join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;
};

const createAnnotatedReferenceBuffer = async (
  buffer: Buffer,
  rules: VisionValidationRule[],
) => {
  if (!rules.length) return null;
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) return null;
  const overlaySvg = buildRuleOverlaySvg(metadata.width, metadata.height, rules);
  return sharp(buffer)
    .composite([{ input: Buffer.from(overlaySvg), blend: 'over' }])
    .jpeg({ quality: 90 })
    .toBuffer();
};

@Injectable()
export class CvqaService {
  private readonly vertexAI: VertexAI | null = null;
  private readonly model: GenerativeModelPreview | null = null;

  constructor(private readonly prisma: PrismaService) {
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
      params = {
        ...params,
        rules: normalizeVisionValidationRules(params.rules),
      };

      const buildQualityPrompt = (p: any): string => {
        const specName = p.specName || "manual";
        const specVersion = p.specVersion || "";
        const specVersionText = specVersion ? ` (version ${specVersion})` : "";

        const rules: VisionValidationRule[] = p.rules || [];
        const rulesText = rules.length > 0
          ? rules.map((r: VisionValidationRule, index: number) => {
            const colorHint = r.color
              ? ` (Color aproximado de referencia visual de la zona: ${r.color} — compara VISUALMENTE, no exactamente. Considera iluminación, sombras y variación de cámara. Un color similar o del mismo tono cuenta como correcto.)`
              : '';
            const regionHint = formatRuleRegionSummary(r);
            return `- Regla ${index + 1}: ${r.description || 'Regla'}${colorHint}${regionHint}`;
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

        const toleranceLines: string[] = [];
        if (alignmentMm !== undefined && alignmentMm !== null) toleranceLines.push(`- Tolerancia de alineacion: ${alignmentMm} mm.`);
        if (dimensionPct !== undefined && dimensionPct !== null) toleranceLines.push(`- Tolerancia dimensional: ${dimensionPct} %.`);
        if (gapMm !== undefined && gapMm !== null) toleranceLines.push(`- Tolerancia de separacion/holgura: ${gapMm} mm.`);
        if (confidenceThreshold !== undefined && confidenceThreshold !== null) toleranceLines.push(`- Umbral minimo de confianza: ${confidenceThreshold}.`);

        const toleranceText = toleranceLines.length > 0 ? toleranceLines.join('\n') : "- Usa tolerancias razonables segun el manual.";
        const notesText = extraNotes ? `\nNotas adicionales del operador:\n${extraNotes}\n` : "";

        const pastSteps = p.pastSteps || [];
        const pastStepsText = pastSteps.length > 0
          ? `\nContexto de pasos previos (para referencia de estado histórico):\n` + pastSteps.map((s: any, idx: number) => {
            return `Paso previo ${idx + 1}: ${s.title}\nDescripción: ${s.description}\ntiene foto: ${s.hasPhoto ? 'Sí' : 'No'}`;
          }).join('\n\n')
          : "";

        return `Eres un inspector de control de calidad en un proceso de ensamble por pasos. Se te proporcionarán una o más imágenes del objeto a validar y, si existen, imágenes de referencia.

REGLAS GENERALES DE RAZONAMIENTO:
- Las imágenes etiquetadas como "Objeto real" o "Archivo a Inspeccionar" son la evidencia principal a validar.
- Las imágenes etiquetadas como "Archivo de Referencia" o "Golden Sample" son referencias del resultado esperado.
- Si también recibes una imagen etiquetada como "Golden Sample Anotado", úsala como mapa visual prioritario de las zonas pintadas por el supervisor.
- Cuando una regla habla de altura entre pasos (ej: "las piezas de este paso deben ser más altas que el paso anterior"), interpreta "más alta" como: la pieza está físicamente en una capa o nivel superior en el ensamble. Una pieza colocada ENCIMA de otras piezas es, por definición, más alta que las piezas sobre las que descansa.
- Si las piezas resaltadas o marcadas en la imagen están claramente apiladas encima del nivel previo, la regla de altura se cumple.
- Cuando una regla mencione "piezas resaltadas" o "marcadas", enfoca tu análisis exclusivamente en esas piezas.
- Cuando una regla traiga coordenadas, rectángulos o trazos marcados, limita tu análisis a esa región antes de evaluar el resto del objeto.
- Cuando tengas dudas razonables o la imagen sea ambigua, devuelve status REVIEW, nunca FAIL. Solo devuelve FAIL cuando estés seguro de que la regla se viola claramente.
- No inferir defectos que no puedas ver con claridad en la imagen.
- PRINCIPIO GENERAL: Si una regla está aproximadamente cumplida, devuelve PASS. El umbral para pasar debe ser generoso: pequeñas desviaciones de posición, color o forma que no afecten la funcionalidad del ensamble deben ser ignoradas.

COMPARACIÓN DE COLOR:
- Los colores en las reglas son referencias visuales aproximadas, NO valores exactos de píxel.
- Las fotos de piezas físicas siempre tienen variaciones por iluminación, sombras, ángulo de cámara y balance de blancos.
- Para validar una regla de color: si los objetos pertenecen claramente al mismo tono o familia de color (ej: ambos son azul claro, ambos son amarillo), la regla se cumple AUNQUE el tono exacto difiera levemente.
- Solo marca FAIL por color si los objetos son claramente de colores distintos (ej: uno rojo y otro azul). Diferencias de tono leve = PASS.
- Cuando veas un código hexadecimal en una regla, úsalo solo para orientarte en el rango de color (ej: azul claro ≈ #4CA1E3), no para comparar exactamente.

Manual de referencia: ${specName}${specVersionText}

Reglas de inspección para este paso:
${rulesText}
${pastStepsText}

Checks solicitados: ${checksText}.
Tolerancias:
${toleranceText}
${notesText}
Responde usando la estructura generada por el esquema asegurando coincidencia 100%. Recuerda: en caso de duda, usa REVIEW, no FAIL.`;
      };

      const promptText = params.prompt && typeof params.prompt === 'string' && params.prompt.trim() !== ''
        ? params.prompt
        : buildQualityPrompt(params);

      const parts: any[] = [{ text: promptText }];

      // Helper to compress image before sending to AI
      // Higher resolution (1536px) and quality (90) to preserve fine visual detail
      // needed for precise step validation (piece heights, colors, arrangement)
      const compressImage = async (buffer: Buffer): Promise<Buffer> => {
        try {
          return await sharp(buffer)
            .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90 })
            .toBuffer();
        } catch (err) {
          console.warn('[CVQA] Image compression failed, using original buffer', err);
          return buffer;
        }
      };

      const addFilePart = async (label: string, fileObj?: Express.Multer.File) => {
        if (fileObj) {
          const optimizedBuffer = await compressImage(fileObj.buffer);
          parts.push({ text: label });
          parts.push({
            inlineData: {
              mimeType: 'image/jpeg', // sharp converts to jpeg
              data: optimizedBuffer.toString('base64'),
            }
          });
        }
      };

      const addBufferPart = async (label: string, buffer?: Buffer | null) => {
        if (!buffer) return;
        const optimizedBuffer = await compressImage(buffer);
        parts.push({ text: label });
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: optimizedBuffer.toString('base64'),
          }
        });
      };

      await addFilePart("Archivo 1 (Manual/Especificación):", files.manual?.[0]);

      const objectFiles = files.object_file || [];
      if (objectFiles.length > 0) {
        for (let i = 0; i < objectFiles.length; i++) {
          await addFilePart(
            i === 0
              ? "Archivo a Inspeccionar 1 (Objeto real):"
              : `Archivo a Inspeccionar ${i + 1} (Evidencia adicional):`,
            objectFiles[i],
          );
        }
      }

      const goldenFiles = files.golden || [];
      for (let i = 0; i < goldenFiles.length; i++) {
        await addFilePart(
          `Archivo de Referencia ${i + 1} (Golden Sample):`,
          goldenFiles[i],
        );
      }

      if (goldenFiles[0] && params.rules.length > 0) {
        try {
          const annotatedGoldenBuffer = await createAnnotatedReferenceBuffer(
            goldenFiles[0].buffer,
            params.rules,
          );
          await addBufferPart(
            'Archivo de Referencia Anotado (Golden Sample con zonas marcadas):',
            annotatedGoldenBuffer,
          );
        } catch (error) {
          console.warn('[CVQA] Failed to build annotated golden sample overlay', error);
        }
      }

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
          responseSchema: {
            type: 'OBJECT' as any,
            properties: {
              status: {
                type: 'STRING' as any,
                enum: ['PASS', 'FAIL', 'REVIEW'],
              },
              summary: { type: 'STRING' as any },
              issues: { type: 'ARRAY' as any, items: { type: 'STRING' as any } },
              missing: { type: 'ARRAY' as any, items: { type: 'STRING' as any } },
              confidence: { type: 'NUMBER' as any },
              checks: { type: 'OBJECT' as any },
            },
            required: ['status', 'summary', 'issues', 'missing', 'confidence'],
          },
          temperature: 0,
        },
      };

      const result = await this.generateContentWithRetry(request);
      const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

      let jsonResult;
      try {
        jsonResult = JSON.parse(responseText);
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

      const confidence = typeof jsonResult.confidence === 'number'
        ? jsonResult.confidence
        : (typeof jsonResult.score === 'number' ? jsonResult.score : null);

      // If the AI is uncertain (confidence < 0.75) but still calls FAIL,
      // downgrade to REVIEW so a human can decide — avoids false-negative hard blocks.
      const FAIL_CONFIDENCE_THRESHOLD = 0.85;
      if (status === 'FAIL' && confidence !== null && confidence < FAIL_CONFIDENCE_THRESHOLD) {
        console.log(`[CVQA] Downgrading FAIL to REVIEW — confidence ${confidence} below threshold ${FAIL_CONFIDENCE_THRESHOLD}`);
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
      const statusCode = extractStatusCode(error);
      const errorMessage = extractErrorMessage(error);
      console.error('[CVQA] QA Vision Error:', errorMessage);
      if (
        statusCode === 429 ||
        errorMessage.toLowerCase().includes('resource_exhausted')
      ) {
        throw new HttpException(
          'El servicio de validación por IA está saturado. Intenta de nuevo en unos segundos.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new InternalServerErrorException(
        'Error en la validación por IA: ' + errorMessage,
      );
    }
  }

  async validateRulesLogic(
    payload: {
      rules: any[];
      referenceImageDescription?: string;
      subjectLabel?: string;
    },
    referenceImage?: Express.Multer.File,
  ): Promise<{ status: 'valid' | 'invalid', message?: string }> {
    try {
      const rules = normalizeVisionValidationRules(payload?.rules);
      if (rules.length === 0) {
        return {
          status: 'invalid',
          message: 'Agrega al menos una regla antes de comprobar la coherencia.',
        };
      }

      const subjectLabel =
        typeof payload?.subjectLabel === 'string' && payload.subjectLabel.trim()
          ? payload.subjectLabel.trim()
          : 'Elemento visual';
      const referenceImageDescription =
        typeof payload?.referenceImageDescription === 'string' &&
        payload.referenceImageDescription.trim()
          ? payload.referenceImageDescription.trim()
          : '';
      const rulesText = rules
        .map((rule, index) => `- Regla ${index + 1}: "${rule.description || 'Regla sin texto'}"${formatRuleRegionSummary(rule)}`)
        .join('\n');

      const promptText = `
        Eres un experto inspector de calidad industrial.
        Debes evaluar si un conjunto de reglas visuales, la imagen de referencia y las zonas marcadas son coherentes y viables para una validación automática por IA.

        Contexto:
        - Elemento inspeccionado: ${subjectLabel}
        - Descripción adicional de la imagen de referencia: ${referenceImageDescription || 'Sin descripción adicional'}
        - Si recibes una imagen "Referencia anotada", usa las zonas pintadas como evidencia principal de dónde quiere inspeccionar el supervisor.

        Revisa si existe alguno de estos problemas:
        1. Reglas lógicamente imposibles o contradictorias.
        2. Reglas ambiguas o poco observables en una foto real.
        3. Reglas que dependen de detalles que no se ven claramente en la imagen de referencia.
        4. Zonas marcadas incoherentes con la regla: apuntan al lugar equivocado, están vacías, son demasiado amplias, demasiado pequeñas o no ayudan a comprobar lo que la regla pide.
        5. La foto base no es suficiente para validar esas reglas por ángulo, resolución, iluminación o encuadre.

        Reglas y zonas a verificar:
        ${rulesText}

        Responde ÚNICAMENTE con un JSON en este formato estricto:
        {
          "status": "valid" | "invalid",
          "message": "Si es 'invalid', explica concretamente qué regla, imagen o zona marcada debe cambiar y sugiere cómo corregirlo. Si todo es viable, omite este campo."
        }
      `;

      const parts: any[] = [{ text: promptText }];
      const compressImage = async (buffer: Buffer): Promise<Buffer> => {
        try {
          return await sharp(buffer)
            .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90 })
            .toBuffer();
        } catch (error) {
          console.warn('[CVQA] Image compression failed during rules validation', error);
          return buffer;
        }
      };

      const addBufferPart = async (label: string, buffer?: Buffer | null) => {
        if (!buffer) return;
        const optimizedBuffer = await compressImage(buffer);
        parts.push({ text: label });
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: optimizedBuffer.toString('base64'),
          },
        });
      };

      if (referenceImage?.buffer) {
        await addBufferPart('Imagen de Referencia:', referenceImage.buffer);
        try {
          const annotatedBuffer = await createAnnotatedReferenceBuffer(referenceImage.buffer, rules);
          await addBufferPart('Referencia anotada con reglas y zonas marcadas:', annotatedBuffer);
        } catch (error) {
          console.warn('[CVQA] Failed to build annotated reference during rules validation', error);
        }
      }

      const request = {
        model: MODEL_ID,
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT' as any,
            properties: {
              status: {
                type: 'STRING' as any,
                enum: ['valid', 'invalid'],
              },
              message: { type: 'STRING' as any },
            },
            required: ['status'],
          },
          temperature: 0,
        },
      };

      const result = await this.generateContentWithRetry(request);
      const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

      let jsonResult;
      try {
        jsonResult = JSON.parse(responseText);
      } catch (e) {
        console.error('[CVQA] Rules validation parse error:', responseText);
        return { status: 'invalid', message: 'No se pudo analizar la respuesta de validación.' };
      }

      return jsonResult;
    } catch (error: any) {
      console.error('[CVQA] Rules Validation Error:', error.message || error);
      throw new InternalServerErrorException('Error al pre-validar las reglas con IA: ' + (error.message || ''));
    }
  }

  async saveTrainingExample(
    organizationId: string,
    userId: string,
    inputPayload: any,
    originalOutput: any,
    correctedOutput: any
  ) {
    try {
      const example = await this.prisma.aiTrainingExample.create({
        data: {
          organizationId,
          userId,
          type: 'CVQA_PASS_FAIL_OVERRIDE',
          track: 'CVQA',
          subworkflow: 'pass_fail_override',
          inputPayload,
          originalOutput: originalOutput || {},
          correctedOutput,
          status: 'PENDING',
        },
      });
      return { success: true, exampleId: example.id };
    } catch (error: any) {
      console.error('[CVQA] Failed to save training example:', error);
      throw new InternalServerErrorException('Error saving AI training example');
    }
  }
}
