import assert from "node:assert/strict";
import test from "node:test";
import { navigationForPermissions } from "../lib/navigation";

test("navigation contains only permission-backed destinations", () => {
  const items = navigationForPermissions(["content:read", "audit:read"]);
  assert.deepEqual(items.map((item) => item.href), ["/content", "/audit"]);
});
