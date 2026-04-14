import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VertexAI } from '@google-cloud/vertexai';
import { resolveVertexLocation } from '../src/common/vertex-location';

type ValidationStatus = 'PASS' | 'FAIL' | 'REVIEW';

type PercentPoint = { x: number; y: number };
type PercentRegion = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  polygon?: PercentPoint[];
  color?: string;
  label?: string;
  regionRole?: 'rule_zone' | 'defect_zone' | 'context_region';
};

type ProbeNormalizedRule = {
  ruleId: string;
  status: ValidationStatus;
  confidence: number | null;
  reason?: string;
  sourceIndices: number[];
  matchedRuleRegion?: PercentRegion;
  defectRegion?: PercentRegion;
  evidenceRegions: PercentRegion[];
};

type ProbeNormalizedResult = {
  overallStatus: ValidationStatus;
  summary: string;
  captureQualityStatus: ValidationStatus;
  ruleResults: ProbeNormalizedRule[];
};

type ProbeRunResult = {
  modelId: string;
  location: string;
  available: boolean;
  durationMs: number;
  parseOk: boolean;
  normalizeOk: boolean;
  compatibleWithCvqaContract: boolean;
  issues: string[];
  rawTextPreview?: string;
  normalizedPreview?: ProbeNormalizedResult;
  errorMessage?: string;
  statusCode?: number | string;
  errorStackPreview?: string;
};

const VALID_STATUSES: ValidationStatus[] = ['PASS', 'FAIL', 'REVIEW'];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizeStatus = (
  value: unknown,
  fallback: ValidationStatus = 'REVIEW',
): ValidationStatus => {
  const normalized = String(value || '').trim().toUpperCase();
  return VALID_STATUSES.includes(normalized as ValidationStatus)
    ? (normalized as ValidationStatus)
    : fallback;
};

const normalizeScore = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : undefined;
};

const normalizePercentNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 100) : undefined;
};

const normalizeString = (value: unknown) => {
  const parsed = typeof value === 'string' ? value.trim() : '';
  return parsed.length > 0 ? parsed : undefined;
};

const normalizeRegion = (value: any): PercentRegion | null => {
  if (!value || typeof value !== 'object') return null;
  const polygon = Array.isArray(value?.polygon)
    ? value.polygon
        .map((point: any) => {
          const x = normalizePercentNumber(point?.x);
          const y = normalizePercentNumber(point?.y);
          return x == null || y == null ? null : { x, y };
        })
        .filter((point: PercentPoint | null): point is PercentPoint => Boolean(point))
    : [];

  const x = normalizePercentNumber(value?.x);
  const y = normalizePercentNumber(value?.y);
  const w = normalizePercentNumber(value?.w);
  const h = normalizePercentNumber(value?.h);

  if (polygon.length === 0 && (x == null || y == null || w == null || h == null)) {
    return null;
  }

  const regionRole = String(value?.regionRole || '').trim().toLowerCase();

  return {
    x,
    y,
    w,
    h,
    polygon,
    color: normalizeString(value?.color),
    label: normalizeString(value?.label),
    regionRole:
      regionRole === 'rule_zone' ||
      regionRole === 'defect_zone' ||
      regionRole === 'context_region'
        ? (regionRole as PercentRegion['regionRole'])
        : undefined,
  };
};

const normalizeProbeResult = (raw: any): { normalized: ProbeNormalizedResult; issues: string[] } => {
  const issues: string[] = [];

  const overallStatus = normalizeStatus(raw?.overallStatus ?? raw?.status, 'REVIEW');
  const captureQualityStatus = normalizeStatus(raw?.captureQuality?.status, 'REVIEW');
  const summary = normalizeString(raw?.summary) || 'Sin resumen generado.';

  const ruleResults: ProbeNormalizedRule[] = Array.isArray(raw?.ruleResults)
    ? raw.ruleResults
        .map((entry: any, index: number) => {
          const ruleId =
            normalizeString(entry?.ruleId) ||
            normalizeString(entry?.id) ||
            `rule-${index + 1}`;
          const status = normalizeStatus(entry?.status, 'REVIEW');
          const sourceIndices = Array.isArray(entry?.sourceIndices)
            ? entry.sourceIndices
                .map((value: any) => Number(value))
                .filter((value: number) => Number.isFinite(value) && value >= 0)
            : [];

          if (sourceIndices.length === 0) {
            issues.push(`Regla ${ruleId}: sourceIndices vacío; se fuerza [0].`);
            sourceIndices.push(0);
          }

          const matchedRuleRegion = normalizeRegion(entry?.matchedRuleRegion);
          const defectRegion = normalizeRegion(entry?.defectRegion);

          const evidenceRegionsRaw = Array.isArray(entry?.evidenceRegions)
            ? entry.evidenceRegions
                .map((region: any) => normalizeRegion(region))
                .filter((region: PercentRegion | null): region is PercentRegion => Boolean(region))
            : [];

          const evidenceRegions = [
            ...(matchedRuleRegion ? [matchedRuleRegion] : []),
            ...(defectRegion ? [defectRegion] : []),
            ...evidenceRegionsRaw,
          ];

          if (!matchedRuleRegion && evidenceRegionsRaw.length > 0) {
            issues.push(`Regla ${ruleId}: faltó matchedRuleRegion; se usó la primera evidenceRegion.`);
          }

          return {
            ruleId,
            status,
            confidence: normalizeScore(entry?.confidence) ?? null,
            reason: normalizeString(entry?.reason),
            sourceIndices,
            matchedRuleRegion: matchedRuleRegion || evidenceRegionsRaw[0],
            defectRegion,
            evidenceRegions,
          };
        })
        .filter(Boolean)
    : [];

  if (ruleResults.length === 0) {
    issues.push('No se devolvieron ruleResults.');
  }

  return {
    normalized: {
      overallStatus,
      summary,
      captureQualityStatus,
      ruleResults,
    },
    issues,
  };
};

