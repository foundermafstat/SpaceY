# SpaceY: exact-SHA blue/green production runbook

Дата: 2026-07-11  
Статус: исполняемый conditional workflow; production разрешён только после `DEPLOY_READY`

## 0. Авторизация `/deploy`

Legacy `deploy.sh`, PM2 и web-only rollout запрещены. `/deploy` не собирает images локально,
не коммитит и не пушит код: он принимает только уже опубликованный CI release с неизменяемыми
digest. До подключения к production host необходимо выполнить локальный gate:

```bash
chmod 0600 /path/to/readiness-evidence.json
/Users/irine/.codex/skills/deploy/scripts/deploy_spacey.sh check \
  --sha "<full-40-character-git-sha>" \
  --manifest /path/to/spacey-release-manifest.json \
  --readiness /path/to/readiness-evidence.json \
  --repository foundermafstat/SpaceY \
  --workspace /Users/irine/Desktop/SpaceY
```

Gate проверяет SHA в `origin/main`, структуру и GitHub attestation manifest, успешные
`platform-ci`/`release-images` для этого SHA, совпадение workflow run IDs и свежий staging
readiness record. Формат readiness record задан в
`infra/deploy/readiness-evidence.example.json`; проверка выполняется
`infra/deploy/validate-readiness-evidence.mjs`. Каждый из 12 gates должен иметь `true` и SHA-256
digest отдельного доказательства; placeholder digest запрещён. Record действует семь дней,
связан с SHA-256 конкретного manifest и хранится с mode `0600`.

Только вывод `DEPLOY_READY` разрешает продолжить разделы ниже. Любой `DEPLOY_BLOCKED` или сбой
последующего шага останавливает rollout. SSH допускается только через настроенный ключ/agent с
`BatchMode=yes` и `StrictHostKeyChecking=yes`; пароль, DB URL или token нельзя передавать в
командной строке, чате, Git или deployment report.

## 1. Предусловия

- Все ранее опубликованные DB credentials отозваны и не переиспользуются.
- Один environment-specific Docker PostgreSQL контейнер запущен без host port; production и staging используют разные projects/networks/volumes.
- `access-bootstrap` создал отдельные migrator, runtime, battle-worker, telegram-bot, admin, jobs и readonly logins; каждой credential-bearing login role выдана только одна NOLOGIN group role.
- Для каждого PostgreSQL login явно проверены `statement_timeout`, `idle_in_transaction_session_timeout`, а для readonly также `default_transaction_read_only=on`.
- Runtime подключается только к внутреннему `postgres:5432`; direct URL существует только в migrator/backup env.
- `/etc/spacey/*.env` принадлежат root и имеют mode `0600`.
- App images собраны одним CI run, прошли gates и опубликованы с tag, равным полному 40-символьному Git SHA.
- OCI label `org.opencontainers.image.revision` каждого app image равен тому же SHA.
- Game-web image не содержит environment-specific API/WS URL: production и staging используют same-origin `/api/*`, а API выдаёт battle WS URL из runtime-only `BATTLE_WS_PUBLIC_URL`.
- Для production `BATTLE_WS_PUBLIC_URL=wss://spacey.aima.space/realtime/v1/battle`; для staging — `wss://staging.spacey.aima.space/realtime/v1/battle`. API fail-closed при отсутствии значения или неканоническом/non-WSS URL.
- В env каждого backend-процесса заданы `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN`, `OTEL_SERVICE_NAME`, `SPACEY_RELEASE_SHA` и `OBSERVABILITY_REQUIRED=true`; `OTEL_RESOURCE_ATTRIBUTES` содержит совпадающие `deployment.environment.name` и `service.version`.
- `spacey-data` network, PostgreSQL и общий Valkey запущены отдельно от blue/green slots.
- Encrypted off-host PostgreSQL backup успешно создан и восстановлен в изолированный rehearsal database.
- Nginx `active` — атомарно заменяемая symlink на один из каталогов `slots/blue` или `slots/green`.

Production PostgreSQL является частью `infra/compose.production-data.yml`, но не app slots: blue/green
контейнеры меняются независимо от единственного data volume. База и Valkey никогда не публикуют host ports.

`.github/workflows/release-images.yml` запускается только после успешного `platform-ci` для push в `main`. Он публикует семь service images в `ghcr.io/<owner>/<repo>/<service>:<full-sha>`, добавляет registry SBOM/provenance attestations и сохраняет `spacey-release-manifest-<sha>` с digest каждого image. Workflow отказывается перезаписывать уже существующий full-SHA tag. После частично неуспешной публикации recovery выполняется новым commit/SHA, а не перемещением старого tag.

Текущий общий Dockerfile сохраняет весь установленный monorepo и dev dependencies в runtime stage. Это известный остаточный image-bloat риск, а не нарушение изоляции runtime: Compose запускает непривилегированного пользователя, read-only rootfs, drop-all capabilities и exact service filter. Переход на проверенный per-service prune/standalone layout выполняется отдельным hardening change после runtime regression tests.

## 2. Первичная подготовка host

