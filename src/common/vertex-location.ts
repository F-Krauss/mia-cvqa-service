const DEFAULT_VERTEX_LOCATION = 'us-central1';

// Some Cloud Run regions are not valid Vertex AI model regions for these APIs.
const KNOWN_UNSUPPORTED_VERTEX_LOCATIONS = new Set(['northamerica-south1']);

export type VertexLocationResolution = {
  location: string;
  configuredLocation: string | null;
  configuredEnv: string | null;
  fallbackLocation: string;
  usedFallback: boolean;
  configuredLocationUnsupported: boolean;
};

const readFirstEnv = (envVars: string[]): { value: string | null; env: string | null } => {
  for (const envVar of envVars) {
    const value = String(process.env[envVar] || '').trim();
    if (value) return { value, env: envVar };
  }
  return { value: null, env: null };
};

const normalizeLocation = (value: string | null | undefined): string =>
  String(value || '').trim().toLowerCase();

export const resolveVertexLocation = (
  preferredEnvVars: string[],
  options?: { fallbackEnvVar?: string; defaultLocation?: string },
): VertexLocationResolution => {
  const defaultLocation = String(options?.defaultLocation || DEFAULT_VERTEX_LOCATION).trim();
  const fallbackEnvVar = String(options?.fallbackEnvVar || 'VERTEX_FALLBACK_LOCATION').trim();
  const configured = readFirstEnv(preferredEnvVars);
  const configuredLocation = configured.value || null;
  const configuredLocationNormalized = normalizeLocation(configuredLocation);
  const configuredLocationUnsupported = KNOWN_UNSUPPORTED_VERTEX_LOCATIONS.has(
    configuredLocationNormalized,
  );

  const fallbackConfigured = String(process.env[fallbackEnvVar] || '').trim();
  const fallbackLocationCandidate = fallbackConfigured || defaultLocation;
  const fallbackLocation =
    KNOWN_UNSUPPORTED_VERTEX_LOCATIONS.has(normalizeLocation(fallbackLocationCandidate))
      ? defaultLocation
      : fallbackLocationCandidate;

  let location = configuredLocation || defaultLocation;
  let usedFallback = false;
  if (configuredLocationUnsupported) {
    location = fallbackLocation;
    usedFallback = normalizeLocation(location) !== configuredLocationNormalized;
  }

  return {
    location,
    configuredLocation,
    configuredEnv: configured.env,
    fallbackLocation,
    usedFallback,
    configuredLocationUnsupported,
  };
};

export const buildVertexApiEndpoint = (location: string): string =>
  `${String(location || '').trim()}-aiplatform.googleapis.com`;
