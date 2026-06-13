require('dotenv').config();
const { WebSocketServer } = require('ws');
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const multer = require('multer');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');

// Long-running HTTP fetch for ASR + Ollama. Node's built-in fetch (undici)
// enforces a 5-minute `headersTimeout` by default — but WhisperX transcribe
// of a 1-hour CPU clip takes ~9 minutes, so the fetch fails with a generic
// "fetch failed" before asr ever responds. The undici Agent isn't exposed
// as `require('undici')` in the Node 20 base image, so we use the plain
// `http` module directly with a long `setTimeout` instead — no new dep,
// minimal surface area. Returns a Response-like object so call sites stay
// the same shape as `fetch()`.
function slowFetch(urlStr, opts = {}, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          text:  () => Promise.resolve(body),
          json:  () => { try { return Promise.resolve(JSON.parse(body)); } catch (e) { return Promise.reject(e); } },
        });
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('socket timeout')));
    req.on('error', reject);
    // Wire up external AbortController if provided
    if (opts.signal) opts.signal.addEventListener('abort', () => req.destroy(new Error('aborted')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust the first proxy hop (nginx/Caddy/Cloudflare) so req.ip + req.secure work.
// Leave unset / set TRUST_PROXY=0 if running directly with no proxy.
const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv && trustProxyEnv !== '0' && trustProxyEnv !== 'false') {
  app.set('trust proxy', /^\d+$/.test(trustProxyEnv) ? +trustProxyEnv : trustProxyEnv);
}

// Health check — fast, no DB hit. Used by Docker / load balancer / k8s
app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Request log middleware — skip the noisy ones (healthz + SSE long-poll)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/healthz' || req.path === '/api/events' || req.path === '/api/dashboard/events') return;
    const ms = Date.now() - start;
    const ip = req.ip || req.connection?.remoteAddress || '-';
    // Redact bearer token / signature in query string so session tokens don't land in logs
    const safeUrl = req.originalUrl.replace(/([?&](?:token|sig)=)[^&]*/gi, '$1[REDACTED]');
    console.log(`${new Date().toISOString()} ${ip} ${req.method} ${safeUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

app.use(compression());

// CSP allows the externals this app actually uses (Tailwind CDN + Google Fonts).
// 'unsafe-inline' on script/style is required because the Tailwind CDN injects
// runtime <style> tags. Same-site CORP allows /avatars previews from the SPA.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      // helmet defaults script-src-attr to 'none' which blocks every onclick="…"
      // attribute even when scriptSrc allows 'unsafe-inline'. The /dev page (and
      // a couple of buttons in index.html) rely on inline handlers, so allow them.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      mediaSrc:   ["'self'", 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      objectSrc:  ["'none'"],
      // PDF + future Office previews load from blob: URLs created via
      // URL.createObjectURL() — explicitly allow blob: as a frame source so
      // newer Chromium versions don't block them under the defaultSrc fallback.
      frameSrc:   ["'self'", 'blob:'],
      frameAncestors: ["'self'"],
      baseUri:    ["'self'"],
      // Don't auto-upgrade HTTP→HTTPS. We deploy on plain HTTP behind LAN IPs
      // (e.g. 10.66.x.x:3000); upgrading breaks every asset load with
      // ERR_SSL_PROTOCOL_ERROR. Run behind nginx/Caddy if you need TLS.
      upgradeInsecureRequests: null,
    },
  },
  // File preview iframes/blobs need cross-origin permissive headers
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  // COOP only works on secure origins (HTTPS / localhost). Sending it on a
  // plain-HTTP LAN IP just causes browser warnings — turn it off.
  crossOriginOpenerPolicy: false,
  // Origin-Agent-Cluster gets sticky on the first request to the origin; if a
  // subsequent page disagrees the browser logs a warning. Disable it to keep
  // the origin consistently site-keyed.
  originAgentCluster: false,
}));

app.use(express.json({ limit: '1mb' }));

// ── Admin Dev/Test sandbox — /dev (clean URL, no .html extension) ─────────────
// The page itself contains a client-side auth guard that redirects non-admins.
// All API calls within the page enforce server-side auth independently.
// A ?token=xxx query param can be passed when navigating from the main app.
// Resolve the static frontend folder. The repo splits server code (backend/)
// from client assets (frontend/public/), so `__dirname` is `<repo>/backend`
// at runtime and we step up one level to reach the assets.
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend', 'public');

app.get('/dev', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'dev.html'));
});

// Public read-only dashboard — passcode-gated, no account. See /api/dashboard/*.
app.get('/dashboard', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});


// Static SPA assets — short cache so UI updates land quickly; HTML never cached.
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  lastModified: true,
  maxAge: isProd ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    // PWA assets — ensure correct content-types so the browser registers them
    if (filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); // SW must not cache itself
  },
}));

// Serve avatar uploads at /avatars/<filename>. Filenames include a random hex
// hash so the URL changes on re-upload → safe to cache aggressively.
const AVATARS_DIR = path.join(db.UPLOAD_DIR, '_avatars');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
app.use('/avatars', express.static(AVATARS_DIR, {
  etag: true,
  maxAge: isProd ? '7d' : 0,
  immutable: isProd,
}));

// Note on filename encoding: multer 2.1.x (via busboy 1.x) already returns
// `file.originalname` as a proper UTF-8 JavaScript string when the browser
// sends the filename in the Content-Disposition `filename*=UTF-8''…` form
// (which all modern browsers do). So we just pass it through — re-decoding
// via `Buffer.from(name, 'latin1').toString('utf8')` would CORRUPT Thai
// characters (each U+0Exx code point would lose its high byte).
//
// Per-request scratchpad: destination() runs first per file and stashes the
// resolved subfolder so filename() / the route handler can reuse it.
const upload = multer({
  storage: multer.diskStorage({
    // destination — promote the task to a subfolder when ≥ 2 files arrive.
    // Side-effect: existing flat file is moved into the subfolder atomically.
    destination: async (req, file, cb) => {
      try {
        const t = await db.getTask(req.params.id);
        if (!t) return cb(new Error('task not found'));
        const { dir, subfolder } = await db.destForTaskUpload(t);
        // Stash for the route handler — multer doesn't pass return values.
        // doc_type comes from the URL query (multer parses fields after files,
        // so a body-field would be undefined inside this callback).
        const docType = db.sanitiseDocType(req.query.doc_type);
        req._uploadCtx = { task: t, subfolder, docType };
        cb(null, dir);
      } catch (e) { cb(e); }
    },
    // filename — YYYYMMDD_<docType>_<sanitised task title>.<ext>;
    // body is the TASK NAME (not the user's local filename) so uploads stay
    // self-documenting in the file browser. Append a random hex suffix when
    // the same task uploads multiple files of the same docType.
    filename: (req, file, cb) => {
      const ctx = req._uploadCtx || {};
      const dir = ctx.subfolder
        ? path.join(db.uploadDir(ctx.task.group_id), ctx.subfolder)
        : db.uploadDir(ctx.task?.group_id);
      cb(null, db.buildFilename(file.originalname, ctx.docType, dir, ctx.task?.title));
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

// Audio recordings — stored on disk in UPLOAD_DIR/_audio/, metadata in DB.
// Each clip gets a random hex filename + extension so URLs are cache-safe and
// public listing of the directory exposes nothing meaningful.
const AUDIO_DIR = path.join(db.UPLOAD_DIR, '_audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Accepted audio extensions for the file-import path. WhisperX uses ffmpeg
// internally so anything ffmpeg can decode is fair game — keep this list
// generous and add a regex match to fileFilter for entries whose MIME doesn't
// start with `audio/` (some browsers/OSes guess wrong, e.g. .3gp → video/3gpp).
const AUDIO_EXTS = /\.(mp3|wav|wave|flac|aac|ogg|oga|opus|m4a|m4b|wma|webm|weba|aiff|aif|aifc|amr|ac3|au|3gp|3gpp|mka|mp2|mpa|mid|midi)$/i;

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AUDIO_DIR),
    filename: (req, file, cb) => {
      // 1) Prefer the original filename's extension when present (file imports
      //    keep the user's format hint exactly — important for ffmpeg/WhisperX).
      const orig = (file.originalname || '').toLowerCase();
      const extMatch = orig.match(/\.[a-z0-9]{1,5}$/);
      let ext = (extMatch && AUDIO_EXTS.test(orig)) ? extMatch[0] : '';
      // 2) Otherwise derive from MIME (recordings via MediaRecorder send raw blobs
      //    with `originalname='blob'`).
      if (!ext) {
        const m = (file.mimetype || '').toLowerCase();
        ext = m.includes('webm') ? '.webm'
            : m.includes('ogg')  ? '.ogg'
            : m.includes('flac') ? '.flac'
            : m.includes('opus') ? '.opus'
            : m.includes('aac')  ? '.aac'
            : m.includes('mp4')  ? '.m4a'
            : m.includes('wav')  ? '.wav'
            : (m.includes('mpeg') || m.includes('mp3')) ? '.mp3'
            : (m.includes('wma') || m.includes('x-ms-wma')) ? '.wma'
            : '.bin';
      }
      cb(null, crypto.randomBytes(10).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },  // 500 MB cap (raised for long meeting imports)
  fileFilter: (req, file, cb) => {
    // Accept anything with an audio MIME *or* a known audio extension —
    // browsers / OSes occasionally send `application/octet-stream` for legit
    // audio (.opus, .amr) and `video/3gpp` for audio-only 3gp.
    const isAudioMime = /^audio\//i.test(file.mimetype || '');
    const hasAudioExt = AUDIO_EXTS.test(file.originalname || '');
    if (!isAudioMime && !hasAudioExt) {
      return cb(new Error('รองรับเฉพาะไฟล์เสียง (mp3 / wav / flac / m4a / aac / ogg / opus / webm / wma / aiff / amr ฯลฯ)'));
    }
    cb(null, true);
  },
});

// Magic-byte verification — ตรวจ "เนื้อในไฟล์" vs MIME ที่ client ส่งมา.
// กันการ upload file ปลอม (เช่น `.exe` ที่ตั้งชื่อเป็น `.png` ส่งมาพร้อม
// Content-Type: image/png). ใช้ first-bytes check แทน ไม่ต้อง dep ใหม่.
function verifyImageMagicBytes(filePath, declaredMime) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    const hex = buf.toString('hex').toLowerCase();
    // PNG: 89504e470d0a1a0a
    if (declaredMime.includes('png')) return hex.startsWith('89504e470d0a1a0a');
    // JPEG: ffd8ff
    if (declaredMime.includes('jpeg') || declaredMime.includes('jpg')) return hex.startsWith('ffd8ff');
    // GIF: 474946383761 or 474946383961
    if (declaredMime.includes('gif')) return hex.startsWith('474946383761') || hex.startsWith('474946383961');
    // WEBP: 52494646 ... 57454250 (RIFF....WEBP)
    if (declaredMime.includes('webp')) return hex.startsWith('52494646') && buf.slice(8, 12).toString() === 'WEBP';
    return false;
  } catch { return false; }
}

// Avatar upload — separate multer config (different destination + size limits + image filter)
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATARS_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '.png').toLowerCase().slice(0, 8);
      // Filename based on user id + random hash so a fresh upload busts the browser cache
      cb(null, `${req.user.id}_${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  // 1.5 MB ceiling — client resizes to ≤ 256×256 WebP before upload (typically
  // < 100 KB). ลด attack surface (DoS via huge upload) + ประหยัด disk + เว็บ
  // โหลด People page เร็วขึ้น
  limits: { fileSize: 1.5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)) return cb(new Error('รองรับเฉพาะไฟล์รูปภาพ (PNG/JPG/GIF/WEBP)'));
    cb(null, true);
  },
});

