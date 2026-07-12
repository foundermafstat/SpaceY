import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const INFRA_DIR = fileURLToPath(new URL(".", import.meta.url));
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const PROJECT_RE = /^spacey-[a-z0-9-]+$/;
const PORT_KEYS = [
  "WEB_BIND_PORT",
  "API_BIND_PORT",
  "BATTLE_BIND_PORT",
  "ADMIN_API_BIND_PORT",
  "ADMIN_WEB_BIND_PORT",
  "BOT_BIND_PORT",
  "JOBS_BIND_PORT",
];
const DIGEST_KEYS = [
  "GAME_WEB_IMAGE_DIGEST",
  "API_IMAGE_DIGEST",
  "BATTLE_WORKER_IMAGE_DIGEST",
  "ADMIN_WEB_IMAGE_DIGEST",
  "ADMIN_API_IMAGE_DIGEST",
  "TELEGRAM_BOT_IMAGE_DIGEST",
  "JOBS_IMAGE_DIGEST",
];

export function validateDeploymentEnv(mode, env, { allowPlaceholders = false } = {}) {
  if (mode === "production-data") return validateDataEnv(env, { allowPlaceholders });
  const expected = expectedMode(mode);
  assert(!env.COMPOSE_PROJECT_NAME, "COMPOSE_PROJECT_NAME must not override isolated Compose project names.");
  assert(env.SPACEY_ENVIRONMENT === expected.environment, `SPACEY_ENVIRONMENT must be ${expected.environment}.`);
  assert(env.SLOT === expected.slot, `SLOT must be ${expected.slot}.`);
  assert(PROJECT_RE.test(required(env, "SPACEY_SLOT_PROJECT")), "Invalid SPACEY_SLOT_PROJECT.");
  assert(env.SPACEY_SLOT_PROJECT === expected.slotProject, `SPACEY_SLOT_PROJECT must be ${expected.slotProject}.`);
  assert(required(env, "SPACEY_DATA_NETWORK") === expected.dataNetwork, `SPACEY_DATA_NETWORK must be ${expected.dataNetwork}.`);
  assert(required(env, "SPACEY_CONFIG_DIR") === expected.configDir, `SPACEY_CONFIG_DIR must be ${expected.configDir}.`);
  if (expected.dataProject) {
    assert(required(env, "SPACEY_DATA_PROJECT") === expected.dataProject, `SPACEY_DATA_PROJECT must be ${expected.dataProject}.`);
    assert(env.SPACEY_DATA_PROJECT !== env.SPACEY_SLOT_PROJECT, "Data and app Compose projects must be different.");
    validatePostgresSettings(env, allowPlaceholders);
    validateValkeySettings(env, allowPlaceholders);
  }

  const ports = PORT_KEYS.map((key) => integer(required(env, key), key));
  assert(new Set(ports).size === ports.length, "Bind ports must be unique within an environment.");
  assert(ports.every((port) => port >= expected.portMinimum && port <= expected.portMaximum), "Bind ports are outside the reserved environment range.");

  const imageTag = required(env, "IMAGE_TAG");
  assert(SHA_RE.test(imageTag), "IMAGE_TAG must be a full lowercase Git SHA.");
  assert(allowPlaceholders || !/^0+$/.test(imageTag), "Placeholder IMAGE_TAG is forbidden for deployment.");
  const imagePrefix = required(env, "SPACEY_IMAGE_PREFIX");
  assert(/^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._/-]+$/i.test(imagePrefix), "SPACEY_IMAGE_PREFIX must be a GHCR path.");
  assert(allowPlaceholders || !imagePrefix.includes("replace-me"), "Placeholder SPACEY_IMAGE_PREFIX is forbidden for deployment.");
  for (const key of DIGEST_KEYS) {
    const digest = required(env, key);
    assert(DIGEST_RE.test(digest), `${key} must be an immutable sha256 digest.`);
    assert(allowPlaceholders || !/^sha256:0+$/.test(digest), `${key} still contains a placeholder digest.`);
  }
  if (!allowPlaceholders) {
    assert(/^postgres@sha256:[0-9a-f]{64}$/.test(required(env, "POSTGRES_CLIENT_IMAGE")), "POSTGRES_CLIENT_IMAGE must be digest-pinned.");
  }

  assertNoSecrets(env);
  return { mode, ports };
}

