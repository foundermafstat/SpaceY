import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedAdminProxyRoute } from "../app/internal/admin/v1/[...path]/route";

const RELEASE_ID = "01900000-0000-7000-8000-000000000301";

test("admin proxy exposes only the explicit release and session surface", () => {
  assert.equal(isAllowedAdminProxyRoute("GET", "content/releases"), true);
  assert.equal(isAllowedAdminProxyRoute("GET", `content/releases/${RELEASE_ID}/revisions`), true);
  assert.equal(isAllowedAdminProxyRoute("POST", `content/releases/${RELEASE_ID}/publish`), true);
  assert.equal(isAllowedAdminProxyRoute("POST", "session/logout"), true);
  assert.equal(isAllowedAdminProxyRoute("POST", `content/releases/${RELEASE_ID}/revisions`), false);
  assert.equal(isAllowedAdminProxyRoute("DELETE", `content/releases/${RELEASE_ID}/publish`), false);
  assert.equal(isAllowedAdminProxyRoute("GET", "content/releases/not-a-uuid/revisions"), false);
  assert.equal(isAllowedAdminProxyRoute("GET", "admin-users"), false);
});
