#!/usr/bin/env bash
# Starts a local static server for the Woodpecker Trainer and opens it in your
# browser. Requires either python3 or node/npx (one of which is on nearly every
# machine). Stop the server with Ctrl+C.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
URL="http://localhost:${PORT}"

open_browser() {
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"          # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" # Linux
  elif command -v start >/dev/null 2>&1; then start "$URL"       # Windows (Git Bash)
  else echo "Open $URL in your browser."; fi
}

echo "Serving Woodpecker Trainer at $URL  (Ctrl+C to stop)"
open_browser &

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  exec npx --yes http-server -p "$PORT" .
else
  echo "Need python3 or node/npx installed to serve the app." >&2
  exit 1
fi
