#!/usr/bin/env bash
# Release smoke test helper (macOS + Linux): launch Lilo, wait for its local API, optionally take a
# screenshot of the X display, then stop it.
#   scripts/smoke-launch.sh <version> <screenshot.png|-> <command> [args...]
# The screenshot needs ImageMagick's `import` and a DISPLAY (run it under xvfb-run).
set -uo pipefail

version="$1"; shot="$2"; shift 2
here="$(cd "$(dirname "$0")" && pwd)"
log="${RUNNER_TEMP:-/tmp}/lilo-smoke.log"

set -m # job control: the app gets its own process group, so we can stop it and any children
"$@" >"$log" 2>&1 &
pid=$!

status=0
node "$here/smoke-health.mjs" --version "$version" --timeout 60 || status=$?

if [ "$status" -eq 0 ] && [ "$shot" != "-" ]; then
  sleep 3 # let the window paint
  import -window root "$shot" || echo "::warning::screenshot failed"
fi
if ! kill -0 "$pid" 2>/dev/null; then
  echo "::error::Lilo exited on its own"
  status=1
fi

kill -TERM -- "-$pid" 2>/dev/null || true
sleep 2
kill -KILL -- "-$pid" 2>/dev/null || true

if [ "$status" -ne 0 ]; then
  echo "---- Lilo output ----"
  cat "$log"
fi
exit "$status"
