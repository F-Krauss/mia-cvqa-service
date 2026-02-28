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
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
    throw new Error("DATABASE_URL is not set");
}
const url = new URL(rawUrl);
if (!url.searchParams.has("pgbouncer"))
    url.searchParams.set("pgbouncer", "true");
if (!url.searchParams.has("statement_cache_size"))
    url.searchParams.set("statement_cache_size", "0");
if (!url.searchParams.has("connect_timeout"))
    url.searchParams.set("connect_timeout", "15");
exports.default = (0, config_1.defineConfig)({
    schema: "prisma/schema.prisma",
    migrations: { path: "prisma/migrations" },
    datasource: { url: url.toString() },
});
//# sourceMappingURL=prisma.config.pooler.js.map