#!/bin/sh
set -eu
ROLE="${ROLE:-web}"
case "$ROLE" in
  web)       exec node server.js ;;
  worker)    exec node_modules/.bin/tsx src/entrypoints/worker.ts ;;
  scheduler) exec node_modules/.bin/tsx src/entrypoints/scheduler.ts ;;
  *)         echo "Unknown ROLE: $ROLE" >&2; exit 64 ;;
esac
