#!/usr/bin/env bash
#
# Give Docker room for the prod image build on a GitHub-hosted runner.
#
# The root disk has ~14 GB free and the build needs more. Deleting the
# runner's preinstalled toolchains to make room took ~145 s of every deploy
# (rm -rf over hundreds of thousands of files). The runner usually has a
# second, mostly empty disk at /mnt: when it has room, Docker's data moves
# there instead (a daemon restart, seconds). Otherwise it falls back to the
# old clean-up. Run before docker/setup-buildx-action, since the builder's
# state lives under Docker's data root.
set -euo pipefail

NEED_GB="${NEED_GB:-40}"

avail_gb() { df -BG --output=avail "$1" 2>/dev/null | tail -1 | tr -dc '0-9'; }

df -h / /mnt 2>/dev/null || true
mnt_free="$(avail_gb /mnt || true)"

if [[ -d /mnt && -n "$mnt_free" && "$mnt_free" -ge "$NEED_GB" ]]; then
  echo "==> Docker data on /mnt (${mnt_free} GB free)"
  sudo systemctl stop docker.socket docker
  sudo mkdir -p /mnt/docker
  cfg=/etc/docker/daemon.json
  if [[ -s "$cfg" ]]; then
    sudo jq '. + {"data-root": "/mnt/docker"}' "$cfg" | sudo tee "$cfg.new" >/dev/null
  else
    echo '{"data-root": "/mnt/docker"}' | sudo tee "$cfg.new" >/dev/null
  fi
  sudo mv "$cfg.new" "$cfg"
  sudo systemctl start docker
  echo "data root: $(docker info --format '{{.DockerRootDir}}')"
else
  echo "==> /mnt has ${mnt_free:-no} GB free (need ${NEED_GB}); freeing the root disk instead"
  sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc \
    /opt/hostedtoolcache/CodeQL /usr/local/share/boost "${AGENT_TOOLSDIRECTORY:-/nonexistent}"
  sudo docker image prune -af
fi