// Auth middleware
app.use(async (req, res, next) => {
  const token = auth.extractToken(req);
  const memberId = auth.lookupToken(token);
  req.user = memberId ? await db.getMember(memberId) : null;
  req.token = token;
  next();
});

// SSE
const sseClients = new Set();
function broadcast(kind, payload = {}) {
  const data = JSON.stringify({ kind, ...payload, ts: Date.now() });
  for (const client of sseClients) { try { client.write(`data: ${data}\n\n`); } catch {} }
}
app.get('/api/events', (req, res) => {
  const tok = req.query.token;
  const memberId = auth.lookupToken(tok);
  if (!memberId) return res.status(401).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 5000\n\n: connected\n\n');
  sseClients.add(res);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});
app.use((req, res, next) => {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (/^\/api\/(events|login|logout)\b/.test(req.path)) return next();
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      broadcast('change', { path: req.path, method: req.method, by: req.user?.id || null });
    }
  });
  next();
});

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error(err.message || err);
      res.status(400).json({ error: err.message || 'Bad request' });
    }
  };
}
function requireAuth(req, res) {
  if (!req.user) { res.status(401).json({ error: 'login required' }); return false; }
  return true;
}
// 4-tier role: S < M < L < XL.  "Admin-or-above" = L หรือ XL (XL = สูงสุด, เดิม boss).
// S,M = สิทธิ์สมาชิกทั่วไป. แก้นิยามสิทธิ์ที่จุดเดียว ไม่ต้องไล่ทั้งระบบ.
function isAdminRole(role) {
  return role === 'L' || role === 'XL';
}
function hasAdminPerms(user) {
  return !!user && isAdminRole(user.role);
}
function requireAdmin(req, res) {
  if (!requireAuth(req, res)) return false;
  if (!hasAdminPerms(req.user)) { res.status(403).json({ error: 'admin only' }); return false; }
  return true;
}

// ===== Auth =====
// Login rate limit: failed attempts per IP. Successful logins don't count
// (so legit users with shared IPs aren't penalized).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: +(process.env.LOGIN_RATE_LIMIT || 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'พยายาม login บ่อยเกินไป — กรุณารอประมาณ 15 นาทีแล้วลองใหม่' },
});
app.use('/api/login', loginLimiter);

// Per-username lockout — defends against attackers rotating IPs to dodge the
// per-IP rate limit above. After 5 consecutive failed attempts on the same
// username, lock that account for 5 minutes. Resets on successful login.
const _loginFails = new Map();  // name(lowercase) → { count, lockedUntil }
const MAX_FAILS = 5;
const LOCK_MS   = 5 * 60 * 1000;
function _checkLock(name) {
  const k = String(name || '').trim().toLowerCase();
  const entry = _loginFails.get(k);
  if (entry && entry.lockedUntil > Date.now()) {
    const secs = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    return { locked: true, secs };
  }
  return { locked: false };
}
function _recordFail(name) {
  const k = String(name || '').trim().toLowerCase();
  const cur = _loginFails.get(k) || { count: 0, lockedUntil: 0 };
  cur.count += 1;
  if (cur.count >= MAX_FAILS) cur.lockedUntil = Date.now() + LOCK_MS;
  _loginFails.set(k, cur);
}
function _resetFail(name) { _loginFails.delete(String(name || '').trim().toLowerCase()); }

app.post('/api/login', wrap(async (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: 'name + password required' });
  const lock = _checkLock(name);
  if (lock.locked) return res.status(429).json({ error: `พยายามเข้าสู่ระบบบ่อยเกินไป — รอ ${lock.secs} วินาทีแล้วลองใหม่` });
  const m = await db.findMemberByName(String(name).trim());
  if (!m || !auth.verifyPassword(password, m.password_hash)) {
    _recordFail(name);
    return res.status(401).json({ error: 'invalid credentials' });
  }
  _resetFail(name);
  const token = auth.createToken(m.id);
  const { password_hash, ...pub } = m;
  res.json({ token, user: pub });
}));
app.post('/api/logout', wrap(async (req, res) => { if (req.token) auth.destroyToken(req.token); res.json({ ok: true }); }));
app.get('/api/me', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(req.user); }));
app.put('/api/me/password', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' });
  const full = await db.getMemberFull(req.user.id);
  if (!auth.verifyPassword(current_password || '', full.password_hash)) return res.status(401).json({ error: 'current password incorrect' });
  await db.setMemberPassword(req.user.id, auth.hashPassword(new_password));
  res.json({ ok: true });
}));

// Per-user email opt-in toggle — controls whether THIS user receives system emails
// (meeting invites / .ics). Default on; setting to false skips them in mailer.pickRecipients.
app.put('/api/me/email-pref', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const enabled = !!(req.body && req.body.enabled);
  const m = await db.setMemberEmailPref(req.user.id, enabled);
  res.json({ ok: true, email_opt_in: m ? m.email_opt_in : (enabled ? 1 : 0) });
}));

// Personal reminders (เตือนความจำ) — แต่ละคนเห็น/จัดการของตัวเองเท่านั้น
app.get('/api/reminders', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listReminders(req.user.id));
}));
app.post('/api/reminders', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { date, text } = req.body || {};
  if (!date) return res.status(400).json({ error: 'ต้องระบุวันที่' });
  if (!String(text || '').trim()) return res.status(400).json({ error: 'ต้องระบุข้อความ' });
  res.json(await db.createReminder({ member_id: req.user.id, date, text }));
}));
app.delete('/api/reminders/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  await db.deleteReminder(req.params.id, req.user.id);
  res.json({ ok: true });
}));

// Profile avatar upload (multipart). Replaces any existing avatar — old file is deleted on disk.
app.post('/api/me/avatar', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login required' });
  avatarUpload.single('avatar')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
    try {
      // Magic-byte verify — กัน upload .exe ที่ตั้งชื่อ .png
      if (!verifyImageMagicBytes(req.file.path, req.file.mimetype)) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: 'ไฟล์ไม่ใช่รูปภาพจริง (magic bytes ไม่ตรง)' });
      }
      // Delete previous avatar file (if any) so we don't accumulate stale uploads
      const prev = req.user.avatar_url;
      if (prev && prev.startsWith('/avatars/')) {
        const prevPath = path.join(AVATARS_DIR, path.basename(prev));
        try { if (fs.existsSync(prevPath)) fs.unlinkSync(prevPath); } catch {}
      }
      const url = '/avatars/' + req.file.filename;
      await db.setMemberAvatar(req.user.id, url);
      res.json({ avatar_url: url });
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch {}
      res.status(400).json({ error: e.message });
    }
  });
});
app.delete('/api/me/avatar', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const prev = req.user.avatar_url;
  if (prev && prev.startsWith('/avatars/')) {
    const prevPath = path.join(AVATARS_DIR, path.basename(prev));
    try { if (fs.existsSync(prevPath)) fs.unlinkSync(prevPath); } catch {}
  }
  await db.setMemberAvatar(req.user.id, '');
  res.json({ ok: true });
}));

// ===== Members =====
app.get('/api/members', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.listMembers()); }));
app.post('/api/members', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!req.body?.name || !String(req.body.name).trim()) return res.status(400).json({ error: 'name required' });
  const password_hash = auth.hashPassword(req.body.password || '1234');
  res.status(201).json(await db.createMember({ ...req.body, password_hash }));
}));
app.put('/api/members/:id', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  // เฉพาะ XL (สูงสุด) เท่านั้นที่ตั้ง/เลื่อนคนเป็น 'XL' ได้ — L ทั่วไปทำไม่ได้ (กัน privilege escalation)
  if (req.body && req.body.role === 'XL' && req.user.role !== 'XL') delete req.body.role;
  // ต้องเหลือผู้ดูแล (L/XL) อย่างน้อย 1 คน — ห้ามลดบทบาทคนสุดท้ายเป็น S/M
  if (req.body && req.body.role && !isAdminRole(req.body.role)) {
    const _cur = await db.getMember(req.params.id);
    if (_cur && hasAdminPerms(_cur) && (await db.countAdmins()) <= 1) {
      return res.status(400).json({ error: 'ต้องมีผู้ดูแล (L/XL) อย่างน้อย 1 คน — เปลี่ยนบทบาทคนสุดท้ายไม่ได้' });
    }
  }
  // Same min-length policy as the self-service /api/me/password — applies
  // when admin resets a user's PIN. Don't let admins set a weaker password
  // for a user than the user could set for themselves.
  if (req.body?.password && String(req.body.password).length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' });
  }
  const u = await db.updateMember(req.params.id, req.body || {});
  if (!u) return res.status(404).json({ error: 'not found' });
  if (req.body?.password) await db.setMemberPassword(req.params.id, auth.hashPassword(req.body.password));
  res.json(u);
}));
app.delete('/api/members/:id', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'cannot delete yourself' });
  // Capture snapshot ก่อนลบ ลง audit log
  const victim = await db.getMember(req.params.id);
  // ต้องเหลือผู้ดูแล (admin/boss) อย่างน้อย 1 คน — ห้ามลบคนสุดท้าย
  if (victim && hasAdminPerms(victim) && (await db.countAdmins()) <= 1) {
    return res.status(400).json({ error: 'ต้องมีผู้ดูแล (L/XL) อย่างน้อย 1 คนในระบบ' });
  }
  if (!(await db.deleteMember(req.params.id))) return res.status(404).json({ error: 'not found' });
  await db.logAudit({
    actor_id: req.user.id, actor_name: req.user.name,
    action: 'member.delete', target_kind: 'member', target_id: req.params.id,
    payload: { name: victim?.name, email: victim?.email },
    ip: req.ip,
  });
  res.json({ ok: true });
}));

