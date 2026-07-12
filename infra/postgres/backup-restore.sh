#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat >&2 <<'USAGE'
Usage:
  backup-restore.sh validate-example <config>
  backup-restore.sh init <config> <INIT-environment-database>
  backup-restore.sh backup <config>
  backup-restore.sh restore <config> <64-char-snapshot-id> <RESTORE-environment-database>
  backup-restore.sh health <config>
USAGE
  exit 64
}

die() { echo "PostgreSQL backup: $*" >&2; exit 1; }
required_command() { command -v "$1" >/dev/null || die "$1 is required"; }

mode=${1:-}
config=${2:-}
[[ -n "$mode" && -n "$config" ]] || usage

allowed_keys=' SPACEY_ENVIRONMENT SPACEY_REPOSITORY_ROOT SPACEY_DATA_COMPOSE_FILE SPACEY_DATA_ENV_FILE RESTIC_IMAGE RESTIC_REPOSITORY RESTIC_PASSWORD_FILE RESTIC_S3_ENV_FILE RESTIC_CACHE_DIR BACKUP_EVIDENCE_DIR BACKUP_ARCHIVE_NAME BACKUP_CHECK_SUBSET BACKUP_KEEP_WITHIN_DAILY BACKUP_KEEP_WITHIN_WEEKLY BACKUP_KEEP_WITHIN_MONTHLY BACKUP_KEEP_WITHIN_YEARLY BACKUP_MAX_AGE_HOURS '
while IFS= read -r raw || [[ -n "$raw" ]]; do
  line=${raw%$'\r'}
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=([^[:space:]]+)$ ]] || die "invalid config line"
  key=${BASH_REMATCH[1]}; value=${BASH_REMATCH[2]}
  [[ "$allowed_keys" == *" $key "* ]] || die "unknown config key: $key"
  [[ -z ${!key+x} ]] || die "duplicate config key: $key"
  printf -v "$key" '%s' "$value"
done < "$config"

for key in SPACEY_ENVIRONMENT SPACEY_REPOSITORY_ROOT SPACEY_DATA_COMPOSE_FILE SPACEY_DATA_ENV_FILE RESTIC_IMAGE RESTIC_REPOSITORY RESTIC_PASSWORD_FILE RESTIC_S3_ENV_FILE RESTIC_CACHE_DIR BACKUP_EVIDENCE_DIR BACKUP_ARCHIVE_NAME BACKUP_CHECK_SUBSET BACKUP_KEEP_WITHIN_DAILY BACKUP_KEEP_WITHIN_WEEKLY BACKUP_KEEP_WITHIN_MONTHLY BACKUP_KEEP_WITHIN_YEARLY BACKUP_MAX_AGE_HOURS; do
  [[ -n ${!key:-} ]] || die "missing config key: $key"
