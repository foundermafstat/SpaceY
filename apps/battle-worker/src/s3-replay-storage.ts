import {
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import type {
  BattleReplayStorage,
  ReplayArtifactMetadata,
  StoreReplayRequest
} from "./ports.js";
import { encodeReplay } from "./replay-format.js";

export type S3ReplayStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  retentionDays: number;
  serverSideEncryption: "AES256" | "aws:kms" | null;
  kmsKeyId: string | null;
};

export class S3ReplayStorage implements BattleReplayStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3ReplayStorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  async store(request: StoreReplayRequest): Promise<ReplayArtifactMetadata> {
    const replayId = request.kind === "pve"
      ? request.simulationConfig.attemptId
      : request.simulationConfig.matchId;
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(replayId)) {
      throw new Error("Replay identifier is unsafe for object storage.");
    }
    const encoded = encodeReplay(request);
    const storageKey = `replays/${request.kind}/${replayId}.jsonl.gz`;
    const expiresAt = new Date(
      request.completedAtMs + this.config.retentionDays * 24 * 60 * 60 * 1_000
    );
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
      Body: encoded.body,
      ContentType: "application/x-ndjson",
      ContentEncoding: "gzip",
      CacheControl: "private, no-store",
      Expires: expiresAt,
      Metadata: {
        "checksum-sha256": encoded.checksumSha256,
        "replay-id": replayId,
        "battle-kind": request.kind,
        "simulation-version": request.simulationConfig.simulationVersion
      },
      ...(this.config.serverSideEncryption
        ? {
            ServerSideEncryption: this.config.serverSideEncryption,
            ...(this.config.serverSideEncryption === "aws:kms" && this.config.kmsKeyId
              ? { SSEKMSKeyId: this.config.kmsKeyId }
              : {})
          }
        : {})
    }));
    return {
      storageKey,
      checksumSha256: encoded.checksumSha256,
      compression: "gzip",
      sizeBytes: encoded.body.byteLength,
      tickCount: request.outcome.finalTick,
      expiresAt: expiresAt.toISOString()
    };
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  destroy(): void {
    this.client.destroy();
  }
}
