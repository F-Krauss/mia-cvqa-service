import type { Request } from 'express';
export declare class AiRemoteService {
    private readonly logger;
    private readonly baseUrl;
    constructor();
    get enabled(): boolean;
    forward<T>(req: Request, body?: unknown): Promise<T>;
    private extractErrorMessage;
}
