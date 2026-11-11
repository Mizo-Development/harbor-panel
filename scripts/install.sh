#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
domain=''
email=''
wings_domain=''
with_wings=false
dry_run=false
while (($#)); do
 case "$1" in
  --domain) domain="${2:?Panel domain required}"; shift 2 ;;
  --email) email="${2:?Email required}"; shift 2 ;;
  --with-wings) with_wings=true; shift ;;
  --wings-domain) wings_domain="${2:?Wings domain required}"; shift 2 ;;
  --dry-run) dry_run=true; shift ;;
  --help) printf '%s\n' 'Usage: sudo bash scripts/install.sh --domain panel.example.com --email ops@example.com [--with-wings --wings-domain node.example.com] [--dry-run]'; exit 0 ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 1 ;;
 esac
done
[[ "$domain" =~ ^([a-zA-Z0-9][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$ ]] || { printf '%s\n' 'Supply a valid panel domain.' >&2; exit 1; }
[[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { printf '%s\n' 'Supply a valid administrator email.' >&2; exit 1; }
if "$with_wings"; then
 [[ "$wings_domain" =~ ^([a-zA-Z0-9][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$ && "$wings_domain" != "$domain" ]] || { printf '%s\n' 'Supply a separate Wings hostname.' >&2; exit 1; }
fi
if "$dry_run"; then printf 'Would prepare Ubuntu 24.04, install Docker Compose, create persistent secrets, migrate, build Harbor, and configure HTTPS for %s. Wings: %s.\n' "$domain" "$with_wings"; exit 0; fi
[[ $EUID -eq 0 ]] || { printf '%s\n' 'Run as root.' >&2; exit 1; }
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { printf '%s\n' 'The installer supports Ubuntu 24.04 only.' >&2; exit 1; }
apt-get update
apt-get install -y ca-certificates curl openssl
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
 install -m 0755 -d /etc/apt/keyrings
 curl --fail --location --proto '=https' https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
 chmod a+r /etc/apt/keyrings/docker.asc
 printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.list
 apt-get update
 apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
if [[ ! -f .env ]]; then
 umask 077
 cat > .env <<ENV
DOMAIN=$domain
ACME_EMAIL=$email
APP_URL=https://$domain
POSTGRES_PASSWORD=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
SETUP_TOKEN=$(openssl rand -hex 32)
SMTP_URL=
SMTP_FROM=Harbor <$email>
ENV
else
 for required in POSTGRES_PASSWORD ENCRYPTION_KEY SETUP_TOKEN; do
  if [[ -z "$(sed -n "s/^${required}=//p" .env | head -1)" ]]; then printf 'Existing .env is missing %s. Configure it before installation; secrets will not be overwritten.\n' "$required" >&2; exit 1; fi
 done
 if ! installed_domain=$(sed -n 's/^DOMAIN=//p' .env); then exit 1; fi
 [[ "$installed_domain" == "$domain" ]] || { printf '%s\n' 'Existing .env DOMAIN differs from --domain. Update configuration explicitly before rerunning.' >&2; exit 1; }
fi
chmod 0600 .env
install -d -m 0755 infra/caddy.d
if "$with_wings"; then
 printf '%s {\n  reverse_proxy 127.0.0.1:8080\n}\n' "$wings_domain" > infra/caddy.d/wings.caddy
 bash scripts/install-wings.sh
fi
docker compose config --quiet
docker compose build --pull
docker compose up -d --wait --wait-timeout 240
printf '\nHarbor is ready at https://%s/setup\n' "$domain"
printf '%s\n' 'Read SETUP_TOKEN from .env to complete setup. Keep .env and database backups private.'
if "$with_wings"; then printf 'In Infrastructure, add Wings at https://%s with reverse-proxy mode and listen port 8080. Copy its configuration to /etc/pterodactyl/config.yml, then start Wings.\n' "$wings_domain"; fi
