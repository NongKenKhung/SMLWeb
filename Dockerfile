# ===== Build stage — install deps (pure JS, no native compile needed) =====
FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && rm -rf /root/.npm

# ===== Runtime stage — slim, non-root, healthcheck-enabled =====
FROM node:20-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    TOKEN_FILE=/data/.tokens.json

# gosu — lets the entrypoint drop from root → app after fixing mount perms.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/*

# Non-root user. /data holds tokens (DB lives in postgres container);
# /app/uploads holds user-submitted files (mount as a host bind for backup).
RUN groupadd --system --gid 1001 app \
 && useradd  --system --uid 1001 --gid app --create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data /app/uploads /app/backend /app/frontend \
 && chown -R app:app /data /app

COPY --chown=app:app --from=deps /app/node_modules ./node_modules
# Repo is split into backend/ (server code) + frontend/ (static assets).
# Container preserves that layout so __dirname/.. paths in db.js / server.js
# resolve identically in Docker and on a developer's laptop.
COPY --chown=app:app backend  ./backend
COPY --chown=app:app frontend ./frontend

# Entrypoint fixes bind-mount ownership on Linux, then drops to `app`.
# sed strips any CRLF so the shebang works even if checked out on Windows.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh

# NOTE: container starts as ROOT so the entrypoint can chown the mounted
# /app/uploads + /data (host uid may differ on Linux). gosu then drops to `app`
# — the server itself never runs as root.
EXPOSE 3000

VOLUME ["/data", "/app/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/server.js"]
