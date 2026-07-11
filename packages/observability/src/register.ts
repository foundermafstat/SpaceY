import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import * as Sentry from "@sentry/node";
import { readObservabilityConfig } from "./index.js";

const config = readObservabilityConfig();
let sdk: NodeSDK | undefined;

if (config.otelEnabled) {
  sdk = new NodeSDK({
    serviceName: config.serviceName,
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
    })],
  });
  sdk.start();
}

if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.environment,
    release: config.release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    integrations: [],
    registerEsmLoaderHooks: false,
    skipOpenTelemetrySetup: true,
  });
  process.on("uncaughtExceptionMonitor", (error) => Sentry.captureException(error));
  process.on("unhandledRejection", (reason) => Sentry.captureException(reason));
}

let shutdownStarted = false;
async function shutdown(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await Promise.allSettled([
    sdk?.shutdown(),
    config.sentryDsn ? Sentry.flush(2_000) : Promise.resolve(true),
  ]);
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