// ===== Groups =====
app.get('/api/groups', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const groups = await db.listGroups();
  const myIds = new Set(await db.groupIdsForMember(req.user.id));
  res.json(groups.map(g => ({ ...g, am_member: myIds.has(g.id) })));
}));
app.post('/api/groups', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!req.body?.name || !String(req.body.name).trim()) return res.status(400).json({ error: 'name required' });
  const isAdmin = hasAdminPerms(req.user);

  // Resolve leader:
  //   - Admin sets explicit leader via dropdown → use that
  //   - Otherwise (admin didn't pick OR non-admin) → first selected member chip = leader
  //   - Final fallback → current user (creator)
  // member_ids comes in click order (sorted client-side) so [0] is the first-clicked.
  const memberIds = Array.isArray(req.body.member_ids) ? req.body.member_ids : [];
  let leader_id;
  if (isAdmin && req.body.leader_id) {
    leader_id = req.body.leader_id;
  } else if (memberIds.length > 0) {
    leader_id = memberIds[0];
  } else {
    leader_id = req.user.id;
  }

  const g = await db.createGroup({ ...req.body, leader_id });
  // Add the rest of the starting members directly (no invitation needed) — leader is
  // already added by createGroup. Skip the leader and duplicates.
  for (const mid of memberIds) {
    if (!mid || mid === leader_id) continue;
    try { await db.addGroupMember(g.id, mid); } catch {}
  }
  res.status(201).json(g);
}));
app.put('/api/groups/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const isAdmin = hasAdminPerms(req.user);
  const isLeader = await db.isGroupLeader(req.params.id, req.user.id);
  if (!isAdmin && !isLeader) return res.status(403).json({ error: 'admin or group leader only' });
  const patch = { ...(req.body || {}) };
  // Both admin and the current group leader can change leader_id (transfer leadership).
  // Other members (somehow getting through, shouldn't happen) can't.
  if (!isAdmin && !isLeader) delete patch.leader_id;
  const u = await db.updateGroup(req.params.id, patch);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json(u);
}));
app.delete('/api/groups/:id', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const victim = await db.getGroup(req.params.id);
  if (!(await db.deleteGroup(req.params.id))) return res.status(404).json({ error: 'not found' });
  await db.logAudit({
    actor_id: req.user.id, actor_name: req.user.name,
    action: 'group.delete', target_kind: 'group', target_id: req.params.id,
    payload: { name: victim?.name, leader_id: victim?.leader_id },
    ip: req.ip,
  });
  res.json({ ok: true });
}));
app.get('/api/groups/:id/files', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listFilesForGroup(req.params.id));
}));

// ── Group summary (markdown) ──
// GET → returns the persisted summary; if `?regenerate=1` the server rebuilds
// it from current tasks/files. POST always rebuilds + writes to disk too.
app.get('/api/groups/:id/summary', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const g = await db.getGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'group not found' });
  if (req.query.regenerate === '1' || !g.summary_md) {
    const md = await db.generateGroupSummary(g.id);
    const saved = await db.setGroupSummary(g.id, md);
    return res.json({ markdown: saved.summary_md, generated_at: saved.summary_at, regenerated: true });
  }
  res.json({ markdown: g.summary_md, generated_at: g.summary_at, regenerated: false });
}));
app.post('/api/groups/:id/summary/regenerate', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const g = await db.getGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'group not found' });
  // Anyone in the group OR admin OR the leader can regenerate
  const isAdmin = hasAdminPerms(req.user);
  const isLeader = g.leader_id === req.user.id;
  const isMember = await db.isGroupMember(g.id, req.user.id);
  if (!isAdmin && !isLeader && !isMember) return res.status(403).json({ error: 'group member required' });
  const md = await db.generateGroupSummary(g.id);
  const saved = await db.setGroupSummary(g.id, md);
  res.json({ markdown: saved.summary_md, generated_at: saved.summary_at });
}));

// ── Files browser (admin only) — read-only inventory of UPLOAD_DIR ──
// `?path=` is resolved relative to UPLOAD_DIR; we reject any traversal that
// escapes it (resolved path must be inside UPLOAD_DIR).
app.get('/api/files/browse', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rel = String(req.query.path || '').replace(/^\/+/, '');
  const abs = path.resolve(db.UPLOAD_DIR, rel);
  if (!abs.startsWith(path.resolve(db.UPLOAD_DIR))) return res.status(400).json({ error: 'path traversal blocked' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'not found' });
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return res.status(400).json({ error: 'not a directory' });
  const entries = fs.readdirSync(abs).map(name => {
    const full = path.join(abs, name);
    let s; try { s = fs.statSync(full); } catch { return null; }
    return {
      name,
      path: path.relative(db.UPLOAD_DIR, full).replace(/\\/g, '/'),
      type: s.isDirectory() ? 'dir' : 'file',
      size: s.size,
      modified: s.mtime.toISOString(),
    };
  }).filter(Boolean);
  // Folders first, then by name
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  res.json({
    path: rel,
    parent: rel ? path.dirname(rel).replace(/\\/g, '/') : null,
    entries,
  });
}));
app.get('/api/files/raw', wrap(async (req, res) => {
  // Browsers can't attach Authorization to <a href> requests, so accept the
  // admin's token via query string here (same trick used by /api/events).
  let user = req.user;
  if (!user && req.query.token) {
    const memberId = auth.lookupToken(req.query.token);
    if (memberId) user = await db.getMember(memberId);
  }
  if (!user) return res.status(401).json({ error: 'login required' });
  if (!hasAdminPerms(user)) return res.status(403).json({ error: 'admin only' });

  const rel = String(req.query.path || '').replace(/^\/+/, '');
  const abs = path.resolve(db.UPLOAD_DIR, rel);
  if (!abs.startsWith(path.resolve(db.UPLOAD_DIR))) return res.status(400).json({ error: 'path traversal blocked' });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return res.status(404).json({ error: 'file not found' });
  // ?download=1 forces save-as instead of inline preview
  const filename = path.basename(abs);
  if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.sendFile(abs);
}));

// ===== Tasks =====
app.get('/api/tasks', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.listTasks(req.query)); }));
// Recycle bin listing — MUST come before `/api/tasks/:id` so Express doesn't
// match `:id = 'trash'` first. Restore + purge use sub-paths so they're fine
// further down.
app.get('/api/tasks/trash', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const isAdmin = hasAdminPerms(req.user);
  const all = await db.listTrashedTasks();
  // Non-admin sees only their own trashed tasks (group leaders see their group's trash)
  if (isAdmin) return res.json(all);
  const myGroupIds = new Set();
  for (const t of all) {
    if (!t.group_id) continue;
    if (await db.isGroupLeader(t.group_id, req.user.id)) myGroupIds.add(t.group_id);
  }
  res.json(all.filter(t => myGroupIds.has(t.group_id)));
}));
app.get('/api/tasks/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
}));
app.post('/api/tasks', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!req.body?.title || !String(req.body.title).trim()) return res.status(400).json({ error: 'title required' });
  const isAdmin = hasAdminPerms(req.user);
  if (!isAdmin) {
    if (!req.body.group_id) return res.status(403).json({ error: 'non-admin must create tasks inside a group they lead' });
    if (!(await db.isGroupLeader(req.body.group_id, req.user.id))) return res.status(403).json({ error: 'you are not the leader of that group' });
  }
  const created = await db.createTask(req.body, { created_by: req.user.id });
  // Fire-and-forget meeting invitation for kind='meeting' (skipped silently if SMTP off)
  if (created.kind === 'meeting' && created.status !== 'cancelled') {
    mailer.sendInvite(created, req.user, 0).catch(e => console.error('[mailer] invite send error:', e.message));
  }
  res.status(201).json(created);
}));
app.put('/api/tasks/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  const isAssignee = t.assignees.some(a => a.id === req.user.id);
  if (!isAdmin && !isGroupLeader && !isAssignee) return res.status(403).json({ error: 'no permission' });
  let patch = req.body || {};
  if (!isAdmin && !isGroupLeader) {
    // Plain assignees can only update status (no task-level leader privileges)
    const allowed = {};
    if (patch.status !== undefined) allowed.status = patch.status;
    patch = allowed;
  }
  const updated = await db.updateTask(req.params.id, patch);

  // Meeting iMIP notifications:
  //   - cancelled flip → CANCEL to all current attendees
  //   - cancelled → uncancelled (resurrected) → fresh REQUEST to all
  //   - meaningful field change OR attendee change → REQUEST to current + CANCEL to removed
  if (t.kind === 'meeting' || updated.kind === 'meeting') {
    const becameCancelled = updated.status === 'cancelled' && t.status !== 'cancelled';
    const becameUncancelled = t.status === 'cancelled' && updated.status !== 'cancelled';
    const { added, removed } = mailer.attendeeDiff(t, updated);
    const fieldsChanged = mailer.meaningfulChange(t, updated);

    if (becameCancelled) {
      const seq = await db.bumpIcsSequence(updated.id);
      mailer.sendCancel(updated, req.user, seq).catch(e => console.error('[mailer] cancel error:', e.message));
    } else if (becameUncancelled) {
      const seq = await db.bumpIcsSequence(updated.id);
      mailer.sendInvite(updated, req.user, seq).catch(e => console.error('[mailer] reinvite error:', e.message));
    } else if (fieldsChanged || added.length > 0 || removed.length > 0) {
      const seq = await db.bumpIcsSequence(updated.id);
      // Send REQUEST to all current attendees (covers added + still-on-list)
      mailer.sendInvite(updated, req.user, seq).catch(e => console.error('[mailer] update-invite error:', e.message));
      // Send CANCEL only to removed attendees so they drop the event from their cal
      if (removed.length > 0) {
        mailer.sendCancel(updated, req.user, seq, removed).catch(e => console.error('[mailer] removed-cancel error:', e.message));
      }
    }
  }

  res.json(updated);
}));
app.delete('/api/tasks/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'admin or group leader only' });
  // ?permanent=1 → hard delete (only from trash). Default = soft delete (recycle bin).
  const permanent = req.query.permanent === '1';
  if (permanent) await db.purgeTask(req.params.id);
  else           await db.deleteTask(req.params.id);   // soft delete
  await db.logAudit({
    actor_id: req.user.id, actor_name: req.user.name,
    action: permanent ? 'task.purge' : 'task.delete',
    target_kind: 'task', target_id: req.params.id,
    payload: { title: t.title, kind: t.kind, group_id: t.group_id },
    ip: req.ip,
  });

  // Meeting deletion → CANCEL invitation to attendees so the event drops from their cal.
  // Sequence is bumped client-side (in-memory snapshot) since the row is gone.
  if (t.kind === 'meeting' && permanent) {
    const seq = (t.ics_sequence || 0) + 1;
    mailer.sendCancel(t, req.user, seq).catch(e => console.error('[mailer] delete-cancel error:', e.message));
  }
  res.json({ ok: true, permanent });
}));

// Recycle bin restore — GET listing is registered higher up (before /:id) to
// avoid route shadowing. Restore + purge use sub-paths so they stay here.
app.post('/api/tasks/:id/restore', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const all = await db.listTrashedTasks();
  const t = all.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not in trash' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'admin or group leader only' });
  await db.restoreTask(req.params.id);
  res.json({ ok: true });
}));

