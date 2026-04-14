import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { VertexAI, GenerativeModelPreview } from '@google-cloud/vertexai';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { resolveVertexLocation } from '../common/vertex-location';
import {
  extractErrorMessage,
  extractStatusCode,
  withVertexRetry,
} from '../common/vertex-retry';
import { PrismaService } from '../prisma/prisma.service';

type ValidationStatus = 'PASS' | 'FAIL' | 'REVIEW';
type ValidationSeverity = 'critical' | 'major' | 'minor';
type ValidationCheckType =
  | 'presence'
  | 'absence'
  | 'alignment'
  | 'flushness'
  | 'count'
  | 'color_mark'
  | 'orientation'
  | 'surface_condition'
  | 'text_match'
  | 'gap';
type ValidationViewConstraint =
  | 'front'
  | 'side'
  | 'top'
  | 'any'
  | 'multi_view_required';

type PercentPoint = { x: number; y: number };
type PercentRegionRole = 'rule_zone' | 'defect_zone' | 'context_region';
type PercentRegion = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  polygon?: PercentPoint[];
  regionRole?: PercentRegionRole;
  color?: string;
  label?: string;
};

type VisionValidationRule = {
  id: string;
  name?: string;
  description: string;
  severity: ValidationSeverity;
  checkType: ValidationCheckType;
  passCriteria?: string;
  strictnessPercent: number;
  color?: string;
  highlight?: { x?: number; y?: number; w?: number; h?: number };
  paths?: Array<PercentPoint[]>;
  roi?: Array<PercentPoint[]>;
  negativeReferences?: Array<{
    id?: string;
    fileName?: string;
    url?: string;
    mimeType?: string;
  }>;
  viewConstraint: ValidationViewConstraint;
  humanReviewRequiredWhen: string[];
};

type CaptureQualityAssessment = {
  status: ValidationStatus;
  blur: number | null;
  exposure: number | null;
  framing: number | null;
  occlusion: number | null;
  issues: string[];
  recommendedAction?: string;
};

type RuleEvaluation = {
  ruleId: string;
  name?: string;
  status: ValidationStatus;
  confidence: number | null;
  reason?: string;
  expectedState?: string;
  observedState?: string;
  sourceIndices: number[];
  matchedRuleRegion?: PercentRegion;
  defectRegion?: PercentRegion;
  evidenceRegions: PercentRegion[];
};

type CompareResponse = {
  status: ValidationStatus;
  overallStatus: ValidationStatus;
  summary: string;
  issues: string[];
  missing: string[];
  confidence: number | null;
  overallConfidence: number | null;
  checks: Record<string, boolean> | null;
  captureQuality: CaptureQualityAssessment;
  ruleResults: RuleEvaluation[];
  annotatedImage?: string;
  annotatedImages?: Array<{
    url: string;
    label?: string;
    sourceIndex?: number;
  }>;
  recommendedAction?: string;
};

type ModelClientEntry = {
  modelId: string;
  client: GenerativeModelPreview;
};

const DEFAULT_PRIMARY_MODEL_ID =
  process.env.CVQA_MODEL_ID ||
  process.env.VERTEX_MODEL_ID ||
  'gemini-3-flash-preview';
const DEFAULT_FALLBACK_MODEL_IDS = ['gemini-2.5-flash'];
const DEFAULT_COMPARE_TIMEOUT_MS = 115_000;
const SMALL_IMAGE_BYTES_THRESHOLD = 256 * 1024;
const LIGHT_IMAGE_MAX_DIMENSION = 1024;
const DEFAULT_IMAGE_MAX_DIMENSION = 1536;
const DEFAULT_REVIEW_CONDITIONS = [
  'occlusion',
  'blur',
  'mala iluminación',
  'vista incorrecta',
  'confianza insuficiente',
];

const VALID_STATUSES: ValidationStatus[] = ['PASS', 'FAIL', 'REVIEW'];
const VALID_SEVERITIES: ValidationSeverity[] = ['critical', 'major', 'minor'];
const VALID_CHECK_TYPES: ValidationCheckType[] = [
  'presence',
  'absence',
  'alignment',
  'flushness',
  'count',
  'color_mark',
  'orientation',
  'surface_condition',
  'text_match',
  'gap',
];
const VALID_VIEW_CONSTRAINTS: ValidationViewConstraint[] = [
  'front',
  'side',
  'top',
  'any',
  'multi_view_required',
];

const STATUS_COLOR_MAP: Record<ValidationStatus, string> = {
  PASS: '#16a34a',
  FAIL: '#dc2626',
  REVIEW: '#f59e0b',
};
const MIN_RULE_ZONE_COVERAGE_RATIO = 0.3;
const MIN_RULE_ZONE_AREA_RATIO = 0.2;

const getDefaultStrictnessPercent = (severity: ValidationSeverity) => {
  switch (severity) {
    case 'critical':
      return 90;
    case 'minor':
      return 60;
    case 'major':
    default:
      return 75;
  }
};

const deriveThresholdsFromStrictness = (strictnessPercent: number) => {
  const strictness = clampNumber(strictnessPercent, 0, 100) / 100;
  const passMin = clampScore(0.72 + strictness * 0.24);
  const reviewBelow = clampScore(passMin - (0.12 - strictness * 0.03));
  const failMax = clampScore(reviewBelow - 0.08);
  return { passMin, reviewBelow, failMax };
};

const parseCsvList = (value: string | undefined, fallback: string[]) => {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : fallback;
};

const buildModelIdChain = () => {
  const configuredFallbacks = parseCsvList(
    process.env.CVQA_FALLBACK_MODEL_IDS,
    DEFAULT_FALLBACK_MODEL_IDS,
  );
  return [DEFAULT_PRIMARY_MODEL_ID, ...configuredFallbacks].filter(
    (value, index, array) => value && array.indexOf(value) === index,
  );
};

const modelRequiresGlobalEndpoint = (modelId: string) =>
  /^gemini-3/i.test(String(modelId || '').trim());

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clampPercent = (value: number) => clampNumber(value, 0, 100);
const clampScore = (value: number) => clampNumber(value, 0, 1);

const normalizePercentNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampPercent(parsed) : undefined;
};

const normalizeScore = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampScore(parsed) : undefined;
};

const normalizeString = (value: unknown) => {
  const parsed = typeof value === 'string' ? value.trim() : '';
  return parsed || undefined;
};

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

const normalizeFileName = (value: string | undefined) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const normalizeStatus = (
  value: unknown,
  fallback: ValidationStatus = 'REVIEW',
): ValidationStatus => {
  const normalized = String(value || '').trim().toUpperCase();
  return VALID_STATUSES.includes(normalized as ValidationStatus)
    ? (normalized as ValidationStatus)
    : fallback;
};

const normalizeSeverity = (value: unknown): ValidationSeverity => {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_SEVERITIES.includes(normalized as ValidationSeverity)
    ? (normalized as ValidationSeverity)
    : 'major';
};

const normalizeCheckType = (value: unknown): ValidationCheckType => {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_CHECK_TYPES.includes(normalized as ValidationCheckType)
    ? (normalized as ValidationCheckType)
    : 'presence';
};

const normalizeViewConstraint = (value: unknown): ValidationViewConstraint => {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_VIEW_CONSTRAINTS.includes(normalized as ValidationViewConstraint)
    ? (normalized as ValidationViewConstraint)
    : 'any';
};

