// PM2 process config — run with `npm run pm2:start` (or `pm2 start ecosystem.config.js`)
//
// Single instance only: SQLite + the in-memory SSE client list assume one process.
// If you need horizontal scaling later, swap to PostgreSQL and a pub/sub bus first.
module.exports = {
  apps: [{
    name: 'sml-web',
    // path is relative to the cwd PM2 is launched from (repo root by default).
    script: 'backend/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: './logs/err.log',
    out_file:   './logs/out.log',
    merge_logs: true,
    time: true,
    max_memory_restart: '500M',
    kill_timeout: 10000,
    autorestart: true,
    watch: false,
  }],
};