done
[[ "$SPACEY_ENVIRONMENT" =~ ^(production|staging)$ ]] || die "invalid environment"
[[ "$RESTIC_IMAGE" =~ ^[a-z0-9][a-z0-9._/:_-]*@sha256:[0-9a-f]{64}$ ]] || {
  [[ "$mode" == validate-example && "$RESTIC_IMAGE" == restic/restic@sha256:replace-with-verified-digest ]] || die "RESTIC_IMAGE must be digest-pinned"
}
[[ "$RESTIC_REPOSITORY" =~ ^s3:https://[^/@?#]+/[^/?#]+(/[^/?#]+)*$ ]] || die "RESTIC_REPOSITORY must be a credential-free HTTPS S3 URL"
[[ ! "$RESTIC_REPOSITORY" =~ (localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]) ]] || die "backup target must be off-host"
[[ "$BACKUP_ARCHIVE_NAME" =~ ^[a-z0-9][a-z0-9._-]+$ ]] || die "invalid archive name"
[[ "$BACKUP_CHECK_SUBSET" =~ ^([1-9]|[1-9][0-9]|100)%$ ]] || die "invalid check subset"
for value in "$BACKUP_KEEP_WITHIN_DAILY" "$BACKUP_KEEP_WITHIN_WEEKLY" "$BACKUP_KEEP_WITHIN_MONTHLY" "$BACKUP_KEEP_WITHIN_YEARLY"; do
  [[ "$value" =~ ^[1-9][0-9]*(h|d|m|y)$ ]] || die "invalid retention duration"
done
[[ "$BACKUP_MAX_AGE_HOURS" =~ ^[1-9][0-9]*$ ]] || die "invalid maximum backup age"
for path in "$SPACEY_REPOSITORY_ROOT" "$SPACEY_DATA_COMPOSE_FILE" "$SPACEY_DATA_ENV_FILE" "$RESTIC_PASSWORD_FILE" "$RESTIC_S3_ENV_FILE" "$RESTIC_CACHE_DIR" "$BACKUP_EVIDENCE_DIR"; do
  [[ "$path" == /* ]] || die "all configured paths must be absolute"
done
[[ "$mode" == validate-example ]] && { echo "PostgreSQL backup example is valid."; exit 0; }

[[ $EUID -eq 0 ]] || die "must run as root"
required_command docker; required_command jq; required_command flock; required_command sha256sum; required_command stat
secure_file() {
  local path=$1
  [[ -f "$path" && ! -L "$path" ]] || die "missing regular file: $path"
  [[ $(stat -c '%u:%a' "$path") == 0:600 ]] || die "must be root-owned mode 0600: $path"
}
secure_file "$config"; secure_file "$SPACEY_DATA_ENV_FILE"; secure_file "$RESTIC_PASSWORD_FILE"; secure_file "$RESTIC_S3_ENV_FILE"
[[ $(wc -c < "$RESTIC_PASSWORD_FILE") -ge 32 ]] || die "restic password file is too short"
grep -Eq '^AWS_ACCESS_KEY_ID=[^[:space:]]+$' "$RESTIC_S3_ENV_FILE" || die "S3 access key is missing"
grep -Eq '^AWS_SECRET_ACCESS_KEY=[^[:space:]]+$' "$RESTIC_S3_ENV_FILE" || die "S3 secret key is missing"
grep -Ev '^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AWS_DEFAULT_REGION|AWS_REGION)=[^[:space:]]+$|^#|^$' "$RESTIC_S3_ENV_FILE" | grep -q . && die "unexpected S3 env key"
[[ -d "$SPACEY_REPOSITORY_ROOT" && -f "$SPACEY_DATA_COMPOSE_FILE" ]] || die "repository/Compose path is unavailable"
install -d -o root -g root -m 0700 "$RESTIC_CACHE_DIR" "$BACKUP_EVIDENCE_DIR"
docker image inspect "$RESTIC_IMAGE" >/dev/null || die "digest-pinned restic image must be pulled and verified first"

env_value() {
  local key=$1 file=$2 values
  values=$(sed -n "s/^${key}=//p" "$file")
  [[ $(printf '%s\n' "$values" | sed '/^$/d' | wc -l) -eq 1 ]] || die "missing or duplicate $key in $file"
  printf '%s' "$values"
}
POSTGRES_DATABASE=$(env_value POSTGRES_DATABASE "$SPACEY_DATA_ENV_FILE")
POSTGRES_SUPERUSER=$(env_value POSTGRES_SUPERUSER "$SPACEY_DATA_ENV_FILE")
[[ "$POSTGRES_DATABASE" =~ ^[a-z][a-z0-9_]{0,62}$ && "$POSTGRES_SUPERUSER" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || die "invalid PostgreSQL identifiers"
POSTGRES_BACKUP_USER=spacey_backup_login
RESTIC_HOST="spacey-db-${SPACEY_ENVIRONMENT}"
RESTIC_TAGS="spacey-postgres,environment:${SPACEY_ENVIRONMENT},database:${POSTGRES_DATABASE}"

compose() {
  docker compose --project-directory "$SPACEY_REPOSITORY_ROOT" --env-file "$SPACEY_DATA_ENV_FILE" -f "$SPACEY_DATA_COMPOSE_FILE" "$@"
}
restic() {
  docker run --rm -i --pull=never --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --pids-limit 128 --memory 2g --cpus 2 --hostname "$RESTIC_HOST" \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m \
    --mount "type=bind,src=${RESTIC_CACHE_DIR},dst=/cache" \
    --mount "type=bind,src=${RESTIC_PASSWORD_FILE},dst=/run/secrets/restic-password,readonly" \
    --env-file "$RESTIC_S3_ENV_FILE" -e RESTIC_REPOSITORY="$RESTIC_REPOSITORY" \
    -e RESTIC_PASSWORD_FILE=/run/secrets/restic-password -e RESTIC_CACHE_DIR=/cache -e TMPDIR=/tmp \
    "$RESTIC_IMAGE" --retry-lock 5m "$@"
}

exec 9>/run/lock/spacey-postgres-backup.lock
flock -n 9 || die "another backup/restore operation is running"

if [[ "$mode" == health ]]; then
  evidence="$BACKUP_EVIDENCE_DIR/latest-success.json"
  [[ -f "$evidence" && ! -L "$evidence" ]] || die "successful backup evidence is missing"
  jq -e '.schemaVersion == 1 and .status == "ok" and .archiveVerified == true and .retentionApplied == true and .repositoryChecked == true' "$evidence" >/dev/null || die "backup evidence is invalid"
  completed=$(jq -er '.completedAt' "$evidence")
  age=$(( ($(date -u +%s) - $(date -u -d "$completed" +%s)) / 3600 ))
  (( age >= 0 && age <= BACKUP_MAX_AGE_HOURS )) || die "latest verified backup is stale"
  echo "PostgreSQL backup health OK: ${age}h old."
  exit 0
fi

if [[ "$mode" == init ]]; then
  [[ ${3:-} == "INIT-${SPACEY_ENVIRONMENT}-${POSTGRES_DATABASE}" ]] || die "repository initialization confirmation mismatch"
  restic snapshots --json >/dev/null 2>&1 && die "restic repository is already initialized"
  restic init
  exit 0
fi

restic snapshots --json >/dev/null || die "restic repository is unavailable or not initialized"

if [[ "$mode" == restore ]]; then
  snapshot=${3:-}; confirmation=${4:-}
  [[ "$snapshot" =~ ^[0-9a-f]{64}$ ]] || die "restore requires a full snapshot ID"
  [[ "$confirmation" == "RESTORE-${SPACEY_ENVIRONMENT}-${POSTGRES_DATABASE}" ]] || die "restore confirmation mismatch"
  empty=$(compose exec -T postgres sh -ceu '
    export PGPASSWORD="$(cat /run/secrets/postgres-superuser-password)"
    psql -h 127.0.0.1 -U "$1" -d "$2" -Atqc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"') AND n.nspname !~ '"'"'^pg_toast'"'"' AND c.relkind IN ('"'"'r'"'"','"'"'p'"'"','"'"'v'"'"','"'"'m'"'"','"'"'S'"'"');"
  ' sh "$POSTGRES_SUPERUSER" "$POSTGRES_DATABASE")
  [[ "$empty" == 0 ]] || die "restore target is not empty"
  compose exec -T postgres sh -ceu '
    export PGPASSWORD="$(cat /run/secrets/postgres-superuser-password)"
    psql -h 127.0.0.1 -U "$1" -d "$2" -Atqc "SELECT 1 FROM pg_roles WHERE rolname='"'"'spacey_migrator'"'"'"
  ' sh "$POSTGRES_SUPERUSER" "$POSTGRES_DATABASE" | grep -qx 1 || die "spacey_migrator role is missing"
  stored_path=$(restic snapshots "$snapshot" --json | jq -er 'if length == 1 and (.[0].paths | length) == 1 then .[0].paths[0] else empty end')
  [[ ${stored_path##*/} == "$BACKUP_ARCHIVE_NAME" ]] || die "snapshot archive path mismatch"
  restic dump "$snapshot" "$stored_path" | compose exec -T postgres sh -ceu '
    export PGPASSWORD="$(cat /run/secrets/postgres-superuser-password)"
    pg_restore --host 127.0.0.1 --username "$1" --dbname "$2" --role spacey_migrator --no-owner --no-privileges --single-transaction --exit-on-error -
  ' sh "$POSTGRES_SUPERUSER" "$POSTGRES_DATABASE"
  echo "Restore completed from snapshot $snapshot; run migrations/grants and application smoke tests."
  exit 0
