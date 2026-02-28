"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var CacheService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheService = void 0;
const common_1 = require("@nestjs/common");
const redis_1 = require("redis");
let CacheService = CacheService_1 = class CacheService {
    logger = new common_1.Logger(CacheService_1.name);
    localCache = new Map();
    redisUrl = String(process.env.REDIS_URL || '').trim();
    redisClient;
    redisReady = false;
    constructor() {
        if (!this.redisUrl) {
            this.redisClient = null;
            this.logger.log('REDIS_URL not configured. Using in-memory cache fallback.');
            return;
        }
        this.redisClient = (0, redis_1.createClient)({ url: this.redisUrl });
        this.redisClient.on('error', (error) => {
            this.redisReady = false;
            this.logger.warn(`Redis error. Falling back to in-memory cache: ${error?.message || error}`);
        });
        this.redisClient
            .connect()
            .then(() => {
            this.redisReady = true;
            this.logger.log('Redis cache connected.');
        })
            .catch((error) => {
            this.redisReady = false;
            this.logger.warn(`Redis connect failed. Using in-memory cache fallback: ${error?.message || error}`);
        });
    }
    async onModuleDestroy() {
        if (!this.redisClient)
            return;
        try {
            await this.redisClient.quit();
        }
        catch {
        }
    }
    getLocal(key) {
        const cached = this.localCache.get(key);
        if (!cached)
            return null;
        if (cached.expiresAt <= Date.now()) {
            this.localCache.delete(key);
            return null;
        }
        try {
            return JSON.parse(cached.value);
        }
        catch {
            this.localCache.delete(key);
            return null;
        }
    }
    setLocal(key, value, ttlSeconds) {
        const expiresAt = Date.now() + Math.max(1, ttlSeconds) * 1000;
        this.localCache.set(key, {
            value: JSON.stringify(value),
            expiresAt,
        });
    }
    async getJson(key) {
        if (this.redisClient && this.redisReady) {
            try {
                const raw = await this.redisClient.get(key);
                if (!raw)
                    return null;
                return JSON.parse(raw);
            }
            catch (error) {
                this.logger.warn(`Redis get failed for key ${key}. Falling back to in-memory cache: ${error?.message || error}`);
            }
        }
        return this.getLocal(key);
    }
    async setJson(key, value, ttlSeconds) {
        if (this.redisClient && this.redisReady) {
            try {
                await this.redisClient.set(key, JSON.stringify(value), {
                    EX: Math.max(1, ttlSeconds),
                });
                return;
            }
            catch (error) {
                this.logger.warn(`Redis set failed for key ${key}. Falling back to in-memory cache: ${error?.message || error}`);
            }
        }
        this.setLocal(key, value, ttlSeconds);
    }
};
exports.CacheService = CacheService;
exports.CacheService = CacheService = CacheService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], CacheService);
//# sourceMappingURL=cache.service.js.map