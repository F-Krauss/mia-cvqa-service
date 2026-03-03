"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withVertexRetry = exports.isRetryableVertexError = exports.extractErrorMessage = void 0;
const RETRYABLE_HTTP_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_MARKERS = [
    'resource_exhausted',
    'too many requests',
    'rate limit',
    'quota exceeded',
    'unavailable',
    'deadline exceeded',
    'timed out',
    'timeout',
    'socket hang up',
    'econnreset',
    'etimedout',
    'eai_again',
];
const parsePositiveInt = (value, fallback) => {
    if (!value)
        return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const DEFAULT_MAX_ATTEMPTS = Math.max(1, parsePositiveInt(process.env.VERTEX_RETRY_MAX_ATTEMPTS, 4));
const DEFAULT_INITIAL_DELAY_MS = Math.max(50, parsePositiveInt(process.env.VERTEX_RETRY_INITIAL_DELAY_MS, 500));
const DEFAULT_MAX_DELAY_MS = Math.max(DEFAULT_INITIAL_DELAY_MS, parsePositiveInt(process.env.VERTEX_RETRY_MAX_DELAY_MS, 8000));
const DEFAULT_BACKOFF_MULTIPLIER = Number.isFinite(Number(process.env.VERTEX_RETRY_BACKOFF_MULTIPLIER))
    ? Math.max(1, Number(process.env.VERTEX_RETRY_BACKOFF_MULTIPLIER))
    : 2;
const extractStatusCode = (error) => {
    const candidates = [
        error?.status,
        error?.code,
        error?.response?.status,
        error?.error?.code,
        error?.cause?.status,
        error?.cause?.code,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'number' && candidate >= 100 && candidate <= 599) {
            return candidate;
        }
        if (typeof candidate === 'string') {
            const parsed = Number.parseInt(candidate, 10);
            if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 599) {
                return parsed;
            }
        }
    }
    const message = (0, exports.extractErrorMessage)(error);
    const statusMatch = message.match(/\bstatus\s*[:=]\s*(\d{3})\b/i);
    if (statusMatch?.[1])
        return Number.parseInt(statusMatch[1], 10);
    const codeMatch = message.match(/\bcode\s*[:=]\s*(\d{3})\b/i);
    if (codeMatch?.[1])
        return Number.parseInt(codeMatch[1], 10);
    return undefined;
};
const extractErrorMessage = (error) => {
    if (!error)
        return 'Unknown error';
    if (typeof error === 'string')
        return error;
    const anyError = error;
    const parts = [];
    if (typeof anyError.message === 'string' && anyError.message.trim()) {
        parts.push(anyError.message.trim());
    }
    if (typeof anyError.error?.message === 'string' &&
        anyError.error.message.trim()) {
        parts.push(anyError.error.message.trim());
    }
    if (typeof anyError.response?.data?.error?.message === 'string' &&
        anyError.response.data.error.message.trim()) {
        parts.push(anyError.response.data.error.message.trim());
    }
    if (parts.length > 0)
        return parts.join(' | ');
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
};
exports.extractErrorMessage = extractErrorMessage;
const isRetryableVertexError = (error) => {
    const statusCode = extractStatusCode(error);
    if (statusCode && RETRYABLE_HTTP_CODES.has(statusCode))
        return true;
    const normalizedMessage = (0, exports.extractErrorMessage)(error).toLowerCase();
    return RETRYABLE_MARKERS.some((marker) => normalizedMessage.includes(marker));
};
exports.isRetryableVertexError = isRetryableVertexError;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withVertexRetry = async (operation, options) => {
    const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const initialDelayMs = Math.max(1, options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
    const maxDelayMs = Math.max(initialDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
    const backoffMultiplier = Math.max(1, options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER);
    const shouldRetry = options.shouldRetry ?? exports.isRetryableVertexError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            const retryable = shouldRetry(error);
            if (!retryable || attempt >= maxAttempts) {
                throw error;
            }
            const exponentialCap = Math.min(maxDelayMs, Math.round(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1)));
            const delayMs = Math.floor(Math.random() * (exponentialCap + 1));
            options.onRetry?.({
                operationName: options.operationName,
                attempt,
                nextAttempt: attempt + 1,
                maxAttempts,
                delayMs,
                statusCode: extractStatusCode(error),
                errorMessage: (0, exports.extractErrorMessage)(error),
            });
            await sleep(delayMs);
        }
    }
    throw new Error(`Unexpected retry loop termination for operation "${options.operationName}"`);
};
exports.withVertexRetry = withVertexRetry;
//# sourceMappingURL=vertex-retry.js.map