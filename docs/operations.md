# Operations

Run the following commands from the source checkout containing the deployment's `.env` and `compose.yaml`.

## Health and logs

```bash
docker compose ps
docker compose logs --tail=100 api worker web caddy
curl --fail https://panel.example.com/api/v1/health
```

The API and frontend alone are not sufficient: Redis and the worker must run for provisioning, automation and invoice-email delivery. Inspect Admin → System and service operation history as well as container status. A successful HTTP health request does not prove a provider workload or payment gateway is functioning.

## Backup

```bash
sudo bash scripts/backup.sh
```

A completed backup directory includes a PostgreSQL custom-format dump, extension/frontend/attachment/branding archive, private environment file, Compose file and completion marker. Copy completed backups off the panel host and protect access: `.env` contains the encryption key and provider/database access configuration. Restore-test a backup in isolation before relying on it.

The helper does not back up remote Wings worlds, Proxmox guest disks, Plesk data or native-agent sites. Back up those with their provider's tools. Uploaded files should not be changing during a consistency-sensitive backup; schedule an appropriate maintenance window.

## Upgrade

1. Review the release notes and current feature limitations.
2. Take a completed panel backup and provider backups; preserve the previous source commit/release.
3. Pause new orders/management as appropriate for the change.
4. Fetch the intended release into this checkout. Do not replace `.env` or runtime volumes.
5. Build and restart with the migration dependency enabled:

```bash
git fetch --tags origin
git pull --ff-only
docker compose build --pull
docker compose up -d --wait --wait-timeout 240
```

6. Check migration/application logs, worker heartbeat, authentication, an existing invoice, and provider connectivity before reopening orders.

The `migrate` service must complete successfully before the API/worker/web start. If it fails, inspect the error and backup; do not reset the database to force startup. Image changes and schema changes have different rollback requirements. A database restore may be needed when an older release cannot use a newer schema.

For custom frontend extensions, use:

```bash
bash scripts/rebuild-extensions.sh
```

The frontend builder stages a release and preserves the active release if compilation fails. A schema-incompatible application update cannot be rolled back merely by switching the frontend pointer.

## Restore

Restore replaces panel records and file volumes. Stop public access and queued work first, use your own trusted complete backup, and review the target host and backup path.

```bash
sudo bash scripts/restore.sh /absolute/path/to/complete/backup --yes
```

The helper stops the public/application services, restores the saved environment/database/file archive, and starts services again. It is intended for a compatible checkout and image. It does not undo operations already performed on external providers. Reconcile guest/server/payment state before accepting new orders. Never restore an older panel snapshot while blindly continuing queued provider operations.

## Credentials and access

- Preserve the installation encryption key. Replacing it makes saved provider/SMTP secrets unreadable.
- Rotate compromised provider/gateway credentials in their own service and update Harbor.
- Revoke compromised API keys from the owning dashboard or administrator key review.
- Scope admin API keys narrowly and protect them as administrative credentials.
- Use HTTPS. Configure the reverse proxy's trusted forwarding behavior explicitly; never disable TLS verification to make a provider check pass.
- Keep PostgreSQL/Redis private. For customized networks, set firewall and Docker access rules appropriate to the host.

## Logs and mail

HTTP metadata excludes request bodies, headers and query strings. Current retention is 30 days for HTTP metadata and 90 days for mail logs. Invoice-email delivery records SMTP acceptance separately from final inbox delivery. An uncertain send outcome needs review before retrying to avoid duplicate mail.

## Resource planning

Watch disk usage in Docker volumes, retained backups, build directories and temporary uploads. Uploads spool privately and are removed after completion/failure; files left by an interrupted host/process may need reviewed cleanup. Game and VPS capacity is independent of the panel's own resource allocation.
