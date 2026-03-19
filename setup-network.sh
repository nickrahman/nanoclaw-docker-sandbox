#!/bin/bash
# setup-network.sh — Configure sandbox network proxy bypass rules
# Run this once after creating the sandbox (or after recreating it).
# Usage: ./setup-network.sh

set -euo pipefail

SANDBOX_NAME="nanoclaw"

echo "Configuring network proxy bypass for sandbox '$SANDBOX_NAME'..."

docker sandbox network proxy "$SANDBOX_NAME" \
  --bypass-host "api.anthropic.com" \
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

echo "Done. Restart the sandbox for changes to take effect:"
echo "  docker sandbox run $SANDBOX_NAME"
