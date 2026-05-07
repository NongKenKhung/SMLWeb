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

# Non-root user. /data holds tokens (DB lives in postgres container);
# /app/uploads holds user-submitted files (mount as a host bind for backup).
RUN groupadd --system --gid 1001 app \
 && useradd  --system --uid 1001 --gid app --create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data /app/uploads \
 && chown -R app:app /data /app

COPY --chown=app:app --from=deps /app/node_modules ./node_modules
COPY --chown=app:app server.js auth.js db.js mailer.js ./
COPY --chown=app:app public ./public

USER app
EXPOSE 3000

VOLUME ["/data", "/app/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
