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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = exports.requestContext = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const node_url_1 = require("node:url");
const async_hooks_1 = require("async_hooks");
exports.requestContext = new async_hooks_1.AsyncLocalStorage();
const normalizeConnectionString = (value) => {
    if (!value)
        return value;
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
};
const extractSchemaFromConnectionString = (rawUrl) => {
    if (!rawUrl)
        return undefined;
    try {
        const url = new node_url_1.URL(rawUrl);
        const schema = url.searchParams.get('schema');
        if (!schema)
            return undefined;
        const trimmed = schema.trim();
        return trimmed || undefined;
    }
    catch (err) {
        console.warn('[Prisma] Failed to parse schema from connection URL:', err);
        return undefined;
    }
};
const applySchemaSearchPath = (rawUrl, schema) => {
    if (!rawUrl || !schema)
        return rawUrl;
    try {
        const url = new node_url_1.URL(rawUrl);
        url.searchParams.delete('schema');
        return url.toString();
    }
    catch (err) {
        console.warn('[Prisma] Failed to parse connection URL:', err);
        return rawUrl;
    }
};
const parsePositiveInt = (value) => {
    if (!value)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return undefined;
    return parsed;
};
const getConnectionLimit = (rawUrl) => {
    if (!rawUrl)
        return undefined;
    try {
        const url = new node_url_1.URL(rawUrl);
        return parsePositiveInt(url.searchParams.get('connection_limit') || undefined);
    }
    catch (err) {
        console.warn('[Prisma] Failed to parse connection limit from URL:', err);
        return undefined;
    }
};
const resolvePoolMax = (rawUrl) => {
    const envMax = parsePositiveInt(process.env.DATABASE_POOL_MAX) ||
        parsePositiveInt(process.env.PG_POOL_MAX) ||
        parsePositiveInt(process.env.PGPOOL_MAX);
    if (envMax)
        return envMax;
    const urlLimit = getConnectionLimit(rawUrl);
    if (urlLimit)
        return urlLimit;
    const isPooler = rawUrl.includes('pooler.supabase.com') || rawUrl.includes('pgbouncer=true');
    return isPooler ? 3 : undefined;
};
let PrismaService = class PrismaService extends client_1.PrismaClient {
    pool;
    constructor() {
        const rawConnectionString = normalizeConnectionString(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL);
        if (!rawConnectionString) {
            throw new Error('DATABASE_URL or DATABASE_URL_DIRECT is required to initialize Prisma.');
        }
        const schema = process.env.DATABASE_SCHEMA?.trim() ||
            extractSchemaFromConnectionString(rawConnectionString);
        const connectionString = applySchemaSearchPath(rawConnectionString, schema);
        console.log('[Prisma] Schema:', schema);
        const sslRejectUnauthorizedRaw = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
        const sslRejectUnauthorized = sslRejectUnauthorizedRaw &&
            sslRejectUnauthorizedRaw.trim().toLowerCase() === 'false';
        if (sslRejectUnauthorized) {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        }
        const rejectUnauthorized = !sslRejectUnauthorized;
        const wantsSsl = connectionString.includes('sslmode=require') ||
            process.env.DATABASE_SSL === 'true' ||
            sslRejectUnauthorized;
        const ssl = wantsSsl ? { rejectUnauthorized } : undefined;
        const safeSchema = schema ? schema.replace(/"/g, '""') : undefined;
        const poolMax = resolvePoolMax(connectionString);
        const pool = new pg_1.Pool({
            connectionString,
            ssl,
            ...(poolMax ? { max: poolMax } : {}),
            ...(safeSchema ? { options: `-c search_path="${safeSchema}",public` } : {}),
            idleTimeoutMillis: 30_000,
        });
        if (safeSchema) {
            pool.on('connect', (client) => {
                client.query(`SET search_path TO "${safeSchema}", public`).catch((err) => {
                    console.warn('[Prisma] Failed to set search_path:', err);
                });
            });
        }
        const adapter = new adapter_pg_1.PrismaPg(pool, schema ? { schema } : undefined);
        super({ adapter });
        this.pool = pool;
        const baseClient = this;
        const enableRequestContext = (process.env.PRISMA_ENABLE_REQUEST_CONTEXT || 'true').trim().toLowerCase() === 'true';
        const extendedClient = enableRequestContext
            ? baseClient.$extends({
                query: {
                    $allModels: {
                        async $allOperations({ args, query }) {
                            const orgId = exports.requestContext.getStore()?.organizationId;
                            if (orgId) {
                                const [, result] = await baseClient.$transaction([
                                    baseClient.$executeRawUnsafe(`SELECT set_config('app.current_org', '${orgId}', true)`),
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
                    const val = extendedClient[prop];
                    return typeof val === 'function' ? val.bind(extendedClient) : val;
                }
                return Reflect.get(target, prop, receiver);
            },
        });
    }
    async onModuleInit() {
        await this.$connect();
    }
    async onModuleDestroy() {
        const closePoolEnv = process.env.PRISMA_CLOSE_POOL;
        const shouldClosePool = (closePoolEnv && closePoolEnv.toLowerCase() === 'true') ||
            process.env.NODE_ENV === 'test';
        if (!shouldClosePool) {
            console.warn('[Prisma] Skipping pool shutdown to avoid closed-pool reuse.');
            return;
        }
        await this.$disconnect();
        await this.pool.end();
    }
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PrismaService);
//# sourceMappingURL=prisma.service.js.map