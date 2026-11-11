#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --profile tools run --rm frontend-builder
docker compose restart api worker web
printf '%s\n' 'Extensions rebuilt and services restarted. Check logs and provider health.'
