# SpaceY: статус реализации первого staging vertical slice

> Superseded 2026-07-12: актуальный статус находится в
> `SPACEY_IMPLEMENTATION_AND_DEPLOYMENT_STATUS_2026-07-12_RU.md`.

Дата проверки: 2026-07-11  
Статус: локальный source-level checkpoint; staging и production readiness не подтверждены

## 1. Итог

Повторный интеграционный аудит не оставил незакрытых P0 в текущем diff. Production не менялся,
commit/push/deploy/migrations/codegen не выполнялись. Старый PM2 deploy удалён и fail-closed;
production разрешается только через подписанный exact-SHA manifest после staging gates.

## 2. Реализовано локально

| Этап | Реализация |
| --- | --- |
| CI/release | Gitleaks fingerprint, canonical Proto path, Buf compatibility, attest permissions, same-origin frontend image, exact-SHA release inputs |
| Security/content | Atomic Telegram replay/refresh, deletion-pending guard, immutable published content, stored simulation config/hash, distributed rate limits, monotonic one-time tickets |
| Battle lifecycle | Hangar-owned attempts, Resume/Abandon, 60s reconnect, 20s PvP no-show, zero-attach broker, crash reconciliation, ordered bounded I/O queues, WS backpressure |
| Result/economy | Immutable result insert, exactly-once reward/finalization, S3-independent replay attach, persistent per-module damage, reloadable result page, quote/full repair transaction |
| Simulation v2 | Fixed deterministic energy/heat/shields/multiweapon/module topology, detach, sudden death/draw, heterogeneous enemies, three server-owned PvE objectives |
| Client boundary | Socket lifecycle, input controller, 256-command resend buffer, 100ms snapshot interpolation, render-only canvas adapter, DOM HUD telemetry, dual-stick/reset handling |
| Admin/Public API | Draft clone/validate/publish/rollback, WebAuthn session controls, developer clients/API keys/OAuth/webhooks with overlap rotation, expanded privacy/export/retention |
| Staging infra | Isolated Compose projects/networks/config roots, staging gateway/private admin ingress, Valkey hardening, exact-SHA validation, fail-closed environment checks |
| Observability/load | 15 real OTel instruments, 17 numeric alert definitions, seven dashboard panels, strict 2→100→500→1k→10k load contract |

## 3. Закрытые интеграционные дефекты

- повторный Telegram Mini App reload больше не переиспользует single-use `initData`;
- конкурентная PvE/PvP ticket rotation оставляет действительным только последний ticket;
- PostgreSQL/Valkey/S3/transport lifecycle I/O не удерживает общий simulation tick;
- cleanup retry не повторяет DB finalization или replay upload;
- `mission_results` остаётся append-only: wallet/progression snapshots пишутся в первый INSERT;
- replay status выводится из replay metadata, result не мутируется;
- damage применяется только к реально поражённым inventory modules и сразу создаёт repairable `DAMAGED` state;
- admin publish блокирует модуль без bounded `repairCostCredits`;
- Stars privacy anonymization сохраняет immutable financial facts и доступна jobs только через узкую DB-функцию;
- completed PvP ticket восстанавливает result route через сохранённый attempt;
- staging API принимает staging WSS host при production-optimized Node runtime;
- production/staging gateways маршрутизируют exact `/openapi.json` в API.

## 4. Выполненные узкие проверки

- simulation: 19/19;
- persistent module damage: 6/6;
- battle-worker lifecycle/backpressure/finalization: целевые наборы зелёные;
- API memory repository: 6/6; matchmaking/tickets: 9/9;
- admin content: 5/5; jobs privacy: 6/6;
- root client authority/input/interpolation/Telegram/PvP recovery: 12/12;
- targeted TypeScript: client, contracts, simulation, protocol, worker, admin, jobs, observability;
- YAML/OpenAPI/AsyncAPI parse, Prisma schema validate, Compose/static infra, load harness, alert catalog и `git diff --check`;
- targeted scan не нашёл опубликованные Neon/SSH credentials в workspace.

## 5. Оставшиеся блокеры

### Требуют подтверждения на ресурсоёмкие действия

1. Установить и зафиксировать `pixi.js` и runtime YAML parser в `pnpm-lock.yaml`.
2. Выполнить Prisma Client codegen и Public SDK generation.
3. Заменить Canvas adapter на Pixi render-only implementation.
4. Отдавать из `/openapi.json` канонический `specs/player-public.openapi.yaml`, а не Swagger projection.
5. После этого запустить полный workspace typecheck/test/build и secret/SBOM gates.

До Public SDK generation текущий `platform-ci` гарантированно останется красным на generated diff.
До Prisma codegen общий API typecheck видит устаревший client относительно новых schema fields.

### Требуют внешнего staging-контура

- ротированный credential и отдельный staging Neon project/roles;
- изолированные Valkey ACL, S3/KMS, Telegram bot, DNS/certificates и Zero Trust ingress;
- применение migrations/grants и публикация seed draft через admin;
- exact-SHA images/manifest/attestations и реальный staging deploy;
- Telegram → Hangar → 3 PvE → result → repair и ranked PvP browser E2E;
- PostgreSQL/Valkey multi-worker integration, worker-kill, S3 outage, restart, packet chaos, backup/restore и rollback rehearsals;
- настоящий staging load broker и лестница до 10k WS/5k duels с 25% CPU/RAM reserve.

### Оставшиеся технические долги

- input journal bounded и безопасен, но физически всё ещё использует Valkey Hash, а не Streams;
- replay-pending metric worker-local и не показывает orphan age после crash;
- outbox metric измеряет age при claim, а не global oldest pending;
- frontend Sentry и provider-specific import alert/dashboard definitions не проверены runtime;
- Stars остаются выключенными.

## 6. Следующий безопасный порядок

1. Получить подтверждение на dependency install/codegen/full checks.
2. Закрыть два оставшихся P1: generated Public SDK и canonical runtime OpenAPI.
3. Получить только новые staging secrets через root-owned env/secret store; старые опубликованные значения не использовать.
4. Создать signed exact-SHA release manifest и развернуть isolated staging.
5. Пройти browser E2E, integration, load и fault gates.
6. Только после readiness review обсуждать production cutover и новый manifest-based `/deploy`.
