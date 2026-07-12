#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const observabilityDir = path.join(root, "infra/observability");
const metricsPath = path.join(root, "packages/observability/src/metrics.ts");
const runbookPath = path.join(root, "docs/SPACEY_OBSERVABILITY_ALERTS_RUNBOOK_2026-07-11_RU.md");

const catalog = readJson("metric-catalog.v1.json");
const policy = readJson("alerts.v1.json");
const dashboard = readJson("dashboard.v1.json");
const metricsSource = fs.readFileSync(metricsPath, "utf8");
const runbook = fs.readFileSync(runbookPath, "utf8");

assert(catalog.schemaVersion === 1, "metric catalog schemaVersion must be 1");
assert(policy.schemaVersion === 1, "alert policy schemaVersion must be 1");
assert(dashboard.schemaVersion === 1, "dashboard schemaVersion must be 1");
assertPositiveInteger(policy.evaluationIntervalSeconds, "evaluationIntervalSeconds");
assertPositiveInteger(dashboard.refreshSeconds, "dashboard refreshSeconds");
assertPositiveInteger(dashboard.defaultWindowSeconds, "dashboard defaultWindowSeconds");

const sourceInstruments = extractSourceInstruments(metricsSource);
const catalogByName = new Map();
for (const instrument of catalog.instruments) {
  assert(typeof instrument.name === "string" && instrument.name.length > 0, "catalog instrument name is required");
  assert(!catalogByName.has(instrument.name), `duplicate catalog instrument: ${instrument.name}`);
  assert(["counter", "up_down_counter", "histogram", "observable_gauge"].includes(instrument.type), `invalid type for ${instrument.name}`);
  assert(typeof instrument.unit === "string" && instrument.unit.length > 0, `unit is required for ${instrument.name}`);
  assert(["battle-worker", "jobs"].includes(instrument.service), `invalid service for ${instrument.name}`);
  assertStringArray(instrument.attributes, `${instrument.name}.attributes`);
  catalogByName.set(instrument.name, instrument);

  const source = sourceInstruments.get(instrument.name);
  assert(source, `catalog references nonexistent source instrument: ${instrument.name}`);
  assert(source.type === instrument.type, `type mismatch for ${instrument.name}: source=${source.type}, catalog=${instrument.type}`);
  assert(source.unit === instrument.unit, `unit mismatch for ${instrument.name}: source=${source.unit}, catalog=${instrument.unit}`);
}

for (const sourceName of sourceInstruments.keys()) {
  assert(catalogByName.has(sourceName), `source instrument is missing from catalog: ${sourceName}`);
}

for (const [name, value] of Object.entries(policy.declaredSlos ?? {})) {
  assert(typeof value === "number" && Number.isFinite(value) && value > 0, `declared SLO ${name} must be numeric and positive`);
}

const alertIds = new Set();
const alertGroups = new Map();
for (const alert of policy.alerts) {
  assert(typeof alert.id === "string" && alert.id.length > 0, "alert id is required");
  assert(!alertIds.has(alert.id), `duplicate alert id: ${alert.id}`);
  alertIds.add(alert.id);
  assert(["warning", "critical"].includes(alert.severity), `invalid severity for ${alert.id}`);
  validateQuery(alert.query, `alert ${alert.id}`);
  assert(alert.condition?.operator === ">", `${alert.id} must use the supported > operator`);
  assertFiniteNumber(alert.condition.threshold, `${alert.id}.condition.threshold`);
  assert(alert.condition.threshold >= 0, `${alert.id}.condition.threshold must be non-negative`);
  assertPositiveInteger(alert.condition.forSeconds, `${alert.id}.condition.forSeconds`);
  assert(alert.condition.forSeconds >= policy.evaluationIntervalSeconds, `${alert.id} forSeconds must cover at least one evaluation interval`);
  assert(typeof alert.runbook === "string" && alert.runbook.length > 0, `${alert.id}.runbook is required`);
  assert(runbook.includes(`<a id="${alert.runbook}"></a>`), `${alert.id} runbook anchor is missing: ${alert.runbook}`);
  const group = alertGroups.get(alert.alertGroup) ?? {};
  assert(!group[alert.severity], `duplicate ${alert.severity} alert in ${alert.alertGroup}`);
  group[alert.severity] = alert;
  alertGroups.set(alert.alertGroup, group);
}

