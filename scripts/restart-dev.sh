#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=4173

cd "$ROOT_DIR"

mapfile -t pids < <(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null || true)

if ((${#pids[@]} > 0)); then
  echo "Stopping listeners on port ${PORT}: ${pids[*]}"
  kill "${pids[@]}"

  sleep 1

  mapfile -t remaining < <(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null || true)
  if ((${#remaining[@]} > 0)); then
    echo "Force stopping remaining listeners on port ${PORT}: ${remaining[*]}"
    kill -9 "${remaining[@]}"
  fi
else
  echo "No listener found on port ${PORT}"
fi

echo "Starting dev server on port ${PORT}"
exec npm run dev
