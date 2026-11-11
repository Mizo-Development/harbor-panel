#!/usr/bin/env bash
# Harbor generates the HARBOR_* values above this template for one node.
set -Eeuo pipefail
set +x
umask 077
step=preflight
work=''
claimed=false
fail() { printf 'Harbor: %s\n' "$*" >&2; exit 1; }
for arg in "$@"; do
  case "$arg" in --dry-run) dry_run=true ;; --help) printf '%s\n' 'Run as root. Options: --dry-run (read-only checks).'; exit 0 ;; *) fail "Unknown argument: $arg" ;; esac
done
: "${dry_run:=false}"
[[ $(uname -s) == Linux ]] || fail 'This installer requires Linux.'
[[ -r /etc/os-release ]] || fail 'Cannot identify the Linux distribution.'
. /etc/os-release
case "$ID:${VERSION_ID:-}" in
  ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;;
  *) fail 'Supported systems: Ubuntu 22.04/24.04/26.04 or Debian 12/13.' ;;
esac
case "$(uname -m)" in
  x86_64) architecture=amd64; checksum=7e763389bb5d386a7d32ccdd46cffcf1ab9ed697e5c2aca7fe44183b527cd4c0 ;;
  aarch64) architecture=arm64; checksum=516cc0b86fec092feb9893bacab2e1bf478b5477a5459ad9d722676c7549faa5 ;;
  *) fail 'Supported CPU architectures: amd64 and arm64.' ;;
esac
command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || fail 'A VPS booted with systemd is required.'
[[ -d /sys/fs/cgroup ]] || fail 'Docker requires cgroups on this VPS.'
command -v apt-get >/dev/null || fail 'APT is required.'
if [[ "$dry_run" == true ]]; then
  printf '%s\n' 'Preflight passed. A real run will claim this node, install Docker and Wings v1.13.4, configure TLS and systemd, and verify the panel connection. No changes made.'
  exit 0
fi
[[ $EUID == 0 ]] || fail 'Run this script as root (sudo bash script-name.sh).'
command -v curl >/dev/null || fail 'Install curl first: apt-get update && apt-get install -y curl'
service_name="harbor-wings-$HARBOR_NODE"
service="$service_name.service"
config_file="/etc/harbor/wings/$HARBOR_NODE.yml"
binary="/usr/local/lib/harbor/wings/$HARBOR_NODE/wings"
network="harbor_wings_$HARBOR_NODE"
compact_node="${HARBOR_NODE//-/}"
bridge="hb${compact_node:0:12}"
state="/var/lib/harbor-node-installer/$HARBOR_NODE"
exec 9>/var/lock/harbor-node-installer.lock
flock -n 9 || fail 'A node installer is already running on this VPS.'
# Only this Harbor namespace can be updated. The original Wings files are unrelated.
if [[ -e "$config_file" || -e "$binary" || -e "/etc/systemd/system/$service" ]]; then
  [[ -f "$state/owner" && "$(cat "$state/owner")" == "$HARBOR_NODE" ]] \
    || fail 'An unmanaged installation exists in this Harbor instance namespace.'
fi
command -v ss >/dev/null || fail 'Install iproute2 first so listener conflicts can be checked.'
own_pid=$(systemctl show "$service" -p MainPID --value 2>/dev/null || true)
for port in "$HARBOR_PORT" "$HARBOR_SFTP_PORT"; do
  listeners=$(ss -H -ltnp "sport = :$port")
  if [[ -n "$listeners" ]]; then
    [[ "$own_pid" =~ ^[1-9][0-9]*$ ]] && ! printf '%s\n' "$listeners" | grep -v "pid=$own_pid," >/dev/null \
      || fail "TCP port $port is already in use. Choose different Harbor daemon/SFTP ports in the panel and generate a new command."
  fi
