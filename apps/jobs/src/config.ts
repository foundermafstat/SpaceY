export type JobsConfig = Readonly<{
  databaseUrl: string;
  valkeyUrl: string;
  queueName: string;
  workerId: string;
  concurrency: number;
  healthPort: number;
  healthHost: string;
  webhookTimeoutMs: number;
  webhookMaxAttempts: number;
  retentionIntervalMs: number;
  retentionBatchSize: number;
  privacyExportStorage: null | Readonly<{
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    kmsKeyId: string;
  }>;
}>;

export function loadJobsConfig(env: NodeJS.ProcessEnv = process.env): JobsConfig {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!env.VALKEY_URL) throw new Error("VALKEY_URL is required");
  const concurrency = Number(env.JOBS_CONCURRENCY ?? 20);
  const healthPort = Number(env.JOBS_HEALTH_PORT ?? 3104);
  const webhookTimeoutMs = Number(env.WEBHOOK_TIMEOUT_MS ?? 5_000);
  const webhookMaxAttempts = Number(env.WEBHOOK_MAX_ATTEMPTS ?? 8);
  const retentionIntervalMs = Number(env.RETENTION_MAINTENANCE_INTERVAL_MS ?? 300_000);
  const retentionBatchSize = Number(env.RETENTION_MAINTENANCE_BATCH_SIZE ?? 5_000);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200) throw new Error("JOBS_CONCURRENCY is invalid");
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65_535) throw new Error("JOBS_HEALTH_PORT is invalid");
  if (!Number.isInteger(webhookTimeoutMs) || webhookTimeoutMs < 500 || webhookTimeoutMs > 30_000) throw new Error("WEBHOOK_TIMEOUT_MS is invalid");
  if (!Number.isInteger(webhookMaxAttempts) || webhookMaxAttempts < 1 || webhookMaxAttempts > 20) throw new Error("WEBHOOK_MAX_ATTEMPTS is invalid");
  if (!Number.isInteger(retentionIntervalMs) || retentionIntervalMs < 60_000 || retentionIntervalMs > 86_400_000) throw new Error("RETENTION_MAINTENANCE_INTERVAL_MS is invalid");
  if (!Number.isInteger(retentionBatchSize) || retentionBatchSize < 1 || retentionBatchSize > 5_000) throw new Error("RETENTION_MAINTENANCE_BATCH_SIZE is invalid");
  const privacyValues = [
    env.PRIVACY_EXPORT_S3_ENDPOINT,
    env.PRIVACY_EXPORT_S3_BUCKET,
    env.PRIVACY_EXPORT_S3_ACCESS_KEY_ID,
    env.PRIVACY_EXPORT_S3_SECRET_ACCESS_KEY,
    env.PRIVACY_EXPORT_S3_KMS_KEY_ID,
  ];
  const configuredPrivacyValues = privacyValues.filter(Boolean).length;
  if (configuredPrivacyValues !== 0 && configuredPrivacyValues !== privacyValues.length) {
    throw new Error("Privacy export S3 configuration is incomplete");
  }
  const privacyExportStorage = configuredPrivacyValues === 0 ? null : {
    endpoint: env.PRIVACY_EXPORT_S3_ENDPOINT!,
    region: env.PRIVACY_EXPORT_S3_REGION ?? "eu-west-1",
    bucket: env.PRIVACY_EXPORT_S3_BUCKET!,
    accessKeyId: env.PRIVACY_EXPORT_S3_ACCESS_KEY_ID!,
    secretAccessKey: env.PRIVACY_EXPORT_S3_SECRET_ACCESS_KEY!,
    forcePathStyle: env.PRIVACY_EXPORT_S3_FORCE_PATH_STYLE === "true",
    kmsKeyId: env.PRIVACY_EXPORT_S3_KMS_KEY_ID!,
  };
  if (privacyExportStorage && new URL(privacyExportStorage.endpoint).protocol !== "https:") {
    throw new Error("Privacy export S3 endpoint must use HTTPS");
  }
  if ((env.NODE_ENV === "production" || env.NODE_ENV === "staging") && !privacyExportStorage) {
    throw new Error("Privacy export S3 configuration is required outside development/test");
  }
  return {
    databaseUrl: env.DATABASE_URL,
    valkeyUrl: env.VALKEY_URL,
    queueName: env.JOBS_QUEUE_NAME ?? "spacey-domain-events",
    workerId: env.JOBS_WORKER_ID ?? `jobs-${process.pid}`,
    concurrency,
    healthPort,
    healthHost: env.JOBS_HEALTH_HOST ?? "127.0.0.1",
    webhookTimeoutMs,
    webhookMaxAttempts,
    retentionIntervalMs,
    retentionBatchSize,
    privacyExportStorage,
  };
}
