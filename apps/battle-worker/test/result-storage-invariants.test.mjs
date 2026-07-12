import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = new URL("../../../", import.meta.url);

test("mission results remain append-only and replay availability is relational", async () => {
  const source = await readFile(new URL("apps/battle-worker/src/postgres-finalizer.ts", workspace), "utf8");
  assert.doesNotMatch(source, /UPDATE\s+mission_results/i);
  assert.doesNotMatch(source, /replayStatus/);
  assert.match(source, /loadResultSnapshots/);
  assert.match(source, /INSERT INTO mission_results/);
  assert.match(source, /INSERT INTO replay_metadata/);
});

test("post-migration grants preserve runtime repair access without result UPDATE", async () => {
  const grants = await readFile(new URL("packages/db/sql/roles.grants.template.sql", workspace), "utf8");
  assert.match(
    grants,
    /GRANT SELECT, INSERT, UPDATE ON[\s\S]*?repair_quotes[\s\S]*?TO spacey_runtime;/,
  );
  assert.match(
    grants,
    /GRANT SELECT, INSERT ON[\s\S]*?mission_results[\s\S]*?TO spacey_battle_worker;/,
  );
  assert.doesNotMatch(
    grants,
    /GRANT UPDATE ON[^;]*mission_results[^;]*TO spacey_battle_worker;/,
  );
});
