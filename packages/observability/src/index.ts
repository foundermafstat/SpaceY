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

  if (required) {
    const missing = [
      !serviceName && "OTEL_SERVICE_NAME",
      !otelEnabled && "OTEL_EXPORTER_OTLP_ENDPOINT",
      !sentryDsn && "SENTRY_DSN",
      !release && "SPACEY_RELEASE_SHA",
    ].filter((value): value is string => Boolean(value));
    if (missing.length > 0) throw new Error(`Missing required observability configuration: ${missing.join(", ")}`);
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

export { captureException } from "./errors.js";
