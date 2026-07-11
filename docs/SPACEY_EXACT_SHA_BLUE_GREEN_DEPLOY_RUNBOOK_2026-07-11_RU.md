# SpaceY: exact-SHA blue/green production runbook

Дата: 2026-07-11  
Статус: deployment scaffold; до staging rehearsal не является доказательством production readiness

## 1. Предусловия

- Опубликованный ранее Neon credential ротирован; старое значение отозвано.
- Созданы отдельные migrator, runtime, battle-worker, telegram-bot, admin, jobs и readonly DB roles через `packages/db/sql/roles.bootstrap.template.sql`; каждой credential-bearing login role выдана только одна group role.
- Для каждой credential-bearing Neon login role явно заданы и проверены соответствующие `statement_timeout`, `idle_in_transaction_session_timeout`, а для readonly также `default_transaction_read_only=on`: настройки NOLOGIN group role сами по себе не применяются при login.
- Production использует внешний Neon: pooled URL в runtime env, direct URL только в migrator env.
- `/etc/spacey/*.env` принадлежат root и имеют mode `0600`.
- App images собраны одним CI run, прошли gates и опубликованы с tag, равным полному 40-символьному Git SHA.
- OCI label `org.opencontainers.image.revision` каждого app image равен тому же SHA.
- В GitHub repository variables заданы `NEXT_PUBLIC_API_URL=https://...` и `NEXT_PUBLIC_BATTLE_WS_URL=wss://...`; без них release workflow завершается ошибкой до сборки.
- В env каждого backend-процесса заданы `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN`, `OTEL_SERVICE_NAME`, `SPACEY_RELEASE_SHA` и `OBSERVABILITY_REQUIRED=true`.
- `spacey-data` network и общий Valkey запущены отдельно от blue/green slots.
- Nginx `active` — атомарно заменяемая symlink на один из каталогов `slots/blue` или `slots/green`.

Production PostgreSQL намеренно не запускается в Compose: source of truth — отдельный Neon production project. `infra/compose.local.yml` поднимает локальный PostgreSQL только для development/CI.

`.github/workflows/release-images.yml` запускается только после успешного `platform-ci` для push в `main`. Он публикует семь service images в `ghcr.io/<owner>/<repo>/<service>:<full-sha>`, добавляет registry SBOM/provenance attestations и сохраняет `spacey-release-manifest-<sha>` с digest каждого image. Workflow отказывается перезаписывать уже существующий full-SHA tag. После частично неуспешной публикации recovery выполняется новым commit/SHA, а не перемещением старого tag.

Текущий общий Dockerfile сохраняет весь установленный monorepo и dev dependencies в runtime stage. Это известный остаточный image-bloat риск, а не нарушение изоляции runtime: Compose запускает непривилегированного пользователя, read-only rootfs, drop-all capabilities и exact service filter. Переход на проверенный per-service prune/standalone layout выполняется отдельным hardening change после runtime regression tests.

## 2. Первичная подготовка host

```bash
install -d -m 0700 /etc/spacey /etc/spacey/valkey
install -d -m 0755 /etc/spacey/nginx/slots/blue /etc/spacey/nginx/slots/green
install -d -m 0755 /opt/spacey

docker network create spacey-data
docker compose --env-file /etc/spacey/data.env \
  -f infra/compose.production-data.yml up -d
```

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

## 4. Pull и supply-chain проверка

Пример для green slot:

```bash
docker compose --env-file /etc/spacey/green.env \
  -f infra/compose.production.yml pull

docker compose --env-file /etc/spacey/green.env \
  -f infra/compose.production.yml images --format json
```

Скачать CI artifact `spacey-release-manifest-${RELEASE_SHA}`. Для каждого app image перенести `digest` в соответствующую переменную slot env, затем использовать поле `reference` (`name@sha256:...`) для проверки GitHub attestation, registry SBOM/provenance и label:

```bash
gh attestation verify "oci://<image>@<digest>" --repo "<owner>/<repo>"
gh attestation verify "oci://<image>@<digest>" --repo "<owner>/<repo>" \
  --predicate-type https://spdx.dev/Document/v2.3

docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "<image>@<digest>"
```

Несовпадение хотя бы одного digest, attestation или label блокирует rollout. Floating tag и digest, отсутствующий в manifest, запрещены.

## 5. Expand migration

Migration запускается один раз из exact-SHA API image, отдельной migrator role и direct Neon endpoint.

```bash
docker compose --env-file /etc/spacey/green.env \
  -f infra/compose.production.yml \
  --profile migration run --rm migrator

docker compose --env-file /etc/spacey/green.env \
  -f infra/compose.production.yml \
  --profile migration run --rm grants
```

`grants` обязателен после каждой migration: он синхронизирует least-privilege grants и `EXECUTE` для consent-filtered SECURITY DEFINER функций. При создании нового Neon project сначала один раз применить `roles.bootstrap.template.sql` от имени project owner; его нельзя запускать runtime credential.

В этом deploy разрешены только backward-compatible expand changes: новые таблицы/колонки/indexes и dual-read/write preparation. Drop/rename/not-null without backfill выполняются отдельным contract release после полного перехода.

Migration failure останавливает rollout. Автоматический destructive rollback схемы запрещён.

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
