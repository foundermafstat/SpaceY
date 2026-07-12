# `@spacey/db`

Production PostgreSQL foundation for SpaceY. The package owns the Prisma data
model, generated client, baseline migration, UUIDv7 helper, RLS policies and
credential-free role templates. It never contains database credentials.

## Database boundaries

- Player identity: users, Telegram identities/replay hashes and rotating auth sessions.
- Versioned content: releases, missions, research and achievement definitions.
- Player state: immutable build revisions, inventory transitions, wallet ledger,
  progression, research, achievements and seasons.
- Authoritative runtime: mission attempts/results, PvP matches and replay metadata.
- External/admin systems: API clients, keys, webhooks, WebAuthn-bound admin
  sessions, RBAC, immutable content revisions/audit, transactional outbox, job
  idempotency and Telegram Stars events.
- Telegram bot: leased update deduplication, referrals, support tickets/messages,
  and monotonic notification preferences.

All primary keys are application-supplied UUIDv7 values. Use `createUuidV7()`;
do not add random UUID database defaults. Monetary/resource amounts use `bigint`
minor units. Times are UTC `timestamptz`. List endpoints should use `(createdAt,
id)` keyset cursors backed by the included composite indexes.

Services create clients through `createPrismaClient(connectionString)`. The
factory uses Prisma 7's required `@prisma/adapter-pg`; services own connection
lifecycle and must call `$disconnect()` during graceful shutdown.

## Environment and commands

Use a role-scoped `DATABASE_URL` only in application services. Set `DIRECT_URL`
only for the migrator against the internal Docker hostname `postgres:5432`;
Prisma prefers it when both are present.

```bash
pnpm --filter @spacey/db validate
pnpm --filter @spacey/db generate
pnpm --filter @spacey/db test
pnpm --filter @spacey/db migrate:deploy
SPACEY_SEED_ENV=local pnpm --filter @spacey/db db:seed
```

`generate` and `validate` use a deliberately unreachable placeholder URL and do
not open a database connection. Migration commands fail unless `DIRECT_URL` or
`DATABASE_URL` is supplied. Never use a credential copied into tickets, chat or
source control; rotate any exposed PostgreSQL password before first connection.

The seed is repeatable but intentionally restricted to explicit `local` or
`staging` use. It creates the three authoritative PvE definitions and DB-driven
bootstrap inventory/build configuration; local mode publishes the fixture while
staging leaves it as a draft for admin validation. Published production content
is created and promoted only through the audited admin contour.

## Empty database bootstrap

1. Run the one-shot `access-bootstrap` profile from `infra/compose.production-data.yml`.
   It applies `sql/roles.bootstrap.template.sql`, creates credential logins from
   root-owned files and grants exactly one NOLOGIN group role per service.
2. Configure the migration login to `SET ROLE spacey_migrator` by default, then
   apply the baseline with the direct connection.
3. Run `sql/roles.grants.template.sql` as the object owner after migrations.
4. Each player-scoped transaction must execute `SET LOCAL spacey.user_id =
   '<uuid>'` before accessing an RLS-protected table. Always reset context by
   transaction boundary; never use session-level `SET` with a pool.

The runtime, battle, Telegram bot, jobs and admin roles are deliberately separate. Admin and
jobs tables are protected by grants; player-owned rows additionally use RLS.
The NOBYPASSRLS battle role has explicit policies only on authoritative battle
tables, while admin economy writes go through a narrow audited
`SECURITY DEFINER` function. Tables used by consent-filtered public functions
allow only their object owner to bypass RLS; application login roles do not.

## Important invariants

- `WalletLedgerEntry`, `InventoryTransition`, `ContentDefinitionRevision`,
  `AdminAuditLog` and `StarsPaymentEvent` are append-only at the database level.
- Wallet and inventory history carry composite owner constraints.
- Mission attempts bind one content release, mission definition, build revision,
  simulation version and seed. Results are created by the battle service only.
- Battle sessions persist input journals plus binary state checkpoints every 60
  ticks (2 seconds at 30 Hz) for deterministic worker recovery.
- `PlayerCommandIdempotency` persists the exact response for retried build and
  economy commands; `LegacyBuildImport` permits one schema-v3 import per user.
- Refresh tokens, API secrets, webhook secrets and Telegram init data are stored
  only as hashes; WebAuthn public keys are binary. Admin TOTP material is stored
  only as versioned AES-256-GCM ciphertext, accepted timesteps prevent replay,
  and single-use recovery codes are salted scrypt hashes.
- Idempotency keys are unique for mission creation/results, economy mutations,
  inventory transitions, audit records, outbox events, jobs and Stars updates.

Prisma cannot express partial indexes, RLS, triggers or several cross-column
constraints. They live in the baseline SQL and must be preserved when reviewing
future migration diffs.

The public leaderboard/profile/statistics views are exposed only through
`spacey_public_leaderboard(limit)`, `spacey_public_profile(user_id)` and
`spacey_public_aggregate_stats()`. These security-definer functions enforce
visibility/analytics consent; application roles never receive unrestricted
cross-player table access.
