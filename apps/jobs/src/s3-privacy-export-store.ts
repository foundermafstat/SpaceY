import { HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  PrivacyExportObjectStore,
  StoredPrivacyExport,
} from "./privacy-handler.js";

export type S3PrivacyExportStoreConfig = Readonly<{
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  kmsKeyId: string;
}>;

export class S3PrivacyExportObjectStore implements PrivacyExportObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: S3PrivacyExportStoreConfig) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:") throw new Error("Privacy export S3 endpoint must use HTTPS.");
    if (!config.kmsKeyId.trim()) throw new Error("Privacy export S3 KMS key id is required.");
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async putEncrypted(input: Readonly<{
    objectKey: string;
    body: Uint8Array;
    contentType: "application/json";
    contentSha256: string;
    expiresAt: Date;
  }>): Promise<StoredPrivacyExport> {
    const response = await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: "private, no-store",
      Expires: input.expiresAt,
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: this.config.kmsKeyId,
      BucketKeyEnabled: true,
      Metadata: {
        "content-sha256": input.contentSha256,
        "privacy-retention-until": input.expiresAt.toISOString(),
      },
    }));
    if (response.ServerSideEncryption !== "aws:kms" || !response.SSEKMSKeyId) {
      throw new Error("Object storage did not confirm SSE-KMS for the privacy export.");
    }
    return {
      objectKey: input.objectKey,
      objectVersion: response.VersionId ?? null,
      contentType: input.contentType,
      contentSha256: input.contentSha256,
      sizeBytes: input.body.byteLength,
      encryptionAlgorithm: "aws:kms",
      encryptionKeyId: response.SSEKMSKeyId,
      expiresAt: input.expiresAt,
    };
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }
}
