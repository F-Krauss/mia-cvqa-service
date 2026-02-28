"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVertexApiEndpoint = exports.resolveVertexLocation = void 0;
const DEFAULT_VERTEX_LOCATION = 'us-central1';
const KNOWN_UNSUPPORTED_VERTEX_LOCATIONS = new Set(['northamerica-south1']);
const readFirstEnv = (envVars) => {
    for (const envVar of envVars) {
        const value = String(process.env[envVar] || '').trim();
        if (value)
            return { value, env: envVar };
    }
    return { value: null, env: null };
};
const normalizeLocation = (value) => String(value || '').trim().toLowerCase();
const resolveVertexLocation = (preferredEnvVars, options) => {
    const defaultLocation = String(options?.defaultLocation || DEFAULT_VERTEX_LOCATION).trim();
    const fallbackEnvVar = String(options?.fallbackEnvVar || 'VERTEX_FALLBACK_LOCATION').trim();
    const configured = readFirstEnv(preferredEnvVars);
    const configuredLocation = configured.value || null;
    const configuredLocationNormalized = normalizeLocation(configuredLocation);
    const configuredLocationUnsupported = KNOWN_UNSUPPORTED_VERTEX_LOCATIONS.has(configuredLocationNormalized);
    const fallbackConfigured = String(process.env[fallbackEnvVar] || '').trim();
    const fallbackLocationCandidate = fallbackConfigured || defaultLocation;
    const fallbackLocation = KNOWN_UNSUPPORTED_VERTEX_LOCATIONS.has(normalizeLocation(fallbackLocationCandidate))
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
exports.resolveVertexLocation = resolveVertexLocation;
const buildVertexApiEndpoint = (location) => `${String(location || '').trim()}-aiplatform.googleapis.com`;
exports.buildVertexApiEndpoint = buildVertexApiEndpoint;
//# sourceMappingURL=vertex-location.js.map