Перед назначением slot ports сохранить фактическую карту слушателей и убедиться, что порты
выбранного неактивного slot свободны:

```bash
ss -ltnp
docker ps --format '{{.Names}}\t{{.Ports}}'
readlink -f /etc/spacey/nginx/active
```

Если порт занят не соответствующим SpaceY slot, rollout блокируется: чужой процесс не
останавливается автоматически и порт не переназначается без изменения проверенного env/config.

```bash
install -d -m 0700 /etc/spacey /etc/spacey/valkey /etc/spacey/postgres
install -d -m 0755 /etc/spacey/nginx/slots/blue /etc/spacey/nginx/slots/green
install -d -m 0755 /opt/spacey

cp infra/env/data.env.example /etc/spacey/data.env
# Заполнить verified PostgreSQL/Valkey digests и resource ceilings, затем:
node infra/validate-deployment-env.mjs production-data /etc/spacey/data.env
docker compose --env-file /etc/spacey/data.env \
  -f infra/compose.production-data.yml up -d --wait
```

Data Compose сам создаёт и владеет external-for-slots network `spacey-data`; предварительный
`docker network create spacey-data` запрещён, потому что создаёт network без Compose ownership
labels. В slot env используется `SPACEY_SLOT_PROJECT`, а не `COMPOSE_PROJECT_NAME`.

Создать по одному upstream-файлу (`game-web.conf`, `api.conf`, `battle-worker.conf`, `admin-web.conf`, `admin-api.conf`, `telegram-bot.conf`) в каждом slot-каталоге. Порты берутся из `infra/env/blue.env.example` и `infra/env/green.env.example`.

```bash
ln -s /etc/spacey/nginx/slots/blue /etc/spacey/nginx/active
nginx -t
systemctl reload nginx
```

Admin Nginx слушает только `127.0.0.1:8443`. Zero Trust tunnel/VPN должен быть настроен отдельно; публичный DNS/ingress к admin API запрещён.

## 3. Проверка release SHA

На deploy host checkout используется только как набор deployment manifests. Код runtime берётся из immutable images.

```bash
RELEASE_SHA="<full-40-character-git-sha>"
printf '%s' "$RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$'
git fetch origin main
test "$(git rev-parse "${RELEASE_SHA}^{commit}")" = "$RELEASE_SHA"
git merge-base --is-ancestor "$RELEASE_SHA" origin/main
```

Записать SHA и семь digest из release manifest в env неактивного slot (`GAME_WEB_IMAGE_DIGEST`, `API_IMAGE_DIGEST`, `BATTLE_WORKER_IMAGE_DIGEST`, `ADMIN_WEB_IMAGE_DIGEST`, `ADMIN_API_IMAGE_DIGEST`, `TELEGRAM_BOT_IMAGE_DIGEST`, `JOBS_IMAGE_DIGEST`). Каждый digest обязан иметь формат `sha256:` и 64 hex-символа. Нельзя использовать `latest`, short SHA, digest вне manifest или разные SHA для сервисов одного release.

До pull проверить non-secret slot env:

```bash
node infra/validate-deployment-env.mjs production-green /etc/spacey/green.env
```

Для blue используется mode `production-blue`. Проверка не читает service secret env и не заменяет
проверку их owner/mode `0600`.

## 4. Pull и supply-chain проверка

Пример для green slot:

```bash
docker compose --env-file /etc/spacey/green.env \
  -f infra/compose.production.yml pull

docker compose --env-file /etc/spacey/green.env \
  -f infra/compose.production.yml images --format json
```

Скачать CI artifact `spacey-release-manifest-${RELEASE_SHA}`. Для каждого app image перенести `digest` в соответствующую переменную slot env. После `compose pull` выполнить единый fail-closed verifier: он проверяет attestation самого manifest, точный набор семи images, repository/SHA/digest bindings, provenance, SPDX и OCI revision label каждого уже загруженного digest:

```bash
infra/verify-release-manifest.sh \
  /path/to/spacey-release-manifest.json \
  "$RELEASE_SHA" \
  "<owner>/<repo>"
```

Несовпадение хотя бы одного digest, attestation или label блокирует rollout. Floating tag и digest, отсутствующий в manifest, запрещены.

## 5. DB access bootstrap и expand migration

Для единственного Docker PostgreSQL контейнера сначала идемпотентно создаются/ротируются
credential logins и назначается ровно одна NOLOGIN group role на сервис. Пароли читаются только
из root-owned файлов `${SPACEY_CONFIG_DIR}/postgres/*-password`; база не публикует host port.

```bash
docker compose --env-file /etc/spacey/data.env \
  -f infra/compose.production-data.yml \
  --profile bootstrap run --rm access-bootstrap
```

После bootstrap migration запускается один раз из exact-SHA API image, отдельной migrator role
и внутреннего адреса `postgres:5432` изолированного data-plane.

```bash
docker compose --env-file /etc/spacey/green.env \
  -f infra/compose.production.yml \
  --profile migration run --rm migrator

docker compose --env-file /etc/spacey/green.env \
  -f infra/compose.production.yml \
  --profile migration run --rm grants
```

