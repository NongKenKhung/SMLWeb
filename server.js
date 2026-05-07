require('dotenv').config();
const { WebSocketServer } = require('ws');
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');

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
    if (req.path === '/healthz' || req.path === '/api/events') return;
    const ms = Date.now() - start;
    const ip = req.ip || req.connection?.remoteAddress || '-';
    console.log(`${new Date().toISOString()} ${ip} ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
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
      scriptSrc:  ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com'],
      // helmet defaults script-src-attr to 'none' which blocks every onclick="…"
      // attribute even when scriptSrc allows 'unsafe-inline'. The /dev page (and
      // a couple of buttons in index.html) rely on inline handlers, so allow them.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      mediaSrc:   ["'self'", 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      objectSrc:  ["'none'"],
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
app.get('/dev', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'dev.html'));
});


// Static SPA assets — short cache so UI updates land quickly; HTML never cached.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: isProd ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
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

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const t = await db.getTask(req.params.id);
        if (!t) return cb(new Error('task not found'));
        cb(null, db.uploadDir(t.group_id));
      } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 16);
      const safe = file.originalname?.replace(/[^\w฀-๿.\-]+/g, '_').slice(-80) || 'file';
      cb(null, crypto.randomBytes(8).toString('hex') + '_' + safe + (ext && !safe.endsWith(ext) ? ext : ''));
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

// Audio recordings — stored on disk in UPLOAD_DIR/_audio/, metadata in DB.
// Each clip gets a random hex filename + extension so URLs are cache-safe and
// public listing of the directory exposes nothing meaningful.
const AUDIO_DIR = path.join(db.UPLOAD_DIR, '_audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AUDIO_DIR),
    filename: (req, file, cb) => {
      // Pick extension from MIME (browsers don't always set originalname for blobs)
      const m = (file.mimetype || '').toLowerCase();
      const ext = m.includes('webm') ? '.webm'
                : m.includes('ogg')  ? '.ogg'
                : m.includes('mp4')  ? '.m4a'
                : m.includes('wav')  ? '.wav'
                : m.includes('mp3')  ? '.mp3'
                :                       '.bin';
      cb(null, crypto.randomBytes(10).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },  // 50 MB cap
  fileFilter: (req, file, cb) => {
    if (!/^audio\//i.test(file.mimetype)) return cb(new Error('รองรับเฉพาะไฟล์เสียง'));
    cb(null, true);
  },
});

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
  limits: { fileSize: 4 * 1024 * 1024 },  // 4 MB cap for profile pictures
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
function requireAdmin(req, res) {
  if (!requireAuth(req, res)) return false;
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'admin only' }); return false; }
  return true;
}

// ── UI Config — admin-controlled layout for the main SPA ──────────────────────
// Stored as JSON file (not in DB). Lives next to TOKEN_FILE so it shares the
// /data volume in production. GET is public; PUT/RESET require admin.
const UI_CONFIG_FILE = process.env.UI_CONFIG_FILE || (
  process.env.TOKEN_FILE
    ? path.join(path.dirname(process.env.TOKEN_FILE), 'ui-config.json')
    : path.join(__dirname, '.ui-config.json')
);

// Layout uses a 12-column grid. Each widget has a `width` (1..12) controlling
// how many columns it spans on desktop. Mobile collapses everything to 1 col.
const DEFAULT_UI_CONFIG = {
  version: 2,
  tabs: [
    { id: 'home',       label: '🏠 Home',       visible: true },
    { id: 'tasks',      label: '📋 Todo',       visible: true },
    { id: 'calendar',   label: '📅 Calendar',   visible: true },
    { id: 'people',     label: '👥 People',     visible: true },
    { id: 'summary',    label: '📊 Summary',    visible: true },
    { id: 'profile',    label: '👤 Profile',    visible: true },
    // Whiteboard moved to /dev (Lab) for incubation. Tab kept here so admin
    // can flip `visible: true` when it's ready to ship in the main app.
    { id: 'whiteboard', label: '🎨 Board',      visible: false },
  ],
  // `height` field: 'auto' (content-driven) or px (number). When set to a px
  // value the widget reserves that vertical space, letting smaller widgets
  // pack alongside it via `grid-auto-flow: dense`. Tall widgets like the
  // calendar grid get explicit heights so neighbors fit beside them.
  widgets: {
    home: [
      { id: 'home-greeting',   label: '👋 แถบทักทาย + คะแนน',    visible: true, width: 12, height: 'auto' },
      { id: 'home-stats',      label: '📊 สถิติ 4 ใบ',            visible: true, width: 12, height: 'auto' },
      // Lists are bounded — they scroll inside their card so a busy week doesn't push the rest of the page off-screen.
      { id: 'home-upcoming',   label: '📅 Deadline ใกล้ถึง',      visible: true, width: 8,  height: 360    },
      { id: 'home-scoreboard', label: '🥧 Scoreboard',            visible: true, width: 4,  height: 360    },
      { id: 'home-meetings',   label: '📅 การประชุมที่ใกล้ถึง',   visible: true, width: 6,  height: 320    },
      { id: 'home-open',       label: '🪪 กลุ่มที่ยังไม่ได้เข้า',  visible: true, width: 6,  height: 320    },
      { id: 'home-extensions', label: '⏰ คำขอเลื่อน Deadline',    visible: true, width: 12, height: 'auto' },
    ],
    tasks: [
      { id: 'tasks-search',    label: '🔎 ช่องค้นหา + ปุ่มกรอง',   visible: true, width: 12, height: 'auto' },
      { id: 'tasks-segmented', label: '🗂️ แท็บ (ของฉัน / หัวหน้า / Admin)', visible: true, width: 12, height: 'auto' },
      { id: 'tasks-list',      label: '📋 รายการงาน',             visible: true, width: 12, height: 'auto' },
    ],
    calendar: [
      // Calendar grid + 4 sidebar widgets (create / meetings / tasks / leaves)
      // sized so the right column adds up to ~600px and stacks beside the grid.
      // Lists scroll inside their box instead of growing forever.
      { id: 'calendar-grid',     label: '📅 ตารางปฏิทินใหญ่',       visible: true, width: 8, height: 600  },
      { id: 'calendar-create',   label: '➕ ปุ่มสร้างงาน/ประชุม',    visible: true, width: 4, height: 'auto' },
      { id: 'calendar-meetings', label: '📅 รายการประชุม',          visible: true, width: 4, height: 240   },
      { id: 'calendar-tasks',    label: '📋 งานในเดือน',            visible: true, width: 4, height: 240   },
      { id: 'calendar-leaves',   label: '🏖️ วันลาในเดือน',          visible: true, width: 4, height: 'auto' },
    ],
    people: [
      { id: 'people-segmented',   label: '🗂️ แท็บ (สมาชิก / Connections)', visible: true, width: 12, height: 'auto' },
      { id: 'people-members',     label: '👥 รายการสมาชิก',         visible: true, width: 12, height: 'auto' },
      { id: 'people-connections', label: '🔗 รายการ Connections',  visible: true, width: 12, height: 'auto' },
    ],
    summary: [
      { id: 'summary-content',    label: '📊 เนื้อหา Summary',     visible: true, width: 12, height: 'auto' },
    ],
    whiteboard: [
      { id: 'whiteboard-list',    label: '🖼️ รายการ Boards',       visible: true, width: 12, height: 'auto' },
      { id: 'whiteboard-canvas',  label: '🎨 Canvas',             visible: true, width: 12, height: 'auto' },
    ],
    profile: [
      { id: 'profile-avatar',  label: '👤 การ์ด Avatar',          visible: true, width: 12, height: 'auto' },
      { id: 'profile-stats',   label: '📊 การ์ดสถิติ',             visible: true, width: 12, height: 'auto' },
      { id: 'profile-actions', label: '⚙️ การ์ดเมนู',              visible: true, width: 12, height: 'auto' },
    ],
  },
};

function _clampWidth(w) {
  const n = Math.round(Number(w));
  if (!Number.isFinite(n)) return 12;
  return Math.max(1, Math.min(12, n));
}
// Height: 'auto' or a positive integer (px). Anything else falls back to 'auto'.
function _clampHeight(h) {
  if (h === 'auto' || h == null || h === '') return 'auto';
  const n = Math.round(Number(h));
  if (!Number.isFinite(n) || n < 40) return 'auto';
  return Math.min(2000, n);
}

function _cloneCfg(c) { return JSON.parse(JSON.stringify(c)); }

// Merge override on top of defaults so:
//  - new tabs/widgets added in code automatically appear (at the end)
//  - removed tabs/widgets in code disappear
//  - admin-controlled `visible` + ordering survive across upgrades
function mergeUiConfig(base, override) {
  const merged = _cloneCfg(base);
  if (override && Array.isArray(override.tabs)) {
    const ovIdx = new Map(override.tabs.map((t, i) => [t.id, { entry: t, order: i }]));
    merged.tabs = merged.tabs.map(def => {
      const o = ovIdx.get(def.id);
      return o ? { ...def, visible: o.entry.visible !== false, _order: o.order } : { ...def, _order: 1e9 };
    }).sort((a, b) => (a._order ?? 1e9) - (b._order ?? 1e9))
      .map(({ _order, ...rest }) => rest);
  }
  if (override && override.widgets && typeof override.widgets === 'object') {
    for (const sec of Object.keys(merged.widgets)) {
      const ov = override.widgets[sec];
      if (!Array.isArray(ov)) continue;
      const ovIdx = new Map(ov.map((w, i) => [w.id, { entry: w, order: i }]));
      merged.widgets[sec] = merged.widgets[sec].map(def => {
        const o = ovIdx.get(def.id);
        if (!o) return { ...def, _order: 1e9 };
        return {
          ...def,
          visible: o.entry.visible !== false,
          width:  _clampWidth(o.entry.width  ?? def.width),
          height: _clampHeight(o.entry.height ?? def.height),
          _order: o.order,
        };
      }).sort((a, b) => (a._order ?? 1e9) - (b._order ?? 1e9))
        .map(({ _order, ...rest }) => rest);
    }
  }
  return merged;
}

let _uiConfigCache = null;
function loadUiConfig() {
  if (_uiConfigCache) return _uiConfigCache;
  try {
    const raw = fs.readFileSync(UI_CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    _uiConfigCache = mergeUiConfig(DEFAULT_UI_CONFIG, parsed);
  } catch {
    _uiConfigCache = _cloneCfg(DEFAULT_UI_CONFIG);
  }
  return _uiConfigCache;
}
function saveUiConfig(cfg) {
  const tmp = UI_CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, UI_CONFIG_FILE);
  _uiConfigCache = cfg;
}

app.get('/api/ui-config', wrap(async (req, res) => {
  res.json(loadUiConfig());
}));
app.put('/api/ui-config', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const merged = mergeUiConfig(DEFAULT_UI_CONFIG, req.body || {});
  saveUiConfig(merged);
  broadcast('ui-config', { by: req.user?.id || null });
  res.json({ ok: true, config: merged });
}));
app.post('/api/ui-config/reset', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const fresh = _cloneCfg(DEFAULT_UI_CONFIG);
  saveUiConfig(fresh);
  broadcast('ui-config', { by: req.user?.id || null });
  res.json({ ok: true, config: fresh });
}));

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

app.post('/api/login', wrap(async (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: 'name + password required' });
  const m = await db.findMemberByName(String(name).trim());
  if (!m || !auth.verifyPassword(password, m.password_hash)) return res.status(401).json({ error: 'invalid credentials' });
  const token = auth.createToken(m.id);
  const { password_hash, ...pub } = m;
  res.json({ token, user: pub });
}));
app.post('/api/logout', wrap(async (req, res) => { if (req.token) auth.destroyToken(req.token); res.json({ ok: true }); }));
app.get('/api/me', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(req.user); }));
app.put('/api/me/password', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 4) return res.status(400).json({ error: 'new_password >= 4 chars' });
  const full = await db.getMemberFull(req.user.id);
  if (!auth.verifyPassword(current_password || '', full.password_hash)) return res.status(401).json({ error: 'current password incorrect' });
  await db.setMemberPassword(req.user.id, auth.hashPassword(new_password));
  res.json({ ok: true });
}));

// Profile avatar upload (multipart). Replaces any existing avatar — old file is deleted on disk.
app.post('/api/me/avatar', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login required' });
  avatarUpload.single('avatar')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
    try {
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
  const u = await db.updateMember(req.params.id, req.body || {});
  if (!u) return res.status(404).json({ error: 'not found' });
  if (req.body?.password) await db.setMemberPassword(req.params.id, auth.hashPassword(req.body.password));
  res.json(u);
}));
app.delete('/api/members/:id', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'cannot delete yourself' });
  if (!(await db.deleteMember(req.params.id))) return res.status(404).json({ error: 'not found' });
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
  const isAdmin = req.user.role === 'admin';

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
  const isAdmin = req.user.role === 'admin';
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
  if (!(await db.deleteGroup(req.params.id))) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));
app.get('/api/groups/:id/files', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listFilesForGroup(req.params.id));
}));

// ===== Tasks =====
app.get('/api/tasks', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.listTasks(req.query)); }));
app.get('/api/tasks/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
}));
app.post('/api/tasks', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!req.body?.title || !String(req.body.title).trim()) return res.status(400).json({ error: 'title required' });
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'admin or group leader only' });
  await db.deleteTask(req.params.id);

  // Meeting deletion → CANCEL invitation to attendees so the event drops from their cal.
  // Sequence is bumped client-side (in-memory snapshot) since the row is gone.
  if (t.kind === 'meeting') {
    const seq = (t.ics_sequence || 0) + 1;
    mailer.sendCancel(t, req.user, seq).catch(e => console.error('[mailer] delete-cancel error:', e.message));
  }
  res.json({ ok: true });
}));

// Manually resend a meeting invitation (for any reason — fix typo, remind attendees, etc).
// Bumps SEQUENCE so existing calendar events are updated rather than duplicated.
app.post('/api/tasks/:id/send-invite', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (t.kind !== 'meeting') return res.status(400).json({ error: 'ใช้ได้เฉพาะการประชุม (kind=meeting) เท่านั้น' });
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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
    req.user.role === 'admin'
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
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'หัวหน้ากลุ่มหรือ Admin เท่านั้น' });
  res.json(await db.leaderApprovePoints(req.params.id));
}));

// Stage 3: confirm at weekly meeting (leader OR admin)
app.post('/api/tasks/:id/points/confirm', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = req.user.role === 'admin';
  const isGroupLeader = t.group_id && (await db.isGroupLeader(t.group_id, req.user.id));
  if (!isAdmin && !isGroupLeader) return res.status(403).json({ error: 'หัวหน้ากลุ่มหรือ Admin เท่านั้น' });
  res.json(await db.confirmPoints(req.params.id));
}));

// Reopen a confirmed task back to final_review
app.post('/api/tasks/:id/points/reopen', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = req.user.role === 'admin';
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
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvSafeFilename(g.name)}_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('﻿' + csv);
}));
function csvSafeFilename(s) { return String(s||'export').replace(/[^\w฀-๿.\- ]+/g, '_').slice(0,80); }
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
  const filePath = path.join(db.UPLOAD_DIR, db.folderForGroup(f.group_id), f.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });
  res.download(filePath, f.original_name);
}));

app.delete('/api/files/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const f = await db.getFile(req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && f.uploaded_by !== req.user.id) return res.status(403).json({ error: 'no permission' });
  await db.deleteFile(req.params.id);
  res.json({ ok: true });
}));

// ===== Connections =====
app.get('/api/connections', wrap(async (req, res) => { if (!requireAuth(req, res)) return; res.json(await db.listConnections()); }));
app.post('/api/connections', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (req.user.role !== 'admin' && req.body?.member_id !== req.user.id) return res.status(403).json({ error: 'can only add connections for yourself' });
  res.status(201).json(await db.createConnection(req.body || {}));
}));
app.put('/api/connections/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const c = await db.getConnection(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && c.member_id !== req.user.id) return res.status(403).json({ error: 'no permission' });
  res.json(await db.updateConnection(req.params.id, req.body || {}));
}));
app.delete('/api/connections/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const c = await db.getConnection(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && c.member_id !== req.user.id) return res.status(403).json({ error: 'no permission' });
  await db.deleteConnection(req.params.id);
  res.json({ ok: true });
}));

// ===== Deadline ext =====
app.post('/api/tasks/:id/deadline-request', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const t = await db.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const isAdmin = req.user.role === 'admin';
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
  const isAdmin = req.user.role === 'admin';
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

// ── Recordings (audio) ──
// Authenticated user can record + manage their own clips. Admin sees and can
// delete any. Files live on disk; metadata in DB. Streaming endpoint supports
// HTTP Range so the browser <audio> element can scrub without downloading
// the whole file first.
app.get('/api/recordings', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const all = req.query.all === '1' && req.user.role === 'admin';
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
      const label = (req.body.label || '').toString().slice(0, 200) ||
                    'Recording ' + new Date().toLocaleString('th-TH', { hour12: false });
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
  if (rec.member_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin or owner only' });
  }
  // Don't await — let it run in background and return current state
  transcribeRecording(rec.id).catch(e => console.warn('[asr] retry error:', e.message));
  res.json({ ok: true, queued: true });
}));

// ASR worker: POST to the asr microservice with the filename, then save the
// transcript back to the recording row. Steps: pending → processing → done/error.
async function transcribeRecording(id) {
  const ASR_URL = process.env.ASR_URL;
  if (!ASR_URL) return; // ASR disabled — leave row in 'pending'

  const rec = await db.getRecording(id);
  if (!rec) return;
  await db.updateRecording(id, { transcript_status: 'processing', transcript_error: '' });
  broadcast('change', { path: '/api/recordings', method: 'PATCH', by: rec.member_id });

  try {
    // 6-min timeout — long clips on slow CPUs can take a while
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6 * 60 * 1000);
    const r = await fetch(`${ASR_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: rec.filename }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

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
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'timeout (>6 min)' : (e.message || String(e));
    await db.updateRecording(id, { transcript_status: 'error', transcript_error: msg.slice(0, 500) });
    broadcast('change', { path: '/api/recordings', method: 'PATCH', by: rec.member_id });
    console.warn(`[asr] ${id} failed: ${msg}`);
  }
}