const normalizeRulePaths = (value: unknown): Array<PercentPoint[]> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((path: any) =>
      Array.isArray(path)
        ? path
            .map((point: any) => {
              const x = normalizePercentNumber(point?.x);
              const y = normalizePercentNumber(point?.y);
              return x == null || y == null ? null : { x, y };
            })
            .filter((point): point is PercentPoint => Boolean(point))
        : [],
    )
    .filter((path: PercentPoint[]) => path.length > 0);
};

const normalizeVisionValidationRules = (rules: unknown): VisionValidationRule[] => {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule: any, index) => {
      if (!rule || typeof rule !== 'object') return null;
      const description = normalizeString(rule.description) || '';
      const name = normalizeString(rule.name);
      const severity = normalizeSeverity(rule.severity);
      const viewConstraint = normalizeViewConstraint(rule.viewConstraint);
      const strictnessPercent = normalizePercentNumber(rule.strictnessPercent);
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
      const roi = normalizeRulePaths(rule.roi);
      const paths = normalizeRulePaths(rule.paths);
      if (!description && !name && !normalizedHighlight && roi.length === 0 && paths.length === 0) {
        return null;
      }
      return {
        id: normalizeString(rule.id) || `rule-${index + 1}`,
        name,
        description: description || name || `Regla ${index + 1}`,
        severity,
        checkType: normalizeCheckType(rule.checkType),
        passCriteria: normalizeString(rule.passCriteria),
        strictnessPercent:
          strictnessPercent ??
          (rule?.thresholds &&
          typeof rule.thresholds === 'object' &&
          Number.isFinite(Number(rule.thresholds.passMin))
            ? clampPercent(((Number(rule.thresholds.passMin) - 0.72) / 0.24) * 100)
            : getDefaultStrictnessPercent(severity)),
        color: normalizeString(rule.color) || '#3b82f6',
        highlight: normalizedHighlight,
        paths: paths.length > 0 ? paths : roi,
        roi: roi.length > 0 ? roi : paths,
        negativeReferences: Array.isArray(rule.negativeReferences)
          ? rule.negativeReferences
              .map((entry: any) =>
                entry && typeof entry === 'object'
                  ? {
                      id: normalizeString(entry.id),
                      fileName: normalizeString(entry.fileName),
                      url: normalizeString(entry.url),
                      mimeType: normalizeString(entry.mimeType),
                    }
                  : null,
              )
              .filter(Boolean)
          : [],
        viewConstraint,
        humanReviewRequiredWhen:
          normalizeStringArray(rule.humanReviewRequiredWhen).length > 0
            ? normalizeStringArray(rule.humanReviewRequiredWhen)
            : [...DEFAULT_REVIEW_CONDITIONS],
      };
    })
    .filter(Boolean) as VisionValidationRule[];
};

const getRulePathBounds = (rule: VisionValidationRule) => {
  const points = [...(rule.paths || []).flat(), ...(rule.roi || []).flat()];
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
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
  const strokeCount = [...(rule.roi || []), ...(rule.paths || [])].filter(
    (path) => path.length > 0,
  ).length;
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
  return segments.length > 0
    ? ` [Zona marcada: ${segments.join(' | ')}]`
    : ' [Sin zona marcada]';
};

const escapeSvgText = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildOverlaySvg = (
  width: number,
  height: number,
  regions: PercentRegion[],
) => {
  const shapes = regions
    .map((region) => {
      const color = region.color || '#3b82f6';
      const parts: string[] = [];
      if (
        region.x != null &&
        region.y != null &&
        region.w != null &&
        region.h != null
      ) {
        const x = (region.x / 100) * width;
        const y = (region.y / 100) * height;
        const w = (region.w / 100) * width;
        const h = (region.h / 100) * height;
        parts.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="6" rx="14" ry="14" />`,
        );
      }
      if (Array.isArray(region.polygon) && region.polygon.length > 0) {
        const points = region.polygon
          .map((point) => `${(point.x / 100) * width},${(point.y / 100) * height}`)
          .join(' ');
        parts.push(
          `<polygon points="${points}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="6" stroke-linejoin="round" />`,
        );
      }
      const labelX = region.x != null ? (region.x / 100) * width : 24;
      const labelY = region.y != null ? (region.y / 100) * height : 32;
      if (region.label) {
        const safeLabel = escapeSvgText(region.label);
        const labelWidth = Math.max(54, safeLabel.length * 7 + 20);
        parts.push(
          `<g transform="translate(${labelX}, ${Math.max(32, labelY - 8)})"><rect x="0" y="0" width="${labelWidth}" height="26" rx="13" ry="13" fill="${color}" /><text x="${labelWidth / 2}" y="17" text-anchor="middle" font-size="12" font-family="Arial, sans-serif" font-weight="700" fill="#ffffff">${safeLabel}</text></g>`,
        );
      }
      return parts.join('');
    })
    .join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;
};

const createAnnotatedBuffer = async (
  buffer: Buffer,
  regions: PercentRegion[],
) => {
  if (!regions.length) return null;
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) return null;
  const overlaySvg = buildOverlaySvg(metadata.width, metadata.height, regions);
  return sharp(buffer)
    .composite([{ input: Buffer.from(overlaySvg), blend: 'over' }])
    .jpeg({ quality: 90 })
    .toBuffer();
};

const createAnnotatedReferenceBuffer = async (
  buffer: Buffer,
  rules: VisionValidationRule[],
) =>
  createAnnotatedBuffer(
    buffer,
    rules.flatMap((rule, index) => {
      const bounds = getRuleFocusBounds(rule);
      const polygonRegions = [...(rule.roi || []), ...(rule.paths || [])].map(
        (polygon) => ({
          polygon,
          color: rule.color || '#3b82f6',
          label: String(index + 1),
        }),
      );
      return [
        ...(bounds
          ? [
              {
                ...bounds,
                color: rule.color || '#3b82f6',
                label: String(index + 1),
              },
            ]
          : []),
        ...polygonRegions,
      ];
    }),
  );

const fingerprintBuffer = (buffer: Buffer) =>
  createHash('sha1').update(buffer).digest('hex');

const isSvgMimeType = (mimeType?: string) =>
  String(mimeType || '').toLowerCase().includes('svg');

const normalizeRegionRole = (value: unknown): PercentRegionRole | undefined => {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'rule_zone' ||
    normalized === 'defect_zone' ||
    normalized === 'context_region'
  ) {
    return normalized;
  }
  return undefined;
};

const normalizePercentRegion = (region: any): PercentRegion | null => {
  if (!region || typeof region !== 'object') return null;

  const polygon = Array.isArray(region?.polygon)
    ? region.polygon
        .map((point: any) => {
          const x = normalizePercentNumber(point?.x);
          const y = normalizePercentNumber(point?.y);
          return x == null || y == null ? null : { x, y };
        })
        .filter((point): point is PercentPoint => Boolean(point))
    : [];

  const x = normalizePercentNumber(region?.x);
  const y = normalizePercentNumber(region?.y);
  const w = normalizePercentNumber(region?.w);
  const h = normalizePercentNumber(region?.h);
  if (polygon.length === 0 && (x == null || y == null || w == null || h == null)) {
    return null;
  }

  return {
    x,
    y,
    w,
    h,
    polygon,
    regionRole: normalizeRegionRole(region?.regionRole),
    color: normalizeString(region?.color),
    label: normalizeString(region?.label),
  };
};

