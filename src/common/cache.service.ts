import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

type LocalCacheEntry = {
  value: string;
  expiresAt: number;
};

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly localCache = new Map<string, LocalCacheEntry>();
  private readonly redisUrl = String(process.env.REDIS_URL || '').trim();
  private readonly redisClient: RedisClientType | null;
  private redisReady = false;

  constructor() {
    if (!this.redisUrl) {
      this.redisClient = null;
      this.logger.log('REDIS_URL not configured. Using in-memory cache fallback.');
      return;
    }

    this.redisClient = createClient({ url: this.redisUrl });
    this.redisClient.on('error', (error: any) => {
      this.redisReady = false;
      this.logger.warn(`Redis error. Falling back to in-memory cache: ${error?.message || error}`);
    });

    this.redisClient
      .connect()
      .then(() => {
        this.redisReady = true;
        this.logger.log('Redis cache connected.');
      })
      .catch((error: any) => {
        this.redisReady = false;
        this.logger.warn(
          `Redis connect failed. Using in-memory cache fallback: ${error?.message || error}`,
        );
      });
  }

  async onModuleDestroy() {
    if (!this.redisClient) return;
    try {
      await this.redisClient.quit();
    } catch {
      // Ignore quit errors during shutdown.
    }
  }

  private getLocal<T>(key: string): T | null {
    const cached = this.localCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.localCache.delete(key);
      return null;
    }

    try {
      return JSON.parse(cached.value) as T;
    } catch {
      this.localCache.delete(key);
      return null;
    }
  }

  private setLocal(key: string, value: unknown, ttlSeconds: number) {
    const expiresAt = Date.now() + Math.max(1, ttlSeconds) * 1000;
    this.localCache.set(key, {
      value: JSON.stringify(value),
      expiresAt,
    });
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (this.redisClient && this.redisReady) {
      try {
        const raw = await this.redisClient.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
      } catch (error: any) {
        this.logger.warn(
          `Redis get failed for key ${key}. Falling back to in-memory cache: ${error?.message || error}`,
        );
      }
    }

    return this.getLocal<T>(key);
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.redisClient && this.redisReady) {
      try {
        await this.redisClient.set(key, JSON.stringify(value), {
          EX: Math.max(1, ttlSeconds),
        });
        return;
      } catch (error: any) {
        this.logger.warn(
          `Redis set failed for key ${key}. Falling back to in-memory cache: ${error?.message || error}`,
        );
      }
    }

    this.setLocal(key, value, ttlSeconds);
  }
}
