# SpaceY production deployment

> Этот документ описывает legacy web-only PM2 deployment. После появления backend-сервисов канонический production workflow — exact-SHA blue/green runbook: `SPACEY_EXACT_SHA_BLUE_GREEN_DEPLOY_RUNBOOK_2026-07-11_RU.md`. Legacy flow нельзя использовать для миграций, battle-worker или server-authoritative release.

## Production topology

- Repository: `git@github.com:foundermafstat/SpaceY.git`
- Server: `86.48.18.202`
- Project directory: `/var/www/js/spacey`
- PM2 app: `spacey-web`
- Local application endpoint: `http://127.0.0.1:7790`
- Public URL: `https://spacey.aima.space`
- Nginx template: `server/spacey.aima.space`

## First server installation

Create a dedicated read-only GitHub deploy key on the server at
`/root/.ssh/spacey_github_ed25519`. Keep the private key only on the server and
add only `/root/.ssh/spacey_github_ed25519.pub` to the repository Deploy keys.

After the deploy key has been added to GitHub:

```bash
mkdir -p /var/www/js
GIT_SSH_COMMAND="ssh -i /root/.ssh/spacey_github_ed25519 -o IdentitiesOnly=yes" \
  git clone git@github.com:foundermafstat/SpaceY.git /var/www/js/spacey
cd /var/www/js/spacey
git config core.sshCommand \
  "ssh -i /root/.ssh/spacey_github_ed25519 -o IdentitiesOnly=yes"
cp .env.production.example .env.production
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
```

Install the Nginx site and issue the certificate:

```bash
cp server/spacey.aima.space /etc/nginx/sites-available/spacey.aima.space
ln -s /etc/nginx/sites-available/spacey.aima.space /etc/nginx/sites-enabled/spacey.aima.space
nginx -t
systemctl reload nginx
certbot --nginx -d spacey.aima.space
```

## Subsequent deploys

```bash
cd /var/www/js/spacey
./deploy.sh
```

The deploy script refuses to overwrite uncommitted server changes, pulls
`origin/main` with fast-forward only, installs the locked pnpm dependencies,
typechecks, builds, reloads PM2, and checks `/ui-kit` locally.

## Verification

```bash
pm2 status spacey-web
curl -fsS http://127.0.0.1:7790/ui-kit >/dev/null
curl -fsS https://spacey.aima.space/ui-kit >/dev/null
```

Open `https://spacey.aima.space/` in a browser as the final WebGL and asset smoke test.
