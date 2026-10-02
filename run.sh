#!/usr/bin/env bash
# Run the whole prototype locally: API on :8787, frontend on :8000.
# Logs land in /tmp/opencode/. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p /tmp/opencode

python3 backend/api.py > /tmp/opencode/api.log 2>&1 &
API=$!
python3 -m http.server 8000 --directory web > /tmp/opencode/web.log 2>&1 &
WEB=$!
trap 'kill $API $WEB 2>/dev/null' EXIT

echo "API       http://localhost:8787   (log: /tmp/opencode/api.log)"
echo "Frontend  http://localhost:8000   (log: /tmp/opencode/web.log)"
echo "Ctrl-C stops both"
wait
