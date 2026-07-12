#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${SPACEY_LOCAL_ENV_FILE:-${repo_root}/.spacey/local-compose.env}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for pnpm dev:stack. Install Docker Desktop, then run this command again." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  if [[ "$(uname -s)" == "Darwin" ]] && { [[ -d "/Applications/Docker.app" ]] || [[ -d "${HOME}/Applications/Docker.app" ]]; }; then
    echo "Docker Desktop is not running. Starting it now…"
    open -ga Docker
    for _ in {1..30}; do
      if docker info >/dev/null 2>&1; then
        echo "Docker Desktop is ready."
        break
      fi
      sleep 2
    done
  fi
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable. Start Docker Desktop and wait until it reports that the engine is running." >&2
  exit 1
fi

mkdir -p "$(dirname "${env_file}")"
chmod 700 "$(dirname "${env_file}")"
node "${repo_root}/infra/create-local-env.mjs" "${env_file}"
chmod 600 "${env_file}"
compose=(docker compose --env-file "${env_file}" -f "${repo_root}/infra/compose.local.yml")

"${compose[@]}" up -d --build --wait api battle-worker
"${compose[@]}" exec -T -e SPACEY_SEED_ENV=local api pnpm --filter @spacey/db db:seed

export NEXT_PUBLIC_API_URL="http://localhost:7800"
export NEXT_PUBLIC_ALLOW_BROWSER_AUTH="true"
cd "${repo_root}"
exec pnpm dev
