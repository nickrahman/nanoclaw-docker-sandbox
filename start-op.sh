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

# Stop existing mcp-grafana sidecar (idempotent — safe if not running)
docker sandbox exec "$SANDBOX_NAME" docker stop nanoclaw-mcp-grafana 2>/dev/null || true
docker sandbox exec "$SANDBOX_NAME" docker rm nanoclaw-mcp-grafana 2>/dev/null || true

mkdir -p "$DIR/logs"

# Configure network proxy bypass rules
echo "Configuring network bypass..."
docker sandbox network proxy "$SANDBOX_NAME" \
  --bypass-host "api.anthropic.com" \
  --bypass-host "slack.com" \
  --bypass-host "*.slack.com" \
  --bypass-host "lithic.grafana.net"

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

# Start mcp-grafana SSE sidecar inside the sandbox's Docker daemon
GRAFANA_URL=$(grep '^GRAFANA_URL=' "$DIR/.env.runtime" | cut -d= -f2-)
GRAFANA_SA_TOKEN=$(grep '^GRAFANA_SERVICE_ACCOUNT_TOKEN=' "$DIR/.env.runtime" | cut -d= -f2-)

if [ -n "$GRAFANA_URL" ] && [ -n "$GRAFANA_SA_TOKEN" ]; then
  echo "Starting mcp-grafana sidecar..."
  # The sidecar runs inside the sandbox's Docker daemon (nested Docker) so that
  # agent containers can reach it at host.docker.internal:8000. Sidecar
  # containers started on the host would be unreachable from inside the sandbox.
  #
  # -p 8000:8000: publish the SSE port on the sandbox's bridge network.
  # (--network host is not supported by the sandbox's Docker daemon.)
  # Agent containers reach it via host.docker.internal:8000 (resolved by
  # --add-host in container-runtime.ts).
  if ! docker sandbox exec "$SANDBOX_NAME" docker run -d \
    --name nanoclaw-mcp-grafana \
    -p 8000:8000 \
    --restart unless-stopped \
    -e "GRAFANA_URL=$GRAFANA_URL" \
    -e "GRAFANA_SERVICE_ACCOUNT_TOKEN=$GRAFANA_SA_TOKEN" \
    mcp/grafana; then
    echo "WARNING: mcp-grafana sidecar failed to start (docker run returned non-zero)"
  else
    echo "mcp-grafana sidecar started on port 8000"
  fi
else
  echo "WARNING: Grafana credentials not found, skipping mcp-grafana sidecar"
fi

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