fi

[[ "$mode" == backup ]] || usage
started=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
attempt=$(date -u +'%Y%m%dT%H%M%SZ')-$$
source_archive="/tmp/${attempt}-source.dump"
verify_archive="/tmp/${attempt}-verify.dump"
cleanup() { compose exec -T postgres rm -f "$source_archive" "$verify_archive" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

compose exec -T postgres awk '$2=="/tmp" && $3=="tmpfs" {ok=1} END {exit !ok}' /proc/mounts || die "PostgreSQL /tmp must be tmpfs"
role_check=$(compose exec -T postgres sh -ceu '
  export PGPASSWORD="$(cat /run/secrets/postgres-backup-password)"
  psql -h 127.0.0.1 -U "$1" -d "$2" -AtF "|" -qc "SELECT current_user, current_setting('"'"'default_transaction_read_only'"'"'), rolbypassrls, pg_has_role(current_user,'"'"'pg_read_all_data'"'"','"'"'member'"'"') FROM pg_roles WHERE rolname=current_user"
' sh "$POSTGRES_BACKUP_USER" "$POSTGRES_DATABASE")
[[ "$role_check" == "$POSTGRES_BACKUP_USER|on|t|t" ]] || die "least-privilege backup role is not provisioned correctly"

archive_meta=$(compose exec -T postgres sh -ceu '
  umask 077
  export PGPASSWORD="$(cat /run/secrets/postgres-backup-password)"
  pg_dump --host 127.0.0.1 --username "$1" --dbname "$2" --format custom --compress 6 --no-owner --no-privileges --lock-wait-timeout 30s --file "$3"
  pg_restore --list "$3" >/dev/null
  printf "%s|%s|%s" "$(sha256sum "$3" | awk '"'"'{print $1}'"'"')" "$(stat -c %s "$3")" "$(pg_dump --version)"
' sh "$POSTGRES_BACKUP_USER" "$POSTGRES_DATABASE" "$source_archive")
IFS='|' read -r archive_sha archive_bytes postgres_version <<< "$archive_meta"
[[ "$archive_sha" =~ ^[0-9a-f]{64}$ && "$archive_bytes" =~ ^[1-9][0-9]*$ ]] || die "invalid dump metadata"

backup_json=$(mktemp "$BACKUP_EVIDENCE_DIR/.backup.XXXXXX")
compose exec -T postgres cat "$source_archive" | restic --json backup --stdin --stdin-filename "$BACKUP_ARCHIVE_NAME" --host "$RESTIC_HOST" --tag spacey-postgres --tag "environment:${SPACEY_ENVIRONMENT}" --tag "database:${POSTGRES_DATABASE}" > "$backup_json"
snapshot=$(jq -rsr '[.[] | select(.message_type == "summary") | .snapshot_id] | last // empty' "$backup_json")
[[ "$snapshot" =~ ^[0-9a-f]{64}$ ]] || die "restic did not return a full snapshot ID"
stored_path=$(restic snapshots "$snapshot" --json | jq -er 'if length == 1 and (.[0].paths | length) == 1 then .[0].paths[0] else empty end')
[[ ${stored_path##*/} == "$BACKUP_ARCHIVE_NAME" ]] || die "stored archive path mismatch"

restic dump "$snapshot" "$stored_path" | compose exec -T postgres sh -ceu 'umask 077; cat > "$1"; pg_restore --list "$1" >/dev/null; printf "%s|%s" "$(sha256sum "$1" | awk '"'"'{print $1}'"'"')" "$(stat -c %s "$1")"' sh "$verify_archive" > "${backup_json}.verify"
IFS='|' read -r verify_sha verify_bytes < "${backup_json}.verify"
[[ "$verify_sha" == "$archive_sha" && "$verify_bytes" == "$archive_bytes" ]] || die "off-host round-trip verification failed"

restic forget --host "$RESTIC_HOST" --tag "$RESTIC_TAGS" --group-by host,paths,tags \
  --keep-within-daily "$BACKUP_KEEP_WITHIN_DAILY" --keep-within-weekly "$BACKUP_KEEP_WITHIN_WEEKLY" \
  --keep-within-monthly "$BACKUP_KEEP_WITHIN_MONTHLY" --keep-within-yearly "$BACKUP_KEEP_WITHIN_YEARLY" --prune >/dev/null
restic check --read-data-subset="$BACKUP_CHECK_SUBSET" > "${backup_json}.check"

completed=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
repository_sha=$(printf '%s' "$RESTIC_REPOSITORY" | sha256sum | awk '{print $1}')
evidence_tmp=$(mktemp "$BACKUP_EVIDENCE_DIR/.evidence.XXXXXX")
jq -n --arg startedAt "$started" --arg completedAt "$completed" --arg environment "$SPACEY_ENVIRONMENT" \
  --arg database "$POSTGRES_DATABASE" --arg snapshotId "$snapshot" --arg archiveSha256 "$archive_sha" \
  --argjson archiveBytes "$archive_bytes" --arg postgresVersion "$postgres_version" --arg repositorySha256 "$repository_sha" \
  '{schemaVersion:1,status:"ok",startedAt:$startedAt,completedAt:$completedAt,environment:$environment,database:$database,snapshotId:$snapshotId,archiveSha256:$archiveSha256,archiveBytes:$archiveBytes,postgresVersion:$postgresVersion,repositorySha256:$repositorySha256,archiveVerified:true,retentionApplied:true,repositoryChecked:true}' > "$evidence_tmp"
chmod 0600 "$evidence_tmp"
mv "$evidence_tmp" "$BACKUP_EVIDENCE_DIR/${attempt}-${snapshot}.json"
latest_tmp=$(mktemp "$BACKUP_EVIDENCE_DIR/.latest.XXXXXX")
cp "$BACKUP_EVIDENCE_DIR/${attempt}-${snapshot}.json" "$latest_tmp"
chmod 0600 "$latest_tmp"
mv "$latest_tmp" "$BACKUP_EVIDENCE_DIR/latest-success.json"
rm -f "$backup_json" "${backup_json}.verify" "${backup_json}.check"
echo "PostgreSQL backup verified: snapshot=$snapshot bytes=$archive_bytes"
