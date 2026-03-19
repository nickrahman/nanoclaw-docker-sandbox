#!/bin/bash
# start-op.sh — Start NanoClaw in the Docker sandbox with credentials from 1Password
# Requires: op CLI authenticated (op signin), sandbox created (./install.sh)
# Usage: ./start-op.sh

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_NAME="nanoclaw"

# Stop existing instance if running (PID is container-internal)
if [ -f "$DIR/nanoclaw.pid" ]; then
  OLD_PID=$(cat "$DIR/nanoclaw.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ]; then
    echo "Stopping existing NanoClaw (PID $OLD_PID)..."
    docker sandbox exec "$SANDBOX_NAME" kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
fi

mkdir -p "$DIR/logs"

# Configure network proxy bypass rules
echo "Configuring network bypass..."
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

# Resolve 1Password secrets — write to .env.runtime (bind-mounted, readable inside sandbox)
# .env.runtime persists so node can read it; cleaned up on next start
rm -f "$DIR/.env.runtime"

TEMP_ENV=$(mktemp /tmp/nanoclaw-env.XXXXXX)
trap 'rm -f "$TEMP_ENV"' EXIT

echo "Resolving secrets from 1Password..."
op inject -i "$DIR/.env" -o "$TEMP_ENV"
cp "$TEMP_ENV" "$DIR/.env.runtime"
chmod 600 "$DIR/.env.runtime"

echo "Injected env keys: $(grep -v '^#' "$DIR/.env.runtime" | grep '=' | cut -d= -f1 | tr '\n' ' ')"

# Start node inside the sandbox with logs redirected inside the container so
# the process survives after this script exits
echo "Starting NanoClaw in sandbox '$SANDBOX_NAME'..."
docker sandbox exec "$SANDBOX_NAME" bash -c "
  nohup node '$DIR/dist/index.js' \
    >> '$DIR/logs/nanoclaw.log' \
    2>> '$DIR/logs/nanoclaw.error.log' &
  echo \$! > '$DIR/nanoclaw.pid'
"

echo "NanoClaw started (PID $(cat "$DIR/nanoclaw.pid"))"
echo "To stop: docker sandbox exec $SANDBOX_NAME kill \$(cat '$DIR/nanoclaw.pid')"
echo "Logs: tail -f $DIR/logs/nanoclaw.log"
