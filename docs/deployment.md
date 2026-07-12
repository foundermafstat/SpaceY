# SpaceY deployment

Legacy web-only PM2 deployment отключён. `deploy.sh` обязан завершаться fail-closed и не может
публиковать server-authoritative release, выполнять migration или перезапускать production.

Канонический workflow описан в
`SPACEY_EXACT_SHA_BLUE_GREEN_DEPLOY_RUNBOOK_2026-07-11_RU.md`: подписанный release manifest,
семь exact-digest images, отдельная migrator role, health-gated blue/green switch и worker drain.
До успешного isolated-staging rehearsal и readiness review production остаётся без изменений.
