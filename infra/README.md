# SpaceY infrastructure scaffolds

## Local integration stack

The local Compose file builds the current workspace and starts game-web, API, battle worker,
admin UI/API, bot, jobs, PostgreSQL, Valkey, and MinIO replay storage.

```bash
cp infra/env/compose.local.env.example /tmp/spacey-compose.env
# Replace the local-only placeholder values in /tmp/spacey-compose.env.
docker compose --env-file /tmp/spacey-compose.env \
  -f infra/compose.local.yml up --build --wait
```

This is development infrastructure. Do not reuse its credentials, database volume, or MinIO
configuration in staging/production.

## Production slots

- `compose.production-data.yml`: one isolated PostgreSQL container and one protected Valkey
  deployment per environment data-plane project. Neither service publishes a host port.
- `compose.production.yml`: one blue or green app slot selected by its external env file.
- PostgreSQL data is persisted in the environment-specific `postgres-data` Docker volume;
  backups and restore rehearsals remain mandatory before production cutover.
- `access-bootstrap` is a one-shot profile that creates/rotates one credential login per service,
  assigns exactly one NOLOGIN group role and keeps PostgreSQL internal to the data network.
- `/etc/spacey/*.env`, the PostgreSQL bootstrap password and Valkey ACL files are host-managed
  secrets, not repository files.
- Every published SpaceY app image tag must equal the same full Git SHA; production Compose
  resolves each service by the immutable digest recorded in the release manifest.
- `.github/workflows/release-images.yml` runs only after a successful `platform-ci` push on
  `main`, publishes the seven service images to `ghcr.io/<owner>/<repo>/<service>:<full-sha>`,
  and uploads an attested digest manifest. It never emits a floating tag and refuses to move
  a full-SHA tag that already exists.
- Release images contain no environment-specific game API or battle WebSocket URL. The
  production/staging game client calls same-origin `/api/*`; the API returns the WebSocket URL
  from runtime-only `BATTLE_WS_PUBLIC_URL`, which must be a credential-free `wss:` URL using
  `/realtime/v1/battle` outside development/test.
- Canonical origins are `https://spacey.aima.space` for production players,
  `https://staging.spacey.aima.space` for staging players, `https://public.spacey.aima.space`
  for the path-scoped Public API, and private Zero Trust ingress at
  `https://admin.spacey.aima.space` / `https://admin-staging.spacey.aima.space`.
- Each registry image carries a signed GitHub SPDX SBOM attestation, BuildKit max provenance,
  signed GitHub build provenance, and an OCI revision label equal to the release SHA.

The shared Dockerfile runs as the unprivileged Node user with root-owned application files,
`HOME=/tmp`, disabled Next telemetry, and a per-image default service filter. It intentionally
still copies the installed monorepo and development dependencies into each runtime image. A
safe per-service `turbo prune`/standalone packaging pass remains future work; expect residual
image bloat until each service has an independently verified runtime dependency closure.

See `docs/SPACEY_EXACT_SHA_BLUE_GREEN_DEPLOY_RUNBOOK_2026-07-11_RU.md` before using these
manifests. Do not run a production migration or deployment from the local Compose file.

Before any host action, validate the repository examples, then validate the populated non-secret
env file. The validator rejects placeholder digests, project/network collisions, production/staging
port overlap and credentials accidentally placed in a slot env.

```bash
node infra/validate-deployment-env.mjs --examples
node infra/validate-deployment-env.mjs production-data /etc/spacey/data.env
node infra/validate-deployment-env.mjs production-blue /etc/spacey/blue.env
node infra/validate-deployment-env.mjs production-green /etc/spacey/green.env
```

## Isolated staging on the current VPS

Staging reuses the exact production Compose topology but has its own config directory,
Docker project/network/PostgreSQL volume, Valkey ACL, replay bucket and Telegram bot.
It never shares production credentials or data.

```bash
cp infra/env/staging.env.example /etc/spacey-staging/slot.env
# Replace image digests with one signed release manifest. Keep credentials only in
# /etc/spacey-staging/*.env with owner root and mode 0600.
docker compose --env-file /etc/spacey-staging/slot.env \
  -f infra/compose.production-data.yml up -d --wait
docker compose --env-file /etc/spacey-staging/slot.env \
  -f infra/compose.production-data.yml --profile bootstrap run --rm access-bootstrap
docker compose --env-file /etc/spacey-staging/slot.env \
  -f infra/compose.production.yml --profile migration run --rm migrator
docker compose --env-file /etc/spacey-staging/slot.env \
  -f infra/compose.production.yml --profile migration run --rm grants
docker compose --env-file /etc/spacey-staging/slot.env \
  -f infra/compose.production.yml up -d --wait
```

`SPACEY_SLOT_PROJECT=spacey-staging` and `SPACEY_DATA_PROJECT=spacey-staging-data` are deliberately
different. Do not set `COMPOSE_PROJECT_NAME`: it overrides the data-plane project and breaks this
isolation. Validate the populated file before Compose reads it:

```bash
node infra/validate-deployment-env.mjs staging /etc/spacey-staging/slot.env
```

Use `infra/nginx/spacey-staging-gateway.conf`. The player origin is
`https://staging.spacey.aima.space`; the admin listener is loopback-only and must be exposed
only through Zero Trust/VPN as `admin-staging.spacey.aima.space`. Production Nginx and
production Compose projects are not changed during staging rehearsal.

Production ingress is intentionally split: `spacey-gateway.conf` serves the player Mini App,
`spacey-admin-private.conf` binds only to loopback for the Zero Trust admin tunnel, and
`spacey-public-api.conf` exposes only `/public/v1/*`, `/health`, and the canonical
`/openapi.json`. Do not add player `/api/*`, admin routes, or battle WebSockets to the Public API
virtual host.

Before any migration or slot start, validate the downloaded release artifact and all locally
pulled image digests with `infra/verify-release-manifest.sh`. `--structure-only` is intended only
for offline fixture/CI checks; rollout requires the default mode with GitHub attestations and OCI
revision labels.

## PostgreSQL off-host backup

`infra/postgres/backup-restore.sh` streams a custom PostgreSQL archive from the single database
container into a digest-pinned Restic container and an HTTPS S3-compatible repository. Restic
encrypts client-side. Every run downloads the new snapshot, validates it with `pg_restore --list`,
compares SHA-256/size, applies retention, checks repository data and atomically writes JSON health
evidence. Plaintext archives exist only in the database container's `/tmp` tmpfs.

Copy `infra/env/postgres-backup.env.example`, provision the documented `0600` secrets, pull and
verify the configured Restic digest, initialize once with the typed confirmation, then install
`infra/systemd/spacey-postgres-backup.{service,timer}`. Restore requires an empty database,
`spacey_migrator`, a full snapshot ID and a target-specific typed confirmation. A staging restore
rehearsal and application smoke test remain mandatory; the script never overwrites a non-empty DB.
