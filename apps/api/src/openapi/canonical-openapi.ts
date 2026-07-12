import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const MAX_OPENAPI_SOURCE_BYTES = 2 * 1024 * 1024;
const CANONICAL_SPEC_URL = new URL("../../../../specs/player-public.openapi.yaml", import.meta.url);

export type CanonicalOpenApi = Readonly<{
  document: Readonly<Record<string, unknown>>;
  etag: string;
  sourceSha256: string;
}>;

export function loadCanonicalOpenApi(sourcePath = fileURLToPath(CANONICAL_SPEC_URL)): CanonicalOpenApi {
  const metadata = statSync(sourcePath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_OPENAPI_SOURCE_BYTES) {
    throw new Error("Canonical OpenAPI source must be a non-empty file no larger than 2 MiB.");
  }

  const source = readFileSync(sourcePath, "utf8");
  const parsed: unknown = parse(source, {
    maxAliasCount: 0,
    schema: "core",
    uniqueKeys: true,
  });
  if (!isRecord(parsed)
    || parsed.openapi !== "3.1.1"
    || !isRecord(parsed.info)
    || typeof parsed.info.title !== "string"
    || !isRecord(parsed.paths)
    || !isRecord(parsed.components)) {
    throw new Error("Canonical OpenAPI source is not a complete OpenAPI 3.1.1 document.");
  }

  const canonicalJson = JSON.stringify(parsed);
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const documentSha256 = createHash("sha256").update(canonicalJson).digest("hex");
  return {
    document: deepFreeze(parsed),
    etag: `"sha256-${documentSha256}"`,
    sourceSha256,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}
