# SpaceY staging load/chaos gate

Этот каталог содержит source-level k6 harness для acceptance-профиля: 10 000 одновременных WebSocket-подключений, то есть 5 000 двухсторонних PvP-дуэлей. CI проверяет только синтаксис, guardrails и protobuf fixtures. Нагрузка в CI и production не запускается.

## Обязательный staging broker

Harness не содержит auth bypass и не создаёт игровые записи напрямую. В отдельном, недоступном из production staging-контуре нужен broker под mTLS/network allowlist и короткоживущим bearer secret. Broker обязан использовать обычные Telegram test accounts, player API, matchmaking и participant connection routes.

`POST /v1/load/pvp/participants:lease` принимает `runId`, `environment`, `brokerMode`, `vu`, `iteration`, `protocolVersion`. Режим `matchmaking` создаёт два реальных matchmaking ticket и ждёт match; `preissued` заранее резервирует пару staging accounts, но одноразовый 30-секундный WS ticket получает непосредственно перед ответом. Ответ для одного VU:

```json
{
  "environment": "staging",
  "runId": "load-20260711-01",
  "brokerMode": "matchmaking",
  "participantCount": 2,
  "pairReady": true,
  "leaseId": "opaque",
  "duelId": "uuid",
  "participantId": "uuid",
  "side": 0,
  "websocketUrl": "wss://battle.staging.example/battle?route=uuid",
  "ticket": "opaque_single_use_ticket",
  "ticketExpiresAt": "2026-07-11T12:00:30Z",
  "apiIssueDurationMs": 81
}
```

`POST /v1/load/pvp/participants/{leaseId}:reconnect` возвращает тот же контракт с новым ticket для того же duel/participant/side. `GET /v1/load/pvp/duels/{duelId}/result?participantId=...` возвращает `state`, `finalizationDurationMs`, `resultCount`, `participantsFinalized`, `duplicateRewardCount`. Broker не может подменять эти значения: он читает authoritative result/ledger через first-party API/readonly staging observer.

## Запуск

Сначала выполняется малый `smoke`, затем отдельным одобренным окном — `acceptance`. Все target, origin и broker hosts должны быть перечислены точно; wildcard запрещён. Production host обязательно включается в denylist. Секрет задаётся только через окружение/secret manager и не сохраняется в shell history или отчёте.

```bash
export SPACEY_LOAD_CONFIRM=STAGING_ONLY_I_ACCEPT_COST
export SPACEY_LOAD_ENVIRONMENT=staging
export SPACEY_LOAD_PROFILE=acceptance
export SPACEY_LOAD_CONNECTIONS=10000
export SPACEY_LOAD_RUN_ID=load-20260711-01
export SPACEY_LOAD_BROKER_MODE=matchmaking
export SPACEY_LOAD_BROKER_URL=https://load-broker.staging.example
export SPACEY_LOAD_ORIGIN=https://game.staging.example
export SPACEY_LOAD_ALLOWED_HOSTS=load-broker.staging.example,game.staging.example,battle.staging.example
export SPACEY_LOAD_DENY_HOSTS=spacey.aima.space
export SPACEY_LOAD_CHAOS=mixed
# SPACEY_LOAD_BROKER_TOKEN передать из staging secret manager.
k6 run --summary-export=artifacts/k6-summary.json load/k6/spacey-pvp-acceptance.mjs
```

Default ramp: 10 минут до 10k, 15 минут plateau, 5 минут ramp-down. Каждый клиент генерирует input loop 30 Hz; mixed profile распределяет deliberate reconnect, duplicate, application-level reorder и dropped commands. Реальную network reorder/packet loss дополнительно создаёт staging proxy/`tc netem`: k6 моделирует их только на уровне команд.

Порог: API ticket issuance p95 <250 ms, WS open p95 <2 s, snapshot inter-arrival p95 <250 ms, reward finalization p95 <1 s, exactly-once result/reward. Snapshot inter-arrival — клиентская proxy-метрика доставки 10 Hz, не server processing latency.

## Внешние метрики и вердикт

Во время plateau Prometheus/OTel должен доказать одновременно `peakWsConnections >= 10000`, `peakActivePvpDuels >= 5000`, `maxCpuUtilizationRatio <= 0.75`, `maxMemoryUtilizationRatio <= 0.75` для всех задействованных API/worker/Valkey узлов. Экспортировать JSON с `environment`, `runId`, четырьмя полями выше, `windowStartedAt`, `windowEndedAt`, `sourceQueries` (минимум CPU и memory) и проверить:

```bash
node scripts/verify-load-headroom.mjs artifacts/external-metrics.json
```

Gate проходит только при зелёных k6 thresholds, внешнем evidence, отсутствии double-finalization/ledger violations и сохранённых trace/dashboard ссылках. Наличие этих файлов не доказывает readiness: реальный 10k WS / 5k PvP gate остаётся **не пройденным** до контролируемого staging run.
