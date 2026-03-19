#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd
# To stop: kill \$(cat /Users/nick/Code/nanoclaw-docker-sandbox/nanoclaw.pid)

set -euo pipefail

cd "/Users/nick/Code/nanoclaw-docker-sandbox"

# Stop existing instance if running
if [ -f "/Users/nick/Code/nanoclaw-docker-sandbox/nanoclaw.pid" ]; then
  OLD_PID=$(cat "/Users/nick/Code/nanoclaw-docker-sandbox/nanoclaw.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing NanoClaw (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
fi

echo "Starting NanoClaw..."
nohup "/usr/bin/node" "/Users/nick/Code/nanoclaw-docker-sandbox/dist/index.js" \
  >> "/Users/nick/Code/nanoclaw-docker-sandbox/logs/nanoclaw.log" \
  2>> "/Users/nick/Code/nanoclaw-docker-sandbox/logs/nanoclaw.error.log" &

echo $! > "/Users/nick/Code/nanoclaw-docker-sandbox/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f /Users/nick/Code/nanoclaw-docker-sandbox/logs/nanoclaw.log"