export function parseEnvFile(path) {
  const result = Object.create(null);
  for (const [index, rawLine] of readFileSync(path, "utf8").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    assert(match, `Invalid env syntax at ${path}:${index + 1}.`);
    const [, key, rawValue] = match;
    assert(!(key in result), `Duplicate ${key} in ${path}.`);
    result[key] = unquote(rawValue.trim());
  }
  return result;
}

function validateExamples() {
  const sources = [
    ["production-blue", `${INFRA_DIR}/env/blue.env.example`],
    ["production-green", `${INFRA_DIR}/env/green.env.example`],
    ["staging", `${INFRA_DIR}/env/staging.env.example`],
  ].map(([mode, path]) => [mode, parseEnvFile(path)]);
  const examples = sources.map(([mode, env]) => validateDeploymentEnv(mode, env, { allowPlaceholders: true }));
  validateDeploymentEnv("production-data", parseEnvFile(`${INFRA_DIR}/env/data.env.example`), { allowPlaceholders: true });
  const allPorts = examples.flatMap((example) => example.ports);
  assert(new Set(allPorts).size === allPorts.length, "Production and staging bind-port ranges overlap.");

  const appCompose = readFileSync(`${INFRA_DIR}/compose.production.yml`, "utf8");
  const dataCompose = readFileSync(`${INFRA_DIR}/compose.production-data.yml`, "utf8");
  const productionNginx = readFileSync(`${INFRA_DIR}/nginx/spacey-gateway.conf`, "utf8");
  const stagingNginx = readFileSync(`${INFRA_DIR}/nginx/spacey-staging-gateway.conf`, "utf8");
  const adminNginx = readFileSync(`${INFRA_DIR}/nginx/spacey-admin-private.conf`, "utf8");
  const publicNginx = readFileSync(`${INFRA_DIR}/nginx/spacey-public-api.conf`, "utf8");
  for (const requiredText of [
    'name: "${SPACEY_SLOT_PROJECT:',
    "stop_grace_period: 3m",
    "max-size: 50m",
    "networks: [slot]",
    'name: "${SPACEY_DATA_NETWORK:-spacey-data}"',
  ]) assert(appCompose.includes(requiredText), `App Compose is missing hardening: ${requiredText}`);
  for (const requiredText of [
    'name: "${SPACEY_DATA_PROJECT:-spacey-data}"',
    'POSTGRES_PASSWORD_FILE: /run/secrets/postgres-superuser-password',
    "--data-checksums",
    "password_encryption=scram-sha-256",
    "postgres-data:/var/lib/postgresql/data",
    "access-bootstrap:",
    "profiles: [bootstrap]",
    "bootstrap-access.sh",
    "SPACEY_POSTGRES_SECRET_DIR",
    "--maxmemory-policy",
    "noeviction",
    "--maxclients",
    "VALKEY_CONTAINER_MEMORY_LIMIT",
    "max-size: 50m",
  ]) assert(dataCompose.includes(requiredText), `Data Compose is missing hardening: ${requiredText}`);
  assert(!/^\s+ports:/m.test(dataCompose), "PostgreSQL and Valkey must not publish a host port.");
  assert(stagingNginx.includes("server_name staging.spacey.aima.space;"), "Staging player hostname is missing.");
  assert(stagingNginx.includes("listen 127.0.0.1:38443;"), "Staging admin must bind only to loopback.");
  assert(!stagingNginx.includes("server_name spacey.aima.space;"), "Production hostname leaked into staging gateway.");
  assert(adminNginx.includes("server_name admin.spacey.aima.space;"), "Production admin hostname is missing.");
  assert(adminNginx.includes("listen 127.0.0.1:8443;"), "Production admin must bind only to loopback.");
  assert(publicNginx.includes("server_name public.spacey.aima.space;"), "Public API hostname is missing.");
  assert(publicNginx.includes("location ^~ /public/v1/"), "Public API ingress must be path-scoped.");
  assert(!publicNginx.includes("location /api/"), "Player API leaked into public ingress.");
  for (const [label, nginx] of [["production", productionNginx], ["staging", stagingNginx]]) {
    assert(nginx.includes("location = /openapi.json"), `${label} gateway does not expose the canonical OpenAPI route.`);
    assert(nginx.includes("add_header X-Content-Type-Options nosniff always;"), `${label} OpenAPI route lacks nosniff protection.`);
  }

  const staging = sources.find(([mode]) => mode === "staging")[1];
  expectRejected(() => validateDeploymentEnv("staging", staging));
  expectRejected(() => validateDeploymentEnv("staging", { ...staging, COMPOSE_PROJECT_NAME: "spacey-staging" }, { allowPlaceholders: true }));
  expectRejected(() => validateDeploymentEnv("staging", { ...staging, SPACEY_DATA_PROJECT: "spacey-staging" }, { allowPlaceholders: true }));
  expectRejected(() => validateDeploymentEnv("staging", { ...staging, DATABASE_URL: "must-not-be-here" }, { allowPlaceholders: true }));
}