`grants` обязателен после каждой migration: он синхронизирует least-privilege grants и `EXECUTE`
для consent-filtered SECURITY DEFINER функций. `access-bootstrap` заменяет ручное создание ролей,
но его можно запускать только через bootstrap profile с PostgreSQL superuser secret; runtime
credential к этому профилю доступа не имеет.

В этом deploy разрешены только backward-compatible expand changes: новые таблицы/колонки/indexes и dual-read/write preparation. Drop/rename/not-null without backfill выполняются отдельным contract release после полного перехода.

Migration failure останавливает rollout. Автоматический destructive rollback схемы запрещён.

### 5.1. Backup/restore gate

Перед первым production slot необходимо инициализировать отдельный off-host Restic repository,
создать backup, пройти round-trip SHA-256 verification и восстановить полный snapshot в пустой
staging/rehearsal database:

```bash
infra/postgres/backup-restore.sh validate-example infra/env/postgres-backup.env.example
infra/postgres/backup-restore.sh init /etc/spacey/backup/postgres.env INIT-production-spacey
infra/postgres/backup-restore.sh backup /etc/spacey/backup/postgres.env
infra/postgres/backup-restore.sh health /etc/spacey/backup/postgres.env

# Выполняется только с config/data env отдельного пустого rehearsal data-plane.
infra/postgres/backup-restore.sh restore \
  /etc/spacey-rehearsal/backup/postgres.env \
  <full-64-char-snapshot-id> \
  RESTORE-staging-spacey_rehearsal
```

После restore обязательны migrations/grants, RLS/ledger checks и browser smoke. Отсутствие свежего
`latest-success.json` или непроверенный restore блокируют rollout.

## 6. Старт неактивного slot

```bash
docker compose --env-file /etc/spacey/green.env \
  -f infra/compose.production.yml up -d --wait
```

Проверить slot напрямую по loopback ports:

```bash
curl -fsS http://127.0.0.1:27790/ >/dev/null
curl -fsS http://127.0.0.1:27800/ready
curl -fsS http://127.0.0.1:27801/ready
curl -fsS http://127.0.0.1:27802/internal/admin/v1/ready
curl -fsS http://127.0.0.1:27804/ready
curl -fsS http://127.0.0.1:27805/ready
```

Обязательные pre-switch checks:

- DB schema совместима с release;
- API/worker видят общий Valkey;
- S3 replay storage readiness проходит;
- migration version и release SHA есть в telemetry;
- Telegram test payload проходит только через staging bot; production raw `initData` не записывается в лог;
- admin остаётся недоступен через публичный gateway;
- error rate/outbox age/battle tick lag не выше release thresholds.

## 7. Атомарное переключение gateway

```bash
ln -s /etc/spacey/nginx/slots/green /etc/spacey/nginx/active.next
mv -Tf /etc/spacey/nginx/active.next /etc/spacey/nginx/active
nginx -t
systemctl reload nginx
```

Если `nginx -t` не прошёл, вернуть symlink на blue до reload. После переключения проверить:

```bash
curl -fsS https://spacey.aima.space/ >/dev/null
curl -fsS https://spacey.aima.space/health >/dev/null
```

Дополнительно выполнить реальный Telegram Mini App smoke: login → bootstrap → mission attempt → WS connect/reconnect. Награду проверять по server result/ledger, не через клиентский complete endpoint.

## 8. Drain старого slot

Новый HTTP/WS трафик после переключения идёт в green. Существующие WS остаются в blue до завершения.

1. Не останавливать старый battle-worker сразу.
2. Наблюдать active sessions и checkpoint age.
3. После установленного drain window отправить `SIGTERM` старому worker через Compose stop.
4. Worker прекращает новые подключения, завершает/чекпоинтит сессии и выходит в пределах `stop_grace_period`.
5. Убедиться, что reconnect маршрутизируется к актуальному worker и reward не дублируется.

```bash
docker compose --env-file /etc/spacey/blue.env \
  -f infra/compose.production.yml stop battle-worker

docker compose --env-file /etc/spacey/blue.env \
  -f infra/compose.production.yml down
```

## 9. Rollback

При росте ошибок до завершения drain:

```bash
ln -s /etc/spacey/nginx/slots/blue /etc/spacey/nginx/active.next
mv -Tf /etc/spacey/nginx/active.next /etc/spacey/nginx/active
nginx -t
systemctl reload nginx
```

Rollback возвращает application traffic, но не откатывает schema. Поэтому expand migration обязана быть совместима с обеими версиями. После rollback сохранить incident evidence, остановить green и не переиспользовать его SHA без нового CI proof.

## 10. Завершение

Release считается завершённым только после observation window:

- public/player/admin health и SLO зелёные;
- нет роста auth failures, reconnects, tick lag или double-finalization conflicts;
- outbox lag вернулся к baseline;
- ledger invariant check прошёл;
- image digests, SHA, migration version и время переключения записаны в release report;
- старый slot остановлен, но предыдущий exact-SHA release остаётся доступен для быстрого application rollback.

Один VPS остаётся single point of failure. Этот runbook уменьшает deployment risk, но не создаёт HA.