// ── Group trash (recycle bin for groups) ──
app.get('/api/groups/trash', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const all = await db.listTrashedGroups();
  const isAdmin = hasAdminPerms(req.user);
  if (isAdmin) return res.json(all);
  // Non-admin: see only groups they led
  res.json(all.filter(g => g.leader_id === req.user.id));
}));
app.post('/api/groups/:id/restore', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const all = await db.listTrashedGroups();
  const g = all.find(x => x.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'not in trash' });
  const isAdmin = hasAdminPerms(req.user);
  const isLeader = g.leader_id === req.user.id;
  if (!isAdmin && !isLeader) return res.status(403).json({ error: 'admin or group leader only' });
  await db.restoreGroup(req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/groups/:id/purge', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!hasAdminPerms(req.user)) return res.status(403).json({ error: 'admin only' });
  const ok = await db.purgeGroup(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not in trash' });
  res.json({ ok: true });
}));

// ── Task comments ──
app.get('/api/tasks/:id/comments', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'task not found' });
  res.json(await db.listTaskComments(req.params.id));
}));
// Mentions ของ user ปัจจุบัน — ใช้สำหรับ bell notification
// Query: comments ที่มี "@<myname>" ใน body (14 วันที่ผ่านมา) จากคนอื่น
app.get('/api/comments/mentions/me', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listMentionsForMember(req.user.id));
}));
app.post('/api/tasks/:id/comments', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'task not found' });
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'body required' });
  const id = 'cm_' + crypto.randomBytes(6).toString('hex');
  const c = await db.createComment({ id, task_id: req.params.id, member_id: req.user.id, body });
  res.json(c);
}));
app.put('/api/comments/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const c = await db.getComment(req.params.id);
  if (!c || c.deleted_at) return res.status(404).json({ error: 'not found' });
  if (c.member_id !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'owner or admin only' });
  }
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'body required' });
  res.json(await db.updateComment(req.params.id, body));
}));
app.delete('/api/comments/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const c = await db.getComment(req.params.id);
  if (!c || c.deleted_at) return res.status(404).json({ error: 'not found' });
  if (c.member_id !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'owner or admin only' });
  }
  await db.deleteComment(req.params.id);
  res.json({ ok: true });
}));

// Manually resend a meeting invitation (for any reason — fix typo, remind attendees, etc).
// Bumps SEQUENCE so existing calendar events are updated rather than duplicated.
app.post('/api/tasks/:id/send-invite', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (t.kind !== 'meeting') return res.status(400).json({ error: 'ใช้ได้เฉพาะการประชุม (kind=meeting) เท่านั้น' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  const isAssignee = t.assignees.some(a => a.id === req.user.id);
  if (!isAdmin && !isGroupLeader && !isAssignee) return res.status(403).json({ error: 'no permission' });

  if (!mailer.isEnabled()) return res.status(503).json({ error: 'SMTP ยังไม่ได้ตั้งค่า — เพิ่ม SMTP_HOST/USER/PASS ใน .env' });

  const seq = await db.bumpIcsSequence(t.id);
  const r = await mailer.sendInvite(t, req.user, seq);
  res.json({ ok: r.ok, sent: r.sent, sequence: seq });
}));

// Self-claim: only admin OR group leader (of this task's group) can self-add directly.
// Plain members must use /propose.
app.post('/api/tasks/:id/claim', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) {
    return res.status(403).json({ error: 'members cannot self-claim — use /propose instead' });
  }
  res.json(await db.claimTask(req.params.id, req.user.id, { claimedSelf: true }));
}));
app.post('/api/tasks/:id/drop', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.dropTask(req.params.id, req.user.id));
}));

// Direct add of another member to a sub-task: admin OR group leader.
// Non-admin: target must already be a member of the group (invite to group first).
app.post('/api/tasks/:id/assignees', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'admin or group leader only' });
  const { member_id, role } = req.body || {};
  if (!member_id) return res.status(400).json({ error: 'member_id required' });
  if (!isAdmin && t.group_id) {
    if (!(await db.isGroupMember(t.group_id, member_id))) {
      return res.status(400).json({ error: 'member is not in this group — invite to group first' });
    }
  }
  res.json(await db.claimTask(req.params.id, member_id, { asMember: role !== 'leader' }));
}));

// ===== Group claim / invite / propose =====
app.post('/api/groups/:id/claim', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.claimGroup(req.params.id, req.user.id));
}));

// Group leader / admin invites a member to JOIN the group
app.post('/api/groups/:id/invite', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const isAdmin = hasAdminPerms(req.user);
  const isLeader = await db.isGroupLeader(req.params.id, req.user.id);
  if (!isAdmin && !isLeader) return res.status(403).json({ error: 'admin or group leader only' });
  const { member_id, message } = req.body || {};
  if (!member_id) return res.status(400).json({ error: 'member_id required' });
  res.status(201).json(await db.createGroupInvitation({
    group_id: req.params.id, member_id, invited_by: req.user.id, kind: 'invite', message,
  }));
}));

// Direct add — group leader / admin can add a member without an invitation flow.
// (Replaces the old "invite + accept" loop for the simple case.)
app.post('/api/groups/:id/add-member', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const isAdmin = hasAdminPerms(req.user);
  const isLeader = await db.isGroupLeader(req.params.id, req.user.id);
  if (!isAdmin && !isLeader) return res.status(403).json({ error: 'admin or group leader only' });
  const { member_id } = req.body || {};
  if (!member_id) return res.status(400).json({ error: 'member_id required' });
  if (!(await db.getMember(member_id))) return res.status(400).json({ error: 'member not found' });
  await db.addGroupMember(req.params.id, member_id);
  res.json({ ok: true });
}));

// Member proposes themselves to JOIN a group
app.post('/api/groups/:id/propose', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.status(201).json(await db.createGroupInvitation({
    group_id: req.params.id, member_id: req.user.id, invited_by: req.user.id, kind: 'proposal',
    message: req.body?.message,
  }));
}));

// List group invitations relevant to current user
app.get('/api/group-invitations', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const all = await db.listAllGroupInvitations();
  const me = req.user.id;
  const filtered = all.filter(i =>
    i.member_id === me ||
    i.invited_by === me ||
    i.group_leader_id === me ||
    hasAdminPerms(req.user)
  );
  res.json(filtered);
}));

// Decide on a group invitation/proposal
app.post('/api/group-invitations/:id/decide', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const inv = await db.getGroupInvitation(req.params.id);
  if (!inv) return res.status(404).json({ error: 'not found' });
  const decision = req.body?.decision;
  if (!['accepted','rejected'].includes(decision)) return res.status(400).json({ error: 'invalid decision' });
  const me = req.user.id;
  const isAdmin = hasAdminPerms(req.user);
  let allowed = false;
  if (inv.kind === 'invite') {
    allowed = (inv.member_id === me) || isAdmin;
  } else { // proposal — group leader decides
    const isLeader = await db.isGroupLeader(inv.group_id, me);
    allowed = isAdmin || isLeader;
  }
  if (!allowed) return res.status(403).json({ error: 'not allowed' });
  res.json(await db.decideGroupInvitation(req.params.id, decision, me));
}));

// List group members
app.get('/api/groups/:id/members', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listGroupMembers(req.params.id));
}));

// Remove member from group (admin, group leader, or self)
app.delete('/api/groups/:id/members/:memberId', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const isAdmin = hasAdminPerms(req.user);
  const isLeader = await db.isGroupLeader(req.params.id, req.user.id);
  const isSelf = req.params.memberId === req.user.id;
  if (!isAdmin && !isLeader && !isSelf) return res.status(403).json({ error: 'no permission' });
  await db.removeGroupMember(req.params.id, req.params.memberId);
  res.json({ ok: true });
}));
app.delete('/api/tasks/:id/assignees/:memberId', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const me = req.user.id;
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, me));
  const isSelf = req.params.memberId === me;
  if (!isAdmin && !isGroupLeader && !isSelf) return res.status(403).json({ error: 'no permission' });
  res.json(await db.dropTask(req.params.id, req.params.memberId));
}));
// (Removed) /assignees/:memberId/role — task-level leader concept no longer exists

// Phase-aware single-assignee point setter.
// Permissions vary by phase:
//   proposing      → only the assignee themselves (their own row)
//   leader_review  → group leader (or admin)
//   final_review   → group leader OR admin
//   confirmed/none → blocked (must reopen first)
app.put('/api/tasks/:id/assignees/:memberId/points', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const pts = +(req.body?.points_share);
  if (!Number.isFinite(pts) || pts < 0) return res.status(400).json({ error: 'points_share must be >= 0' });

  const me = req.user.id;
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, me));
  const isSelfRow = req.params.memberId === me;

  if (t.points_phase === 'proposing') {
    if (!isSelfRow) return res.status(403).json({ error: 'ขั้นตอนนี้ผู้รับผิดชอบกำหนด Point ของตนเองเท่านั้น' });
    res.json(await db.proposeOwnPoints(req.params.id, req.params.memberId, pts));
    return;
  }
  if (t.points_phase === 'leader_review' || t.points_phase === 'final_review') {
    if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'หัวหน้ากลุ่มหรือ Admin เท่านั้น' });
    res.json(await db.setAssigneePointsShare(req.params.id, req.params.memberId, pts));
    return;
  }
  return res.status(400).json({ error: 'งานนี้ไม่อยู่ในขั้นตอนแก้ไข Point (สถานะปัจจุบัน: ' + t.points_phase + ')' });
}));

// Bulk allocation (used in leader_review / final_review screens)
app.put('/api/tasks/:id/points-allocation', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'admin or group leader only' });
  const allocations = req.body?.allocations || {};
  res.json(await db.bulkSetShares(req.params.id, allocations));
}));

// Stage 1: assignee proposes their OWN points share.
app.post('/api/tasks/:id/points/propose-own', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const pts = +(req.body?.points_share);
  if (!Number.isFinite(pts) || pts < 0) return res.status(400).json({ error: 'points_share must be >= 0' });
  if (!t.assignees.some(a => a.id === req.user.id)) {
    return res.status(403).json({ error: 'คุณไม่ได้รับผิดชอบงานนี้' });
  }
  res.json(await db.proposeOwnPoints(req.params.id, req.user.id, pts));
}));

// Stage 2: group leader approves → final_review
app.post('/api/tasks/:id/points/leader-approve', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'หัวหน้ากลุ่มหรือ Admin เท่านั้น' });
  res.json(await db.leaderApprovePoints(req.params.id));
}));

// Stage 3: confirm at weekly meeting (leader OR admin)
app.post('/api/tasks/:id/points/confirm', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'หัวหน้ากลุ่มหรือ Admin เท่านั้น' });
  res.json(await db.confirmPoints(req.params.id));
}));

// Reopen a confirmed task back to final_review
app.post('/api/tasks/:id/points/reopen', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'หัวหน้ากลุ่มหรือ Admin เท่านั้น' });
  res.json(await db.reopenPoints(req.params.id));
}));