const getPercentRegionBounds = (region?: PercentRegion | null) => {
  if (!region) return null;
  if (
    region.x != null &&
    region.y != null &&
    region.w != null &&
    region.h != null &&
    region.w > 0 &&
    region.h > 0
  ) {
    return { x: region.x, y: region.y, w: region.w, h: region.h };
  }
  if (Array.isArray(region.polygon) && region.polygon.length > 0) {
    const xs = region.polygon.map((point) => point.x);
    const ys = region.polygon.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    if (width > 0 && height > 0) {
      return { x: minX, y: minY, w: width, h: height };
    }
  }
  return null;
};

const getPolygonArea = (polygon: PercentPoint[]) => {
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area / 2);
};

const getPercentRegionArea = (region?: PercentRegion | null) => {
  if (!region) return 0;
  if (Array.isArray(region.polygon) && region.polygon.length >= 3) {
    const polygonArea = getPolygonArea(region.polygon);
    if (polygonArea > 0) return polygonArea;
  }
  if (
    region.x != null &&
    region.y != null &&
    region.w != null &&
    region.h != null &&
    region.w > 0 &&
    region.h > 0
  ) {
    return region.w * region.h;
  }
  const bounds = getPercentRegionBounds(region);
  return bounds ? bounds.w * bounds.h : 0;
};

const getCoverageRatioAgainstAnchor = (
  candidate?: PercentRegion | null,
  anchor?: PercentRegion | null,
) => {
  const candidateBounds = getPercentRegionBounds(candidate);
  const anchorBounds = getPercentRegionBounds(anchor);
  if (!candidateBounds || !anchorBounds) return 0;

  const overlapW = Math.max(
    0,
    Math.min(candidateBounds.x + candidateBounds.w, anchorBounds.x + anchorBounds.w) -
      Math.max(candidateBounds.x, anchorBounds.x),
  );
  const overlapH = Math.max(
    0,
    Math.min(candidateBounds.y + candidateBounds.h, anchorBounds.y + anchorBounds.h) -
      Math.max(candidateBounds.y, anchorBounds.y),
  );
  const overlapArea = overlapW * overlapH;
  const anchorArea = anchorBounds.w * anchorBounds.h;
  if (anchorArea <= 0) return 0;
  return clampScore(overlapArea / anchorArea);
};

const buildPercentRegionKey = (region: PercentRegion) => {
  const round = (value: number | undefined) =>
    value == null ? 'na' : String(Math.round(value * 100) / 100);
  const polygon = Array.isArray(region.polygon)
    ? region.polygon
        .map((point) => `${round(point.x)}:${round(point.y)}`)
        .join('|')
    : '';
  return [
    region.regionRole || 'none',
    round(region.x),
    round(region.y),
    round(region.w),
    round(region.h),
    polygon,
  ].join('::');
};

const getRuleAnchorRegion = (rule: VisionValidationRule): PercentRegion | null => {
  const focusBounds = getRuleFocusBounds(rule);
  if (focusBounds) {
    return {
      ...focusBounds,
      regionRole: 'rule_zone',
      label: rule.name || rule.id,
    };
  }

  const firstPolygon = [...(rule.roi || []), ...(rule.paths || [])].find(
    (path) => path.length >= 3,
  );
  if (firstPolygon) {
    return {
      polygon: firstPolygon,
      regionRole: 'rule_zone',
      label: rule.name || rule.id,
    };
  }
  return null;
};

const flattenRuleRegions = (rule: VisionValidationRule): PercentRegion[] => {
  const regions: PercentRegion[] = [];
  if (rule.highlight) {
    regions.push({
      x: rule.highlight.x,
      y: rule.highlight.y,
      w: rule.highlight.w,
      h: rule.highlight.h,
      regionRole: 'rule_zone',
    });
  }
  for (const polygon of [...(rule.roi || []), ...(rule.paths || [])]) {
    if (polygon.length > 0) regions.push({ polygon, regionRole: 'rule_zone' });
  }
  return regions;
};

const ensureEvidenceRegions = (
  rule: VisionValidationRule,
  status: ValidationStatus,
  options?: {
    matchedRuleRegion?: PercentRegion | null;
    defectRegion?: PercentRegion | null;
    evidenceRegions?: PercentRegion[];
  },
): {
  matchedRuleRegion?: PercentRegion;
  defectRegion?: PercentRegion;
  evidenceRegions: PercentRegion[];
} => {
  const statusPolygonColor =
    status === 'PASS' ? STATUS_COLOR_MAP.PASS : STATUS_COLOR_MAP.FAIL;
  const fallbackRuleZone = getRuleAnchorRegion(rule) || flattenRuleRegions(rule)[0];
  const matchedRuleRegion =
    options?.matchedRuleRegion || fallbackRuleZone
      ? {
          ...(options?.matchedRuleRegion || fallbackRuleZone)!,
          regionRole: 'rule_zone' as PercentRegionRole,
          color:
            (options?.matchedRuleRegion || fallbackRuleZone)?.color ||
            statusPolygonColor,
          label:
            (options?.matchedRuleRegion || fallbackRuleZone)?.label ||
            `Zona de regla${rule.name ? ` · ${rule.name}` : ''}`,
        }
      : undefined;

  const defectRegion = options?.defectRegion
    ? {
        ...options.defectRegion,
        regionRole: 'defect_zone' as PercentRegionRole,
        color: options.defectRegion.color || STATUS_COLOR_MAP.FAIL,
        label:
          options.defectRegion.label ||
          `Incumplimiento${rule.name ? ` · ${rule.name}` : ''}`,
      }
    : undefined;

  const legacyRegions = (options?.evidenceRegions || []).map((region) => ({
    ...region,
    regionRole: region.regionRole || 'context_region',
    color: region.color || statusPolygonColor,
    label: region.label || rule.name || rule.id,
  }));

  const unique = new Set<string>();
  const evidenceRegions: PercentRegion[] = [];
  for (const region of [matchedRuleRegion, defectRegion, ...legacyRegions]) {
    if (!region) continue;
    const key = buildPercentRegionKey(region);
    if (unique.has(key)) continue;
    unique.add(key);
    evidenceRegions.push(region);
  }

  return {
    matchedRuleRegion,
    defectRegion,
    evidenceRegions,
  };
};

const buildChecksMap = (ruleResults: RuleEvaluation[]) =>
  Object.fromEntries(
    ruleResults.map((result) => [result.ruleId, result.status === 'PASS']),
  );

const averageScores = (scores: Array<number | null | undefined>) => {
  const finite = scores.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
};

@Injectable()
export class CvqaService {
  private readonly vertexAI: VertexAI | null = null;
  private readonly models: ModelClientEntry[] = [];
  private readonly compareTimeoutMs = parsePositiveInt(
    process.env.CVQA_COMPARE_TIMEOUT_MS,
    DEFAULT_COMPARE_TIMEOUT_MS,
  );

