const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Tokens persist to a small JSON file so a process restart doesn't kick everyone out.
// File is intentionally separate from data.db (zero risk to user data).
const TOKEN_FILE = process.env.TOKEN_FILE || path.join(__dirname, '.tokens.json');
const TOKEN_TTL_DAYS = Math.max(1, +(process.env.TOKEN_TTL_DAYS || 30));
const TOKEN_TTL_MS = TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const verify = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(verify, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const tokens = new Map(); // token → { memberId, createdAt }

(function loadTokens() {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
    const data = JSON.parse(raw);
    const now = Date.now();
    let kept = 0;
    for (const [tok, entry] of Object.entries(data || {})) {
      if (entry?.memberId && Number.isFinite(entry?.createdAt) && entry.createdAt + TOKEN_TTL_MS > now) {
        tokens.set(tok, entry);
        kept++;
      }
    }
    if (kept) console.log(`[auth] restored ${kept} active token(s) from ${TOKEN_FILE}`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[auth] token file unreadable, starting fresh:', e.message);
  }
})();

let writePending = false;
function persistTokens() {
  if (writePending) return;
  writePending = true;
  setImmediate(() => {
    writePending = false;
    try {
      const tmp = TOKEN_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(tokens)), 'utf8');
      fs.renameSync(tmp, TOKEN_FILE);
    } catch (e) {
      console.warn('[auth] could not persist tokens:', e.message);
    }
  });
}

function createToken(memberId) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { memberId, createdAt: Date.now() });
  persistTokens();
  return token;
}

function lookupToken(token) {
  if (!token) return null;
  const entry = tokens.get(token);
  if (!entry) return null;
  if (entry.createdAt + TOKEN_TTL_MS < Date.now()) {
    tokens.delete(token);
    persistTokens();
    return null;
  }
  return entry.memberId;
}

function destroyToken(token) {
  const ok = tokens.delete(token);
  if (ok) persistTokens();
  return ok;
}

function extractToken(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'];
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [tok, entry] of tokens) {
    if (entry.createdAt + TOKEN_TTL_MS < now) {
      tokens.delete(tok);
      removed++;
    }
  }
  if (removed) persistTokens();
}, 60 * 60 * 1000);
cleanupInterval.unref();

module.exports = {
  hashPassword, verifyPassword,
  createToken, lookupToken, destroyToken, extractToken,
};
