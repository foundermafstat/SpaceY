import assert from "node:assert/strict";
import test from "node:test";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { DomainEventJob } from "../src/domain.js";
import { loadJobsConfig } from "../src/config.js";
import {
  PrivacyDeleteHandler,
  PrivacyExportHandler,
  UnconfiguredPrivacyExportObjectStore,
  buildCanonicalPrivacyExport,
  canonicalJson,
  type PrivacyExportObjectStore,
  type PrivacyExportSource,
  type PrivacyWorkflowRepository,
  type StoredPrivacyExport,
} from "../src/privacy-handler.js";
import { S3PrivacyExportObjectStore } from "../src/s3-privacy-export-store.js";

const requestId = "01900000-0000-7000-8000-000000000101";
const userId = "01900000-0000-7000-8000-000000000102";

function exportJob(): DomainEventJob {
  return {
    outboxEventId: "01900000-0000-7000-8000-000000000103",
    idempotencyKey: `privacy-request:${requestId}:requested`,
    eventType: "privacy.export.requested",
    aggregateType: "privacy-request",
    aggregateId: requestId,
    payload: { requestId, userId, requestType: "export", retentionPolicyVersion: "eu-v1" },
    occurredAt: "2026-07-11T12:00:00.000Z",
  };
}

function source(): PrivacyExportSource {
  return {
    request: { id: requestId, requestedAt: new Date("2026-07-11T12:00:00.000Z"), retentionPolicyVersion: "eu-v1" },
    profile: { displayName: "Pilot", id: userId },
    telegramIdentity: { telegramUserId: "123" },
    authSessions: [{ id: "session-1", status: "REVOKED" }],
    shipBuilds: [],
    shipBuildRevisions: [],
    buildItems: [],
    inventory: [],
    walletBalances: [{ balance: "10", currency: "CREDITS" }],
    walletLedger: [],
    missionHistory: [],
    missionResults: [],
    progression: null,
    privacyRequests: [{ id: requestId, status: "PROCESSING" }],
  };
}

function fakeRepository(overrides: Partial<PrivacyWorkflowRepository> = {}) {
  const calls = { completed: 0, deleted: 0, failed: [] as string[] };
  const repository: PrivacyWorkflowRepository = {
    claim: async () => "claimed",
    loadExportSource: async () => source(),
    completeExport: async () => { calls.completed += 1; },
    anonymizeAndCompleteDelete: async () => { calls.deleted += 1; },
    markFailed: async (_requestId, _userId, code) => { calls.failed.push(code); },
    ...overrides,
  };
  return { repository, calls };
}

test("canonical privacy export has stable ordering and contains no credential hashes", () => {
  const left = canonicalJson(buildCanonicalPrivacyExport(source()));
  const right = canonicalJson(buildCanonicalPrivacyExport({ ...source(), profile: { id: userId, displayName: "Pilot" } }));
  assert.equal(left, right);
  assert.equal(left.includes("refreshTokenHash"), false);
  assert.equal(left.includes("objectKey"), false);
});

test("privacy export completes only with verified encrypted object metadata", async () => {
  const { repository, calls } = fakeRepository();
  const store: PrivacyExportObjectStore = {
    putEncrypted: async (input): Promise<StoredPrivacyExport> => ({
      objectKey: input.objectKey,
      objectVersion: "version-1",
      contentType: input.contentType,
      contentSha256: input.contentSha256,
      sizeBytes: input.body.byteLength,
      encryptionAlgorithm: "aws:kms",
      encryptionKeyId: "privacy-export-key",
      expiresAt: input.expiresAt,
    }),
    ping: async () => undefined,
  };
  const result = await new PrivacyExportHandler(repository, store).handle(exportJob());
  assert.equal(calls.completed, 1);
  assert.deepEqual(calls.failed, []);
  assert.equal((result as { stored: boolean }).stored, true);
  assert.equal("url" in (result as object), false);
});

test("privacy export fails closed when encrypted object storage is unconfigured", async () => {
  const { repository, calls } = fakeRepository();
  const handler = new PrivacyExportHandler(repository, new UnconfiguredPrivacyExportObjectStore());
  await assert.rejects(() => handler.handle(exportJob()), /not configured/);
  assert.equal(calls.completed, 0);
  assert.deepEqual(calls.failed, ["privacy_export_store_unconfigured"]);
});

test("privacy deletion accepts only the exact owned event envelope", async () => {
  const { repository, calls } = fakeRepository();
  const job: DomainEventJob = {
    ...exportJob(),
    eventType: "privacy.delete.requested",
    payload: { requestId, userId, requestType: "delete", retentionPolicyVersion: "eu-v1" },
  };
  assert.deepEqual(await new PrivacyDeleteHandler(repository).handle(job), { anonymized: true });
  assert.equal(calls.deleted, 1);

  await assert.rejects(
    () => new PrivacyDeleteHandler(repository).handle({ ...job, aggregateId: "01900000-0000-7000-8000-000000000999" }),
    /identifiers are invalid/,
  );
});

test("production jobs config fails closed without complete HTTPS privacy storage", () => {
  const base = { DATABASE_URL: "postgresql://local", VALKEY_URL: "redis://localhost:6379", NODE_ENV: "production" };
  assert.throws(() => loadJobsConfig(base), /required outside development/);
  assert.throws(() => loadJobsConfig({
    ...base,
    PRIVACY_EXPORT_S3_ENDPOINT: "http://objects.example.com",
    PRIVACY_EXPORT_S3_BUCKET: "privacy",
    PRIVACY_EXPORT_S3_ACCESS_KEY_ID: "key",
    PRIVACY_EXPORT_S3_SECRET_ACCESS_KEY: "secret",
    PRIVACY_EXPORT_S3_KMS_KEY_ID: "kms-key",
  }), /must use HTTPS/);
});

test("S3 privacy store sends bytes directly with mandatory SSE-KMS", async () => {
  const store = new S3PrivacyExportObjectStore({
    endpoint: "https://objects.example.com",
    region: "eu-west-1",
    bucket: "privacy",
    accessKeyId: "key",
    secretAccessKey: "secret",
    forcePathStyle: true,
    kmsKeyId: "kms-key",
  });
  let captured: unknown;
  (store as unknown as { client: { send(command: unknown): Promise<{ VersionId: string; ServerSideEncryption: "aws:kms"; SSEKMSKeyId: string }> } }).client = {
    send: async (command) => {
      captured = command;
      return { VersionId: "v1", ServerSideEncryption: "aws:kms", SSEKMSKeyId: "kms-key" };
    },
  };
  const body = Buffer.from("{\"ok\":true}");
  const artifact = await store.putEncrypted({
    objectKey: `privacy-exports/${userId}/${requestId}.json`,
    body,
    contentType: "application/json",
    contentSha256: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.ok(captured instanceof PutObjectCommand);
  assert.equal(captured.input.ServerSideEncryption, "aws:kms");
  assert.equal(captured.input.SSEKMSKeyId, "kms-key");
  assert.equal(captured.input.Body, body);
  assert.equal(artifact.objectVersion, "v1");
  assert.equal("url" in artifact, false);
});