function validateDataEnv(env, { allowPlaceholders }) {
  assert(!env.COMPOSE_PROJECT_NAME, "COMPOSE_PROJECT_NAME must not override the data Compose project name.");
  assert(required(env, "SPACEY_DATA_PROJECT") === "spacey-data", "Production data project must be spacey-data.");
  assert(required(env, "SPACEY_DATA_NETWORK") === "spacey-data", "Production data network must be spacey-data.");
  assert(required(env, "SPACEY_CONFIG_DIR") === "/etc/spacey", "Production data config directory must be /etc/spacey.");
  validatePostgresSettings(env, allowPlaceholders);
  validateValkeySettings(env, allowPlaceholders);
  assertNoSecrets(env);
  return { mode: "production-data", ports: [] };
}

function validatePostgresSettings(env, allowPlaceholders) {
  const database = required(env, "POSTGRES_DATABASE");
  const superuser = required(env, "POSTGRES_SUPERUSER");
  assert(/^[a-z][a-z0-9_]{0,62}$/.test(database), "POSTGRES_DATABASE must be a simple PostgreSQL identifier.");
  assert(/^[a-z][a-z0-9_]{0,62}$/.test(superuser), "POSTGRES_SUPERUSER must be a simple PostgreSQL identifier.");
  const containerMemory = memoryBytes(required(env, "POSTGRES_CONTAINER_MEMORY_LIMIT"), "POSTGRES_CONTAINER_MEMORY_LIMIT");
  const shm = memoryBytes(required(env, "POSTGRES_SHM_SIZE"), "POSTGRES_SHM_SIZE");
  const sharedBuffers = memoryBytes(required(env, "POSTGRES_SHARED_BUFFERS"), "POSTGRES_SHARED_BUFFERS");
  const effectiveCache = memoryBytes(required(env, "POSTGRES_EFFECTIVE_CACHE_SIZE"), "POSTGRES_EFFECTIVE_CACHE_SIZE");
  memoryBytes(required(env, "POSTGRES_MAINTENANCE_WORK_MEM"), "POSTGRES_MAINTENANCE_WORK_MEM");
  memoryBytes(required(env, "POSTGRES_WORK_MEM"), "POSTGRES_WORK_MEM");
  assert(sharedBuffers <= Math.floor(containerMemory * 0.4), "PostgreSQL shared_buffers must not exceed 40% of the container limit.");
  assert(shm >= sharedBuffers, "PostgreSQL shm_size must cover shared_buffers.");
  assert(effectiveCache <= containerMemory, "PostgreSQL effective_cache_size must not exceed the container limit.");
  const maxConnections = integer(required(env, "POSTGRES_MAX_CONNECTIONS"), "POSTGRES_MAX_CONNECTIONS");
  assert(maxConnections >= 50 && maxConnections <= 1000, "POSTGRES_MAX_CONNECTIONS is outside the supported range.");
  const logThreshold = integer(required(env, "POSTGRES_LOG_MIN_DURATION_MS"), "POSTGRES_LOG_MIN_DURATION_MS");
  assert(logThreshold >= 0 && logThreshold <= 60000, "POSTGRES_LOG_MIN_DURATION_MS is outside the supported range.");
  if (!allowPlaceholders) {
    assert(/^postgres@sha256:[0-9a-f]{64}$/.test(required(env, "POSTGRES_IMAGE")), "POSTGRES_IMAGE must be digest-pinned.");
  }
}

