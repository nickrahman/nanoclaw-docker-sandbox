#!/usr/bin/env bash
# install.sh — Set up NanoClaw in a Docker AI Sandbox (local install).
#
# Run from the repo root after cloning:
#   ./install.sh

set -euo pipefail

WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUFFIX=$(date +%s | tail -c 5)
SANDBOX_NAME="nanoclaw-sandbox-${SUFFIX}"

echo ""
echo "=== NanoClaw Docker Sandbox Setup ==="
echo ""
echo "Workspace: ${WORKSPACE}"
echo "Sandbox:   ${SANDBOX_NAME}"
echo ""

# ── Preflight ──────────────────────────────────────────────────────
if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" != "arm64" ]]; then
  echo "ERROR: Docker AI Sandboxes require Apple Silicon (M1 or later)."
  echo "Intel Macs are not supported. See: https://docs.docker.com/sandbox/"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker not found."
  echo "Install Docker Desktop 4.40+: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

if ! docker sandbox version &>/dev/null; then
  echo "ERROR: Docker sandbox not available."
  echo "Update Docker Desktop 4.40+ and enable sandbox support."
  exit 1
fi

# ── Create sandbox using Claude agent type ─────────────────────────
echo "Creating sandbox..."
echo y | docker sandbox create --name "$SANDBOX_NAME" claude "$WORKSPACE"

# ── Configure proxy bypass for messaging platforms ─────────────────
echo "Configuring network bypass..."
docker sandbox network proxy "$SANDBOX_NAME" \
  --bypass-host api.anthropic.com \
  --bypass-host "api.telegram.org" \
  --bypass-host "*.telegram.org" \
  --bypass-host "*.whatsapp.com" \
  --bypass-host "*.whatsapp.net" \
  --bypass-host "*.web.whatsapp.com" \
  --bypass-host "discord.com" \
  --bypass-host "*.discord.com" \
  --bypass-host "*.discord.gg" \
  --bypass-host "*.discord.media" \
  --bypass-host "slack.com" \
  --bypass-host "*.slack.com"

echo ""
echo "========================================="
echo "  Sandbox created! Launching..."
echo "========================================="
echo ""
echo "Type /setup when Claude Code starts."
echo ""

docker sandbox run "$SANDBOX_NAME"