// URL submissions
app.post('/api/tasks/:id/submissions/url', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAssignee = t.assignees.some(a => a.id === req.user.id);
  if (!isAssignee) return res.status(403).json({ error: 'must be assignee to submit work' });
  const { url, label } = req.body || {};
  if (!url || !/^https?:\/\//i.test(String(url))) return res.status(400).json({ error: 'url must start with http:// or https://' });
  const rec = await db.recordUrl({ task_id: t.id, group_id: t.group_id, uploaded_by: req.user.id, url: String(url), label: label ? String(label) : null });
  let auto_completed = false;
  if (t.status !== 'completed' && t.status !== 'cancelled') {
    await db.updateTask(t.id, { status: 'completed' });
    auto_completed = true;
  }
  res.status(201).json({ submission: rec, auto_completed });
}));

// CSV export
app.get('/api/groups/:id/export.csv', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const g = await db.getGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'not found' });
  const tasks = await db.listTasks({ group: g.id });
  const csv = await buildCsv(tasks, g);
  // HTTP headers ห้ามมี non-ASCII (เช่น ตัวอักษรไทย) — ใช้ RFC 5987 syntax: filename* รองรับ UTF-8
  //   filename="ASCII fallback"  ← browser เก่า
  //   filename*=UTF-8''url-encoded  ← browser modern ใช้ตัวนี้ → ได้ชื่อภาษาไทยถูกต้อง
  const datePart = new Date().toISOString().slice(0,10);
  const utf8Name = csvSafeFilename(g.name) + '_' + datePart + '.csv';
  const asciiName = utf8Name.replace(/[^\x20-\x7E]+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`);
  res.send('﻿' + csv);
}));
// Strip characters ที่ filename ห้ามใช้ (\/?<>:"|*) — เก็บไทย/อังกฤษ/ตัวเลข/อักขระทั่วไป
function csvSafeFilename(s) { return String(s||'export').replace(/[\\/:*?"<>|\n\r]+/g, '_').slice(0,80); }
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/["\n,]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
async function buildCsv(tasks, group) {
  const header = ['#','Title','Status','Target','Points (Budget)','Earned','Start','Deadline','Completed At','Assignees','Files','URLs'];
  const lines = [header.map(csvEscape).join(',')];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const subs = await db.listFilesForTask(t.id);
    const files = subs.filter(s => s.kind !== 'url');
    const urls  = subs.filter(s => s.kind === 'url');
    const earned = t.status === 'completed' ? t.points : 0;
    const assignees = (t.assignees||[]).map(a => `${a.name}(${a.points_share||0}pts)`).join('; ');
    // target is now group-level — already populated by attachAssignees, but use group.target as canonical
    lines.push([
      i+1, t.title, t.status, group.target||'', t.points||0, earned,
      t.start_date||'', t.deadline||'', t.completed_at||'', assignees,
      files.length, urls.length,
    ].map(csvEscape).join(','));
  }
  return lines.join('\n');
}

// ===== Files =====
app.get('/api/files', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.listAllFiles()); }));
app.get('/api/tasks/:id/files', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.listFilesForTask(req.params.id)); }));

// Document categories that the upload UI offers in its dropdown. Centralised
// here so the client doesn't have to know the list — change DOC_TYPES in
// db.js and every upload form picks up the new options.
app.get('/api/doc-types', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(db.DOC_TYPES);
}));

app.post('/api/tasks/:id/files', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login required' });
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAssignee = t.assignees.some(a => a.id === req.user.id);
  if (!isAssignee) return res.status(403).json({ error: 'must be assignee to submit work' });
  upload.array('files', 10)(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const recorded = [];
      for (const f of (req.files || [])) {
        recorded.push(await db.recordFile({
          task_id: t.id, group_id: t.group_id, uploaded_by: req.user.id,
          filename: f.filename, original_name: f.originalname, mimetype: f.mimetype, size: f.size,
          subfolder: req._uploadCtx?.subfolder || '',
          doc_type:  req._uploadCtx?.docType || 'อื่นๆ',
        }));
      }
      let auto_completed = false;
      if (recorded.length > 0 && t.status !== 'completed' && t.status !== 'cancelled') {
        await db.updateTask(t.id, { status: 'completed' });
        auto_completed = true;
      }
      res.status(201).json({ files: recorded, auto_completed });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
});

app.get('/api/files/:id/download', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const f = await db.getFile(req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  if (f.kind === 'url') return res.redirect(f.url);
  const fp = db.filePath(f);                       // honours subfolder column
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'file missing on disk' });
  res.download(fp, f.original_name);
}));

app.delete('/api/files/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const f = await db.getFile(req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  if (!hasAdminPerms(req.user) && f.uploaded_by !== req.user.id) return res.status(403).json({ error: 'no permission' });
  await db.deleteFile(req.params.id);
  res.json({ ok: true });
}));

// ===== Connections =====
app.get('/api/connections', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.listConnections()); }));
app.post('/api/connections', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!hasAdminPerms(req.user) && req.body?.member_id !== req.user.id) return res.status(403).json({ error: 'can only add connections for yourself' });
  res.status(201).json(await db.createConnection(req.body || {}));
}));
app.put('/api/connections/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const c = await db.getConnection(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  if (!hasAdminPerms(req.user) && c.member_id !== req.user.id) return res.status(403).json({ error: 'no permission' });
  res.json(await db.updateConnection(req.params.id, req.body || {}));
}));
app.delete('/api/connections/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const c = await db.getConnection(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  if (!hasAdminPerms(req.user) && c.member_id !== req.user.id) return res.status(403).json({ error: 'no permission' });
  await db.deleteConnection(req.params.id);
  res.json({ ok: true });
}));

// ===== Deadline ext =====
app.post('/api/tasks/:id/deadline-request', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'admin or group leader only' });
  const { requested_deadline, reason } = req.body || {};
  if (!requested_deadline) return res.status(400).json({ error: 'requested_deadline required' });
  res.status(201).json(await db.requestDeadline({ task_id: t.id, requested_by: req.user.id, requested_deadline, reason }));
}));
app.get('/api/deadline-requests', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.listDeadlineRequests()); }));

// Point increase requests
app.post('/api/tasks/:id/points-request', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasAdminPerms(req.user);
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'admin or group leader only' });
  const { requested_points, reason } = req.body || {};
  if (requested_points === undefined) return res.status(400).json({ error: 'requested_points required' });
  res.status(201).json(await db.requestPoints({
    task_id: t.id, requested_by: req.user.id, requested_points, reason,
  }));
}));
app.get('/api/point-requests', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.listPointRequests()); }));
app.post('/api/point-requests/:id/decide', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
  res.json(await db.decidePoints(req.params.id, status, req.user.id));
}));
app.post('/api/deadline-requests/:id/decide', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
  res.json(await db.decideDeadline(req.params.id, status, req.user.id));
}));

app.get('/api/stats', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.getStats()); }));

// Point ledger (admin-only sandbox preview). Returns one row per
// member-task-share contribution so an admin can see EXACTLY where each
// member's points came from + when they were earned. Read-only — no DB writes.
app.get('/api/point-ledger', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const memberId = req.query.member_id ? +req.query.member_id : null;
  const includeUnconfirmed = req.query.all === '1' || req.query.include_unconfirmed === '1';
  const rows = await db.getPointLedger({ memberId, includeUnconfirmed });
  res.json({ rows, count: rows.length, total: rows.reduce((s, r) => s + (r.points || 0), 0) });
}));

// ── Polls ──
// Anyone logged-in can create or vote. Owner OR admin can close/delete.
// Anonymous polls strip member_id from the per-vote map in responses.
app.get('/api/polls', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listPolls({ includeClosed: true }));
}));
app.get('/api/polls/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const p = await db.getPoll(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (p.anonymous) p.votes_by_member = {}; // hide identities
  res.json(p);
}));
app.post('/api/polls', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { question, options, multi_choice, anonymous, group_id, expires_at } = req.body || {};
  if (!question || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'question + at least 2 options required' });
  }
  const id = 'pl_' + crypto.randomBytes(6).toString('hex');
  const p = await db.createPoll({
    id, question, options, multi_choice, anonymous,
    created_by: req.user.id, group_id, expires_at,
  });
  res.json(p);
}));
app.post('/api/polls/:id/vote', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const p = await db.getPoll(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (p.closed) return res.status(400).json({ error: 'poll is closed' });
  if (p.expires_at && new Date(p.expires_at) < new Date()) return res.status(400).json({ error: 'poll expired' });
  let idx = Array.isArray(req.body?.option_indices) ? req.body.option_indices :
              Number.isFinite(+req.body?.option_index) ? [+req.body.option_index] : [];
  // กรอง index ให้อยู่ในช่วงตัวเลือกจริงเท่านั้น (กันค่าเกิน/ติดลบ ที่ทำให้ผลโหวตเพี้ยน)
  const _optCount = Array.isArray(p.options) ? p.options.length : 0;
  idx = [...new Set(idx.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < _optCount))];
  if (!p.multi_choice && idx.length > 1) return res.status(400).json({ error: 'single choice only' });
  const updated = await db.votePoll(req.params.id, req.user.id, idx);
  if (updated.anonymous) updated.votes_by_member = {};
  res.json(updated);
}));
app.post('/api/polls/:id/close', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const p = await db.getPoll(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (p.created_by !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'creator or admin only' });
  }
  await db.closePoll(req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/polls/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const p = await db.getPoll(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (p.created_by !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'creator or admin only' });
  }
  await db.deletePoll(req.params.id);
  res.json({ ok: true });
}));

// Auto-purge old trashed tasks once a day (default: 30 days).
const TRASH_PURGE_DAYS = +(process.env.TRASH_PURGE_DAYS || 30);
let _trashPurgeRunning = false;
setInterval(async () => {
  if (_trashPurgeRunning) return;  // กัน concurrency ถ้า purge ก่อนหน้ายังไม่จบ
  _trashPurgeRunning = true;
  try {
    const n = await db.purgeOldTrash(TRASH_PURGE_DAYS);
    if (n > 0) console.log(`[trash] purged ${n} task(s) older than ${TRASH_PURGE_DAYS} days`);
  } catch (e) { console.warn('[trash] purge failed:', e.message); }
  finally { _trashPurgeRunning = false; }
}, 24 * 3600_000).unref();

// ── ASR / Ollama retry worker ──
// Scan recordings ที่อยู่ใน state 'error' (transcribe หรือ summarise) ทุก 5
// นาที — ลองใหม่อัตโนมัติด้วย exponential backoff. แทนที่ user ต้องกด 🔄 เอง
// เมื่อ Ollama เพิ่ง warm up / ASR เพิ่ง restart / network blip ระหว่าง pipeline
const RETRY_MAX_ATTEMPTS = 4;       // 1 ครั้งแรก + retry 3 ครั้ง
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];  // 1m, 5m, 30m
const _retryAttempts = new Map();   // id → { count, nextAt }
function _shouldRetry(id) {
  const e = _retryAttempts.get(id);
  if (!e) return true;
  if (e.count >= RETRY_MAX_ATTEMPTS) return false;
  return Date.now() >= e.nextAt;
}
function _markRetry(id) {
  const e = _retryAttempts.get(id) || { count: 0, nextAt: 0 };
  e.count += 1;
  e.nextAt = Date.now() + (RETRY_BACKOFF_MS[Math.min(e.count - 1, RETRY_BACKOFF_MS.length - 1)] || 30 * 60_000);
  _retryAttempts.set(id, e);
}
function _resetRetry(id) { _retryAttempts.delete(id); }

// Retry worker — เริ่มเฉพาะถ้า ASR/Ollama service ถูก enable. ปิดปัจจุบัน
// เพราะ ASR_URL ว่าง = ASR ปิดอยู่ → retry ไม่มีอะไรให้ทำ + console spam
let _retryRunning = false;
if (process.env.ASR_URL) {
  setInterval(async () => {
    if (_retryRunning) return;
    _retryRunning = true;
    try {
      const errored = await db.listErroredRecordings(20).catch(() => []);
      for (const rec of errored) {
        if (!_shouldRetry(rec.id)) continue;
        _markRetry(rec.id);
        if (rec.transcript_status === 'error') {
          console.log(`[retry] transcribe ${rec.id} (attempt ${_retryAttempts.get(rec.id).count})`);
          transcribeRecording(rec.id).then(() => _resetRetry(rec.id)).catch(() => {});
        } else if (rec.summary_status === 'error') {
          console.log(`[retry] summarise ${rec.id} (attempt ${_retryAttempts.get(rec.id).count})`);
          summariseRecording(rec.id).then(() => _resetRetry(rec.id)).catch(() => {});
        }
      }
    } catch (e) { console.warn('[retry] worker failed:', e.message); }
    finally { _retryRunning = false; }
  }, 5 * 60 * 1000).unref();
} else {
  console.log('[asr] disabled (ASR_URL empty) — retry worker NOT started');
}

// ── Recordings (audio) ──
// Authenticated user can record + manage their own clips. Admin sees and can
// delete any. Files live on disk; metadata in DB. Streaming endpoint supports
// HTTP Range so the browser <audio> element can scrub without downloading
// the whole file first.
app.get('/api/recordings', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const all = req.query.all === '1' && hasAdminPerms(req.user);
  const rows = await db.listRecordings({ memberId: req.user.id, all });
  res.json(rows);
}));

app.post('/api/recordings', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login required' });
  audioUpload.single('audio')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'audio file required' });
    try {
      const id = 'rec_' + crypto.randomBytes(8).toString('hex');
      // Default label uses dd/mm/yyyy HH:MM (matches the SPA's display format)
      const _d = new Date();
      const _stamp = `${String(_d.getDate()).padStart(2,'0')}/${String(_d.getMonth()+1).padStart(2,'0')}/${_d.getFullYear()} ${String(_d.getHours()).padStart(2,'0')}:${String(_d.getMinutes()).padStart(2,'0')}`;
      const label = (req.body.label || '').toString().slice(0, 200) || `Recording ${_stamp}`;
      const duration_ms = +req.body.duration_ms || 0;
      const rec = await db.createRecording({
        id,
        filename: req.file.filename,
        label,
        mime: req.file.mimetype,
        size_bytes: req.file.size,
        duration_ms,
        member_id: req.user.id,
      });
      broadcast('change', { path: '/api/recordings', method: 'POST', by: req.user.id });
      // Fire-and-forget transcription so the user gets the upload response
      // immediately. The client will see status flip from 'pending' → 'processing'
      // → 'done' via the SSE 'change' broadcast on each step.
      transcribeRecording(rec.id).catch(e => console.warn('[asr] background error:', e.message));
      res.json(rec);
    } catch (e) {
      try { fs.unlinkSync(path.join(AUDIO_DIR, req.file.filename)); } catch {}
      res.status(500).json({ error: e.message || 'save failed' });
    }
  });
});

// Manual retry — useful if the ASR container was down at upload time.
app.post('/api/recordings/:id/transcribe', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const rec = await db.getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'recording not found' });
  if (rec.member_id !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'admin or owner only' });
  }
  transcribeRecording(rec.id).catch(e => console.warn('[asr] retry error:', e.message));
  res.json({ ok: true, queued: true });
}));

// Manual AI summary retry (re-run on existing transcript).
app.post('/api/recordings/:id/summarise', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const rec = await db.getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'recording not found' });
  if (rec.member_id !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'admin or owner only' });
  }
  if (!rec.transcript) return res.status(400).json({ error: 'no transcript yet — run transcribe first' });
  summariseRecording(rec.id).catch(e => console.warn('[ai] retry error:', e.message));
  res.json({ ok: true, queued: true });
}));

// ASR worker: POST to the asr microservice with the filename, then save the
// transcript back to the recording row. Steps: pending → processing → done/error.
async function transcribeRecording(id) {
  const ASR_URL = process.env.ASR_URL;
  if (!ASR_URL) {
    // ASR disabled — mark explicitly so UI shows "— ปิด AI" แทน pending ค้าง
    try {
      await db.updateRecording(id, { transcript_status: 'skipped', summary_status: 'skipped' });
    } catch {}
    return;
  }

  const rec = await db.getRecording(id);
  if (!rec) return;
  await db.updateRecording(id, { transcript_status: 'processing', transcript_error: '' });
  broadcast('change', { path: '/api/recordings', method: 'PATCH', by: rec.member_id });

  try {
    // 15-minute ceiling — long clips on slow CPUs + dynaudnorm + alignment can
    // legitimately run that long. slowFetch's internal socket timeout will
    // fire at the same limit; AbortController stays as a safety net so a
    // hung connection doesn't keep the row "processing" forever.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15 * 60 * 1000);
    const r = await slowFetch(`${ASR_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: rec.filename }),
      signal: ctrl.signal,
    }, 15 * 60 * 1000).finally(() => clearTimeout(timer));

    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `asr returned ${r.status}`);
    }
    const data = await r.json();
    await db.updateRecording(id, {
      transcript: data.text || '',
      transcript_status: 'done',
      transcript_error: '',
      transcribed_at: new Date().toISOString(),
    });
    broadcast('change', { path: '/api/recordings', method: 'PATCH', by: rec.member_id });
    console.log(`[asr] transcribed ${id} in ${data.timings?.total_sec || '?'}s`);
    // Kick off summary in the background — don't block the response. Skips
    // cleanly if OLLAMA_URL isn't set or the transcript is empty.
    summariseRecording(id).catch(e => console.warn('[ai] auto-summary error:', e.message));
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'timeout (>6 min)' : (e.message || String(e));
    await db.updateRecording(id, { transcript_status: 'error', transcript_error: msg.slice(0, 500) });
    broadcast('change', { path: '/api/recordings', method: 'PATCH', by: rec.member_id });
    console.warn(`[asr] ${id} failed: ${msg}`);
  }
}

