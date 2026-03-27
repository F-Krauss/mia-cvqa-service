import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

// @ts-ignore
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { URL } from 'node:url';

const normalizeConnectionString = (value?: string) => {
  if (!value) return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const resolveAppEnvironment = () => {
  const raw = String(process.env.APP_ENVIRONMENT || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'test' || raw === 'prod') return raw;
  throw new Error(
    `APP_ENVIRONMENT must be either "test" or "prod", received "${process.env.APP_ENVIRONMENT}".`,
  );
};

const extractSchemaFromConnectionString = (rawUrl?: string) => {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const schema = url.searchParams.get('schema');
    if (!schema) return undefined;
    const trimmed = schema.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
};

const applySchemaSearchPath = (rawUrl: string, schema?: string) => {
  if (!rawUrl || !schema) return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.delete('schema');
    return url.toString();
  } catch {
    return rawUrl;
  }
};

const validateEnvironmentSchema = (schema?: string) => {
  const appEnvironment = resolveAppEnvironment();
  if (!schema) {
    throw new Error(
      'DATABASE_SCHEMA or a schema= query parameter must be configured before Prisma startup.',
    );
  }
  if (process.env.NODE_ENV === 'production' && !appEnvironment) {
    throw new Error(
      'APP_ENVIRONMENT must be set to "test" or "prod" in production deployments.',
    );
  }
  if (appEnvironment === 'test' && schema !== 'mia-test') {
    throw new Error(
      `APP_ENVIRONMENT=test requires DATABASE_SCHEMA=mia-test. Received "${schema}".`,
    );
  }
  if (appEnvironment === 'prod' && schema === 'mia-test') {
    throw new Error(
      'APP_ENVIRONMENT=prod cannot run against DATABASE_SCHEMA=mia-test.',
    );
  }
};

@Injectable()
export class PrismaService extends (PrismaClient as any) implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const rawConnectionString = normalizeConnectionString(
      process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
    );
    if (!rawConnectionString) {
      throw new Error('DATABASE_URL or DATABASE_URL_DIRECT is required to initialize Prisma.');
    }
    const schema =
      process.env.DATABASE_SCHEMA?.trim() ||
      extractSchemaFromConnectionString(rawConnectionString);
    validateEnvironmentSchema(schema);
    const connectionString = applySchemaSearchPath(rawConnectionString, schema);

    const wantsSsl =
      connectionString.includes('sslmode=require') ||
      process.env.DATABASE_SSL === 'true';
    const ssl = wantsSsl ? { rejectUnauthorized: false } : undefined;
    const safeSchema = schema ? schema.replace(/"/g, '""') : undefined;

    const pool = new Pool({
      connectionString,
      ssl,
      idleTimeoutMillis: 30_000,
      ...(safeSchema ? { options: `-c search_path="${safeSchema}",public` } : {}),
    });

    if (safeSchema) {
      pool.on('connect', (client) => {
        client.query(`SET search_path TO "${safeSchema}", public`).catch(() => {});
      });
    }

    const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
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
