# SpaceY private Admin API

NestJS/Fastify foundation for the private administration contour. It is intentionally absent from the public OpenAPI specification.

## Security contract

- The ingress must be private (Zero Trust/VPN). `ADMIN_ALLOWED_ORIGINS` is an exact comma-separated allowlist; production refuses to boot without it.
- Every non-health route is fail-closed behind an exact-origin guard and a DB-backed opaque `__Host-spacey_admin_session` cookie. Only the SHA-256 token hash is stored.
- Primary authentication is WebAuthn through `@simplewebauthn/server`: RP/origin and user verification are mandatory, challenges are hashed/expiring/single-use, and credential counters use compare-and-set updates.
- RBAC permissions are enforced in the API, never only in the UI.
- Content/economy mutations and immutable before/after audit records use one short PostgreSQL transaction.
- Content writes use an advisory resource lock plus an expected revision. Economy adjustments lock one wallet row and append an idempotent ledger entry with mandatory reason/case ID.
- `/ready` probes PostgreSQL, WebAuthn/session, encrypted TOTP recovery and Valkey rate limiting and remains fail-closed on any error.

Required production configuration: `DATABASE_URL`, `VALKEY_URL`, `ADMIN_AUTH_RATE_LIMIT_KEY`, `ADMIN_ALLOWED_ORIGINS`, `ADMIN_WEBAUTHN_ORIGIN`, `ADMIN_WEBAUTHN_RP_ID`, `ADMIN_TOTP_KEYRING`, `ADMIN_TOTP_ACTIVE_KEY_VERSION`, `ADMIN_API_HOST`, and `ADMIN_API_PORT`; pool, challenge, lockout and session TTLs have bounded defaults. Keys are supplied only by the secret store. `DATABASE_URL` must use the dedicated `spacey_admin` login role and is never committed.

Authentication endpoints are `POST /internal/admin/v1/auth/webauthn/authentication/options` and `/verify`. Successful verification issues a random opaque token in a Secure HttpOnly host-only cookie; only its SHA-256 hash is persisted. Credential registration endpoints require an existing authenticated admin session. TOTP and single-use recovery-code endpoints live under `/auth/recovery`; they are recovery-only, share a distributed Valkey limiter, maintain DB account lockout, reject reused TOTP timesteps, and create an immutable audit. TOTP secrets use versioned AES-256-GCM envelope encryption; recovery codes use salted scrypt hashes and are removed atomically. WebAuthn remains primary.
