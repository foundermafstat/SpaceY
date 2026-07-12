#!/usr/bin/env bash
set -Eeuo pipefail

host=${SPACEY_DEV_HOST:-root@86.48.18.202}
remote=/opt/spacey-dev/workspace
ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes)

command -v rsync >/dev/null
git diff --check

ssh "${ssh_opts[@]}" "$host" 'install -d -m 0700 /etc/spacey-dev; install -d -m 0755 /opt/spacey-dev/workspace'
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude '.next' --exclude '*/dist' \
  -e "ssh ${ssh_opts[*]}" ./ "$host:$remote/"

ssh "${ssh_opts[@]}" "$host" "REMOTE='$remote' bash -s" <<'REMOTE_SCRIPT'
set -Eeuo pipefail
secret=/etc/spacey-dev/compose.env
if [[ ! -f $secret ]]; then
  umask 077
  pg=$(openssl rand -hex 32)
  minio_user="spaceydev$(openssl rand -hex 6)"
  minio_password=$(openssl rand -base64 48 | tr -d '\n')
  printf 'LOCAL_POSTGRES_PASSWORD=%s\nLOCAL_MINIO_ROOT_USER=%s\nLOCAL_MINIO_ROOT_PASSWORD=%s\nLOCAL_S3_BUCKET=spacey-dev-replays\nSPACEY_DEV_IMAGE_PREFIX=ghcr.io/foundermafstat/spacey\nSPACEY_DEV_IMAGE_TAG=ba874cd965758f03676941be7a552321ff0c04f8\n' \
    "$pg" "$minio_user" "$minio_password" >"$secret"
fi
chown root:root "$secret"; chmod 0600 "$secret"

token_file=/etc/spacey-dev/secrets/telegram-bot-token
if [[ -s $token_file ]] && ! grep -q '^TELEGRAM_BOT_TOKEN=' "$secret"; then
  token=$(tr -d '\r\n' <"$token_file")
  webhook_secret=$(openssl rand -hex 32)
  printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_WEBHOOK_SECRET=%s\n' "$token" "$webhook_secret" >>"$secret"
  unset token webhook_secret
fi

if ! swapon --show --noheadings | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >>/etc/fstab
fi

cd "$REMOTE"
grep -q '^SPACEY_DEV_IMAGE_PREFIX=' "$secret" || printf 'SPACEY_DEV_IMAGE_PREFIX=ghcr.io/foundermafstat/spacey\nSPACEY_DEV_IMAGE_TAG=ba874cd965758f03676941be7a552321ff0c04f8\n' >>"$secret"
compose=(docker compose --env-file "$secret" -f infra/compose.local.yml -f infra/compose.remote-dev.override.yml)
# Remote development intentionally starts the smallest playable contour. The
# reserved admin/bot/jobs hosts stay closed until their external credentials
# and optimized images are available.
"${compose[@]}" pull game-web api battle-worker
"${compose[@]}" up -d --wait game-web api battle-worker
"${compose[@]}" exec -T -e SPACEY_SEED_ENV=local api pnpm --filter @spacey/db db:seed
REMOTE_SCRIPT

printf 'REMOTE_DEV_READY https://dev.spacey.aima.space\n'
