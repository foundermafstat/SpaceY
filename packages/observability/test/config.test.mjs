import assert from "node:assert/strict";
import test from "node:test";
import { readObservabilityConfig } from "../dist/index.js";

test("observability is optional for local development", () => {
  assert.deepEqual(readObservabilityConfig({ NODE_ENV: "development" }), {
    required: false,
    serviceName: "spacey-service",
    release: undefined,
    environment: "development",
    otelEnabled: false,
    sentryDsn: undefined,
  });
});

test("required production observability fails closed", () => {
  assert.throws(
    () => readObservabilityConfig({ OBSERVABILITY_REQUIRED: "true", NODE_ENV: "production" }),
    /OTEL_SERVICE_NAME.*OTEL_EXPORTER_OTLP_ENDPOINT.*SENTRY_DSN.*SPACEY_RELEASE_SHA/,
  );
  assert.equal(readObservabilityConfig({
    OBSERVABILITY_REQUIRED: "true",
    NODE_ENV: "production",
    OTEL_SERVICE_NAME: "spacey-api",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.test",
    SENTRY_DSN: "https://public@example.test/1",
    SPACEY_RELEASE_SHA: "a".repeat(40),
  }).required, true);
});