for (const [groupName, group] of alertGroups) {
  if (group.warning && group.critical) {
    assert(
      group.warning.condition.threshold < group.critical.condition.threshold,
      `${groupName} warning threshold must be lower than critical threshold`,
    );
  }
}

const panelIds = new Set();
const dashboardInstruments = new Set();
for (const panel of dashboard.panels) {
  assert(typeof panel.id === "string" && panel.id.length > 0, "panel id is required");
  assert(!panelIds.has(panel.id), `duplicate panel id: ${panel.id}`);
  panelIds.add(panel.id);
  assert(panel.visualization === "timeseries", `${panel.id} uses an unsupported visualization`);
  assert(Array.isArray(panel.queries) && panel.queries.length > 0, `${panel.id} must contain queries`);
  for (const query of panel.queries) {
    validateQuery(query, `dashboard panel ${panel.id}`);
    for (const instrument of query.instruments) dashboardInstruments.add(instrument);
  }
}

for (const name of catalogByName.keys()) {
  assert(dashboardInstruments.has(name), `dashboard does not expose catalog instrument: ${name}`);
}

process.stdout.write(
  `observability definitions valid: ${catalogByName.size} instruments, ${policy.alerts.length} alerts, ${dashboard.panels.length} panels\n`,
);

function validateQuery(query, label) {
  assert(query && typeof query === "object", `${label} query is required`);
  const operations = {
    counter_rate: ["counter"],
    counter_ratio: ["counter", "counter"],
    current_sum: ["up_down_counter"],
    gauge_max: ["observable_gauge"],
    histogram_quantile: ["histogram"],
  };
  const expectedTypes = operations[query.operation];
  assert(expectedTypes, `${label} uses unsupported operation: ${query.operation}`);
  assertStringArray(query.instruments, `${label}.instruments`);
  assert(query.instruments.length === expectedTypes.length, `${label} ${query.operation} expects ${expectedTypes.length} instrument(s)`);
  const instruments = query.instruments.map((name, index) => {
    const instrument = catalogByName.get(name);
    assert(instrument, `${label} references nonexistent instrument: ${name}`);
    assert(instrument.type === expectedTypes[index], `${label} cannot apply ${query.operation} to ${name} (${instrument.type})`);
    return instrument;
  });
  assertStringArray(query.groupBy ?? [], `${label}.groupBy`);
  for (const attribute of query.groupBy ?? []) {
    for (const instrument of instruments) {
      assert(instrument.attributes.includes(attribute), `${label} groups ${instrument.name} by unsupported attribute: ${attribute}`);
    }
  }
  if (query.operation !== "current_sum") assertPositiveInteger(query.windowSeconds, `${label}.windowSeconds`);
  if (query.operation === "histogram_quantile") {
    assertFiniteNumber(query.quantile, `${label}.quantile`);
    assert(query.quantile > 0 && query.quantile < 1, `${label}.quantile must be between 0 and 1`);
  }
  if (query.operation === "counter_ratio") {
    assertPositiveInteger(query.minimumDenominatorCount, `${label}.minimumDenominatorCount`);
  }
}

function extractSourceInstruments(source) {
  const typeMap = {
    Counter: "counter",
    UpDownCounter: "up_down_counter",
    Histogram: "histogram",
    ObservableGauge: "observable_gauge",
  };
  const instruments = new Map();
  const pattern = /meter\.create(Counter|UpDownCounter|Histogram|ObservableGauge)\(\s*"([^"]+)"\s*,\s*\{[\s\S]*?unit:\s*"([^"]+)"/g;
  for (const match of source.matchAll(pattern)) {
    const [, constructorName, name, unit] = match;
    assert(!instruments.has(name), `duplicate source instrument: ${name}`);
    instruments.set(name, { type: typeMap[constructorName], unit });
  }
  assert(instruments.size > 0, "no instruments found in packages/observability/src/metrics.ts");
  return instruments;
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(observabilityDir, name), "utf8"));
}

function assertStringArray(value, label) {
  assert(Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0), `${label} must be a string array`);
  assert(new Set(value).size === value.length, `${label} contains duplicates`);
}

function assertPositiveInteger(value, label) {
  assert(Number.isInteger(value) && value > 0, `${label} must be a positive integer`);
}

function assertFiniteNumber(value, label) {
  assert(typeof value === "number" && Number.isFinite(value), `${label} must be numeric`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
