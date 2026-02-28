"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
const config_1 = require("prisma/config");
const rootDir = process.cwd();
dotenv_1.default.config({ path: node_path_1.default.resolve(rootDir, ".env") });
dotenv_1.default.config({ path: node_path_1.default.resolve(rootDir, ".env.local"), override: true });
if (!process.env.DATABASE_URL) {
    dotenv_1.default.config({ path: node_path_1.default.resolve(rootDir, ".env.production") });
    dotenv_1.default.config({
        path: node_path_1.default.resolve(rootDir, ".env.production.local"),
        override: true,
    });
}
const useDirectUrl = process.env.PRISMA_USE_DIRECT_URL === "1";
const rawDatabaseUrl = useDirectUrl
    ? process.env["DATABASE_URL_DIRECT"] || process.env["DATABASE_URL"]
    : process.env["DATABASE_URL"] || process.env["DATABASE_URL_DIRECT"];
const parsedDatabaseUrl = rawDatabaseUrl ? new URL(rawDatabaseUrl) : null;
const isSupabasePooler = parsedDatabaseUrl !== null &&
    !useDirectUrl &&
    parsedDatabaseUrl.hostname.endsWith(".pooler.supabase.com");
if (isSupabasePooler) {
    const url = parsedDatabaseUrl;
    if (!url.searchParams.has("pgbouncer")) {
        url.searchParams.set("pgbouncer", "true");
    }
    if (!url.searchParams.has("statement_cache_size")) {
        url.searchParams.set("statement_cache_size", "0");
    }
    if (!url.searchParams.has("connect_timeout")) {
        url.searchParams.set("connect_timeout", "15");
    }
}
const databaseUrl = parsedDatabaseUrl?.toString() || rawDatabaseUrl;
exports.default = (0, config_1.defineConfig)({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: databaseUrl,
    },
});
//# sourceMappingURL=prisma.config.js.map