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
    OTEL_RESOURCE_ATTRIBUTES: `deployment.environment.name=production,service.version=${"a".repeat(40)}`,
  }).required, true);
});

test("production-like telemetry binds environment and exact release to OTel resources", () => {
  assert.throws(
    () => readObservabilityConfig({ NODE_ENV: "production", SPACEY_ENVIRONMENT: "staging" }),
    /OBSERVABILITY_REQUIRED=true/,
  );
  assert.throws(
    () => readObservabilityConfig({ NODE_ENV: "production", SPACEY_ENVIRONMENT: "prodution" }),
    /OBSERVABILITY_REQUIRED=true/,
  );
  const base = {
    OBSERVABILITY_REQUIRED: "true",
    NODE_ENV: "production",
    SPACEY_ENVIRONMENT: "staging",
    OTEL_SERVICE_NAME: "spacey-battle-worker",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.test",
    SENTRY_DSN: "https://public@example.test/1",
    SPACEY_RELEASE_SHA: "b".repeat(40),
  };
  assert.throws(
    () => readObservabilityConfig({ ...base, SPACEY_ENVIRONMENT: "prodution" }),
    /Invalid SPACEY_ENVIRONMENT/,
  );
  assert.throws(
    () => readObservabilityConfig({
      ...base,
      OTEL_RESOURCE_ATTRIBUTES: `deployment.environment.name=production,service.version=${"b".repeat(40)}`,
    }),
    /deployment\.environment\.name/,
  );
  assert.throws(
    () => readObservabilityConfig({
      ...base,
      OTEL_RESOURCE_ATTRIBUTES: `deployment.environment.name=staging,service.version=${"c".repeat(40)}`,
    }),
    /service\.version/,
  );
});
