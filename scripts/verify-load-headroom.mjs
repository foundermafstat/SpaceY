import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verifyHeadroomEvidence(report) {
  assert(report && typeof report === "object", "Evidence must be an object.");
  assert(/^(staging|preprod|loadtest)$/.test(report.environment), "Production evidence is forbidden.");
  assert(typeof report.runId === "string" && report.runId.length >= 8, "runId is required.");
  assert(report.peakWsConnections >= 10_000, "10,000 concurrent WebSocket connections were not observed.");
  assert(report.peakActivePvpDuels >= 5_000, "5,000 active PvP duels were not observed.");
  assertRatio(report.maxCpuUtilizationRatio, "CPU");
  assertRatio(report.maxMemoryUtilizationRatio, "memory");
  assert(typeof report.windowStartedAt === "string" && typeof report.windowEndedAt === "string", "Evidence window is required.");
  assert(Array.isArray(report.sourceQueries) && report.sourceQueries.length >= 2, "External metric query references are required.");
  return true;
}

function assertRatio(value, label) {
  assert(Number.isFinite(value) && value >= 0 && value <= 0.75, `${label} did not preserve 25% headroom.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function selfTest() {
  const valid = {
    environment: "staging",
    runId: "self-test-run",
    peakWsConnections: 10_000,
    peakActivePvpDuels: 5_000,
    maxCpuUtilizationRatio: 0.75,
    maxMemoryUtilizationRatio: 0.74,
    windowStartedAt: "2026-07-11T00:00:00Z",
    windowEndedAt: "2026-07-11T00:30:00Z",
    sourceQueries: ["prometheus:cpu", "prometheus:memory"],
  };
  verifyHeadroomEvidence(valid);
  for (const invalid of [
    { ...valid, environment: "production" },
    { ...valid, peakWsConnections: 9_999 },
    { ...valid, peakActivePvpDuels: 4_999 },
    { ...valid, maxCpuUtilizationRatio: 0.751 },
    { ...valid, maxMemoryUtilizationRatio: 0.751 },
  ]) {
    let rejected = false;
    try { verifyHeadroomEvidence(invalid); } catch { rejected = true; }
    assert(rejected, "Invalid evidence was accepted.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--self-test") {
    selfTest();
  } else {
    const path = process.argv[2];
    if (!path) throw new Error("Usage: node scripts/verify-load-headroom.mjs <external-metrics.json>");
    verifyHeadroomEvidence(JSON.parse(readFileSync(path, "utf8")));
    process.stdout.write("External 10k/5k and 25% headroom evidence is valid.\n");
  }
}
