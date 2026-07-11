import assert from "node:assert/strict";
import test from "node:test";
import { hasEveryPermission } from "../src/security/admin-security.js";
import { isAllowedAdminOrigin } from "../src/security/private-origin.guard.js";
import { isValidAdminCsrf } from "../src/security/admin-csrf.guard.js";
import { loadAdminApiConfig } from "../src/config.js";

test("RBAC grants only permissions assigned to the role", () => {
  assert.equal(hasEveryPermission({ role: "ContentEditor", permissions: [] }, ["content:write"]), true);
  assert.equal(hasEveryPermission({ role: "ContentEditor", permissions: [] }, ["economy:adjust"]), false);
  assert.equal(hasEveryPermission({ role: "SuperAdmin", permissions: [] }, ["admins:manage"]), true);
});

test("unsafe admin mutations require matching double-submit CSRF tokens", () => {
  const token = "a".repeat(48);
  assert.equal(isValidAdminCsrf("GET", undefined, undefined), true);
  assert.equal(isValidAdminCsrf("POST", token, token), true);
  assert.equal(isValidAdminCsrf("POST", token, "b".repeat(48)), false);
  assert.equal(isValidAdminCsrf("POST", undefined, token), false);
});

test("private origin matching is exact and rejects null origins", () => {
  const allowed = ["https://admin.spacey.example"];
  assert.equal(isAllowedAdminOrigin("https://admin.spacey.example", allowed), true);
  assert.equal(isAllowedAdminOrigin("https://admin.spacey.example.attacker.test", allowed), false);
  assert.equal(isAllowedAdminOrigin("null", allowed), false);
  assert.equal(isAllowedAdminOrigin(undefined, allowed), false);
});

test("production WebAuthn configuration requires an exact allowed RP origin", () => {
  const env = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://placeholder:placeholder@127.0.0.1:5432/spacey",
    ADMIN_ALLOWED_ORIGINS: "https://admin.spacey.example",
    ADMIN_WEBAUTHN_ORIGIN: "https://admin.spacey.example",
    ADMIN_WEBAUTHN_RP_ID: "spacey.example",
    VALKEY_URL: "rediss://valkey.spacey.example:6379",
    ADMIN_AUTH_RATE_LIMIT_KEY: Buffer.alloc(32, 1).toString("base64"),
  };
  const config = loadAdminApiConfig(env);
  assert.equal(config.webAuthnOrigin, "https://admin.spacey.example");
  assert.equal(config.webAuthnRpId, "spacey.example");
  assert.throws(() => loadAdminApiConfig({ ...env, ADMIN_WEBAUTHN_ORIGIN: "https://admin.spacey.example/path" }));
  assert.throws(() => loadAdminApiConfig({ ...env, ADMIN_WEBAUTHN_RP_ID: "attacker.example" }));
});