function validateValkeySettings(env, allowPlaceholders) {
  const maxMemory = memoryBytes(required(env, "VALKEY_MAXMEMORY"), "VALKEY_MAXMEMORY");
  const containerMemory = memoryBytes(required(env, "VALKEY_CONTAINER_MEMORY_LIMIT"), "VALKEY_CONTAINER_MEMORY_LIMIT");
  assert(containerMemory >= Math.ceil(maxMemory * 1.2), "Valkey container limit must leave at least 20% overhead above maxmemory.");
  const maxClients = integer(required(env, "VALKEY_MAXCLIENTS"), "VALKEY_MAXCLIENTS");
  assert(maxClients >= 1000 && maxClients <= 100000, "VALKEY_MAXCLIENTS is outside the supported range.");
  const latencyMs = integer(required(env, "VALKEY_LATENCY_MONITOR_MS"), "VALKEY_LATENCY_MONITOR_MS");
  assert(latencyMs >= 1 && latencyMs <= 1000, "VALKEY_LATENCY_MONITOR_MS is outside the supported range.");
  if (!allowPlaceholders) {
    assert(/^valkey\/valkey@sha256:[0-9a-f]{64}$/.test(required(env, "VALKEY_IMAGE")), "VALKEY_IMAGE must be digest-pinned.");
  }
}

function memoryBytes(value, key) {
  const match = /^(\d+)(kb|mb|gb)$/i.exec(value);
  assert(match, `${key} must use an explicit byte unit.`);
  const multipliers = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Number(match[1]) * multipliers[match[2].toLowerCase()];
}

function assertNoSecrets(env) {
  for (const secretKey of ["DATABASE_URL", "DIRECT_URL", "SENTRY_DSN", "TELEGRAM_BOT_TOKEN", "VALKEY_URL"]) {
    assert(!env[secretKey], `${secretKey} belongs in a root-owned service env, not the deployment env.`);
  }
}

function expectedMode(mode) {
  if (mode === "staging") return {
    environment: "staging", slot: "staging", slotProject: "spacey-staging",
    dataProject: "spacey-staging-data", dataNetwork: "spacey-staging-data",
    configDir: "/etc/spacey-staging", portMinimum: 37000, portMaximum: 38999,
  };
  if (mode === "production-blue") return {
    environment: "production", slot: "blue", slotProject: "spacey-blue",
    dataNetwork: "spacey-data", configDir: "/etc/spacey", portMinimum: 17000, portMaximum: 18999,
  };
  if (mode === "production-green") return {
    environment: "production", slot: "green", slotProject: "spacey-green",
    dataNetwork: "spacey-data", configDir: "/etc/spacey", portMinimum: 27000, portMaximum: 28999,
  };
  throw new Error("Mode must be staging, production-blue, production-green or production-data.");
}

function required(env, key) {
  const value = env[key];
  assert(typeof value === "string" && value.length > 0, `Missing ${key}.`);
  return value;
}

function integer(value, key) {
  const parsed = Number(value);
  assert(Number.isInteger(parsed), `${key} must be an integer.`);
  return parsed;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectRejected(callback) {
  let rejected = false;
  try { callback(); } catch { rejected = true; }
  assert(rejected, "Unsafe deployment environment fixture was accepted.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--examples") {
    validateExamples();
    process.stdout.write("Deployment environment isolation examples are valid.\n");
  } else {
    const mode = process.argv[2];
    const path = process.argv[3];
    if (!mode || !path) throw new Error("Usage: node infra/validate-deployment-env.mjs <mode> <slot-env> | --examples");
    validateDeploymentEnv(mode, parseEnvFile(path));
    process.stdout.write(`Deployment environment ${mode} is valid and contains no slot-env secrets.\n`);
  }
}
