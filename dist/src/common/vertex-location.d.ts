export type VertexLocationResolution = {
    location: string;
    configuredLocation: string | null;
    configuredEnv: string | null;
    fallbackLocation: string;
    usedFallback: boolean;
    configuredLocationUnsupported: boolean;
};
export declare const resolveVertexLocation: (preferredEnvVars: string[], options?: {
    fallbackEnvVar?: string;
    defaultLocation?: string;
}) => VertexLocationResolution;
export declare const buildVertexApiEndpoint: (location: string) => string;
