export type AdminApiConfig = Readonly<{
  port: number;
  host: string;
  allowedOrigins: readonly string[];
  databaseUrl: string;
  databasePoolMax: number;
  webAuthnRpId: string;
  webAuthnRpName: string;
  webAuthnOrigin: string;
  webAuthnChallengeTtlSeconds: number;
  adminSessionTtlSeconds: number;
  totpMaxAttempts: number;
  totpLockoutSeconds: number;
  totpWindow: number;
  valkeyUrl?: string;
  authRateLimitMax: number;
  authRateLimitWindowSeconds: number;
}>;

function positiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number, max: number): number {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${key} must be an integer between 1 and ${max}`);
  }
  return value;
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];

  return [...new Set(value.split(",").map((candidate) => candidate.trim()).filter(Boolean).map((candidate) => {
    const parsed = new URL(candidate);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error(`ADMIN_ALLOWED_ORIGINS must contain origins only: ${candidate}`);
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error(`Insecure admin origin is not allowed: ${candidate}`);
    }
    return parsed.origin;
  }))];
}

export function loadAdminApiConfig(env: NodeJS.ProcessEnv = process.env): AdminApiConfig {
  const port = Number(env.ADMIN_API_PORT ?? 3101);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("ADMIN_API_PORT must be a valid TCP port");
  }

  const allowedOrigins = parseAllowedOrigins(env.ADMIN_ALLOWED_ORIGINS);
  if (env.NODE_ENV === "production" && allowedOrigins.length === 0) {
    throw new Error("ADMIN_ALLOWED_ORIGINS is required in production");
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (new URL(databaseUrl).protocol !== "postgresql:" && new URL(databaseUrl).protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }

  const databasePoolMax = Number(env.ADMIN_DATABASE_POOL_MAX ?? 10);
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 50) {
    throw new Error("ADMIN_DATABASE_POOL_MAX must be an integer between 1 and 50");
  }

  if (env.NODE_ENV === "production" && (!env.ADMIN_WEBAUTHN_ORIGIN || !env.ADMIN_WEBAUTHN_RP_ID)) {
    throw new Error("ADMIN_WEBAUTHN_ORIGIN and ADMIN_WEBAUTHN_RP_ID are required in production");
  }
  const webAuthnCandidate = env.ADMIN_WEBAUTHN_ORIGIN ?? allowedOrigins[0] ?? "http://localhost:3102";
  const webAuthnUrl = new URL(webAuthnCandidate);
  if (
    webAuthnUrl.pathname !== "/" || webAuthnUrl.search || webAuthnUrl.hash
    || webAuthnUrl.username || webAuthnUrl.password || webAuthnUrl.origin !== webAuthnCandidate
  ) {
    throw new Error("ADMIN_WEBAUTHN_ORIGIN must contain an exact origin only");
  }
  const webAuthnOrigin = webAuthnUrl.origin;
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(webAuthnOrigin)) {
    throw new Error("ADMIN_WEBAUTHN_ORIGIN must be included in ADMIN_ALLOWED_ORIGINS");
  }
  const originHost = new URL(webAuthnOrigin).hostname;
  const webAuthnRpId = env.ADMIN_WEBAUTHN_RP_ID?.trim() || originHost;
  if (originHost !== webAuthnRpId && !originHost.endsWith(`.${webAuthnRpId}`)) {
    throw new Error("ADMIN_WEBAUTHN_RP_ID must match the WebAuthn origin host or a parent domain");
  }
  const valkeyUrl = env.VALKEY_URL?.trim();
  if (env.NODE_ENV === "production" && (!valkeyUrl || !env.ADMIN_AUTH_RATE_LIMIT_KEY)) {
    throw new Error("VALKEY_URL and ADMIN_AUTH_RATE_LIMIT_KEY are required in production");
  }
  if (valkeyUrl && !["redis:", "rediss:"].includes(new URL(valkeyUrl).protocol)) {
    throw new Error("VALKEY_URL must use redis or rediss protocol");
  }

  return {
    port,
    host: env.ADMIN_API_HOST ?? "127.0.0.1",
    allowedOrigins,
    databaseUrl,
    databasePoolMax,
    webAuthnRpId,
    webAuthnRpName: env.ADMIN_WEBAUTHN_RP_NAME?.trim() || "SpaceY Admin",
    webAuthnOrigin,
    webAuthnChallengeTtlSeconds: positiveInteger(env, "ADMIN_WEBAUTHN_CHALLENGE_TTL_SECONDS", 300, 900),
    adminSessionTtlSeconds: positiveInteger(env, "ADMIN_SESSION_TTL_SECONDS", 28_800, 86_400),
    totpMaxAttempts: positiveInteger(env, "ADMIN_TOTP_MAX_ATTEMPTS", 5, 10),
    totpLockoutSeconds: positiveInteger(env, "ADMIN_TOTP_LOCKOUT_SECONDS", 900, 86_400),
    totpWindow: positiveInteger(env, "ADMIN_TOTP_WINDOW", 1, 1),
    valkeyUrl,
    authRateLimitMax: positiveInteger(env, "ADMIN_AUTH_RATE_LIMIT_MAX", 10, 100),
    authRateLimitWindowSeconds: positiveInteger(env, "ADMIN_AUTH_RATE_LIMIT_WINDOW_SECONDS", 300, 3_600),
  };
}