app.get('/api/recordings/:id/stream', wrap(async (req, res) => {
  // Allow token via query string for <audio src=...> usage where the browser
  // can't easily attach an Authorization header (same trick we use for SSE).
  let user = req.user;
  if (!user && req.query.token) {
    const memberId = auth.lookupToken(req.query.token);
    if (memberId) user = await db.getMember(memberId);
  }
  if (!user) return res.status(401).json({ error: 'login required' });

  const rec = await db.getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'recording not found' });
  if (rec.member_id !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const filePath = path.join(AUDIO_DIR, rec.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing on disk' });

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;
  res.setHeader('Content-Type', rec.mime || 'audio/webm');
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
  if (rec.member_id !== req.user.id && req.user.role !== 'admin') {
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
  if (rec.member_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin or owner only' });
  }
  // Remove disk file first; if that fails we still drop the DB row so it
  // doesn't dangle, then surface the disk error.
  let diskErr = null;
  try { fs.unlinkSync(path.join(AUDIO_DIR, rec.filename)); }
  catch (e) { if (e.code !== 'ENOENT') diskErr = e.message; }
  await db.deleteRecording(req.params.id);
  res.json({ ok: true, ...(diskErr ? { warning: diskErr } : {}) });
}));

// ===== Settings (admin-managed system config) =====
// Whitelist of writable settings + how to validate / serialize each one.
// Add new entries here when introducing more settings — anything outside the
// whitelist is rejected by PUT /api/settings to prevent stray DB rows.
const SETTINGS_DEFS = {
  email_invitations_enabled: {
    default: 'true',
    parse:   v => (v === 'false' || v === false || v === 0 || v === '0') ? 'false' : 'true',
    label:   'ส่งอีเมลเชิญประชุม (iMIP) ตอนสร้าง/แก้/ลบประชุม',
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
  res.json({ ok: true, updated: written });
}));

