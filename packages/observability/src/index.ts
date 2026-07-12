export type ObservabilityConfig = Readonly<{
  required: boolean;
  serviceName: string;
  release: string | undefined;
  environment: string;
  otelEnabled: boolean;
  sentryDsn: string | undefined;
}>;

export function readObservabilityConfig(env: NodeJS.ProcessEnv = process.env): ObservabilityConfig {
  const required = env.OBSERVABILITY_REQUIRED === "true";
  const serviceName = env.OTEL_SERVICE_NAME?.trim() ?? "";
  const release = env.SPACEY_RELEASE_SHA?.trim() || undefined;
  const environment = env.SPACEY_ENVIRONMENT?.trim() || env.NODE_ENV || "development";
  const otelEnabled = Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT
    || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    || env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT);
  const sentryDsn = env.SENTRY_DSN?.trim() || undefined;
  const productionLike = env.NODE_ENV === "production" || /^(production|staging|preprod)$/.test(environment);

  if (productionLike && !required) {
    throw new Error("OBSERVABILITY_REQUIRED=true is mandatory in production-like environments");
  }

  if (required) {
    const missing = [
      !serviceName && "OTEL_SERVICE_NAME",
      !otelEnabled && "OTEL_EXPORTER_OTLP_ENDPOINT",
      !sentryDsn && "SENTRY_DSN",
      !release && "SPACEY_RELEASE_SHA",
    ].filter((value): value is string => Boolean(value));
    if (missing.length > 0) throw new Error(`Missing required observability configuration: ${missing.join(", ")}`);
    if (!/^(development|test|loadtest|preprod|staging|production)$/.test(environment)) throw new Error("Invalid SPACEY_ENVIRONMENT");
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(serviceName)) throw new Error("Invalid OTEL_SERVICE_NAME");
    if (!release || !/^[0-9a-f]{40}$/.test(release)) throw new Error("SPACEY_RELEASE_SHA must be a full lowercase Git SHA");
    const attributes = parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES);
    if (attributes.get("deployment.environment.name") !== environment) {
      throw new Error("OTEL_RESOURCE_ATTRIBUTES deployment.environment.name must match SPACEY_ENVIRONMENT");
    }
    if (attributes.get("service.version") !== release) {
      throw new Error("OTEL_RESOURCE_ATTRIBUTES service.version must match SPACEY_RELEASE_SHA");
    }
  }
  return {
    required,
    serviceName: serviceName || "spacey-service",
    release,
    environment,
    otelEnabled,
    sentryDsn,
  };
}

function parseResourceAttributes(value: string | undefined): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const entry of value?.split(",") ?? []) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trim();
    const item = entry.slice(separator + 1).trim();
    if (key && item) attributes.set(key, item);
  }
  return attributes;
}

export { captureException } from "./errors.js";
export {
  BattleWorkerMetrics,
  JobsMetrics,
  battleWorkerMetrics,
  jobsMetrics,
  type BattleMetricMode,
  type FinalizationStage,
  type InputRejectReason,
  type LedgerConflictCode,
  type NoShowOutcome,
} from "./metrics.js";
