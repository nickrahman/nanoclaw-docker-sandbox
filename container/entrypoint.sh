#!/bin/bash
set -e
cd /app

# Cache TypeScript compilation using source hash
CACHE_DIR=/home/node/.claude/dist-cache
SRC_HASH=$(find src -type f | sort | xargs cat | md5sum | awk '{print $1}')
CACHED_HASH=""
[ -f "$CACHE_DIR/.src_hash" ] && CACHED_HASH=$(cat "$CACHE_DIR/.src_hash")
if [ "$SRC_HASH" != "$CACHED_HASH" ]; then
  rm -rf "$CACHE_DIR"
  # Redirect tsc output to stderr so it doesn't pollute stdout (the agent
  # runner reads structured JSON from stdout; stray compiler lines would break
  # parsing). 2>&1 >&2 merges stdout onto stderr then redirects stdout there.
  npx tsc --outDir "$CACHE_DIR" 2>&1 >&2
  ln -sf /app/node_modules "$CACHE_DIR/node_modules"
  echo "$SRC_HASH" > "$CACHE_DIR/.src_hash"
fi
node "$CACHE_DIR/index.js"
