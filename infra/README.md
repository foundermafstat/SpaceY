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

- `compose.production-data.yml`: one shared protected Valkey deployment.
- `compose.production.yml`: one blue or green app slot selected by its external env file.
- PostgreSQL is external Neon and is never declared as a production container.
- `/etc/spacey/*.env` and Valkey ACL files are host-managed secrets, not repository files.
- Every published SpaceY app image tag must equal the same full Git SHA; production Compose
  resolves each service by the immutable digest recorded in the release manifest.
- `.github/workflows/release-images.yml` runs only after a successful `platform-ci` push on
  `main`, publishes the seven service images to `ghcr.io/<owner>/<repo>/<service>:<full-sha>`,
  and uploads an attested digest manifest. It never emits a floating tag and refuses to move
  a full-SHA tag that already exists.
- Before merging to `main`, configure the GitHub repository variables `NEXT_PUBLIC_API_URL`
  and `NEXT_PUBLIC_BATTLE_WS_URL`. The release fails closed unless they are non-empty
  `https://` and `wss://` URLs respectively.
- Each registry image carries a signed GitHub SPDX SBOM attestation, BuildKit max provenance,
  signed GitHub build provenance, and an OCI revision label equal to the release SHA.

The shared Dockerfile runs as the unprivileged Node user with root-owned application files,
`HOME=/tmp`, disabled Next telemetry, and a per-image default service filter. It intentionally
still copies the installed monorepo and development dependencies into each runtime image. A
safe per-service `turbo prune`/standalone packaging pass remains future work; expect residual
image bloat until each service has an independently verified runtime dependency closure.

See `docs/SPACEY_EXACT_SHA_BLUE_GREEN_DEPLOY_RUNBOOK_2026-07-11_RU.md` before using these
manifests. Do not run a production migration or deployment from the local Compose file.
