#!/bin/sh
set -e

# ── Cross-OS uploads/data permission fix ──────────────────────────────────
# On native Linux, bind-mounted dirs (./uploads → /app/uploads, and the /data
# volume) inherit the HOST uid/gid, which usually differs from the container's
# `app` user (uid 1001). The Node app then hits EACCES on
#   mkdir /app/uploads   /   write /app/uploads/_avatars/...
# Docker Desktop (Win/Mac) hides this because its VM remaps uids, so the error
# only appears when deploying on a real Linux host.
#
# Fix: the container starts as ROOT, we chown the mounted dirs to `app`, then
# drop privileges to `app` via gosu before exec'ing the server. Same image now
# works identically on Linux, macOS, and Windows.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/uploads /data
  chown -R app:app /app/uploads /data 2>/dev/null || true
  exec gosu app "$@"
fi

# Already non-root (e.g. compose `user:` override) — just run.
exec "$@"