// ===== App settings (admin only) =====
// Returns all settings as a flat key:value object plus a few diagnostic keys
// (prefixed _ so they're never written back to DB).
app.get('/api/settings', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = await db.listSettings();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  // Diagnostics (read-only, computed live)
  obj._smtp_configured     = mailer.smtpConfigured();
  obj._email_admin_enabled = mailer.getAdminEnabled();
  // Default values for keys that haven't been written yet — so the client
  // doesn't have to know defaults
  if (obj.email_invitations_enabled === undefined) obj.email_invitations_enabled = 'true';
  res.json(obj);
}));

app.put('/api/settings', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const patch = req.body || {};
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith('_')) continue;       // ignore diagnostic keys
    if (typeof value === 'object') continue; // simple scalar values only
    await db.setSetting(key, String(value), req.user.id);
  }
  // Apply known runtime-affecting settings immediately (no restart needed)
  if ('email_invitations_enabled' in patch) {
    const on = patch.email_invitations_enabled === true || patch.email_invitations_enabled === 'true';
    mailer.setAdminEnabled(on);
    console.log(`[settings] email_invitations_enabled set to ${on} by ${req.user.name}`);
  }
  res.json({ ok: true });
}));

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

app.get('/api/leaves', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(await db.listLeaves());
}));
app.post('/api/leaves', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { member_id, start_at, end_at, reason } = req.body || {};
  // Members can only create leaves for themselves; admin can create for anyone
  const targetId = member_id || req.user.id;
  if (req.user.role !== 'admin' && targetId !== req.user.id) {
    return res.status(403).json({ error: 'สามารถสร้างวันลาให้ตัวเองเท่านั้น' });
  }
  res.status(201).json(await db.createLeave({ member_id: targetId, start_at, end_at, reason }));
}));
app.put('/api/leaves/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const leave = await db.getLeave(req.params.id);
  if (!leave) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && leave.member_id !== req.user.id) {
    return res.status(403).json({ error: 'แก้ไขได้เฉพาะวันลาของตัวเอง' });
  }
  res.json(await db.updateLeave(req.params.id, req.body || {}));
}));
app.delete('/api/leaves/:id', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const leave = await db.getLeave(req.params.id);
  if (!leave) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && leave.member_id !== req.user.id) {
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
  res.json(b);
}));
app.delete('/api/whiteboards/:id', wrap(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!await db.deleteWhiteboard(req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));
// Inject a task or meeting card onto the whiteboard
app.post('/api/whiteboards/:id/inject', wrap(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const board = await db.getWhiteboard(req.params.id);
  if (!board) return res.status(404).json({ error: 'not found' });
  const { kind, data } = req.body || {};  // kind: 'task'|'meeting'|'text', data: object
  if (!kind || !data) return res.status(400).json({ error: 'kind and data required' });
  // Build a Fabric.js-compatible object (will be rendered as a Group client-side)
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

  wss.on('connection', (ws) => {
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
        wbBroadcast(boardId, { type: 'op', clientId, op: msg.op }, clientId);
        // Auto-save to DB (debounced) so reopening the board recovers latest state
        if (msg.op?.canvasJson) {
          scheduleWbAutoSave(boardId, msg.op.canvasJson);
        }
      }

      else if (msg.type === 'confirm' && boardId) {
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
