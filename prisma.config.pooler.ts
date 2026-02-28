import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

const rootDir = process.cwd();
dotenv.config({ path: path.resolve(rootDir, ".env") });
dotenv.config({ path: path.resolve(rootDir, ".env.local"), override: true });

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  throw new Error("DATABASE_URL is not set");
}

const url = new URL(rawUrl);
if (!url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true");
if (!url.searchParams.has("statement_cache_size")) url.searchParams.set("statement_cache_size", "0");
if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "15");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: url.toString() },
});
