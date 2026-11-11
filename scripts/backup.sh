#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
destination="$(pwd)/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$destination"
docker compose exec -T postgres pg_dump -U harbor -Fc harbor > "$destination/database.dump"
docker compose exec -T -u root api tar -czf - -C /data extensions frontend tickets branding > "$destination/extensions-frontend.tgz"
install -m 0600 .env "$destination/environment"
cp compose.yaml "$destination/compose.yaml"
printf '%s\n' "$(date -u +%FT%TZ)" > "$destination/COMPLETE"
printf 'Backup complete: %s\n' "$destination"