  constructor(private readonly prisma: PrismaService) {
    const projectId =
      process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const modelIds = buildModelIdChain();
    const preferGlobalEndpoint = modelIds.some(modelRequiresGlobalEndpoint);
    const locationResolution = resolveVertexLocation(
      ['VERTEX_AI_LOCATION', 'VERTEX_LOCATION'],
      { defaultLocation: preferGlobalEndpoint ? 'global' : 'us-central1' },
    );

    let location = locationResolution.location;
    if (preferGlobalEndpoint && String(location).toLowerCase() !== 'global') {
      console.warn(
        `[CVQA] Forcing Vertex location to "global" to support configured Gemini 3 model(s). Previous resolved location was "${location}".`,
      );
      location = 'global';
    }

    if (!projectId) {
      console.warn(
        'VERTEX_PROJECT_ID (or FIREBASE_PROJECT_ID) not found. AI features will be disabled.',
      );
      return;
    }

    if (locationResolution.configuredLocationUnsupported) {
      const configuredFrom = locationResolution.configuredEnv || 'VERTEX_LOCATION';
      console.warn(
        `[CVQA] ${configuredFrom}="${locationResolution.configuredLocation}" is not supported for these Vertex AI model calls. Using "${location}".`,
      );
    }

    this.vertexAI = new VertexAI({ project: projectId, location });
    this.models = modelIds.map((modelId) => ({
      modelId,
      client: this.vertexAI!.preview.getGenerativeModel({ model: modelId }),
    }));
  }

  private async generateContentWithFallback(
    request: Parameters<GenerativeModelPreview['generateContent']>[0],
  ): Promise<{
    response: Awaited<ReturnType<GenerativeModelPreview['generateContent']>>['response'];
    modelId: string;
  }> {
    if (this.models.length === 0) {
      throw new BadRequestException('Vertex AI is not configured.');
    }

    let lastError: unknown;
    for (let index = 0; index < this.models.length; index += 1) {
      const entry = this.models[index];
      try {
        const result = await withVertexRetry(
          () => entry.client.generateContent(request),
          {
            operationName: `CvqaService.generateContent:${entry.modelId}`,
            onRetry: ({
              attempt,
              nextAttempt,
              maxAttempts,
              delayMs,
              statusCode,
              errorMessage,
            }) => {
              console.warn(
                `[CVQA] Vertex retry (${entry.modelId}) ${attempt}/${maxAttempts} -> attempt ${nextAttempt} in ${delayMs}ms` +
                  `${statusCode ? ` (status ${statusCode})` : ''}: ${errorMessage}`,
              );
            },
          },
        );
        return { response: result.response, modelId: entry.modelId };
      } catch (error) {
        lastError = error;
        const errorMessage = extractErrorMessage(error).toLowerCase();
        const statusCode = extractStatusCode(error);
        const canFallback =
          index < this.models.length - 1 &&
          (statusCode === 400 ||
            statusCode === 404 ||
            statusCode === 429 ||
            statusCode === 500 ||
            statusCode === 503 ||
            errorMessage.includes('not found') ||
            errorMessage.includes('unsupported') ||
            errorMessage.includes('resource_exhausted') ||
            errorMessage.includes('quota') ||
            errorMessage.includes('rate limit'));
        if (!canFallback) {
          throw error;
        }
        console.warn(
          `[CVQA] Falling back from model "${entry.modelId}" due to error: ${extractErrorMessage(
            error,
          )}`,
        );
      }
    }

    throw lastError;
  }

  private logStage(stage: string, startedAt: number, details?: string) {
    const durationMs = Date.now() - startedAt;
    const suffix = details ? ` (${details})` : '';
    console.info(`[CVQA] ${stage} completed in ${durationMs}ms${suffix}`);
  }

