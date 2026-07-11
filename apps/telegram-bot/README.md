# SpaceY Telegram Bot

NestJS/Fastify webhook service for Mini App launch links, durable referrals, notification preferences, support routing, and future Stars payments.

- `X-Telegram-Bot-Api-Secret-Token` is checked before parsing an update.
- PostgreSQL provides leased webhook deduplication and idempotent referral/support/preference writes.
- `/ready` verifies both PostgreSQL and Telegram `getMe`; `/health` is dependency-free.
- Telegram calls have a bounded timeout, reject redirects, validate response envelopes, and never include the bot token in adapter errors.
- `/start` returns a Mini App launch button. `/support` opens one durable ticket per Telegram user; later text is appended to that ticket.
- Stars cannot be enabled yet: setting `TELEGRAM_STARS_ENABLED=true` fails startup.

Required runtime secrets/configuration:

- `TELEGRAM_DATABASE_URL`: pooled PostgreSQL URI for a login granted only `spacey_telegram_bot`.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.
- `SPACEY_MINI_APP_URL` (HTTPS in production).
- Optional: `TELEGRAM_DB_POOL_SIZE`, `TELEGRAM_REQUEST_TIMEOUT_MS`, `TELEGRAM_PROCESSING_LEASE_SECONDS`.

Run the new database migration and re-apply `packages/db/sql/roles.grants.template.sql` before enabling the service. Never commit real values.