// AI summary: posts the transcript to the ASR service's /summarise endpoint
// (which forwards to Ollama). Status flow mirrors transcript_status:
//   pending → processing → done | error | skipped
async function summariseRecording(id) {
  const ASR_URL = process.env.ASR_URL;
  if (!ASR_URL) return;

  const rec = await db.getRecording(id);
  if (!rec || !rec.transcript) return;

  await db.updateRecording(id, { summary_status: 'processing', summary_error: '' });
  broadcast('change', { path: '/api/recordings', method: 'PATCH', by: rec.member_id });

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5 * 60 * 1000);
    const r = await slowFetch(`${ASR_URL}/summarise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: rec.transcript, language: 'th' }),
      signal: ctrl.signal,
    }, 10 * 60 * 1000).finally(() => clearTimeout(timer));

    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      // 500 with message containing "OLLAMA_URL not configured" → mark skipped
      if ((body.error || '').includes('not configured')) {
        await db.updateRecording(id, { summary_status: 'skipped' });
        return;
      }
      throw new Error(body.error || `summariser returned ${r.status}`);
    }
    const data = await r.json();
    await db.updateRecording(id, {
      summary: data.summary || '',
      action_items: JSON.stringify(data.action_items || []),
      summary_status: 'done',
      summary_error: '',
    });
    broadcast('change', { path: '/api/recordings', method: 'PATCH', by: rec.member_id });
    console.log(`[ai] summarised ${id}`);
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'timeout (>5 min)' : (e.message || String(e));
    await db.updateRecording(id, { summary_status: 'error', summary_error: msg.slice(0, 500) });
    broadcast('change', { path: '/api/recordings', method: 'PATCH', by: rec.member_id });
    console.warn(`[ai] ${id} failed: ${msg}`);
  }
}

// ── Signed URL helpers (short-lived URLs ที่ <audio src=> หรือ <img src=>
// ใช้ได้โดยไม่ต้องโผล่ token ใน URL log/history) ──
// secret = ENV (UPLOAD_SIGN_SECRET) หรือ random ที่สร้างใหม่ทุก process start.
// ถ้า random — signed URL จะ invalidate ทันทีหลัง restart (ปลอดภัย แต่
// user ต้อง refresh page หลัง restart เพื่อให้ frontend ขอ signed URL ใหม่)
const SIGN_SECRET = process.env.UPLOAD_SIGN_SECRET || crypto.randomBytes(32).toString('hex');
function signUrl(scope, id, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${scope}:${id}:${exp}`;
  const sig = crypto.createHmac('sha256', SIGN_SECRET).update(payload).digest('base64url').slice(0, 24);
  return { sig, exp };
}
function verifySignature(scope, id, sig, exp) {
  if (!sig || !exp) return false;
  if (Math.floor(Date.now() / 1000) > +exp) return false;
  const payload = `${scope}:${id}:${exp}`;
  const expected = crypto.createHmac('sha256', SIGN_SECRET).update(payload).digest('base64url').slice(0, 24);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

// ─── Public Dashboard (passcode-gated, read-only, no member account) ─────────
// Admin sets a shared passcode (stored hashed in app_settings). A visitor enters
// it at /dashboard → exchanges it for a short-lived signed token → fetches a
// SAFE read-only data subset. No login, no member session, no sensitive fields.
const dashLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,                                   // 30 passcode attempts / 15 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'พยายามใส่รหัสบ่อยเกินไป — ลองใหม่ภายหลัง' },
});
function verifyDashToken(req) {
  const t = String(req.headers['x-dash-token'] || req.query.dt || '');
  const dot = t.indexOf('.');
  if (dot < 0) return false;
  return verifySignature('dash', 'v1', t.slice(dot + 1), t.slice(0, dot));
}
// Admin — is a dashboard passcode currently set?
app.get('/api/dashboard/status', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ enabled: !!(await db.getSetting('dashboard_passcode_hash', '')) });
}));
// Admin — set the passcode (blank string clears/disables it)
app.put('/api/dashboard/passcode', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const code = String(req.body?.passcode ?? '');
  if (code === '') { await db.setSetting('dashboard_passcode_hash', '', req.user.id); return res.json({ enabled: false }); }
  if (code.length < 4) return res.status(400).json({ error: 'รหัสต้องยาวอย่างน้อย 4 ตัวอักษร' });
  await db.setSetting('dashboard_passcode_hash', auth.hashPassword(code), req.user.id);
  res.json({ enabled: true });
}));
// Public — exchange passcode → short-lived (12h) read-only token
app.post('/api/dashboard/login', dashLimiter, wrap(async (req, res) => {
  const h = await db.getSetting('dashboard_passcode_hash', '');
  if (!h) return res.status(403).json({ error: 'ยังไม่เปิดใช้งาน dashboard' });
  if (!auth.verifyPassword(String(req.body?.passcode ?? ''), h)) {
    return res.status(401).json({ error: 'รหัสไม่ถูกต้อง' });
  }
  const { sig, exp } = signUrl('dash', 'v1', 12 * 3600);
  res.json({ token: `${exp}.${sig}` });
}));
// Public — read-only dashboard data (token-gated)
app.get('/api/dashboard/data', wrap(async (req, res) => {
  if (!verifyDashToken(req)) return res.status(401).json({ error: 'unauthorized' });
  res.json(await db.dashboardData());
}));
// Public — SSE push for realtime updates. Dash-token gated; joins the shared
// broadcast set so it receives the safe {kind:'change', path, method} pings on
// every mutation. The dashboard refetches /api/dashboard/data when one arrives.
app.get('/api/dashboard/events', (req, res) => {
  if (!verifyDashToken(req)) return res.status(401).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 5000\n\n: connected\n\n');
  sseClients.add(res);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// Endpoint ที่ frontend ขอ signed URL — ปกป้องด้วย auth header ตามปกติ
app.get('/api/recordings/:id/sign', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const rec = await db.getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'recording not found' });
  if (rec.member_id !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { sig, exp } = signUrl('rec', rec.id, 3600);  // 1 ชม
  res.json({ url: `/api/recordings/${rec.id}/stream?sig=${sig}&exp=${exp}` });
}));

