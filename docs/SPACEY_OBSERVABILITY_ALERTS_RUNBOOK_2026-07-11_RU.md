# SpaceY: alert policy, dashboard и runbook

Статус: source-level baseline для staging. Это provider-neutral definitions, а не доказательство,
что alerts уже импортированы во внешний observability backend.

## 1. Source of truth

- `infra/observability/metric-catalog.v1.json` — полный каталог custom-инструментов,
  существующих в `packages/observability/src/metrics.ts`.
- `infra/observability/alerts.v1.json` — численные thresholds, окна и длительности.
- `infra/observability/dashboard.v1.json` — панели без vendor-specific query language.
- `infra/observability/validate-observability.mjs` — статическая проверка соответствия коду.

Проверка не требует установки зависимостей:

```bash
node infra/observability/validate-observability.mjs
```

OTLP остаётся внешним: Node SDK экспортирует метрики каждые 15 секунд. Adapter конкретного
backend обязан сохранять фильтры `deployment.environment.name` и `service.version`, суммировать
worker instances и переводить операции definitions следующим образом:

| Операция | Семантика |
| --- | --- |
| `current_sum` | текущее суммарное значение non-monotonic UpDownCounter по instances |
| `counter_rate` | per-second rate монотонного Counter за `windowSeconds` |
| `counter_ratio` | increase первого Counter / increase второго, с minimum denominator |
| `histogram_quantile` | quantile из histogram buckets за заданное окно |
| `gauge_max` | максимум ObservableGauge по instances и окну |

Нельзя вычислять rate из UpDownCounter или p95 из Counter. Validator блокирует такие ошибки,
неизвестные metric names, неверные attributes и незадокументированные runbook anchors.

## 2. Покрытие SLO

Существующий `spacey.battle.finalization.duration` прямо покрывает initial reward-finalization
p95 ≤ 1000 ms: warning начинается с 800 ms, critical — с 1000 ms. Tick-lag thresholds 100/250 ms
— operational budget, а не подмена отсутствующей snapshot-delivery метрики. Checkpoint target —
2 секунды; 10/30 секунд оставляют запас на один transient exporter interval, но сигнализируют о
потере recovery freshness.

Остальные численные policies:

- input rejection ratio: warning 2%, critical 5%, только при ≥100 commands за 5 минут;
- stale snapshot drops under WS backpressure: warning 1/s, critical 10/s за 5 минут;
- finalization retries: warning 2/min, critical 10/min;
- ledger conflicts: warning 1/min, critical 5/min;
- claimed outbox event p95 age: warning 5 минут, critical 30 минут;
- replay pending: warning, если current pending count >0 непрерывно 30 минут.

Перед staging gate нужно импортировать JSON через provider adapter, выполнить synthetic metric
test и сохранить screenshot/export rules с совпадающим `policyVersion`.

## 3. Incident runbooks

<a id="battle-tick-lag"></a>
### Battle tick lag

1. Фильтровать по environment, release SHA и worker instance; сравнить active sessions/duels.
2. Проверить CPU throttling, event-loop stalls и рост checkpoint/finalization queues.
3. Остановить новый matchmaking при critical; текущие sessions не убивать без recovery proof.
4. При связи с новым SHA откатить exact manifest и проверить state/replay hashes.

<a id="checkpoint-age"></a>
### Checkpoint age

1. Проверить Valkey readiness/latency и разницу по `mode`.
2. Сопоставить tick lag и finalization retries; не считать отсутствие observation нулевым age.
3. При critical остановить новые attempts на affected workers и проверить recovery на canary session.

<a id="input-rejections"></a>
### Input rejections

1. Разбить signal по `mode` и `reason`; подтвердить minimum denominator.
2. Для `rate_limited` проверить client reconnect storm и heartbeat; для `buffer_full` — worker lag.
3. Не повышать rate limit до проверки abusive client/version и server capacity.

<a id="snapshot-backpressure"></a>
### Snapshot backpressure

1. Проверить число active connections, client regions и worker egress; stale snapshots можно заменять, reliable events — нельзя.
2. Сопоставить drop rate с tick lag: без tick lag источник обычно медленный consumer или сеть, с tick lag — worker capacity.
3. При critical ограничить новые подключения к affected worker и проверить slow-consumer disconnects; не увеличивать queue без memory load proof.

<a id="battle-finalization"></a>
### Battle finalization

1. Разбить retries по `stage`; проверить DB, replay object store и cleanup отдельно.
2. Подтвердить, что reward ledger имеет один idempotency key и не повторять транзакцию вручную.
3. При DB-stage critical остановить создание новых battles; replay-stage не должен блокировать reward.
4. После восстановления проверить result count, ledger uniqueness и pending replay convergence.

<a id="replay-pending"></a>
### Replay pending

1. Проверить object-store/KMS credentials, latency и retry worker.
2. Сверить current count до/после canary retry; не трактовать count как возраст конкретного replay.
3. Нельзя вручную уменьшать metric: состояние снимается только idempotent attach/resolution flow.

<a id="ledger-conflicts"></a>
### Ledger conflicts

1. Разбить по SQL `code`; `40001`/`40P01` требуют проверки contention и bounded retry.
2. Проверить unique ledger key и число battle results до любых ручных действий.
3. При устойчивом critical остановить reward-producing attempts, сохранить correlation IDs и
   выполнить reconciliation read-only запросом.

<a id="outbox-claim-age"></a>
### Outbox claim age

1. Проверить jobs readiness и фактическое появление новых observations.
2. Age измеряется только когда событие claimed; отсутствие samples не означает пустую очередь.
3. Для полностью остановленного consumer выполнить backlog query из `apps/jobs/README.md`.
4. Не помечать событие published вручную; восстанавливать idempotent dispatcher/DLQ flow.

## 4. Осознанно непокрытые сигналы

В текущем коде нет стабильных custom instruments для API p95, WS connect p95, snapshot delivery
p95, availability/readiness, error rate, DB pool saturation, Valkey memory, webhook failures,
host/container reserve и retention lag. Auto-instrumented HTTP names зависят от collector/backend,
поэтому в этот provider-neutral catalog они намеренно не добавлены до фиксации views/contract.

Также отсутствуют:

- **oldest pending outbox gauge** — histogram показывает возраст только уже claimed events и не
  обнаружит полностью остановленный consumer без SQL backlog check;
- **oldest/orphan replay age** — `spacey.battle.replay.pending` показывает current count, но не
  возраст или orphan identity;
- надёжный denominator для reconnect/no-show ratio — пока они остаются dashboard-only rates.

Эти gaps блокируют полный Stage 7 readiness verdict, но не должны закрываться выдуманными metric
names в alert policy.
