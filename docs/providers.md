# Hosting providers

No external credentials or infrastructure are bundled. Connection checks do real HTTP requests; unavailable providers never receive a fake online status. Admin connection URLs require HTTPS in production. Install a trusted CA certificate for private certificates; do not disable TLS verification.

## Wings 1.13.4

The compatibility target is the official Wings 1.13.4 release. Actual node boot and Docker game installation require validation on your hardware before selling services. Panel → Wings uses the daemon token. Wings → Panel uses `token_id.token`. Configuration, install scripts, installation callbacks, SFTP, backup callbacks, and console tokens are implemented.

Choose local or remote Wings in setup. For a fresh VPS or one already running Wings, add a separate Harbor Wings connection in Admin → Infrastructure with the publicly reachable endpoint (for example `https://games.example.com:8081`), direct Wings TLS and matching listen port. Leave both credentials empty to generate the node identity. Saving opens **Install game node**; existing Wings cards also have **Install node**.

Choose unused Harbor daemon/SFTP ports (defaults **8081** and **2023**), automatic Let's Encrypt TLS or existing certificate files, the certificate contact email, and optional game IPv4/port allocations. The selected daemon port updates this connection's endpoint. Default suggested game ports are 25575–25584; choose a range that does not overlap existing allocations, including ports reserved by the other panel but not currently running. Click **Generate install command**, then copy and run it **as root on the target VPS**. Alternatively download the unique script, copy it securely to the VPS and run `sudo bash harbor-node-<id>.sh`. `--dry-run` performs read-only OS/architecture/systemd checks without claiming the node or installing packages. The command requires `curl`; minimal hosts can install it with their package manager first.

Supported installer targets are Ubuntu 22.04/24.04/26.04 and Debian 12/13, amd64 or arm64, booted with systemd and Docker-capable virtualization. It installs Docker from its official signed APT repository when missing, verifies Wings 1.13.4 against pinned SHA-256 digests, writes root-only configuration, obtains/configures certificates, adds needed rules to an already-active UFW firewall, enables systemd services and verifies Wings from the panel. It never enables/disables the firewall or removes conflicting container runtimes. Provider/security-group firewalls remain administrator-managed. Automatic HTTPS requires DNS pointing at the VPS and inbound TCP 80; the daemon uses the selected endpoint port, SFTP uses the selected port (2023 by default) and game ports need TCP/UDP access as appropriate. Game IPv4 allocations must be assigned/routed to the node; NAT networking may need separate configuration.

Administrators can also issue the installer using `POST /api/v1/nodes/:id/installations` (session authentication or the `admin:infrastructure:install` API permission):

```json
{
  "tlsMode": "existing",
  "daemonPort": 8081,
  "sftpPort": 2023,
  "allocationIp": "203.0.113.10",
  "addAllocations": true,
  "portStart": 25575,
  "portEnd": 25584
}
```

The response includes a one-time setup token/command and the isolated instance's config/service paths and endpoint. Keep its credential private.

The command is a credential, shown only when generated. Its grant expires after one hour before first use, binds atomically to one random machine key at claim, allows retries on that same machine for up to three hours after claim, and closes after successful setup. The database stores token/machine-key hashes, not raw setup tokens. Download alone does not consume a grant. Failed setup can resume using the downloaded file; regenerating revokes older waiting/failed grants. A running grant must be revoked explicitly before replacement. Revocation stops further setup API access; it does not uninstall or rotate daemon credentials already received by a node. Config/credential/endpoint changes invalidate the old installer. The panel reports complete only after an authenticated Wings health request succeeds, then registers the optional allocations idempotently.

The automatic installer always prepares an isolated Harbor instance. For node UUID `<id>`, it uses:

| Component                         | Harbor location                                          |
| --------------------------------- | -------------------------------------------------------- |
| Binary                            | `/usr/local/lib/harbor/wings/<id>/wings`                 |
| Configuration                     | `/etc/harbor/wings/<id>.yml`                             |
| Service                           | `harbor-wings-<id>.service`, explicitly using `--config` |
| Data, state, archives and backups | `/var/lib/harbor/wings/<id>/`                            |
| Logs                              | `/var/log/harbor/wings/<id>/`                            |
| Runtime files / machine IDs       | `/run/harbor-wings/<id>/`                                |
| Docker network                    | `harbor_wings_<id>` with a separately named bridge       |

A separate Unix user owns its server files. Docker assigns an available subnet to the new network; the installer writes the actual gateway/subnet into the local configuration. Existing Docker networks are not renamed or removed. A retry reuses only its own labelled network, configuration and service. Existing Docker is reused without restarting/upgrading it. The default `/usr/local/bin/wings`, `/etc/pterodactyl/config.yml`, `wings.service`, `/var/lib/pterodactyl`, default runtime files and legacy log rotation are untouched.

