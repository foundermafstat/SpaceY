# SpaceY: статус реализации и deployment gate

Дата: 2026-07-12  
Статус: локальный hardening выполнен частично; staging/production rollout заблокирован обязательными release gates

Этот документ заменяет optimistic readiness-оценку из
`SPACEY_STAGING_VERTICAL_SLICE_IMPLEMENTATION_STATUS_2026-07-11_RU.md`.

## 1. Зафиксированное решение по данным

- Для каждого environment используется один закрытый Docker PostgreSQL контейнер.
- PostgreSQL и Valkey находятся в отдельном data-plane Compose project и не публикуют host ports.
- Production и staging имеют разные projects, networks, volumes, credentials и backup prefixes.
- API, battle-worker, admin, jobs, bot, readonly, backup и migrator используют отдельные logins/roles.
- Старые опубликованные DB credentials не используются.

## 2. Что закрыто локально

- Исправлен out-of-order race ротации WS tickets; consume проверяет version/current key/user.
- Tickets отзываются по attempt и user, включая abandon и privacy deletion.
- Bootstrap возвращает discriminated active PvE/PvP gameplay; Hangar корректно resume/abandon/cancel.
- Mission attempt создаётся без лишнего ticket; ticket выдаётся только `/connection`.
- Добавлен jobs sweeper PvE `CONNECTING > 60s` через `FOR UPDATE SKIP LOCKED` и durable cleanup outbox.
- Finalizer сверяет request config с immutable `battle_sessions.simulation_config_hash`.
- Prisma Client и Public SDK перегенерированы.
- `/openapi.json` использует канонический OpenAPI 3.1.1 с ETag/source hash.
- Protocol аддитивно передаёт arena dimensions и module `visualKey`.
- Client получил корректные arena coordinates, angle-wrap interpolation, multiweapon input,
  typed event queue и WebSocket backpressure.
- Production routes больше не достигают legacy client-authoritative simulation/rewards.
- Добавлен render-only Three.js/`three2d` WebGL renderer: module states, detach, projectiles,
  shields, deterministic event VFX/audio, engine loops и Canvas2D fallback.
- Добавлены единый Docker PostgreSQL/Valkey data-plane, automatic role/login bootstrap,
  production/staging/public/admin Nginx configs и exact-SHA manifest verifier.
- Добавлен encrypted off-host PostgreSQL backup/restore через digest-pinned Restic + S3,
  round-trip checksum validation, retention, health evidence и fail-closed empty-target restore.

## 3. Выполненные проверки

- game-web source TypeScript: green.
- simulation typecheck: green.
- battle-worker typecheck: green.
- jobs typecheck: green.
- public SDK TypeScript/contract: green.
- root client tests: 14/14 green.
- battle-worker tests: 58 passed, 2 PostgreSQL integration tests skipped без test DB.
- jobs tests: 19 passed, 2 PostgreSQL integration tests skipped без test DB.
- ticket/privacy targeted tests: 8/8 green.
- lifecycle/memory repository targeted tests: 10/10 green.
- protocol/browser codec tests: 7/7 green.
- backup/access shell syntax, backup example validation, Compose YAML parse,
  deployment-env validation и `git diff --check`: green.

## 4. Что ещё блокирует staging/production

1. Выполнить clean dependency install; package/lock уже содержат runtime `yaml`.
2. Пройти полный workspace typecheck/test/build, Gitleaks, Buf/OpenAPI/AsyncAPI compatibility и SBOM.
3. Поднять ephemeral Docker PostgreSQL/Valkey, применить все migrations/grants и выполнить реальные
   RLS/auth/ticket/result/repair/backup integration tests.
4. Commit/push через PR и получить зелёный GitHub `platform-ci`.
5. Получить семь exact-SHA images, SBOM/provenance attestations и attested release manifest.
6. Развернуть изолированный staging, исправить TLS и пройти Telegram/PvE/PvP/result/repair browser E2E.
7. Пройти real backup restore, worker/S3/Valkey fault drills и load ladder до целевого gate.
8. Только после этого разрешить manifest-based blue/green production deployment.

## 5. Подтверждённый live state

- `https://spacey.aima.space/` отвечает `200` старым frontend-only deployment.
- Production `/health` и `/openapi.json` отвечают `404`.
- `staging.spacey.aima.space` имеет неподходящий TLS certificate.
- Последний remote `platform-ci` для `1f47b7b` завершился failure; `release-images` был skipped.
- SSH, migrations, Nginx reload, Docker restart и production mutation в этом проходе не выполнялись.

Причина: обязательный `/deploy` gate вернул `DEPLOY_BLOCKED` и запрещает legacy PM2/web-only
deployment либо прямой обход release manifest/staging/rollback/load gates.
