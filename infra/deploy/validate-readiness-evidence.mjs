import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const REQUIRED_GATES = [
  "platformCi",
  "releaseImages",
  "stagingHttps",
  "stagingMigrations",
  "pveE2e",
  "pvpE2e",
  "backupRestore",
  "workerDrain",
  "rollbackRehearsal",
  "faultInjection",
  "loadTarget",
  "headroom",
];
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

const [evidencePath, manifestPath, expectedSha, expectedRepository] = process.argv.slice(2);
if (!evidencePath || !manifestPath || !expectedSha || !expectedRepository) {
  throw new Error("Usage: validate-readiness-evidence.mjs <evidence.json> <manifest.json> <git-sha> <owner/repo>");
}
if (!SHA_RE.test(expectedSha) || /^0+$/.test(expectedSha)) throw new Error("Expected release SHA is invalid.");
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expectedRepository)) {
  throw new Error("Expected repository must use owner/repo syntax.");
}

const evidenceSource = readFileSync(evidencePath, "utf8");
const manifestSource = readFileSync(manifestPath);
const evidence = JSON.parse(evidenceSource);
const manifest = JSON.parse(manifestSource.toString("utf8"));
const manifestSha256 = createHash("sha256").update(manifestSource).digest("hex");

assertRecord(evidence, "Readiness evidence");
assertExactKeys(evidence, [
  "schemaVersion",
  "status",
  "environment",
  "repository",
  "releaseSha",
  "manifestSha256",
  "completedAt",
  "correlationId",
  "reviewedBy",
  "gates",
  "proofs",
]);
if (evidence.schemaVersion !== 1 || evidence.status !== "passed" || evidence.environment !== "staging") {
  throw new Error("Readiness evidence is not a passed staging record.");
}
if (evidence.repository.toLowerCase() !== expectedRepository.toLowerCase()
  || evidence.releaseSha !== expectedSha
  || manifest.gitSha !== expectedSha) {
  throw new Error("Readiness evidence, manifest and requested release identity differ.");
}
if (evidence.manifestSha256 !== manifestSha256) {
  throw new Error("Readiness evidence is bound to another release manifest.");
}
if (typeof evidence.reviewedBy !== "string" || !/^[A-Za-z0-9_.@-]{3,128}$/.test(evidence.reviewedBy)) {
  throw new Error("Readiness reviewer identity is invalid.");
}
if (typeof evidence.correlationId !== "string"
  || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(evidence.correlationId)) {
  throw new Error("Readiness correlation ID is invalid.");
}
const completedAt = Date.parse(evidence.completedAt);
const ageMs = Date.now() - completedAt;
if (!Number.isFinite(completedAt) || ageMs < 0 || ageMs > 7 * 24 * 60 * 60 * 1_000) {
  throw new Error("Readiness evidence must be no more than seven days old.");
}

assertRecord(evidence.gates, "Readiness gates");
assertRecord(evidence.proofs, "Readiness proofs");
assertExactKeys(evidence.gates, REQUIRED_GATES);
assertExactKeys(evidence.proofs, REQUIRED_GATES);
for (const gate of REQUIRED_GATES) {
  if (evidence.gates[gate] !== true) throw new Error(`Readiness gate is not passed: ${gate}`);
  if (typeof evidence.proofs[gate] !== "string" || !DIGEST_RE.test(evidence.proofs[gate])) {
    throw new Error(`Readiness proof digest is invalid: ${gate}`);
  }
  if (evidence.proofs[gate] === `sha256:${"0".repeat(64)}`) {
    throw new Error(`Readiness proof digest is still a placeholder: ${gate}`);
  }
}

process.stdout.write(`Readiness evidence is valid for ${expectedRepository}@${expectedSha}.\n`);

function assertRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Unexpected keys: expected ${wanted.join(", ")}.`);
  }
}
