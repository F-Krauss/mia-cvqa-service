import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { URL } from 'node:url';
import { AsyncLocalStorage } from 'async_hooks';

export const requestContext = new AsyncLocalStorage<{ organizationId?: string }>();

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

const extractSchemaFromConnectionString = (rawUrl?: string) => {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const schema = url.searchParams.get('schema');
    if (!schema) return undefined;
    const trimmed = schema.trim();
    return trimmed || undefined;
  } catch (err) {
    console.warn('[Prisma] Failed to parse schema from connection URL:', err);
    return undefined;
  }
};

const applySchemaSearchPath = (rawUrl: string, schema?: string) => {
  if (!rawUrl || !schema) return rawUrl;
  try {
    const url = new URL(rawUrl);
    // Remove conflicting schema/options params; we'll use search_path callback
    url.searchParams.delete('schema');
    return url.toString();
  } catch (err) {
    console.warn('[Prisma] Failed to parse connection URL:', err);
    return rawUrl;
  }
};

const parsePositiveInt = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const getConnectionLimit = (rawUrl?: string) => {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    return parsePositiveInt(url.searchParams.get('connection_limit') || undefined);
  } catch (err) {
    console.warn('[Prisma] Failed to parse connection limit from URL:', err);
    return undefined;
  }
};

const resolvePoolMax = (rawUrl: string) => {
  const envMax =
    parsePositiveInt(process.env.DATABASE_POOL_MAX) ||
    parsePositiveInt(process.env.PG_POOL_MAX) ||
    parsePositiveInt(process.env.PGPOOL_MAX);
  if (envMax) return envMax;

  const urlLimit = getConnectionLimit(rawUrl);
  if (urlLimit) return urlLimit;

  const isPooler =
    rawUrl.includes('pooler.supabase.com') || rawUrl.includes('pgbouncer=true');
  return isPooler ? 3 : undefined;
};

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
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
    const connectionString = applySchemaSearchPath(
      rawConnectionString,
      schema,
    );
    console.log('[Prisma] Schema:', schema);
    const sslRejectUnauthorizedRaw =
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    const sslRejectUnauthorized =
      sslRejectUnauthorizedRaw &&
      sslRejectUnauthorizedRaw.trim().toLowerCase() === 'false';
    if (sslRejectUnauthorized) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    const rejectUnauthorized = !sslRejectUnauthorized;
    const wantsSsl =
      connectionString.includes('sslmode=require') ||
      process.env.DATABASE_SSL === 'true' ||
      sslRejectUnauthorized;
    const ssl = wantsSsl ? { rejectUnauthorized } : undefined;
    const safeSchema = schema ? schema.replace(/"/g, '""') : undefined;
    const poolMax = resolvePoolMax(connectionString);
    const pool = new Pool({
      connectionString,
      ssl,
      ...(poolMax ? { max: poolMax } : {}),
      ...(safeSchema ? { options: `-c search_path="${safeSchema}",public` } : {}),
      // Drop idle clients after 30s so pgBouncer doesn't silently close them first,
      // which would cause "connection failure during authentication" on reuse.
      idleTimeoutMillis: 30_000,
    });
    if (safeSchema) {
      pool.on('connect', (client) => {
        client.query(`SET search_path TO "${safeSchema}", public`).catch((err) => {
          console.warn('[Prisma] Failed to set search_path:', err);
        });
      });
    }
    const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
    super({ adapter });
    this.pool = pool;

    // Store reference to the base PrismaClient for use in the extended client
    const baseClient = this as unknown as PrismaClient;

    const enableRequestContext =
      (process.env.PRISMA_ENABLE_REQUEST_CONTEXT || 'true').trim().toLowerCase() === 'true';

    const extendedClient = enableRequestContext
      ? baseClient.$extends({
        query: {
          $allModels: {
            async $allOperations({ args, query }) {
              const orgId = requestContext.getStore()?.organizationId;
              if (orgId) {
                // Use baseClient.$transaction with baseClient.$executeRawUnsafe to ensure proper method access
                const [, result] = await baseClient.$transaction([
                  baseClient.$executeRawUnsafe(
                    `SELECT set_config('app.current_org', '${orgId}', true)`,
                  ),
                  query(args),
                ]);
                return result;
              }
              return query(args);
            },
          },
        },
      })
      : baseClient;

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in extendedClient) {
          const val = (extendedClient as any)[prop];
          return typeof val === 'function' ? val.bind(extendedClient) : val;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    const closePoolEnv = process.env.PRISMA_CLOSE_POOL;
    const shouldClosePool =
      (closePoolEnv && closePoolEnv.toLowerCase() === 'true') ||
      process.env.NODE_ENV === 'test';
    if (!shouldClosePool) {
      console.warn('[Prisma] Skipping pool shutdown to avoid closed-pool reuse.');
      return;
    }
    await this.$disconnect();
    await this.pool.end();
  }
}