const buildProbeRequest = () => ({
  contents: [
    {
      role: 'user',
      parts: [
        {
          text: `Eres un inspector visual industrial.\nDevuelve SOLO JSON válido con el esquema requerido.\n\nContexto:\n- Hay una sola regla con id rule-1.\n- Simula una revisión donde la evidencia es suficiente.\n- Debes incluir matchedRuleRegion con coordenadas porcentuales 0..100.\n- Si hay incumplimiento puntual, agrega defectRegion.\n- Incluye sourceIndices con índices base 0.\n\nRegla:\n- id: rule-1\n- nombre: Tornillo enrasado\n- criterio: la cabeza del tornillo debe quedar al ras, sin sobresalir.`,
        },
      ],
    },
  ],
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT' as any,
      properties: {
        overallStatus: { type: 'STRING' as any, enum: VALID_STATUSES },
        summary: { type: 'STRING' as any },
        captureQuality: {
          type: 'OBJECT' as any,
          properties: {
            status: { type: 'STRING' as any, enum: VALID_STATUSES },
            blur: { type: 'NUMBER' as any },
            exposure: { type: 'NUMBER' as any },
            framing: { type: 'NUMBER' as any },
            occlusion: { type: 'NUMBER' as any },
            issues: { type: 'ARRAY' as any, items: { type: 'STRING' as any } },
          },
          required: ['status'],
        },
        ruleResults: {
          type: 'ARRAY' as any,
          items: {
            type: 'OBJECT' as any,
            properties: {
              ruleId: { type: 'STRING' as any },
              status: { type: 'STRING' as any, enum: VALID_STATUSES },
              confidence: { type: 'NUMBER' as any },
              reason: { type: 'STRING' as any },
              sourceIndices: {
                type: 'ARRAY' as any,
                items: { type: 'NUMBER' as any },
              },
              matchedRuleRegion: {
                type: 'OBJECT' as any,
                properties: {
                  x: { type: 'NUMBER' as any },
                  y: { type: 'NUMBER' as any },
                  w: { type: 'NUMBER' as any },
                  h: { type: 'NUMBER' as any },
                  regionRole: {
                    type: 'STRING' as any,
                    enum: ['rule_zone', 'defect_zone', 'context_region'],
                  },
                  polygon: {
                    type: 'ARRAY' as any,
                    items: {
                      type: 'OBJECT' as any,
                      properties: {
                        x: { type: 'NUMBER' as any },
                        y: { type: 'NUMBER' as any },
                      },
                      required: ['x', 'y'],
                    },
                  },
                },
              },
              defectRegion: {
                type: 'OBJECT' as any,
                properties: {
                  x: { type: 'NUMBER' as any },
                  y: { type: 'NUMBER' as any },
                  w: { type: 'NUMBER' as any },
                  h: { type: 'NUMBER' as any },
                  regionRole: {
                    type: 'STRING' as any,
                    enum: ['rule_zone', 'defect_zone', 'context_region'],
                  },
                  polygon: {
                    type: 'ARRAY' as any,
                    items: {
                      type: 'OBJECT' as any,
                      properties: {
                        x: { type: 'NUMBER' as any },
                        y: { type: 'NUMBER' as any },
                      },
                      required: ['x', 'y'],
                    },
                  },
                },
              },
              evidenceRegions: {
                type: 'ARRAY' as any,
                items: {
                  type: 'OBJECT' as any,
                  properties: {
                    x: { type: 'NUMBER' as any },
                    y: { type: 'NUMBER' as any },
                    w: { type: 'NUMBER' as any },
                    h: { type: 'NUMBER' as any },
                    regionRole: {
                      type: 'STRING' as any,
                      enum: ['rule_zone', 'defect_zone', 'context_region'],
                    },
                    polygon: {
                      type: 'ARRAY' as any,
                      items: {
                        type: 'OBJECT' as any,
                        properties: {
                          x: { type: 'NUMBER' as any },
                          y: { type: 'NUMBER' as any },
                        },
                        required: ['x', 'y'],
                      },
                    },
                  },
                },
              },
            },
            required: ['ruleId', 'status', 'sourceIndices', 'matchedRuleRegion'],
          },
        },
      },
      required: ['overallStatus', 'summary', 'captureQuality', 'ruleResults'],
    },
    temperature: 0,
  },
});

