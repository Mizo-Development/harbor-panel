#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup="${1:?Usage: scripts/restore.sh /absolute/backup/path --yes}"
[[ "${2:-}" == --yes ]] || { printf '%s\n' 'Restore replaces the panel database and extension volumes. Rerun with --yes after reviewing your backup.' >&2; exit 1; }
[[ "$backup" == /* && -f "$backup/COMPLETE" && -s "$backup/database.dump" && -s "$backup/environment" ]] || { printf '%s\n' 'Choose an absolute path to a complete trusted backup.' >&2; exit 1; }
# Read and inspect archives only from your own trusted backups.
docker compose stop caddy api worker web
install -m 0600 "$backup/environment" .env
docker compose up -d --wait postgres redis
docker compose exec -T postgres pg_restore -U harbor -d harbor --clean --if-exists --no-owner < "$backup/database.dump"
docker compose run --rm --no-deps -T -u root api tar -xzf - -C /data < "$backup/extensions-frontend.tgz"
docker compose up -d --wait --wait-timeout 240
printf '%s\n' 'Panel backup restored. Verify provider health and reconcile external services before accepting new orders.'
