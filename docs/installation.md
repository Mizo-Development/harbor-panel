# Installation

Harbor's automated panel installer targets a **fresh Ubuntu 24.04** host. The generated Wings node installer separately supports the operating systems listed in [providers](providers.md). Other panel operating systems require a manually managed Docker installation and are not certified by this installer.

## Before installation

- Point `panel.example.com` to your server's public IP. Publish an AAAA record only if IPv6 routes to the server correctly.
- Make inbound TCP 80/443 reachable through both the host firewall and the VPS provider's firewall.
- Use a dedicated machine or VM: the bundled Caddy service binds host ports 80/443. Existing reverse proxies need an explicitly managed deployment instead.
- Start with approximately 2 vCPUs, 4 GB RAM and at least 20 GB free disk, increasing capacity for builds, uploads, retained backups and workload. This is a starting allocation, not a measured service-capacity guarantee.
- The administrator running the installer needs root privileges and outbound access to container/package registries and certificate services.

## Automated installation

```bash
sudo apt-get update
sudo apt-get install -y git
sudo git clone https://github.com/Mizo-Development/harbor-panel.git /opt/harbor
cd /opt/harbor
sudo bash scripts/install.sh --domain panel.example.com --email ops@example.com
```

To inspect the proposed operation before changing the server:

```bash
bash scripts/install.sh --domain panel.example.com --email ops@example.com --dry-run
```

Dry-run describes the plan; it does not certify your DNS, firewall or external services.

The installer installs Docker/Compose when needed, creates `.env` with random secrets, creates the required directories, builds the image, runs Prisma migrations and starts PostgreSQL, Redis, API, worker, frontend and Caddy. It preserves existing secrets and volumes on repeated runs. It rejects an incomplete or mismatching existing environment rather than silently replacing credentials.

After installation:

```bash
cd /opt/harbor
sudo docker compose ps
sudo docker compose logs --tail=100 api worker web caddy
```

Open `https://panel.example.com/setup`. Read `SETUP_TOKEN` from `.env` on the server privately and enter it in the wizard. Choose a strong administrator password. There is no default administrator password. After setup, follow [first steps](getting-started.md).

## Manual Docker Compose installation

This is for administrators who already manage Docker Compose and host networking.

1. Clone the repository and enter it.
2. Copy `.env.production.example` to `.env` and set `DOMAIN`, `ACME_EMAIL`, `APP_URL`, `POSTGRES_PASSWORD`, `ENCRYPTION_KEY` and `SETUP_TOKEN`.
3. Generate each password/key/token independently using `openssl rand -hex 32`. Use a hexadecimal database password so it is safe in the supplied PostgreSQL connection URL.
4. Set `.env` permissions to 0600. Keep the encryption key permanently; changing it prevents decryption of existing provider/SMTP credentials.
5. Ensure `infra/caddy.d` exists and TCP 80/443 are available.

```bash
chmod 600 .env
mkdir -p infra/caddy.d
docker compose config --quiet
docker compose build --pull
docker compose up -d --wait --wait-timeout 240
```

The `migrate` service prepares volume ownership and applies migrations before the applications start. Internal ports 3000/4000 are published on loopback; PostgreSQL and Redis are not published by the production Compose file. Caddy is the public ingress. A shared or untrusted Docker network requires additional network/access policies appropriate to your host.

Use `docker compose config --quiet` for validation. Printing the expanded configuration can expose secrets.

## Game node placement

The simplest deployment uses a separate game-node VPS. Finish panel setup, create the Wings connection in **Infrastructure**, and generate its unique install command. The node installer provisions an isolated Wings instance with distinct binary, configuration, systemd service, paths and network. It can coexist with another Wings instance when ports and allocations do not overlap.

For Wings alongside a **fresh** panel host:

```bash
sudo bash scripts/install.sh --domain panel.example.com --email ops@example.com   --with-wings --wings-domain games.example.com
```

Point both names to that host. This legacy fresh-host option prepares the pinned Wings binary and a Caddy virtual host; it does not complete the node connection automatically. In Infrastructure, add the Wings endpoint with reverse-proxy mode and listen port 8080, save its generated configuration to `/etc/pterodactyl/config.yml`, and start `wings.service`. For a host already running Wings, use the isolated node installer from the dashboard instead. See [provider setup](providers.md) for TLS and port details.

## SMTP and payments

Configure SMTP in **Settings → Email** and send a test message to the administrator. Configure Stripe/PayPal through the relevant integration, including the webhook endpoint and signing secret shown by Harbor. Complete sandbox payment tests before switching to live credentials. Wallet/manual receipts require staff verification; a customer's submitted transfer reference is not proof of funds.

## Persistent data

Production Compose uses named volumes for PostgreSQL, Redis, extensions, custom frontend releases, support attachments, logos and certificate state. Back up the database, `.env` and file volumes. Source code alone is not a backup. Do not run `docker compose down --volumes` on a deployment whose data you need.

## Troubleshooting

| Symptom                        | Check                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| HTTPS/certificate fails        | DNS A/AAAA records, inbound 80/443, port conflicts, Caddy logs and certificate-service rate limits          |
| API is unavailable             | `docker compose ps`, migration status, API logs and correct `APP_URL`                                       |
| Orders do not provision        | Fully paid invoice, matching healthy connection, reserved capacity, worker/Redis status and operation error |
| Browser console cannot connect | Reachable Wings HTTPS/WebSocket endpoint, matching node credentials and allowed panel origin                |
| File upload returns 413        | API 100 MiB file limit and the proxy's 105 MB request-body allowance                                        |
| Invalid setup token            | Use the token generated for this deployment; do not paste an example or another installation's token        |
| Build runs out of resources    | Free sufficient disk/RAM or build on a larger machine; do not replace a healthy release with a failed build |

[Operations and recovery](operations.md) covers upgrades, backups and restores.