Daemon/SFTP listener checks run before claiming the grant or installing packages. Occupied game ports and conflicting Docker bindings, including stopped-container bindings, are rejected. Managed retries permit this instance's own listeners/containers. No existing service is stopped to free a port. Automatic TLS uses a per-instance certificate name and renewal hook. If an existing web server occupies TCP 80, choose the existing-certificate option for the same hostname or arrange certificate validation separately. Existing-certificate mode reuses files without changing the original certificate's renewal configuration, and adds a lineage-checked hook restarting only the Harbor service.

Managed retries retain the previous configuration under `/var/lib/harbor-node-installer/<node-id>/`; the machine identity and temporary downloaded credentials are root-only. Delete the downloaded script after success. An already installed legacy Harbor connection with services or a successful older setup cannot be silently converted to the new layout: add a separate connection instead. Earlier setup grants must be regenerated for the new layout. This installer prepares the node; selling hosting still needs reviewed game installation files and configured products. Real VPS execution remains a separate infrastructure acceptance test; sandbox tests exercise isolation with mocked system/Docker commands.

Local reverse-proxy deployments and existing managed migrations can still use manual Configuration: save JSON (valid YAML) to `/etc/pterodactyl/config.yml`, mode 0600, install Docker and `scripts/install-wings.sh`, configure the proxy/certificate, and start Wings. Automatic setup currently targets direct daemon endpoints.

