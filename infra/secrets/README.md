# Production secrets

Production credentials are not stored in this repository.

The deploy host must provide root-owned files with mode `0600`:

- `/etc/spacey/game-web.env`
- `/etc/spacey/api.env`
- `/etc/spacey/admin-api.env`
- `/etc/spacey/admin-web.env`
- `/etc/spacey/battle-worker.env`
- `/etc/spacey/jobs.env`
- `/etc/spacey/telegram-bot.env`
- `/etc/spacey/migrator.env`
- `/etc/spacey/data.env`

Valkey ACL material is also external to Git:

- `/etc/spacey/valkey/users.acl`
- `/etc/spacey/valkey/health-password`

The self-hosted PostgreSQL data-plane requires root-owned bootstrap/rotation files that are
never exposed to application containers:

- `/etc/spacey/postgres/superuser-password`
- `/etc/spacey/postgres/backup-password`
- `/etc/spacey/postgres/migrator-password`
- `/etc/spacey/postgres/runtime-password`
- `/etc/spacey/postgres/battle-worker-password`
- `/etc/spacey/postgres/admin-password`
- `/etc/spacey/postgres/jobs-password`
- `/etc/spacey/postgres/telegram-bot-password`
- `/etc/spacey/postgres/readonly-password`

Encrypted off-host backups additionally use root-owned mode `0600` files:

- `/etc/spacey/backup/postgres.env` — non-secret policy and paths;
- `/etc/spacey/backup/restic-password` — Restic repository encryption key;
- `/etc/spacey/backup/s3.env` — scoped S3 credentials (`Get/List/Put/Delete` only on the backup prefix).

The backup login has `pg_read_all_data`, `BYPASSRLS`, read-only sessions and a connection limit of
two; it has no write, ownership, role-management or server-file privilege. Never reuse it in an app.

Use host `postgres:5432` only from the isolated data-plane Docker network. Each service env file
uses its own credential-bearing login mapped to exactly one NOLOGIN group role; only
`migrator.env` may use the migration owner and `DIRECT_URL`. The container bootstrap superuser
must never appear in an application `DATABASE_URL`.

PostgreSQL role settings such as `statement_timeout`,
`idle_in_transaction_session_timeout`, and `default_transaction_read_only` on the
NOLOGIN group roles are not a substitute for login-role settings. Apply the matching
settings explicitly to every credential-bearing PostgreSQL login role during provisioning and
verify them with `SHOW` through that exact credential.

Required separation:

- `api.env`, `battle-worker.env`, and `jobs.env` use pooled runtime credentials;
- `admin-api.env` uses the separate admin database role;
- `migrator.env` is the only service file allowed to contain `DIRECT_URL`;
- `api.env` and `jobs.env` use scoped object-storage credentials for the dedicated privacy-export bucket;
- privacy exports require an HTTPS S3-compatible endpoint and SSE-KMS key; the jobs readiness probe stays closed without them;
- the Telegram bot token is present only where the integration requires it;
- Stars remain disabled until the economy audit is complete.

If any credential appears in chat, a ticket, shell history, CI output, or Git, treat it as
compromised: rotate it first, revoke the old value, then update the external secret files.
Do not test the exposed value even if it still works.

Never copy database URLs, Telegram bot tokens, signing keys, or object-storage credentials
into GitHub Actions logs, issue trackers, chat transcripts, Docker images, or backups.

## Privacy export bucket controls

The privacy-export bucket is private and separate from public assets/replays. Enable S3 Block
Public Access, deny non-TLS requests, restrict the API role to `GetObject` plus bucket-level
`ListBucket` for readiness and the jobs role to `PutObject` plus bucket-level `ListBucket`, and restrict both roles to the `privacy-exports/` prefix and configured
KMS key. The application `Expires` response header does **not** delete an object.

Apply `infra/s3/privacy-exports-lifecycle.json` to expire current objects after seven days,
remove noncurrent versions after one day, remove expired delete markers, and abort incomplete
uploads. Production readiness requires verifying this lifecycle on the real private bucket;
otherwise `export_expires_at` is only an application access boundary, not storage erasure.

Apply `infra/s3/battle-replays-lifecycle.json` to the private replay bucket as well. It enforces
the 30-day replay retention policy and removes noncurrent versions; the `Expires` object header
alone is not a deletion control.
Run the one-shot `access-bootstrap` Compose profile before migrations and after
credential rotation. It is idempotent and never exposes PostgreSQL on a host
port. Application `DATABASE_URL` values must use the matching `*_login` role;
the migrator URL must set role `spacey_migrator` for object ownership.