app.get('/api/recordings/:id/stream', wrap(async (req, res) => {
  // 1) Signed URL (preferred) — sig + exp ใน query, HMAC verify ไม่มี token leak
  let user = null;
  if (req.query.sig && req.query.exp) {
    if (verifySignature('rec', req.params.id, req.query.sig, req.query.exp)) {
      // signature OK → no need to look up user (signed URL = authenticated)
      // We still need to check existence below — record may have been deleted
      user = { id: '_signed', role: 'XL' };  // bypass owner check below (XL = admin-or-above)
    }
  }
  // 2) Token via header (Authorization: Bearer ...) — preferred for SPA fetch
  if (!user) user = req.user;
  // 3) Token via query (legacy, deprecated — kept for backward-compat with
  //    <audio src> that loaded before SW v41). Logs warning.
  if (!user && req.query.token) {
    const memberId = auth.lookupToken(req.query.token);
    if (memberId) user = await db.getMember(memberId);
    if (user) console.warn('[deprecated] /api/recordings/.../stream via ?token= — switch to /sign endpoint');
  }
  if (!user) return res.status(401).json({ error: 'login required' });

  const rec = await db.getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'recording not found' });
  if (rec.member_id !== user.id && !hasAdminPerms(user)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const filePath = path.join(AUDIO_DIR, rec.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;
  // Sanitize Content-Type: whitelist known audio mime types ที่ระบบเรารับเข้า
  // ไม่ไว้ใจค่าใน DB เพราะ user เคย upload — ถ้า DB ถูกเขียนเป็น
  // 'image/svg+xml' ก็จะ XSS ตอน embed ใน page อื่น
  const safeAudioMimes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aac', 'audio/x-m4a'];
  const declaredMime = String(rec.mime || '').toLowerCase();
  const contentType = safeAudioMimes.includes(declaredMime) ? declaredMime : 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0');
  if (range) {
    const m = /bytes=(\d+)-(\d+)?/.exec(range);
    const start = +(m?.[1] || 0);
    const end   = m?.[2] ? +m[2] : total - 1;
    if (start >= total) return res.status(416).end();
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', total);
    fs.createReadStream(filePath).pipe(res);
  }
}));

app.patch('/api/recordings/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const rec = await db.getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'recording not found' });
  if (rec.member_id !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'admin or owner only' });
  }
  const { label, duration_ms } = req.body || {};
  const updated = await db.updateRecording(req.params.id, { label, duration_ms });
  res.json(updated);
}));

app.delete('/api/recordings/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const rec = await db.getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'recording not found' });
  if (rec.member_id !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'admin or owner only' });
  }
  // Remove disk file first; if that fails we still drop the DB row so it
  // doesn't dangle, then surface the disk error.
  let diskErr = null;
  try { fs.unlinkSync(path.join(AUDIO_DIR, rec.filename)); }
  catch (e) { if (e.code !== 'ENOENT') diskErr = e.message; }
  await db.deleteRecording(req.params.id);
  await db.logAudit({
    actor_id: req.user.id, actor_name: req.user.name,
    action: 'recording.delete', target_kind: 'recording', target_id: req.params.id,
    payload: { label: rec.label, owner: rec.member_id }, ip: req.ip,
  });
  res.json({ ok: true, ...(diskErr ? { warning: diskErr } : {}) });
}));

// ===== Settings (admin-managed system config) =====
// Whitelist of writable settings + how to validate / serialize each one.
// Add new entries here when introducing more settings — anything outside the
// whitelist is rejected by PUT /api/settings to prevent stray DB rows.
// Settings whitelist — เพิ่ม key ใหม่ที่นี่. แต่ละ key ต้องมี:
//   default: ค่าเริ่มต้น (เก็บเป็น string เพื่อ schema เดียวกับ db)
//   parse: function แปลงค่าจาก client → string ที่จะเก็บ
//   label: คำอธิบายสั้น (สำหรับ admin UI)
//   description: รายละเอียดยาว ๆ อธิบายผลของ setting (optional)
const SETTINGS_DEFS = {
  email_invitations_enabled: {
    default: 'true',
    parse:   v => (v === 'false' || v === false || v === 0 || v === '0') ? 'false' : 'true',
    label:   'ส่งอีเมลเชิญประชุม (iMIP) ตอนสร้าง/แก้/ลบประชุม',
    description: 'เมื่อเปิด — ระบบจะส่งอีเมลพร้อม iCalendar (.ics) attachment ให้ผู้เข้าร่วมประชุมทุกครั้งที่สร้าง/แก้ไข/ยกเลิกประชุม. ใช้ SMTP_* env เป็น relay. ปิดถ้าทีมใช้ปฏิทินอื่น (Google Calendar etc) แล้วไม่ต้องการ duplicate.',
  },
};

// Read settings — flat shape so the frontend can do `s.email_invitations_enabled` directly.
// `_smtp_configured` is a derived runtime status (not stored), prefixed `_` to mark it
// as "not a writable setting".
app.get('/api/settings', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const rows = await db.listSettings();
  const flat = {};
  for (const [k, def] of Object.entries(SETTINGS_DEFS)) flat[k] = def.default;
  for (const r of rows) flat[r.key] = r.value;
  // smtp_configured = "creds are set" (independent of admin toggle).
  // Use this in UI to warn if SMTP isn't configured at all.
  flat._smtp_configured = mailer.smtpConfigured();
  flat._smtp_host = process.env.SMTP_HOST || null;
  flat._smtp_from = process.env.SMTP_FROM || null;
  res.json(flat);
}));

// Bulk update — admin only. Body shape: { email_invitations_enabled: 'true', ... }
app.put('/api/settings', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const patch = req.body || {};
  const written = {};
  for (const [k, v] of Object.entries(patch)) {
    const def = SETTINGS_DEFS[k];
    if (!def) continue; // unknown keys ignored silently — forward-compatible
    const value = def.parse(v);
    await db.setSetting(k, value, req.user.id);
    written[k] = value;
    // Sync runtime state for settings the mailer caches in-memory.
    if (k === 'email_invitations_enabled') mailer.setAdminEnabled(value === 'true');
  }
  if (Object.keys(written).length) {
    await db.logAudit({
      actor_id: req.user.id, actor_name: req.user.name,
      action: 'settings.update', target_kind: 'settings', target_id: '*',
      payload: written, ip: req.ip,
    });
  }
  res.json({ ok: true, updated: written });
}));

// Audit log viewer — admin only. Query filters: action, target_kind, actor_id, since, limit
app.get('/api/audit', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = await db.listAuditEvents({
    action:      req.query.action,
    target_kind: req.query.target_kind,
    actor_id:    req.query.actor_id,
    since:       req.query.since,
    limit:       +req.query.limit || 200,
  });
  res.json(rows);
}));

// (เคยมี handler /api/settings ซ้ำที่ตรงนี้ — admin-only — แต่ Express ใช้
//  handler ตัวแรกที่ register และตัวข้างบน (บรรทัด 1488) ไม่เช็ค admin →
//  ตัวซ้ำนี้เป็น dead code + permission bug แฝง. ลบทิ้ง.)

// ===== Leaves (วันลา) =====
// All authenticated users can read; members create/edit/delete their own; admin can manage all.
// ===== Categories (ประเภทงาน) =====
// All authenticated users can list and create categories — they're shared globally.
app.get('/api/categories', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listCategories());
}));
app.post('/api/categories', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  res.status(201).json(await db.createCategory(name));
}));
app.put('/api/categories/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const cat = await db.getCategory(req.params.id);
  if (!cat) return res.status(404).json({ error: 'not found' });
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  try { res.json(await db.updateCategory(req.params.id, name)); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));
app.delete('/api/categories/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const cat = await db.getCategory(req.params.id);
  if (!cat) return res.status(404).json({ error: 'not found' });
  await db.deleteCategory(req.params.id);
  res.json({ ok: true });
}));

app.get('/api/leaves', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listLeaves());
}));
app.post('/api/leaves', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { member_id, start_at, end_at, reason } = req.body || {};
  // Members can only create leaves for themselves; admin can create for anyone
  const targetId = member_id || req.user.id;
  if (!hasAdminPerms(req.user) && targetId !== req.user.id) {
    return res.status(403).json({ error: 'สามารถสร้างวันลาให้ตัวเองเท่านั้น' });
  }
  res.status(201).json(await db.createLeave({ member_id: targetId, start_at, end_at, reason }));
}));
app.put('/api/leaves/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const leave = await db.getLeave(req.params.id);
  if (!leave) return res.status(404).json({ error: 'not found' });
  if (!hasAdminPerms(req.user) && leave.member_id !== req.user.id) {
    return res.status(403).json({ error: 'แก้ไขได้เฉพาะวันลาของตัวเอง' });
  }
  res.json(await db.updateLeave(req.params.id, req.body || {}));
}));
app.delete('/api/leaves/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const leave = await db.getLeave(req.params.id);
  if (!leave) return res.status(404).json({ error: 'not found' });
  if (!hasAdminPerms(req.user) && leave.member_id !== req.user.id) {
    return res.status(403).json({ error: 'ลบได้เฉพาะวันลาของตัวเอง' });
  }
  await db.deleteLeave(req.params.id);
  res.json({ ok: true });
}));

