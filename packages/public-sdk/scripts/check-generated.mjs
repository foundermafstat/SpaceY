import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");
const committedSchema = resolve(packageRoot, "src/generated/schema.ts");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "spacey-public-sdk-"));
const temporarySchema = join(temporaryDirectory, "schema.ts");

try {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "openapi-typescript",
      "../../specs/player-public.openapi.yaml",
      "--output",
      temporarySchema,
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const [expected, actual] = await Promise.all([
    readFile(temporarySchema, "utf8"),
    readFile(committedSchema, "utf8"),
  ]);

  if (expected !== actual) {
    console.error(
      `Generated SDK types are stale. Run \"pnpm --filter @spacey/public-sdk generate\" from ${workspaceRoot}.`,
    );
    process.exitCode = 1;
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
