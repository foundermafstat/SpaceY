import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const packageDir = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = resolve(packageDir, "../..");

loadEnv({ path: resolve(workspaceRoot, ".env") });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Set DIRECT_URL or DATABASE_URL before running Prisma database commands.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: connectionString,
  },
});