// ===== Whiteboards =====
app.get('/api/whiteboards', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listWhiteboards());
}));
app.post('/api/whiteboards', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  res.status(201).json(await db.createWhiteboard(name, req.user.id));
}));
app.get('/api/whiteboards/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const b = await db.getWhiteboard(req.params.id);
  if (!b) return res.status(404).json({ error: 'not found' });
  // ACL — private board ต้องเป็น member ถึงจะอ่านได้
  if (!await db.whiteboardCanAccess(req.params.id, req.user.id, req.user.role)) {
    return res.status(403).json({ error: 'no access to this whiteboard' });
  }
  res.json(b);
}));
app.delete('/api/whiteboards/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  // Allow board creator to delete their own, OR admin can delete any
  const board = await db.getWhiteboard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not found' });
  if (board.created_by !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'creator or admin only' });
  }
  if (!await db.deleteWhiteboard(req.params.id)) return res.status(404).json({ error: 'not found' });
  await db.logAudit({
    actor_id: req.user.id, actor_name: req.user.name,
    action: 'whiteboard.delete', target_kind: 'whiteboard', target_id: req.params.id,
    payload: { name: board.name }, ip: req.ip,
  });
  res.json({ ok: true });
}));
// Whiteboard member management — owner/admin only
app.get('/api/whiteboards/:id/members', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!await db.whiteboardCanAccess(req.params.id, req.user.id, req.user.role)) {
    return res.status(403).json({ error: 'no access' });
  }
  res.json(await db.whiteboardListMembers(req.params.id));
}));
app.post('/api/whiteboards/:id/members', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const board = await db.getWhiteboard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not found' });
  if (board.created_by !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'owner or admin only' });
  }
  const { member_id, role } = req.body || {};
  if (!member_id) return res.status(400).json({ error: 'member_id required' });
  await db.whiteboardAddMember(req.params.id, member_id, role);
  res.json({ ok: true });
}));
app.delete('/api/whiteboards/:id/members/:memberId', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const board = await db.getWhiteboard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not found' });
  if (board.created_by !== req.user.id && !hasAdminPerms(req.user)) {
    return res.status(403).json({ error: 'owner or admin only' });
  }
  if (!await db.whiteboardRemoveMember(req.params.id, req.params.memberId)) return res.status(404).end();
  res.json({ ok: true });
}));
// Inject a task or meeting card onto the whiteboard
const VALID_INJECT_KINDS = ['task', 'meeting', 'group', 'recording', 'point_request', 'point_decision'];
app.post('/api/whiteboards/:id/inject', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const board = await db.getWhiteboard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not found' });
  // ACL check — same as opening the board
  if (!await db.whiteboardCanAccess(req.params.id, req.user.id, req.user.role)) {
    return res.status(403).json({ error: 'no access to this whiteboard' });
  }
  const { kind, data } = req.body || {};
  if (!kind || !data) return res.status(400).json({ error: 'kind and data required' });
  if (!VALID_INJECT_KINDS.includes(kind)) {
    return res.status(400).json({ error: `unknown kind. Allowed: ${VALID_INJECT_KINDS.join(', ')}` });
  }
  // Size limit — กัน DoS via huge base64 image embedded ใน data
  const payloadSize = JSON.stringify(data).length;
  if (payloadSize > 256 * 1024) {
    return res.status(413).json({ error: `inject payload too large (${Math.round(payloadSize/1024)}KB > 256KB)` });
  }
  const injectOp = { type: 'inject', kind, data, injectedBy: req.user.name };
  wbBroadcast(req.params.id, { type: 'inject', op: injectOp });
  res.json({ ok: true });
}));

// ===== 404 + final error handler =====
// Anything under /api/* that didn't match a route returns JSON-shaped 404.
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// Final error handler — never leak stack traces in production.
app.use((err, req, res, next) => {
  console.error('[unhandled]', err.stack || err.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: isProd ? 'internal server error' : (err.message || 'internal server error') });
});

// ===== Whiteboard rooms (module-scope so the inject route can reach wbBroadcast) =====
// boardId → Map<clientId, { ws, memberId, name, color }>
const wbRooms = new Map();

// boardId → { timer, latestJson } — debounced auto-save (3s after last op)
const wbAutoSaveTimers = new Map();
function scheduleWbAutoSave(boardId, canvasJson) {
  let entry = wbAutoSaveTimers.get(boardId);
  if (!entry) { entry = { timer: null, latestJson: null }; wbAutoSaveTimers.set(boardId, entry); }
  entry.latestJson = canvasJson;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(async () => {
    try {
      await db.updateWhiteboardCanvas(boardId, entry.latestJson);
    } catch (e) { console.warn('[wb auto-save]', e.message); }
    wbAutoSaveTimers.delete(boardId);
  }, 3000);
}

function wbBroadcast(boardId, payload, exceptClientId = null) {
  const room = wbRooms.get(boardId);
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const [cid, { ws }] of room) {
    if (cid !== exceptClientId && ws.readyState === 1) ws.send(msg);
  }
}

// ===== Bootstrap + graceful shutdown =====
let server;

function shutdown(sig) {
  console.log(`\n[${sig}] graceful shutdown starting…`);
  // Close all SSE clients first so they don't hold the event loop open
  for (const c of sseClients) { try { c.end(); } catch {} }
  sseClients.clear();
  if (!server) return process.exit(0);
  server.close(async err => {
    if (err) console.error('http close error:', err.message);
    try { await db.close(); } catch (e) { console.warn('db close warn:', e.message); }
    process.exit(0);
  });
  setTimeout(() => {
    console.error('graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Don't crash on unexpected errors — log loudly and stay up. Fatal bugs still
// surface in logs; PM2 / Docker restart policy will recover from real crashes.
process.on('uncaughtException',  (e) => console.error('[uncaughtException]',  e?.stack || e));
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r?.stack || r));

(async () => {
  try { await db.init(); }
  catch (err) { console.error('[FATAL] DB init failed:', err.message); process.exit(1); }

  // Restore the admin email-sending toggle from DB. Default ON if never set.
  try {
    const saved = await db.getSetting('email_invitations_enabled', 'true');
    mailer.setAdminEnabled(saved === 'true');
  } catch (e) { console.warn('[mailer] could not load admin toggle from DB:', e.message); }

  // SMTP diagnostics — non-fatal: meeting flows still work without email
  if (mailer.smtpConfigured()) {
    mailer.verify().then(r => {
      if (r.ok) {
        const adminOn = mailer.getAdminEnabled();
        console.log(`[mailer] SMTP ready — invitations ${adminOn ? 'WILL' : 'WILL NOT'} be sent (admin toggle: ${adminOn ? 'on' : 'off'})`);
      } else console.warn('[mailer] SMTP configured but verify failed:', r.reason);
    });
  } else {
    console.warn('[mailer] SMTP not configured — meeting invitation emails disabled (set SMTP_HOST/USER/PASS in .env to enable)');
  }

  server = app.listen(PORT, () => {
    console.log(`SML server running at http://localhost:${PORT}  (${process.env.NODE_ENV || 'development'})`);
    console.log(`Uploads:  ${db.UPLOAD_DIR}`);
  });

  // WebSocket for whiteboard real-time sync
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    // Only allow /ws path
    if (new URL(request.url, 'http://localhost').pathname !== '/ws') {
      socket.destroy(); return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });

  // Heartbeat — ping ทุก 30 วินาที, ถ้า client ไม่ pong ภายใน interval ถัดไป
  // = TCP half-open (mobile sleep, WiFi drop, NAT timeout) → terminate.
  // กันสถานะ "user ค้างใน room" ที่ disconnect ไปแล้วแต่ server ไม่รู้
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
  }, 30 * 1000);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    let clientId = null, boardId = null;
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'join') {
        // Authenticate via token
        const memberId = msg.token ? auth.lookupToken(msg.token) : null;
        if (!memberId) { ws.send(JSON.stringify({ type: 'error', message: 'unauthorized' })); ws.close(); return; }
        const member = await db.getMember(memberId);
        if (!member) { ws.send(JSON.stringify({ type: 'error', message: 'unauthorized' })); ws.close(); return; }
        const board = await db.getWhiteboard(msg.boardId);
        if (!board) { ws.send(JSON.stringify({ type: 'error', message: 'board not found' })); ws.close(); return; }
        // ACL — private board ต้องเป็น member ถึงจะ join WS ได้
        const canAccess = await db.whiteboardCanAccess(msg.boardId, member.id, member.role);
        if (!canAccess) { ws.send(JSON.stringify({ type: 'error', message: 'no access to this whiteboard' })); ws.close(); return; }

        clientId = `${member.id}_${Date.now()}`;
        boardId = msg.boardId;
        if (!wbRooms.has(boardId)) wbRooms.set(boardId, new Map());
        const room = wbRooms.get(boardId);
        room.set(clientId, { ws, memberId: member.id, name: member.name, color: member.color || '#6366f1' });

        // Send current canvas state to the joining client
        ws.send(JSON.stringify({
          type: 'init',
          canvasJson: board.canvas_json,
          users: Array.from(room.values()).map(u => ({ clientId: u.memberId, name: u.name, color: u.color })),
        }));
        // Notify others
        wbBroadcast(boardId, { type: 'user_join', clientId, name: member.name, color: member.color || '#6366f1' }, clientId);
      }

      else if (msg.type === 'op' && boardId) {
        // Size guard — กัน DoS via huge canvas blob (เช่น sticky + base64 image)
        const sz = (msg.op?.canvasJson || '').length;
        if (sz > 5 * 1024 * 1024) {  // 5 MB cap per op
          ws.send(JSON.stringify({ type: 'error', message: `canvas too large (${Math.round(sz/1024)}KB > 5MB)` }));
          return;
        }
        wbBroadcast(boardId, { type: 'op', clientId, op: msg.op }, clientId);
        // Auto-save to DB (debounced) so reopening the board recovers latest state
        if (msg.op?.canvasJson) {
          scheduleWbAutoSave(boardId, msg.op.canvasJson);
        }
      }

      else if (msg.type === 'confirm' && boardId) {
        const sz = (msg.canvasJson || '').length;
        if (sz > 5 * 1024 * 1024) {
          ws.send(JSON.stringify({ type: 'error', message: `canvas too large (${Math.round(sz/1024)}KB > 5MB)` }));
          return;
        }
        await db.updateWhiteboardCanvas(boardId, msg.canvasJson);
        const room = wbRooms.get(boardId);
        const me = room?.get(clientId);
        wbBroadcast(boardId, { type: 'confirmed', by: me?.name || '?', canvasJson: msg.canvasJson }, clientId);
      }
    });

    ws.on('close', () => {
      if (boardId && clientId) {
        wbRooms.get(boardId)?.delete(clientId);
        wbBroadcast(boardId, { type: 'user_leave', clientId });
        if (wbRooms.get(boardId)?.size === 0) wbRooms.delete(boardId);
      }
    });
  });
})();
