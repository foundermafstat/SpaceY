import assert from "node:assert/strict";
import test from "node:test";
import { loadJobsConfig } from "../src/config.js";
import { RETENTION_POLICY } from "../src/retention-maintenance.js";

const baseEnv = {
  DATABASE_URL: "postgresql://local",
  VALKEY_URL: "redis://localhost:6379",
  NODE_ENV: "test",
};

test("retention cadence and batch are bounded while policy cutoffs stay fixed", () => {
  const config = loadJobsConfig(baseEnv);
  assert.equal(config.retentionIntervalMs, 300_000);
  assert.equal(config.retentionBatchSize, 5_000);
  assert.deepEqual(RETENTION_POLICY, {
    expiredAuthSessionGraceDays: 30,
    authClientHashesDays: 30,
    telegramAuthReplayDays: 30,
    terminalPrivacyRequestsUseRetentionUntil: true,
    deliveredWebhookDays: 30,
    deadWebhookDays: 90,
    publishedOutboxDays: 30,
    adminAuditYears: 1,
  });

  assert.throws(
    () => loadJobsConfig({ ...baseEnv, RETENTION_MAINTENANCE_INTERVAL_MS: "59999" }),
    /RETENTION_MAINTENANCE_INTERVAL_MS is invalid/,
  );
  assert.throws(
    () => loadJobsConfig({ ...baseEnv, RETENTION_MAINTENANCE_BATCH_SIZE: "5001" }),
    /RETENTION_MAINTENANCE_BATCH_SIZE is invalid/,
  );
});
