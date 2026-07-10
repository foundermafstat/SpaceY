#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BRANCH="${BRANCH:-main}"
ENV_FILE="${ENV_FILE:-.env.production}"
PM2_ECOSYSTEM="${PM2_ECOSYSTEM:-ecosystem.config.js}"

set +u
[ -s "$HOME/.bashrc" ] && source "$HOME/.bashrc"
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"
set -u

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1"
    exit 1
  fi
}

require_cmd git
require_cmd pnpm
require_cmd pm2
require_cmd curl

if [ ! -f "$PM2_ECOSYSTEM" ]; then
  echo "Missing file: $PM2_ECOSYSTEM"
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to deploy with local server changes."
  git status --short
  exit 1
fi

echo "Syncing SpaceY with origin/$BRANCH..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "Installing locked dependencies..."
pnpm install --frozen-lockfile

echo "Running TypeScript validation..."
pnpm run typecheck

echo "Building SpaceY..."
pnpm run build

echo "Starting SpaceY with PM2..."
pm2 startOrReload "$PM2_ECOSYSTEM" --update-env
pm2 save

echo "Checking local SpaceY endpoint..."
for attempt in {1..30}; do
  if curl -fsS "http://127.0.0.1:${PORT:-7790}/ui-kit" >/dev/null 2>&1; then
    echo "SpaceY deployment completed."
    exit 0
  fi

  if [ "$attempt" -eq 30 ]; then
    pm2 logs spacey-web --lines 80 --nostream || true
    exit 1
  fi

  sleep 2
done
