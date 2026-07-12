import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCanonicalOpenApi } from "./canonical-openapi.js";

test("loads the repository OpenAPI contract as the immutable runtime document", () => {
  const canonical = loadCanonicalOpenApi();
  assert.equal(canonical.document.openapi, "3.1.1");
  assert.equal(Object.isFrozen(canonical.document), true);
  assert.match(canonical.etag, /^"sha256-[0-9a-f]{64}"$/);
  assert.match(canonical.sourceSha256, /^[0-9a-f]{64}$/);
  assert.ok(Object.hasOwn(canonical.document.paths as object, "/api/v1/bootstrap"));
  assert.ok(Object.hasOwn(canonical.document.paths as object, "/public/v1/catalog"));
});

test("rejects aliases and incomplete projections", () => {
  const aliasPath = join(tmpdir(), `spacey-openapi-alias-${process.pid}.yaml`);
  const projectionPath = join(tmpdir(), `spacey-openapi-projection-${process.pid}.yaml`);
  writeFileSync(aliasPath, "openapi: 3.1.1\ninfo: &info { title: SpaceY }\npaths: {}\ncomponents: *info\n", "utf8");
  writeFileSync(projectionPath, "openapi: 3.1.1\ninfo: { title: SpaceY }\npaths: {}\n", "utf8");
  assert.throws(() => loadCanonicalOpenApi(aliasPath));
  assert.throws(() => loadCanonicalOpenApi(projectionPath), /complete OpenAPI 3\.1\.1/);
});