done
cert_name="$HARBOR_HOST"
[[ "$HARBOR_TLS" != auto ]] || cert_name="$service_name"
cert_dir="/etc/letsencrypt/live/$cert_name"
if [[ "$HARBOR_TLS" == auto && ! -s "$cert_dir/fullchain.pem" && -n "$(ss -H -ltn 'sport = :80')" ]]; then
  fail 'TCP 80 is occupied. Choose the existing-certificate TLS option for this hostname, or arrange ACME validation separately. No web server was stopped.'
fi
install -d -m 0700 "$state"
work=$(mktemp -d /tmp/harbor-node.XXXXXXXX)
chmod 0700 "$work"
# One random key binds this grant to this machine and permits a failed run to resume.
if [[ ! -f "$state/machine-key" ]]; then
  { cat /proc/sys/kernel/random/uuid; cat /proc/sys/kernel/random/uuid; } | tr -d '\n-' > "$state/machine-key"
  chmod 0600 "$state/machine-key"
fi
machine_key=$(cat "$state/machine-key")
[[ "$machine_key" =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid local installer identity.'
printf 'header = "Authorization: Bearer %s"\n' "$HARBOR_TOKEN" > "$work/curl.conf"
printf 'header = "Content-Type: application/json"\n' >> "$work/curl.conf"
# Credentials are passed in private files, not curl process arguments or URLs.
post() {
  curl --config "$work/curl.conf" --fail --silent --show-error --connect-timeout 15 --max-time 45 --proto '=http,https' \
    --data-binary "@$work/request.json" "$HARBOR_BASE/$1" -o "$work/response.json"
}
report() {
  printf '{"machineKey":"%s","step":"%s","status":"%s"%s}\n' "$machine_key" "$step" "$1" "${2:-}" > "$work/request.json"
  post progress
}
cleanup() {
  rc=$?
  trap - EXIT
  if [[ $rc != 0 && "$claimed" == true ]]; then
    report failed >/dev/null 2>&1 || true
    printf 'Harbor setup stopped at %s. Fix the reported problem and rerun this downloaded script before its grant expires.\n' "$step" >&2
  fi
  [[ -z "$work" ]] || rm -rf -- "$work"
  exit "$rc"
}
trap cleanup EXIT
printf '{"machineKey":"%s"}\n' "$machine_key" > "$work/request.json"
post claim || fail 'Setup access was rejected. Check the panel and generate a new command if necessary.'
claimed=true
printf '%s\n' "$HARBOR_NODE" > "$state/owner"
mv "$work/response.json" "$work/claimed.json"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends --no-upgrade ca-certificates curl python3 util-linux
# Check that DNS has a usable IPv4 address for the optional game allocations.
allocation_ip="$HARBOR_ALLOCATION_IP"
if [[ "$HARBOR_ADD_ALLOCATIONS" == true && -z "$allocation_ip" ]]; then
  allocation_ip=$(python3 - "$HARBOR_HOST" <<'PY'
import socket, sys
addresses = sorted({r[4][0] for r in socket.getaddrinfo(sys.argv[1], None, socket.AF_INET)})
if len(addresses) != 1:
    sys.exit('Set an explicit allocation IPv4 address in the panel when the node has zero or multiple A records.')
print(addresses[0])
PY
  )
fi
step=docker
report running
if ! command -v docker >/dev/null; then
  # Preserve unrelated container runtimes rather than removing conflicting packages.
  for package in docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q '^install ok installed$'; then
      fail "Conflicting package $package is installed. Prepare Docker manually, then rerun."
    fi
  done
  install -d -m 0755 /etc/apt/keyrings
  curl --fail --silent --show-error --proto '=https' "https://download.docker.com/linux/$ID/gpg" -o "$work/docker.asc"
  install -m 0644 "$work/docker.asc" /etc/apt/keyrings/harbor-docker.asc
  cat > /etc/apt/sources.list.d/harbor-docker.sources <<REPO
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/harbor-docker.asc
REPO
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
docker info >/dev/null || fail 'Docker cannot run on this VPS. Check virtualization and kernel support.'
# Read existing port bindings, including stopped containers, without changing them.
container_ids=$(docker ps -aq)
printf '[]\n' > "$work/containers.json"
if [[ -n "$container_ids" ]]; then
  mapfile -t containers <<< "$container_ids"
  docker inspect "${containers[@]}" > "$work/containers.json"
fi
if [[ "$HARBOR_ADD_ALLOCATIONS" == true ]]; then
  python3 - "$work/containers.json" "$network" "$allocation_ip" "$HARBOR_PORT_START" "$HARBOR_PORT_END" <<'PYPORTS'
import json, socket, sys
with open(sys.argv[1]) as f: containers=json.load(f)
network, ip, start, end=sys.argv[2],sys.argv[3],int(sys.argv[4]),int(sys.argv[5])
owned=set()
for c in containers:
    ours=network in (c.get('NetworkSettings',{}).get('Networks') or {})
    for bindings in (c.get('HostConfig',{}).get('PortBindings') or {}).values():
        for b in bindings or []:
            port=int(b.get('HostPort') or 0)
            if not start<=port<=end: continue
            host=b.get('HostIp','')
            if ours: owned.add(port)
            elif host in ('','0.0.0.0','::',ip): sys.exit(f'Game port {port} is reserved by another Docker container. Choose a different game port range.')
for port in range(start,end+1):
    if port in owned: continue
    for kind in (socket.SOCK_STREAM,socket.SOCK_DGRAM):
        with socket.socket(socket.AF_INET,kind) as probe:
            try: probe.bind(('0.0.0.0',port))
            except OSError: sys.exit(f'Game port {port} is in use on this VPS. Choose a different range.')
PYPORTS
fi
if docker network inspect "$network" > "$work/network.json" 2>/dev/null; then
  python3 - "$work/network.json" "$HARBOR_NODE" <<'PYOWNER'
import json,sys
with open(sys.argv[1]) as f: n=json.load(f)[0]
if n.get('Driver')!='bridge' or (n.get('Labels') or {}).get('harbor.node.id')!=sys.argv[2]:
    sys.exit('The Harbor network name is already owned by another installation.')
PYOWNER
else
  docker network create --driver bridge --label "harbor.node.id=$HARBOR_NODE" \
    --opt "com.docker.network.bridge.name=$bridge" "$network" >/dev/null
  docker network inspect "$network" > "$work/network.json"
fi
step=wings
report running
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 300 \
  "https://github.com/pterodactyl/wings/releases/download/v1.13.4/wings_linux_$architecture" -o "$work/wings"
printf '%s  %s\n' "$checksum" "$work/wings" | sha256sum --check
install -d -m 0755 "$(dirname "$binary")"
install -m 0755 "$work/wings" "$binary.new"
mv "$binary.new" "$binary"
step=tls
report running
# Preserve the firewall policy, adding only the ports this node requires.
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow "$HARBOR_PORT/tcp"
  ufw allow "$HARBOR_SFTP_PORT/tcp"
  if [[ "$HARBOR_ADD_ALLOCATIONS" == true ]]; then
    if [[ "$HARBOR_PORT_START" == "$HARBOR_PORT_END" ]]; then
      ufw allow "$HARBOR_PORT_START/tcp"
      ufw allow "$HARBOR_PORT_START/udp"
    else
      ufw allow "$HARBOR_PORT_START:$HARBOR_PORT_END/tcp"
      ufw allow "$HARBOR_PORT_START:$HARBOR_PORT_END/udp"
    fi
  fi
  [[ "$HARBOR_TLS" != auto ]] || ufw allow 80/tcp
fi
if [[ "$HARBOR_TLS" == auto ]]; then
  apt-get install -y certbot
  certbot certonly --standalone --non-interactive --agree-tos --keep-until-expiring --cert-name "$cert_name" --email "$HARBOR_EMAIL" -d "$HARBOR_HOST" \
    || fail 'Certificate issuance failed. Point DNS at this VPS and allow inbound TCP 80. An existing web server must not occupy port 80.'
  systemctl enable --now certbot.timer
fi
if [[ "$HARBOR_TLS" != none ]]; then
  [[ -s "$cert_dir/fullchain.pem" && -s "$cert_dir/privkey.pem" ]] \
    || fail 'TLS certificate files are missing. Check the chosen certificate mode and hostname.'
  install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
  cat > "/etc/letsencrypt/renewal-hooks/deploy/$service_name" <<HOOK
#!/usr/bin/env bash
if [[ "\${RENEWED_LINEAGE:-}" == "$cert_dir" ]]; then
  systemctl try-restart "$service"
fi
HOOK
  chmod 0755 "/etc/letsencrypt/renewal-hooks/deploy/$service_name"
fi
step=configuration
report running
install -d -m 0700 /etc/harbor/wings
python3 - "$work/claimed.json" "$work/network.json" "$work/config.yml" "$HARBOR_NODE" "$network" <<'PYCONFIG'
import json, sys
with open(sys.argv[1]) as f: config=json.load(f)['data']['config']
with open(sys.argv[2]) as f: network=json.load(f)[0]
if not config.get('token') or config.get('uuid')!=sys.argv[4]: sys.exit('The panel returned invalid Wings configuration.')
if config['system']['root_directory']!='/var/lib/harbor/wings/'+sys.argv[4]: sys.exit('Generate a fresh installer for the isolated Harbor layout.')
if config['docker']['network']['name']!=sys.argv[5]: sys.exit('The panel returned a mismatched Docker network.')
ipv4=next((v for v in network['IPAM']['Config'] if ':' not in v.get('Subnet','')),None)
if not ipv4 or not ipv4.get('Gateway'): sys.exit('Docker did not provide an IPv4 network with a gateway.')
config['docker']['network']['interface']=ipv4['Gateway']
config['docker']['network']['interfaces']={'v4':{'subnet':ipv4['Subnet'],'gateway':ipv4['Gateway']}}
with open(sys.argv[3],'w') as f: json.dump(config,f,indent=2)
PYCONFIG
if [[ -e "$config_file" ]]; then
  cp -p "$config_file" "$state/config.before-last-run.yml"
  chmod 0600 "$state/config.before-last-run.yml"
fi
install -m 0600 "$work/config.yml" "$config_file.new"
mv "$config_file.new" "$config_file"
cat > "/etc/systemd/system/$service" <<UNIT
[Unit]
Description=Harbor Wings node $HARBOR_NODE
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service
[Service]
User=root
WorkingDirectory=/etc/harbor/wings
ExecStart=$binary --config $config_file
Restart=on-failure
RestartSec=5
LimitNOFILE=4096
[Install]
WantedBy=multi-user.target
UNIT
if [[ -d /etc/logrotate.d ]]; then
  cat > "/etc/logrotate.d/$service_name" <<ROTATE
/var/log/harbor/wings/$HARBOR_NODE/wings.log {
  daily
  rotate 7
  missingok
  notifempty
  compress
  copytruncate
}
ROTATE
fi
step=starting
report running
systemctl daemon-reload
systemctl enable "$service"
systemctl restart "$service"
for attempt in {1..30}; do
  systemctl is-active --quiet "$service" && break
  sleep 2
done
systemctl is-active --quiet "$service" || fail "Harbor Wings did not start. Inspect: journalctl -u $service -n 80"
step=verifying
report running
extra=''
[[ -z "$allocation_ip" ]] || extra=",\"allocationIp\":\"$allocation_ip\""
for attempt in {1..12}; do
  if report complete "$extra"; then
    claimed=false
    printf '\n%s\n' 'Node connected successfully. Docker and Wings are enabled at boot, and requested game allocations are registered.'
    printf 'Node endpoint: %s\nSFTP port: %s\nService: %s\n' "$HARBOR_ENDPOINT" "$HARBOR_SFTP_PORT" "$service"
    printf '%s\n' 'Delete this downloaded script now; it contains an expired setup credential.'
    exit 0
  fi
  sleep 5
done
fail "The panel cannot verify this node. Allow inbound TCP $HARBOR_PORT (daemon), TCP $HARBOR_SFTP_PORT (SFTP), and the game ports in your VPS/network firewall; verify DNS and TLS. Then rerun this script."
