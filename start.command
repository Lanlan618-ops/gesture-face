#!/bin/zsh

cd "$(dirname "$0")" || exit 1

PORT=4173
while lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done
URL="http://127.0.0.1:${PORT}/"

echo ""
echo "  FACE / SIGNAL"
echo "  ─────────────────────────────"
echo "  Local URL: ${URL}"
echo "  Press Ctrl+C to stop the server."
echo ""

# MediaPipe needs a secure context. 127.0.0.1 and localhost both qualify.
open "${URL}" >/dev/null 2>&1 &
exec python3 -m http.server "${PORT}" --bind 127.0.0.1