const buildModelList = () => {
  const fromEnv = String(process.env.CVQA_PROBE_MODELS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return [
    'gemini-3.1-flash',
    'gemini-3.1-flash-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
  ];
};

const buildLocationList = (defaultLocation: string) => {
  const fromEnv = String(process.env.CVQA_PROBE_LOCATIONS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return [...new Set(fromEnv)];
  }
  return [...new Set(['global', defaultLocation, 'us-central1'])].filter(Boolean);
};

const maskProjectId = (value: string) => {
  if (value.length <= 6) return value;
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
};

const main = async () => {
  const projectId =
    String(process.env.VERTEX_PROJECT_ID || '').trim() ||
    String(process.env.FIREBASE_PROJECT_ID || '').trim();

  if (!projectId) {
    throw new Error('Missing VERTEX_PROJECT_ID/FIREBASE_PROJECT_ID in environment.');
  }

  const models = buildModelList();
  const preferGlobal = models.some((modelId) => /^gemini-3/i.test(modelId));
  const locationResolution = resolveVertexLocation(
    ['VERTEX_AI_LOCATION', 'VERTEX_LOCATION'],
    { defaultLocation: preferGlobal ? 'global' : 'us-central1' },
  );

  const locations = buildLocationList(locationResolution.location);
  const request = buildProbeRequest();
  const results: ProbeRunResult[] = [];

  for (const location of locations) {
    const vertexAI = new VertexAI({ project: projectId, location });
    for (const modelId of models) {
      const startedAt = Date.now();
      const client = vertexAI.preview.getGenerativeModel({ model: modelId });
      try {
        const response = await client.generateContent(request);
        const text = response.response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const rawPreview = String(text).slice(0, 600);

        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch (error: any) {
          results.push({
            modelId,
            location,
            available: true,
            durationMs: Date.now() - startedAt,
            parseOk: false,
            normalizeOk: false,
            compatibleWithCvqaContract: false,
            issues: ['Respuesta no parseable como JSON.'],
            rawTextPreview: rawPreview,
            errorMessage: error?.message || 'JSON parse error',
            errorStackPreview: typeof error?.stack === 'string' ? String(error.stack).slice(0, 400) : undefined,
          });
          continue;
        }

        const { normalized, issues } = normalizeProbeResult(parsed);
        const hasMatchedRuleRegion = normalized.ruleResults.every(
          (rule) => Boolean(rule.matchedRuleRegion),
        );
        const hasSourceIndices = normalized.ruleResults.every(
          (rule) => Array.isArray(rule.sourceIndices) && rule.sourceIndices.length > 0,
        );
        const compatible =
          normalized.ruleResults.length > 0 &&
          hasMatchedRuleRegion &&
          hasSourceIndices &&
          Boolean(normalized.overallStatus);

        results.push({
          modelId,
          location,
          available: true,
          durationMs: Date.now() - startedAt,
          parseOk: true,
          normalizeOk: true,
          compatibleWithCvqaContract: compatible,
          issues,
          rawTextPreview: rawPreview,
          normalizedPreview: normalized,
        });
      } catch (error: any) {
        results.push({
          modelId,
          location,
          available: false,
          durationMs: Date.now() - startedAt,
          parseOk: false,
          normalizeOk: false,
          compatibleWithCvqaContract: false,
          issues: [],
          errorMessage: error?.message || String(error),
          statusCode: error?.code || error?.status || error?.statusCode,
          errorStackPreview: typeof error?.stack === 'string' ? String(error.stack).slice(0, 400) : undefined,
        });
      }
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    projectId: maskProjectId(projectId),
    locations,
    configuredLocation: locationResolution.configuredLocation,
    models,
    results,
  };

  const outputDir = path.resolve(process.cwd(), 'tmp');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'gemini-model-probe-report.json');
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\n[MODEL PROBE] Report written to: ${outputPath}`);
  for (const result of results) {
    const status = result.available
      ? result.compatibleWithCvqaContract
        ? 'OK'
        : 'PARTIAL'
      : 'UNAVAILABLE';
    console.log(
      `[MODEL PROBE] ${result.modelId} @ ${result.location} => ${status} | available=${result.available} parse=${result.parseOk} normalize=${result.normalizeOk} compatible=${result.compatibleWithCvqaContract} (${result.durationMs}ms)`,
    );
    if (result.errorMessage) {
      console.log(
        `  error: ${result.errorMessage}${result.statusCode ? ` | code=${String(result.statusCode)}` : ''}`,
      );
    }
    if (result.issues.length > 0) {
      console.log(`  issues: ${result.issues.join(' | ')}`);
    }
  }

  const hasCompatible = results.some((result) => result.compatibleWithCvqaContract);
  if (!hasCompatible) {
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error('[MODEL PROBE] Fatal error:', error?.message || error);
  process.exit(1);
});
