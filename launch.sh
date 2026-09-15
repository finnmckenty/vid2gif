#!/bin/bash
# Starts the vid2gif dev server (if it is not already running) and opens it.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
PORT=5181
URL="http://localhost:$PORT/"

if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  [ -d node_modules ] || npm install >/dev/null 2>&1
  nohup npx vite --port $PORT --strictPort >/tmp/vid2gif.log 2>&1 &
  for _ in $(seq 1 40); do
    lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 0.25
  done
fi
open "$URL"
