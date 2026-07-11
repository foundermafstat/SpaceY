import { GetObjectCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiError } from "../common/api-error.js";

export const PRIVACY_EXPORT_DOWNLOAD_SIGNER = Symbol("PRIVACY_EXPORT_DOWNLOAD_SIGNER");

export interface PrivacyExportDownloadSigner {
  sign(input: Readonly<{ objectKey: string; objectVersion: string | null; artifactExpiresAt: Date }>): Promise<Readonly<{ url: string; expiresAt: Date }>>;
  ping(): Promise<void>;
}

export class UnconfiguredPrivacyExportDownloadSigner implements PrivacyExportDownloadSigner {
  constructor(private readonly required: boolean) {}

  async sign(): Promise<never> {
    throw new ApiError("privacy_export_download_unavailable", 503, "Privacy export download is unavailable.");
  }

  async ping(): Promise<void> {
    if (this.required) throw new Error("Privacy export download signer is not configured.");
  }
}

export class S3PrivacyExportDownloadSigner implements PrivacyExportDownloadSigner {
  private readonly client: S3Client;

  constructor(private readonly config: Readonly<{
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    ttlSeconds: number;
  }>) {
    if (new URL(config.endpoint).protocol !== "https:") throw new Error("Privacy export S3 endpoint must use HTTPS.");
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async sign(input: Readonly<{ objectKey: string; objectVersion: string | null; artifactExpiresAt: Date }>) {
    const issuedAtMs = Date.now();
    const remainingSeconds = Math.floor((input.artifactExpiresAt.getTime() - issuedAtMs) / 1_000);
    if (remainingSeconds < 1) {
      throw new ApiError("privacy_export_not_downloadable", 404, "Privacy export is not available for download.");
    }
    const expiresIn = Math.min(this.config.ttlSeconds, remainingSeconds);
    const url = await getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.objectKey,
      VersionId: input.objectVersion ?? undefined,
      ResponseContentType: "application/json",
      ResponseContentDisposition: 'attachment; filename="spacey-player-export.json"',
    }), { expiresIn });
    if (new URL(url).protocol !== "https:") throw new Error("Presigned privacy export URL must use HTTPS.");
    return { url, expiresAt: new Date(issuedAtMs + expiresIn * 1_000) };
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }
}
