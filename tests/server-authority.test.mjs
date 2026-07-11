import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const routeRoots = ["app/layout.tsx", "app/hangar/page.tsx", "app/battle/page.tsx"];
const forbiddenModules = [
  "components/battle/BattleCanvas",
  "game/data/enemies",
  "game/mission/rewards",
  "game/mission/runtime",
  "game/store/shipStore"
];

test("production routes cannot reach client-authoritative gameplay modules", async () => {
  const visited = new Set();
  const pending = routeRoots.map((path) => resolve(root, path));
  while (pending.length) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    for (const forbidden of forbiddenModules) {
      assert.equal(source.includes(`@/${forbidden}`), false, `${relative(root, file)} imports ${forbidden}`);
    }
    for (const specifier of source.matchAll(/(?:from\s+|import\()?["'](@\/[^"']+)["']/g)) {
      const imported = resolveLocal(specifier[1]);
      if (imported) pending.push(imported);
    }
  }
  assert.ok(visited.size >= routeRoots.length);
});

test("access-token client never persists auth material", async () => {
  const source = await readFile(resolve(root, "game/server/api-client.ts"), "utf8");
  assert.equal(/localStorage|sessionStorage|indexedDB/.test(source), false);
  assert.match(source, /let accessToken: string \| null = null/);
  assert.match(source, /credentials: "include"/);
});

function resolveLocal(specifier) {
  const base = resolve(root, specifier.slice(2));
  const candidates = extname(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  return candidates.find((candidate) => {
    try {
      return requireFile(candidate);
    } catch {
      return false;
    }
  }) ?? null;
}

function requireFile(path) {
  return path.startsWith(`${root}/`) && !path.includes("/node_modules/") && existsSync(path);
}