References: [Wings installation requirements](https://docs.pterodactyl.io/v1/wings/installing), [official Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/), [official Docker Debian installation](https://docs.docker.com/engine/install/debian/), [pinned Wings release](https://github.com/pterodactyl/wings/releases/tag/v1.13.4).

Game plans default to **Paper (automatic stable releases)**. No manually configured download URL or checksum is required. The worker queries the [official Paper downloads API](https://docs.papermc.io/misc/downloads-service/), selects the newest stable Minecraft version/build and obtains its SHA-256. The node verifies a temporary download before replacing the JAR, retaining the previous JAR as `.old`; existing worlds, properties and EULA files remain in place. First installation creates an EULA file for Minecraft hosting, whose order flow includes the Minecraft EULA agreement. Resolve latest on install/reinstall, never silently on every power restart. The service records the selected URL, checksum, version, build, image, egg definition and operation ID; retries of one operation reuse that artifact. Reinstall may change game files: back up first. A provider outage or missing stable build fails the operation rather than downloading unverified content. Older explicit node-level URL/checksum pairs remain an optional compatibility override.

Admin → **Game eggs** imports/exports Pterodactyl `PTDL_v1`/`PTDL_v2` JSON, groups eggs into nests, edits definitions and archives imports. Review and acknowledge each installation script and image before import: scripts execute on the game node inside its installation container. The bundled Paper definition derives from the [official Pterodactyl game-eggs project](https://github.com/pterodactyl/game-eggs), whose MIT license accompanies the asset. Harbor supplies an automatic, checksum-verifying Paper installer. The built-in egg is protected; import a copy for custom behavior.

Admin → **Products** assigns an egg, allowed runtime image and validated default variables. Orders snapshot that assignment, so subsequent plan/egg edits cannot change a purchased server. Existing services receive the default Paper assignment on their next provision/reinstall. Paper chooses Java 25 for Minecraft 26.x, Java 21 for 1.20.5–1.21.x, and matching older runtimes for older releases; imported eggs use their selected image. Empty required egg defaults can be filled when assigning the plan. Supported Laravel rules include required/nullable/string/numeric/integer/boolean, bounds, enum lists and common regex rules; unsupported rules fail import explicitly. Linked egg inheritance and custom validation functions are not implemented: import a self-contained definition.

The service **Startup** tab honors egg variable visibility and edit permissions; changes apply on the next reinstall. Administrators can edit hidden variables. Archive prevents new assignments while existing services retain their snapshot. The worker translates egg startup/stop detection and file parsers into Wings process configuration, including allocation and environment placeholders. Non-Minecraft eggs can be imported and assigned, but each game's actual installation and runtime must be verified on its node.

The Wings console JWT includes `websocket.connect` plus its explicit permitted actions. The file manager supports new files/folders, bounded text editing (1 MB), binary uploads with progress (100 MB per file), streaming downloads, rename, duplicate, confirmed deletion, archive creation and extraction. API uploads authenticate ownership and service state before accepting multipart data, spool to a private temporary directory, stream to Wings and clean up afterward. Concurrent upload slots are bounded. Larger transfers can use the service's SFTP host/port. The deployed Nginx API body limit is 105 MB for multipart overhead; API file limits still apply. Uploading a matching filename replaces its content.

SFTP defaults to 2023 for new automatic instances and 2022 for legacy/manual nodes; the customer service page shows its configured host and port. It uses `email.service-uuid` as the username. Accounts with TOTP use the panel file manager rather than password-based SFTP. Game consoles use short-lived, service-scoped JWTs and require the panel origin in Wings `allowed_origins`.

## Proxmox

Prepare Proxmox VE separately. In Admin → Proxmox, connect a cluster using an API token, an initial node name, disk storage, and bridge. Create reusable locations and assign connections to them. Manage Proxmox → Settings can add another node using the same encrypted cluster credentials; each connection represents a specific provisioning target. This registers existing nodes in Harbor; it does not install Proxmox or join physical machines to a cluster.

Inventory discovers cluster nodes, per-node storage, bridges, resource pools, QEMU guests/templates, LXC containers, and downloaded CT template volumes. Missing network/pool inspection privileges produce warnings. Configure template and backup storage, boot disk, CPU model, VLAN, MTU, network rate in Mbps, DNS, guest firewall, and start-on-boot defaults. Storage and bridges must already exist on the Proxmox host; Harbor selects them rather than formatting disks or altering host networking. TLS certificates must be trusted.

IP pools accept a bounded IPv4 range, prefix, gateway, and pool name. Gateway, network, and broadcast addresses are excluded; `/31` and `/32` allow routed host addresses. A repeated IP cannot be added again with a different prefix. Reserved addresses cannot be removed. Choose the pool on a VPS product, or leave it empty to use any available address on the target connection. Only add public addresses allocated to you and arrange routing on your infrastructure.

Products select QEMU/KVM or LXC. QEMU uses a numeric, cloud-init-enabled VM template and the configured boot disk (default `scsi0`); plan disks cannot be smaller than the template disk. LXC uses a downloaded `storage:vztmpl/filename` OS image and root-directory-capable storage; containers are always unprivileged, with configurable RAM, cores, disk, and swap. These are Linux SSH-key workflows. LXC cloning from CT IDs and privileged containers are not offered.

Customers supply an SSH public key. Guest IDs derive deterministically from service IDs; every managed VM/container has a `harbor:<service-id>` ownership marker. An unexpected existing guest is rejected. Each new service saves its placement settings at order time, so editing connection defaults does not move existing services. Provider tasks are polled to completion. Uncertain failures require reconciliation before manual retry. The noVNC console uses the matching QEMU/LXC endpoint and a one-time backend websocket grant; API tokens never reach the browser. Live QEMU/LXC workloads still require validation against your cluster; the automated provider checks use HTTP fixtures.

## Plesk

Connect an existing licensed Plesk Obsidian Linux installation, normally on HTTPS port 8443. Use an XML API access key and configure the hosting IP. Create service plans in Plesk with mail disabled. Check the connection to list plans and use the exact plan name on products.

The provider creates a customer account per Harbor customer and subscriptions for ordered domains, reuses only matching customer resources, and manages suspension, unsuspension, confirmed termination, status, and usage. Advanced website management uses short-lived Plesk login sessions. The panel must see the customer’s real client IP for IP-bound sessions; configure trusted proxy settings and proxy headers correctly. Plesk owns PHP, databases, certificates, backups, and files for these services.

## Harbor Web

Deploy the agent on a dedicated Ubuntu 24.04 web machine. Install Nginx, PHP 8.3 FPM, MariaDB, certbot, quota tooling, and Node 24. Enable Unix user quotas on the filesystem containing `/srv/harbor/sites`. The connection health check refuses readiness without these prerequisites.

Run the compiled agent as root under the provided systemd unit, behind HTTPS with a 64-character token and restricted network access. Each tenant gets a separate Unix user and PHP-FPM pool. File operations run under that user. Agent state (including database passwords) is mode 0600 under a root-only directory. PHP memory is per process, with a bounded worker count; it is not a container-wide memory guarantee.

Point domain DNS at the web server before issuing certificates. Database creation/reset returns a new password once through the authenticated customer endpoint. Backups include files and the database. Restore accepts only the service’s own backup UUID. Backup archives containing symlinks are rejected during restore; database dumps stream to disk with bounded command timeouts. Preserve the agent state, backups, website volume, and MariaDB data in your infrastructure backups. Mail hosting and automatic migration between Plesk and Harbor Web are excluded.

The isolated layout follows the pinned upstream [Wings configuration fields](https://github.com/pterodactyl/wings/blob/v1.13.4/config/config.go), [Docker network configuration](https://github.com/pterodactyl/wings/blob/v1.13.4/config/config_docker.go) and [explicit configuration flag](https://github.com/pterodactyl/wings/blob/v1.13.4/cmd/root.go).
