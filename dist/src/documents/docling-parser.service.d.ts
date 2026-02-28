export declare class DoclingParserService {
    private readonly logger;
    private readonly serviceUrl;
    private readonly apiKey;
    private readonly timeoutMs;
    constructor();
    get isEnabled(): boolean;
    parseGcsDocument(gcsBucket: string, gcsPath: string): Promise<string>;
    parsePdf(gcsBucket: string, gcsPath: string): Promise<string>;
}
