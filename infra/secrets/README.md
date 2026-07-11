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

Use the pooled Neon URL as `DATABASE_URL` for runtime services and a direct Neon URL as
`DIRECT_URL` only for migrations and backup tooling. Use distinct least-privilege database
roles for player runtime, admin, and migrations.

PostgreSQL role settings such as `statement_timeout`,
`idle_in_transaction_session_timeout`, and `default_transaction_read_only` on the
NOLOGIN group roles are not a substitute for login-role settings. Apply the matching
settings explicitly to every credential-bearing Neon login role during provisioning and
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
