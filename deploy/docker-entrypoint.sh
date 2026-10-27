#!/bin/sh
set -eu

# Railway mounts volumes as root. RAILWAY_RUN_UID=0 lets this entrypoint
# prepare the mount; the actual Next.js/FFmpeg process still runs as node.
# Ordinary Docker deployments continue to use USER node from the image.
if [ "$(id -u)" = "0" ]; then
  data_dir="${FOCUS_DATA_DIR:-/data}"
  mkdir -p "$data_dir"
  chown node:node "$data_dir"
  exec gosu node "$0" "$@"
fi

if [ "${FOCUS_PROVIDER_CONNECTIVITY_CHECK:-0}" = "1" ]; then
  node /usr/local/lib/focus/check-providers.mjs
fi
exec "$@"
