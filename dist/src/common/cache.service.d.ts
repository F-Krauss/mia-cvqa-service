import { OnModuleDestroy } from '@nestjs/common';
export declare class CacheService implements OnModuleDestroy {
    private readonly logger;
    private readonly localCache;
    private readonly redisUrl;
    private readonly redisClient;
    private redisReady;
    constructor();
    onModuleDestroy(): Promise<void>;
    private getLocal;
    private setLocal;
    getJson<T>(key: string): Promise<T | null>;
    setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}
