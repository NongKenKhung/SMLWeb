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
# First-run bootstrap: seed members when the DB has none. backend/seed.js is
# idempotent (skips when members already exist) so it's safe to run on every
# boot, and best-effort — a transient DB hiccup must NOT block server startup.
# A fresh `docker compose up` is therefore login-ready in one step: 7 members,
# PIN 1234 (change PINs after first login).
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/uploads /data
  chown -R app:app /app/uploads /data 2>/dev/null || true
  gosu app node /app/backend/seed.js || echo "[entrypoint] member seed skipped/failed (non-fatal)"
  exec gosu app "$@"
fi

# Already non-root (e.g. compose `user:` override) — seed (best-effort) then run.
node /app/backend/seed.js || echo "[entrypoint] member seed skipped/failed (non-fatal)"
exec "$@"
