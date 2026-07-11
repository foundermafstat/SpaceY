import assert from "node:assert/strict";
import test from "node:test";
import type { PlatformRepository } from "../platform/platform.repository.js";
import {
  S3PrivacyExportDownloadSigner,
  type PrivacyExportDownloadSigner,
} from "./privacy-export-download.js";
import { PrivacyService } from "./privacy.service.js";

const userId = "01900000-0000-7000-8000-000000000201";
const requestId = "01900000-0000-7000-8000-000000000202";

test("privacy export download is owner/status gated before signing", async () => {
  let signed = 0;
  const signer: PrivacyExportDownloadSigner = {
    sign: async () => { signed += 1; return { url: "https://objects.example.com/signed", expiresAt: new Date(Date.now() + 60_000) }; },
    ping: async () => undefined,
  };
  const unavailable = new PrivacyService({
    getPrivacyExportDownloadTarget: async () => null,
  } as unknown as PlatformRepository, signer);
  await assert.rejects(() => unavailable.createDownload(userId, requestId), /not available for download/);
  assert.equal(signed, 0);

  const available = new PrivacyService({
    getPrivacyExportDownloadTarget: async (owner: string, id: string) => owner === userId && id === requestId
      ? { objectKey: "opaque/export.json", objectVersion: "v1", artifactExpiresAt: new Date(Date.now() + 60_000) }
      : null,
  } as unknown as PlatformRepository, signer);
  const response = await available.createDownload(userId, requestId);
  assert.equal(response.url, "https://objects.example.com/signed");
  assert.equal(signed, 1);
  assert.equal("objectKey" in response, false);
});

test("S3 privacy download signer emits only a short-lived HTTPS URL", async () => {
  const signer = new S3PrivacyExportDownloadSigner({
    endpoint: "https://objects.example.com",
    region: "eu-west-1",
    bucket: "privacy",
    accessKeyId: "key",
    secretAccessKey: "secret",
    forcePathStyle: true,
    ttlSeconds: 60,
  });
  const artifactExpiresAt = new Date(Date.now() + 30_000);
  const signed = await signer.sign({ objectKey: "opaque/export.json", objectVersion: "v1", artifactExpiresAt });
  assert.equal(new URL(signed.url).protocol, "https:");
  assert.ok(signed.expiresAt <= artifactExpiresAt);
  assert.equal("objectKey" in signed, false);
});
