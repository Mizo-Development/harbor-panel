#!/bin/bash
set -euo pipefail
apt-get update
apt-get install -y ca-certificates curl jq
USER_AGENT='Harbor (https://github.com/Mizo-Development/harbor-panel)'
API=https://fill.papermc.io/v3/projects/paper
get() { curl --fail --silent --show-error --retry 3 --user-agent "$USER_AGENT" "$1"; }
version=${MINECRAFT_VERSION:-latest}
build=${BUILD_NUMBER:-latest}
if [[ "$version" == latest ]]; then
  versions=$(get "$API" | jq -r '.versions[][] | select(test("^[0-9]+(\\.[0-9]+)*$"))' | sort -Vr | sed -n '1,10p')
else
  [[ "$version" =~ ^[0-9]+(\.[0-9]+)*$ ]] || { echo 'Invalid Minecraft version'; exit 1; }
  versions=$version
fi
[[ "$build" == latest || "$build" =~ ^[0-9]+$ ]] || { echo 'Invalid Paper build'; exit 1; }
release=''
for candidate in $versions; do
  release=$(get "$API/versions/$candidate/builds" | jq -c --arg build "$build" '[.[] | select(.channel == "STABLE" and ($build == "latest" or (.id|tostring) == $build))] | sort_by(.id) | last // empty')
  [[ -z "$release" ]] || { version=$candidate; break; }
done
[[ -n "$release" ]] || { echo 'No stable Paper build available'; exit 1; }
url=$(jq -r '.downloads["server:default"].url' <<< "$release")
sha=$(jq -r '.downloads["server:default"].checksums.sha256' <<< "$release")
jar=${SERVER_JARFILE:-server.jar}
[[ "$url" =~ ^https://fill-data\.papermc\.io/[a-zA-Z0-9./_%\?=\&+-]+$ && "$sha" =~ ^[a-fA-F0-9]{64}$ && "$jar" =~ ^[a-zA-Z0-9_.-]+\.jar$ ]] || { echo 'Invalid download metadata'; exit 1; }
cd /mnt/server
trap 'rm -f .harbor-paper-download' EXIT
curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' --user-agent "$USER_AGENT" "$url" -o .harbor-paper-download
echo "$sha  .harbor-paper-download" | sha256sum --check
[[ ! -f "$jar" ]] || cp "$jar" "$jar.old"
mv .harbor-paper-download "$jar"
[[ -f server.properties ]] || touch server.properties
[[ -f eula.txt ]] || printf 'eula=true\n' > eula.txt
echo "Installed Paper $version build $(jq -r '.id' <<< "$release") (SHA-256 verified)"