  private async withCompareTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new HttpException(
            'La comparación CVQA excedió el tiempo límite del servicio. Intenta de nuevo.',
            HttpStatus.GATEWAY_TIMEOUT,
          ),
        );
      }, this.compareTimeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private async optimizeImageForVertex(
    buffer: Buffer,
    mimeType?: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    try {
      if (isSvgMimeType(mimeType)) {
        return {
          buffer: await sharp(buffer, { density: 144 })
            .resize(LIGHT_IMAGE_MAX_DIMENSION, LIGHT_IMAGE_MAX_DIMENSION, {
              fit: 'inside',
              withoutEnlargement: true,
              background: '#ffffff',
            })
            .flatten({ background: '#ffffff' })
            .png({ compressionLevel: 9 })
            .toBuffer(),
          mimeType: 'image/png',
        };
      }

      const image = sharp(buffer).rotate();
      const metadata = await image.metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      const isSmallImage =
        buffer.length <= SMALL_IMAGE_BYTES_THRESHOLD &&
        width > 0 &&
        height > 0 &&
        width <= LIGHT_IMAGE_MAX_DIMENSION &&
        height <= LIGHT_IMAGE_MAX_DIMENSION;

      if (isSmallImage) {
        if ((mimeType || '').toLowerCase() === 'image/jpeg') {
          return { buffer, mimeType: 'image/jpeg' };
        }
        return {
          buffer: await image.jpeg({ quality: 88 }).toBuffer(),
          mimeType: 'image/jpeg',
        };
      }

      return {
        buffer: await image
          .resize(DEFAULT_IMAGE_MAX_DIMENSION, DEFAULT_IMAGE_MAX_DIMENSION, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 88 })
          .toBuffer(),
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      console.warn('[CVQA] Image optimization failed, using original buffer', err);
      return {
        buffer,
        mimeType: mimeType || 'image/jpeg',
      };
    }
  }

  private async assessCaptureQuality(
    files: Express.Multer.File[],
  ): Promise<CaptureQualityAssessment> {
    if (!files.length) {
      return {
        status: 'REVIEW',
        blur: null,
        exposure: null,
        framing: null,
        occlusion: null,
        issues: ['No se recibió evidencia visual.'],
        recommendedAction: 'Sube al menos una fotografía de evidencia.',
      };
    }

    const blurScores: number[] = [];
    const exposureScores: number[] = [];
    const framingScores: number[] = [];
    const issues: string[] = [];

    for (const [index, file] of files.entries()) {
      try {
        const image = sharp(file.buffer).rotate().removeAlpha().greyscale();
        const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
        const sharpnessScore = clampScore((stats.sharpness || 0) / 14);
        const mean = stats.channels?.[0]?.mean ?? 128;
        const exposureScore = clampScore(1 - Math.abs(mean - 128) / 128);
        const minDimension = Math.min(metadata.width || 0, metadata.height || 0);
        const framingScore =
          minDimension >= 720 ? 1 : clampScore(minDimension / 720);
        blurScores.push(sharpnessScore);
        exposureScores.push(exposureScore);
        framingScores.push(framingScore);

        if (sharpnessScore < 0.28) {
          issues.push(`La foto ${index + 1} está borrosa.`);
        }
        if (exposureScore < 0.2) {
          issues.push(`La foto ${index + 1} tiene iluminación deficiente.`);
        }
        if (framingScore < 0.55) {
          issues.push(`La foto ${index + 1} tiene encuadre o resolución insuficiente.`);
        }
      } catch (error) {
        issues.push(`No se pudo analizar la calidad de la foto ${index + 1}.`);
      }
    }

    const blur = averageScores(blurScores);
    const exposure = averageScores(exposureScores);
    const framing = averageScores(framingScores);
    const status =
      issues.length > 0 &&
      (blur == null || blur < 0.28 || exposure == null || exposure < 0.2 || framing == null || framing < 0.55)
        ? 'REVIEW'
        : 'PASS';

    return {
      status,
      blur,
      exposure,
      framing,
      occlusion: null,
      issues,
      recommendedAction:
        status === 'REVIEW'
          ? 'Vuelve a capturar la evidencia con mejor enfoque, iluminación y encuadre.'
          : undefined,
    };
  }

  private buildRulePromptSummary(rules: VisionValidationRule[]) {
    return JSON.stringify(
      rules.map((rule) => ({
        id: rule.id,
        name: rule.name || null,
        description: rule.description,
        severity: rule.severity,
        checkType: rule.checkType,
        passCriteria: rule.passCriteria || null,
        strictnessPercent: rule.strictnessPercent,
        toleranceGuidance:
          rule.strictnessPercent >= 90
            ? 'Muy estricta: no permitas cambios pequeños.'
            : rule.strictnessPercent >= 75
              ? 'Estricta: tolerancia baja.'
              : rule.strictnessPercent >= 55
                ? 'Balanceada: permite variaciones menores.'
                : rule.strictnessPercent >= 35
                  ? 'Flexible: acepta pequeñas diferencias visuales.'
                  : 'Muy flexible: acepta variaciones visibles si la regla sigue cumpliéndose.',
        viewConstraint: rule.viewConstraint,
        humanReviewRequiredWhen: rule.humanReviewRequiredWhen,
        ruleZoneAnchor: getRuleAnchorRegion(rule),
        regionSummary: formatRuleRegionSummary(rule),
        negativeReferenceFileNames: (rule.negativeReferences || [])
          .map((entry) => entry.fileName)
          .filter(Boolean),
      })),
      null,
      2,
    );
  }

  private buildQualityPrompt(params: any, rules: VisionValidationRule[]) {
    const specName = params.specName || params.modelName || 'manual';
    const subjectLabel =
      normalizeString(params.subjectLabel) ||
      normalizeString(params.modelName) ||
      'Elemento inspeccionado';
    const notes = normalizeString(params.notes);
    const minimumEvidencePhotos = Math.max(
      1,
      Number(params.requiredEvidencePhotos) || 1,
    );
    const rulesJson = this.buildRulePromptSummary(rules);

    return `Eres un inspector de calidad industrial especializado en validación visual multimodal.

FUENTE DE VERDAD:
- La única fuente de verdad para aprobar o rechazar son las REGLAS ESTRUCTURADAS.
- No apruebes una pieza solo porque "se parece" a la referencia.
- Ignora cualquier descripción libre que no esté expresada en una regla estructurada.

EVIDENCIA DISPONIBLE:
- "Archivo a Inspeccionar N" = fotos del operador.
- "Archivo de Referencia N" = golden samples válidos.
- "Referencia negativa N" = ejemplo de incumplimiento. Úsalos para entender cómo se ve un FAIL.
- "Archivo de Referencia Anotado" = mapa visual de las zonas marcadas por el supervisor.

INSTRUCCIONES DE DECISIÓN:
- Evalúa cada regla por separado.
- Usa la mejor foto del operador para cada regla según su viewConstraint.
- Si una regla tiene viewConstraint = "multi_view_required", debes usar al menos 2 fotos del operador. Si no hay suficientes vistas útiles, esa regla queda en REVIEW.
- Si una regla crítica falla claramente, el overallStatus debe ser FAIL.
- Si la imagen es ambigua, borrosa, con mala iluminación, o la vista no permite comprobar la regla, usa REVIEW.
- Nunca conviertas automáticamente un FAIL en PASS.
- Si el tornillo, cabeza, borde, gap o plano sobresale cuando la regla pide flushness/al ras, es FAIL.
- Cuando la regla incluya ROI o zona marcada, esa zona es el ancla semántica obligatoria de la regla.
- Para cada regla, primero mapea la zona funcional completa en la foto del operador y devuélvela como matchedRuleRegion (preferiblemente usando un "polygon" detallado para mayor precisión visual).
- matchedRuleRegion no puede ser solo un parche pequeño de defecto; debe cubrir la zona completa equivalente a la regla.
- Si detectas incumplimiento puntual dentro de esa zona, reporta además defectRegion con la subzona específica (usa un "polygon" si es posible).
- En el campo "reason", debes explicar siempre de forma clara y concisa por qué la regla fue evaluada como PASS, FAIL o REVIEW. Si es FAIL, justifica exactamente el defecto encontrado.
- Si no puedes mapear con confianza la zona completa por perspectiva/oclusión/calidad, devuelve REVIEW y explica la causa.
- Para color_mark, permite pequeñas variaciones por iluminación, pero no apruebes si la marca no existe o el color es claramente incorrecto.
- Respeta strictnessPercent: 100% significa que no debes tolerar cambios pequeños; 0% significa que puedes tolerar pequeñas variaciones visuales mientras la regla siga cumpliéndose.

SALIDA OBLIGATORIA:
- Devuelve solo JSON válido con el esquema solicitado.
- matchedRuleRegion es obligatorio para cada regla y debe estar en coordenadas porcentuales 0..100 relativas a la foto del operador seleccionada.
- defectRegion es opcional y representa únicamente la subzona del incumplimiento.
- Para compatibilidad, en evidenceRegions incluye matchedRuleRegion y, cuando exista, también defectRegion.
- Siempre incluye sourceIndices para cada regla. Usa índices base 0.
- Si una región ya está marcada por el supervisor y coincide con la evidencia, puedes reutilizar esa misma zona.

CONTEXTO:
- Elemento inspeccionado: ${subjectLabel}
- Procedimiento/modelo: ${specName}
- Mínimo de fotos requerido por la solicitud: ${minimumEvidencePhotos}
${notes ? `- Notas: ${notes}` : ''}

REGLAS ESTRUCTURADAS:
${rulesJson}
`;
  }

  private getRuleNegativeReferenceMap(
    rules: VisionValidationRule[],
    negativeReferenceFiles: Express.Multer.File[],
  ) {
    const filesByName = new Map<string, Express.Multer.File[]>();
    for (const file of negativeReferenceFiles) {
      const key = normalizeFileName(file.originalname);
      if (!key) continue;
      const bucket = filesByName.get(key) || [];
      bucket.push(file);
      filesByName.set(key, bucket);
    }

    return rules.map((rule) => {
      const matchedFiles =
        (rule.negativeReferences || [])
          .flatMap((reference) =>
            reference.fileName
              ? filesByName.get(normalizeFileName(reference.fileName)) || []
              : [],
          )
          .filter(Boolean) || [];
      return { rule, files: matchedFiles };
    });
  }

  private normalizeModelRuleResults(
    rawResults: unknown,
    rules: VisionValidationRule[],
    evidenceCount: number,
  ): RuleEvaluation[] {
    const rawArray = Array.isArray(rawResults) ? rawResults : [];
    const byRuleId = new Map<string, any>();
    for (const entry of rawArray) {
      if (!entry || typeof entry !== 'object') continue;
      const key =
        normalizeString((entry as any).ruleId) ||
        normalizeString((entry as any).id) ||
        normalizeString((entry as any).name);
      if (key) byRuleId.set(key, entry);
    }

    return rules.map((rule) => {
      const raw =
        byRuleId.get(rule.id) ||
        byRuleId.get(rule.name || '') ||
        byRuleId.get(rule.description);
      const sourceIndices = Array.isArray(raw?.sourceIndices)
        ? raw.sourceIndices
            .map((value: any) => Number(value))
            .filter(
              (value: number) =>
                Number.isFinite(value) && value >= 0 && value < evidenceCount,
            )
        : rule.viewConstraint === 'multi_view_required'
          ? Array.from({ length: Math.min(2, evidenceCount) }, (_, index) => index)
          : evidenceCount > 0
            ? [0]
            : [];

      const rawEvidenceRegions = Array.isArray(raw?.evidenceRegions)
        ? raw.evidenceRegions
            .map((region: any) => normalizePercentRegion(region))
            .filter((region): region is PercentRegion => Boolean(region))
        : [];
      const fallbackRuleZone = getRuleAnchorRegion(rule) || flattenRuleRegions(rule)[0] || null;

      const sortedEvidenceByArea = [...rawEvidenceRegions].sort(
        (a, b) => getPercentRegionArea(b) - getPercentRegionArea(a),
      );

      let matchedRuleRegion =
        normalizePercentRegion(raw?.matchedRuleRegion) ||
        normalizePercentRegion(raw?.ruleRegion) ||
        sortedEvidenceByArea[0] ||
        null;
      let defectRegion =
        normalizePercentRegion(raw?.defectRegion) ||
        normalizePercentRegion(raw?.nonComplianceRegion) ||
        null;

      const reasonNotes: string[] = [];
      let forceReview = false;

      if (!matchedRuleRegion && fallbackRuleZone) {
        matchedRuleRegion = fallbackRuleZone;
        reasonNotes.push(
          'Se usó la zona definida por la regla como zona principal para mantener el anclaje semántico.',
        );
      }

      if (matchedRuleRegion && fallbackRuleZone) {
        const anchorArea = getPercentRegionArea(fallbackRuleZone);
        const matchedArea = getPercentRegionArea(matchedRuleRegion);
        const coverageRatio = getCoverageRatioAgainstAnchor(
          matchedRuleRegion,
          fallbackRuleZone,
        );
        const areaRatio =
          anchorArea > 0 && matchedArea > 0 ? matchedArea / anchorArea : 0;
        const looksLikeTinyPatch =
          areaRatio > 0 && areaRatio < MIN_RULE_ZONE_AREA_RATIO;
        const weakCoverage = coverageRatio < MIN_RULE_ZONE_COVERAGE_RATIO;

        if (looksLikeTinyPatch || weakCoverage) {
          if (!defectRegion) {
            defectRegion = matchedRuleRegion;
          }
          matchedRuleRegion = fallbackRuleZone;

          if (weakCoverage && coverageRatio < 0.05) {
            forceReview = true;
            reasonNotes.push(
              'No fue posible mapear con confianza la zona completa de la regla en esta vista; requiere revisión humana.',
            );
          } else {
            reasonNotes.push(
              'Se ajustó la salida para representar la zona completa de la regla; la subzona puntual se conserva como incumplimiento.',
            );
          }
        }
      }

      if (!matchedRuleRegion && !fallbackRuleZone) {
        forceReview = true;
        reasonNotes.push(
          'No se pudo determinar la zona principal de la regla a partir de la evidencia recibida.',
        );
      }

      const statusFromModel = normalizeStatus(raw?.status);
      const status = forceReview ? 'REVIEW' : statusFromModel;
      const normalizedRegions = ensureEvidenceRegions(rule, status, {
        matchedRuleRegion,
        defectRegion,
        evidenceRegions: rawEvidenceRegions,
      });
      const normalizedReason = normalizeString(raw?.reason);
      const reason = [
        normalizedReason,
        status === 'REVIEW' && !normalizedReason
          ? 'La evidencia no fue suficiente para validar esta regla.'
          : undefined,
        ...reasonNotes,
      ]
        .filter(Boolean)
        .join(' · ');

      const normalizedConfidence = normalizeScore(raw?.confidence);
      return {
        ruleId: rule.id,
        name: normalizeString(raw?.name) || rule.name || rule.description,
        status,
        confidence:
          (forceReview ? null : normalizedConfidence) ??
          (status === 'PASS'
            ? deriveThresholdsFromStrictness(rule.strictnessPercent).passMin
            : status === 'FAIL'
              ? 1
              : null),
        reason: reason || undefined,
        expectedState: normalizeString(raw?.expectedState) || rule.passCriteria,
        observedState: normalizeString(raw?.observedState),
        sourceIndices,
        matchedRuleRegion: normalizedRegions.matchedRuleRegion,
        defectRegion: normalizedRegions.defectRegion,
        evidenceRegions: normalizedRegions.evidenceRegions,
      };
    });
  }

  private mergeCaptureQuality(
    localQuality: CaptureQualityAssessment,
    modelQuality: any,
  ): CaptureQualityAssessment {
    const modelStatus = normalizeStatus(modelQuality?.status, localQuality.status);
    const issues = [
      ...new Set([
        ...localQuality.issues,
        ...normalizeStringArray(modelQuality?.issues),
      ]),
    ];
    const status =
      localQuality.status === 'REVIEW' || modelStatus === 'REVIEW'
        ? 'REVIEW'
        : localQuality.status === 'FAIL' || modelStatus === 'FAIL'
          ? 'FAIL'
          : 'PASS';

    return {
      status,
      blur: normalizeScore(modelQuality?.blur) ?? localQuality.blur,
      exposure: normalizeScore(modelQuality?.exposure) ?? localQuality.exposure,
      framing: normalizeScore(modelQuality?.framing) ?? localQuality.framing,
      occlusion: normalizeScore(modelQuality?.occlusion) ?? localQuality.occlusion,
      issues,
      recommendedAction:
        normalizeString(modelQuality?.recommendedAction) ||
        localQuality.recommendedAction,
    };
  }

  private computeOverallStatus(
    rules: VisionValidationRule[],
    ruleResults: RuleEvaluation[],
    captureQuality: CaptureQualityAssessment,
  ): ValidationStatus {
    if (captureQuality.status === 'REVIEW') return 'REVIEW';
    const criticalRuleIds = new Set(
      rules.filter((rule) => rule.severity === 'critical').map((rule) => rule.id),
    );
    if (
      ruleResults.some(
        (result) =>
          result.status === 'FAIL' && criticalRuleIds.has(result.ruleId),
      )
    ) {
      return 'FAIL';
    }
    if (ruleResults.some((result) => result.status === 'FAIL')) return 'FAIL';
    if (ruleResults.some((result) => result.status === 'REVIEW')) return 'REVIEW';
    return 'PASS';
  }

  private buildReviewResponseForMissingViews(
    rules: VisionValidationRule[],
    evidenceCount: number,
  ): CompareResponse {
    const affectedRules = rules.filter(
      (rule) => rule.viewConstraint === 'multi_view_required',
    );
    const ruleResults = affectedRules.map((rule) => ({
      ...ensureEvidenceRegions(rule, 'REVIEW'),
      ruleId: rule.id,
      name: rule.name || rule.description,
      status: 'REVIEW' as ValidationStatus,
      confidence: null,
      reason:
        'La regla requiere varias vistas y no se recibieron suficientes fotos.',
      expectedState: rule.passCriteria,
      observedState: `Se recibieron ${evidenceCount} foto(s).`,
      sourceIndices: Array.from({ length: evidenceCount }, (_, index) => index),
    }));
    return {
      status: 'REVIEW',
      overallStatus: 'REVIEW',
      summary:
        'La validación requiere al menos 2 fotografías desde ángulos distintos para completar las reglas multiángulo.',
      issues: [
        'Faltan vistas complementarias para validar al menos una regla marcada como multi_view_required.',
      ],
      missing: ['Mínimo 2 fotos de evidencia'],
      confidence: null,
      overallConfidence: null,
      checks: buildChecksMap(ruleResults),
      captureQuality: {
        status: 'REVIEW',
        blur: null,
        exposure: null,
        framing: null,
        occlusion: null,
        issues: [
          'No se recibieron suficientes ángulos para completar la inspección.',
        ],
        recommendedAction:
          'Toma al menos 2 fotos desde ángulos distintos y vuelve a validar.',
      },
      ruleResults,
      recommendedAction:
        'Toma al menos 2 fotos desde ángulos distintos y vuelve a validar.',
    };
  }

  private async buildAnnotatedEvidenceImages(
    objectFiles: Express.Multer.File[],
    ruleResults: RuleEvaluation[],
  ): Promise<Array<{ url: string; label?: string; sourceIndex?: number }>> {
    const usedIndices = [
      ...new Set(ruleResults.flatMap((result) => result.sourceIndices)),
    ].filter((index) => index >= 0 && index < objectFiles.length);

    const indicesToRender =
      usedIndices.length > 0
        ? usedIndices
        : objectFiles.length > 0
          ? [0]
          : [];

    const images: Array<{ url: string; label?: string; sourceIndex?: number }> = [];
    for (const sourceIndex of indicesToRender) {
      const file = objectFiles[sourceIndex];
      if (!file) continue;
      const regions = ruleResults
        .filter((result) => result.sourceIndices.includes(sourceIndex))
        .flatMap((result) =>
          result.evidenceRegions.map((region) => ({
            ...region,
            color:
              region.color ||
              (result.status === 'PASS'
                ? STATUS_COLOR_MAP.PASS
                : STATUS_COLOR_MAP.FAIL),
            label: region.label || result.name || result.ruleId,
          })),
        );
      if (regions.length === 0) continue;
      try {
        const annotatedBuffer = await createAnnotatedBuffer(file.buffer, regions);
        if (!annotatedBuffer) continue;
        images.push({
          url: `data:image/jpeg;base64,${annotatedBuffer.toString('base64')}`,
          label: `Evidencia ${sourceIndex + 1}`,
          sourceIndex,
        });
      } catch (error) {
        console.warn('[CVQA] Failed to annotate evidence image', error);
      }
    }
    return images;
  }

  async compareVisionQuality(
    files: {
      manual?: Express.Multer.File[];
      object_file?: Express.Multer.File[];
      golden?: Express.Multer.File[];
      negative_reference?: Express.Multer.File[];
    },
    paramsString: string,
    user?: any,
    organizationId?: string,
  ): Promise<CompareResponse> {
    if (!this.models.length) {
      throw new BadRequestException('Vertex AI is not configured.');
    }

    try {
      const startedAt = Date.now();
      let params: Record<string, any> = {};
      if (paramsString) {
        try {
          params = JSON.parse(paramsString);
        } catch {
          throw new BadRequestException('Invalid params JSON');
        }
      }

      const rules = normalizeVisionValidationRules(params.rules);
      params = {
        ...params,
        subjectLabel:
          normalizeString(params.subjectLabel) ||
          normalizeString(params.modelName) ||
          undefined,
        requiredEvidencePhotos: Math.max(
          1,
          Number(params.requiredEvidencePhotos) || 1,
        ),
        rules,
      };
      this.logStage('params normalization', startedAt);

      const objectFiles = files.object_file || [];
      const goldenFiles = files.golden || [];
      const negativeReferenceFiles = files.negative_reference || [];
      const requiresMultiView = rules.some(
        (rule) => rule.viewConstraint === 'multi_view_required',
      );

      if (requiresMultiView && objectFiles.length < 2) {
        return this.buildReviewResponseForMissingViews(rules, objectFiles.length);
      }

      const localCaptureQuality = await this.assessCaptureQuality(objectFiles);
      this.logStage('local quality gate', startedAt);

      const promptText = this.buildQualityPrompt(params, rules);
      const parts: any[] = [{ text: promptText }];
      const optimizedCache = new Map<
        string,
        Promise<{ buffer: Buffer; mimeType: string }>
      >();

      const getOptimizedImage = (fileObj: Express.Multer.File) => {
        const cacheKey = `${fingerprintBuffer(fileObj.buffer)}:${fileObj.mimetype || ''}`;
        const existing = optimizedCache.get(cacheKey);
        if (existing) return existing;
        const next = this.optimizeImageForVertex(fileObj.buffer, fileObj.mimetype);
        optimizedCache.set(cacheKey, next);
        return next;
      };

      const addFilePart = async (label: string, fileObj?: Express.Multer.File) => {
        if (!fileObj) return;
        const optimized = await getOptimizedImage(fileObj);
        parts.push({ text: label });
        parts.push({
          inlineData: {
            mimeType: optimized.mimeType,
            data: optimized.buffer.toString('base64'),
          },
        });
      };

      const addBufferPart = async (
        label: string,
        buffer?: Buffer | null,
        mimeType?: string,
      ) => {
        if (!buffer) return;
        const optimized = await this.optimizeImageForVertex(buffer, mimeType);
        parts.push({ text: label });
        parts.push({
          inlineData: {
            mimeType: optimized.mimeType,
            data: optimized.buffer.toString('base64'),
          },
        });
      };

      await addFilePart('Archivo 1 (Manual/Especificación):', files.manual?.[0]);

      const primaryFilesAreIdentical =
        objectFiles.length > 0 &&
        goldenFiles.length > 0 &&
        objectFiles[0].buffer.equals(goldenFiles[0].buffer);

      for (let i = 0; i < objectFiles.length; i += 1) {
        await addFilePart(
          i === 0
            ? 'Archivo a Inspeccionar 1 (Objeto real):'
            : `Archivo a Inspeccionar ${i + 1} (Evidencia adicional):`,
          objectFiles[i],
        );
      }

      for (let i = 0; i < goldenFiles.length; i += 1) {
        if (i === 0 && primaryFilesAreIdentical) {
          parts.push({
            text:
              'Archivo de Referencia 1 (Golden Sample): idéntico byte a byte al objeto real principal. Usa la misma imagen como referencia y evidencia.',
          });
          continue;
        }
        await addFilePart(
          `Archivo de Referencia ${i + 1} (Golden Sample):`,
          goldenFiles[i],
        );
      }

      const negativeReferenceMap = this.getRuleNegativeReferenceMap(
        rules,
        negativeReferenceFiles,
      );
      for (const [index, entry] of negativeReferenceMap.entries()) {
        for (const [fileIndex, file] of entry.files.entries()) {
          await addFilePart(
            `Referencia negativa ${index + 1}.${fileIndex + 1} (incumplimiento para regla "${entry.rule.name || entry.rule.description}") :`,
            file,
          );
        }
      }

      if (goldenFiles[0] && rules.length > 0) {
        try {
          const annotatedGoldenBuffer = await createAnnotatedReferenceBuffer(
            goldenFiles[0].buffer,
            rules,
          );
          await addBufferPart(
            'Archivo de Referencia Anotado (Golden Sample con zonas marcadas):',
            annotatedGoldenBuffer,
            'image/jpeg',
          );
        } catch (error) {
          console.warn(
            '[CVQA] Failed to build annotated golden sample overlay',
            error,
          );
        }
      }
      this.logStage('image preparation', startedAt, `${parts.length} prompt parts`);

      const request = {
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
              overallStatus: {
                type: 'STRING' as any,
                enum: VALID_STATUSES,
              },
              overallConfidence: { type: 'NUMBER' as any },
              summary: { type: 'STRING' as any },
              issues: { type: 'ARRAY' as any, items: { type: 'STRING' as any } },
              missing: { type: 'ARRAY' as any, items: { type: 'STRING' as any } },
              recommendedAction: { type: 'STRING' as any },
              captureQuality: {
                type: 'OBJECT' as any,
                properties: {
                  status: {
                    type: 'STRING' as any,
                    enum: VALID_STATUSES,
                  },
                  blur: { type: 'NUMBER' as any },
                  exposure: { type: 'NUMBER' as any },
                  framing: { type: 'NUMBER' as any },
                  occlusion: { type: 'NUMBER' as any },
                  issues: {
                    type: 'ARRAY' as any,
                    items: { type: 'STRING' as any },
                  },
                  recommendedAction: { type: 'STRING' as any },
                },
                required: ['status'],
              },
              ruleResults: {
                type: 'ARRAY' as any,
                items: {
                  type: 'OBJECT' as any,
                  properties: {
                    ruleId: { type: 'STRING' as any },
                    name: { type: 'STRING' as any },
                    status: {
                      type: 'STRING' as any,
                      enum: VALID_STATUSES,
                    },
                    confidence: { type: 'NUMBER' as any },
                    reason: { type: 'STRING' as any },
                    expectedState: { type: 'STRING' as any },
                    observedState: { type: 'STRING' as any },
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
                        label: { type: 'STRING' as any },
                        color: { type: 'STRING' as any },
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
                        label: { type: 'STRING' as any },
                        color: { type: 'STRING' as any },
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
                          label: { type: 'STRING' as any },
                          color: { type: 'STRING' as any },
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
      };

      const { response, modelId } = await this.withCompareTimeout(async () =>
        this.generateContentWithFallback(request),
      );
      this.logStage('vertex compare', startedAt, modelId);
      const responseText =
        response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

      let jsonResult: any;
      try {
        jsonResult = JSON.parse(responseText);
      } catch {
        console.error('[CVQA] QA Vision parse error:', responseText);
        jsonResult = {
          overallStatus: 'REVIEW',
          summary: 'Error procesando la respuesta de la IA.',
          issues: ['Error interno al leer JSON'],
          captureQuality: {
            status: 'REVIEW',
            issues: ['No se pudo interpretar la respuesta del modelo.'],
          },
          ruleResults: [],
        };
      }

      const captureQuality = this.mergeCaptureQuality(
        localCaptureQuality,
        jsonResult.captureQuality,
      );
      const ruleResults = this.normalizeModelRuleResults(
        jsonResult.ruleResults,
        rules,
        objectFiles.length,
      );
      const overallStatus = this.computeOverallStatus(
        rules,
        ruleResults,
        captureQuality,
      );
      const overallConfidence =
        normalizeScore(jsonResult.overallConfidence) ??
        averageScores(ruleResults.map((result) => result.confidence));
      const annotatedImages = await this.buildAnnotatedEvidenceImages(
        objectFiles,
        ruleResults,
      );
      const recommendedAction =
        normalizeString(jsonResult.recommendedAction) ||
        captureQuality.recommendedAction ||
        (overallStatus === 'REVIEW'
          ? 'Recaptura la evidencia o envía la pieza a revisión humana.'
          : undefined);

      return {
        status: overallStatus,
        overallStatus,
        summary:
          normalizeString(jsonResult.summary) ||
          (overallStatus === 'PASS'
            ? 'La evidencia cumple las reglas definidas.'
            : overallStatus === 'FAIL'
              ? 'La evidencia no cumple una o más reglas definidas.'
              : 'La evidencia no fue suficiente para una decisión confiable.'),
        issues: normalizeStringArray(jsonResult.issues),
        missing: normalizeStringArray(jsonResult.missing),
        confidence: overallConfidence,
        overallConfidence,
        checks: buildChecksMap(ruleResults),
        captureQuality,
        ruleResults,
        annotatedImage: annotatedImages[0]?.url,
        annotatedImages,
        recommendedAction,
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
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error en la validación por IA: ' + errorMessage,
      );
    }
  }

  async validateRulesLogic(
    payload: {
      rules: any[];
      subjectLabel?: string;
    },
    referenceImage?: Express.Multer.File,
  ): Promise<{ status: 'valid' | 'invalid'; message?: string }> {
    try {
      const rules = normalizeVisionValidationRules(payload?.rules);
      if (rules.length === 0) {
        return {
          status: 'invalid',
          message:
            'Agrega al menos una regla estructurada antes de comprobar la coherencia.',
        };
      }

      const subjectLabel =
        typeof payload?.subjectLabel === 'string' && payload.subjectLabel.trim()
          ? payload.subjectLabel.trim()
          : 'Elemento visual';
      const rulesText = this.buildRulePromptSummary(rules);

      const promptText = `
Eres un experto inspector de calidad industrial.
Debes evaluar si un conjunto de reglas visuales estructuradas y la imagen de referencia son coherentes y viables para una validación automática por IA.

Contexto:
- Elemento inspeccionado: ${subjectLabel}
- Si recibes una imagen "Referencia anotada", usa las zonas pintadas como evidencia principal de dónde quiere inspeccionar el supervisor.

Verifica si existe alguno de estos problemas:
1. Reglas lógicamente imposibles o contradictorias.
2. Reglas ambiguas o no observables en una foto real.
3. Reglas que deberían ser multiángulo pero están marcadas como una sola vista.
4. Zonas marcadas incoherentes con la regla: apuntan al lugar equivocado, están vacías, demasiado amplias o demasiado pequeñas.
5. La foto base no es suficiente para validar esas reglas por ángulo, resolución, iluminación o encuadre.

Reglas estructuradas:
${rulesText}

Responde ÚNICAMENTE con JSON en este formato estricto:
{
  "status": "valid" | "invalid",
  "message": "Si es invalid, explica qué regla o zona debe corregirse y cómo."
}
      `;

      const parts: any[] = [{ text: promptText }];
      const addBufferPart = async (label: string, buffer?: Buffer | null) => {
        if (!buffer) return;
        const optimized = await this.optimizeImageForVertex(buffer, 'image/jpeg');
        parts.push({ text: label });
        parts.push({
          inlineData: {
            mimeType: optimized.mimeType,
            data: optimized.buffer.toString('base64'),
          },
        });
      };

      if (referenceImage?.buffer) {
        await addBufferPart('Imagen de Referencia:', referenceImage.buffer);
        try {
          const annotatedBuffer = await createAnnotatedReferenceBuffer(
            referenceImage.buffer,
            rules,
          );
          await addBufferPart(
            'Referencia anotada con reglas y zonas marcadas:',
            annotatedBuffer,
          );
        } catch (error) {
          console.warn(
            '[CVQA] Failed to build annotated reference during rules validation',
            error,
          );
        }
      }

      const request = {
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

      const { response } = await this.generateContentWithFallback(request);
      const responseText =
        response.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

      let jsonResult;
      try {
        jsonResult = JSON.parse(responseText);
      } catch {
        console.error('[CVQA] Rules validation parse error:', responseText);
        return {
          status: 'invalid',
          message: 'No se pudo analizar la respuesta de validación.',
        };
      }

      return {
        status: jsonResult?.status === 'valid' ? 'valid' : 'invalid',
        message: normalizeString(jsonResult?.message),
      };
    } catch (error: any) {
      console.error(
        '[CVQA] Rules Validation Error:',
        error.message || error,
      );
      throw new InternalServerErrorException(
        'Error al pre-validar las reglas con IA: ' + (error.message || ''),
      );
    }
  }

  async saveTrainingExample(
    organizationId: string,
    userId: string,
    inputPayload: any,
    originalOutput: any,
    correctedOutput: any,
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
