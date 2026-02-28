type RetryableOperation<T> = () => Promise<T>;
export type VertexRetryEvent = {
    operationName: string;
    attempt: number;
    nextAttempt: number;
    maxAttempts: number;
    delayMs: number;
    statusCode?: number;
    errorMessage: string;
};
export type VertexRetryOptions = {
    operationName: string;
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    shouldRetry?: (error: unknown) => boolean;
    onRetry?: (event: VertexRetryEvent) => void;
};
export declare const extractErrorMessage: (error: unknown) => string;
export declare const isRetryableVertexError: (error: unknown) => boolean;
export declare const withVertexRetry: <T>(operation: RetryableOperation<T>, options: VertexRetryOptions) => Promise<T>;
export {};
