import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

// @ts-ignore
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends (PrismaClient as any) implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL or DATABASE_URL_DIRECT is required to initialize Prisma.');
    }

    const wantsSsl =
      connectionString.includes('sslmode=require') ||
      process.env.DATABASE_SSL === 'true';
    const ssl = wantsSsl ? { rejectUnauthorized: false } : undefined;

    const pool = new Pool({
      connectionString,
      ssl,
      idleTimeoutMillis: 30_000,
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end().catch(() => {});
  }
}
