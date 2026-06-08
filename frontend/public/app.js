// ============== API ==============
const TOKEN_KEY = 'sml_token';
let token = '';
try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch {}
// Embed mode (iframe in /dev) may have its localStorage blocked by the
// browser's tracking prevention. Accept a token via URL param `_t` so the
// parent can pass it explicitly. Falls back to localStorage if present.
try {
  const _urlToken = new URLSearchParams(location.search).get('_t');
  if (_urlToken) {
    token = _urlToken;
    try { localStorage.setItem(TOKEN_KEY, token); } catch {}
  }
} catch {}

async function http(method, url, body, isForm = false) {
  const headers = {};
  if (!isForm) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(url, { method, headers, body: isForm ? body : (body ? JSON.stringify(body) : undefined) });
  if (res.status === 401 && url !== '/api/login') { clearAuth(); showLogin(); throw new Error('กรุณาเข้าสู่ระบบใหม่'); }
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error || 'Request failed');
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}
const api = {
  get:  (u)    => http('GET', u),
  post: (u, b) => http('POST', u, b),
  put:  (u, b) => http('PUT', u, b),
  del:  (u)    => http('DELETE', u),
  postForm: (u, fd) => http('POST', u, fd, true),
};

// ============== State ==============
const state = {
  user: null,
  members: [], groups: [], tasks: [], connections: [], extensions: [], files: [],
  groupInvitations: [], pointRequests: [], leaves: [], categories: [],
  stats: null,
  currentTab: 'home',
  taskSeg: 'mine',
  taskStatus: [], taskQuery: '', taskSort: 'created', taskGroup: '', taskTarget: '',   // taskStatus = Array (multi)
  peopleSeg: 'members',
  connQuery: '',
  filesQuery: '',
  summarySelectedGroup: null,
  cal: { ym: ymKey(new Date()), selected: null },
};

function ymKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

// ============== Helpers ==============
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// === Budget shorthand parser/formatter ===
// รองรับ k=10³, m=10⁶, b=10⁹ (case-insensitive). คั่นด้วย comma ได้
//   parseBudgetInput("10k")     → 10000
//   parseBudgetInput("1.5m")    → 1500000
//   parseBudgetInput("2B")      → 2000000000
//   parseBudgetInput("50,000")  → 50000
//   parseBudgetInput("")        → null
//   parseBudgetInput("abc")     → null  (invalid)
function parseBudgetInput(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(/,/g, '').replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)([kmbKMB]?)$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  const mult = ({ k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1);
  const result = num * mult;
  return result >= 0 ? result : null;
}
// แสดง budget เป็นข้อความ — แบบ comma-separated (default) หรือ compact K/M/B
function formatBudgetDisplay(n, { compact = false } = {}) {
  if (n == null || !Number.isFinite(+n)) return '';
  const v = +n;
  if (compact) {
    const abs = Math.abs(v);
    const trim = (x) => x.toFixed(2).replace(/\.?0+$/, '');
    if (abs >= 1e9) return trim(v / 1e9) + 'B';
    if (abs >= 1e6) return trim(v / 1e6) + 'M';
    if (abs >= 1e3) return trim(v / 1e3) + 'K';
    return String(v);
  }
  return v.toLocaleString('th-TH');
}

// Debug logging — เปิดด้วย ?debug=1 ใน URL, localStorage 'sml_debug=1',
// หรือ window.__DEBUG__ = true. ปิดโดย default ใน production
try {
  const _qDebug = new URLSearchParams(location.search).get('debug') === '1';
  const _lsDebug = localStorage.getItem('sml_debug') === '1';
  window.__DEBUG__ = window.__DEBUG__ || _qDebug || _lsDebug;
} catch {}
// Override console.log + console.warn + console.info ให้ no-op ถ้าไม่ debug
// (console.error ยังทำงานปกติ — เราอยาก see real errors เสมอ)
if (!window.__DEBUG__) {
  const _noop = () => {};
  console.log = _noop;
  console.info = _noop;
  console.debug = _noop;
  // console.warn เก็บไว้เผื่อ deprecation/migration messages สำคัญ
}

// Global keyboard shortcuts (main app)
//   /         focus search box (Todo tab)
//   g h       → Home tab
//   g t       → Todo (tasks)
//   g p       → People
//   g c       → Calendar
//   g s       → Summary
//   g m       → Profile (Me)
//   g w       → Whiteboard
//   n         → new (สร้างงาน — ปุ่มบน topbar)
//   ?         → show this list
//   Esc       → close modal/sheet
// ข้าม shortcut เมื่อ user พิมพ์อยู่ใน input/textarea (กัน hijack)
let _kbPrefixAt = 0;
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName) && t.type !== 'checkbox' && t.type !== 'radio') {
    if (e.key === 'Escape') t.blur();
    return;
  }
  // 'g' prefix → wait 1.5s for second key
  if (e.key === 'g') { _kbPrefixAt = Date.now(); e.preventDefault(); return; }
  if (_kbPrefixAt && Date.now() - _kbPrefixAt < 1500) {
    _kbPrefixAt = 0;
    const map = { h: 'home', t: 'tasks', p: 'people', c: 'calendar', s: 'summary', m: 'profile', w: 'whiteboard' };
    const tab = map[e.key.toLowerCase()];
    if (tab && TAB_TITLES[tab]) { e.preventDefault(); setTab(tab); return; }
  }
  if (e.key === '/') { e.preventDefault(); document.getElementById('task-search')?.focus(); return; }
  if (e.key === 'n' && (isAdmin?.() || leadsAnyGroup?.())) {
    e.preventDefault(); document.getElementById('topbar-action')?.click(); return;
  }
  if (e.key === '?') {
    e.preventDefault();
    toast('คีย์ลัด: / search · g+(h/t/p/c/s/m/w) jump · n new · Esc close', '');
    return;
  }
});

// Theme — 3 states: '' (auto, ตาม prefers-color-scheme), 'light', 'dark'.
// เก็บใน localStorage 'sml_theme'. JS คำนวณ effective theme + toggle class
// `.theme-dark` บน <html> เพื่อให้ CSS overrides ทำงานใน Auto + OS=dark ด้วย
// (rule [data-theme="dark"] อย่างเดียวจะหลุดตอน Auto)
function _osPrefersDark() {
  return matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
}
function _effectiveTheme(saved) {
  if (saved === 'dark') return 'dark';
  if (saved === 'light') return 'light';
  return _osPrefersDark() ? 'dark' : 'light';
}
function applyTheme(value) {
  // data-theme attr — ยังตั้งไว้เผื่อ select-สูตรที่อาจอ้างถึง
  if (value === 'dark' || value === 'light') {
    document.documentElement.setAttribute('data-theme', value);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  // theme-dark class — ตัวจริงที่ CSS overrides อ้างถึง. คำนวณจาก effective
  const isDark = _effectiveTheme(value) === 'dark';
  document.documentElement.classList.toggle('theme-dark', isDark);
  // Sync segmented control UI
  document.querySelectorAll('.theme-opt').forEach(b => {
    b.classList.toggle('active', (b.dataset.theme || '') === (value || ''));
    b.setAttribute('aria-checked', String((b.dataset.theme || '') === (value || '')));
  });
}
function setTheme(value) {
  const v = (value === 'dark' || value === 'light') ? value : '';
  try {
    if (v) localStorage.setItem('sml_theme', v);
    else localStorage.removeItem('sml_theme');
  } catch {}
  applyTheme(v);
}
// Boot — apply theme based on saved value (or auto if none)
try {
  const saved = localStorage.getItem('sml_theme');
  applyTheme(saved === 'dark' || saved === 'light' ? saved : '');
} catch { applyTheme(''); }
// React to OS theme change when in Auto mode
if (matchMedia) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    let saved = '';
    try { saved = localStorage.getItem('sml_theme') || ''; } catch {}
    // Only re-apply if Auto mode (no explicit value) — explicit dark/light ignores OS
    if (saved !== 'dark' && saved !== 'light') applyTheme('');
  });
}
// Wire up segmented control (idempotent — กดได้หลายครั้ง)
document.addEventListener('click', e => {
  const btn = e.target.closest('.theme-opt');
  if (!btn) return;
  setTheme(btn.dataset.theme || '');
});
// Sync UI on every renderProfile call (ครั้งแรกที่ profile ถูก mount)
function _syncThemeUI() {
  let cur = '';
  try { cur = localStorage.getItem('sml_theme') || ''; } catch {}
  applyTheme(cur);
}
// Backward-compat alias
const toggleTheme = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur === 'dark' ? 'light' : 'dark');
};

// A11y shim — sync `aria-label` from `title` for emoji-only buttons so screen
// readers get a meaningful name. Runs after every render via renderAll() →
// catches dynamically-injected buttons too.
function applyA11yLabels(root = document) {
  const emojiOnly = /^[\s\u{1F000}-\u{1FFFF}\u{2000}-\u{2BFF}✂-➰　-〿Ⓜ-◿↶↷⊡⬜⬛⬅⬇⬆▦⛶✓✕×←→]+$/u;
  root.querySelectorAll('button[title]:not([aria-label])').forEach(btn => {
    const text = (btn.textContent || '').trim();
    if (!text || emojiOnly.test(text)) {
      btn.setAttribute('aria-label', btn.title);
    }
  });
}
// First pass at DOM ready (covers static buttons in index.html)
if (document.readyState !== 'loading') applyA11yLabels();
else document.addEventListener('DOMContentLoaded', () => applyA11yLabels());

// Tiny Markdown renderer for task/meeting descriptions. Handles common subset:
// headings (#/##/###), bold (**), italic (*/_), strikethrough (~~), inline code (`),
// fenced code (```), links [text](url), bullet lists (-/*), blockquotes (>), <hr>.
// Source is HTML-escaped first → no XSS via raw user input. Code blocks are extracted
// behind placeholders so their contents aren't transformed by other rules.
function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // 1) Pull code blocks + inline code aside (placeholders) so other transforms skip them
  const codeBlocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (m, code) => {
    codeBlocks.push(code.replace(/^\n+|\n+$/g, ''));
    return ` CB${codeBlocks.length - 1} `;
  });
  const inlineCodes = [];
  html = html.replace(/`([^`\n]+?)`/g, (m, code) => {
    inlineCodes.push(code);
    return ` IC${inlineCodes.length - 1} `;
  });

  // 2) Block-level transforms (run on each line)
  html = html
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1 class="md-h1">$1</h1>')
    .replace(/^---+$/gm,     '<hr class="md-hr">')
    .replace(/^&gt;\s*(.+)$/gm, '<blockquote class="md-quote">$1</blockquote>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>');

  // 3) Wrap consecutive <li> in a <ul>
  html = html.replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, m =>
    `<ul class="md-list">${m.replace(/\n/g, '')}</ul>`);

  // 4) Inline transforms (text-level)
  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<![a-zA-Z0-9_])_([^_\n]+?)_(?![a-zA-Z0-9_])/g, '<em>$1</em>')
    .replace(/~~([^~]+?)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');

  // 5) Paragraph wrapping — group runs of plain text separated by blank lines
  html = html.split(/\n{2,}/).map(chunk => {
    const t = chunk.trim();
    if (!t) return '';
    // Skip wrapping if it already starts with a block element
    if (/^<(h[1-6]|ul|ol|blockquote|pre|hr|p)\b/.test(t) || /^ CB\d+ $/.test(t)) return t;
    return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');

  // 6) Restore code blocks + inline code
  html = html
    .replace(/ CB(\d+) /g, (m, i) => `<pre class="md-code"><code>${codeBlocks[+i]}</code></pre>`)
    .replace(/ IC(\d+) /g, (m, i) => `<code class="md-inline-code">${inlineCodes[+i]}</code>`);

  return html;
}
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(-1).map(w => w[0].toUpperCase()).join('') || '?'; }
// Format dates as dd/mm/yyyy (Gregorian) consistently throughout the SPA —
// matches the data the DB stores (ISO yyyy-mm-dd) without locale surprises.
function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return String(d);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${dt.getFullYear()}`;
  } catch { return d; }
}
// Date + time. Meetings carry "2026-05-05T14:00"; pure dates fall back to fmtDate.
function fmtDateTime(d) {
  if (!d) return '—';
  const hasTime = typeof d === 'string' && d.includes('T');
  if (!hasTime) return fmtDate(d);
  try {
    const dt = new Date(d);
    if (isNaN(dt)) return String(d);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const HH = String(dt.getHours()).padStart(2, '0');
    const MM = String(dt.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${dt.getFullYear()} ${HH}:${MM}`;
  } catch { return d; }
}
function fmtSize(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/1024/1024).toFixed(1) + ' MB';
}
function statusLabel(s) {
  // เพิ่ม icon นำหน้าเพื่อให้ user color-blind แยกสถานะได้จาก icon ไม่ใช่จาก
  // สีเพียงอย่างเดียว. ใช้ icon ที่ตรงกับ semantic ทั่วไป
  return ({
    pending:          '⚪ Pending',
    idea:             '💭 คิดไอเดีย',
    proposal:         '📝 ทำ Proposal',
    pending_approval: '⏳ รออนุมัติ',
    in_progress:      '🔨 กำลังดำเนินงาน',
    delivery:         '🎤 นำเสนอ / ส่งมอบ',
    maintenance:      '🛠️ Maintenance',
    completed:        '✅ เสร็จ',
    on_hold:          '⏸️ พักไว้',
    cancelled:        '❌ ยกเลิก',
    archived:         '📦 เก็บ',
  })[s] || s;
}
// Points workflow phases:
//   none          → workflow not started (task not completed)
//   proposing     → assignees set their own points
//   leader_review → group leader reviews + edits + approves
//   final_review  → weekly meeting (leader + admin) — confirm or further edits
//   confirmed     → final, points credited to scoreboard
const PHASE_META = {
  none:          { label: '—',                  cls: 'bg-slate-100 text-slate-600',   icon: '' },
  proposing:     { label: 'รอผู้รับผิดชอบกำหนด Point', cls: 'bg-sky-100 text-sky-800',       icon: '🟦' },
  leader_review: { label: 'รอหัวหน้ากลุ่มอนุมัติ',     cls: 'bg-amber-100 text-amber-800',   icon: '🟨' },
  final_review:  { label: 'ที่ประชุมพิจารณา',         cls: 'bg-purple-100 text-purple-800', icon: '🟪' },
  confirmed:     { label: 'ยืนยัน Point แล้ว',        cls: 'bg-emerald-100 text-emerald-800',icon: '✅' },
};
function phaseLabel(p) { return (PHASE_META[p] || PHASE_META.none).label; }
function phaseBadge(p) {
  if (!p || p === 'none') return '';
  const m = PHASE_META[p] || PHASE_META.none;
  return `<span class="phase-badge ${m.cls}">${m.icon} ${m.label}</span>`;
}
// Sum of distributed shares — the "real" earned points for a task.
// Only meaningful for completed tasks (others have shares=0).
function earnedPoints(t) {
  return (t.assignees || []).reduce((s, a) => s + (a.points_share || 0), 0);
}
// Render the points pill — hidden for non-completed tasks (Point กำหนดหลังเสร็จเท่านั้น).
function pointsPillHtml(t) {
  if (t.status !== 'completed') return '';
  return `<span class="points-pill">⭐ ${earnedPoints(t)}</span>`;
}
function memberById(id)  { return state.members.find(m => m.id === id); }
function groupById(id)   { return state.groups.find(g => g.id === id); }
// boss inherits admin permissions — รวมทั้ง isAdmin() ใน UI (เมนู/ปุ่ม/etc)
function isAdmin()       { return state.user && (state.user.role === 'admin' || state.user.role === 'boss'); }
function isBoss()        { return state.user && state.user.role === 'boss'; }
function isMyTask(t)     { return state.user && t.assignees.some(a => a.id === state.user.id); }
function isMyLeader(t)   { return state.user && t.assignees.some(a => a.id === state.user.id && a.task_role === 'leader'); }
function isMySupreme(t)  { return state.user && t.assignees.some(a => a.id === state.user.id && a.is_supreme === 1); }
function leadsAnyGroup() { return state.user && state.groups.some(g => g.leader_id === state.user.id); }
function myGroups()      { return state.groups.filter(g => g.leader_id === state.user.id); }
function isMyGroupLeader(groupId) { const g = groupById(groupId); return !!(g && g.leader_id === state.user.id); }
function canEditTask(t)  { return isAdmin() || (t.group_id && isMyGroupLeader(t.group_id)); }

// Meeting metadata — task.kind === 'meeting' marks a task as a scheduled meeting
// rather than a deliverable. location_type categorizes where it happens.
const LOCATION_META = {
  online:           { icon: '💻', label: 'Online' },
  onsite_internal:  { icon: '🏢', label: 'ในสถานที่' },
  onsite_external:  { icon: '📍', label: 'นอกสถานที่' },
};
function isMeeting(t) { return t && t.kind === 'meeting'; }
// "Lab @ECC-504" is the sentinel auto-filled when location_type='onsite_internal'.
// Legacy meetings switched from internal → online/external sometimes have this
// stale value lingering in `location_detail` (UI bug, now patched at save time).
// Use this helper at every display site so existing bad rows render cleanly
// without having to migrate DB data.
function meetingDetailFor(t) {
  if (!t) return '';
  const d = t.location_detail || '';
  if (t.location_type !== 'onsite_internal' && d.trim() === 'Lab @ECC-504') return '';
  return d;
}

// ===== Leave (วันลา) helpers =====
// Returns the active leave (or null) for a given member at a specific date/time.
function memberLeaveAt(memberId, datetime) {
  if (!memberId || !datetime) return null;
  const t = new Date(datetime).getTime();
  if (isNaN(t)) return null;
  return (state.leaves || []).find(l =>
    l.member_id === memberId &&
    new Date(l.start_at).getTime() <= t &&
    t <= new Date(l.end_at).getTime()
  ) || null;
}
// Returns all leaves overlapping a given day (YYYY-MM-DD).
function leavesOnDay(dayKey) {
  if (!dayKey) return [];
  const dayStart = new Date(dayKey + 'T00:00:00').getTime();
  const dayEnd   = new Date(dayKey + 'T23:59:59').getTime();
  return (state.leaves || []).filter(l => {
    const s = new Date(l.start_at).getTime();
    const e = new Date(l.end_at).getTime();
    return s <= dayEnd && e >= dayStart;
  });
}
// Color for an event card/pill/badge:
//   - Task or meeting WITH group → that group's color
//   - Lab-wide meeting (no group) → purple (#7c3aed) as the recognizable Lab default
//   - Ungrouped task                → slate (#94a3b8)
function eventColor(t) {
  if (t && t.group_id) return groupColor(t.group_id);
  if (t && isMeeting(t)) return '#7c3aed';
  return '#94a3b8';
}
function locationLabel(t) {
  if (!isMeeting(t)) return '';
  const m = LOCATION_META[t.location_type];
  if (!m) return '';
  const cleanDetail = meetingDetailFor(t);
  const detail = cleanDetail ? ` · ${cleanDetail}` : '';
  return `${m.icon} ${m.label}${detail}`;
}
// Compact chip HTML for the location (used on cards). Picks up the meeting's
// event color so it matches the rest of the card's group-colored surfaces.
function locationChipHtml(t) {
  if (!isMeeting(t) || !t.location_type) return '';
  const m = LOCATION_META[t.location_type] || { icon: '📍', label: t.location_type };
  const color = eventColor(t);
  const cleanDetail = meetingDetailFor(t);
  return `<span class="meeting-location-chip" style="--loc-color:${color}">${m.icon} ${escapeHtml(m.label)}${cleanDetail ? ' · ' + escapeHtml(cleanDetail) : ''}</span>`;
}

// Render a small row of category tag pills for display on cards / detail sheet.
// Returns empty string if the task has no categories.
function categoryTagsHtml(categories) {
  if (!categories || !categories.length) return '';
  const tags = categories.map(c => `<span class="cat-tag">🏷️ ${escapeHtml(c.name)}</span>`).join('');
  return `<div class="cat-tag-row mt-1.5">${tags}</div>`;
}

// 10-color palette — same set as server-side. Used in the color picker UI.
// Palette สำหรับ group color picker — จัด 3 tier (อ่อน / กลาง / เข้ม)
// แต่ละ tier เรียงตามวงล้อสี (rose → red → orange → ... → purple)
// คัดเฉพาะสีสวย — ไม่ตุ่น (เลี่ยง yellow ที่ออกน้ำตาล) ไม่เข้มเกิน (เลี่ยง -900)
const GROUP_PALETTE_TIERS = {
  light: [
    '#fda4af','#fca5a5','#fdba74','#fcd34d','#fde047',
    '#bef264','#86efac','#6ee7b7','#5eead4','#67e8f9',
    '#7dd3fc','#93c5fd','#a5b4fc','#c4b5fd','#d8b4fe',
    '#f0abfc','#f9a8d4',
  ],
  medium: [
    '#f43f5e','#ef4444','#f97316','#f59e0b','#eab308',
    '#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4',
    '#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7',
    '#d946ef','#ec4899',
  ],
  // bold: คัดเฉพาะสี saturated สด — ตัด amber-600/yellow-600/lime-600 ออก
  // (พวกนี้เข้มแล้วออกน้ำตาล/มะกอกตุ่น) ใช้ -400/-500 ของ yellow/lime แทน
  bold: [
    '#dc2626','#e11d48','#ea580c','#f97316','#facc15',
    '#84cc16','#16a34a','#059669','#0d9488','#0891b2',
    '#0284c7','#2563eb','#4f46e5','#7c3aed','#9333ea',
    '#c026d3','#db2777',
  ],
};
// Flat list สำหรับ legacy code ที่ใช้ GROUP_PALETTE (เช่น groupColor() hash, server pickUnusedColor)
const GROUP_PALETTE = [
  ...GROUP_PALETTE_TIERS.light,
  ...GROUP_PALETTE_TIERS.medium,
  ...GROUP_PALETTE_TIERS.bold,
];
// Resolve the color for a group. Accepts either a group object or an id.
//   1. Prefer the stored g.color (admin/leader-chosen, guaranteed unique by server)
//   2. Fall back to deterministic FNV-1a hash if color is missing (legacy / pre-migration)
function groupColor(groupIdOrGroup) {
  if (!groupIdOrGroup) return '#94a3b8';
  const g = typeof groupIdOrGroup === 'string' ? groupById(groupIdOrGroup) : groupIdOrGroup;
  if (g && g.color) return g.color;
  const id = typeof groupIdOrGroup === 'string' ? groupIdOrGroup : g?.id || '';
  if (!id) return '#94a3b8';
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return GROUP_PALETTE[h % GROUP_PALETTE.length];
}

function deadlineClass(deadline, status) {
  if (!deadline || status === 'completed' || status === 'cancelled') return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(deadline); d.setHours(0,0,0,0);
  const diff = (d - today) / (1000*60*60*24);
  if (diff < 0)  return 'deadline-over';
  if (diff === 0) return 'deadline-today';
  if (diff <= 3) return 'deadline-soon';
  return '';
}
// Compact deadline display:
//   overdue / today / ≤ 2 days   → relative form ("เลย X วัน" / "วันนี้" / "อีก X วัน")
//   otherwise                    → just the date (datetime if it has a time component)
//   completed/cancelled tasks    → just the date (relative isn't useful for finished work)
function deadlineText(deadline, status) {
  if (!deadline) return '';
  const hasTime = typeof deadline === 'string' && deadline.includes('T');
  const formatted = hasTime ? fmtDateTime(deadline) : fmtDate(deadline);
  if (status === 'completed' || status === 'cancelled') return formatted;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(deadline); d.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)   return `เลย ${Math.abs(diff)} วัน`;
  if (diff === 0) return hasTime ? `วันนี้ ${new Date(deadline).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit', hour12: false})}` : 'วันนี้';
  if (diff <= 2)  return hasTime ? `อีก ${diff} วัน · ${new Date(deadline).toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit', hour12: false})}` : `อีก ${diff} วัน`;
  return formatted;
}
// Meeting-specific date/time display — shows "dd/mm/yyyy 13:00 – 15:00" when
// both start + end are set, "dd/mm/yyyy 13:00" if end is missing. No "เลย N วัน"
// suffix; meetings just happened or didn't, we don't nag the user about it.
function meetingTimeText(start, end) {
  if (!start) return '';
  const fmtTime = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const datePart = fmtDate(start);
  const startTime = (typeof start === 'string' && start.includes('T')) ? fmtTime(start) : '';
  const endTime   = end && typeof end === 'string' && end.includes('T') ? fmtTime(end) : '';
  if (startTime && endTime) return `${datePart} ${startTime} – ${endTime}`;
  if (startTime)            return `${datePart} ${startTime}`;
  return datePart;
}
function avatarHtml(m, size = 28) {
  if (!m) return '';
  // If member has uploaded a profile picture, render it as an <img>; otherwise fall
  // back to a colored initial-letter circle (the original avatar style).
  if (m.avatar_url) {
    return `<img class="ios-avatar ios-avatar-img" src="${escapeHtml(m.avatar_url)}"
              style="width:${size}px; height:${size}px"
              alt="${escapeHtml(m.name)}" title="${escapeHtml(m.name)}">`;
  }
  return `<span class="ios-avatar" style="background:${m.color}; width:${size}px; height:${size}px; font-size:${Math.round(size*0.42)}px" title="${escapeHtml(m.name)}">${escapeHtml(initials(m.name))}</span>`;
}
function assigneeStack(assignees) {
  if (!assignees || assignees.length === 0) return `<span class="text-xs text-slate-400">— ยังไม่มีผู้รับผิดชอบ —</span>`;
  return `<span class="avatar-stack">${assignees.map(a => avatarHtml(a, 26)).join('')}</span>`;
}
// Task-level leader removed — no badge at task level (group leader badge shown elsewhere)
function leaderBadge() { return ''; }
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ===== Abbreviation-aware search =====
// Bidirectional: typing the SHORT form matches data with the LONG form (and vice versa).
// Add new pairs here when needed; matching is case-insensitive.
// Trailing dots on the short form are tolerated (e.g. "อบจ." → "อบจ").
const ABBREVIATIONS = [
  ['ก.', 'กรัม'],
  ['ก.ก.', 'คณะกรรมการข้าราชการกรุงเทพมหานคร'],
  ['ก.ค.', 'เดือนกรกฎาคม'],
  ['ก.ต.', 'คณะกรรมการตุลาการ'],
  ['ก.ตร.', 'คณะกรรมการตำรวจแห่งชาติ'],
  ['ก.พ.', 'เดือนกุมภาพันธ์'],
  ['ก.พ.ด.', 'กองทุนพัฒนาเด็กและเยาวชนในถิ่นทุรกันดาร'],
  ['ก.พ.ร.', 'สำนักงานคณะกรรมการพัฒนาระบบราชการ'],
  ['ก.พ.อ.', 'คณะกรรมการข้าราชการพลเรือนในสถาบันอุดมศึกษา'],
  ['ก.ย.', 'เดือนกันยายน'],
  ['ก.ล.ต.', 'คณะกรรมการกำกับหลักทรัพย์และตลาดหลักทรัพย์'],
  ['ก.ว.', 'คณะกรรมการควบคุมการประกอบวิชาชีพวิศวกรรม'],
  ['กก.', 'กิโลกรัม'],
  ['กกต.', 'คณะกรรมการการเลือกตั้ง'],
  ['กกร.', 'คณะกรรมการร่วมภาคเอกชน 3 สถาบัน'],
  ['กคช.', 'การเคหะแห่งชาติ'],
  ['กจ', 'จังหวัดกาญจนบุรี'],
  ['กต.', 'กระทรวงการต่างประเทศ'],
  ['กทช.', 'สำนักงานคณะกรรมการกิจการโทรคมนาคมแห่งชาติ'],
  ['กทท.', 'การท่าเรือแห่งประเทศไทย'],
  ['กทบ.', 'กองทุนหมู่บ้านและชุมชนเมือแห่งชาติ'],
  ['กทม.', 'กรุงเทพมหานคร'],
  ['กท', 'กรุงเทพมหานคร'],
  ['กนง.', 'คณะกรรมการนโยบายการเงิน (ธนาคารแห่งประเทศไทย)'],
  ['กบ', 'จังหวัดกระบี่'],
  ['กบง.', 'คณะกรรมการบริหารนโยบายพลังงาน'],
  ['กบน.', 'คณะกรรมการบริหารกองทุนน้ำมันเชื้อเพลิง'],
  ['กปน.', 'การประปานครหลวง'],
  ['กปภ.', 'การประปาส่วนภูมิภาค'],
  ['กพ', 'จังหวัดกำแพงเพชร'],
  ['กพช.', 'คณะกรรมการนโยบายพลังงานแห่งชาติ'],
  ['กฟน.', 'การไฟฟ้านครหลวง'],
  ['กฟผ.', 'การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย'],
  ['กฟภ.', 'การไฟฟ้าส่วนภูมิภาค'],
  ['กม.', 'กิโลเมตร'],
  ['กมธ.', 'คณะกรรมาธิการ'],
  ['กยศ.', 'กองทุนเงินกู้ยืมเพื่อการศึกษา'],
  ['กรอ.', 'กองทุนเงินกู้ยืมเพื่อการศึกษาที่ผูกกับรายได้ในอนาคต'],
  ['กศน.', 'สำนักงานส่งเสริมการศึกษานอกระบบและการศึกษาตามอัธยาศัย'],
  ['กส', 'จังหวัดกาฬสินธุ์'],
  ['กสท.', 'การสื่อสารแห่งประเทศไทย'],
  ['กสทช.', 'คณะกรรมการกิจการกระจายเสียง กิจการโทรทัศน์ และกิจการโทรคมนาคมแห่งชาติ'],
  ['กสม.', 'สำนักงานคณะกรรมการสิทธิมนุษยชนแห่งชาติ'],
  ['กสส.', 'คณะกรรมการส่งเสริมและประสานงานสตรีแห่งชาติ'],
  ['กอช.', 'กองทุนการออมแห่งชาติ'],
  ['กอนช.', 'กองอำนวยการน้ำแห่งชาติ'],
  ['กอ.รมน.', 'กองอำนวยการรักษาความมั่นคงภายใน'],
  ['ขก.', 'จังหวัดขอนแก่น'],
  ['ขจก.', 'ขบวนการโจรก่อการร้าย'],
  ['ขรก.', 'ข้าราชการ'],
  ['ขส.ทบ.', 'กรมการขนส่งทหารบก'],
  ['ขส.ทร.', 'กรมการขนส่งทหารเรือ'],
  ['ขส.ทอ.', 'กรมการขนส่งทหารอากาศ'],
  ['ขสมก.', 'องค์การขนส่งมวลชนกรุงเทพ'],
  ['ค.ร.ฟ.', 'คณะกรรมการรถไฟแห่งประเทศไทย'],
  ['ค.ศ.', 'คริสตศักราช'],
  ['ค.ศ.ล.', 'คอนกรีตเสริมเหล็ก'],
  ['คกก.', 'คณะกรรมการ'],
  ['คจก.', 'โครงการจัดสรรที่ดินทำกินแก่ราษฎรผู้ยากไร้ในพื้นที่ป่าสงวนเสื่อมโทรม'],
  ['คตง.', 'คณะกรรมการตรวจเงินแผ่นดิน'],
  ['คตส.', 'คณะกรรมการตรวจสอบการกระทำที่ก่อให้เกิดความเสียหายแก่รัฐ'],
  ['คมช.', 'คณะมนตรีความมั่นคงแห่งชาติ'],
  ['ครน.', 'คูณร่วมน้อย (คณิตศาสตร์)'],
  ['ครป.', 'คณะกรรมการรณรงค์เพื่อประชาธิปไตย'],
  ['ครม.', 'คณะรัฐมนตรี'],
  ['คสช.', 'คณะรักษาความสงบแห่งชาติ'],
  ['จ.', 'จังหวัด'],
  ['จ.จ.', 'จตุตถจุลจอมเกล้า'],
  ['จ.ช.', 'จัตุรถาภรณ์ช้างเผือก'],
  ['จ.ต.', 'จ่าตรี'],
  ['จ.ท.', 'จ่าโท'],
  ['จ.ป.ร.', 'โรงเรียนนายร้อยพระจุลจอมเกล้า'],
  ['จ.ม.', 'จัตุรถาภรณ์มงกุฎไทย'],
  ['จ.ภ.', 'จตุตถดิเรกคุณาภรณ์'],
  ['จ.ส.ต.', 'จ่านายสิบตำรวจ'],
  ['จ.ส.ท.', 'จ่าสิบโท'],
  ['จ.ส.อ.', 'จ่าสิบเอก'],
  ['จ.อ.', 'จ่าเอก'],
  ['จคม.', 'โจรจีนคอมมิวนิสต์มลายา'],
  ['จทบ.', 'จังหวัดทหารบก'],
  ['จนท.', 'เจ้าหน้าที่'],
  ['จบ', 'จังหวัดจันทบุรี'],
  ['จพง.', 'เจ้าพนักงาน'],
  ['จยย.', 'จักรยานยนต์'],
  ['ฉก.', 'เฉพาะกิจ'],
  ['ฉช', 'จังหวัดฉะเชิงเทรา'],
  ['ช.', 'ชาย / เพศชาย'],
  ['ช.ค.', 'ลูกจ้างชั่วคราวของส่วนราชการ'],
  ['ช.ค.บ.', 'เงินพิเศษช่วยค่าครองชีพผู้รับเบี้ยหวัดบำนาญ'],
  ['ชน', 'จังหวัดชัยนาท'],
  ['ชพ', 'จังหวัดชุมพร'],
  ['ชม', 'จังหวัดเชียงใหม่'],
  ['ชม.', 'ชั่วโมง'],
  ['ชย', 'จังหวัดชัยภูมิ'],
  ['ชร', 'จังหวัดเชียงราย'],
  ['ชรบ.', 'ชุดรักษาความปลอดภัยหมู่บ้าน'],
  ['ชล', 'จังหวัดชลบุรี'],
  ['ซ.', 'ซอย'],
  ['ซม.', 'เซนติเมตร'],
  ['ฌกส.', 'ฌาปนกิจสงเคราะห์'],
  ['ญ.', 'หญิง / เพศหญิง'],
  ['ฐปรพ.', 'ฐานปฏิบัติการรบพิเศษ'],
  ['ด', 'เดือน (เช่น ว/ด/ป)'],
  ['ด.ช.', 'เด็กชาย'],
  ['ด.ญ.', 'เด็กหญิง'],
  ['ด.ต.', 'นายดาบตำรวจ'],
  ['ดร.', 'ด็อกเตอร์ (คำเรียกผู้เรียนจบปริญญาเอก)'],
  ['ดล.', 'เดซิลิตร (100 ซีซี)'],
  ['ต.', 'ตำบล'],
  ['ต.ค', 'เดือนตุลาคม'],
  ['ต.จ.', 'ตติยจุลจอมเกล้า'],
  ['ต.จ.ว.', 'ตติยจุลจอมเกล้าวิเศษ'],
  ['ต.ช.', 'ตริตาภรณ์ช้างเผือก'],
  ['ต.ม.', 'ตริตาภรณ์มงกุฎไทย'],
  ['ต.ภ.', 'ตติยดิเรกคุณาภรณ์'],
  ['ต.อ.จ.', 'ตติยานุจุลจอมเกล้า'],
  ['ตก', 'จังหวัดตาก'],
  ['ตง', 'จังหวัดตรัง'],
  ['ตจว.', 'ต่างจังหวัด'],
  ['ตม.', 'ตำรวจตรวจคนเข้าเมือง'],
  ['ตร', 'จังหวัดตราด'],
  ['ตร.', 'ตำรวจ'],
  ['ตร.กม.', 'ตารางกิโลเมตร'],
  ['ตร.ซม.', 'ตารางเซนติเมตร'],
  ['ตร.ม.', 'ตารางเมตร'],
  ['ตร.ว.', 'ตารางวา'],
  ['ตรอ.', 'สถานตรวจสภาพรถเอกชน'],
  ['ถ.', 'ถนน'],
  ['ถ.พ.', 'ความถ่วงจำเพาะ'],
  ['ท.จ.', 'ทุติยจุลจอมเกล้า'],
  ['ท.จ.ว.', 'ทุติยจุลจอมเกล้าวิเศษ'],
  ['ท.ช.', 'ทวีติยาภรณ์ช้างเผือก'],
  ['ท.ม.', 'ทวีติยาภรณ์มงกุฎไทย'],
  ['ท.ภ.', 'ทุติยดิเรกคุณาภรณ์'],
  ['ทต.', 'เทศบาลตำบล'],
  ['ททท.', 'การท่องเที่ยวแห่งประเทศไทย'],
  ['ทน.', 'เทศบาลนคร'],
  ['ทบ.', 'กองทัพบก'],
  ['ทม.', 'เทศบาลเมือง'],
  ['ทร.', 'กองทัพเรือ'],
  ['ทศท.', 'องค์การโทรศัพท์แห่งประเทศไทย'],
  ['ทส.', 'กระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม'],
  ['ทสปช.', 'ไทยอาสาป้องกันชาติ'],
  ['ทอ.', 'กองทัพอากาศ'],
  ['ทอท.', 'การท่าอากาศยานแห่งประเทศไทย'],
  ['ธ.', 'ธนาคาร'],
  ['ธ.ก.ส.', 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร'],
  ['ธ.ค.', 'เดือนธันวาคม'],
  ['ธปท.', 'ธนาคารแห่งประเทศไทย'],
  ['ธพว.', 'ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อมแห่งประเทศไทย'],
  ['ธสอ.', 'ธนาคารเพื่อการส่งออกและนำเข้าแห่งประเทศไทย'],
  ['ธอส.', 'ธนาคารอาคารสงเคราะห์'],
  ['น.', 'นาฬิกา (บอกเวลา)'],
  ['น.ช.', 'นักโทษชาย'],
  ['น.ญ.', 'นักโทษหญิง'],
  ['น.ต.', 'นาวาตรี'],
  ['น.ท.', 'นาวาโท'],
  ['น.น.', 'น้ำหนัก'],
  ['น.ศ.', 'นักศึกษา'],
  ['น.ส.3', 'หนังสือรับรองการทำประโยชน์ในที่ดิน'],
  ['น.สพ.', 'นายสัตวแพทย์'],
  ['น.อ.', 'นาวาเอก'],
  ['นค', 'จังหวัดหนองคาย'],
  ['นฐ', 'จังหวัดนครปฐม'],
  ['นตท.', 'นักเรียนเตรียมทหาร'],
  ['นทท.', 'นักท่องเที่ยว'],
  ['นธ', 'จังหวัดนราธิวาส'],
  ['นน', 'จังหวัดน่าน'],
  ['นนร.', 'นักเรียนนายร้อย'],
  ['นบ', 'จังหวัดนนทบุรี'],
  ['นปข.', 'หน่วยปฏิบัติการตามลำน้ำโขง'],
  ['นพ', 'จังหวัดนครพนม'],
  ['นพ.', 'นายแพทย์'],
  ['นภ', 'จังหวัดหนองบัวลำภู'],
  ['นม', 'จังหวัดนครราชสีมา'],
  ['นย', 'จังหวัดนครนายก'],
  ['นว', 'จังหวัดนครสวรรค์'],
  ['นร.', 'นักเรียน'],
  ['นรข.', 'หน่วยเรือรักษาความสงบเรียบร้อยตามลำแม่น้ำโขง'],
  ['นรม.', 'นายกรัฐมนตรี'],
  ['นศ', 'จังหวัดนครศรีธรรมราช'],
  ['นศ.', 'นักศึกษา'],
  ['นศท.', 'นักศึกษาวิชาทหาร'],
  ['นส.', 'นางสาว'],
  ['นสพ.', 'หนังสือพิมพ์'],
  ['นอภ.', 'นายอำเภอ'],
  ['บ.', 'บาท'],
  ['บ.ช.', 'เบญจมาภรณ์ช้างเผือก'],
  ['บ.ม.', 'เบญจมาภรณ์มงกุฎไทย'],
  ['บ.ภ.', 'เบญจมดิเรกคุณาภรณ์'],
  ['บก', 'จังหวัดบึงกาฬ'],
  ['บก.จร.', 'กองบังคับการตำรวจจราจร'],
  ['บก.ป.', 'กองบังคับการปราบปราม'],
  ['บจก.', 'บริษัท จำกัด'],
  ['บช.ก.', 'กองบัญชาการตำรวจสอบสวนกลาง'],
  ['บช.น.', 'กองบัญชาการตำรวจนครบาล'],
  ['บช.ภ.', 'กองบัญชาการตำรวจภูธร'],
  ['บมจ.', 'บริษัทมหาชน จำกัด'],
  ['บร', 'จังหวัดบุรีรัมย์'],
  ['ป.จ.', 'ปฐมจุลจอมเกล้า'],
  ['ป.จ.ว.', 'ปฐมจุลจอมเกล้าวิเศษ'],
  ['ป.ช.', 'ประถมาภรณ์ช้างเผือก'],
  ['ป.ธ.', 'เปรียญธรรม'],
  ['ป.ป.ท.', 'สำนักงานคณะกรรมการป้องกันและปราบปรามการทุจริตในภาครัฐ'],
  ['ป.ป.ส.', 'สำนักงานคณะกรรมการป้องกันและปราบปรามยาเสพติด'],
  ['ป.ภ.', 'ปฐมดิเรกคุณาภรณ์'],
  ['ป.ม.', 'ประถมาภรณ์มงกุฎไทย'],
  ['ป.วิ.อ.', 'ประมวลกฎหมายวิธีพิจารณาความอาญา'],
  ['ปกส.', 'สำนักงานประกันสังคม'],
  ['ปข', 'จังหวัดประจวบคีรีขันธ์'],
  ['ปจ', 'จังหวัดปราจีนบุรี'],
  ['ปชป.', 'พรรคประชาธิปัตย์'],
  ['ปตอ.', 'ปืนต่อสู้อากาศยาน'],
  ['ปท', 'จังหวัดปทุมธานี'],
  ['ปธ.', 'ประธาน'],
  ['ปธน.', 'ประธานาธิบดี'],
  ['ปน', 'จังหวัดปัตตานี'],
  ['ปปง.', 'สำนักงานป้องกันและปราบปรามการฟอกเงิน'],
  ['ปปช.', 'คณะกรรมการป้องกันและปราบปรามการทุจริตแห่งชาติ'],
  ['ปปป.', 'กองบังคับการป้องกันปราบปรามการทุจริตและประพฤติมิชอบ'],
  ['ปรส.', 'องค์การเพื่อการปฏิรูประบบสถาบันการเงิน'],
  ['ผกก.', 'ผู้กำกับ'],
  ['ผกค.', 'ผู้ก่อการร้ายคอมมิวนิสต์'],
  ['ผจก.', 'ผู้จัดการ'],
  ['ผช.', 'ผู้ช่วย'],
  ['ผช. ผบ.ทบ.', 'ผู้ช่วยผู้บัญชาการทหารบก'],
  ['ผช. ผบ.ทร.', 'ผู้ช่วยบัญชาการทหารเรือ'],
  ['ผช. ผบ.ทอ.', 'ผู้ช่วยผู้บัญชาการทหารอากาศ'],
  ['ผบ.ทบ.', 'ผู้บัญชาการทหารบก'],
  ['ผบ.ทร.', 'ผู้บัญชาการทหารเรือ'],
  ['ผบ.ทอ.', 'ผู้บัญชาการทหารอากาศ'],
  ['ผบ.สส.', 'ผู้บัญชาการทหารสูงสุด'],
  ['ผบก.', 'ผู้บังคับการ'],
  ['ผบช.', 'ผู้บัญชาการ'],
  ['ผบช.น.', 'ผู้บัญชาการตำรวจนครบาล'],
  ['ผบช.ภ.', 'ผู้บัญชาการตำรวจภูธร'],
  ['ผอ.', 'ผู้อำนวยการ'],
  ['พ.', 'วันพุธ'],
  ['พ.ค.', 'เดือนพฤษภาคม'],
  ['พ.จ.ต.', 'พันจ่าตรี'],
  ['พ.จ.ท.', 'พันจ่าโท'],
  ['พ.จ.อ.', 'พันจ่าเอก'],
  ['พ.ต.', 'พันตรี'],
  ['พ.ต.ต.', 'พันตำรวจตรี'],
  ['พ.ต.ท.', 'พันตำรวจโท'],
  ['พ.ต.อ.', 'พันตำรวจเอก'],
  ['พ.ท.', 'พันโท'],
  ['พ.ย.', 'เดือนพฤศจิกายน'],
  ['พ.ร.ก.', 'พระราชกำหนด'],
  ['พ.ร.ฎ.', 'พระราชกฤษฎีกา'],
  ['พ.ร.บ.', 'พระราชบัญญัติ'],
  ['พ.ร.ป.', 'พระราชบัญญัติประกอบรัฐธรรมนูญ'],
  ['พ.อ.', 'พันเอก'],
  ['พ.อ.ต.', 'พันจ่าอากาศตรี'],
  ['พ.อ.ท.', 'พันจ่าอากาศโท'],
  ['พ.อ.อ.', 'พันจ่าอากาศเอก'],
  ['พฤ.', 'วันพฤหัสบดี'],
  ['พกส.', 'พนักงานกระทรวงสาธารณสุข'],
  ['พขร.', 'พนักงานขับรถ'],
  ['พง', 'จังหวัดพังงา'],
  ['พจ', 'จังหวัดพิจิตร'],
  ['พช', 'จังหวัดเพชรบูรณ์'],
  ['พท', 'จังหวัดพัทลุง'],
  ['พท.', 'พรรคเพื่อไทย'],
  ['พบ', 'จังหวัดเพชรบุรี'],
  ['พปชร.', 'พรรคพลังประชารัฐ'],
  ['พย', 'จังหวัดพะเยา'],
  ['พร', 'จังหวัดแพร่'],
  ['พล', 'จังหวัดพิษณุโลก'],
  ['พล.ต.ต.', 'พลตำรวจตรี'],
  ['พล.ต.ท.', 'พลตำรวจโท'],
  ['พล.ต.อ.', 'พลตำรวจเอก'],
  ['พล.ร.ต.', 'พลเรือตรี'],
  ['พล.ร.ท.', 'พลเรือโท'],
  ['พล.ร.อ.', 'พลเรือเอก'],
  ['พล.อ.ต.', 'พลอากาศตรี'],
  ['พล.อ.ท.', 'พลอากาศโท'],
  ['พล.อ.อ.', 'พลอากาศเอก'],
  ['พล.ต.', 'พลตรี'],
  ['พล.ท.', 'พลโท'],
  ['พล.อ.', 'พลเอก'],
  ['ฟ.', 'ฟุต'],
  ['ภ.ง.ด.', 'ภาษีเงินได้'],
  ['ภ.พ.', 'ภาษีมูลค่าเพิ่ม'],
  ['ภก', 'จังหวัดภูเก็ต'],
  ['ภท.', 'พรรคภูมิใจไทย'],
  ['ม.จ.', 'หม่อมเจ้า'],
  ['ม.ป.ช.', 'มหาปรมาภรณ์ช้างเผือก'],
  ['ม.ร.ว.', 'หม่อมราชวงศ์'],
  ['ม.ล.', 'หม่อมหลวง'],
  ['ม.ว.ม.', 'มหาวชิรมงกุฎ'],
  ['มิ.ย.', 'เดือนมิถุนายน'],
  ['เม.ย.', 'เดือนเมษายน'],
  ['มค', 'จังหวัดมหาสารคาม'],
  ['มทบ.', 'มณฑลทหารบก'],
  ['ทพบ.', 'มูลนิธิเพื่อผู้บริโภค'],
  ['มว.', 'สถาบันมาตรวิทยาแห่งชาติ'],
  ['มส', 'จังหวัดแม่ฮ่องสอน'],
  ['มห', 'จังหวัดมุกดาหาร'],
  ['มอก.', 'มาตรฐานผลิตภัณฑ์อุตสาหกรรม'],
  ['ยธ.', 'กระทรวงยุติธรรม'],
  ['ยล', 'จังหวัดยะลา'],
  ['ยศ.ทบ.', 'กรมยุทธศึกษาทหารบก'],
  ['ยศ.ทร.', 'กรมยุทธศึกษาทหารเรือ'],
  ['ยศ.ทอ.', 'กรมยุทธศึกษาทหารอากาศ'],
  ['ยส', 'จังหวัดยโสธร'],
  ['ร.', 'รัชกาล (เช่น ร.9 หมายถึง รัชกาลที่ 9)'],
  ['ร.ต.', 'ร้อยตรี'],
  ['ร.ต.ต.', 'ร้อยตำรวจตรี'],
  ['ร.ต.ท.', 'ร้อยตำรวจโท'],
  ['ร.ต.อ.', 'ร้อยตำรวจเอก'],
  ['ร.ท.', 'ร้อยโท'],
  ['ร.น.', 'ราชนาวี'],
  ['ร.อ.', 'ร้อยเอก'],
  ['รง.', 'โรงงาน'],
  ['รธน.', 'รัฐธรรมนูญ'],
  ['รน', 'จังหวัดระนอง'],
  ['รบ', 'จังหวัดราชบุรี'],
  ['รพ.', 'โรงพยาบาล'],
  ['รพ.สต.', 'โรงพยาบาลส่งเสริมสุขภาพตำบล'],
  ['รมช.', 'รัฐมนตรีช่วยว่าการ'],
  ['รมต.', 'รัฐมนตรี'],
  ['รมว.', 'รัฐมนตรีว่าการ'],
  ['รย', 'จังหวัดระยอง'],
  ['รสพ.', 'องค์การรับส่งสินค้าและพัสดุภัณฑ์'],
  ['รอ', 'จังหวัดร้อยเอ็ด'],
  ['ล.', 'ลิตร'],
  ['ลบ', 'จังหวัดลพบุรี'],
  ['ลบ.ซม.', 'ลูกบาศก์เซนติเมตร'],
  ['ลบ.ม.', 'ลูกบาศก์เมตร'],
  ['ลบ.กม.', 'ลูกบาศก์กิโลเมตร'],
  ['ลป', 'จังหวัดลำปาง'],
  ['ลพ', 'จังหวัดลำพูน'],
  ['ลย', 'จังหวัดเลย'],
  ['ว.ช.', 'สำนักงานคณะกรรมการวัฒนธรรมแห่งชาติ'],
  ['ว.ด.ป.', 'วัน เดือน ปี'],
  ['วค.', 'วิทยาลัยครู'],
  ['วท.', 'วิทยาลัยเทคนิค'],
  ['วปอ.', 'วิทยาลัยป้องกันราชอาณาจักร'],
  ['วว.', 'สถาบันวิจัยวิทยาศาสตร์และเทคโนโลยีแห่งประเทศไทย'],
  ['วอศ.', 'วิทยาลัยอาชีวศึกษา'],
  ['ศ.', 'วันศุกร์'],
  ['ศก', 'จังหวัดศรีสะเกษ'],
  ['ศธ.', 'กระทรวงศึกษาธิการ'],
  ['ศน.', 'ศึกษานิเทศก์'],
  ['ศนท.', 'ศูนย์กลางนิสิตนักศึกษาแห่งประเทศไทย'],
  ['ศบค.', 'ศูนย์บริหารสถานการณ์แพร่ระบาดของโรคติดเชื้อไวรัสโคโรนา 2019'],
  ['ศปก.', 'ศูนย์ปฏิบัติการ'],
  ['ศพฐ.', 'ศูนย์พิสูจน์หลักฐาน'],
  ['ศรภ.', 'ศูนย์รักษาความปลอดภัย กองบัญชาการกองทัพไทย'],
  ['ศวฝ.', 'ศูนย์วิจัยและฝึกอบรมด้านสิ่งแวดล้อม'],
  ['ศสพ.', 'ศูนย์สงครามพิเศษ'],
  ['ศอ.บต.', 'ศูนย์อำนวยการบริหารจังหวัดชายแดนภาคใต้'],
  ['ศอ.ปส.', 'ศูนย์อำนวยการป้องกันและปราบปรามยาเสพติดแห่งชาติ'],
  ['ศอ.รส.', 'ศูนย์อำนวยการรักษาความสงบเรียบร้อย'],
  ['ศอฉ.', 'ศูนย์อำนวยการแก้ไขสถานการณ์ฉุกเฉิน'],
  ['ส.', 'วันเสาร์'],
  ['เสธ.', 'เสนาธิการ'],
  ['ส.ก.', 'สมาชิกสภากรุงเทพมหานคร'],
  ['ส.ข.', 'สมาชิกสภาเขต'],
  ['ส.ค.', 'เดือนสิงหาคม'],
  ['ส.ค.ส.', 'ส่งความสุข'],
  ['ส.ต.', 'สิบตรี'],
  ['ส.ต.ต.', 'สิบตำรวจตรี'],
  ['ส.ต.ท.', 'สิบตำรวจโท'],
  ['ส.ต.อ.', 'สิบตำรวจเอก'],
  ['ส.ท.', 'สมาชิกสภาเทศบาล'],
  ['ส.ส.', 'สมาชิกสภาผู้แทนราษฎร'],
  ['ส.ว.', 'สมาชิกวุฒิสภา'],
  ['ส.ห.', 'สารวัตรทหาร'],
  ['ส.อ.', 'สิบเอก'],
  ['ส.อ.ท.', 'สภาอุตสาหกรรมแห่งประเทศไทย'],
  ['ส.อบต.', 'สมาชิกองค์การบริหารส่วนตำบล'],
  ['สก', 'จังหวัดสระแก้ว'],
  ['สกนช.', 'สำนักงานกองทุนน้ำมันเชื้อเพลิง'],
  ['สกว.', 'สำนักงานกองทุนสนับสนุนการวิจัย'],
  ['สกศ.', 'สำนักงานคณะกรรมการการศึกษาแห่งชาติ'],
  ['สข', 'จังหวัดสงขลา'],
  ['สค', 'จังหวัดสมุทรสาคร'],
  ['สคบ.', 'สำนักงานคณะกรรมการคุ้มครองผู้บริโภค'],
  ['สจ.', 'สมาชิกสภาจังหวัด'],
  ['สจก.', 'สำนักงานจัดหางานกรุงเทพมหานคร'],
  ['สจจ.', 'สำนักงานจัดหางานจังหวัด'],
  ['สจร.', 'สำนักงานคณะกรรมการจัดระบบการจราจรทางบก'],
  ['สจล.', 'สถาบันเทคโนโลยีพระจอมเกล้าคุณทหารลาดกระบัง'],
  ['สช.', 'สำนักงานคณะกรรมการการศึกษาเอกชน'],
  ['สฎ', 'จังหวัดสุราษฎร์ธานี'],
  ['สดร.', 'สถาบันวิจัยดาราศาสตร์แห่งชาติ (องค์การมหาชน)'],
  ['สต', 'จังหวัดสตูล'],
  ['สตง.', 'สำนักงานตรวจเงินแผ่นดิน'],
  ['สตช.', 'สำนักงานตำรวจแห่งชาติ'],
  ['สท', 'จังหวัดสุโขทัย'],
  ['สทท.', 'สถานีวิทยุโทรทัศน์แห่งประเทศไทย'],
  ['สทน.', 'สถาบันเทคโนโลยีนิวเคลียร์แห่งชาติ'],
  ['สทศ.', 'สถาบันทดสอบทางการศึกษาแห่งชาติ (องค์การมหาชน)'],
  ['สธ.', 'กระทรวงสาธารณสุข'],
  ['สธค.', 'สำนักงานธนานุเคราะห์'],
  ['สน', 'จังหวัดสกลนคร'],
  ['สน.', 'สถานีตำรวจนครบาล'],
  ['สนข.', 'สำนักงานนโยบายและแผนการขนส่งและจราจร'],
  ['สนง.', 'สำนักงาน'],
  ['สนช.', 'สภานิติบัญญัติแห่งชาติ'],
  ['สนญ.', 'สำนักงานใหญ่'],
  ['สนนท.', 'สหพันธ์นิสิตนักศึกษาแห่งประเทศไทย'],
  ['สบ', 'จังหวัดสระบุรี'],
  ['สบยช.', 'สถาบันบำบัดรักษาและฟื้นฟูผู้ติดยาเสพติดแห่งชาติบรมราชชนนี'],
  ['สบส.', 'กรมสนับสนุนบริการสุขภาพ'],
  ['สพฐ.', 'สํานักงานคณะกรรมการการศึกษาขั้นพื้นฐาน'],
  ['สพม.', 'สำนักงานเขตพื้นที่การศึกษามัธยมศึกษา'],
  ['สป', 'จังหวัดสมุทรปราการ'],
  ['สปก.', 'สำนักงานการปฏิรูปที่ดินเพื่อเกษตรกรรม'],
  ['สปจ.', 'สำนักงานการประถมศึกษาจังหวัด'],
  ['สปช.', 'สำนักงานคณะกรรมการการประถมศึกษาแห่งชาติ'],
  ['สปส.', 'สำนักงานประกันสังคม'],
  ['สปสช.', 'สำนักงานหลักประกันสุขภาพแห่งชาติ'],
  ['สพ', 'จังหวัดสุพรรณบุรี'],
  ['สภ.', 'สถานีตำรวจภูธร'],
  ['สมอ.', 'สำนักงานมาตรฐานผลิตภัณฑ์อุตสาหกรรม'],
  ['สร', 'จังหวัดสุรินทร์'],
  ['สว.จร.', 'สารวัตรจราจร'],
  ['สว.ญ.', 'สารวัตรใหญ่'],
  ['สว.สส.', 'สารวัตรสืบสวน'],
  ['สวท.', 'สถานีวิทยุกระจายเสียงแห่งประเทศไทย'],
  ['สวทช.', 'สำนักงานพัฒนาวิทยาศาสตร์และเทคโนโลยีแห่งชาติ'],
  ['สวป.', 'สารวัตรปราบปราม'],
  ['สวล.', 'สำนักงานคณะกรรมการสิ่งแวดล้อมแห่งชาติ'],
  ['สวส.', 'สํานักงานส่งเสริมวิสาหกิจเพื่อสังคม'],
  ['สศช.', 'สำนักงานคณะกรรมการพัฒนาการเศรษฐกิจและสังคมแห่งชาติ'],
  ['สส', 'จังหวัดสมุทรสงคราม'],
  ['สสจ.', 'สำนักงานสาธารณสุขจังหวัด'],
  ['สสวท.', 'สถาบันส่งเสริมการสอนวิทยาศาสตร์และเทคโนโลยี'],
  ['สสร.', 'สมาชิกสภาร่างรัฐธรรมนูญ'],
  ['สสส.', 'สำนักงานกองทุนสนับสนุนการสร้างเสริมสุขภาพ'],
  ['สห', 'จังหวัดสิงห์บุรี'],
  ['สอค.', 'สำนักงานคณะกรรมการการอาชีวศึกษา'],
  ['สอน.', 'สำนักงานคณะกรรมการอ้อยและน้ำตาลทราย'],
  ['สอบ.', 'สภาองค์กรของผู้บริโภค'],
  ['หจก.', 'ห้างหุ้นส่วนจำกัด'],
  ['หน.', 'หัวหน้า'],
  ['หรม.', 'หารร่วมมาก (คณิตศาสตร์)'],
  ['หสน.', 'ห้างหุ้นส่วนสามัญนิติบุคคล'],
  ['อ.', 'อำเภอ'],
  ['อคส.', 'องค์การคลังสินค้า'],
  ['อจ', 'จังหวัดอำนาจเจริญ'],
  ['อช.', 'อุทยานแห่งชาติ'],
  ['อด', 'จังหวัดอุดรธานี'],
  ['อต', 'จังหวัดอุตรดิตถ์'],
  ['อท', 'จังหวัดอ่างทอง'],
  ['อน', 'จังหวัดอุทัยธานี'],
  ['อบ', 'จังหวัดอุบลราชธานี'],
  ['อบจ.', 'องค์การบริหารส่วนจังหวัด'],
  ['อบต.', 'องค์การบริหารส่วนตำบล'],
  ['อภ.', 'องค์การเภสัชกรรม'],
  ['อย', 'จังหวัดพระนครศรีอยุธยา'],
  ['อว.', 'กระทรวงการอุดมศึกษา วิทยาศาสตร์ วิจัยและนวัตกรรม'],
  ['อสม.', 'อาสาสมัครสาธารณสุขประจำหมู่บ้าน'],
  ['อสมท.', 'องค์การสื่อสารมวลชนแห่งประเทศไทย'],
  ['อสร.', 'องค์การผลิตอาหารสำเร็จรูป'],
  ['อสส.', 'อัยการสูงสุด'],
  ['ฮ.', 'เฮลิคอปเตอร์'],
  ['ฮ.ศ.', 'ฮิจเราะห์ศักราช'],
  ['ทอ', 'ทหารอากาศ'],
  ['ทบ', 'ทหารบก'],
  ['ทร', 'ทหารเรือ'],
  ['รพ', 'โรงพยาบาล'],
  ['รร', 'โรงเรียน'],
  ['ทม', 'เทศบาลเมือง'],
  ['ทต', 'เทศบาลตำบล'],
  ['ทน', 'เทศบาลนคร'],
  ['สนง', 'สำนักงาน'],
  ['อบจ', 'องค์การบริหารส่วนจังหวัด'],
  ['อบต', 'องค์การบริหารส่วนตำบล'],
];

// Returns all variants of a single search token: itself + (only) the LONG form
// when the token is a known abbreviation. We do NOT expand long → short, because
// short forms like "ทอ" are 2-letter substrings that occur in many unrelated Thai
// words (ทอง, ทอด, ติดตั้งจอ-ที่อ, …) → that direction would over-match.
function expandSearchToken(token) {
  const t = String(token).toLowerCase().trim().replace(/\.+$/, '');
  if (!t) return [];
  const out = new Set([t]);
  for (const [abbr, full] of ABBREVIATIONS) {
    const a = abbr.toLowerCase().replace(/\.+$/, '');
    if (t === a) out.add(full.toLowerCase());  // "ทอ" → also try "ทหารอากาศ"
  }
  return Array.from(out);
}

// Whole-string search: tries direct substring first, then per-token expansion.
// Used by Connection search + (mirrored on the server for task search).
function searchMatches(query, hay) {
  if (!query) return true;
  const q = String(query).toLowerCase().trim();
  const h = String(hay || '').toLowerCase();
  if (!q) return true;
  if (h.includes(q)) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every(t => expandSearchToken(t).some(v => h.includes(v)));
}

// ============== File preview helpers ==============
const PREVIEWABLE_TEXT_EXT = ['md','txt','csv','json','xml','log','yaml','yml','svg','html','css','js','tsv','ini','sh','py'];
function isImageFile(name, mime) { return /^image\//.test(mime||'') || /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(name); }
function isPdfFile(name, mime) { return mime === 'application/pdf' || /\.pdf$/i.test(name); }
function isAudioFile(name, mime) { return /^audio\//.test(mime||'') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name); }
function isVideoFile(name, mime) { return /^video\//.test(mime||'') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(name); }
function isTextFile(name, mime) {
  if (/^text\//.test(mime||'')) return true;
  if (mime === 'application/json' || mime === 'application/xml') return true;
  const ext = (name.split('.').pop()||'').toLowerCase();
  return PREVIEWABLE_TEXT_EXT.includes(ext);
}
// Office helpers — extension-based since browser MIME for .docx/.xlsx/.pptx
// varies wildly (application/vnd.openxmlformats-officedocument.* or empty).
function isWordFile(name, mime) {
  return /\.docx?$/i.test(name) ||
         mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
         mime === 'application/msword';
}
function isExcelFile(name, mime) {
  return /\.(xlsx|xlsm|xls)$/i.test(name) ||
         /^application\/(vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/.test(mime||'');
}
function isPresentationFile(name, mime) {
  return /\.(pptx|ppt)$/i.test(name) ||
         /^application\/(vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.presentationml\.presentation)$/.test(mime||'');
}
function isOfficeFile(name, mime) {
  return isWordFile(name, mime) || isExcelFile(name, mime) || isPresentationFile(name, mime);
}

function isPreviewable(name, mime) {
  return isImageFile(name, mime) || isPdfFile(name, mime) || isAudioFile(name, mime)
      || isVideoFile(name, mime) || isTextFile(name, mime) || isOfficeFile(name, mime);
}

let _previewBlobUrl = null;
let _previewName = '';

// Lazy-load office preview libraries on first use so the initial app load
// stays slim. All pulled from cdnjs (already allowed by our CSP).
function _loadScriptOnce(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload  = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(`${globalName} did not register`));
    s.onerror = () => reject(new Error('โหลด ' + url + ' ไม่ได้'));
    document.head.appendChild(s);
  });
}
// docx-preview renders Word docs by parsing the original OOXML + CSS so the
// output preserves fonts, colours, page layout, headers, footers — far closer
// to the original than mammoth's plain-HTML conversion. Depends on JSZip.
// docx-preview isn't published to cdnjs, so pull from jsdelivr (allowed in CSP).
const loadJSZip      = () => _loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'JSZip');
const loadDocxPreview = async () => { await loadJSZip(); return _loadScriptOnce('https://cdn.jsdelivr.net/npm/docx-preview@0.3.5/dist/docx-preview.min.js', 'docx'); };
const loadSheetJS    = () => _loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'XLSX');

// Render a .docx blob into a container element via docx-preview. The library
// emits ready-styled HTML that mirrors the original page layout (margins,
// fonts, colours, lists, tables, inline images) — much closer to a real
// Word render than mammoth's plain-HTML conversion.
async function renderDocxPreview(blob, originalName) {
  await loadDocxPreview();
  // docx-preview needs a DOM target it can render into — return wrapper HTML
  // and finish the render after innerHTML mounts the wrapper.
  return `<div id="docx-render-host" class="docx-preview-host m-3"></div>`;
}
// Called from openPreview *after* the wrapper HTML has been inserted.
async function _docxRenderInto(blob) {
  const host = document.getElementById('docx-render-host');
  if (!host) return;
  await window.docx.renderAsync(blob, host, null, {
    className: 'docx-page',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    experimental: false,
    useBase64URL: true,
  });
}

// Render an .xlsx blob as a tabbed spreadsheet. Manual table builder (instead
// of XLSX.utils.sheet_to_html) so we can preserve column widths, merged
// cells, number/date formatting, and right-align numeric cells — community
// SheetJS doesn't preserve cell styles, but we can recreate the most
// important visual cues from the workbook metadata.
async function renderExcelPreview(blob, originalName) {
  await loadSheetJS();
  const ab = await blob.arrayBuffer();
  const wb = window.XLSX.read(ab, { type: 'array', cellDates: true, cellNF: true });

  function renderSheet(ws) {
    if (!ws || !ws['!ref']) return '<div class="text-slate-400 p-4">— sheet ว่าง —</div>';
    const ref = window.XLSX.utils.decode_range(ws['!ref']);
    const cols = ws['!cols'] || [];
    const merges = ws['!merges'] || [];
    // Map cells covered by a merge: top-left holds the rowspan/colspan; the
    // rest are skipped so the browser layout matches Excel's grid.
    const mergeMap = new Map();
    for (const m of merges) {
      mergeMap.set(`${m.s.r},${m.s.c}`, { rowspan: m.e.r - m.s.r + 1, colspan: m.e.c - m.s.c + 1 });
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          mergeMap.set(`${r},${c}`, { skip: true });
        }
      }
    }
    // Pre-scan: longest cell text per column. Used to grow columns wider than
    // the workbook's `!cols` would suggest when the actual content needs it —
    // a faithful Excel rendering in HTML can't overflow into adjacent empty
    // cells the way Excel does, so we expand the source column instead.
    const colCount = ref.e.c - ref.s.c + 1;
    const maxLen = new Array(colCount).fill(0);
    // Account for merged headers spanning N columns: divide the text length
    // across those columns so a wide merged title doesn't bloat just one.
    for (let r = ref.s.r; r <= ref.e.r; r++) {
      for (let c = ref.s.c; c <= ref.e.c; c++) {
        const merged = mergeMap.get(`${r},${c}`);
        if (merged?.skip) continue;
        const cell = ws[window.XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        const text = cell.w != null ? cell.w : (cell.v != null ? String(cell.v) : '');
        const span = merged?.colspan || 1;
        const perCol = Math.ceil(text.length / span);
        const idx = c - ref.s.c;
        for (let s = 0; s < span && idx + s < colCount; s++) {
          if (perCol > maxLen[idx + s]) maxLen[idx + s] = perCol;
        }
      }
    }
    let html = '<table class="xlsx-table">';
    // Column widths: take the LARGER of
    //   • Excel-specified `!cols` width (preserve the workbook's intent)
    //   • content-fit width (longest cell in that column, capped at 280px)
    // …with a 40-px floor so empty columns stay visible. Pairs with
    // `table-layout: fixed` in style.css — without that the browser would
    // ignore these widths and collapse empty columns to zero.
    html += '<colgroup>';
    for (let c = ref.s.c; c <= ref.e.c; c++) {
      const idx = c - ref.s.c;
      const excelW   = cols[c]?.wpx || (cols[c]?.wch ? Math.round(cols[c].wch * 7.5) : 0);
      const contentW = Math.min(280, maxLen[idx] * 8 + 18);
      const w = Math.max(40, excelW, contentW);
      html += `<col style="width:${w}px">`;
    }
    html += '</colgroup>';
    // Header row: A, B, C, ... like Excel
    html += '<thead><tr class="xlsx-header"><th class="xlsx-corner"></th>';
    for (let c = ref.s.c; c <= ref.e.c; c++) {
      html += `<th>${window.XLSX.utils.encode_col(c)}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let r = ref.s.r; r <= ref.e.r; r++) {
      html += `<tr><th class="xlsx-rownum">${r + 1}</th>`;
      for (let c = ref.s.c; c <= ref.e.c; c++) {
        const merge = mergeMap.get(`${r},${c}`);
        if (merge?.skip) continue;
        const addr = window.XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        const display = cell ? (cell.w != null ? cell.w : (cell.v != null ? String(cell.v) : '')) : '';
        const numeric = cell && (cell.t === 'n' || cell.t === 'd');
        const span = merge ? ` rowspan="${merge.rowspan}" colspan="${merge.colspan}"` : '';
        html += `<td${span}${numeric ? ' class="xlsx-num"' : ''}>${escapeHtml(display)}</td>`;
      }
      html += '</tr>';
    }
    return html + '</tbody></table>';
  }

  const sheetTabs = wb.SheetNames.map((n, i) =>
    `<button class="xlsx-tab ${i===0?'active':''}" data-xlsx-tab="${i}">${escapeHtml(n)}</button>`
  ).join('');
  const sheetPanels = wb.SheetNames.map((n, i) => {
    return `<div class="xlsx-panel ${i===0?'active':'hidden'}" data-xlsx-panel="${i}">${renderSheet(wb.Sheets[n])}</div>`;
  }).join('');
  return `<div class="xlsx-preview">
    ${wb.SheetNames.length > 1 ? `<div class="xlsx-tabs">${sheetTabs}</div>` : ''}
    <div class="xlsx-panels">${sheetPanels}</div>
  </div>`;
}

async function openPreview(fileId, originalName, mimetype) {
  let blob;
  try {
    const res = await fetch('/api/files/' + fileId + '/download', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('โหลดไฟล์ไม่สำเร็จ');
    blob = await res.blob();
  } catch (err) { toast(err.message, 'error'); return; }

  if (_previewBlobUrl) { URL.revokeObjectURL(_previewBlobUrl); _previewBlobUrl = null; }
  // For SVG, force MIME so browser renders it as image
  const isSvg = /\.svg$/i.test(originalName) || mimetype === 'image/svg+xml';
  const typedBlob = isSvg ? new Blob([await blob.text()], { type: 'image/svg+xml' }) : blob;
  _previewBlobUrl = URL.createObjectURL(typedBlob);
  _previewName = originalName;

  document.getElementById('preview-title').textContent = originalName;
  let body;
  if (isImageFile(originalName, mimetype)) {
    body = `<div class="flex items-center justify-center min-h-[40vh] p-3"><img src="${_previewBlobUrl}" class="max-w-full max-h-[85vh] object-contain rounded-lg shadow"></div>`;
  } else if (isPdfFile(originalName, mimetype)) {
    body = `<iframe src="${_previewBlobUrl}#view=FitH" class="w-full h-full" style="border:0; min-height: 80vh"></iframe>`;
  } else if (isVideoFile(originalName, mimetype)) {
    body = `<div class="flex items-center justify-center min-h-[40vh] p-3 bg-black"><video src="${_previewBlobUrl}" controls class="max-w-full max-h-[85vh]"></video></div>`;
  } else if (isAudioFile(originalName, mimetype)) {
    body = `<div class="p-8 text-center"><div class="text-6xl mb-4">🎵</div><div class="font-medium text-sm mb-3">${escapeHtml(originalName)}</div><audio src="${_previewBlobUrl}" controls class="w-full max-w-md mx-auto"></audio></div>`;
  } else if (isTextFile(originalName, mimetype)) {
    let text;
    try { text = await blob.text(); } catch { text = '(ไม่สามารถอ่านเป็นข้อความได้)'; }
    if (text.length > 500_000) text = text.slice(0, 500_000) + '\n\n…(ไฟล์ยาวเกิน — ตัดที่ 500 KB)';
    body = `<pre class="whitespace-pre-wrap break-words text-xs sm:text-sm bg-white p-4 m-3 rounded-lg shadow-sm">${escapeHtml(text)}</pre>`;
  } else if (isWordFile(originalName, mimetype)) {
    body = `<div class="p-8 text-center text-slate-500"><div class="text-3xl mb-2">⏳</div>กำลัง render .docx ...</div>`;
    document.getElementById('preview-body').innerHTML = body;
    document.getElementById('preview-sheet').classList.remove('hidden');
    document.getElementById('preview-sheet').classList.add('flex');
    try {
      body = await renderDocxPreview(blob, originalName);
    } catch (err) {
      body = `<div class="text-center py-16 px-6"><div class="text-5xl mb-3">📄</div>
        <p class="text-slate-700 font-medium mb-1">${escapeHtml(originalName)}</p>
        <p class="text-xs text-rose-600 mb-4">render ไม่ได้: ${escapeHtml(err.message)} — กด ⬇ ดาวน์โหลด</p></div>`;
      document.getElementById('preview-body').innerHTML = body;
      return;
    }
    // Mount wrapper then let docx-preview render into #docx-render-host
    document.getElementById('preview-body').innerHTML = body;
    try { await _docxRenderInto(blob); }
    catch (err) {
      document.getElementById('preview-body').innerHTML =
        `<div class="text-center py-16 px-6"><div class="text-5xl mb-3">📄</div>
        <p class="text-slate-700 font-medium mb-1">${escapeHtml(originalName)}</p>
        <p class="text-xs text-rose-600 mb-4">render ไม่ได้: ${escapeHtml(err.message)} — กด ⬇ ดาวน์โหลด</p></div>`;
    }
    return; // already mounted, skip the bottom mount step
  } else if (isExcelFile(originalName, mimetype)) {
    body = `<div class="p-8 text-center text-slate-500"><div class="text-3xl mb-2">⏳</div>กำลัง render .xlsx ...</div>`;
    document.getElementById('preview-body').innerHTML = body;
    document.getElementById('preview-sheet').classList.remove('hidden');
    document.getElementById('preview-sheet').classList.add('flex');
    try {
      body = await renderExcelPreview(blob, originalName);
    } catch (err) {
      body = `<div class="text-center py-16 px-6"><div class="text-5xl mb-3">📊</div>
        <p class="text-slate-700 font-medium mb-1">${escapeHtml(originalName)}</p>
        <p class="text-xs text-rose-600 mb-4">render ไม่ได้: ${escapeHtml(err.message)} — กด ⬇ ดาวน์โหลด</p></div>`;
    }
  } else if (isPresentationFile(originalName, mimetype)) {
    // .pptx is too complex for browser-side libraries to render reliably.
    // Show a friendly fallback that hints at the available action.
    body = `<div class="text-center py-16 px-6">
      <div class="text-5xl mb-3">🎬</div>
      <p class="text-slate-700 font-medium mb-1">${escapeHtml(originalName)}</p>
      <p class="text-xs text-slate-500 mb-4">PowerPoint แสดง preview ในระบบไม่ได้ — กด ⬇ เพื่อดาวน์โหลดและเปิดด้วย PowerPoint / Keynote / LibreOffice</p>
    </div>`;
  } else {
    body = `<div class="text-center py-16 px-6">
      <div class="text-5xl mb-3">📄</div>
      <p class="text-slate-700 font-medium mb-1">${escapeHtml(originalName)}</p>
      <p class="text-xs text-slate-500 mb-4">ไม่รองรับการแสดงตัวอย่างในระบบ — กดปุ่ม ⬇ เพื่อดาวน์โหลด</p>
    </div>`;
  }
  document.getElementById('preview-body').innerHTML = body;
  document.getElementById('preview-sheet').classList.remove('hidden');
  document.getElementById('preview-sheet').classList.add('flex');

  // Wire xlsx tab switching after innerHTML is in the DOM
  if (isExcelFile(originalName, mimetype)) {
    const tabs = document.querySelectorAll('[data-xlsx-tab]');
    tabs.forEach(t => t.onclick = () => {
      const idx = t.dataset.xlsxTab;
      tabs.forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('[data-xlsx-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.xlsxPanel !== idx));
    });
  }
}
function closePreview() {
  document.getElementById('preview-sheet').classList.add('hidden');
  document.getElementById('preview-sheet').classList.remove('flex');
  if (_previewBlobUrl) { URL.revokeObjectURL(_previewBlobUrl); _previewBlobUrl = null; }
  document.getElementById('preview-body').innerHTML = '';
  _previewName = '';
}
document.getElementById('preview-close').addEventListener('click', closePreview);
// Backdrop close ทุก sheet — ใช้ helper ที่เช็ค mousedown + click ที่ backdrop ทั้ง 2 step
// (กัน case ลาก highlight ข้อความใน sheet แล้วปล่อยเมาส์นอกกรอบ → sheet เด้งปิด)
function _bindBackdropClose(backdropId, closeFn) {
  const el = document.getElementById(backdropId);
  if (!el) return;
  let mdOnBackdrop = false;
  el.addEventListener('mousedown', e => { mdOnBackdrop = (e.target.id === backdropId); });
  el.addEventListener('click', e => {
    if (e.target.id === backdropId && mdOnBackdrop) closeFn();
    mdOnBackdrop = false;
  });
}
_bindBackdropClose('preview-sheet', closePreview);
document.getElementById('preview-download').addEventListener('click', () => {
  if (!_previewBlobUrl) return;
  const a = document.createElement('a');
  a.href = _previewBlobUrl;
  a.download = _previewName || 'file';
  a.click();
});

// ============== Auth ==============
function clearAuth() { token=''; state.user=null; localStorage.removeItem(TOKEN_KEY); }
function showLogin() { document.getElementById('login-screen').classList.remove('hidden'); document.getElementById('login-screen').classList.add('flex'); document.getElementById('app-shell').classList.add('hidden'); }
function hideLogin() { document.getElementById('login-screen').classList.add('hidden'); document.getElementById('login-screen').classList.remove('flex'); document.getElementById('app-shell').classList.remove('hidden'); }
async function tryRestore() { if (!token) return false; try { state.user = await api.get('/api/me'); return true; } catch { clearAuth(); return false; } }

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('login-name').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  try {
    const res = await api.post('/api/login', { name, password });
    token = res.token; localStorage.setItem(TOKEN_KEY, token);
    state.user = res.user;
    hideLogin();
    await loadAll();
    startEvents();
    if (!_wbEventsInited) { initWhiteboardEvents(); _wbEventsInited = true; }
    setTab(initialTabFromHash());
  } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
});
document.querySelectorAll('[data-quicklogin]').forEach(b => {
  b.addEventListener('click', () => {
    document.getElementById('login-name').value = b.dataset.quicklogin;
    document.getElementById('login-password').value = '1234';
  });
});
document.getElementById('btn-logout').addEventListener('click', async () => {
  stopEvents();
  try { await api.post('/api/logout'); } catch {}
  clearAuth();
  showLogin();
});


// ============== Real-time (SSE) ==============
let _evt = null;
let _rtConnected = false;
const debouncedReload = debounce(async () => {
  await loadAll();
  if (state.openTaskId) openTaskSheet(state.openTaskId);
  // Also re-render the submission sheet if it's open — without this, file
  // delete/upload changes broadcast from another tab/user wouldn't show up
  // until the user manually closed and re-opened the sheet.
  if (state.openSubmitTaskId) openSubmissionSheet(state.openSubmitTaskId);
  // Sync any injected cards on the whiteboard with fresh task/group state —
  // edits made in another tab/Todo view propagate to the canvas without a
  // manual refresh. Cheap diff: only re-renders cards whose source changed.
  try { wbSyncCardsToState(); } catch {}
}, 350);

function startEvents() {
  stopEvents();
  if (!token) return;
  try {
    _evt = new EventSource('/api/events?token=' + encodeURIComponent(token));
    _evt.onopen = () => { _rtConnected = true; setRtIndicator(true); };
    _evt.onerror = () => { _rtConnected = false; setRtIndicator(false); };
    _evt.onmessage = e => {
      try {
        const msg = JSON.parse(e.data || '{}');
        if (msg.kind === 'change') debouncedReload();
      } catch {}
    };
  } catch (err) { console.warn('SSE not available', err); }
}
function stopEvents() {
  if (_evt) { _evt.close(); _evt = null; }
  _rtConnected = false; setRtIndicator(false);
}
function setRtIndicator(_live) {
  // Real-time status is shown in /dev panel header instead of the main app.
  // Kept as a no-op so existing callers (startEvents/stopEvents) don't error.
}

// ============== Tabs ==============
const TAB_TITLES = {
  home:{title:'Dashboard',icon:'🏠'}, tasks:{title:'Todo',icon:'📋'},
  calendar:{title:'Calendar',icon:'📅'}, people:{title:'People',icon:'👥'},
  summary:{title:'Summary',icon:'📊'}, overview:{title:'Overview',icon:'🗂️'},
  profile:{title:'Profile',icon:'👤'},
  whiteboard:{title:'Whiteboard',icon:'🎨'},
};
function setTab(name) {
  // Overview = boss-only — non-boss ที่ navigate มาผ่าน URL hash หรือ deep link จะถูกส่งกลับ home
  if (name === 'overview' && !isBoss()) name = 'home';
  // Summary index = ถูก embed อยู่ใน Overview > Groups สำหรับ boss แล้ว
  //  → boss ที่จะเข้า #summary (ไม่มี group) จะถูกส่งไป overview แทน
  //  → แต่ยังให้เข้า #summary/<id> (รายละเอียดกลุ่ม) ได้ปกติ
  if (name === 'summary' && isBoss() && !state.summarySelectedGroup) name = 'overview';
  state.currentTab = name;
  document.querySelectorAll('#tabbar button, #desktop-nav .dt-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== 'page-' + name));
  const meta = TAB_TITLES[name];
  document.getElementById('topbar-title').textContent = meta.title;
  document.getElementById('topbar-icon').textContent = meta.icon;
  const addBtn = document.getElementById('topbar-action');
  addBtn.classList.add('hidden');
  if (name === 'tasks' && (isAdmin() || leadsAnyGroup())) {
    addBtn.classList.remove('hidden'); addBtn.dataset.kind = 'task';
  }
  if (name === 'people' && state.peopleSeg === 'members' && isAdmin()) {
    addBtn.classList.remove('hidden'); addBtn.dataset.kind = 'member';
  }
  if (name === 'people' && state.peopleSeg === 'connections') {
    addBtn.classList.remove('hidden'); addBtn.dataset.kind = 'connection';
  }
  if (name === 'calendar') renderCalendar();
  if (name === 'summary') renderSummary();
  if (name === 'overview') renderOverview();
  if (name === 'whiteboard') {
    // ทุกครั้งที่กลับเข้าแท็บ — รีเฟรช list ของบอร์ดให้สด (สร้าง/เปลี่ยนชื่อ
    // จากอุปกรณ์อื่นจะเข้ามาทันที) + ซิงก์การ์ดบน canvas ถ้าเปิดบอร์ดอยู่
    loadWhiteboards().catch(() => {});
    if (wbBoardId && wbCanvas) {
      try { wbSyncCardsToState(); } catch {}
    }
  }
  // Show trash bin only on Todo (Tasks) tab
  const trash = document.getElementById('trash-bin');
  if (trash) trash.classList.toggle('show', name === 'tasks');
  // Persist tab (and summary subview) in URL hash so refresh stays on same page
  const newHash = '#' + name + (name === 'summary' && state.summarySelectedGroup ? '/' + state.summarySelectedGroup : '');
  if (location.hash !== newHash) {
    try { history.replaceState(null, '', newHash); } catch {}
  }
}
window.addEventListener('hashchange', () => {
  const { tab, sub } = parseHash();
  if (!TAB_TITLES[tab]) return;
  if (tab === 'summary') state.summarySelectedGroup = sub || null;
  if (tab !== state.currentTab || tab === 'summary') setTab(tab);
  _maybeAutoOpenFromHash(tab, sub);
});
function parseHash() {
  const h = location.hash.slice(1);
  const [tab, ...rest] = h.split('/');
  return { tab: tab || 'home', sub: rest.join('/') || null };
}
function initialTabFromHash() {
  const { tab, sub } = parseHash();
  if (tab === 'summary') state.summarySelectedGroup = sub || null;
  // Deep links like `/#tasks/<id>` or `/#calendar/<id>` should auto-open the
  // task/meeting detail sheet after the initial render. Wait two frames so
  // setTab() has mounted the page and state.tasks is populated.
  if (sub && (tab === 'tasks' || tab === 'calendar')) {
    requestAnimationFrame(() => requestAnimationFrame(() => _maybeAutoOpenFromHash(tab, sub)));
  }
  return TAB_TITLES[tab] ? tab : 'home';
}
// Open the task detail sheet referenced by a hash like `/#tasks/<id>` or
// `/#calendar/<id>`. Used by:
//   • dev panel "double-click whiteboard card" → window.open(`/#tasks/<id>`)
//   • notification clicks
//   • shared links
function _maybeAutoOpenFromHash(tab, sub) {
  if (!sub) return;
  if (tab !== 'tasks' && tab !== 'calendar') return;
  if (!state.user) return;
  const t = (state.tasks || []).find(x => x.id === sub);
  if (t) openTaskSheet(sub);
}
function gotoSummaryGroup(groupId) {
  state.summarySelectedGroup = groupId || null;
  setTab('summary');
}
document.querySelectorAll('#tabbar button, #desktop-nav .dt-tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
document.body.addEventListener('click', e => {
  const goto = e.target.closest('[data-goto]'); if (goto) setTab(goto.dataset.goto);
  const gotoSeg = e.target.closest('[data-goto-tasks-seg]');
  if (gotoSeg) {
    state.taskSeg = gotoSeg.dataset.gotoTasksSeg;
    document.querySelectorAll('#task-segmented button').forEach(b => b.classList.toggle('active', b.dataset.seg === state.taskSeg));
    setTab('tasks'); renderTasks();
  }
  const jump = e.target.closest('[data-summary-jump]');
  if (jump) gotoSummaryGroup(jump.dataset.summaryJump);
  // Linked group chip ใน connection card → ไป Summary detail ของกลุ่มนั้น
  const goSum = e.target.closest('[data-goto-summary-group]');
  if (goSum) { gotoSummaryGroup(goSum.dataset.gotoSummaryGroup); return; }
  // Connection chip ใน Summary detail → ไป People > Connections (เห็น connection นั้น)
  const openConn = e.target.closest('[data-conn-open]');
  if (openConn) { state.peopleSeg = 'connections'; setTab('people'); }
});
document.getElementById('topbar-action').addEventListener('click', () => {
  const k = document.getElementById('topbar-action').dataset.kind;
  if (k === 'task') openCreateTaskFlow();
  if (k === 'member') openMemberModal();
  if (k === 'connection') openConnectionModal();
});

// Bell
document.getElementById('bell-btn').addEventListener('click', openNotifications);
document.getElementById('notif-close').addEventListener('click', closeNotifications);
_bindBackdropClose('notif-sheet', closeNotifications);
document.getElementById('me-btn').addEventListener('click', () => setTab('profile'));

// ============== Loaders ==============
// แสดง skeleton block ใน list/grid containers ที่จะถูก replace ในไม่กี่ ms
// ดีกว่าจอเปล่า — user เห็นว่า "กำลังโหลด" ทันที. เรียกเฉพาะตอน initial load
// (state.tasks ยังว่าง). หลังจากนั้น SSE-triggered loadAll() จะข้าม skeleton
// เพราะ list ที่ render ไปแล้วยังอยู่ → swap ไม่ flicker
function showInitialSkeletons() {
  const targets = [
    { el: document.getElementById('tasks-list'), kind: 'card' },
    { el: document.getElementById('people-list'), kind: 'row' },
    { el: document.getElementById('home-content'), kind: 'card' },
  ];
  for (const { el, kind } of targets) {
    if (!el || el.children.length > 0) continue;
    const cls = kind === 'card' ? 'skeleton skeleton-card' : 'skeleton skeleton-row';
    el.innerHTML = `<div class="${cls}"></div>`.repeat(kind === 'card' ? 3 : 5);
  }
}

async function loadAll() {
  // First-time load → show skeletons so the screen isn't blank for 1-2 sec
  if (!state.tasks.length && !state.members.length) showInitialSkeletons();
  try {
    const [members, groups, tasks, stats, connections, extensions, files, groupInvitations, pointRequests, leaves, categories, mentions, reminders] = await Promise.all([
      api.get('/api/members'),
      api.get('/api/groups'),
      api.get('/api/tasks'),
      api.get('/api/stats'),
      api.get('/api/connections'),
      api.get('/api/deadline-requests').catch(() => []),
      api.get('/api/files').catch(() => []),
      api.get('/api/group-invitations').catch(() => []),
      api.get('/api/point-requests').catch(() => []),
      api.get('/api/leaves').catch(() => []),
      api.get('/api/categories').catch(() => []),
      api.get('/api/comments/mentions/me').catch(() => []),
      api.get('/api/reminders').catch(() => []),
    ]);
    state.members = members; state.groups = groups; state.tasks = tasks; state.stats = stats;
    state.connections = connections; state.extensions = extensions || []; state.files = files || [];
    state.groupInvitations = groupInvitations || []; state.pointRequests = pointRequests || [];
    state.leaves = leaves || [];
    state.categories = categories || [];
    state.mentions = mentions || [];
    state.reminders = reminders || [];
    renderAll();
    renderBellBadge();
    await Promise.all([loadWhiteboards(), loadPolls()]);
  } catch (e) { toast(e.message, 'error'); }
}

function renderAll() {
  renderMe();
  renderHome();
  renderTaskFilters();
  renderTasks();
  renderPeople();
  renderProfile();
  if (state.currentTab === 'calendar') renderCalendar();
  // Summary page — re-render เผื่อ archive/delete/edit เพิ่ง mutate state.groups
  // ก่อนหน้าเรียก loadAll แต่ไม่มี renderSummary → หน้าค้าง ไม่ realtime
  if (state.currentTab === 'summary') renderSummary();
  if (state.currentTab === 'overview') renderOverview();
  // หลัง render รอบใหญ่ — sync aria-label สำหรับปุ่ม emoji ที่เพิ่ง mount
  applyA11yLabels();
}

// Role-based nav visibility:
//   • Overview tab → boss-only (summary มาอยู่ใน Overview > Groups แทน)
//   • Summary tab  → hide จาก boss (เพราะย้ายไป overview แล้ว)
// เรียกผ่าน renderMe() ทุกครั้งที่ user load
function applyRoleNavVisibility() {
  const boss = isBoss();
  document.querySelectorAll('[data-tab="overview"]').forEach(btn => {
    btn.classList.toggle('hidden', !boss);
  });
  document.querySelectorAll('[data-tab="summary"]').forEach(btn => {
    btn.classList.toggle('hidden', boss);
  });
  // ถ้าอยู่หน้า overview แต่ role ไม่ใช่ boss แล้ว (role downgrade) → ส่งกลับ home
  if (state.currentTab === 'overview' && !boss) setTab('home');
  // ถ้า boss อยู่หน้า summary index (ไม่มี group เลือก) → redirect ไป overview (logic อยู่ใน setTab)
  if (state.currentTab === 'summary' && boss && !state.summarySelectedGroup) setTab('summary');
}

function renderMe() {
  if (!state.user) return;
  applyRoleNavVisibility();
  document.getElementById('me-initials').textContent = initials(state.user.name);
  // Top-bar avatar: replace its background with profile image if uploaded
  const topBtn = document.getElementById('me-btn');
  if (topBtn) {
    if (state.user.avatar_url) {
      topBtn.style.backgroundImage = `url("${state.user.avatar_url}")`;
      topBtn.style.backgroundSize = 'cover';
      topBtn.style.backgroundPosition = 'center';
      topBtn.style.backgroundColor = 'transparent';
      document.getElementById('me-initials').style.opacity = '0';
    } else {
      topBtn.style.backgroundImage = '';
      topBtn.style.backgroundColor = state.user.color;
      document.getElementById('me-initials').style.opacity = '1';
    }
  }
  // Big profile avatar on the Profile page
  const big = document.getElementById('me-avatar-big');
  if (state.user.avatar_url) {
    big.innerHTML = `<img src="${escapeHtml(state.user.avatar_url)}" alt="${escapeHtml(state.user.name)}"
                          style="width:100%; height:100%; object-fit:cover; border-radius:50%">`;
    big.style.background = 'transparent';
  } else {
    big.textContent = initials(state.user.name);
    big.style.background = state.user.color;
  }
  // แถบบนการ์ด avatar (::before) ใช้สีประจำตัวของผู้ใช้
  const meCard = document.querySelector('#page-profile > .space-y-4 > .ios-card');
  if (meCard && state.user.color) meCard.style.setProperty('--me-color', state.user.color);
}

// ============== Home ==============
function renderHome() {
  const s = state.stats?.summary || {};
  document.getElementById('stat-members').textContent = s.members ?? 0;
  document.getElementById('stat-groups').textContent  = s.groups ?? 0;
  document.getElementById('stat-completed').textContent = s.completed ?? 0;
  document.getElementById('stat-overdue').textContent = s.overdue ?? 0;

  const me = state.stats?.scoreboard.find(r => r.member.id === state.user.id);
  document.getElementById('home-greeting').textContent = state.user.name;
  document.getElementById('home-points').textContent = me?.points ?? 0;
  document.getElementById('home-done').textContent = me?.completed_tasks ?? 0;
  document.getElementById('home-todo').textContent = me?.in_progress_tasks ?? 0;
  document.getElementById('home-role-badge').textContent = state.user.role.toUpperCase();
  // ── Technical Precision hero extras: eyebrow+เดือน · subtitle · urgent chip · role color ──
  try {
    const _rb = document.getElementById('home-role-badge');
    if (_rb) _rb.className = 'tp-hero-role role-' + state.user.role;
    const _eb = document.getElementById('home-eyebrow');
    if (_eb) {
      const _M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
      const _n = new Date();
      _eb.textContent = `SMART CITY LAB · KMITL · ${_M[_n.getMonth()]} ${_n.getFullYear()}`;
    }
    const _mine = t => isAdmin() || (t.assignees || []).some(a => a.id === state.user.id) ||
      (t.group_id && state.groups.some(g => g.leader_id === state.user.id && g.id === t.group_id));
    const _urgent = (state.tasks || []).filter(t => t.priority === 'urgent' &&
      !['completed', 'confirmed', 'cancelled'].includes(t.status) && _mine(t)).length;
    const _uEl = document.getElementById('home-urgent'); if (_uEl) _uEl.textContent = _urgent;
    const _dl = (state.stats?.upcoming || []).filter(t => !isMeeting(t) &&
      Number.isFinite(t.days_left) && t.days_left <= 2 && _mine(t)).length;
    const _sub = document.getElementById('home-hero-sub');
    if (_sub) _sub.textContent = (_dl || _urgent)
      ? `วันนี้มี ${_dl} งานใกล้กำหนดส่ง${_urgent ? ` · ${_urgent} งานด่วน` : ''} — ลุยกันเลย 💪`
      : 'วันนี้ยังไม่มีงานเร่งด่วน — เยี่ยมมาก 🎉';
  } catch (e) { /* hero extras เป็นส่วนเสริม ไม่ critical */ }

  // Upcoming deadlines — only urgent items (overdue / today / ≤ 2 days away).
  // Visibility:
  //   Admin   → all tasks
  //   Leader  → tasks they're assigned to + tasks in groups they lead
  //   Member  → only tasks they're assigned to
  const up = document.getElementById('home-upcoming');
  let items = (state.stats?.upcoming || []).filter(t => !isMeeting(t));
  if (!isAdmin()) {
    const myLeadGroupIds = new Set(state.groups.filter(g => g.leader_id === state.user.id).map(g => g.id));
    items = items.filter(t =>
      t.assignees.some(a => a.id === state.user.id) ||
      (t.group_id && myLeadGroupIds.has(t.group_id))
    );
  }
  // Urgency filter: overdue (days_left < 0), today (== 0), or within 2 days (≤ 2)
  items = items.filter(t => Number.isFinite(t.days_left) && t.days_left <= 2);
  if (!items.length) {
    up.innerHTML = `<div class="p-4 text-sm text-slate-500 text-center">ไม่มีงานที่ใกล้ถึง deadline (ภายใน 2 วัน) 🎉</div>`;
  } else {
    up.innerHTML = items.map(t => {
      const cls = deadlineClass(t.deadline, t.status);
      // Home only shows urgent items (≤2 days or overdue) → relative form is what matters
      const dl = deadlineText(t.deadline, t.status);
      const g = groupById(t.group_id);
      const gColor = groupColor(t.group_id);
      return `
        <button class="ios-list-row home-task-row w-full" data-task-detail="${t.id}" style="--group-color:${gColor}">
          <div class="min-w-0 flex-1 pr-2">
            ${g ? `<div class="text-xs font-semibold truncate mb-0.5" style="color:${gColor}">📁 ${escapeHtml(g.name)}</div>` : ''}
            <div class="font-medium text-base truncate">${escapeHtml(t.title)}</div>
            <div class="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
              ${priorityBadgeHtml(t)}
              ${assigneeStack(t.assignees)}
              ${t.target ? `<span class="target-chip">→ ${escapeHtml(t.target)}</span>` : ''}
            </div>
          </div>
          <div class="text-right text-sm ${cls} whitespace-nowrap font-bold">${dl}</div>
        </button>`;
    }).join('');
  }

  // Upcoming meetings (≤ 2 days). Same role-based visibility rules as upcoming tasks,
  // but pulled from state.tasks (kind='meeting') since the server's upcoming list filters
  // by status='in_progress' and meetings can be in any status.
  const meetEl = document.getElementById('home-meetings');
  if (meetEl) {
    const today = new Date(); today.setHours(0,0,0,0);
    let meetings = state.tasks.filter(t => isMeeting(t) && t.deadline && t.status !== 'cancelled');
    // Upcoming-only window: today through 2 days ahead. Past meetings are hidden
    // (they've already happened — no longer "ใกล้จะถึง").
    meetings = meetings.map(t => {
      const d = new Date(t.deadline); d.setHours(0,0,0,0);
      return { ...t, days_left: Math.round((d - today) / 86400000) };
    }).filter(t => t.days_left >= 0 && t.days_left <= 2);
    if (!isAdmin()) {
      const myLeadGroupIds = new Set(state.groups.filter(g => g.leader_id === state.user.id).map(g => g.id));
      meetings = meetings.filter(t =>
        t.assignees.some(a => a.id === state.user.id) ||
        (t.group_id && myLeadGroupIds.has(t.group_id))
      );
    }
    meetings.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    if (!meetings.length) {
      meetEl.innerHTML = `<div class="p-4 text-sm text-slate-500 text-center">ไม่มีการประชุมในอีก 2 วันนี้</div>`;
    } else {
      meetEl.innerHTML = meetings.map(t => {
        const cls = deadlineClass(t.deadline, t.status);
        const dl = deadlineText(t.deadline, t.status);
        const g = groupById(t.group_id);
        const gColor = groupColor(t.group_id);
        const loc = t.location_type ? (LOCATION_META[t.location_type] || { icon: '📍', label: t.location_type }) : null;
        return `
          <button class="ios-list-row home-task-row w-full" data-task-detail="${t.id}" style="--group-color:${gColor}">
            <div class="min-w-0 flex-1 pr-2">
              <div class="text-xs font-semibold truncate mb-0.5" style="color:${gColor}">
                ${g ? '📁 ' + escapeHtml(g.name) : '🔬 ประชุมรวม Lab'}
              </div>
              <div class="font-medium text-base truncate">📅 ${escapeHtml(t.title)}</div>
              <div class="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                ${assigneeStack(t.assignees)}
                ${loc ? (() => { const dd = meetingDetailFor(t); return `<span class="meeting-location-chip">${loc.icon} ${escapeHtml(loc.label)}${dd ? ' · ' + escapeHtml(dd) : ''}</span>`; })() : ''}
              </div>
            </div>
            <div class="text-right text-sm ${cls} whitespace-nowrap font-bold">${dl}</div>
          </button>`;
      }).join('');
    }
  }

  // Groups I'm not in — sorted with leaderless first (best opportunity to claim)
  const openGroups = state.groups.filter(g => !g.am_member)
    .sort((a, b) => (a.leader_id ? 1 : 0) - (b.leader_id ? 1 : 0));
  const openEl = document.getElementById('home-open');
  if (!openGroups.length) {
    openEl.innerHTML = `<div class="p-4 text-sm text-slate-500 text-center">คุณอยู่ในทุกกลุ่มแล้ว 🎉</div>`;
  } else {
    openEl.innerHTML = openGroups.slice(0, 6).map(g => {
      const dlCls = deadlineClass(g.deadline, g.status);
      const myProposal = state.groupInvitations.find(i =>
        i.group_id === g.id && i.member_id === state.user.id && i.kind === 'proposal' && i.status === 'pending');
      let action;
      if (myProposal) action = `<span class="text-xs text-amber-700 font-semibold whitespace-nowrap">⏳ รอพิจารณา</span>`;
      else if (!g.leader_id) action = `<span class="text-xs text-amber-600 font-semibold whitespace-nowrap">✋ หยิบกลุ่ม</span>`;
      else action = `<span class="text-xs text-indigo-600 font-semibold whitespace-nowrap">🙋 เสนอตัว</span>`;
      return `
        <button class="ios-list-row w-full" data-summary-jump="${g.id}">
          <div class="min-w-0 flex-1 pr-2">
            <div class="font-medium text-base truncate">📁 ${escapeHtml(g.name)}</div>
            <div class="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
              ${g.leader_id
                ? `<span>👑 ${escapeHtml(g.leader_name||'?')}</span>`
                : `<span class="text-amber-700">⚠️ ยังไม่มีหัวหน้า</span>`}
              <span class="${dlCls}">⏰ ${g.deadline ? deadlineText(g.deadline, g.status) : '—'}</span>
            </div>
          </div>
          ${action}
        </button>`;
    }).join('');
  }

  renderScoreboard();
  renderHomeExtensions();
  renderPolls();
}

const PIE_COLORS = ['#4f46e5','#0ea5e9','#10b981','#f59e0b','#ec4899','#a855f7','#14b8a6','#ef4444','#8b5cf6','#84cc16','#f97316'];

function renderScoreboard() {
  const board = (state.stats?.scoreboard || []).filter(r => r.points > 0);
  const chartEl = document.getElementById('scoreboard-chart');
  const legendEl = document.getElementById('scoreboard-legend');
  if (legendEl) legendEl.innerHTML = '';   // legend ย้ายไปอยู่ใน donut-wrap แล้ว
  if (!board.length) {
    chartEl.innerHTML = `<div class="text-sm text-slate-400 py-8 text-center w-full">ยังไม่มีคะแนนสะสม</div>`;
    return;
  }
  // assign colors + build conic-gradient ring (cumulative %)
  board.forEach((r, i) => r._color = r.member.color || PIE_COLORS[i % PIE_COLORS.length]);
  const total = board.reduce((s, r) => s + r.points, 0);
  let acc = 0;
  const segs = board.map(r => {
    const start = acc;
    acc += (r.points / total) * 100;
    return `${r._color} ${start.toFixed(2)}% ${acc.toFixed(2)}%`;
  }).join(', ');
  chartEl.innerHTML = `
    <div class="tp-donut-wrap">
      <div class="tp-donut" style="background:conic-gradient(${segs})">
        <div class="tp-donut-c"><b>${total.toLocaleString()}</b><span>TOTAL PTS</span></div>
      </div>
      <div class="tp-donut-lb">
        ${board.map(r => `
          <div class="tp-lbr">
            <span class="tp-lbr-d" style="background:${r._color}"></span>
            <span class="tp-lbr-nm" title="${escapeHtml(r.member.name)}">${escapeHtml(r.member.name)}</span>
            <span class="tp-lbr-v">${r.points.toLocaleString()}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

// Wire "+ สร้างใหม่" button on the polls widget (idempotent — re-bound every render is harmless)
(function bindPollNewBtn() {
  document.addEventListener('click', e => {
    if (e.target?.id === 'poll-new-btn') openCreatePollModal();
  });
})();

function renderHomeExtensions() {
  const card = document.getElementById('home-pending-extensions');
  const list = document.getElementById('home-extensions-list');
  const pending = state.extensions.filter(r => r.status === 'pending');
  if (!isAdmin() || pending.length === 0) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  list.innerHTML = pending.map(r => `
    <div class="p-3">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium truncate">${escapeHtml(r.task_title || '—')}</div>
          <div class="text-xs text-slate-500 mt-0.5">โดย ${escapeHtml(r.requester_name || '?')}</div>
          <div class="text-xs mt-1">${fmtDate(r.current_deadline)} → <b>${fmtDate(r.requested_deadline)}</b></div>
          ${r.reason ? `<div class="text-xs text-slate-600 italic mt-1">"${escapeHtml(r.reason)}"</div>` : ''}
        </div>
        <div class="flex flex-col gap-1">
          <button class="ios-btn-secondary text-xs" data-decide-ext="${r.id}" data-decision="approved">อนุมัติ</button>
          <button class="ios-btn-danger text-xs"  data-decide-ext="${r.id}" data-decision="rejected">ปฏิเสธ</button>
        </div>
      </div>
    </div>`).join('');
}
document.body.addEventListener('click', async e => {
  const btn = e.target.closest('[data-decide-ext]');
  if (!btn) return;
  try {
    await api.post(`/api/deadline-requests/${btn.dataset.decideExt}/decide`, { status: btn.dataset.decision });
    toast(btn.dataset.decision === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว', 'success');
    await loadAll();
  } catch (err) { toast(err.message, 'error'); }
});

// Admin approval cards (point/deadline/group-proposal) — handle ✓/✗ buttons inline.
document.body.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('[data-admin-action][data-id]');
  if (!card) return;
  e.preventDefault();
  e.stopPropagation();
  const kind = card.dataset.adminAction;
  const id   = card.dataset.id;
  const act  = btn.dataset.act;
  try {
    if (kind === 'point_request') {
      await api.post(`/api/point-requests/${id}/decide`, { status: act === 'approve' ? 'approved' : 'rejected' });
    } else if (kind === 'deadline_request') {
      await api.post(`/api/deadline-requests/${id}/decide`, { status: act === 'approve' ? 'approved' : 'rejected' });
    } else if (kind === 'group_proposal') {
      await api.post(`/api/group-invitations/${id}/decide`, { decision: act === 'accept' ? 'accepted' : 'rejected' });
    }
    toast((act === 'approve' || act === 'accept') ? 'อนุมัติแล้ว ✓' : 'ปฏิเสธแล้ว', 'success');
    await loadAll();
  } catch (err) { toast(err.message, 'error'); }
});

// ============== Tasks ==============
document.querySelectorAll('#task-segmented button').forEach(b => {
  b.addEventListener('click', () => {
    state.taskSeg = b.dataset.seg;
    document.querySelectorAll('#task-segmented button').forEach(x => x.classList.toggle('active', x === b));
    renderTasks();
  });
});
// Filter sheet
document.getElementById('task-filter-btn').addEventListener('click', openFilterSheet);
document.getElementById('task-create-btn')?.addEventListener('click', openCreateTaskFlow);
document.querySelectorAll('#task-view-switch button').forEach(b => {
  b.addEventListener('click', () => {
    state.taskView = b.dataset.view;
    document.querySelectorAll('#task-view-switch button').forEach(x => x.classList.toggle('active', x === b));
    renderTasks();
  });
});
document.getElementById('filter-close').addEventListener('click', closeFilterSheet);
_bindBackdropClose('filter-sheet', closeFilterSheet);
document.getElementById('filter-clear').addEventListener('click', () => {
  state.taskStatus = []; state.taskSort = 'created'; state.taskGroup = ''; state.taskTarget = '';
  syncFilterSheetUI(); renderTasks(); renderFilterBadge();
});
// Multi-select status chips — toggle individual statuses
document.querySelectorAll('[data-fs-status]').forEach(b => {
  b.addEventListener('click', () => {
    const v = b.dataset.fsStatus;
    const cur = new Set(state.taskStatus || []);
    if (cur.has(v)) cur.delete(v); else cur.add(v);
    state.taskStatus = Array.from(cur);
    b.classList.toggle('active');
    renderTasks(); renderFilterBadge();
  });
});
document.getElementById('fs-sort').addEventListener('change', e => { state.taskSort = e.target.value; renderTasks(); renderFilterBadge(); });
document.getElementById('fs-group').addEventListener('change', e => { state.taskGroup = e.target.value; renderTasks(); renderFilterBadge(); });
document.getElementById('fs-target').addEventListener('change', e => { state.taskTarget = e.target.value; renderTasks(); renderFilterBadge(); });

function openFilterSheet() {
  syncFilterSheetUI();
  document.getElementById('filter-sheet').classList.remove('hidden');
  document.getElementById('filter-sheet').classList.add('flex');
}
function closeFilterSheet() {
  document.getElementById('filter-sheet').classList.add('hidden');
  document.getElementById('filter-sheet').classList.remove('flex');
}
function syncFilterSheetUI() {
  // taskStatus = Array — chip active ถ้า value อยู่ใน array
  const sel = new Set(state.taskStatus || []);
  document.querySelectorAll('[data-fs-status]').forEach(x => x.classList.toggle('active', sel.has(x.dataset.fsStatus)));
  document.getElementById('fs-sort').value   = state.taskSort   || 'created';
  document.getElementById('fs-group').value  = state.taskGroup  || '';
  document.getElementById('fs-target').value = state.taskTarget || '';
}
function renderFilterBadge() {
  let n = 0;
  if (Array.isArray(state.taskStatus) ? state.taskStatus.length : !!state.taskStatus) n++;
  if (state.taskSort && state.taskSort !== 'created') n++;
  if (state.taskGroup) n++;
  if (state.taskTarget) n++;
  const b = document.getElementById('task-filter-badge');
  if (n === 0) b.classList.add('hidden');
  else { b.classList.remove('hidden'); b.textContent = n; }
}
document.getElementById('task-search').addEventListener('input', debounce(e => {
  state.taskQuery = e.target.value.trim();
  document.getElementById('task-search-clear').classList.toggle('hidden', !state.taskQuery);
  renderTasks();
}, 200));
document.getElementById('task-search-clear').addEventListener('click', () => {
  document.getElementById('task-search').value = '';
  state.taskQuery = '';
  document.getElementById('task-search-clear').classList.add('hidden');
  renderTasks();
});

function renderTaskFilters() {
  // groups
  const fg = document.getElementById('fs-group');
  fg.innerHTML = `<option value="">ทั้งหมด</option>` +
    state.groups.map(g => `<option value="${g.id}" ${g.id===state.taskGroup?'selected':''}>${escapeHtml(g.name)}</option>`).join('');
  // targets — derived from groups (1 group = 1 target)
  const ft = document.getElementById('fs-target');
  const targets = Array.from(new Set(state.groups.map(g => g.target).filter(Boolean))).sort();
  ft.innerHTML = `<option value="">ทั้งหมด</option>` +
    targets.map(t => `<option value="${escapeHtml(t)}" ${t===state.taskTarget?'selected':''}>${escapeHtml(t)}</option>`).join('');
  syncFilterSheetUI();
  renderFilterBadge();
}

// Show/hide segment buttons based on user role + adjust grid column count.
// Falls back to 'mine' if current segment isn't available for this user.
function syncTaskSegmentVisibility() {
  if (state.taskSeg === 'group') state.taskSeg = 'lead'; // legacy rename
  const isLead = leadsAnyGroup();
  const amAdmin = isAdmin();
  const buttons = {
    mine:  document.querySelector('#task-segmented [data-seg="mine"]'),
    lead:  document.querySelector('#task-segmented [data-seg="lead"]'),
    admin: document.querySelector('#task-segmented [data-seg="admin"]'),
  };
  if (buttons.lead)  buttons.lead.classList.toggle('hidden',  !isLead);
  if (buttons.admin) buttons.admin.classList.toggle('hidden', !amAdmin);
  if (state.taskSeg === 'lead'  && !isLead)  state.taskSeg = 'mine';
  if (state.taskSeg === 'admin' && !amAdmin) state.taskSeg = 'mine';
  // Adjust grid columns to match visible buttons
  const visibleCount = 1 + (isLead ? 1 : 0) + (amAdmin ? 1 : 0);
  const seg = document.getElementById('task-segmented');
  if (seg) seg.style.gridTemplateColumns = `repeat(${visibleCount}, 1fr)`;
  document.querySelectorAll('#task-segmented button').forEach(b => b.classList.toggle('active', b.dataset.seg === state.taskSeg));
  // "+ สร้างงาน" (มุมบนขวา) — แสดงเฉพาะ admin หรือหัวหน้ากลุ่ม
  document.getElementById('task-create-btn')?.classList.toggle('hidden', !(isAdmin() || leadsAnyGroup()));
}

async function renderTasks() {
  syncTaskSegmentVisibility();

  // Admin segment is special — heterogeneous approval queue
  if (state.taskSeg === 'admin') return renderAdminApprovals();

  // Build query
  const params = new URLSearchParams();
  if (state.taskQuery)  params.set('q', state.taskQuery);
  // taskStatus = Array — ส่งเป็น comma-separated (backend แยกเอง)
  if (Array.isArray(state.taskStatus) && state.taskStatus.length > 0) {
    params.set('status', state.taskStatus.join(','));
  } else if (typeof state.taskStatus === 'string' && state.taskStatus) {
    params.set('status', state.taskStatus);
  }
  if (state.taskGroup)  params.set('group', state.taskGroup);
  if (state.taskTarget) params.set('target', state.taskTarget);
  if (state.taskSort && state.taskSort !== 'created') {
    if (state.taskSort.endsWith('_desc')) {
      params.set('sort', state.taskSort.replace('_desc','')); params.set('dir', 'desc');
    } else { params.set('sort', state.taskSort); }
  }
  if (state.taskSeg === 'mine') params.set('member', state.user.id);

  let list;
  try { list = await api.get('/api/tasks?' + params.toString()); }
  catch { list = []; }

  // 'lead' segment: only tasks in groups where I'm the LEADER
  if (state.taskSeg === 'lead') {
    const myLeadIds = new Set(state.groups.filter(g => g.leader_id === state.user.id).map(g => g.id));
    list = list.filter(t => t.group_id && myLeadIds.has(t.group_id));
  }

  // Meetings live on Calendar / Home, not in the Kanban — filter them out here.
  // Cancelled tasks go to the trash bin (also hidden).
  const visible = list.filter(t => t.status !== 'cancelled' && !isMeeting(t));
  const cols = pipelineColumnsForUser(state.taskSeg);

  // Apply column matching to filter further (e.g. leader view drops proposing/final_review tasks)
  const matchedAny = visible.some(t => cols.some(c => c.match(t)));
  const el = document.getElementById('tasks-list');
  if (!visible.length || !matchedAny) {
    // Empty state — hero card + CTA. ต่างกันตาม context:
    //   - มี query แต่หาไม่เจอ → suggest clear search
    //   - ไม่มีงานเลย → suggest create new (ถ้า user มีสิทธิ์)
    const hasQuery = !!state.taskQuery;
    const canCreate = isAdmin() || leadsAnyGroup();
    const icon = hasQuery ? '🔍' : '📭';
    const title = hasQuery ? 'ไม่พบงานที่ตรงกับการค้นหา'
                : state.taskSeg === 'mine' ? 'ยังไม่มีงานของคุณ'
                : state.taskSeg === 'lead' ? 'ยังไม่มีงานในกลุ่มที่คุณดูแล'
                : 'ยังไม่มีงานในระบบ';
    const subtitle = hasQuery
      ? `คำค้น: <strong>"${escapeHtml(state.taskQuery)}"</strong> — ลองล้างคำค้นหรือเลือก filter อื่น`
      : canCreate
        ? 'เริ่มสร้างงานแรกเพื่อมอบหมายให้สมาชิก'
        : 'รอให้ admin หรือหัวหน้ากลุ่มมอบหมายงาน';
    const cta = hasQuery
      ? `<button class="ios-btn ios-btn-secondary mt-3" data-clear-search>🔄 ล้างคำค้น</button>`
      : canCreate
        ? `<button class="ios-btn ios-btn-primary mt-3" data-add="task">＋ สร้างงานใหม่</button>`
        : '';
    el.innerHTML = `
      <div class="empty-hero">
        <div class="empty-hero-icon">${icon}</div>
        <div class="empty-hero-title">${title}</div>
        <div class="empty-hero-sub">${subtitle}</div>
        ${cta}
      </div>`;
    // Wire buttons
    el.querySelector('[data-clear-search]')?.addEventListener('click', () => {
      state.taskQuery = '';
      const inp = document.getElementById('task-search');
      if (inp) inp.value = '';
      renderTasks();
    });
    el.querySelector('[data-add="task"]')?.addEventListener('click', () => {
      document.getElementById('topbar-action')?.click();
    });
    return;
  }

  // List view (มุมมอง "การ์ด") — งานทั้งหมดจัดกลุ่มตามโครงการในคอลัมน์เดียว
  if (state.taskView === 'list') {
    const matched = visible.filter(t => cols.some(c => c.match(t)));
    el.innerHTML = `<div class="task-list-view">${tasksGroupedHtml(matched, { showPoints: false, defaultOpen: true })}</div>`;
    return;
  }

  // Compact view (มุมมอง "รายการย่อ") — แถวเดียวต่องาน เรียงตาม deadline
  if (state.taskView === 'compact') {
    const matched = visible.filter(t => cols.some(c => c.match(t)));
    matched.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });
    el.innerHTML = `<div class="task-compact-list">${matched.map(taskCompactRowHtml).join('')}</div>`;
    return;
  }

  el.innerHTML = `<div class="kanban-board">${
    cols.map(c => {
      const tasks = visible.filter(t => c.match(t));
      const dropAttr = c.acceptsDrop ? `data-drop-status="${c.dropStatus}"` : '';
      return `
        <div class="kanban-col" data-col-id="${c.id}" ${dropAttr} style="--col-rgb:${({on_hold:'139,92,246',in_progress:'59,130,246',completed_pending:'16,185,129',confirmed:'245,158,11',leader_review:'168,85,247'})[c.id] || '100,116,139'}">
          <div class="kanban-header ${c.headerCls}">
            <span class="flex items-center gap-1.5 min-w-0"><span>${c.icon}</span><span class="truncate">${c.label}</span></span>
            <span class="kanban-header-right">
              <span class="kanban-count ${c.headerCls}">${tasks.length}</span>
              <span class="kanban-col-menu" aria-hidden="true">⋮</span>
            </span>
          </div>
          <div class="kanban-cards">
            ${tasksGroupedHtml(tasks, {
              showPoints: c.id === 'confirmed',
              // Per-segment "active work" columns get expanded by default so users
              // see what they're working on without an extra click.
              defaultOpen:
                (state.taskSeg === 'mine' && c.id === 'in_progress') ||
                (state.taskSeg === 'lead' && c.id === 'leader_review'),
              // Leader-segment "กำลังดำเนินการ": auto-open ONLY groups with urgent tasks
              // (overdue / due today / due ≤ 3 days) so the leader sees risks immediately.
              openUrgent: state.taskSeg === 'lead' && c.id === 'in_progress',
            })}
          </div>
        </div>`;
    }).join('')
  }</div>`;
}

// Render a list of items grouped by their task-group, each as a collapsible <details>.
// Generic: caller provides how to extract group_id and how to render each item.
//   getGroupId(item) → string|null
//   renderItem(item) → HTML string
//   metaText(items) → optional summary text (e.g. "3 งาน · ⭐ 27"); defaults to "<n> รายการ"
function groupedByGroupHtml(items, { getGroupId, renderItem, metaText, defaultOpen = false, openIf = null, urgencyTag = null } = {}) {
  if (!items.length) return '<div class="kanban-empty">— ว่าง —</div>';

  const buckets = new Map();
  for (const item of items) {
    const gid = getGroupId(item) || '_nogroup';
    if (!buckets.has(gid)) buckets.set(gid, []);
    buckets.get(gid).push(item);
  }

  // Thai-aware sort by group name, ungrouped last
  const entries = Array.from(buckets.entries()).map(([groupId, list]) => ({
    groupId,
    group: groupId === '_nogroup' ? null : groupById(groupId),
    items: list,
  }));
  entries.sort((a, b) => {
    if (!a.group && b.group) return 1;
    if (a.group && !b.group) return -1;
    return (a.group?.name || '').localeCompare(b.group?.name || '', 'th');
  });

  return entries.map(({ groupId, group, items: gItems }) => {
    const color = groupColor(groupId === '_nogroup' ? null : groupId);
    const name  = group ? group.name : '— ไม่อยู่ในกลุ่มไหน —';
    const meta  = metaText ? metaText(gItems) : `${gItems.length} รายการ`;
    // openIf: per-group function for selective expansion (e.g. groups with urgent deadlines)
    const shouldOpen = defaultOpen || (typeof openIf === 'function' && openIf(gItems, groupId));
    // urgencyTag: optional inline badge in the summary (e.g. "🔴 ใกล้/เลย deadline")
    const tag = (typeof urgencyTag === 'function') ? (urgencyTag(gItems, groupId) || '') : '';
    return `
      <details class="confirmed-group${shouldOpen ? ' is-urgent' : ''}" ${shouldOpen ? 'open' : ''} style="--group-color:${color}">
        <summary class="confirmed-group-summary">
          <span class="confirmed-group-name">📁 ${escapeHtml(name)}${tag}</span>
          <span class="confirmed-group-meta">${meta}</span>
        </summary>
        <div class="confirmed-group-cards">
          ${gItems.map(renderItem).join('')}
        </div>
      </details>`;
  }).join('');
}

// Wrapper for plain-task columns.
//   showPoints      — adds ⭐ sum (only meaningful for confirmed column)
//   defaultOpen     — open all groups by default
//   openUrgent      — open ONLY groups containing urgent tasks (overdue / due-soon)
//                     Used for lead-segment "กำลังดำเนินการ" so leaders see at-risk groups
//                     without an extra click.
function tasksGroupedHtml(tasks, { showPoints = false, defaultOpen = false, openUrgent = false } = {}) {
  // A task is "urgent" when its deadline class is non-empty (deadline-over / today / soon).
  const isUrgent = (t) => !!deadlineClass(t.deadline, t.status);
  const groupHasUrgent = (groupTasks) => groupTasks.some(isUrgent);

  // เรียงงานในแต่ละกลุ่มให้แท็กพิเศษอยู่บนสุด: 🌅 เอาก่อนเช้า → 🔥 ด่วน → ปกติ
  // (Array.sort เสถียร → งาน priority เดียวกันคงลำดับเดิมจาก query)
  const prioRank = { before_morning: 0, urgent: 1 };
  const sortedTasks = tasks.slice().sort((a, b) =>
    (prioRank[a.priority] ?? 2) - (prioRank[b.priority] ?? 2));

  return groupedByGroupHtml(sortedTasks, {
    getGroupId: t => t.group_id,
    renderItem: t => taskCardHtml(t),
    metaText: list => {
      if (showPoints) {
        const pts = list.reduce((s, t) => s + earnedPoints(t), 0);
        return pts > 0 ? `${list.length} งาน · ⭐ ${pts}` : `${list.length} งาน`;
      }
      return `${list.length} งาน`;
    },
    defaultOpen,
    openIf: openUrgent ? groupHasUrgent : null,
    urgencyTag: openUrgent ? (groupTasks) => {
      // Show worst-case marker per group
      const overdue  = groupTasks.some(t => deadlineClass(t.deadline, t.status) === 'deadline-over');
      const today    = groupTasks.some(t => deadlineClass(t.deadline, t.status) === 'deadline-today');
      const soon     = groupTasks.some(t => deadlineClass(t.deadline, t.status) === 'deadline-soon');
      if (overdue) return ' <span class="urgency-tag urgency-over">🔴 เลย deadline</span>';
      if (today)   return ' <span class="urgency-tag urgency-today">🟠 ถึงวันนี้</span>';
      if (soon)    return ' <span class="urgency-tag urgency-soon">🟡 ใกล้ deadline</span>';
      return '';
    } : null,
  });
}
// Backward-compat alias — confirmed column always shows the points sum.
function confirmedGroupedHtml(tasks) { return tasksGroupedHtml(tasks, { showPoints: true }); }

// Per-segment column descriptors:
//   mine:  พักไว้ / กำลังดำเนินการ / เสร็จแล้ว / คอนเฟิร์มแล้ว        (4 cols, all my tasks)
//   lead:  พักไว้ / กำลังดำเนินการ / รอฉันคอนเฟิร์ม / คอนเฟิร์มแล้ว    (4 cols, only tasks in my groups)
//   admin: handled by renderAdminApprovals (mixed approval queue)
function pipelineColumnsForUser(seg) {
  const baseStatusCols = (allowDropOnCompleted) => ([
    { id: 'on_hold', label: 'พักไว้', icon: '⏸️',
      headerCls: 'text-violet-700', countBg: 'bg-violet-100',
      acceptsDrop: true, dropStatus: 'on_hold',
      match: t => t.status === 'on_hold' },
    { id: 'in_progress', label: 'กำลังดำเนินการ', icon: '⏳',
      headerCls: 'text-blue-700',  countBg: 'bg-blue-100',
      acceptsDrop: true, dropStatus: 'in_progress',
      match: t => t.status === 'in_progress' },
  ]);

  if (seg === 'lead') {
    return [
      ...baseStatusCols(),
      { id: 'leader_review', label: 'รอฉันคอนเฟิร์มคะแนน', icon: '👀',
        headerCls: 'text-purple-700', countBg: 'bg-purple-100',
        acceptsDrop: false, // workflow-managed
        match: t => t.status === 'completed' && t.points_phase === 'leader_review' },
      { id: 'confirmed', label: 'คอนเฟิร์มแล้ว', icon: '🏆',
        headerCls: 'text-amber-700', countBg: 'bg-amber-100',
        acceptsDrop: false,
        match: t => t.status === 'completed' && t.points_phase === 'confirmed' },
    ];
  }

  // 'mine' (default): 4 cols. "เสร็จแล้ว" lumps all completed-but-not-confirmed phases together.
  return [
    ...baseStatusCols(),
    { id: 'completed_pending', label: 'เสร็จแล้ว', icon: '✅',
      headerCls: 'text-emerald-700', countBg: 'bg-emerald-100',
      acceptsDrop: true, dropStatus: 'completed',  // dropping here marks completed (workflow auto-starts)
      match: t => t.status === 'completed' && t.points_phase !== 'confirmed' },
    { id: 'confirmed', label: 'คอนเฟิร์มแล้ว', icon: '🏆',
      headerCls: 'text-amber-700', countBg: 'bg-amber-100',
      acceptsDrop: false,
      match: t => t.status === 'completed' && t.points_phase === 'confirmed' },
  ];
}

// ===== Admin segment: full system overview, all columns grouped by task-group =====
// Each column uses collapsible <details> per group, like the คอนเฟิร์มแล้ว column.
//   พักไว้ / กำลังดำเนินการ : pure tasks
//   รอคอนเฟิร์ม            : heterogeneous (tasks + point/deadline reqs + group proposals),
//                              tagged with group_id (looked up via state.tasks for requests)
//   คอนเฟิร์มแล้ว           : pure tasks
async function renderAdminApprovals() {
  const el = document.getElementById('tasks-list');

  // View switcher รองรับใน Admin ด้วย: list/compact = เรียกดูงานทั้งระบบ (เปลี่ยน format ได้),
  // kanban (default) = บอร์ดอนุมัติ 4 คอลัมน์ด้านล่าง
  const allSysTasks = state.tasks.filter(t => !isMeeting(t) && t.status !== 'cancelled');
  if (state.taskView === 'list') {
    el.innerHTML = `<div class="task-list-view">${tasksGroupedHtml(allSysTasks, { showPoints: false, defaultOpen: true })}</div>`;
    return;
  }
  if (state.taskView === 'compact') {
    const sorted = allSysTasks.slice().sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });
    el.innerHTML = `<div class="task-compact-list">${sorted.map(taskCompactRowHtml).join('')}</div>`;
    return;
  }

  // Status-based columns — every sub-task system-wide. Meetings are excluded
  // (they have their own surfaces on Home + Calendar).
  const notMeeting = (t) => !isMeeting(t);
  const onHold         = state.tasks.filter(t => t.status === 'on_hold'     && notMeeting(t));
  const inProgress     = state.tasks.filter(t => t.status === 'in_progress' && notMeeting(t));
  const confirmedTasks = state.tasks.filter(t => t.status === 'completed' && t.points_phase === 'confirmed' && notMeeting(t));

  // Heterogeneous pending — tag each item with its group_id for grouping.
  // Lookup group_id via state.tasks for point/deadline requests (which only carry task_id).
  const taskById = new Map(state.tasks.map(t => [t.id, t]));
  const pendingTasks = state.tasks.filter(t => t.status === 'completed' && t.points_phase === 'final_review' && notMeeting(t));
  const pointReqs    = (state.pointRequests || []).filter(r => r.status === 'pending');
  const deadlineReqs = (state.extensions    || []).filter(r => r.status === 'pending');
  const groupProps   = (state.groupInvitations || []).filter(i => i.status === 'pending' && i.kind === 'proposal');

  const pendingItems = [
    ...pendingTasks.map(t => ({ groupId: t.group_id, render: () => taskCardHtml(t) })),
    ...pointReqs.map(r => ({
      groupId: taskById.get(r.task_id)?.group_id || null,
      render: () => adminPointRequestCardHtml(r),
    })),
    ...deadlineReqs.map(r => ({
      groupId: taskById.get(r.task_id)?.group_id || null,
      render: () => adminDeadlineRequestCardHtml(r),
    })),
    ...groupProps.map(i => ({ groupId: i.group_id, render: () => adminGroupProposalCardHtml(i) })),
  ];
  const pendingCount = pendingItems.length;

  // Use the generic grouped renderer for the heterogeneous pending column too.
  // Default-open so admin sees the queue without an extra click — this is their main action col.
  const pendingHtml = groupedByGroupHtml(pendingItems, {
    getGroupId: it => it.groupId,
    renderItem: it => it.render(),
    metaText:   list => `${list.length} รายการ`,
    defaultOpen: true,
  });

  el.innerHTML = `<div class="kanban-board">
    <div class="kanban-col" data-col-id="on_hold" data-drop-status="on_hold" style="--col-rgb:139,92,246">
      <div class="kanban-header text-violet-700">
        <span class="flex items-center gap-1.5 min-w-0"><span>⏸️</span><span class="truncate">พักไว้ · ทุกงานในระบบ</span></span>
        <span class="kanban-header-right"><span class="kanban-count text-violet-700">${onHold.length}</span><span class="kanban-col-menu" aria-hidden="true">⋮</span></span>
      </div>
      <div class="kanban-cards">
        ${tasksGroupedHtml(onHold)}
      </div>
    </div>
    <div class="kanban-col" data-col-id="in_progress" data-drop-status="in_progress" style="--col-rgb:59,130,246">
      <div class="kanban-header text-blue-700">
        <span class="flex items-center gap-1.5 min-w-0"><span>⏳</span><span class="truncate">กำลังดำเนินการ · ทุกงานในระบบ</span></span>
        <span class="kanban-header-right"><span class="kanban-count text-blue-700">${inProgress.length}</span><span class="kanban-col-menu" aria-hidden="true">⋮</span></span>
      </div>
      <div class="kanban-cards">
        ${tasksGroupedHtml(inProgress)}
      </div>
    </div>
    <div class="kanban-col" data-col-id="admin_pending" style="--col-rgb:244,63,94">
      <div class="kanban-header text-rose-700">
        <span class="flex items-center gap-1.5 min-w-0"><span>🏛️</span><span class="truncate">รอคอนเฟิร์ม</span></span>
        <span class="kanban-header-right"><span class="kanban-count text-rose-700">${pendingCount}</span><span class="kanban-col-menu" aria-hidden="true">⋮</span></span>
      </div>
      <div class="kanban-cards">
        ${pendingHtml}
      </div>
    </div>
    <div class="kanban-col" data-col-id="admin_confirmed" style="--col-rgb:245,158,11">
      <div class="kanban-header text-amber-700">
        <span class="flex items-center gap-1.5 min-w-0"><span>🏆</span><span class="truncate">คอนเฟิร์มแล้ว</span></span>
        <span class="kanban-header-right"><span class="kanban-count text-amber-700">${confirmedTasks.length}</span><span class="kanban-col-menu" aria-hidden="true">⋮</span></span>
      </div>
      <div class="kanban-cards">
        ${confirmedGroupedHtml(confirmedTasks)}
      </div>
    </div>
  </div>`;
}

function adminPointRequestCardHtml(r) {
  return `
    <div class="task-card admin-card" data-admin-action="point_request" data-id="${r.id}" style="border-left:4px solid #f59e0b">
      <div class="flex items-start gap-2">
        <span class="text-xl">💎</span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-[14px]">ของบเพิ่ม Point</div>
          <div class="text-[12px] text-slate-700 truncate">${escapeHtml(r.task_title || '?')}</div>
          <div class="text-[11px] text-slate-600 mt-0.5">
            <b>${escapeHtml(r.requester_name || '?')}</b>: ${r.current_points} → <b>${r.requested_points}</b> pts
          </div>
          ${r.reason ? `<div class="text-[10px] italic text-slate-500 mt-1">"${escapeHtml(r.reason)}"</div>` : ''}
        </div>
      </div>
      <div class="flex gap-2 mt-2">
        <button class="ios-btn-primary flex-1 text-xs" data-act="approve">✓ Approve</button>
        <button class="ios-btn-danger flex-1 text-xs" data-act="reject">✗ Reject</button>
      </div>
    </div>`;
}

function adminDeadlineRequestCardHtml(r) {
  return `
    <div class="task-card admin-card" data-admin-action="deadline_request" data-id="${r.id}" style="border-left:4px solid #fb923c">
      <div class="flex items-start gap-2">
        <span class="text-xl">⏰</span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-[14px]">ขอเลื่อน Deadline</div>
          <div class="text-[12px] text-slate-700 truncate">${escapeHtml(r.task_title || '?')}</div>
          <div class="text-[11px] text-slate-600 mt-0.5">
            <b>${escapeHtml(r.requester_name || '?')}</b>: ${fmtDate(r.current_deadline)} → <b>${fmtDate(r.requested_deadline)}</b>
          </div>
          ${r.reason ? `<div class="text-[10px] italic text-slate-500 mt-1">"${escapeHtml(r.reason)}"</div>` : ''}
        </div>
      </div>
      <div class="flex gap-2 mt-2">
        <button class="ios-btn-primary flex-1 text-xs" data-act="approve">✓ Approve</button>
        <button class="ios-btn-danger flex-1 text-xs" data-act="reject">✗ Reject</button>
      </div>
    </div>`;
}

function adminGroupProposalCardHtml(i) {
  return `
    <div class="task-card admin-card" data-admin-action="group_proposal" data-id="${i.id}" style="border-left:4px solid #a855f7">
      <div class="flex items-start gap-2">
        <span class="text-xl">📁</span>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-[14px]">ขอเข้ากลุ่ม</div>
          <div class="text-[12px] text-slate-700 truncate">
            <b>${escapeHtml(i.member_name || '?')}</b> → ${escapeHtml(i.group_name || '?')}
          </div>
          ${i.message ? `<div class="text-[10px] italic text-slate-500 mt-1">"${escapeHtml(i.message)}"</div>` : ''}
        </div>
      </div>
      <div class="flex gap-2 mt-2">
        <button class="ios-btn-primary flex-1 text-xs" data-act="accept">✓ ตอบรับ</button>
        <button class="ios-btn-danger flex-1 text-xs" data-act="reject">✗ ปฏิเสธ</button>
      </div>
    </div>`;
}

// Compact one-line row for the "รายการย่อ" view. Uses data-task-detail so the
// existing document-level click delegation opens the task sheet.
function taskCompactRowHtml(t) {
  const g = groupById(t.group_id);
  const color = groupColor(t.group_id);
  const dl = t.deadline ? deadlineText(t.deadline, t.status) : '';
  const dlCls = t.deadline ? deadlineClass(t.deadline, t.status) : '';
  const pts = (t.status === 'completed') ? earnedPoints(t) : 0;
  return `<button class="task-compact-row" data-task-detail="${t.id}" style="--group-color:${color}">
    <span class="tcr-dot"></span>
    <span class="tcr-title">${escapeHtml(t.title)}</span>
    ${priorityBadgeHtml(t)}
    ${g ? `<span class="tcr-group">📁 ${escapeHtml(g.name)}</span>` : ''}
    <span class="status-badge status-${t.status}">${statusLabel(t.status)}</span>
    ${pts ? `<span class="tcr-pts">⭐ ${pts}</span>` : ''}
    ${dl ? `<span class="tcr-dl ${dlCls}">⏰ ${dl}</span>` : ''}
  </button>`;
}

// แท็กพิเศษ (priority) badge — โชว์บนการ์ด/แถว/detail
function priorityBadgeHtml(t) {
  if (t.priority === 'urgent')         return `<span class="prio-badge prio-urgent">🔥 งานด่วน</span>`;
  if (t.priority === 'before_morning') return `<span class="prio-badge prio-morning">🌅 เอาก่อนเช้า</span>`;
  return '';
}

function taskCardHtml(t) {
  const g = groupById(t.group_id);
  const meeting = isMeeting(t);
  // Meetings don't get an "overdue/today/soon" colour class — once they're
  // past they're just history, no need to nag the organiser visually.
  const dlCls = meeting ? '' : deadlineClass(t.deadline, t.status);
  const mine = isMyTask(t);
  const gColor = groupColor(t.group_id);
  // Meetings always show a single "การประชุม" badge instead of the regular status.
  // The badge picks up the group's color via --m-color so a meeting in group X
  // matches X's other surfaces (cards, pills, headers) — only the 📅 icon
  // differentiates it from tasks in the same group.
  const statusHtml = meeting
    ? `<span class="status-badge status-meeting" style="--m-color:${eventColor(t)}">📅 การประชุม</span>`
    : `<span class="status-badge status-${t.status}">${statusLabel(t.status)}</span>`;
  return `
    <button class="task-card w-full text-left block ${mine?'is-mine':''} ${meeting?'is-meeting':''}" data-task-detail="${t.id}" draggable="true" style="--group-color:${gColor}; border-left-color:${gColor}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="font-semibold text-[15px] leading-snug">
            ${meeting ? '<span class="meeting-icon" title="การประชุม">📅</span> ' : ''}${escapeHtml(t.title)}
          </div>
          <div class="flex items-center gap-2 mt-0.5 flex-wrap">
            ${priorityBadgeHtml(t)}
            ${g ? `<span class="text-[11px] font-semibold" style="color:${gColor}">📁 ${escapeHtml(g.name)}</span>`
                : (meeting ? '<span class="text-[11px] font-semibold text-purple-700">🔬 ประชุมรวม Lab</span>' : '')}
            ${t.target ? `<span class="target-chip">→ ${escapeHtml(t.target)}</span>` : ''}
            ${locationChipHtml(t)}
          </div>
        </div>
        ${statusHtml}
      </div>
      ${t.description ? `<div class="task-description text-xs text-slate-600 mt-1 line-clamp-2">${escapeHtml(t.description)}</div>` : ''}
      <!-- Category tags intentionally NOT shown on cards (Todo/Calendar/Home views).
           They're only revealed in the task detail sheet to keep the card surface uncluttered. -->
      <div class="flex items-center justify-between mt-2 gap-2 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          ${assigneeStack(t.assignees)}
          ${mine ? `<span class="text-[10px] text-indigo-600 font-semibold">• ของคุณ</span>` : ''}
        </div>
        <div class="flex items-center gap-2">
          ${pointsPillHtml(t)}
          <span class="text-[11px] ${dlCls}">${t.deadline ? (meeting ? '📅 ' + meetingTimeText(t.deadline, t.end_time) : '⏰ ' + deadlineText(t.deadline, t.status)) : 'no deadline'}</span>
        </div>
      </div>
      ${t.status === 'completed' && t.points_phase && t.points_phase !== 'none' && t.points_phase !== 'confirmed'
        ? `<div class="mt-1.5">${phaseBadge(t.points_phase)}</div>` : ''}
    </button>`;
}

// ============== Task Detail Sheet ==============
document.body.addEventListener('click', async e => {
  const btn = e.target.closest('[data-task-detail]');
  if (!btn) return;
  await openTaskSheet(btn.dataset.taskDetail);
});
document.getElementById('sheet-close').addEventListener('click', closeSheet);
_bindBackdropClose('sheet', closeSheet);
// Body scroll lock — MutationObserver-based ครอบคลุมทุก modal/popup
// ใน app. watch body subtree class changes; ถ้ามี modal element ตัวใดยังโผล่
// อยู่ (class ไม่มี 'hidden') → lock body. แยกชั้นด้วย `_bodyLockAdd/Remove`
// เป็น helper เผื่อ caller อยากบังคับ (no-op ถ้า observer วงงานครอบคลุมแล้ว)
const _MODAL_SELECTORS = '#sheet:not(.hidden), #modal:not(.hidden), ' +
  '#confirm-modal:not(.hidden), .wb-inject-modal:not(.hidden), ' +
  '.wb-edit-frame-modal:not(.hidden), #pl-pin-popup:not(.hidden), ' +
  '#bell-pop:not(.hidden), #notif-modal:not(.hidden)';
function _refreshBodyLock() {
  const anyOpen = !!document.querySelector(_MODAL_SELECTORS);
  document.body.classList.toggle('modal-open', anyOpen);
  document.documentElement.classList.toggle('modal-open', anyOpen);
}
const _modalLockObserver = new MutationObserver(_refreshBodyLock);
_modalLockObserver.observe(document.documentElement, {
  subtree: true, attributes: true, attributeFilter: ['class'],
});
// Manual hooks (kept as harmless no-ops since observer handles it)
function _bodyLockAdd() { _refreshBodyLock(); }
function _bodyLockRemove() { setTimeout(_refreshBodyLock, 0); }

function openSheet(html) {
  document.getElementById('sheet-body').innerHTML = html;
  document.getElementById('sheet').classList.remove('hidden');
  document.getElementById('sheet').classList.add('flex');
  _bodyLockAdd();
}
function closeSheet() {
  const sh = document.getElementById('sheet');
  if (sh.classList.contains('hidden')) return;  // already closed → don't double-unlock
  sh.classList.add('hidden'); sh.classList.remove('flex');
  state.openTaskId = null;
  _bodyLockRemove();
}

async function openTaskSheet(id) {
  let t, files;
  try {
    [t, files] = await Promise.all([
      api.get('/api/tasks/' + id),
      api.get('/api/tasks/' + id + '/files'),
    ]);
  } catch (err) { toast(err.message, 'error'); return; }
  state.openTaskId = id;

  const g = groupById(t.group_id);
  // Meetings don't get an overdue/today/soon highlight in the detail sheet
  // either — only tasks have an actionable deadline to chase.
  const dlCls = isMeeting(t) ? '' : deadlineClass(t.deadline, t.status);
  const mine = isMyTask(t);
  const adminOrGroupLead = isAdmin() || (t.group_id && isMyGroupLeader(t.group_id));
  const canSubmit = isAdmin() || mine;

  const fileSubs = files.filter(f => f.kind !== 'url');
  const urlSubs  = files.filter(f => f.kind === 'url');

  openSheet(`
    <div class="space-y-4">

      <!-- Header -->
      <div>
        <div class="flex items-start justify-between gap-2 mb-1">
          <h2 class="text-xl font-semibold leading-tight">${isMeeting(t)?'📅 ':''}${escapeHtml(t.title)}</h2>
          ${isMeeting(t)
            ? `<span class="status-badge status-meeting" style="--m-color:${eventColor(t)}">📅 การประชุม</span>`
            : `<span class="status-badge status-${t.status}">${statusLabel(t.status)}</span>`}
        </div>
        <div class="flex flex-wrap gap-2 mt-1">
          ${priorityBadgeHtml(t)}
          ${g ? `<span class="text-xs text-indigo-600">📁 ${escapeHtml(g.name)}</span>`
              : (isMeeting(t) ? '<span class="text-xs font-semibold text-purple-700">🔬 ประชุมรวม Lab</span>' : '')}
          ${t.target ? `<span class="target-chip">→ ${escapeHtml(t.target)}</span>` : ''}
          ${t.budget != null ? `<span class="budget-chip" title="งบประมาณ">💰 ${Number(t.budget).toLocaleString('th-TH')} ฿</span>` : ''}
          ${pointsPillHtml(t)}
          ${t.status === 'completed' && !isMeeting(t) ? phaseBadge(t.points_phase || 'proposing') : ''}
        </div>
      </div>

      <!-- Meeting location card — colored by the meeting's group (or purple for Lab-wide) -->
      ${isMeeting(t) && t.location_type ? (() => {
        const c = eventColor(t);
        return `
        <div class="meeting-location-card" style="--loc-color:${c}">
          <span class="text-2xl">${(LOCATION_META[t.location_type]||{icon:'📍'}).icon}</span>
          <div class="min-w-0 flex-1">
            <div class="text-[10px] uppercase tracking-wide font-semibold meeting-location-card-label">สถานที่ประชุม</div>
            <div class="text-sm font-medium meeting-location-card-title">${escapeHtml((LOCATION_META[t.location_type]||{label:t.location_type}).label)}</div>
            ${(() => {
              const dd = meetingDetailFor(t);
              if (!dd) return '';
              return t.location_type === 'online' && /^https?:\/\//i.test(dd)
                ? `<a href="${escapeHtml(dd)}" target="_blank" rel="noopener" class="text-xs underline break-all meeting-location-card-detail">${escapeHtml(dd)}</a>`
                : `<div class="text-xs break-words mt-0.5 meeting-location-card-detail">${escapeHtml(dd)}</div>`;
            })()}
          </div>
        </div>`;
      })() : ''}

      <!-- Description -->
      ${t.description ? `<div class="text-sm text-slate-700 bg-slate-50 rounded-xl p-3 md-content">${renderMarkdown(t.description)}</div>` : ''}

      <!-- Categories — read-only tag pills -->
      ${t.categories && t.categories.length ? `
        <div>
          <div class="text-xs font-semibold text-slate-500 uppercase mb-2">🏷️ ประเภทงาน</div>
          <div class="cat-tag-row">${t.categories.map(c => `<span class="cat-tag">${escapeHtml(c.name)}</span>`).join('')}</div>
        </div>` : ''}

      <!-- Date display: meetings show a single "วันและเวลานัด" callout (with time);
           regular tasks show two cards (เริ่มงาน + Deadline). -->
      ${isMeeting(t)
        ? `<div class="bg-slate-100 rounded-xl p-2.5 text-center">
             <div class="text-[10px] text-slate-600 uppercase">📅 วันและเวลานัดประชุม</div>
             <div class="font-medium text-sm mt-0.5">${t.deadline ? meetingTimeText(t.deadline, t.end_time) : '—'}</div>
           </div>`
        : `<div class="grid grid-cols-2 gap-2">
             <div class="bg-slate-100 rounded-xl p-2.5 text-center"><div class="text-[10px] text-slate-600 uppercase">เริ่มงาน</div><div class="font-medium text-xs mt-0.5">${fmtDate(t.start_date)}</div></div>
             <div class="bg-slate-100 rounded-xl p-2.5 text-center"><div class="text-[10px] text-slate-600 uppercase">Deadline</div><div class="font-medium text-xs mt-0.5 ${dlCls}">${fmtDate(t.deadline)}</div></div>
           </div>`}

      <!-- Assignees (read-only with name + role) -->
      <div>
        <div class="text-xs font-semibold text-slate-500 uppercase mb-2">👥 ผู้รับผิดชอบ (${t.assignees.length})</div>
        <div class="space-y-1.5">
          ${t.assignees.length === 0 ? `<div class="text-sm text-slate-400">— ยังไม่มีใครรับงานนี้ —</div>` :
            t.assignees.map(a => `
              <div class="flex items-center gap-2.5 p-2 bg-slate-50 rounded-lg">
                ${avatarHtml(a, 32)}
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium truncate">${escapeHtml(a.name)}${a.id===state.user.id?' <span class="text-[10px] text-indigo-600">(คุณ)</span>':''}</div>
                  <div class="text-[11px] text-slate-500 truncate">${escapeHtml(a.role==='boss'?'Boss':(a.role==='admin'?'Admin':'Member'))}${a.points_share?' · '+a.points_share+' pts':''}</div>
                </div>
              </div>
            `).join('')}
        </div>
      </div>

      <!-- Info hint for non-assignee non-leader; admin/leader manages via Edit button below -->
      ${(!mine && !adminOrGroupLead) ? `
        <div class="text-center text-sm text-slate-500 bg-slate-50 rounded-xl py-2.5 px-3">
          งานย่อยจะถูกมอบหมายโดยหัวหน้ากลุ่มเท่านั้น<br>
          <span class="text-[11px]">ถ้าต้องการช่วยทำ — เสนอตัวเข้ากลุ่มงานนี้ก่อน</span>
        </div>` : ''}

      <!-- Open separate submission sheet — only assignees can submit; non-assignees may only view if files exist -->
      ${(() => {
        const countBadge = files.length ? ` <span class="ml-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold">${files.length}</span>` : '';
        if (mine) {
          return `<button id="detail-open-submit" class="ios-btn-secondary w-full">📎 ส่งงาน${countBadge}</button>`;
        }
        if (files.length > 0) {
          return `<button id="detail-open-submit" class="ios-btn-ghost w-full">📎 ดูไฟล์งาน${countBadge}</button>`;
        }
        return '';
      })()}

      <!-- Points workflow entry — visible to assignees (propose own) + leader/admin (review/confirm) -->
      ${(() => {
        if (t.status !== 'completed') return '';
        const phase = t.points_phase || 'proposing';
        if (phase === 'none') return '';
        const me = state.user.id;
        const isAssignee = t.assignees.some(a => a.id === me);
        const canSee = adminOrGroupLead || isAssignee;
        if (!canSee) return '';
        // Pick a CTA label based on phase + role
        let label = '⭐ ดู Point';
        if (phase === 'proposing' && isAssignee) {
          const myRow = t.assignees.find(a => a.id === me);
          label = myRow?.proposed_at ? '⭐ แก้ไข Point ของฉัน' : '⭐ กำหนด Point ของฉัน';
        } else if (phase === 'leader_review' && adminOrGroupLead) {
          label = '⭐ ตรวจสอบ + อนุมัติ Point';
        } else if (phase === 'final_review' && adminOrGroupLead) {
          label = '⭐ พิจารณา + ยืนยัน Point';
        } else if (phase === 'confirmed') {
          label = '✅ ดู Point ที่ยืนยันแล้ว';
        }
        return `<button id="detail-points" class="ios-btn-secondary w-full text-center">${label}</button>`;
      })()}

      <!-- Comments thread — anyone logged-in can post, owner/admin can edit/delete -->
      <div class="border-t border-slate-100 pt-3" id="task-comments-section">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold text-sm">💬 ความคิดเห็น <span id="tc-count" class="text-xs text-slate-400 font-normal"></span></h3>
        </div>
        <div id="tc-list" class="space-y-2 mb-2"><div class="text-xs text-slate-400 text-center py-2">กำลังโหลด…</div></div>
        <div class="flex gap-2 items-end">
          <textarea id="tc-input" rows="2" class="ios-input flex-1" style="resize:vertical;min-height:2.6rem" placeholder="พิมพ์ความคิดเห็น... (Ctrl+Enter ส่ง)"></textarea>
          <button id="tc-send" class="ios-btn-primary px-3" style="white-space:nowrap">ส่ง ↵</button>
        </div>
      </div>

      <!-- Edit button (admin / group leader) — full-width stacked -->
      ${adminOrGroupLead ? `
        <div class="border-t border-slate-100 pt-3 space-y-2">
          <button id="detail-edit" class="ios-btn-secondary w-full text-center">✏️ แก้ไข / จัดการ</button>
          ${isMeeting(t) ? `<button id="detail-resend" class="ios-btn-ghost w-full text-center">📧 ส่งเชิญผ่านอีเมลอีกครั้ง</button>` : ''}
          ${isAdmin() ? `<button id="detail-del" class="ios-btn-danger w-full text-center">🗑 ${isMeeting(t) ? 'ลบประชุม (จะส่งเมล CANCEL ให้ผู้เข้าร่วม)' : 'ลบงาน (ไปถังขยะ)'}</button>` : ''}
        </div>` : ''}
    </div>
  `);
  loadTaskComments(id);

  // Points workflow entry button
  const pointsBtn = document.getElementById('detail-points');
  if (pointsBtn) pointsBtn.onclick = () => { closeSheet(); openAllocateModal(t); };

  // (Claim/assign buttons removed — admin/group leader manages assignees via the Edit button)

  // ===== Open separate submission sheet (button only present for assignees or when files exist) =====
  const submitBtn = document.getElementById('detail-open-submit');
  if (submitBtn) submitBtn.onclick = () => openSubmissionSheet(t.id);

  // ===== Edit / Delete (admin or group leader) =====
  if (adminOrGroupLead) {
    document.getElementById('detail-edit').onclick = () => { closeSheet(); openTaskEdit(t); };
    if (isAdmin()) {
      document.getElementById('detail-del').onclick = async () => {
        // Meetings still confirm because the soft-delete also fires CANCEL
        // emails to every attendee — that side effect is not undoable even
        // though the task itself can be restored from the recycle bin.
        if (isMeeting(t)) {
          const ok = await uiConfirm(`ลบประชุม "${t.title}"?\n— ระบบจะส่งอีเมลแจ้งยกเลิกให้ผู้เข้าร่วมทุกคน`);
          if (!ok) return;
        }
        // Regular tasks go straight to trash — no confirm needed, restorable
        // from 🗑 ถังขยะ within 30 days.
        try { await api.del('/api/tasks/' + t.id); closeSheet(); toast('ย้ายไปถังขยะแล้ว — กู้คืนได้ใน 30 วัน', 'success'); await loadAll(); }
        catch (err) { toast(err.message, 'error'); }
      };
    }
    // Manual "resend invitation email" — only for meetings
    const resendBtn = document.getElementById('detail-resend');
    if (resendBtn) {
      resendBtn.onclick = async () => {
        const withEmail = (t.assignees || []).filter(a => a.email);
        const total = (t.assignees || []).length;
        const skipped = total - withEmail.length;
        let confirmMsg = `ส่งอีเมลเชิญประชุม "${t.title}" ไปยัง ${withEmail.length} คน?`;
        if (skipped > 0) confirmMsg += `\n(ข้าม ${skipped} คนที่ไม่มีอีเมล)`;
        if (!(await uiConfirm(confirmMsg))) return;
        try {
          const r = await api.post('/api/tasks/' + t.id + '/send-invite');
          toast(`ส่งอีเมลแล้ว ${r.sent} ฉบับ`, 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  }
}

// DOC_TYPES preset — fetched once from the server, cached for the session.
let _docTypes = null;
async function loadDocTypes() {
  if (_docTypes) return _docTypes;
  try { _docTypes = await api.get('/api/doc-types'); }
  catch { _docTypes = [{ id: 'อื่นๆ', label: '📁 อื่นๆ' }]; }
  return _docTypes;
}
async function populateDocTypeSelect(selectId, defaultId = 'อื่นๆ') {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const list = await loadDocTypes();
  sel.innerHTML = list.map(d =>
    `<option value="${escapeHtml(d.id)}" ${d.id === defaultId ? 'selected' : ''}>${escapeHtml(d.label)}</option>`
  ).join('');
}

// Staged-file workflow:
//   1. User picks/drops files → addStagedFiles() appends to _stagedFiles
//      with default doc_type='อื่นๆ'. Each row has its own dropdown.
//   2. User can change doc_type per file or remove individual rows.
//   3. "ส่ง" button → submitStagedFiles() groups by doc_type and fires one
//      POST per unique doc_type (the backend route takes a single doc_type
//      per request via query string).
let _stagedFiles = [];            // [{ file: File, doc_type: string, id: string }]
let _stagedTaskId = null;         // task we're staging for (reset on sheet close)

function addStagedFiles(taskId, fileList) {
  if (!fileList?.length) return;
  if (_stagedTaskId !== taskId) { _stagedTaskId = taskId; _stagedFiles = []; }
  for (const f of fileList) {
    _stagedFiles.push({ file: f, doc_type: 'อื่นๆ', id: 's_' + Math.random().toString(36).slice(2, 10) });
  }
  renderStagedList();
}
function removeStagedFile(id) {
  _stagedFiles = _stagedFiles.filter(s => s.id !== id);
  renderStagedList();
}
function clearStagedFiles() {
  _stagedFiles = [];
  _stagedTaskId = null;
  renderStagedList();
}
async function renderStagedList() {
  const wrap = document.getElementById('staged-wrap');
  const list = document.getElementById('staged-list');
  const submitBtn = document.getElementById('staged-submit');
  if (!wrap || !list) return;
  if (!_stagedFiles.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const docTypes = await loadDocTypes();
  const labelOf = (id) => (docTypes.find(d => d.id === id) || { label: id }).label;
  list.innerHTML = _stagedFiles.map(s => `
    <div class="flex items-center gap-2 bg-slate-50 rounded-lg p-2" data-staged-id="${s.id}">
      <span class="text-xl shrink-0">📄</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate" title="${escapeHtml(s.file.name)}">${escapeHtml(s.file.name)}</div>
        <div class="text-[10px] text-slate-500">${formatBytes(s.file.size)}</div>
      </div>
      <button type="button" class="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 flex items-center gap-1 shrink-0"
              style="max-width:160px"
              data-staged-pick="${s.id}"
              title="กดเพื่อเปลี่ยนประเภทเอกสาร">
        <span class="truncate text-left">${escapeHtml(labelOf(s.doc_type))}</span>
        <span class="text-slate-400 text-[10px] shrink-0">▾</span>
      </button>
      <button type="button" class="text-rose-500 text-xl leading-none px-1.5 shrink-0" title="เอาออก" data-staged-remove="${s.id}">×</button>
    </div>
  `).join('');
  // Hook up doc-type picker + remove buttons
  list.querySelectorAll('[data-staged-pick]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.stagedPick;
      const item = _stagedFiles.find(s => s.id === id);
      if (!item) return;
      const picked = await openDocTypePicker(item.doc_type);
      if (picked) { item.doc_type = picked; renderStagedList(); }
    };
  });
  list.querySelectorAll('[data-staged-remove]').forEach(btn => {
    btn.onclick = () => removeStagedFile(btn.dataset.stagedRemove);
  });
  if (submitBtn) submitBtn.textContent = `⬆ ส่ง ${_stagedFiles.length} ไฟล์`;
}

async function submitStagedFiles(taskId) {
  if (!_stagedFiles.length) return;
  // Group by doc_type — one POST per group keeps it efficient and reuses the
  // existing single-doc-type backend route via ?doc_type= query string.
  const groups = new Map();
  for (const s of _stagedFiles) {
    if (!groups.has(s.doc_type)) groups.set(s.doc_type, []);
    groups.get(s.doc_type).push(s.file);
  }
  let totalSent = 0, autoCompleted = false;
  const submitBtn = document.getElementById('staged-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ กำลังส่ง...'; }
  try {
    for (const [docType, files] of groups) {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await api.postForm(
        `/api/tasks/${taskId}/files?doc_type=${encodeURIComponent(docType)}`, fd
      );
      totalSent += files.length;
      if (res?.auto_completed) autoCompleted = true;
    }
    toast(autoCompleted
      ? `ส่งงานสำเร็จ ${totalSent} ไฟล์ ✓ (ตั้งสถานะเสร็จแล้ว)`
      : `อัปโหลดสำเร็จ ${totalSent} ไฟล์`, 'success');
    clearStagedFiles();
    if (state.openSubmitTaskId === taskId) openSubmissionSheet(taskId);
    else openTaskSheet(taskId);
    await promptOwnPointsIfNeeded(taskId);
  } catch (err) {
    toast(err.message, 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = `⬆ ส่ง ${_stagedFiles.length} ไฟล์`; }
  }
}

// Format byte size as KB/MB for the staging UI
function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/(1024*1024)).toFixed(2) + ' MB';
}

// Bottom-sheet picker for the staged-file doc-type. Uses a real scrollable
// element instead of native <select> because the doc-type list has 17 long
// Thai labels — native dropdowns truncate them on mobile and feel cramped.
const _docTypePicker = document.getElementById('doctype-picker-modal');
async function openDocTypePicker(currentId) {
  const list = await loadDocTypes();
  const listEl = document.getElementById('doctype-picker-list');
  const cancelBtn = document.getElementById('doctype-picker-cancel');
  return new Promise(resolve => {
    listEl.innerHTML = list.map(d => `
      <button type="button"
              data-pick="${escapeHtml(d.id)}"
              class="w-full text-left px-3 py-3 rounded-lg flex items-center gap-2 ${d.id === currentId ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}">
        <span class="flex-1 text-sm">${escapeHtml(d.label)}</span>
        ${d.id === currentId ? '<span class="text-indigo-600 text-lg">✓</span>' : ''}
      </button>
    `).join('');
    _docTypePicker.classList.remove('hidden');
    _docTypePicker.classList.add('flex');
    const cleanup = (val) => {
      _docTypePicker.classList.add('hidden');
      _docTypePicker.classList.remove('flex');
      listEl.onclick = null;
      cancelBtn.onclick = null;
      _docTypePicker.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
    };
    listEl.onclick = (e) => {
      const btn = e.target.closest('[data-pick]');
      if (!btn) return;
      cleanup(btn.dataset.pick);
    };
    cancelBtn.onclick = () => cleanup(null);
    _docTypePicker.onclick = (e) => { if (e.target === _docTypePicker) cleanup(null); };
    document.addEventListener('keydown', onKey);
  });
}

// ===== Submission sheet (opens on top of detail) =====
async function openSubmissionSheet(taskId) {
  let t, files;
  try {
    [t, files] = await Promise.all([
      api.get('/api/tasks/' + taskId),
      api.get('/api/tasks/' + taskId + '/files'),
    ]);
  } catch (err) { toast(err.message, 'error'); return; }
  state.openSubmitTaskId = taskId;
  const mine = isMyTask(t);
  // Only assignees can submit work — admin must be added as assignee first
  const canSubmit = mine;

  document.getElementById('submit-body').innerHTML = `
    <div class="space-y-3">
      <div>
        <div class="text-[11px] text-slate-500 uppercase font-semibold">งาน</div>
        <div class="text-base font-semibold">${escapeHtml(t.title)}</div>
        <div class="flex items-center gap-2 mt-1 flex-wrap">
          <span class="status-badge status-${t.status}">${statusLabel(t.status)}</span>
          ${t.target ? `<span class="target-chip">→ ${escapeHtml(t.target)}</span>` : ''}
        </div>
      </div>

      ${canSubmit ? `
        <div>
          <div class="text-xs font-semibold text-slate-500 uppercase mb-2">อัปโหลดไฟล์</div>
          <div id="drop-zone" class="drop-zone">
            <div class="text-3xl mb-1">⬆</div>
            <div class="text-sm font-medium text-slate-700">ลากไฟล์มาวางที่นี่</div>
            <div class="text-xs text-slate-500 mt-1">เลือกหลายไฟล์ที่มีประเภทต่างกันได้ — หรือ <button type="button" id="pick-file-btn" class="text-indigo-600 underline">เลือกไฟล์</button></div>
            <input type="file" id="hidden-file-input" multiple class="hidden">
          </div>
          <div id="staged-wrap" class="hidden mt-3 space-y-2">
            <div class="text-[11px] text-slate-500">ตั้งประเภทเอกสารของแต่ละไฟล์ก่อนกดส่ง:</div>
            <div id="staged-list" class="space-y-1.5"></div>
            <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button type="button" id="staged-clear" class="text-sm text-slate-500 underline">ล้างทั้งหมด</button>
              <button type="button" id="staged-submit" class="ios-btn-primary text-sm" style="padding:.5rem 1rem;min-height:auto">⬆ ส่ง</button>
            </div>
          </div>
        </div>

        <div>
          <div class="text-xs font-semibold text-slate-500 uppercase mb-2">หรือใส่ลิงก์</div>
          <div class="flex gap-2 flex-wrap">
            <input type="url" id="submit-url-input" class="ios-input flex-1" placeholder="https://drive.google.com/…  หรือ Notion / Dropbox" style="min-width:160px">
            <input type="text" id="submit-url-label" class="ios-input" placeholder="ชื่อ (ไม่บังคับ)" style="max-width:140px">
            <button id="submit-url-btn" class="ios-btn-secondary">+ ลิงก์</button>
          </div>
        </div>

        <div class="text-[11px] text-slate-500 italic">💡 อัปโหลดไฟล์หรือใส่ลิงก์ → ระบบจะตั้งสถานะงานเป็น "เสร็จสิ้น" ให้อัตโนมัติ</div>
      ` : `<div class="text-sm text-slate-500 text-center py-3">เฉพาะผู้รับผิดชอบเท่านั้นที่ส่งงานได้</div>`}

      <div class="border-t border-slate-100 pt-3">
        <div class="text-xs font-semibold text-slate-500 uppercase mb-2">รายการที่ส่งแล้ว (${files.length})</div>
        <div class="space-y-1.5">
          ${files.length === 0 ? `<div class="text-sm text-slate-400 text-center py-3">— ยังไม่มีการส่งงาน —</div>` : files.map(submissionRowHtml).join('')}
        </div>
      </div>
    </div>
  `;
  document.getElementById('submit-sheet').classList.remove('hidden');
  document.getElementById('submit-sheet').classList.add('flex');

  if (canSubmit) {
    // Pre-warm doc types so the per-row dropdowns render without flicker
    loadDocTypes();
    const dz = document.getElementById('drop-zone');
    const hi = document.getElementById('hidden-file-input');
    // Re-render staging state if we still have files queued for this task (e.g.,
    // user toggled away and back). Otherwise clear stale state from a different task.
    if (_stagedTaskId === t.id && _stagedFiles.length) renderStagedList();
    else { _stagedFiles = []; _stagedTaskId = t.id; }
    document.getElementById('pick-file-btn').onclick = () => hi.click();
    hi.onchange = () => { if (hi.files.length) { addStagedFiles(t.id, hi.files); hi.value = ''; } };
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dz.classList.add('drag-active'); }));
    ['dragleave','dragend'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-active'); }));
    dz.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); dz.classList.remove('drag-active');
      if (e.dataTransfer?.files?.length) addStagedFiles(t.id, e.dataTransfer.files);
    });
    document.getElementById('staged-clear').onclick = () => clearStagedFiles();
    document.getElementById('staged-submit').onclick = () => submitStagedFiles(t.id);
    document.getElementById('submit-url-btn').onclick = async () => {
      const url = document.getElementById('submit-url-input').value.trim();
      const label = document.getElementById('submit-url-label').value.trim();
      if (!url) { toast('ใส่ URL ก่อน', 'error'); return; }
      try {
        const res = await api.post('/api/tasks/' + t.id + '/submissions/url', { url, label });
        toast(res?.auto_completed ? 'ส่งลิงก์งานสำเร็จ ✓ (ตั้งสถานะเสร็จแล้ว)' : 'เพิ่มลิงก์แล้ว', 'success');
        openSubmissionSheet(t.id);
        await promptOwnPointsIfNeeded(t.id);
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}

/* ============== Task Comments ============== */
async function loadTaskComments(taskId) {
  try {
    const list = await api.get(`/api/tasks/${taskId}/comments`);
    renderTaskComments(taskId, list);
  } catch (e) {
    const el = document.getElementById('tc-list');
    if (el) el.innerHTML = `<div class="text-xs text-rose-500 text-center py-2">โหลดความคิดเห็นไม่สำเร็จ: ${escapeHtml(e.message)}</div>`;
  }
  // Hook send button (only attach once per open)
  const sendBtn = document.getElementById('tc-send');
  const input   = document.getElementById('tc-input');
  if (sendBtn && !sendBtn.dataset.bound) {
    sendBtn.dataset.bound = '1';
    const send = async () => {
      const body = input.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      try {
        await api.post(`/api/tasks/${taskId}/comments`, { body });
        input.value = '';
        await loadTaskComments(taskId);
      } catch (e) { toast(e.message, 'error'); }
      finally { sendBtn.disabled = false; }
    };
    sendBtn.onclick = send;
    input.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });
    // @mention autocomplete — พิมพ์ "@" แล้วโผล่ list สมาชิกให้เลือก
    attachMentionAutocomplete(input);
  }
}

// ============== @mention autocomplete (comment textarea) ==============
// พิมพ์ "@" → โผล่ popup ของสมาชิก / พิมพ์ตัวอักษรหลัง @ → filter
// คลิกหรือกด Enter → แทรก "@ชื่อ " ลงในข้อความ
function attachMentionAutocomplete(textarea) {
  if (!textarea || textarea.dataset.mentionBound) return;
  textarea.dataset.mentionBound = '1';
  let popup = null;
  let activeIdx = -1;
  let triggerStart = -1;   // ตำแหน่งของ '@' ที่ trigger

  function closePopup() {
    if (popup) popup.remove();
    popup = null;
    activeIdx = -1;
    triggerStart = -1;
  }
  function renderItems(items) {
    if (!popup) return;
    popup.innerHTML = items.length
      ? items.map((m, i) => {
          const ini = (m.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2);
          const avatar = m.avatar_url
            ? `<img class="mention-avatar" src="${escapeHtml(m.avatar_url)}" alt="">`
            : `<span class="mention-avatar" style="background:${escapeHtml(m.color || '#6366f1')}">${escapeHtml(ini)}</span>`;
          return `<button type="button" class="mention-item ${i === activeIdx ? 'active' : ''}" data-mention-id="${escapeHtml(m.id)}" data-mention-name="${escapeHtml(m.name)}">
            ${avatar}<span class="mention-name">${escapeHtml(m.name)}</span>${m.role === 'boss' ? '<span class="mention-role mention-role-boss">boss</span>' : (m.role === 'admin' ? '<span class="mention-role">admin</span>' : '')}
          </button>`;
        }).join('')
      : `<div class="mention-empty">— ไม่พบสมาชิก —</div>`;
  }
  function ensurePopup() {
    if (popup) return;
    popup = document.createElement('div');
    popup.className = 'mention-popup';
    // วางใต้ textarea (relative to parent of textarea เพื่อ scroll ตาม modal)
    const rect = textarea.getBoundingClientRect();
    Object.assign(popup.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.bottom + 4}px`,
      width: `${Math.min(rect.width, 280)}px`,
      maxHeight: '180px',
      overflowY: 'auto',
      zIndex: '100',
    });
    document.body.appendChild(popup);
    popup.addEventListener('click', e => {
      const btn = e.target.closest('[data-mention-name]');
      if (!btn) return;
      e.preventDefault();
      insertMention(btn.dataset.mentionName);
    });
  }
  function insertMention(name) {
    if (triggerStart < 0) return;
    const val = textarea.value;
    const caret = textarea.selectionStart;
    const before = val.slice(0, triggerStart);
    const after = val.slice(caret);
    const insertion = `@${name} `;
    textarea.value = before + insertion + after;
    const newPos = before.length + insertion.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();
    closePopup();
  }
  function refresh() {
    const val = textarea.value;
    const caret = textarea.selectionStart;
    // หา '@' ล่าสุดก่อน caret ที่ไม่มี space ระหว่างมัน
    let at = -1;
    for (let i = caret - 1; i >= 0; i--) {
      const ch = val[i];
      if (ch === '@') { at = i; break; }
      if (ch === ' ' || ch === '\n' || ch === '\t') break;
    }
    if (at < 0) { closePopup(); return; }
    // เงื่อนไข: '@' ต้องอยู่ตำแหน่งแรก หรือมี space/newline นำหน้า (ไม่ใช่ email "a@b")
    if (at > 0 && !/[\s\n]/.test(val[at - 1])) { closePopup(); return; }
    triggerStart = at;
    const queryStr = val.slice(at + 1, caret).toLowerCase();
    const items = (state.members || []).filter(m => {
      const name = (m.name || '').toLowerCase();
      return !queryStr || name.includes(queryStr);
    }).slice(0, 8);
    ensurePopup();
    if (activeIdx < 0 || activeIdx >= items.length) activeIdx = 0;
    renderItems(items);
    popup._items = items;
  }
  textarea.addEventListener('input', refresh);
  textarea.addEventListener('keydown', e => {
    if (!popup || !popup._items?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % popup._items.length; renderItems(popup._items); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + popup._items.length) % popup._items.length; renderItems(popup._items); }
    else if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
      if (activeIdx >= 0 && popup._items[activeIdx]) {
        e.preventDefault();
        insertMention(popup._items[activeIdx].name);
      }
    } else if (e.key === 'Escape') { e.preventDefault(); closePopup(); }
  });
  textarea.addEventListener('blur', () => {
    // หน่วง เพื่อให้ click บน popup ทำงานก่อน
    setTimeout(closePopup, 150);
  });
  // ปิด popup เมื่อ click outside
  document.addEventListener('click', e => {
    if (popup && !popup.contains(e.target) && e.target !== textarea) closePopup();
  });
}

// แปลง `@ชื่อ` ใน comment body → chip + highlight (ใช้ตอน render)
function renderMentionsInBody(text) {
  const escaped = escapeHtml(text);
  // จับ @<name> ที่ขึ้นต้นด้วย @ ตามด้วยตัวอักษร/ตัวเลข/ไทย จนเจอ whitespace
  // (ชื่อมี space ได้ ถ้าตรงกับสมาชิกในระบบ — ลองจับชื่อยาวสุดที่ match)
  const names = (state.members || []).map(m => m.name).sort((a, b) => b.length - a.length);
  let out = escaped;
  for (const name of names) {
    if (!name) continue;
    const esc = escapeHtml(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`@${esc}(?=$|[\\s\\.,!?:;]|<)`, 'g');
    out = out.replace(re, `<span class="mention-chip">@${escapeHtml(name)}</span>`);
  }
  return out;
}

function renderTaskComments(taskId, list) {
  const el = document.getElementById('tc-list');
  const cnt = document.getElementById('tc-count');
  if (cnt) cnt.textContent = list.length ? `(${list.length})` : '';
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<div class="text-xs text-slate-400 text-center py-3">ยังไม่มีความคิดเห็น — เริ่มก่อนได้เลย</div>`;
    return;
  }
  el.innerHTML = list.map(c => {
    const mine = c.member_id === state.user?.id;
    const canEdit = mine || isAdmin();
    const ago = relTime(c.created_at);
    const edited = c.created_at !== c.updated_at;
    const ini = (c.member_name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const colorBg = c.avatar_url
      ? `background-image:url('${escapeHtml(c.avatar_url)}');background-size:cover;background-position:center`
      : `background:${escapeHtml(c.member_color || '#6366f1')}`;
    return `
      <div class="flex gap-2" data-comment-id="${escapeHtml(c.id)}">
        <div class="ios-avatar" style="width:32px;height:32px;font-size:.7rem;flex-shrink:0;${colorBg}">${c.avatar_url ? '' : escapeHtml(ini)}</div>
        <div class="flex-1 min-w-0">
          <div class="bg-slate-50 rounded-lg px-3 py-2">
            <div class="flex items-center justify-between gap-2 mb-0.5">
              <div class="text-xs font-semibold text-slate-700">${escapeHtml(c.member_name || 'unknown')}</div>
              <div class="text-[10px] text-slate-400">${ago}${edited ? ' · แก้ไขแล้ว' : ''}</div>
            </div>
            <div class="text-sm text-slate-800 whitespace-pre-wrap break-words" data-tc-body>${renderMentionsInBody(c.body)}</div>
          </div>
          ${canEdit ? `
            <div class="flex gap-2 mt-1 px-1">
              <button class="text-[11px] text-indigo-600" data-tc-edit>แก้ไข</button>
              <button class="text-[11px] text-rose-500" data-tc-del>ลบ</button>
            </div>` : ''}
        </div>
      </div>`;
  }).join('');
  // Wire edit/delete
  el.querySelectorAll('[data-tc-edit]').forEach(b => b.onclick = () => {
    const row = b.closest('[data-comment-id]');
    const id = row.dataset.commentId;
    const bodyEl = row.querySelector('[data-tc-body]');
    const cur = bodyEl.textContent;
    const nv = prompt('แก้ไขความคิดเห็น:', cur);
    if (nv == null || nv === cur) return;
    api.put(`/api/comments/${id}`, { body: nv })
      .then(() => loadTaskComments(taskId))
      .catch(e => toast(e.message, 'error'));
  });
  el.querySelectorAll('[data-tc-del]').forEach(b => b.onclick = async () => {
    const id = b.closest('[data-comment-id]').dataset.commentId;
    if (!(await uiConfirm('ลบความคิดเห็นนี้?'))) return;
    api.del(`/api/comments/${id}`)
      .then(() => loadTaskComments(taskId))
      .catch(e => toast(e.message, 'error'));
  });
}

/* ============== Group summary (auto-generated markdown) ============== */
async function loadGroupSummary(groupId) {
  try {
    const r = await api.get(`/api/groups/${groupId}/summary`);
    renderGroupSummary(groupId, r);
  } catch (e) { /* show placeholder */ }
  // Wire buttons (idempotent — DOM is fresh after each render)
  const regen = document.getElementById('group-summary-regen');
  const dl    = document.getElementById('group-summary-download');
  if (regen) regen.onclick = async () => {
    regen.disabled = true; regen.textContent = '⏳ กำลังสร้าง...';
    try {
      const r = await api.post(`/api/groups/${groupId}/summary/regenerate`);
      renderGroupSummary(groupId, r);
      toast('สรุปกลุ่มถูกสร้างใหม่แล้ว', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { regen.disabled = false; regen.textContent = '🔄 สร้าง/อัปเดต'; }
  };
  if (dl) dl.onclick = () => {
    const pre = document.getElementById('group-summary-pre');
    const md = pre?.textContent || '';
    if (!md.trim() || md.startsWith('—')) return toast('ยังไม่มีสรุป — กด "สร้าง/อัปเดต" ก่อน', 'error');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const g = state.groups.find(x => x.id === groupId);
    a.download = `${(g?.name || groupId).replace(/[^\w฀-๿.\- ]+/g, '_')}_summary.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}
function renderGroupSummary(groupId, r) {
  const pre  = document.getElementById('group-summary-pre');
  const meta = document.getElementById('group-summary-meta');
  if (!pre) return;
  if (r?.markdown) {
    pre.textContent = r.markdown;
    if (meta) meta.textContent = r.generated_at ? `· อัปเดตล่าสุด ${relTime(r.generated_at)}` : '';
  }
}

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000)         return 'เมื่อสักครู่';
  if (ms < 3600_000)      return Math.floor(ms / 60000) + ' นาทีก่อน';
  if (ms < 86400_000)     return Math.floor(ms / 3600_000) + ' ชม.ก่อน';
  if (ms < 86400_000 * 7) return Math.floor(ms / 86400_000) + ' วันก่อน';
  return fmtDate(iso);   // dd/mm/yyyy
}

/* ============== Recycle Bin ============== */
async function openTrashModal() {
  let trash, trashGroups;
  try {
    [trash, trashGroups] = await Promise.all([
      api.get('/api/tasks/trash'),
      api.get('/api/groups/trash').catch(() => []),
    ]);
  } catch (e) { toast(e.message, 'error'); return; }

  // แบ่งเป็น 3 หมวดหลัก — groups / tasks / meetings
  const tasks    = trash.filter(t => t.kind !== 'meeting');
  const meetings = trash.filter(t => t.kind === 'meeting');

  function renderCard(t) {
    const ago = relTime(t.deleted_at);
    return `<div class="trash-item" data-trash-id="${escapeHtml(t.id)}">
      <div class="flex items-center justify-between gap-2 mb-1">
        <div class="font-medium text-sm">${t.kind === 'meeting' ? '📅 ' : ''}${escapeHtml(t.title)}</div>
        ${t.group_name ? `<span class="text-[10px] px-2 py-0.5 rounded" style="background:${escapeHtml(t.group_color || '#1e293b')}22;color:${escapeHtml(t.group_color || '#475569')}">${escapeHtml(t.group_name)}</span>` : ''}
      </div>
      <div class="text-[11px] text-slate-500">ลบเมื่อ ${ago}</div>
      <div class="flex gap-2 mt-2">
        <button class="ios-btn-secondary text-xs flex-1" data-trash-restore>↩ คืน</button>
        <button class="ios-btn-danger text-xs flex-1" data-trash-purge>🗑️ ลบถาวร</button>
      </div>
    </div>`;
  }
  function renderCategory(label, icon, items) {
    if (!items.length) return '';
    // จัดกลุ่มย่อยตาม group_name (โครงการ) — รายการที่ไม่มีกลุ่มเก็บใน 'ไม่อยู่ในโครงการ'
    const byGroup = new Map();
    for (const t of items) {
      const key = t.group_name || '— ไม่อยู่ในโครงการ —';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(t);
    }
    const groupHtml = Array.from(byGroup.entries()).map(([gName, list]) => `
      <details class="trash-subgroup" open>
        <summary class="trash-subgroup-summary">
          <span class="trash-subgroup-caret">▸</span>
          <span class="font-semibold text-xs text-slate-600">${escapeHtml(gName)}</span>
          <span class="text-[10px] text-slate-400">(${list.length})</span>
        </summary>
        <div class="trash-subgroup-body">${list.map(renderCard).join('')}</div>
      </details>`).join('');
    return `
      <details class="trash-category" open>
        <summary class="trash-category-summary">
          <span class="trash-category-caret">▸</span>
          <h3 class="font-semibold text-sm flex items-center gap-2"><span>${icon}</span>${escapeHtml(label)}</h3>
          <span class="text-[11px] text-slate-500">(${items.length})</span>
        </summary>
        <div class="trash-category-body">${groupHtml}</div>
      </details>`;
  }

  // Group cards — แสดงเป็น category ของตัวเอง (กดคืน → คืน group + tasks ภายใน)
  function renderGroupCard(g) {
    const ago = relTime(g.deleted_at);
    return `<div class="trash-item" data-trash-group-id="${escapeHtml(g.id)}">
      <div class="flex items-center justify-between gap-2 mb-1">
        <div class="font-medium text-sm">📁 ${escapeHtml(g.name)}</div>
        ${g.task_count ? `<span class="text-[10px] text-slate-500">(${g.task_count} งาน)</span>` : ''}
      </div>
      <div class="text-[11px] text-slate-500">ลบเมื่อ ${ago}${g.leader_name ? ' · หัวหน้า: '+escapeHtml(g.leader_name) : ''}</div>
      <div class="flex gap-2 mt-2">
        <button class="ios-btn-secondary text-xs flex-1" data-trash-group-restore>↩ คืน</button>
        <button class="ios-btn-danger text-xs flex-1" data-trash-group-purge>🗑️ ลบถาวร</button>
      </div>
    </div>`;
  }
  const groupsHtml = trashGroups.length ? `
    <details class="trash-category" open>
      <summary class="trash-category-summary">
        <span class="trash-category-caret">▸</span>
        <h3 class="font-semibold text-sm flex items-center gap-2"><span>📁</span>โครงการ (Group)</h3>
        <span class="text-[11px] text-slate-500">(${trashGroups.length})</span>
      </summary>
      <div class="trash-category-body">${trashGroups.map(renderGroupCard).join('')}</div>
    </details>` : '';
  const totalCount = trash.length + trashGroups.length;
  openModal('🗑️ ถังขยะ', `
    <div class="space-y-2">
      <div class="text-xs text-slate-500">งาน/โครงการในถังขยะถูกเก็บไว้ 30 วันก่อนถูกลบถาวร</div>
      ${totalCount ? `
        <div id="trash-list" class="space-y-3">
          ${groupsHtml}
          ${renderCategory('งาน (Task)', '📋', tasks)}
          ${renderCategory('การประชุม (Meeting)', '📅', meetings)}
        </div>` : '<div class="text-center text-slate-400 py-6 text-sm">ถังขยะว่าง 🎉</div>'}
    </div>
  `, null);
  // Group restore/purge handlers
  document.querySelectorAll('[data-trash-group-restore]').forEach(b => b.onclick = async () => {
    const id = b.closest('[data-trash-group-id]').dataset.trashGroupId;
    try {
      await api.post(`/api/groups/${id}/restore`);
      toast('คืนโครงการแล้ว (รวม tasks ภายใน)', 'success');
      closeModal(); await loadAll(); openTrashModal();
    } catch (e) { toast(e.message, 'error'); }
  });
  document.querySelectorAll('[data-trash-group-purge]').forEach(b => b.onclick = async () => {
    const id = b.closest('[data-trash-group-id]').dataset.trashGroupId;
    if (!(await uiConfirm(`ลบถาวร?\n\n⚠️ จะลบทุกอย่างใน group นี้ (tasks/files/comments) — กู้คืนไม่ได้`, { okLabel: '🗑️ ลบถาวร', danger: true }))) return;
    try {
      await api.del(`/api/groups/${id}/purge`);
      toast('ลบโครงการถาวรแล้ว', 'success');
      closeModal(); await loadAll(); openTrashModal();
    } catch (e) { toast(e.message, 'error'); }
  });
  // Wire actions
  document.querySelectorAll('[data-trash-restore]').forEach(b => b.onclick = async () => {
    const id = b.closest('[data-trash-id]').dataset.trashId;
    try {
      await api.post(`/api/tasks/${id}/restore`);
      toast('คืนงานแล้ว', 'success');
      closeModal(); await loadAll(); openTrashModal();
    } catch (e) { toast(e.message, 'error'); }
  });
  document.querySelectorAll('[data-trash-purge]').forEach(b => b.onclick = async () => {
    if (!(await uiConfirm('ลบงานนี้ถาวร? ไม่สามารถกู้คืนได้'))) return;
    const id = b.closest('[data-trash-id]').dataset.trashId;
    try {
      await api.del(`/api/tasks/${id}?permanent=1`);
      toast('ลบถาวรแล้ว', 'success');
      closeModal(); openTrashModal();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ============== Polls / Voting ============== */
async function loadPolls() {
  try {
    const polls = await api.get('/api/polls');
    state.polls = polls;
    renderPolls();
  } catch (e) { /* poll endpoint optional */ }
}

function renderPolls() {
  const root = document.getElementById('home-polls-list');
  if (!root) return;
  const polls = (state.polls || []).filter(p => !p.closed).slice(0, 5);
  if (!polls.length) {
    root.innerHTML = `<div class="px-4 py-3 text-sm text-slate-400 text-center">ยังไม่มีโพลที่กำลังเปิด — กด "+ สร้างใหม่" เพื่อเริ่ม</div>`;
    return;
  }
  root.innerHTML = polls.map(p => `
    <button class="w-full text-left ios-list-row hover:bg-slate-50" data-poll-open="${escapeHtml(p.id)}">
      <span class="min-w-0 flex-1">
        <div class="font-medium text-sm truncate">${escapeHtml(p.question)}</div>
        <div class="text-[11px] text-slate-500 mt-0.5">
          ${p.options?.length || 0} ตัวเลือก · ${p.vote_count || 0} โหวต
          ${p.expires_at ? ' · หมด ' + relTime(p.expires_at) : ''}
          ${p.anonymous ? ' · 🕶️ anonymous' : ''}
          ${p.multi_choice ? ' · ☑ multi' : ''}
        </div>
      </span>
      <span class="text-slate-400">›</span>
    </button>
  `).join('');
  root.querySelectorAll('[data-poll-open]').forEach(b => b.onclick = () => openPollModal(b.dataset.pollOpen));
}

async function openPollModal(pollId) {
  let p;
  try { p = await api.get('/api/polls/' + pollId); }
  catch (e) { toast(e.message, 'error'); return; }
  const myVoteArr = p.votes_by_member?.[state.user?.id] || [];
  const haveVoted = myVoteArr.length > 0;
  const total = p.tally.reduce((a, b) => a + b, 0) || 1;
  const isOwner = p.created_by === state.user?.id;
  const isClosed = !!p.closed || (p.expires_at && new Date(p.expires_at) < new Date());
  const inputType = p.multi_choice ? 'checkbox' : 'radio';

  openModal(`🗳️ ${p.question}`, `
    <div class="space-y-3">
      <div class="text-xs text-slate-500">
        ${p.creator_name ? 'โดย ' + escapeHtml(p.creator_name) + ' · ' : ''}
        ${p.tally.reduce((a, b) => a + b, 0)} โหวต
        ${p.anonymous ? ' · 🕶️ ไม่ระบุชื่อ' : ''}
        ${isClosed ? ' · 🔒 ปิดแล้ว' : ''}
      </div>
      <form id="poll-vote-form" class="space-y-2">
        ${p.options.map((opt, i) => {
          const count = p.tally[i] || 0;
          const pct = Math.round((count / total) * 100) || 0;
          const checked = myVoteArr.includes(i) ? 'checked' : '';
          return `
            <label class="block border border-slate-200 rounded-lg p-2 cursor-pointer hover:bg-slate-50 relative overflow-hidden">
              <div class="absolute inset-0 bg-indigo-50" style="width:${haveVoted ? pct : 0}%;transition:width .3s"></div>
              <div class="relative flex items-center justify-between gap-2">
                <span class="flex items-center gap-2 min-w-0">
                  <input type="${inputType}" name="opt" value="${i}" ${checked} ${isClosed ? 'disabled' : ''} class="flex-shrink-0">
                  <span class="text-sm truncate">${escapeHtml(opt)}</span>
                </span>
                ${haveVoted ? `<span class="text-xs text-slate-600 font-medium flex-shrink-0">${count} (${pct}%)</span>` : ''}
              </div>
            </label>`;
        }).join('')}
      </form>
      ${!isClosed ? `<button id="poll-vote-btn" class="ios-btn-primary w-full">${haveVoted ? '↻ เปลี่ยนคำตอบ' : '✓ โหวต'}</button>` : ''}
      ${(isOwner || isAdmin()) && !isClosed ? `<button id="poll-close-btn" class="ios-btn-ghost w-full text-amber-600">🔒 ปิดโพล</button>` : ''}
      ${(isOwner || isAdmin()) ? `<button id="poll-del-btn" class="ios-btn-ghost w-full text-rose-600">🗑 ลบโพล</button>` : ''}
    </div>
  `, null);

  document.getElementById('poll-vote-btn')?.addEventListener('click', async () => {
    const fd = new FormData(document.getElementById('poll-vote-form'));
    const idxs = fd.getAll('opt').map(Number);
    if (!idxs.length) return toast('เลือกอย่างน้อย 1 ตัวเลือก', 'error');
    try {
      await api.post(`/api/polls/${pollId}/vote`, { option_indices: idxs });
      toast('โหวตแล้ว ✓', 'success');
      closeModal(); await loadPolls(); openPollModal(pollId);
    } catch (e) { toast(e.message, 'error'); }
  });
  document.getElementById('poll-close-btn')?.addEventListener('click', async () => {
    if (!(await uiConfirm('ปิดโพลนี้? จะไม่มีคนโหวตได้อีก'))) return;
    try { await api.post(`/api/polls/${pollId}/close`); toast('ปิดโพลแล้ว', 'success'); closeModal(); loadPolls(); }
    catch (e) { toast(e.message, 'error'); }
  });
  document.getElementById('poll-del-btn')?.addEventListener('click', async () => {
    if (!(await uiConfirm('ลบโพลนี้ถาวร?'))) return;
    try { await api.del(`/api/polls/${pollId}`); toast('ลบแล้ว', 'success'); closeModal(); loadPolls(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

function openCreatePollModal() {
  openModal('+ สร้างโพล', `
    <div class="space-y-3">
      <div>
        <label class="ios-label">คำถาม</label>
        <input id="np-q" class="ios-input" placeholder="คำถามที่ต้องการโหวต" maxlength="500">
      </div>
      <div>
        <label class="ios-label">ตัวเลือก (อย่างน้อย 2)</label>
        <div id="np-opts" class="space-y-2">
          <input class="ios-input np-opt" placeholder="ตัวเลือก 1">
          <input class="ios-input np-opt" placeholder="ตัวเลือก 2">
        </div>
        <button type="button" id="np-add" class="text-xs text-indigo-600 mt-1">+ เพิ่มตัวเลือก</button>
      </div>
      <div class="flex gap-4 text-sm">
        <label class="flex items-center gap-1"><input type="checkbox" id="np-multi"> เลือกได้หลายข้อ</label>
        <label class="flex items-center gap-1"><input type="checkbox" id="np-anon"> ไม่ระบุชื่อ</label>
      </div>
      <div>
        <label class="ios-label">หมดอายุ (optional)</label>
        <input id="np-exp" type="datetime-local" class="ios-input">
      </div>
    </div>
  `, async () => {
    const question = document.getElementById('np-q').value.trim();
    const options = Array.from(document.querySelectorAll('.np-opt'))
      .map(i => i.value.trim()).filter(Boolean);
    if (!question)              { toast('กรอกคำถาม', 'error'); return false; }
    if (options.length < 2)     { toast('ต้องมีอย่างน้อย 2 ตัวเลือก', 'error'); return false; }
    const expRaw = document.getElementById('np-exp').value;
    try {
      await api.post('/api/polls', {
        question, options,
        multi_choice: document.getElementById('np-multi').checked,
        anonymous:    document.getElementById('np-anon').checked,
        expires_at: expRaw ? new Date(expRaw).toISOString() : null,
      });
      toast('สร้างโพลแล้ว', 'success');
      await loadPolls();
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }, 'สร้าง');
  document.getElementById('np-add').onclick = () => {
    const wrap = document.getElementById('np-opts');
    const idx = wrap.children.length + 1;
    const inp = document.createElement('input');
    inp.className = 'ios-input np-opt';
    inp.placeholder = 'ตัวเลือก ' + idx;
    wrap.appendChild(inp);
  };
}

function closeSubmissionSheet() {
  document.getElementById('submit-sheet').classList.add('hidden');
  document.getElementById('submit-sheet').classList.remove('flex');
  document.getElementById('submit-body').innerHTML = '';
  state.openSubmitTaskId = null;
}
document.getElementById('submit-close').addEventListener('click', closeSubmissionSheet);
document.getElementById('submit-sheet').addEventListener('click', e => { if (e.target.id === 'submit-sheet') closeSubmissionSheet(); });

function submissionRowHtml(s) {
  if (s.kind === 'url') {
    const display = s.label || s.url;
    const canDelete = isAdmin() || s.uploaded_by === state.user.id;
    return `
      <div class="file-row">
        <div class="file-icon" style="background:#e0f2fe;color:#0369a1">🔗</div>
        <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="min-w-0 flex-1 hover:underline">
          <div class="font-medium truncate">${escapeHtml(display)}</div>
          <div class="text-[10px] text-slate-500 truncate">${escapeHtml(s.url)} · 👤 ${escapeHtml(s.uploader_name||'?')} · ${fmtDate(s.uploaded_at)}</div>
        </a>
        <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="ios-btn-ghost text-xs" title="เปิด">↗</a>
        ${canDelete ? `<button class="text-rose-500 text-xs" data-delete-file-global="${s.id}" title="ลบ">✕</button>` : ''}
      </div>`;
  }
  return fileRowHtml(s);
}

// ===== Edit modal — full form + admin/leader actions =====
// Edit dispatcher — meetings get a different form (no points / no extension request).
function openTaskEdit(t) {
  if (isMeeting(t)) return openMeetingEdit(t);

  const fields = taskFormFields(t) + `
    <div class="form-section">
      <div class="form-section-title">⚙️ การจัดการเพิ่มเติม</div>
      <div class="form-actions-grid">
        <button type="button" class="ios-btn-ghost" id="edit-allocate">
          <span class="text-lg">⭐</span>
          <span class="flex-1">แบ่ง Points ให้สมาชิก</span>
          <span class="text-slate-400">›</span>
        </button>
        <button type="button" class="ios-btn-ghost" id="edit-assignees">
          <span class="text-lg">👥</span>
          <span class="flex-1">จัดการผู้รับผิดชอบ</span>
          <span class="text-slate-400">›</span>
        </button>
        <button type="button" class="ios-btn-ghost" id="edit-extension">
          <span class="text-lg">⏰</span>
          <span class="flex-1">ขอเลื่อน Deadline</span>
          <span class="text-slate-400">›</span>
        </button>
      </div>
    </div>
  `;
  openModal('✏️ แก้ไข — ' + t.title, fields, async data => {
    data.kind = 'task';
    data.points = +data.points || 0;
    if (!Array.isArray(data.assignee_ids)) data.assignee_ids = [];
    if (data.assignee_ids.length === 0) {
      throw new Error('ต้องเลือกผู้รับผิดชอบอย่างน้อย 1 คน');
    }
    if (data.group_id) data.target = '';   // group target wins when group is set
    await api.put('/api/tasks/' + t.id, data);
    toast('บันทึกแล้ว', 'success');
    await loadAll();
  });
  _wireCreateNewGroupButton(openTaskEdit, t);
  _wireTaskTargetToggle();
  _wireGroupMemberFilter();
  _wireSelectAllButton('task-select-all');
  _wireAddCategoryButton();
  document.getElementById('edit-allocate').onclick   = () => openAllocateModal(t);
  document.getElementById('edit-assignees').onclick  = () => openAddAssigneeModal(t);
  document.getElementById('edit-extension').onclick  = () => openRequestExtensionModal(t);
}

// Meeting edit — no allocate-points / no extension-request (those concepts don't apply).
// Just the edit form + manage-attendees button.
function openMeetingEdit(t) {
  const fields = meetingFormFields(t) + `
    <div class="form-section">
      <div class="form-section-title">⚙️ การจัดการเพิ่มเติม</div>
      <div class="form-actions-grid">
        <button type="button" class="ios-btn-ghost" id="edit-assignees">
          <span class="text-lg">👥</span>
          <span class="flex-1">จัดการผู้เข้าร่วม</span>
          <span class="text-slate-400">›</span>
        </button>
      </div>
    </div>
  `;
  openModal('✏️ แก้ไขการประชุม — ' + t.title, fields, async data => {
    data.kind = 'meeting';
    if (!Array.isArray(data.assignee_ids)) data.assignee_ids = [];
    if (data.assignee_ids.length === 0) {
      throw new Error('ต้องเลือกผู้เข้าร่วมอย่างน้อย 1 คน');
    }
    await api.put('/api/tasks/' + t.id, data);
    toast('บันทึกแล้ว', 'success');
    await loadAll();
  });
  _wireCreateNewGroupButton(openMeetingEdit, t);
  _wireAddCategoryButton();
  document.getElementById('edit-assignees').onclick = () => openAddAssigneeModal(t);

  // Initialize location-option .selected classes (in case form rendered them with checked but CSS didn't pick it up)
  modalForm.querySelectorAll('.location-option').forEach(o => {
    const inp = o.querySelector('input[name="location_type"]');
    o.classList.toggle('selected', !!(inp && inp.checked));
  });
}

// ============== Modal ==============
const modal = document.getElementById('modal');
const modalForm = document.getElementById('modal-form');
const modalTitle = document.getElementById('modal-title');
let modalSubmit = null;

function openModal(title, fields, onSubmit, submitLabel = 'บันทึก') {
  modalTitle.textContent = title;
  modalForm.innerHTML = fields;
  document.getElementById('modal-submit-top').textContent = submitLabel;
  const wasHidden = modal.classList.contains('hidden');
  modal.classList.remove('hidden'); modal.classList.add('flex');
  if (wasHidden) _bodyLockAdd();
  modalSubmit = onSubmit;
  // Replace native date / datetime inputs with flatpickr so the visible
  // format is dd/mm/yyyy and times are always 24-hour, regardless of the
  // user's browser/OS locale. Backend still sees the ISO value.
  initFlatpickr(modalForm);
  modalForm.querySelector('input,select,textarea')?.focus();
}

// Wraps native `<input type="date">` / `<input type="datetime-local">` in
// flatpickr. The hidden underlying input keeps its ISO value (Y-m-d or
// Y-m-d\TH:i) so existing form submission code Just Works. The visible
// "alt" input shows dd/mm/yyyy + 24-hour HH:MM.
function initFlatpickr(container) {
  if (!container || !window.flatpickr) return;
  container.querySelectorAll('input[type="date"]').forEach(el => {
    if (el._flatpickr) return;
    window.flatpickr(el, {
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      allowInput: true,
      locale: { firstDayOfWeek: 1 },
    });
  });
  container.querySelectorAll('input[type="datetime-local"]').forEach(el => {
    if (el._flatpickr) return;
    window.flatpickr(el, {
      enableTime: true,
      time_24hr: true,
      dateFormat: 'Y-m-d\\TH:i',   // matches HTML5 datetime-local serialisation
      altInput: true,
      altFormat: 'd/m/Y H:i',
      allowInput: true,
      minuteIncrement: 5,
      locale: { firstDayOfWeek: 1 },
    });
  });
}
function closeModal() {
  const wasOpen = !modal.classList.contains('hidden');
  modal.classList.add('hidden'); modal.classList.remove('flex');
  modalForm.innerHTML = ''; modalSubmit = null;
  if (wasOpen) _bodyLockRemove();
  // คืน focus กลับไปยัง element ที่ trigger modal (กัน screen reader หลง)
  if (_modalLastFocus) { try { _modalLastFocus.focus(); } catch {} _modalLastFocus = null; }
}
document.getElementById('modal-close').onclick = closeModal;
document.getElementById('modal-submit-top').onclick = () => modalForm.requestSubmit();
// Modal backdrop close — ใช้ helper เดียวกับ sheets อื่น (กัน drag highlight แล้วเด้งปิด)
_bindBackdropClose(modal.id, closeModal);

// Modal focus trap + Esc consistency — applies to ทุก modal ที่ใช้ #modal
let _modalLastFocus = null;
modal.addEventListener('keydown', e => {
  if (modal.classList.contains('hidden')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
  if (e.key !== 'Tab') return;
  // Trap Tab ภายใน modal — last → first, first(shift) → last
  const focusables = modal.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
// Capture trigger element ทุกครั้งที่ openModal — wrap with proxy
const _origOpenModal = openModal;
window.openModal = function (...args) {
  _modalLastFocus = document.activeElement;
  return _origOpenModal.apply(this, args);
};

// ============== Confirm modal (replaces native window.confirm) ==============
// Drop-in async replacement for window.confirm — returns Promise<boolean>.
//   if (!(await uiConfirm('Are you sure?'))) return;
//   if (await uiConfirm('Delete?', { okLabel: 'Delete', danger: true })) { ... }
// Options:
//   title      — heading text (default "ยืนยัน")
//   okLabel    — OK button label (default "ยืนยัน")
//   cancelLabel — Cancel button label (default "ยกเลิก")
//   danger     — true (default) = red OK button; false = indigo (neutral)
const _confirmModal  = document.getElementById('confirm-modal');
const _confirmTitle  = document.getElementById('confirm-title');
const _confirmMsg    = document.getElementById('confirm-msg');
const _confirmOk     = document.getElementById('confirm-ok');
const _confirmCancel = document.getElementById('confirm-cancel');
function uiConfirm(message, opts = {}) {
  const {
    title       = 'ยืนยัน',
    okLabel     = 'ยืนยัน',
    cancelLabel = 'ยกเลิก',
    danger      = true,
  } = opts;
  return new Promise(resolve => {
    _confirmTitle.textContent = title;
    _confirmMsg.textContent   = message;
    _confirmOk.textContent    = okLabel;
    _confirmCancel.textContent = cancelLabel;
    _confirmOk.classList.toggle('text-rose-600',   danger);
    _confirmOk.classList.toggle('active:bg-rose-50', danger);
    _confirmOk.classList.toggle('text-indigo-600',  !danger);
    _confirmOk.classList.toggle('active:bg-indigo-50', !danger);
    _confirmModal.classList.remove('hidden');
    _confirmModal.classList.add('flex');
    _bodyLockAdd();
    const cleanup = (result) => {
      _confirmModal.classList.add('hidden');
      _confirmModal.classList.remove('flex');
      _bodyLockRemove();
      _confirmOk.onclick = null;
      _confirmCancel.onclick = null;
      _confirmModal.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
    };
    _confirmOk.onclick     = () => cleanup(true);
    _confirmCancel.onclick = () => cleanup(false);
    _confirmModal.onclick  = (e) => { if (e.target === _confirmModal) cleanup(false); };
    document.addEventListener('keydown', onKey);
    // Auto-focus OK so keyboard users see the focus ring
    setTimeout(() => _confirmOk.focus(), 0);
  });
}

// Async replacement for window.prompt — returns the entered string trimmed,
// or null on cancel / empty input. Reuses the #prompt-modal in index.html.
const _promptModal  = document.getElementById('prompt-modal');
const _promptTitle  = document.getElementById('prompt-title');
const _promptMsg    = document.getElementById('prompt-msg');
const _promptInput  = document.getElementById('prompt-input');
const _promptOk     = document.getElementById('prompt-ok');
const _promptCancel = document.getElementById('prompt-cancel');
function uiPrompt(message, opts = {}) {
  const {
    title       = 'ระบุข้อมูล',
    placeholder = '',
    initial     = '',
    okLabel     = 'ตกลง',
    cancelLabel = 'ยกเลิก',
  } = opts;
  return new Promise(resolve => {
    _promptTitle.textContent       = title;
    _promptMsg.textContent         = message || '';
    _promptMsg.style.display       = message ? '' : 'none';
    _promptInput.value             = initial;
    _promptInput.placeholder       = placeholder;
    _promptOk.textContent          = okLabel;
    _promptCancel.textContent      = cancelLabel;
    _promptModal.classList.remove('hidden');
    _promptModal.classList.add('flex');
    const cleanup = (result) => {
      _promptModal.classList.add('hidden');
      _promptModal.classList.remove('flex');
      _promptOk.onclick = null;
      _promptCancel.onclick = null;
      _promptModal.onclick = null;
      _promptInput.onkeydown = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const submit = () => {
      const v = (_promptInput.value || '').trim();
      cleanup(v || null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
    };
    _promptInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    _promptOk.onclick      = submit;
    _promptCancel.onclick  = () => cleanup(null);
    _promptModal.onclick   = (e) => { if (e.target === _promptModal) cleanup(null); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => { _promptInput.focus(); _promptInput.select(); }, 0);
  });
}
// Connection dropdown ใน group form — collapsible multi-select grouped by kind.
//   คลิก trigger → เปิด/ปิด panel · คลิก option → toggle เลือก (panel ยังเปิด) ·
//   คลิกที่อื่นในฟอร์ม → ปิด panel · ทุกครั้งที่ toggle อัพเดต hidden input + ข้อความสรุป
modalForm.addEventListener('click', e => {
  const dd = modalForm.querySelector('[data-conn-dd]');
  if (!dd) return;
  const trigger = e.target.closest('[data-conn-dd-trigger]');
  if (trigger && dd.contains(trigger)) {
    e.preventDefault();
    const open = dd.classList.toggle('open');
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    return;
  }
  const opt = e.target.closest('.conn-dd-opt[data-conn-id]');
  if (opt && dd.contains(opt)) {
    e.preventDefault();
    const on = opt.classList.toggle('selected');
    opt.setAttribute('aria-selected', on ? 'true' : 'false');
    const ids = Array.from(dd.querySelectorAll('.conn-dd-opt.selected'))
      .map(c => c.dataset.connId).filter(Boolean);
    const hidden = modalForm.querySelector('#group-conn-ids');
    if (hidden) hidden.value = ids.join(',');
    const summary = dd.querySelector('[data-conn-dd-summary]');
    if (summary) summary.textContent = ids.length > 0 ? `เลือกแล้ว ${ids.length} อย่าง` : 'เลือก Connection ที่เกี่ยวข้อง';
    return;
  }
  // คลิกนอก dropdown → ปิด panel
  if (dd.classList.contains('open') && !e.target.closest('[data-conn-dd]')) {
    dd.classList.remove('open');
    const t = dd.querySelector('[data-conn-dd-trigger]');
    if (t) t.setAttribute('aria-expanded', 'false');
  }
});
// Toggle member chips inside any modal form (single source — works for taskFormFields, multi-task etc.)
// Also tracks click order via data-select-order so callers can recover selection order
// (e.g. group form uses the first selected chip as the auto-assigned leader).
modalForm.addEventListener('click', e => {
  const chip = e.target.closest('.member-chip[data-member-id]');
  if (!chip) return;
  e.preventDefault();
  const grid = chip.closest('.member-chip-grid');
  const willBeSelected = !chip.classList.contains('selected');
  chip.classList.toggle('selected');
  if (willBeSelected) {
    // Assign a click-order counter (per grid) so we know who was clicked first
    const next = (+(grid?.dataset.chipCounter || '0')) + 1;
    if (grid) grid.dataset.chipCounter = String(next);
    chip.dataset.selectOrder = String(next);
  } else {
    delete chip.dataset.selectOrder;
  }
  if (!grid) return;
  const pill = grid.parentElement?.querySelector('.member-count-pill');
  if (!pill) return;
  const count = grid.querySelectorAll('.member-chip.selected').length;
  if (count > 0) { pill.textContent = `เลือกแล้ว ${count} คน`; pill.classList.add('has'); }
  else { pill.textContent = 'เลือกอย่างน้อย 1 คน'; pill.classList.remove('has'); }
});

// Toggle category chips — multi-select pills in the task/meeting form.
// Independent of member chips: tracks selection via .selected class only (no
// leader logic). Also updates the "เลือก N / M" counter + visibility of
// "ล้างทั้งหมด" so the user gets instant feedback without re-render.
function _updateCatCounter() {
  // ── Shared cat-dropdown (top-level in task/meeting edit form) ──
  const grid = modalForm.querySelector('.cat-section .cat-chip-grid');
  if (grid) {
    const selectedChips = grid.querySelectorAll('.cat-chip.selected');
    const count = selectedChips.length;
    const lbl = modalForm.querySelector('#cat-sel-count');
    if (lbl) lbl.textContent = count;
    const clr = modalForm.querySelector('#cat-clear-all');
    if (clr) clr.style.display = count ? '' : 'none';
    const summary = modalForm.querySelector('#cat-summary-tags');
    if (summary) {
      summary.innerHTML = count
        ? Array.from(selectedChips).map(c => `<span class="cat-summary-chip">${escapeHtml(c.dataset.catFull || c.dataset.catName || c.textContent.trim())}</span>`).join('')
        : '<span class="text-[11px] text-slate-400 italic">— ยังไม่ได้เลือก —</span>';
    }
  }
  // ── Per-row cat-dropdowns (multi-task modal: 1 task = 1 ชุด tag) ──
  modalForm.querySelectorAll('.row-cat-dropdown').forEach(_updateRowCatCounter);
}
function _updateRowCatCounter(rowSec) {
  const chips = rowSec.querySelectorAll('.cat-chip.selected[data-category-id]');
  const count = chips.length;
  const lbl = rowSec.querySelector('.row-cat-sel-count');
  if (lbl) lbl.textContent = count;
  const clr = rowSec.querySelector('.row-cat-clear');
  if (clr) clr.style.display = count ? '' : 'none';
  const summary = rowSec.querySelector('.row-cat-summary-tags');
  if (summary) {
    summary.innerHTML = count
      ? Array.from(chips).map(c => `<span class="cat-summary-chip">${escapeHtml(c.dataset.catFull || c.textContent.trim())}</span>`).join('')
      : '<span class="text-[11px] text-slate-400 italic">— ยังไม่ได้เลือก —</span>';
  }
}
modalForm.addEventListener('click', async e => {
  // Toggle edit-mode บน row-cat-dropdown — โผล่ไอคอน ✏️🗑️ ใน chips
  const editBtn = e.target.closest('.row-cat-edit-mode');
  if (editBtn) {
    e.preventDefault();
    const rowSec = editBtn.closest('.row-cat-dropdown');
    if (rowSec) {
      const on = rowSec.classList.toggle('edit-mode');
      editBtn.classList.toggle('active', on);
      editBtn.textContent = on ? '✓ เสร็จ' : '⚙️ จัดการประเภท';
      const hint = rowSec.querySelector('.row-cat-edit-hint');
      if (hint) hint.style.display = on ? '' : 'none';
    }
    return;
  }
  // แก้ไขชื่อประเภท — prompt → PUT /api/categories/:id → refresh ทุก row
  const catEdit = e.target.closest('[data-cat-edit-id]');
  if (catEdit) {
    e.preventDefault(); e.stopPropagation();
    const id = catEdit.dataset.catEditId;
    const cat = state.categories.find(c => c.id === id);
    if (!cat) return;
    const newName = await uiPrompt('แก้ไขชื่อประเภทงาน (รูปแบบ "หมวด - ชื่อ"):', {
      title: '✏️ แก้ไขประเภท',
      initial: cat.name,
      okLabel: 'บันทึก',
    });
    if (!newName || newName.trim() === cat.name) return;
    try {
      const updated = await api.put('/api/categories/' + id, { name: newName.trim() });
      cat.name = updated.name;
      state.categories.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      // Refresh ทุก row dropdown ใน modal (chip อาจถูก reorder/regroup ตามชื่อใหม่)
      refreshAllRowCatGrids();
      toast('แก้ไขชื่อแล้ว', 'success');
    } catch (err) {
      toast(err.message || 'แก้ไขไม่สำเร็จ', 'error');
    }
    return;
  }
  // ลบประเภท — confirm → DELETE → cascade ลบ task-tag link ทุกตัวที่ใช้ tag นี้
  const catDel = e.target.closest('[data-cat-delete-id]');
  if (catDel) {
    e.preventDefault(); e.stopPropagation();
    const id = catDel.dataset.catDeleteId;
    const cat = state.categories.find(c => c.id === id);
    if (!cat) return;
    if (!(await uiConfirm(
      `ลบประเภท "${cat.name}"?\ntask ทุกตัวที่ tag ด้วยประเภทนี้จะถูก unlink อัตโนมัติ (ตัว task เองไม่ถูกลบ)`,
      { title: '🗑️ ลบประเภทงาน', okLabel: 'ลบ', danger: true }
    ))) return;
    try {
      await api.del('/api/categories/' + id);
      state.categories = state.categories.filter(c => c.id !== id);
      refreshAllRowCatGrids();
      // ลบ tag ออกจาก state.tasks ที่ใช้ tag นี้ (UI sync ทันที ไม่ต้องรอ loadAll)
      state.tasks.forEach(t => {
        if (t.categories) t.categories = t.categories.filter(c => c.id !== id);
      });
      toast('ลบแล้ว', 'success');
    } catch (err) {
      toast(err.message || 'ลบไม่สำเร็จ', 'error');
    }
    return;
  }
  // Row-scoped "ล้างที่เลือก" — เคลียร์ tag ทุกตัวใน row นั้น
  const rowClr = e.target.closest('.row-cat-clear');
  if (rowClr) {
    e.preventDefault();
    const rowSec = rowClr.closest('.row-cat-dropdown');
    if (rowSec) {
      rowSec.querySelectorAll('.cat-chip.selected').forEach(c => c.classList.remove('selected'));
      _updateRowCatCounter(rowSec);
    }
    return;
  }
  // กดที่ chip — toggle .selected (เลือก/ไม่เลือก) เฉพาะเมื่อไม่ได้อยู่ใน edit-mode
  const chip = e.target.closest('.cat-chip[data-category-id]');
  if (!chip) return;
  // อยู่ใน edit-mode → ไม่ toggle selection (ป้องกันกดผิด)
  if (chip.closest('.row-cat-dropdown.edit-mode')) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  chip.classList.toggle('selected');
  _updateCatCounter();
});
// Search filter + clear-all on the category section. Delegated input listener
// so it survives whichever form (task / meeting / multi-task) is mounted.
// Hides chips that don't match, and entire group sections whose chips are
// all filtered out so the layout stays clean.
modalForm.addEventListener('input', e => {
  if (e.target.id !== 'cat-search') return;
  const q = (e.target.value || '').trim().toLowerCase();
  let totalVisible = 0;
  modalForm.querySelectorAll('.cat-section .cat-group').forEach(grp => {
    let groupHas = 0;
    grp.querySelectorAll('.cat-chip[data-cat-name]').forEach(chip => {
      const match = !q || chip.dataset.catName.includes(q) || (chip.dataset.catGroup || '').includes(q);
      chip.style.display = match ? '' : 'none';
      if (match) groupHas++;
    });
    grp.style.display = groupHas > 0 ? '' : 'none';
    totalVisible += groupHas;
  });
  const empty = modalForm.querySelector('#cat-empty-msg');
  if (empty) empty.style.display = (q && totalVisible === 0) ? '' : 'none';
  const clr = modalForm.querySelector('#cat-search-clear');
  if (clr) clr.style.display = q ? '' : 'none';
});
modalForm.addEventListener('click', e => {
  if (e.target.id === 'cat-search-clear') {
    const inp = modalForm.querySelector('#cat-search');
    if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); }
  }
  if (e.target.id === 'cat-clear-all') {
    modalForm.querySelectorAll('.cat-chip.selected').forEach(c => c.classList.remove('selected'));
    _updateCatCounter();
  }
});

// Kind toggle has been removed — task and meeting now have separate modals
// (openTaskModal / openMeetingModal). The form's hidden input[name="kind"] is
// hardcoded based on which modal opened.

// When the deadline input changes, refresh the on-leave indicators on member chips
// so the user sees who's unavailable at the new moment.
modalForm.addEventListener('change', e => {
  if (e.target.name !== 'deadline') return;
  const deadline = e.target.value;
  modalForm.querySelectorAll('.member-chip[data-member-id]').forEach(chip => {
    const mid = chip.dataset.memberId;
    const onLeave = deadline ? memberLeaveAt(mid, deadline) : null;
    chip.classList.toggle('on-leave', !!onLeave);
    // Update or remove leave 🏖️ marker in the chip name
    const nameEl = chip.querySelector('.member-chip-name');
    if (nameEl) {
      const baseName = nameEl.textContent.replace(/\s*🏖️\s*$/, '');
      nameEl.textContent = baseName + (onLeave ? ' 🏖️' : '');
    }
    if (onLeave) {
      const m = memberById(mid);
      chip.title = `${m?.name||''} กำลังลา${onLeave.reason ? ': '+onLeave.reason : ''} (${fmtDateTime(onLeave.start_at)} → ${fmtDateTime(onLeave.end_at)})`;
    } else {
      chip.removeAttribute('title');
    }
  });
});

// Meeting location radio click (visual-only — actual radio input handles the value)
modalForm.addEventListener('change', e => {
  if (e.target.matches('input[name="location_type"]')) {
    modalForm.querySelectorAll('.location-option').forEach(o => {
      const inp = o.querySelector('input[name="location_type"]');
      o.classList.toggle('selected', !!(inp && inp.checked));
    });
  }
});

// Budget input — blur แล้วแปลงเป็น formatted (เช่น "50k" → "50,000")
// ทำผ่าน capture phase เพื่อ delegate ไป input ทั้งหมดใน modalForm
modalForm.addEventListener('blur', e => {
  if (!e.target.classList?.contains('budget-input')) return;
  const v = parseBudgetInput(e.target.value);
  if (v != null) e.target.value = formatBudgetDisplay(v);
  else if (e.target.value.trim() !== '' && !/^[\d\s,.kKmMbB]*$/.test(e.target.value)) {
    // invalid input — flag visually
    e.target.classList.add('input-invalid');
  } else {
    e.target.classList.remove('input-invalid');
  }
}, true);

modalForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!modalSubmit) return;
  // แปลง budget-input "50k" / "50,000" → raw number ก่อน FormData อ่านค่า
  modalForm.querySelectorAll('.budget-input').forEach(inp => {
    const v = parseBudgetInput(inp.value);
    if (v != null) inp.value = String(v);
    // ว่างไว้ก็ปล่อยว่าง (backend แปลงเป็น null)
  });
  const fd = new FormData(modalForm);
  const data = {};
  fd.forEach((v, k) => {
    if (k.endsWith('[]')) { const key = k.slice(0,-2); data[key] = data[key] || []; if (v) data[key].push(v); }
    else data[k] = v;
  });
  // Gather assignees from <select> (legacy) or single chip-grid (new design).
  // Sort by click order (data-select-order) so the first-clicked chip is first in the array
  // — used by group form to assign the first added member as the leader.
  const sel = modalForm.querySelector('select[name="assignee_ids[]"]');
  if (sel) data.assignee_ids = Array.from(sel.selectedOptions).map(o => o.value);
  else {
    const grids = modalForm.querySelectorAll('.member-chip-grid');
    if (grids.length === 1) {
      const chips = Array.from(grids[0].querySelectorAll('.member-chip.selected'));
      chips.sort((a, b) => {
        const ao = +a.dataset.selectOrder || Infinity;
        const bo = +b.dataset.selectOrder || Infinity;
        if (ao !== bo) return ao - bo;
        // fallback — DOM order if neither (shouldn't happen with our click handler)
        return 0;
      });
      data.assignee_ids = chips.map(c => c.dataset.memberId);
    }
    // multi-grid case (multi-task modal) is handled inside its own callback
  }
  // Gather selected category IDs (multi-select) — empty array if none selected
  const catChips = modalForm.querySelectorAll('.cat-chip.selected[data-category-id]');
  data.category_ids = Array.from(catChips).map(c => c.dataset.categoryId);
  try { await modalSubmit(data); closeModal(); }
  catch (err) { toast(err.message, 'error'); }
});

// ============== Forms ==============
// Shared helpers for task + meeting forms.
function _formGroupsDropdown(t, includeLabWide = false) {
  const labOption = includeLabWide ? '— ไม่อยู่ในกลุ่ม (ประชุมรวม Lab) —' : '— เลือกกลุ่ม —';
  return `<option value="">${labOption}</option>` +
    state.groups.map(g => `<option value="${g.id}" ${g.id===t.group_id?'selected':''}>${escapeHtml(g.name)}</option>`).join('');
}
function _formMemberChips(t) {
  const selectedIds = new Set((t.assignees || []).map(a => a.id));
  // If the form has a deadline (task) or datetime (meeting), check each member's leave
  // status at that moment so users see "on leave" warnings before assigning.
  const referenceTime = t.deadline || null;
  return state.members.map(m => {
    const onLeave = referenceTime ? memberLeaveAt(m.id, referenceTime) : null;
    const tip = onLeave
      ? `${m.name} กำลังลา${onLeave.reason ? ': '+onLeave.reason : ''} (${fmtDateTime(onLeave.start_at)} → ${fmtDateTime(onLeave.end_at)})`
      : '';
    // Avatar element — uploaded photo if available, else initial-on-color circle
    const avatarInner = m.avatar_url
      ? `<img class="member-chip-avatar member-chip-avatar-img" src="${escapeHtml(m.avatar_url)}" alt="">`
      : `<span class="member-chip-avatar">${escapeHtml(initials(m.name))}</span>`;
    return `
    <button type="button" class="member-chip ${selectedIds.has(m.id)?'selected':''} ${onLeave?'on-leave':''}"
            data-member-id="${m.id}" style="--m-color:${m.color}"
            ${tip ? `title="${escapeHtml(tip)}"` : ''}>
      ${avatarInner}
      <span class="member-chip-name">${escapeHtml(m.name)}${onLeave?' 🏖️':''}</span>
    </button>
  `;
  }).join('');
}
function _formMemberCountPill(t) {
  const initialCount = (t.assignees || []).length;
  return `<span class="member-count-pill ${initialCount>0?'has':''}">${initialCount>0?`เลือกแล้ว ${initialCount} คน`:'เลือกอย่างน้อย 1 คน'}</span>`;
}
// Category chip selector — multi-select pills + "+ เพิ่มประเภทใหม่" inline button.
// Used in both task form and meeting form.
// Visual prefix → emoji map for the category section headers. Categories use
// the convention "<หมวด> - <ชื่อ>" (e.g. "เอกสาร - Proposal"); the heading is
// derived from the prefix. Anything without a prefix lands in "อื่น ๆ".
const CAT_GROUP_ICONS = {
  'Dev':       '💻',
  'Extrovert': '🗣️',
  'ม้าเร็ว':   '🏃',
  'ศิลป์':     '🎨',
  'เอกสาร':    '📄',
  'อื่น ๆ':    '🏷️',
};
function _splitCategoryName(name) {
  // Split on " - " (with surrounding spaces) — tolerates one or several spaces.
  const m = String(name || '').split(/\s+-\s+/);
  if (m.length >= 2) return { prefix: m[0].trim(), sub: m.slice(1).join(' - ').trim() };
  return { prefix: 'อื่น ๆ', sub: String(name || '') };
}

// ===== Per-row category chip grid (multi-task modal) =====
// Module-level เพื่อให้ click handler (edit/delete) เรียก refresh ได้
// แต่ละ chip ห่อด้วย .cat-chip-wrap + ไอคอน edit/delete (โผล่เมื่อ dropdown มี .edit-mode)
function _rowCatChipsHtml() {
  const sorted = (state.categories || []).slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
  if (sorted.length === 0) {
    return '<span class="text-[11px] text-slate-400 italic">ยังไม่มีประเภทงาน — กด "+ เพิ่มประเภทงานใหม่" ด้านบน</span>';
  }
  const groups = new Map();
  for (const c of sorted) {
    const { prefix, sub } = _splitCategoryName(c.name);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push({ ...c, _sub: sub });
  }
  const sortedGroups = [...groups.keys()].sort((a, b) => {
    if (a === 'อื่น ๆ') return 1;
    if (b === 'อื่น ๆ') return -1;
    return a.localeCompare(b, 'th');
  });
  return sortedGroups.map(g => {
    const items = groups.get(g);
    const chips = items.map(c => `
      <span class="cat-chip-wrap">
        <button type="button" class="cat-chip" data-category-id="${c.id}"
                data-cat-full="${escapeHtml(c.name)}"
                title="${escapeHtml(c.name)}">${escapeHtml(c._sub)}</button>
        <span class="cat-chip-actions">
          <button type="button" class="cat-chip-edit" data-cat-edit-id="${c.id}" title="แก้ไขชื่อ">✏️</button>
          <button type="button" class="cat-chip-delete" data-cat-delete-id="${c.id}" title="ลบ">🗑️</button>
        </span>
      </span>
    `).join('');
    return `
      <div class="cat-group">
        <div class="cat-group-header">
          <span class="cat-group-label">${CAT_GROUP_ICONS[g] || '📁'} ${escapeHtml(g)}</span>
          <span class="cat-group-count">${items.length}</span>
        </div>
        <div class="cat-chip-grid">${chips}</div>
      </div>
    `;
  }).join('');
}
// Refresh ทุก row-cat-dropdown ใน modal — รักษา selection + อัปเดต total + counter
function refreshAllRowCatGrids() {
  const newTotal = (state.categories || []).length;
  document.querySelectorAll('#multi-rows .row-cat-dropdown').forEach(rowSec => {
    const grid = rowSec.querySelector('.row-cat-chip-grid');
    if (!grid) return;
    const selectedIds = new Set(Array.from(grid.querySelectorAll('.cat-chip.selected[data-category-id]'))
      .map(c => c.dataset.categoryId));
    grid.innerHTML = _rowCatChipsHtml();
    grid.querySelectorAll('.cat-chip[data-category-id]').forEach(chip => {
      if (selectedIds.has(chip.dataset.categoryId)) chip.classList.add('selected');
    });
    const titleEl = rowSec.querySelector('.form-section-title');
    if (titleEl) {
      titleEl.innerHTML = `🏷️ ประเภทงาน
        <span class="text-[11px] font-normal text-slate-500">เลือก <b class="row-cat-sel-count">${grid.querySelectorAll('.cat-chip.selected').length}</b> / ${newTotal}</span>`;
    }
    _updateRowCatCounter(rowSec);
  });
}

function _formCategoriesSection(t = {}) {
  const selectedIds = new Set((t.categories || []).map(c => c.id));
  // Sort alphabetically once at render; the "selected first" behaviour within
  // each group is handled by CSS `order` on `.cat-chip.selected` so toggling
  // doesn't require re-rendering the DOM.
  const all = (state.categories || []).slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
  // Bucket by prefix
  const groups = new Map();
  for (const c of all) {
    const { prefix, sub } = _splitCategoryName(c.name);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push({ ...c, _sub: sub });
  }
  // Group ordering: alphabetical, but "อื่น ๆ" always last (catch-all).
  const sortedGroups = [...groups.keys()].sort((a, b) => {
    if (a === 'อื่น ๆ') return 1;
    if (b === 'อื่น ๆ') return -1;
    return a.localeCompare(b, 'th');
  });
  const total = all.length;
  const sel = selectedIds.size;

  const groupHtml = sortedGroups.map(g => {
    const items = groups.get(g);
    const chips = items.map(c => `
      <button type="button"
              class="cat-chip ${selectedIds.has(c.id)?'selected':''}"
              data-category-id="${c.id}"
              data-cat-name="${escapeHtml((c.name||'').toLowerCase())}"
              data-cat-group="${escapeHtml(g.toLowerCase())}"
              title="${escapeHtml(c.name)}">${escapeHtml(c._sub)}</button>
    `).join('');
    return `
      <div class="cat-group" data-cat-group-key="${escapeHtml(g)}">
        <div class="cat-group-header">
          <span class="cat-group-label">${CAT_GROUP_ICONS[g] || '📁'} ${escapeHtml(g)}</span>
          <span class="cat-group-count">${items.length}</span>
        </div>
        <div class="cat-chip-grid">${chips}</div>
      </div>
    `;
  }).join('');

  // Selected category names — แสดงเป็น chips ใน summary (header เมื่อ collapsed)
  // ใช้ `all` (sorted state.categories) ไม่ใช่ `categories` ซึ่งไม่ได้ประกาศใน scope นี้
  const selectedNames = all.filter(c => selectedIds.has(c.id))
    .map(c => `<span class="cat-summary-chip">${escapeHtml(c.name)}</span>`)
    .join('');
  return `
    <details class="form-section cat-section cat-dropdown" ${sel === 0 ? '' : 'open'}>
      <summary class="cat-summary">
        <span class="form-section-title">🏷️ ประเภทงาน <span class="cat-counter text-[11px] font-normal text-slate-500">เลือก <b id="cat-sel-count">${sel}</b> / ${total}</span></span>
        <span class="cat-summary-tags" id="cat-summary-tags">${selectedNames || '<span class="text-[11px] text-slate-400 italic">— ยังไม่ได้เลือก —</span>'}</span>
        <span class="cat-summary-caret" aria-hidden="true">▾</span>
      </summary>
      <div class="cat-dropdown-body">
        <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div class="flex items-center gap-1">
            <button type="button" class="ios-btn-ghost text-xs" id="cat-clear-all" ${sel === 0 ? 'style="display:none"' : ''}>ล้างทั้งหมด</button>
            <button type="button" class="ios-btn-ghost text-xs" id="task-add-category">+ เพิ่ม</button>
          </div>
        </div>
        <div class="cat-search-wrap">
          <span class="cat-search-icon">🔍</span>
          <input type="text" id="cat-search" class="cat-search-input" placeholder="ค้นหา..." autocomplete="off">
          <button type="button" id="cat-search-clear" class="cat-search-clear" title="ล้าง" style="display:none">×</button>
        </div>
        <div class="cat-groups">${groupHtml || '<div class="text-[11px] text-slate-400 italic w-full">ยังไม่มีประเภทงาน — กดเพิ่มประเภทใหม่ได้</div>'}</div>
        <div id="cat-empty-msg" class="text-[11px] text-slate-400 italic" style="display:none">ไม่พบประเภทงานที่ตรงกับคำค้นหา — กด "+ เพิ่ม" เพื่อสร้างใหม่</div>
        <div class="text-[11px] text-slate-400 mt-1">เลือกได้หลายประเภท · ตั้งชื่อแบบ <b>"หมวด - ชื่อ"</b> (เช่น "เอกสาร - MOU") เพื่อจัดกลุ่มอัตโนมัติ</div>
      </div>
    </details>
  `;
}

// Task form (kind='task' only) — no kind toggle, no meeting fields.
// Includes: title/description · group + create-new-group · deadline (date) · assignees · status
function taskFormFields(t = {}) {
  const status = ['on_hold','in_progress','completed','cancelled']
    .map(s => `<option value="${s}" ${s===t.status?'selected':''}>${statusLabel(s)}</option>`).join('');
  const groups = _formGroupsDropdown(t, false);
  const taskDl = t.deadline ? t.deadline.slice(0,10) : '';
  return `
    <input type="hidden" name="kind" value="task">
    <div class="form-section">
      <input class="ios-input form-title-input" name="title" value="${escapeHtml(t.title||'')}" required placeholder="หัวข้องาน *">
      <textarea class="ios-textarea" name="description" rows="4" placeholder="รายละเอียด (ไม่บังคับ) — รองรับ Markdown เช่น **เน้น**, *เอียง*, # หัวข้อ, - รายการ, [ลิงค์](url), \`code\`">${escapeHtml(t.description||'')}</textarea>
      <div class="text-[11px] text-slate-400 mt-1">📝 รองรับ Markdown: <b>**เน้น**</b> · <i>*เอียง*</i> · <code>\`code\`</code> · # หัวข้อ · - รายการ · [ลิงค์](url)</div>
    </div>

    <div class="form-section">
      <div class="form-section-title">📁 โครงการ</div>
      <div>
        <label class="ios-label">Group</label>
        <div class="flex items-stretch gap-2">
          <select class="ios-select flex-1" name="group_id" data-task-group-select>${groups}</select>
          <button type="button" class="ios-btn-ghost text-xs whitespace-nowrap" id="task-create-new-group" title="ยังไม่มีกลุ่มที่เหมาะสม? สร้างกลุ่มใหม่ที่นี่">+ สร้างกลุ่มใหม่</button>
        </div>
      </div>
      <div class="text-[11px] text-slate-400">"ส่งให้ใคร" ตั้งที่ระดับ Group — งานทั้งหมดในกลุ่มจะถูกส่งให้ที่เดียวกัน</div>
    </div>

    <!-- Standalone task target — only visible when no group is selected.
         JS toggles the hidden attribute based on the group dropdown's value
         (and clears the field on group change so we don't submit a stale target). -->
    <div class="form-section" data-task-target-section ${t.group_id ? 'hidden' : ''}>
      <div class="form-section-title">📤 ส่งให้ใคร (Target)</div>
      <input class="ios-input" name="target" value="${escapeHtml(t.target||'')}"
             placeholder="เช่น อบจ.ฉะเชิงเทรา / กระทรวงคมนาคม / แล็บภายใน"
             list="task-target-list">
      <datalist id="task-target-list">${
        Array.from(new Set([
          ...state.groups.map(g => g.target).filter(Boolean),
          ...state.tasks.map(x => x.target).filter(Boolean),
        ])).sort().map(t => `<option value="${escapeHtml(t)}">`).join('')
      }</datalist>
      <div class="text-[11px] text-slate-400 mt-1">เนื่องจากไม่ได้อยู่ในกลุ่ม คุณสามารถระบุเป้าหมายของงานนี้ได้เอง</div>
    </div>

    <div class="form-section">
      <div class="form-section-title">⏰ Deadline</div>
      <div><input class="ios-input" name="deadline" type="date" value="${taskDl}" required></div>
      <div class="text-[11px] text-slate-400">วันที่เริ่มงาน = วันที่สร้าง · ⭐ Points จะถูกกำหนดหลังงานเสร็จ</div>
    </div>

    <div class="form-section">
      <div class="form-section-title">💰 งบประมาณ (ไม่บังคับ)</div>
      <input class="ios-input budget-input" name="budget" type="text" inputmode="decimal" autocomplete="off"
             value="${t.budget != null ? formatBudgetDisplay(t.budget) : ''}"
             placeholder="เช่น 50,000  หรือ  50k / 1.5m / 2b">
      <div class="text-[11px] text-slate-400">เว้นว่างได้ · รองรับ <b>k</b>=พัน, <b>m</b>=ล้าน, <b>b</b>=พันล้าน</div>
    </div>

    <div class="form-section">
      <div class="form-section-title">🏷️ แท็กพิเศษ (ไม่บังคับ)</div>
      <select class="ios-select" name="priority">
        <option value=""               ${!t.priority ? 'selected' : ''}>— ปกติ —</option>
        <option value="urgent"         ${t.priority === 'urgent' ? 'selected' : ''}>🔥 งานด่วน</option>
        <option value="before_morning" ${t.priority === 'before_morning' ? 'selected' : ''}>🌅 ไม่รีบ แต่เอาก่อนเช้า</option>
      </select>
    </div>

    ${_formCategoriesSection(t)}

    <div class="form-section">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="form-section-title">👥 ผู้รับผิดชอบ *</span>
          ${_formMemberCountPill(t)}
        </div>
        <button type="button" class="ios-btn-ghost text-xs" id="task-select-all">เลือกทุกคน</button>
      </div>
      <div class="member-chip-grid">${_formMemberChips(t)}</div>
    </div>

    <div class="form-section">
      <label class="ios-label">สถานะ</label>
      <select class="ios-select" name="status">${status}</select>
    </div>
  `;
}

// Meeting form (kind='meeting') — has location section + datetime-local input,
// NO status select (meetings always show "📅 การประชุม" badge).
function meetingFormFields(t = {}) {
  const groups = _formGroupsDropdown(t, true);
  const locType = t.location_type || '';
  // Use the cleaned detail so a legacy stale "Lab @ECC-504" on a non-internal
  // meeting doesn't pre-fill the input (the user just sees an empty field as
  // expected).
  const locDetail = meetingDetailFor(t);
  const dl = t.deadline || '';
  const meetingDl = dl ? (dl.includes('T') ? dl.slice(0,16) : dl.slice(0,10) + 'T09:00') : '';
  // Default end time: +1 hour from start (matches the historical ICS default).
  const endRaw = t.end_time || '';
  let meetingEnd = endRaw ? (endRaw.includes('T') ? endRaw.slice(0,16) : endRaw.slice(0,10) + 'T10:00') : '';
  if (!meetingEnd && meetingDl) {
    const s = new Date(meetingDl); s.setMinutes(s.getMinutes() + 60);
    // local ISO without seconds (datetime-local input format)
    const pad = (n) => String(n).padStart(2,'0');
    meetingEnd = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}T${pad(s.getHours())}:${pad(s.getMinutes())}`;
  }
  return `
    <input type="hidden" name="kind" value="meeting">
    <div class="form-section">
      <input class="ios-input form-title-input" name="title" value="${escapeHtml(t.title||'')}" required placeholder="หัวข้อการประชุม *">
      <textarea class="ios-textarea" name="description" rows="4" placeholder="วาระ / รายละเอียดการประชุม (ไม่บังคับ) — รองรับ Markdown">${escapeHtml(t.description||'')}</textarea>
      <div class="text-[11px] text-slate-400 mt-1">📝 รองรับ Markdown: <b>**เน้น**</b> · <i>*เอียง*</i> · <code>\`code\`</code> · # หัวข้อ · - รายการ · [ลิงค์](url)</div>
    </div>

    <div class="form-section meeting-section">
      <div class="form-section-title">📍 สถานที่ประชุม</div>
      <div class="location-radio-group">
        ${[
          { v: 'online',          icon: '💻', label: 'Online' },
          { v: 'onsite_internal', icon: '🏢', label: 'ในสถานที่ — Lab @ECC-504' },
          { v: 'onsite_external', icon: '📍', label: 'นอกสถานที่' },
        ].map(o => `
          <label class="location-option ${locType===o.v?'selected':''}">
            <input type="radio" name="location_type" value="${o.v}" ${locType===o.v?'checked':''}>
            <span class="location-option-icon">${o.icon}</span>
            <span class="location-option-label">${o.label}</span>
          </label>
        `).join('')}
      </div>
      <!-- Detail field — label/placeholder/visibility change based on selected location.
           For onsite_internal (fixed Lab @ECC-504) the field is hidden + auto-set on submit. -->
      <div data-location-detail-wrap ${locType === 'onsite_internal' ? 'hidden' : ''}>
        <label class="ios-label" data-location-detail-label>${
          locType === 'online' ? '🔗 Meet / Zoom Link (ไม่บังคับ)' :
          locType === 'onsite_external' ? '📍 Google Map Link หรือที่อยู่' :
          'รายละเอียด'
        }</label>
        <input class="ios-input" name="location_detail" data-location-detail-input
               value="${escapeHtml(locDetail)}"
               placeholder="${
                 locType === 'online' ? 'เช่น https://meet.google.com/abc-defg-hij' :
                 locType === 'onsite_external' ? 'วาง Google Map URL หรือพิมพ์ที่อยู่ (ค้นใน Google Map ได้)' :
                 ''
               }">
        <div class="text-[11px] text-slate-400 mt-1" data-location-detail-hint>${
          locType === 'online' ? 'แปะลิงค์ Meet / Zoom เพื่อให้ผู้เข้าร่วมเข้าได้ง่าย — เว้นว่างได้' :
          locType === 'onsite_external' ? 'ผู้เข้าร่วมสามารถคลิกเปิดใน Google Map ได้' :
          ''
        }</div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">📁 กลุ่มงาน</div>
      <div>
        <label class="ios-label">Group (เลือก "ประชุมรวม Lab" สำหรับประชุมข้ามกลุ่ม)</label>
        <div class="flex items-stretch gap-2">
          <select class="ios-select flex-1" name="group_id">${groups}</select>
          <button type="button" class="ios-btn-ghost text-xs whitespace-nowrap" id="task-create-new-group" title="สร้างกลุ่มใหม่ที่นี่">+ สร้างกลุ่มใหม่</button>
        </div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-title">📅 วันและเวลานัดประชุม</div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="ios-label">เริ่ม</label>
          <input class="ios-input" name="deadline" type="datetime-local" value="${meetingDl}" data-meeting-start required>
        </div>
        <div>
          <label class="ios-label">สิ้นสุด</label>
          <input class="ios-input" name="end_time" type="datetime-local" value="${meetingEnd}" data-meeting-end>
        </div>
      </div>
      <div class="text-[11px] text-slate-400">เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม — ถ้าไม่ระบุระบบจะใช้ +1 ชม. โดยอัตโนมัติ</div>
    </div>

    <!-- Tag picker intentionally omitted on the meeting form — meetings have
         location_type + organisation context already, so the extra taxonomy
         just clutters the modal. The form-wide submit collector reports an
         empty category_ids array (no chips present) so no schema change. -->

    <div class="form-section">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="form-section-title">👥 ผู้เข้าร่วม *</span>
          ${_formMemberCountPill(t)}
        </div>
        <button type="button" class="ios-btn-ghost text-xs" id="meeting-select-all">เลือกทุกคน</button>
      </div>
      <div class="member-chip-grid">${_formMemberChips(t)}</div>
    </div>
  `;
}

function memberFormFields(m = {}) {
  const roleLabels = { member: 'Member', admin: 'Admin', boss: 'Boss' };
  const role = ['member','admin','boss'].map(r => `<option value="${r}" ${r===m.role?'selected':''}>${roleLabels[r]}</option>`).join('');
  return `
    <div>
      <label class="ios-label">ชื่อ *</label>
      <input class="ios-input" name="name" value="${escapeHtml(m.name||'')}" required placeholder="เช่น วิว, เคน">
    </div>
    <div><label class="ios-label">บทบาท</label><select class="ios-select" name="role">${role}</select></div>
    <div><label class="ios-label">Email</label><input class="ios-input" name="email" type="email" value="${escapeHtml(m.email||'')}"></div>
    <div><label class="ios-label">เบอร์โทร</label><input class="ios-input" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${escapeHtml(m.phone||'')}" placeholder="เช่น 081-234-5678"></div>
    <div><label class="ios-label">สี (Avatar)</label><input class="ios-input" name="color" type="color" value="${m.color||'#6366f1'}" style="height:48px; padding:.25rem"></div>
    ${!m.id ? `<div><label class="ios-label">PIN เริ่มต้น</label><input class="ios-input" name="password" value="1234"></div>` : ''}
  `;
}

function groupFormFields(g = {}) {
  // Group project lifecycle — idea → proposal → pending_approval → in_progress → delivery → maintenance → completed
  // (on_hold / cancelled = สถานะพิเศษ ใช้ทุก stage)
  const groupStatuses = [
    'idea', 'proposal', 'pending_approval',
    'in_progress', 'delivery', 'maintenance',
    'completed', 'on_hold', 'cancelled',
  ];
  const status = groupStatuses.map(s => `<option value="${s}" ${s===g.status?'selected':''}>${statusLabel(s)}</option>`).join('');
  // Admin can pick any leader; current group leader can also change leader (transfer leadership);
  // others (non-admin creating new groups) get auto-self assignment.
  const isCurrentLeader = !!(g.id && g.leader_id === state.user.id);
  const canPickLeader = isAdmin() || isCurrentLeader;
  const leaderOpts = canPickLeader
    ? `<select class="ios-select" name="leader_id">
         <option value="">— ไม่มีหัวหน้า —</option>
         ${state.members.map(m => `<option value="${m.id}" ${m.id===g.leader_id?'selected':''}>${escapeHtml(m.name)} (${m.role==='boss'?'Boss':(m.role==='admin'?'Admin':'Member')})</option>`).join('')}
       </select>`
    : `<div class="text-sm text-slate-700">${state.user.name} <span class="text-[11px] text-slate-500">(คุณจะเป็นหัวหน้า Group โดยอัตโนมัติ)</span></div>`;

  // Member chips — for new groups, default to selecting the leader (admin's choice or self).
  // For editing, we DON'T pre-fill from existing members (those are managed separately via
  // the group's invite/proposal flow). The chips are a "starting members" list at create time.
  const editing = !!g.id;
  const defaultLeaderId = isAdmin() ? (g.leader_id || state.user.id) : state.user.id;
  // Pre-select the leader when creating; for editing show no preselected (existing members already in)
  const preselectedIds = editing ? [] : [defaultLeaderId];
  // Track selection order so the group form assigns the FIRST-selected chip as leader.
  // The pre-selected default leader must count as "first" (order 1) — otherwise it has no
  // data-select-order (=> Infinity) and the FIRST member the user clicks (order 1) would
  // sort ahead of it and steal leadership. (bug: "กดทุกคนมันไปล็อกหัวหน้าแทน")
  let _preselOrder = 0;
  const chipsHtml = state.members.map(m => {
    const selected = preselectedIds.includes(m.id);
    const orderAttr = selected ? ` data-select-order="${++_preselOrder}"` : '';
    const avatarInner = m.avatar_url
      ? `<img class="member-chip-avatar member-chip-avatar-img" src="${escapeHtml(m.avatar_url)}" alt="">`
      : `<span class="member-chip-avatar">${escapeHtml(initials(m.name))}</span>`;
    return `
      <button type="button" class="member-chip ${selected?'selected':''}"
              data-member-id="${m.id}"${orderAttr} style="--m-color:${m.color}">
        ${avatarInner}
        <span class="member-chip-name">${escapeHtml(m.name)}</span>
      </button>`;
  }).join('');

  // Color picker — native color input + hex text input + palette quick presets.
  // editingId: if we're editing g, that group's own color isn't "taken" (allow keeping it).
  const editingId = g.id || null;
  const usedByOthers = new Set(state.groups.filter(x => x.id !== editingId && x.color).map(x => x.color));
  // If editing without a stored color yet, fall back to the resolved one (hash) so picker isn't blank
  const currentColor = (g.color || (editingId ? groupColor(editingId) : '#6366f1')).toLowerCase();
  // Palette แบ่ง 3 tier (อ่อน / กลาง / เข้ม) — แต่ละ tier scroll แนวนอนเอง
  // "used" marker บอกสีที่ซ้ำกลุ่มอื่นแต่ไม่ disable (ผู้ใช้ตัดสินใจเอง)
  const swatchOf = (c) => {
    const isUsed = usedByOthers.has(c);
    const isSelected = c.toLowerCase() === currentColor;
    return `<button type="button"
        class="color-swatch ${isUsed ? 'used' : ''} ${isSelected ? 'selected' : ''}"
        data-color="${c}" style="background:${c}"
        title="${isUsed ? 'สีนี้ถูกใช้กับกลุ่มอื่นแล้ว — กดเพื่อใช้ซ้ำได้' : ''}"></button>`;
  };
  // 3 tier แสดงทีละ box — ใช้ปุ่ม ‹ › ที่ header เปลี่ยน tier
  const tierBox = (key, label, colors, isActive) => `
    <div class="color-tier" data-tier="${key}" ${isActive?'':'hidden'}>
      <div class="color-tier-strip">${colors.map(swatchOf).join('')}</div>
    </div>`;
  // เลือก active tier เริ่มต้น = tier ของ currentColor ถ้าหาเจอ, ไม่งั้น 'medium'
  const _findTier = (col) => {
    if (GROUP_PALETTE_TIERS.light.includes(col)) return 'light';
    if (GROUP_PALETTE_TIERS.bold.includes(col)) return 'bold';
    return 'medium';
  };
  const initTier = _findTier(currentColor);
  const initIdx = initTier === 'light' ? 0 : initTier === 'bold' ? 2 : 1;
  const dotsHtml = ['light','medium','bold'].map((_, i) =>
    `<span class="color-tier-dot ${i===initIdx?'active':''}" data-tier-dot="${i}"></span>`
  ).join('');
  const paletteHtml = `
    ${tierBox('light',  'อ่อน',  GROUP_PALETTE_TIERS.light,  initTier==='light')}
    ${tierBox('medium', 'กลาง', GROUP_PALETTE_TIERS.medium, initTier==='medium')}
    ${tierBox('bold',   'เข้ม', GROUP_PALETTE_TIERS.bold,   initTier==='bold')}
    <div class="color-tier-nav">
      <button type="button" class="color-tier-arrow" data-tier-arrow="prev" aria-label="ก่อนหน้า">‹</button>
      <div class="color-tier-dots" data-tier-dots>${dotsHtml}</div>
      <button type="button" class="color-tier-arrow" data-tier-arrow="next" aria-label="ถัดไป">›</button>
    </div>`;

  return `
    <div><label class="ios-label">ชื่อโครงการ *</label><input class="ios-input" name="name" value="${escapeHtml(g.name||'')}" required></div>
    <div><label class="ios-label">รายละเอียด</label><textarea class="ios-textarea" name="description">${escapeHtml(g.description||'')}</textarea></div>
    <div>
      <label class="ios-label">🎨 สีกลุ่มงาน</label>
      <div class="flex items-center gap-2 mb-2">
        <input type="color" id="group-color-native" class="color-pick-native" value="${currentColor}" aria-label="เลือกสีอิสระ">
        <input type="text" id="group-color-hex" class="ios-input flex-1 color-pick-hex" maxlength="7" placeholder="#RRGGBB" value="${currentColor}" pattern="^#[0-9a-fA-F]{6}$" autocomplete="off">
      </div>
      <div class="color-picker" data-group-color-picker>${paletteHtml}</div>
      <input type="hidden" name="color" value="${currentColor}">
      <div class="text-[11px] text-slate-400 mt-1">เลือกสีอิสระจากตัวเลือกซ้าย พิมพ์รหัส hex หรือกดสี preset ด้านล่าง</div>
      <div class="text-[11px] text-amber-600 mt-0.5 hidden" id="group-color-warn">⚠️ สีนี้ถูกใช้กับกลุ่มอื่นแล้ว — บันทึกได้แต่จะเหมือนกัน</div>
    </div>
    <!-- Leader dropdown: only shown when EDITING (no chip selection in edit mode).
         For new groups, the first selected member chip becomes leader automatically. -->
    ${editing ? `<div><label class="ios-label">หัวหน้า Group</label>${leaderOpts}</div>` : ''}
    <!-- Groups don't have start_date/deadline inputs anymore — server defaults
         start_date to creation date and leaves deadline NULL. -->
    <div class="text-[11px] text-slate-400 -mt-1">วันที่เริ่มกลุ่ม = วันที่สร้าง · ไม่ต้องกำหนด Deadline</div>
    ${editing ? '' : `
    <div>
      <div class="flex items-center justify-between gap-2 flex-wrap mb-1">
        <label class="ios-label" style="margin:0">👥 เพิ่มสมาชิกเริ่มต้น</label>
        <button type="button" class="ios-btn-ghost text-xs" id="group-select-all">เลือกทุกคน</button>
      </div>
      <div class="member-chip-grid" data-chip-counter="${_preselOrder}">${chipsHtml}</div>
      <div class="text-[11px] text-slate-400 mt-1">เพิ่มได้เลยโดยไม่ต้องรอเพื่อนกดยอมรับ · 👑 <b>คนแรกที่เลือก = หัวหน้ากลุ่ม</b></div>
    </div>`}
    ${(() => {
      // Connection picker — collapsible multi-select dropdown grouped by kind
      // (บริษัท / Lobbyist / หน่วยงาน). Selected ids เก็บใน #group-conn-ids (comma-sep)
      // เพื่อให้ submit handler อ่าน connection_ids ได้เหมือนเดิม
      const preSel = new Set(g.connection_ids || []);
      const labelParts = (c) => {
        const labelText = (c.kind === 'lobbyist' || c.kind === 'agency')
          ? (c.liaison_name || c.company) : c.company;
        const sub = (c.kind === 'lobbyist' || c.kind === 'agency')
          ? (c.company ? ` (${c.company})` : '')
          : (c.member_name ? ` · ${c.member_name}` : '');
        return { labelText: labelText || '(ไม่มีชื่อ)', sub };
      };
      const renderOpt = (c) => {
        const sel = preSel.has(c.id);
        const { labelText, sub } = labelParts(c);
        return `<button type="button" class="conn-dd-opt ${sel?'selected':''}" data-conn-id="${c.id}" role="option" aria-selected="${sel?'true':'false'}" title="${escapeHtml(labelText + sub)}">
          <span class="conn-dd-check" aria-hidden="true"></span>
          <span class="conn-dd-opt-label">${escapeHtml(labelText)}${sub ? `<span class="conn-dd-opt-sub">${escapeHtml(sub)}</span>` : ''}</span>
        </button>`;
      };
      const companyConns = state.connections.filter(c => (c.kind||'personal')==='personal');
      const lobbyistConns = state.connections.filter(c => c.kind==='lobbyist');
      const agencyConns = state.connections.filter(c => c.kind==='agency');
      const group = (icon, title, list) => list.length === 0 ? '' : `<div class="conn-dd-group">
        <div class="conn-dd-group-head"><span>${icon}</span><span>${title}</span><span class="conn-dd-group-count">${list.length}</span></div>
        ${list.map(renderOpt).join('')}
      </div>`;
      const total = state.connections.length;
      const selCount = preSel.size;
      const summaryText = selCount > 0 ? `เลือกแล้ว ${selCount} อย่าง` : 'เลือก Connection ที่เกี่ยวข้อง';
      const bodyHtml = total === 0
        ? `<div class="conn-dd-empty">ยังไม่มี Connection — สร้างในหน้า "ความเชื่อมโยง" ก่อน</div>`
        : `${group('🏢','บริษัท',companyConns)}${group('🎯','Lobbyist',lobbyistConns)}${group('🏛️','หน่วยงาน',agencyConns)}`;
      return `
        <div>
          <label class="ios-label">🤝 Connection ที่เกี่ยวข้อง <span class="text-[11px] text-slate-400 font-normal">(เลือกได้หลายอย่าง)</span></label>
          <div class="conn-dd" data-conn-dd>
            <button type="button" class="conn-dd-trigger" data-conn-dd-trigger aria-haspopup="listbox" aria-expanded="false">
              <span class="conn-dd-summary" data-conn-dd-summary>${summaryText}</span>
              <span class="conn-dd-caret" aria-hidden="true">▾</span>
            </button>
            <div class="conn-dd-panel" role="listbox" aria-multiselectable="true">${bodyHtml}</div>
          </div>
          <input type="hidden" name="connection_ids" id="group-conn-ids" value="${(g.connection_ids||[]).join(',')}">
        </div>
      `;
    })()}
    <div><label class="ios-label">สถานะ</label><select class="ios-select" name="status">${status}</select></div>
  `;
}

function connectionFormFields(c = {}) {
  const memberOpts = state.members.map(m => `<option value="${m.id}" ${m.id===(c.member_id||state.user.id)?'selected':''}>${escapeHtml(m.name)}</option>`).join('');
  const kind = c.kind || 'personal';
  const isAgency = kind === 'agency';
  const isLobbyist = kind === 'lobbyist';
  const isPersonal = kind === 'personal';
  return `
    <div>
      <label class="ios-label">ประเภท</label>
      <div class="grid grid-cols-3 gap-2">
        <label class="kind-option ${isPersonal?'selected':''}">
          <input type="radio" name="kind" value="personal" ${isPersonal?'checked':''} class="hidden">
          <span class="kind-icon">🏢</span>
          <span class="kind-label">บริษัท</span>
          <span class="kind-desc">ข้อมูลบริษัท + สมาชิกประสานงาน</span>
        </label>
        <label class="kind-option ${isLobbyist?'selected':''}">
          <input type="radio" name="kind" value="lobbyist" ${isLobbyist?'checked':''} class="hidden">
          <span class="kind-icon">🎯</span>
          <span class="kind-label">Lobbyist</span>
          <span class="kind-desc">คนประสานงานกับหน่วยงาน</span>
        </label>
        <label class="kind-option ${isAgency?'selected':''}">
          <input type="radio" name="kind" value="agency" ${isAgency?'checked':''} class="hidden">
          <span class="kind-icon">🏛️</span>
          <span class="kind-label">หน่วยงาน</span>
          <span class="kind-desc">หน่วยงานที่เราทำงานให้</span>
        </label>
      </div>
    </div>

    <!-- PERSONAL: member owner -->
    <div class="conn-member-row" ${isPersonal ? '' : 'style="display:none"'}>
      <label class="ios-label">สมาชิก (เจ้าของ Connection)</label>
      <select class="ios-select" name="member_id" ${isAdmin()?'':'disabled'}>${memberOpts}</select>
      ${!isAdmin() ? `<input type="hidden" name="member_id_hidden" value="${state.user.id}">` : ''}
    </div>

    <!-- AGENCY/LOBBYIST: ผู้ประสานงาน section
         Agency: liaison = ผู้ประสานงานในหน่วยงาน เช่น พี่ตู่
         Lobbyist: liaison = ชื่อ lobbyist เอง (เก็บแค่ข้อมูลคน) -->
    <div class="conn-liaison-row space-y-2" ${(isAgency || isLobbyist) ? '' : 'style="display:none"'}>
      <div class="conn-section-header conn-liaison-header">${isLobbyist ? '🎯 Lobbyist' : '👤 ผู้ประสานงาน'}</div>
      <div>
        <label class="ios-label conn-liaison-label">${isLobbyist ? 'ชื่อ lobbyist *' : 'ชื่อผู้ประสานงาน *'}</label>
        <input class="ios-input" name="liaison_name" value="${escapeHtml(c.liaison_name||'')}" placeholder="${isLobbyist ? 'เช่น พี่นัท' : 'เช่น พี่ตู่'}">
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="ios-label">ตำแหน่ง</label><input class="ios-input" name="contact_role" value="${escapeHtml(c.contact_role||'')}" placeholder="${isLobbyist ? 'เช่น ที่ปรึกษา' : 'เช่น กองช่าง / ปลัด'}"></div>
        <div><label class="ios-label">เบอร์โทร</label><input class="ios-input" name="phone" type="tel" value="${escapeHtml(c.phone||'')}"></div>
      </div>
      <div>
        <label class="ios-label">อีเมล</label>
        <input class="ios-input" name="email" type="email" value="${escapeHtml(c.email||'')}">
      </div>
    </div>

    <!-- AGENCY only: หน่วยงาน section (lobbyist ไม่มี — เก็บแค่ข้อมูลคน) -->
    <div class="conn-agency-org-row space-y-2" ${isAgency ? '' : 'style="display:none"'}>
      <div class="conn-section-header">🏛️ หน่วยงาน</div>
      <div>
        <label class="ios-label">ชื่อหน่วยงาน *</label>
        <input class="ios-input conn-org-input" name="company" value="${escapeHtml(c.company||'')}" ${isAgency?'required':''} placeholder="เช่น อบจ.ฉะเชิงเทรา / อบต.บางพระ">
      </div>
    </div>

    <!-- PERSONAL: org + contact section -->
    <div class="conn-personal-org-row space-y-2" ${isPersonal ? '' : 'style="display:none"'}>
      <div>
        <label class="ios-label">บริษัท / องค์กร *</label>
        <input class="ios-input conn-org-input" name="company" value="${escapeHtml(c.company||'')}" ${isPersonal?'required':''} placeholder="เช่น บริษัทที่ปรึกษา ABC จำกัด">
      </div>
      <div class="conn-section-header">👤 ผู้ติดต่อ</div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="ios-label">ชื่อผู้ติดต่อ</label><input class="ios-input" name="contact_name" value="${escapeHtml(c.contact_name||'')}"></div>
        <div><label class="ios-label">ตำแหน่ง</label><input class="ios-input" name="contact_role" value="${escapeHtml(c.contact_role||'')}"></div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="ios-label">เบอร์โทร</label><input class="ios-input" name="phone" type="tel" value="${escapeHtml(c.phone||'')}"></div>
        <div><label class="ios-label">อีเมล</label><input class="ios-input" name="email" type="email" value="${escapeHtml(c.email||'')}"></div>
      </div>
    </div>

    <div><label class="ios-label">โน้ต</label><textarea class="ios-textarea" name="notes">${escapeHtml(c.notes||'')}</textarea></div>
  `;
}


// ============== CRUD modals ==============
// Shared wiring for the "+ สร้างกลุ่มใหม่" inline button used in both task and
// meeting forms. Snapshots current form values, opens the group-create modal,
// and reopens the same modal (via reopenWith callback) with the new group selected.
function _wireCreateNewGroupButton(reopenWith, originalT) {
  const newGroupBtn = modalForm.querySelector('#task-create-new-group');
  if (!newGroupBtn) return;
  newGroupBtn.onclick = () => {
    const fd = new FormData(modalForm);
    const snapshot = {};
    fd.forEach((v, k) => { snapshot[k] = v; });
    const grid = modalForm.querySelector('.member-chip-grid');
    if (grid) {
      snapshot.assignees = Array.from(grid.querySelectorAll('.member-chip.selected'))
        .map(c => ({ id: c.dataset.memberId }));
    }
    closeModal();
    openGroupModal(undefined, async (newGroup) => {
      await loadAll();
      reopenWith({
        ...(originalT && originalT.id ? { id: originalT.id } : {}),
        ...snapshot,
        group_id: newGroup?.id || snapshot.group_id || '',
      });
    });
  };
}

function openTaskModal(t, afterSave) {
  // editing only if t has an id; presets like { group_id, deadline } are NOT editing
  const editing = !!(t && t.id);
  openModal(editing ? '✏️ แก้ไขงาน' : '📋 เพิ่มงาน', taskFormFields(t || { status:'in_progress', points:0 }), async data => {
    data.kind = 'task';                  // hardcoded — task modal always creates tasks
    data.points = +data.points || 0;
    if (!Array.isArray(data.assignee_ids)) data.assignee_ids = [];
    if (data.assignee_ids.length === 0) {
      throw new Error('ต้องเลือกผู้รับผิดชอบอย่างน้อย 1 คน');
    }
    // Target only matters when there's no group (group target wins otherwise)
    if (data.group_id) data.target = '';
    let result;
    if (editing) result = await api.put('/api/tasks/' + t.id, data);
    else         result = await api.post('/api/tasks', data);
    toast(editing ? 'บันทึกแล้ว' : 'สร้างงานแล้ว', 'success');
    await loadAll();
    if (afterSave) afterSave(result);
  });
  _wireCreateNewGroupButton(openTaskModal, t);
  _wireTaskTargetToggle();
  _wireGroupMemberFilter();
  _wireSelectAllButton('task-select-all');
  _wireAddCategoryButton();
}

// Toggle the task-target section based on whether a group is selected.
// Called by both openTaskModal and openTaskEdit.
function _wireTaskTargetToggle() {
  const sel = modalForm.querySelector('[data-task-group-select]');
  const section = modalForm.querySelector('[data-task-target-section]');
  if (!sel || !section) return;
  const sync = () => section.toggleAttribute('hidden', !!sel.value);
  sel.addEventListener('change', sync);
  sync();
}

// "เลือกทุกคน" toggle — selects/deselects all VISIBLE member chips at once.
// Respects .hidden-by-group filter so it only operates on currently shown chips.
function _wireSelectAllButton(buttonId) {
  const btn = modalForm.querySelector('#' + buttonId);
  if (!btn) return;
  btn.onclick = () => {
    const grid = modalForm.querySelector('.member-chip-grid');
    if (!grid) return;
    const visibleChips = Array.from(grid.querySelectorAll('.member-chip[data-member-id]:not(.hidden-by-group)'));
    if (!visibleChips.length) return;
    const allSelected = visibleChips.every(c => c.classList.contains('selected'));
    visibleChips.forEach(c => c.classList.toggle('selected', !allSelected));
    btn.textContent = allSelected ? 'เลือกทุกคน' : 'ล้างทั้งหมด';
    // Sync the count pill
    const pill = grid.parentElement?.querySelector('.member-count-pill');
    if (pill) {
      const count = grid.querySelectorAll('.member-chip.selected:not(.hidden-by-group)').length;
      if (count > 0) { pill.textContent = `เลือกแล้ว ${count} คน`; pill.classList.add('has'); }
      else { pill.textContent = 'เลือกอย่างน้อย 1 คน'; pill.classList.remove('has'); }
    }
  };
}

// "+ เพิ่มประเภทใหม่" — prompts for a new category name, POSTs it to the server,
// adds the new chip to the grid (auto-selected), and refreshes state.categories.
// Idempotent: if a category with that name already exists, the server returns the
// existing one — we simply select its existing chip.
function _wireAddCategoryButton() {
  const btn = modalForm.querySelector('#task-add-category');
  if (!btn) return;
  btn.onclick = async () => {
    // Pre-fill with whatever the user typed into the search box — if they
    // searched and didn't find a match, they probably want to create that one.
    const searchInp = modalForm.querySelector('#cat-search');
    const initial = searchInp?.value?.trim() || '';
    const name = await uiPrompt('ตั้งชื่อประเภทงานใหม่ — แนะนำรูปแบบ "หมวด - ชื่อ" เพื่อจัดกลุ่มอัตโนมัติ:', {
      title: '🏷️ เพิ่มประเภทงาน',
      placeholder: 'เช่น "เอกสาร - MOU", "Dev - Mobile App"',
      initial,
      okLabel: 'เพิ่ม',
    });
    if (!name) return;
    try {
      const cat = await api.post('/api/categories', { name });
      // Refresh global state so subsequent forms see the new category
      if (!state.categories.find(c => c.id === cat.id)) {
        state.categories.push(cat);
        state.categories.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      }
      // Easiest way to keep grouping/sorting consistent is to re-render the
      // whole category section in place. Preserves selection by reading the
      // current `.selected` chips first.
      const section = modalForm.querySelector('.cat-section');
      if (section) {
        const previouslySelected = Array.from(
          modalForm.querySelectorAll('.cat-section .cat-chip.selected[data-category-id]')
        ).map(c => c.dataset.categoryId);
        const fakeT = {
          categories: previouslySelected
            .concat([cat.id])
            .map(id => ({ id })),
        };
        section.outerHTML = _formCategoriesSection(fakeT);
        _updateCatCounter();
      }
      toast('เพิ่มประเภทงานแล้ว: ' + cat.name, 'success');
    } catch (err) {
      toast(err.message || 'เพิ่มประเภทงานไม่สำเร็จ', 'error');
    }
  };
}

// Filter the member chip grid to only show members of the selected group.
// When no group is selected, show all members (standalone task case).
// Used in openTaskModal + openTaskEdit (regular tasks only — meetings can include anyone).
function _wireGroupMemberFilter() {
  const sel = modalForm.querySelector('[data-task-group-select]');
  if (!sel) return;
  const grid = modalForm.querySelector('.member-chip-grid');
  if (!grid) return;

  // Per-modal cache so we don't re-fetch the same group every time
  const cache = new Map();
  async function getMemberIds(gid) {
    if (!gid) return null;
    if (cache.has(gid)) return cache.get(gid);
    try {
      const list = await api.get('/api/groups/' + gid + '/members');
      const ids = new Set(list.map(m => m.id));
      cache.set(gid, ids);
      return ids;
    } catch { return null; }
  }

  // Update the count pill text after toggling chips
  function refreshPill() {
    const pill = grid.parentElement?.querySelector('.member-count-pill');
    if (!pill) return;
    const count = grid.querySelectorAll('.member-chip.selected:not(.hidden-by-group)').length;
    if (count > 0) { pill.textContent = `เลือกแล้ว ${count} คน`; pill.classList.add('has'); }
    else { pill.textContent = 'เลือกอย่างน้อย 1 คน'; pill.classList.remove('has'); }
  }

  async function applyFilter() {
    const allowed = await getMemberIds(sel.value);
    grid.querySelectorAll('.member-chip[data-member-id]').forEach(chip => {
      const mid = chip.dataset.memberId;
      const visible = !allowed || allowed.has(mid);
      chip.classList.toggle('hidden-by-group', !visible);
      // Auto-deselect chips that are no longer visible — user can't assign someone outside the group
      if (!visible) chip.classList.remove('selected');
    });
    refreshPill();
  }

  sel.addEventListener('change', applyFilter);
  applyFilter();
}

// Separate modal for creating/editing meetings — completely independent of the
// task form. Meeting-specific fields: location section, datetime-local input.
// No status select, no points field.
function openMeetingModal(t) {
  const editing = !!(t && t.id);
  openModal(editing ? '✏️ แก้ไขการประชุม' : '📅 เพิ่มการประชุม', meetingFormFields(t || {}), async data => {
    data.kind = 'meeting';                // hardcoded — meeting modal always creates meetings
    data.status = data.status || 'on_hold';
    if (!Array.isArray(data.assignee_ids)) data.assignee_ids = [];
    if (data.assignee_ids.length === 0) {
      throw new Error('ต้องเลือกผู้เข้าร่วมอย่างน้อย 1 คน');
    }
    // Onsite-internal is fixed to "Lab @ECC-504" — auto-fill regardless of
    // detail input. For other types, scrub the sentinel so a meeting that was
    // converted FROM internal doesn't render as "💻 Online · Lab @ECC-504".
    if (data.location_type === 'onsite_internal') {
      data.location_detail = 'Lab @ECC-504';
    } else if ((data.location_detail || '').trim() === 'Lab @ECC-504') {
      data.location_detail = '';
    }
    // Validate end > start client-side so the user gets immediate feedback.
    // Empty end_time is allowed — backend / ICS fall back to start + 60 min.
    if (data.end_time) {
      if (!data.deadline) throw new Error('กรุณาระบุเวลาเริ่มประชุม');
      if (new Date(data.end_time) <= new Date(data.deadline)) {
        throw new Error('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
      }
    }
    if (editing) await api.put('/api/tasks/' + t.id, data);
    else await api.post('/api/tasks', data);
    toast(editing ? 'บันทึกแล้ว' : 'สร้างการประชุมแล้ว', 'success');
    await loadAll();
  });

  // When the user picks a new start time:
  //   • Slide the end time forward by the same delta so the duration stays
  //     constant (preserves user's intent of "2-hour meeting").
  //   • Use flatpickr's `minDate` on the END picker so any time at-or-before
  //     start is GREYED OUT — the user physically can't choose an invalid
  //     end. Belt + braces with the submit-time check above.
  const startInp = modalForm.querySelector('[data-meeting-start]');
  const endInp   = modalForm.querySelector('[data-meeting-end]');
  if (startInp && endInp) {
    const startFp = startInp._flatpickr;
    const endFp   = endInp._flatpickr;
    // Initial bound — if a meeting is being edited and already has a start,
    // lock end's minimum to it immediately.
    if (endFp && startInp.value) endFp.set('minDate', startInp.value);

    let lastStart = startInp.value;
    startInp.addEventListener('change', () => {
      const newStart = startInp.value;
      if (!newStart) { lastStart = ''; if (endFp) endFp.set('minDate', null); return; }
      // Lock end picker to "must be after start"
      if (endFp) endFp.set('minDate', newStart);
      const oldStart = lastStart;
      lastStart = newStart;
      const pad = (n) => String(n).padStart(2,'0');
      const toIsoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      if (!endInp.value) {
        // No end set — auto-fill with +60min
        const s = new Date(newStart); s.setMinutes(s.getMinutes() + 60);
        const v = toIsoLocal(s);
        if (endFp) endFp.setDate(v, false); else endInp.value = v;
        return;
      }
      // If end has somehow become at-or-before the new start, bump it to
      // start + 60min so the form is always valid.
      if (new Date(endInp.value) <= new Date(newStart)) {
        const s = new Date(newStart); s.setMinutes(s.getMinutes() + 60);
        const v = toIsoLocal(s);
        if (endFp) endFp.setDate(v, false); else endInp.value = v;
        return;
      }
      // Else: shift end by the same delta to preserve duration.
      if (oldStart && new Date(endInp.value) > new Date(oldStart)) {
        const delta = new Date(newStart) - new Date(oldStart);
        const newEnd = new Date(new Date(endInp.value).getTime() + delta);
        const v = toIsoLocal(newEnd);
        if (endFp) endFp.setDate(v, false); else endInp.value = v;
      }
    });
  }
  _wireCreateNewGroupButton(openMeetingModal, t);

  // Initialize selected state for the location radios + match label/visibility to current pick
  modalForm.querySelectorAll('.location-option').forEach(o => {
    const inp = o.querySelector('input[name="location_type"]');
    o.classList.toggle('selected', !!(inp && inp.checked));
  });

  // Location radio change handler — show/hide + relabel the detail field per type:
  //   online           → 🔗 Meet / Zoom Link (optional)
  //   onsite_internal  → fixed "Lab @ECC-504" (no detail input)
  //   onsite_external  → 📍 Google Map link or address
  function syncLocationDetail() {
    const checked = modalForm.querySelector('input[name="location_type"]:checked');
    const v = checked?.value || '';
    const wrap  = modalForm.querySelector('[data-location-detail-wrap]');
    const label = modalForm.querySelector('[data-location-detail-label]');
    const input = modalForm.querySelector('[data-location-detail-input]');
    const hint  = modalForm.querySelector('[data-location-detail-hint]');
    if (!wrap || !label || !input || !hint) return;
    if (v === 'onsite_internal') {
      wrap.setAttribute('hidden', '');
      input.value = 'Lab @ECC-504';
    } else if (v === 'online') {
      wrap.removeAttribute('hidden');
      label.textContent = '🔗 Meet / Zoom Link (ไม่บังคับ)';
      input.placeholder = 'เช่น https://meet.google.com/abc-defg-hij';
      hint.textContent  = 'แปะลิงค์ Meet / Zoom เพื่อให้ผู้เข้าร่วมเข้าได้ง่าย — เว้นว่างได้';
      // Clear "Lab @ECC-504" leftover if user switched away
      if (input.value === 'Lab @ECC-504') input.value = '';
    } else if (v === 'onsite_external') {
      wrap.removeAttribute('hidden');
      label.textContent = '📍 Google Map Link หรือที่อยู่';
      input.placeholder = 'วาง Google Map URL หรือพิมพ์ที่อยู่ (ค้นใน Google Map ได้)';
      hint.textContent  = 'ผู้เข้าร่วมสามารถคลิกเปิดใน Google Map ได้';
      if (input.value === 'Lab @ECC-504') input.value = '';
    }
  }
  syncLocationDetail();  // initial sync based on current value
  modalForm.querySelectorAll('input[name="location_type"]').forEach(r => {
    r.addEventListener('change', syncLocationDetail);
  });

  // "เลือกทุกคน" button — toggles between selecting all members and clearing all
  const selectAllBtn = modalForm.querySelector('#meeting-select-all');
  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      const chips = modalForm.querySelectorAll('.member-chip[data-member-id]');
      const allSelected = Array.from(chips).every(c => c.classList.contains('selected'));
      chips.forEach(c => c.classList.toggle('selected', !allSelected));
      // Update the count pill
      const grid = modalForm.querySelector('.member-chip-grid');
      const pill = grid?.parentElement?.querySelector('.member-count-pill');
      if (pill) {
        const count = grid.querySelectorAll('.member-chip.selected').length;
        if (count > 0) { pill.textContent = `เลือกแล้ว ${count} คน`; pill.classList.add('has'); }
        else { pill.textContent = 'เลือกอย่างน้อย 1 คน'; pill.classList.remove('has'); }
      }
      selectAllBtn.textContent = allSelected ? 'เลือกทุกคน' : 'ล้างทั้งหมด';
    };
  }
  _wireAddCategoryButton();
}

function openMemberModal(m) {
  const editing = !!m && !!m.id;
  openModal(editing ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก', memberFormFields(m || { role:'member' }), async data => {
    if (editing) await api.put('/api/members/' + m.id, data);
    else await api.post('/api/members', data);
    toast(editing ? 'บันทึกแล้ว' : 'เพิ่มสมาชิกแล้ว', 'success');
    await loadAll();
  });
}
function openGroupModal(g, afterSave) {
  // editing only if g has an id; presets like { deadline } are NOT editing
  const editing = !!(g && g.id);
  openModal(editing ? 'แก้ไขโครงการ' : 'เพิ่มโครงการ', groupFormFields(g || { status:'in_progress' }), async data => {
    // For new groups, the chip grid produces `assignee_ids` via the global form handler
    // — repurpose it as `member_ids` for the group payload.
    if (!editing) {
      data.member_ids = Array.isArray(data.assignee_ids) ? data.assignee_ids : [];
    }
    delete data.assignee_ids;  // not relevant to group payload
    // Connection ids — hidden input ส่งเป็น comma-separated string → แปลงเป็น array
    if (typeof data.connection_ids === 'string') {
      data.connection_ids = data.connection_ids.split(',').map(s => s.trim()).filter(Boolean);
    } else if (!Array.isArray(data.connection_ids)) {
      data.connection_ids = [];
    }

    let result;
    if (editing) result = await api.put('/api/groups/' + g.id, data);
    else result = await api.post('/api/groups', data);
    toast(editing ? 'บันทึกแล้ว' : 'สร้างโครงการแล้ว', 'success');
    await loadAll();
    if (afterSave) afterSave(result);
  });
  // Wire color picker — sync native picker, hex input, preset swatches, hidden input
  // 3-way sync: any source updates the other 2 + ตรวจสีซ้ำกับ group อื่นแล้ว warn
  const picker = modalForm.querySelector('[data-group-color-picker]');
  const nativePick = modalForm.querySelector('#group-color-native');
  const hexInput   = modalForm.querySelector('#group-color-hex');
  const hidden     = modalForm.querySelector('input[name="color"]');
  const warnEl     = modalForm.querySelector('#group-color-warn');
  const editingIdForColor = (g && g.id) || null;
  const usedByOthersSet = new Set(state.groups.filter(x => x.id !== editingIdForColor && x.color).map(x => x.color.toLowerCase()));

  function setColor(value, src) {
    if (!value) return;
    const v = String(value).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(v)) return;
    if (hidden) hidden.value = v;
    if (nativePick && src !== 'native') nativePick.value = v;
    if (hexInput && src !== 'hex')      hexInput.value   = v;
    // Update preset swatch selection (exact match only)
    if (picker) {
      picker.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('selected', (s.dataset.color || '').toLowerCase() === v);
      });
    }
    // Warn if used by another group (allowed but flagged)
    if (warnEl) warnEl.classList.toggle('hidden', !usedByOthersSet.has(v));
  }
  if (picker) {
    const tiers = ['light', 'medium', 'bold'];
    const goToTier = (newIdx) => {
      picker.querySelectorAll('.color-tier').forEach(t => {
        t.hidden = (t.dataset.tier !== tiers[newIdx]);
      });
      picker.querySelectorAll('[data-tier-dot]').forEach(d => {
        d.classList.toggle('active', +d.dataset.tierDot === newIdx);
      });
    };
    picker.addEventListener('click', e => {
      const sw = e.target.closest('.color-swatch');
      if (sw) { setColor(sw.dataset.color, 'preset'); return; }
      // คลิก dot ไปตรง index นั้น
      const dot = e.target.closest('[data-tier-dot]');
      if (dot) { goToTier(+dot.dataset.tierDot); return; }
      // ปุ่ม ‹ › navigate tier (wrap-around)
      const arrow = e.target.closest('[data-tier-arrow]');
      if (!arrow) return;
      const visible = picker.querySelector('.color-tier:not([hidden])');
      const curIdx = visible ? tiers.indexOf(visible.dataset.tier) : 1;
      const dir = arrow.dataset.tierArrow === 'next' ? 1 : -1;
      goToTier((curIdx + dir + tiers.length) % tiers.length);
    });
  }
  if (nativePick) {
    nativePick.addEventListener('input', e => setColor(e.target.value, 'native'));
  }
  if (hexInput) {
    hexInput.addEventListener('input', e => {
      let v = e.target.value.trim();
      // Auto-prepend # if missing
      if (v && !v.startsWith('#')) { v = '#' + v; e.target.value = v; }
      setColor(v, 'hex');
    });
  }
  // Initial sync — set warn visibility for the starting color
  if (hidden) setColor(hidden.value, 'init');
  // "เลือกทุกคน" — toggle all member chips at once (only present in create mode)
  const selectAllBtn = modalForm.querySelector('#group-select-all');
  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      const grid = modalForm.querySelector('.member-chip-grid');
      const chips = modalForm.querySelectorAll('.member-chip[data-member-id]');
      const allSelected = Array.from(chips).every(c => c.classList.contains('selected'));
      if (allSelected) {
        // ล้างทั้งหมด — เคลียร์ทั้ง selection และลำดับการเลือก (รีเซ็ตหัวหน้าให้สะอาด)
        chips.forEach(c => { c.classList.remove('selected'); delete c.dataset.selectOrder; });
        if (grid) grid.dataset.chipCounter = '0';
      } else {
        // เลือกทุกคน — คงลำดับเดิมไว้ (หัวหน้าที่เลือกอยู่แล้ว = order 1 ยังเป็นคนแรก)
        // แล้วไล่ลำดับต่อให้เฉพาะ chip ที่เพิ่งถูกเลือก จึงไม่แย่งตำแหน่งหัวหน้า
        let counter = +(grid?.dataset.chipCounter || '0');
        chips.forEach(c => {
          if (!c.classList.contains('selected')) {
            c.classList.add('selected');
            c.dataset.selectOrder = String(++counter);
          }
        });
        if (grid) grid.dataset.chipCounter = String(counter);
      }
      selectAllBtn.textContent = allSelected ? 'เลือกทุกคน' : 'ล้างทั้งหมด';
      _updateGroupLeaderCrown();
    };
  }

  // Crown indicator — visually mark the first-selected chip as leader-to-be.
  // Updated on every chip click + initial render.
  modalForm.addEventListener('click', e => {
    if (e.target.closest('.member-chip[data-member-id]')) {
      // Run AFTER the global click handler (microtask delay)
      Promise.resolve().then(_updateGroupLeaderCrown);
    }
  });
  _updateGroupLeaderCrown();
}

// Find the first-selected chip (lowest data-select-order) in the group form's chip grid
// and mark it with .is-leader so a crown icon shows up in the corner.
function _updateGroupLeaderCrown() {
  const grid = modalForm.querySelector('.member-chip-grid');
  if (!grid) return;
  // Clear existing leader marker
  grid.querySelectorAll('.member-chip.is-leader').forEach(c => c.classList.remove('is-leader'));
  const selected = Array.from(grid.querySelectorAll('.member-chip.selected'));
  if (!selected.length) return;
  selected.sort((a, b) => {
    const ao = +a.dataset.selectOrder || Infinity;
    const bo = +b.dataset.selectOrder || Infinity;
    return ao - bo;
  });
  selected[0].classList.add('is-leader');
}
function openConnectionModal(c) {
  const editing = !!c;
  openModal(editing ? 'แก้ไข Connection' : 'เพิ่ม Connection', connectionFormFields(c || {}), async data => {
    // member_id tracks the creator for permission. For 'agency' + 'lobbyist'
    // (no per-member ownership in form), creator is current user on insert.
    const orgKind = data.kind === 'agency' || data.kind === 'lobbyist';
    if (orgKind) {
      data.member_id = editing ? (c.member_id || state.user.id) : state.user.id;
    } else if (!isAdmin()) {
      data.member_id = state.user.id;
    }
    if (editing) await api.put('/api/connections/' + c.id, data);
    else await api.post('/api/connections', data);
    toast('บันทึกแล้ว', 'success');
    await loadAll();
  });

  // Wire the kind radio — โชว์/ซ่อน rows + relabel ตาม kind ที่เลือก
  // 'personal' → member dropdown + personal org
  // 'agency'   → liaison (ผู้ประสานงาน) + agency org (หน่วยงาน)
  // 'lobbyist' → liaison เท่านั้น (เก็บแค่ข้อมูลคน ไม่ผูก agency)
  const form = document.getElementById('modal-form');
  const apply = () => {
    const checked = form.querySelector('input[name="kind"]:checked')?.value || 'personal';
    const isAgency = checked === 'agency';
    const isLobbyist = checked === 'lobbyist';
    const isPersonal = checked === 'personal';
    const orgKind = isAgency || isLobbyist;
    form.querySelectorAll('.kind-option').forEach(opt => {
      const v = opt.querySelector('input[name="kind"]')?.value;
      opt.classList.toggle('selected', v === checked);
    });
    const memberRow     = form.querySelector('.conn-member-row');
    const liaisonRow    = form.querySelector('.conn-liaison-row');
    const agencyOrgRow  = form.querySelector('.conn-agency-org-row');
    const personalOrgRow = form.querySelector('.conn-personal-org-row');
    if (memberRow)      memberRow.style.display      = isPersonal ? '' : 'none';
    if (liaisonRow)     liaisonRow.style.display     = orgKind ? '' : 'none';
    if (agencyOrgRow)   agencyOrgRow.style.display   = isAgency ? '' : 'none';
    if (personalOrgRow) personalOrgRow.style.display = isPersonal ? '' : 'none';
    // Relabel liaison section header + label ตาม kind
    const liaisonHeader = form.querySelector('.conn-liaison-header');
    const liaisonLabel = form.querySelector('.conn-liaison-label');
    if (liaisonHeader) liaisonHeader.textContent = isLobbyist ? '🎯 Lobbyist' : '👤 ผู้ประสานงาน';
    if (liaisonLabel)  liaisonLabel.textContent  = isLobbyist ? 'ชื่อ lobbyist *' : 'ชื่อผู้ประสานงาน *';
    // Disable inputs ใน rows ที่ซ่อน → FormData จะไม่รวมค่าว่าง override กัน
    //   (Bug ก่อน: 2 row มี name="company" ทับกัน — row ที่ซ่อน submit ค่าว่างทับ → 400)
    const disableInRow = (row, dis) => {
      if (!row) return;
      row.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = dis; });
    };
    disableInRow(memberRow,     !isPersonal);
    disableInRow(liaisonRow,    !orgKind);
    disableInRow(agencyOrgRow,  !isAgency);
    disableInRow(personalOrgRow, !isPersonal);
    // required เฉพาะตัวที่ visible
    const personalCompany = personalOrgRow?.querySelector('input[name="company"]');
    const agencyCompany   = agencyOrgRow?.querySelector('input[name="company"]');
    if (personalCompany) personalCompany.required = isPersonal;
    if (agencyCompany)   agencyCompany.required   = isAgency;
    const liaisonInput = liaisonRow?.querySelector('input[name="liaison_name"]');
    if (liaisonInput) liaisonInput.required = orgKind;
  };
  form.querySelectorAll('.kind-option').forEach(opt => opt.addEventListener('click', () => {
    const radio = opt.querySelector('input[name="kind"]');
    if (radio) { radio.checked = true; apply(); }
  }));
  apply();   // run once to sync visibility on initial open
}
function openAddAssigneeModal(t) {
  // Unified: admin and group leader use the same direct-assign flow.
  return openAssignTaskModal(t);
}

// Assign task to a group member — direct, no acceptance (admin or group leader only)
async function openAssignTaskModal(t) {
  let memberPool;
  if (t.group_id && !isAdmin()) {
    memberPool = await api.get('/api/groups/' + t.group_id + '/members').catch(() => []);
  } else {
    memberPool = state.members;
  }
  const exists = new Set(t.assignees.map(a => a.id));
  const candidates = memberPool.filter(m => !exists.has(m.id));
  if (!candidates.length) {
    toast('ไม่มีสมาชิกในกลุ่มที่ยังไม่ได้รับมอบหมาย — ชวนสมาชิกเข้ากลุ่มก่อน', 'error');
    return;
  }
  const opts = candidates.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  openModal(`มอบหมายงาน "${t.title}"`, `
    <div><label class="ios-label">เลือกสมาชิก ${t.group_id && !isAdmin() ? '(เฉพาะสมาชิกในกลุ่ม)' : ''}</label>
      <select class="ios-select" name="member_id" required>${opts}</select>
    </div>
    <div class="text-[11px] text-slate-500">การมอบหมายมีผลทันที (ไม่ต้องตอบรับ)</div>
  `, async data => {
    await api.post(`/api/tasks/${t.id}/assignees`, data);
    toast('มอบหมายแล้ว ✓', 'success');
    await loadAll();
    if (state.openTaskId) openTaskSheet(state.openTaskId);
  });
}

// Group-level invite — admin/group leader invites a member into the group
async function openInviteToGroupModal(g) {
  let groupMembers = [];
  try { groupMembers = await api.get('/api/groups/' + g.id + '/members'); } catch {}
  const inGroup = new Set(groupMembers.map(m => m.id));
  const candidates = state.members.filter(m => !inGroup.has(m.id));
  if (!candidates.length) { toast('ทุกคนอยู่ในกลุ่มนี้แล้ว 🎉', ''); return; }

  // Profile chips — multi-select. Adds members directly (no invitation flow).
  const chipsHtml = candidates.map(m => {
    const avatarInner = m.avatar_url
      ? `<img class="member-chip-avatar member-chip-avatar-img" src="${escapeHtml(m.avatar_url)}" alt="">`
      : `<span class="member-chip-avatar">${escapeHtml(initials(m.name))}</span>`;
    return `
      <button type="button" class="member-chip" data-member-id="${m.id}" style="--m-color:${m.color}">
        ${avatarInner}
        <span class="member-chip-name">${escapeHtml(m.name)}</span>
      </button>`;
  }).join('');

  openModal(`+ เพิ่มสมาชิกเข้ากลุ่ม "${g.name}"`, `
    <div>
      <div class="flex items-center justify-between gap-2 flex-wrap mb-1">
        <label class="ios-label" style="margin:0">เลือกสมาชิกที่จะเพิ่ม (เลือกได้หลายคน)</label>
        <button type="button" class="ios-btn-ghost text-xs" id="add-group-select-all">เลือกทุกคน</button>
      </div>
      <div class="member-chip-grid">${chipsHtml}</div>
      <div class="text-[11px] text-slate-500 mt-2">เพิ่มได้เลยโดยไม่ต้องรอเพื่อนกดยอมรับ</div>
    </div>
  `, async data => {
    // The global form handler put selected ids into data.assignee_ids — repurpose.
    const ids = Array.isArray(data.assignee_ids) ? data.assignee_ids : [];
    if (!ids.length) throw new Error('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
    let added = 0;
    for (const mid of ids) {
      try {
        // POST to /assignees-style endpoint? No — there's no direct add-member endpoint.
        // The simplest approach: use the existing invitation system but auto-accept by admin.
        // Actually we just need a direct add — let me hit a server endpoint that does that.
        await api.post(`/api/groups/${g.id}/add-member`, { member_id: mid });
        added++;
      } catch (err) {
        console.warn('add member failed:', mid, err.message);
      }
    }
    toast(`เพิ่มสมาชิกแล้ว ${added} คน ✓`, 'success');
    await loadAll();
    renderSummary();
  }, 'เพิ่มสมาชิก');

  // "เลือกทุกคน" toggle
  const selectAllBtn = modalForm.querySelector('#add-group-select-all');
  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      const chips = modalForm.querySelectorAll('.member-chip[data-member-id]');
      const allSelected = Array.from(chips).every(c => c.classList.contains('selected'));
      chips.forEach(c => c.classList.toggle('selected', !allSelected));
      selectAllBtn.textContent = allSelected ? 'เลือกทุกคน' : 'ล้างทั้งหมด';
    };
  }
}

// Group-level propose — member proposes themselves to join a group
function openProposeGroupModal(g) {
  openModal(`เสนอตัวเข้ากลุ่ม "${g.name}"`, `
    <div><label class="ios-label">ข้อความถึงหัวหน้ากลุ่ม (ไม่บังคับ)</label><textarea class="ios-textarea" name="message" placeholder="เช่น อยากช่วยทำในโครงการนี้ครับ"></textarea></div>
    <div class="text-[11px] text-slate-500">หัวหน้ากลุ่ม ${escapeHtml(g.leader_name||'')} จะเป็นผู้พิจารณาตอบรับ</div>
  `, async data => {
    await api.post(`/api/groups/${g.id}/propose`, data);
    toast('ส่งคำขอเข้ากลุ่มแล้ว — รอหัวหน้ากลุ่มพิจารณา', 'success');
    await loadAll();
    renderSummary();
  });
}
// Phase-aware Points workflow modal.
//   proposing     → assignee can edit ONLY their own row (one input + Save)
//   leader_review → group leader edits all + "อนุมัติ" → moves to final_review
//   final_review  → leader/admin edits all + "ยืนยัน Point" → moves to confirmed
//   confirmed     → all read-only + "เปิดแก้ไขอีกครั้ง" for leader/admin
// After a task transitions to "completed" (via submit or drag), prompt the
// current user to enter THEIR OWN points if they're an assignee and haven't
// proposed yet. Silent no-op if not applicable. Modal layers on top of any
// open sheet/submission sheet.
async function promptOwnPointsIfNeeded(taskId) {
  let t;
  try { t = await api.get('/api/tasks/' + taskId); } catch { return; }
  if (!t || t.status !== 'completed' || t.points_phase !== 'proposing') return;
  const myRow = (t.assignees || []).find(a => a.id === state.user.id);
  if (!myRow) return;          // not an assignee — skip
  if (myRow.proposed_at) return; // already set their points

  openModal('⭐ กำหนด Point ของคุณ', `
    <div class="bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm text-sky-900">
      งาน "<b>${escapeHtml(t.title)}</b>" เสร็จแล้ว — กรุณาใส่ Point ที่เหมาะสมกับงานของคุณ
    </div>
    <div>
      <label class="ios-label">Point ของฉัน *</label>
      <input type="number" name="my_points" min="0" value="0" class="ios-input" autofocus required>
    </div>
    <div class="text-[11px] text-slate-500 leading-snug">
      เมื่อทุกคนกำหนด Point แล้ว → หัวหน้ากลุ่มจะตรวจสอบ และที่ประชุมประจำสัปดาห์จะยืนยันคะแนนสุดท้าย
    </div>
  `, async data => {
    const pts = Math.max(0, +data.my_points || 0);
    await api.post(`/api/tasks/${taskId}/points/propose-own`, { points_share: pts });
    toast('บันทึก Point ของคุณแล้ว ✓', 'success');
    await loadAll();
  });
}

function openAllocateModal(t) {
  if (t.status !== 'completed') {
    toast('แบ่ง Points ได้เฉพาะงานที่ทำเสร็จแล้ว — เปลี่ยนสถานะเป็น "เสร็จแล้ว" ก่อน', 'error');
    return;
  }
  if (!t.assignees.length) {
    toast('งานนี้ยังไม่มีสมาชิก', 'error');
    return;
  }
  const phase = t.points_phase || 'proposing';
  const me = state.user.id;
  const isAdminUser    = isAdmin();
  const isGroupLeader  = t.group_id && isMyGroupLeader(t.group_id);
  const isAssignee     = t.assignees.some(a => a.id === me);

  // Per-phase permission to EDIT a specific row
  const canEditRow = (assigneeId) => {
    if (phase === 'proposing')      return assigneeId === me && isAssignee;
    if (phase === 'leader_review')  return isAdminUser || isGroupLeader;
    if (phase === 'final_review')   return isAdminUser || isGroupLeader;
    return false; // confirmed / none
  };

  // Per-phase action button (bottom)
  let actionLabel = '', actionClass = '', actionFn = null, showAction = false;
  if (phase === 'proposing' && isAssignee) {
    actionLabel = '💾 บันทึก Point ของฉัน'; actionClass = 'ios-btn-primary';
    actionFn = async () => {
      const myRow = t.assignees.find(a => a.id === me);
      const inp = document.querySelector(`input[name="alloc_${myRow.id}"]`);
      const pts = Math.max(0, +inp.value || 0);
      await api.post(`/api/tasks/${t.id}/points/propose-own`, { points_share: pts });
      toast('บันทึกแล้ว ✓ — รอผู้รับผิดชอบคนอื่นกำหนด Point ของตน', 'success');
      await loadAll(); closeModal(); openTaskSheet(t.id);
    };
    showAction = true;
  } else if (phase === 'leader_review' && (isAdminUser || isGroupLeader)) {
    actionLabel = '✅ อนุมัติ — ส่งเข้าที่ประชุม'; actionClass = 'ios-btn-primary';
    actionFn = async () => {
      // Save edits, then approve
      const allocations = {};
      for (const a of t.assignees) {
        const inp = document.querySelector(`input[name="alloc_${a.id}"]`);
        if (inp) allocations[a.id] = Math.max(0, +inp.value || 0);
      }
      await api.put(`/api/tasks/${t.id}/points-allocation`, { allocations });
      await api.post(`/api/tasks/${t.id}/points/leader-approve`);
      toast('อนุมัติแล้ว ✓ — ส่งเข้าที่ประชุมประจำสัปดาห์', 'success');
      await loadAll(); closeModal(); openTaskSheet(t.id);
    };
    showAction = true;
  } else if (phase === 'final_review' && (isAdminUser || isGroupLeader)) {
    actionLabel = '🔒 ยืนยัน Point และแจกให้สมาชิก'; actionClass = 'ios-btn-primary';
    actionFn = async () => {
      const allocations = {};
      for (const a of t.assignees) {
        const inp = document.querySelector(`input[name="alloc_${a.id}"]`);
        if (inp) allocations[a.id] = Math.max(0, +inp.value || 0);
      }
      await api.put(`/api/tasks/${t.id}/points-allocation`, { allocations });
      await api.post(`/api/tasks/${t.id}/points/confirm`);
      toast('ยืนยัน Point แล้ว ✓ — แจก Point ให้สมาชิกแล้ว', 'success');
      await loadAll(); closeModal(); openTaskSheet(t.id);
    };
    showAction = true;
  } else if (phase === 'confirmed' && (isAdminUser || isGroupLeader)) {
    actionLabel = '🔓 เปิดแก้ไขอีกครั้ง'; actionClass = 'ios-btn-secondary';
    actionFn = async () => {
      if (!(await uiConfirm('เปิดงานนี้กลับเข้า "ที่ประชุมพิจารณา" เพื่อแก้ไข Point?'))) return;
      await api.post(`/api/tasks/${t.id}/points/reopen`);
      toast('เปิดแก้ไขอีกครั้งแล้ว — กลับเข้าที่ประชุมพิจารณา', 'success');
      await loadAll(); closeModal(); openTaskSheet(t.id);
    };
    showAction = true;
  }

  // Phase intro banner
  const banners = {
    proposing: {
      cls: 'bg-sky-50 border-sky-200 text-sky-900',
      title: '🟦 ขั้นที่ 1 — ผู้รับผิดชอบกำหนด Point ของตนเอง',
      body: 'แต่ละคนกำหนดได้แค่ Point ของตนเองเท่านั้น เมื่อทุกคนกำหนดครบ → ส่งให้หัวหน้ากลุ่มตรวจสอบโดยอัตโนมัติ',
    },
    leader_review: {
      cls: 'bg-amber-50 border-amber-200 text-amber-900',
      title: '🟨 ขั้นที่ 2 — หัวหน้ากลุ่มตรวจสอบ',
      body: 'หัวหน้ากลุ่มสามารถปรับแก้ Point หากเห็นว่าไม่เหมาะสม จากนั้นกด "อนุมัติ" เพื่อส่งเข้าที่ประชุมประจำสัปดาห์',
    },
    final_review: {
      cls: 'bg-purple-50 border-purple-200 text-purple-900',
      title: '🟪 ขั้นที่ 3 — ที่ประชุมประจำสัปดาห์',
      body: 'หัวหน้ากลุ่ม + Admin ช่วยกันพิจารณาความเหมาะสม ปรับแก้ได้ และกด "ยืนยัน Point" เพื่อแจก Point ให้สมาชิก',
    },
    confirmed: {
      cls: 'bg-emerald-50 border-emerald-200 text-emerald-900',
      title: '✅ ยืนยัน Point เรียบร้อย',
      body: 'Point นี้ถูกแจกเข้า Scoreboard ของสมาชิกแล้ว — สามารถ "เปิดแก้ไขอีกครั้ง" หากต้องการปรับในที่ประชุมถัดไป',
    },
  };
  const banner = banners[phase] || banners.proposing;

  const totalNow = t.assignees.reduce((s, a) => s + (a.points_share || 0), 0);
  const proposedCount = t.assignees.filter(a => a.proposed_at).length;

  const rows = t.assignees.map(a => {
    const editable = canEditRow(a.id);
    const isMine   = a.id === me;
    const proposed = !!a.proposed_at;
    const value    = a.points_share || 0;
    const status   = phase === 'proposing'
      ? (proposed ? '<span class="text-[10px] text-emerald-600 font-semibold">✓ กำหนดแล้ว</span>'
                  : '<span class="text-[10px] text-slate-400">รอกำหนด…</span>')
      : '';
    return `
      <div class="flex items-center gap-3 p-2.5 ${isMine ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-slate-50'} rounded-xl">
        ${avatarHtml(a, 32)}
        <div class="flex-1 min-w-0 truncate">
          <div class="text-sm truncate font-medium">${escapeHtml(a.name)}${isMine ? ' <span class="text-[10px] text-indigo-600">(คุณ)</span>' : ''}</div>
          <div class="text-[10px] text-slate-500 flex items-center gap-1.5">${escapeHtml(a.role==='boss'?'Boss':(a.role==='admin'?'Admin':'Member'))} ${status}</div>
        </div>
        ${editable
          ? `<input type="number" min="0" name="alloc_${a.id}" value="${value}" class="ios-input alloc-input" style="width:84px">`
          : `<div class="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-sm font-semibold text-slate-700 min-w-[84px] text-center">${value} pts</div>`
        }
      </div>`;
  }).join('');

  // Show "ขอเพิ่ม Points" only in confirmed phase (post-confirm appeal channel)
  const myPendingPR = state.pointRequests.find(r => r.task_id === t.id && r.status === 'pending');
  const requestSection = (phase !== 'confirmed') ? '' : (myPendingPR
    ? `<div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
         ⏳ มีคำขอเพิ่ม Points: <b>${myPendingPR.current_points} → ${myPendingPR.requested_points} pts</b> (รอ Admin อนุมัติ)
         ${myPendingPR.reason ? `<div class="text-xs italic mt-1">"${escapeHtml(myPendingPR.reason)}"</div>` : ''}
       </div>`
    : `<details class="bg-amber-50 border border-amber-200 rounded-xl">
         <summary class="cursor-pointer px-3 py-2 text-sm text-amber-900 font-medium select-none">💎 ขอเพิ่ม Points (Admin Approve)</summary>
         <div class="p-3 pt-0 space-y-2">
           <div class="text-[11px] text-amber-800">Points ปัจจุบัน <b>${t.points}</b> pts — ใส่จำนวนใหม่ที่ต้องการ (ต้องมากกว่าเดิม)</div>
           <input type="number" id="req-points-new" min="${t.points + 1}" placeholder="Points ใหม่ (เช่น ${t.points + 5})" class="ios-input">
           <textarea id="req-points-reason" placeholder="เหตุผล (ไม่บังคับ)" class="ios-textarea" rows="2"></textarea>
           <button type="button" id="req-points-submit" class="ios-btn-secondary w-full">ส่งคำขอ — รอ Admin อนุมัติ</button>
         </div>
       </details>`);

  // Modal — open in "no submit on Enter" mode by giving an empty submit handler.
  // We bind the actual action button manually below.
  openModal('⭐ จัดการ Points — ' + t.title, `
     <div class="${banner.cls} border rounded-xl p-3 text-sm">
       <div class="font-semibold mb-1">${banner.title}</div>
       <div class="text-[12px] leading-snug">${banner.body}</div>
       ${phase === 'proposing' ? `<div class="text-[11px] mt-1.5 text-slate-600">ความคืบหน้า: <b>${proposedCount}/${t.assignees.length}</b> คนกำหนดแล้ว</div>` : ''}
     </div>
     <div class="space-y-1.5">${rows}</div>
     <div class="flex items-center justify-between text-xs px-1 pt-1">
       <span class="text-slate-500">รวมทั้งหมด</span>
       <span id="alloc-total" class="font-bold text-slate-800">${totalNow} pts</span>
     </div>
     ${requestSection}
     ${showAction ? `<button type="button" id="phase-action-btn" class="${actionClass} w-full">${actionLabel}</button>` : ''}
   `, async () => { /* default form submit is no-op; we use phase action button instead */ });

  // Live total
  const recalc = () => {
    const total = Array.from(modalForm.querySelectorAll('.alloc-input'))
      .reduce((s, el) => s + (+el.value || 0), 0);
    // include read-only rows in displayed total
    const readonlyTotal = t.assignees.reduce((s, a) => {
      if (canEditRow(a.id)) return s; // editable handled above
      return s + (a.points_share || 0);
    }, 0);
    const totalEl = document.getElementById('alloc-total');
    if (totalEl) totalEl.textContent = (total + readonlyTotal) + ' pts';
  };
  modalForm.querySelectorAll('.alloc-input').forEach(el => el.addEventListener('input', recalc));
  recalc();

  // Phase action button
  if (showAction && actionFn) {
    document.getElementById('phase-action-btn').onclick = async () => {
      try { await actionFn(); }
      catch (err) { toast(err.message, 'error'); }
    };
  }

  // Optional points request (confirmed phase only)
  const reqBtn = document.getElementById('req-points-submit');
  if (reqBtn) {
    reqBtn.onclick = async () => {
      const newVal = +document.getElementById('req-points-new').value;
      const reason = document.getElementById('req-points-reason').value.trim();
      if (!Number.isFinite(newVal) || newVal <= t.points) {
        toast(`ใส่ Points ใหม่ที่มากกว่า ${t.points}`, 'error');
        return;
      }
      try {
        await api.post('/api/tasks/' + t.id + '/points-request', { requested_points: newVal, reason });
        toast('ส่งคำขอแล้ว — รอ Admin อนุมัติ', 'success');
        await loadAll();
        closeModal();
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}
function openRequestExtensionModal(t) {
  openModal('ขอเลื่อน Deadline', `
    <div class="text-xs text-slate-600">Deadline ปัจจุบัน: <b>${fmtDate(t.deadline)}</b></div>
    <div><label class="ios-label">Deadline ใหม่ที่ต้องการ *</label><input type="date" name="requested_deadline" class="ios-input" required value="${t.deadline ? t.deadline.slice(0,10) : ''}"></div>
    <div><label class="ios-label">เหตุผล</label><textarea class="ios-textarea" name="reason" placeholder="เช่น รอข้อมูลจากภาคสนาม"></textarea></div>
    <div class="text-[11px] text-slate-500">Admin จะเป็นผู้พิจารณาอนุมัติ</div>
  `, async data => {
    await api.post(`/api/tasks/${t.id}/deadline-request`, data);
    toast('ส่งคำขอแล้ว — รอ Admin อนุมัติ', 'success');
    await loadAll();
  });
}

// ============== People ==============
// Connections search — filters BOTH Personal and Agency sections by liaison name,
// org/company, contact name+role, phone, email, topics, notes, and member name.
document.getElementById('conn-search').addEventListener('input', debounce(e => {
  state.connQuery = e.target.value.trim();
  document.getElementById('conn-search-clear').classList.toggle('hidden', !state.connQuery);
  renderPeople();
}, 200));
document.getElementById('conn-search-clear').addEventListener('click', () => {
  document.getElementById('conn-search').value = '';
  state.connQuery = '';
  document.getElementById('conn-search-clear').classList.add('hidden');
  renderPeople();
});

document.querySelectorAll('#people-segmented button').forEach(b => {
  b.addEventListener('click', () => {
    state.peopleSeg = b.dataset.pseg;
    document.querySelectorAll('#people-segmented button').forEach(x => x.classList.toggle('active', x === b));
    document.getElementById('people-members').classList.toggle('hidden', state.peopleSeg !== 'members');
    document.getElementById('people-connections').classList.toggle('hidden', state.peopleSeg !== 'connections');
    setTab('people'); // refresh add button
  });
});

// ── People > Members: search + sort + filter (combine อิสระ) ──
document.getElementById('people-members-search')?.addEventListener('input', debounce(e => {
  state.peopleMembersQuery = e.target.value.trim();
  document.getElementById('people-members-search-clear').classList.toggle('hidden', !state.peopleMembersQuery);
  renderPeople();
}, 150));
document.getElementById('people-members-search-clear')?.addEventListener('click', () => {
  state.peopleMembersQuery = '';
  document.getElementById('people-members-search').value = '';
  document.getElementById('people-members-search-clear').classList.add('hidden');
  renderPeople();
});
document.getElementById('people-members-sort')?.addEventListener('change', e => {
  state.peopleMembersSort = e.target.value;
  renderPeople();
});
document.getElementById('people-members-filter')?.addEventListener('change', e => {
  state.peopleMembersFilter = e.target.value;
  renderPeople();
});

// ── People > Connections: sort + filter (search already wired) ──
document.getElementById('conn-sort')?.addEventListener('change', e => {
  state.connSort = e.target.value;
  renderPeople();
});
document.getElementById('conn-filter')?.addEventListener('change', e => {
  state.connFilter = e.target.value;
  renderPeople();
});

function renderPeople() {
  // Members — apply search + sort + filter (combination อิสระ)
  const ml = document.getElementById('people-members-list');
  if (!ml) return;
  const lb = state.stats?.scoreboard || [];
  const q = (state.peopleMembersQuery || '').toLowerCase().trim();
  const sortKey = state.peopleMembersSort || 'role';   // default: boss → admin → member
  const filterRole = state.peopleMembersFilter || 'all';
  const ptsOf = (id) => (lb.find(s => s.member?.id === id)?.points || 0);
  const tasksOf = (id) => state.tasks.filter(t => (t.assignees||[]).some(a => a.id === id)).length;
  let members = state.members.slice();
  // Filter role
  if (filterRole !== 'all') members = members.filter(m => m.role === filterRole);
  // Search across name/email/phone (+ prefix backward compat)
  if (q) members = members.filter(m => searchMatches(q, _memberHaystack(m).toLowerCase()));
  // Sort
  members.sort((a, b) => {
    if (sortKey === 'points_desc') return ptsOf(b.id) - ptsOf(a.id);
    if (sortKey === 'name')        return (a.name||'').localeCompare(b.name||'', 'th');
    if (sortKey === 'role') {
      const rank = { boss: 0, admin: 1, member: 2 };
      const d = (rank[a.role]??9) - (rank[b.role]??9);
      return d !== 0 ? d : ptsOf(b.id) - ptsOf(a.id);   // role เดียวกัน → points มาก→น้อย
    }
    if (sortKey === 'tasks_desc') return tasksOf(b.id) - tasksOf(a.id);
    return 0;
  });
  ml.innerHTML = members.length === 0
    ? `<div class="text-center text-slate-400 py-8 text-sm italic">ไม่พบสมาชิกที่ตรงกับเงื่อนไข</div>`
    : members.map(m => {
    const r = lb.find(x => x.member.id === m.id) || { points:0, completed_tasks:0, total_tasks:0, percent: 0 };
    const isMe = m.id === state.user.id;
    const onLeaveNow = !!memberLeaveAt(m.id, new Date().toISOString());
    return `
      <div class="member-card" style="--m-color:${m.color || '#94a3b8'}">
        <button type="button" class="flex items-center gap-3 w-full text-left member-card-main" data-act="member-detail" data-id="${m.id}">
          ${avatarHtml(m, 48)}
          <div class="flex-1 min-w-0">
            <div class="font-semibold truncate">${escapeHtml(m.name)} ${isMe?'<span class="text-[10px] text-indigo-600">(คุณ)</span>':''}${onLeaveNow ? ' <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold align-middle">🏖️ ลา</span>' : ''}</div>
            <div class="flex items-center gap-2 mt-0.5 flex-wrap">
              <span class="role-badge ${m.role} text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase">${m.role}</span>
              ${m.email ? `<span class="text-[11px] text-slate-500 truncate">${escapeHtml(m.email)}</span>` : ''}
              ${m.phone ? `<a href="tel:${escapeHtml(m.phone)}" class="text-[11px] text-slate-500 hover:underline" onclick="event.stopPropagation()">📞 ${escapeHtml(m.phone)}</a>` : ''}
            </div>
          </div>
          <div class="text-right">
            <div class="member-pts">${r.points} pts</div>
            <div class="text-[11px] text-slate-500">${r.percent || 0}% · ${r.completed_tasks}/${r.total_tasks}</div>
          </div>
        </button>
        ${isAdmin() ? `<div class="member-card-actions">
          <button class="ios-btn-ghost" data-act="edit-member" data-id="${m.id}">✏️ แก้ไข</button>
          ${!isMe ? `<button class="ios-btn-danger" data-act="del-member" data-id="${m.id}">🗑</button>` : ''}
        </div>` : ''}
      </div>`;
  }).join('');
  // Sync controls value with state (กรณีเรา re-render นอกจาก user เปลี่ยน)
  const srch = document.getElementById('people-members-search');
  if (srch && srch.value !== (state.peopleMembersQuery || '')) srch.value = state.peopleMembersQuery || '';
  document.getElementById('people-members-search-clear')?.classList.toggle('hidden', !state.peopleMembersQuery);
  const ssel = document.getElementById('people-members-sort');
  if (ssel) ssel.value = state.peopleMembersSort || 'points_desc';
  const fsel = document.getElementById('people-members-filter');
  if (fsel) fsel.value = state.peopleMembersFilter || 'all';

  // Connections — split into 2 categories. Personal (สมาชิก ↔ บริษัทที่ปรึกษา)
  // groups by member; Agency (หน่วยงาน) groups by liaison_name, with topic chips.
  // Search box filters BOTH categories simultaneously across name/org/topics/etc.
  const cl = document.getElementById('conn-list');
  const cq = (state.connQuery || '').toLowerCase().trim();
  const matches = (c) => {
    if (!cq) return true;
    const hay = [
      c.company, c.contact_name, c.contact_role, c.phone, c.email,
      c.notes, c.topics, c.liaison_name, c.member_name,
    ].filter(Boolean).join(' ');
    return searchMatches(cq, hay);   // abbreviation-aware (e.g. ทอ ↔ ทหารอากาศ)
  };
  // Apply type filter
  const filterKind = state.connFilter || 'all';
  let filtered = filterKind === 'all'
    ? state.connections.slice()
    : state.connections.filter(c => (c.kind || 'personal') === filterKind);
  filtered = filtered.filter(matches);
  // Apply sort (default = group by kind via personal/lobbyist/agency split below)
  if (state.connSort === 'name' || state.connSort === 'kind') {
    const nameOf = (c) => c.kind === 'lobbyist' ? (c.liaison_name || c.company || '')
                       : c.kind === 'agency' ? (c.company || c.liaison_name || '')
                       : (c.company || '');
    filtered.sort((a, b) => {
      if (state.connSort === 'name') return nameOf(a).localeCompare(nameOf(b), 'th');
      return (a.kind||'').localeCompare(b.kind||'');
    });
  }
  // Sync control values
  const cs = document.getElementById('conn-sort'); if (cs) cs.value = state.connSort || 'default';
  const cf = document.getElementById('conn-filter'); if (cf) cf.value = state.connFilter || 'all';
  const personal = filtered.filter(c => (c.kind || 'personal') === 'personal');
  const agency   = filtered.filter(c => c.kind === 'agency');
  const lobbyist = filtered.filter(c => c.kind === 'lobbyist');

  // Renders one connection card. Edit/delete visible to creator + admin.
  // opts.arrowPrefix → prepend "→ " to the org name (used in Agency/Lobbyist section
  // where the parent header already shows the liaison person, so each card
  // reads as "<person>" → "<agency>").
  function connCard(c, opts = {}) {
    const canEdit = isAdmin() || c.member_id === state.user.id;
    const isAgency = c.kind === 'agency';
    const isLobbyist = c.kind === 'lobbyist';
    const isPersonal = !isAgency && !isLobbyist;
    // (topics ถูกลบออกแล้ว — ไม่มี chip topics)
    // Main label: lobbyist/agency = liaison_name (คนๆนั้น), personal = company
    // Sub line: agency shows ตำแหน่ง (e.g. กองช่าง), lobbyist shows ตำแหน่ง,
    //           personal shows ผู้ติดต่อ + ตำแหน่ง
    const mainLabel = isLobbyist ? (c.liaison_name || c.company)
                      : isAgency ? (c.liaison_name || c.company)
                      : c.company;
    const contactMeta = [
      c.phone ? `<a href="tel:${escapeHtml(c.phone)}" class="hover:underline">📞 ${escapeHtml(c.phone)}</a>` : '',
      c.email ? `<a href="mailto:${escapeHtml(c.email)}" class="hover:underline">✉️ ${escapeHtml(c.email)}</a>` : '',
    ].filter(Boolean).join(' · ');

    // หา groups ที่ผูกกับ connection นี้ — แสดง chip กลุ่มงาน
    const linkedGroups = state.groups.filter(g =>
      Array.isArray(g.connection_ids) && g.connection_ids.includes(c.id)
    );
    const groupChips = linkedGroups.length > 0
      ? `<div class="conn-linked-groups">
          ${linkedGroups.map(g => `<button type="button" class="conn-linked-group-chip" data-goto-summary-group="${g.id}" style="--g-color:${groupColor(g)}" title="ไปยังกลุ่ม ${escapeHtml(g.name)}">📁 ${escapeHtml(g.name)}</button>`).join('')}
        </div>`
      : '';

    // กรณีไม่มี contact_meta / notes — render compact (ปุ่ม action ไป inline ขวา ไม่ stack vertical)
    return `
      <div class="conn-card conn-card-compact">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-sm">${escapeHtml(mainLabel)}${(isAgency || isLobbyist) && c.contact_role ? `<span class="text-xs text-slate-500 font-normal"> · ${escapeHtml(c.contact_role)}</span>` : ''}</div>
            ${isPersonal && c.contact_name ? `<div class="text-xs text-slate-700 mt-0.5">${escapeHtml(c.contact_name)}${c.contact_role ? ` · ${escapeHtml(c.contact_role)}` : ''}</div>` : ''}
            ${contactMeta ? `<div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 mt-1">${contactMeta}</div>` : ''}
            ${c.notes ? `<div class="text-[11px] text-slate-600 italic mt-1">"${escapeHtml(c.notes)}"</div>` : ''}
            ${groupChips}
          </div>
          ${canEdit ? `
            <div class="flex flex-row items-center gap-1 shrink-0">
              <button class="ios-btn-ghost text-xs" data-act="edit-conn" data-id="${c.id}" title="แก้ไข">แก้</button>
              <button class="ios-btn-danger text-xs" data-act="del-conn" data-id="${c.id}" title="ลบ">ลบ</button>
            </div>` : ''}
        </div>
      </div>`;
  }

  // ใช้ <details> เป็น collapsible sub-group (ใต้ section หลัก)
  // จำสถานะใน localStorage key 'conn-sub-<scope>-<id>' (scope = personal/agency, id = member_id/company)
  const isSubOpen = (scope, id) => {
    const v = localStorage.getItem(`conn-sub-${scope}-${id}`);
    return v === null ? true : v === '1';
  };
  const subGroup = (scope, id, headerHtml, count, bodyHtml, countLabel) => `
    <details class="conn-subgroup" data-conn-sub-scope="${scope}" data-conn-sub-id="${escapeHtml(id)}" ${isSubOpen(scope, id)?'open':''}>
      <summary class="conn-subgroup-summary">
        ${headerHtml}
        <span class="conn-subgroup-count">${count} ${countLabel}</span>
        <span class="conn-subgroup-caret">⌃</span>
      </summary>
      <div class="conn-subgroup-body">${bodyHtml}</div>
    </details>`;

  // Personal: grouped by owning member (lab member coordinator)
  let personalHtml = '';
  if (personal.length === 0) {
    personalHtml = `<div class="conn-empty">— ยังไม่มีบริษัท —</div>`;
  } else {
    const byMember = new Map();
    for (const c of personal) {
      if (!byMember.has(c.member_id)) byMember.set(c.member_id, []);
      byMember.get(c.member_id).push(c);
    }
    personalHtml = Array.from(byMember.entries()).map(([mid, conns]) => {
      const m = memberById(mid);
      const header = `${avatarHtml(m, 28)}<span class="conn-subgroup-title">${escapeHtml(m?.name || '?')}</span>`;
      const body = `<div class="conn-card-list">${conns.map(c => connCard(c)).join('')}</div>`;
      return subGroup('personal', mid || 'none', header, conns.length, body, 'บริษัท');
    }).join('');
  }

  // Agency: group by COMPANY (หน่วยงาน) — 1 หน่วยงานอาจมีผู้ประสานงานหลายคน
  // เช่น อบต มี พี่ตู่(กองช่าง) + พี่แหม่ม(ปลัด)
  function byCompanyHtml(list, emptyLabel) {
    if (list.length === 0) {
      return `<div class="conn-empty">— ${emptyLabel} —</div>`;
    }
    const byCompany = new Map();
    for (const c of list) {
      const key = (c.company && c.company.trim()) || '(ไม่ระบุ)';
      if (!byCompany.has(key)) byCompany.set(key, []);
      byCompany.get(key).push(c);
    }
    const ordered = Array.from(byCompany.entries()).sort(([a], [b]) => a.localeCompare(b, 'th'));
    return ordered.map(([company, conns]) => {
      const sorted = [...conns].sort((a, b) => (a.liaison_name || '').localeCompare(b.liaison_name || '', 'th'));
      const header = `<span class="conn-subgroup-icon">🏛️</span><span class="conn-subgroup-title">${escapeHtml(company)}</span>`;
      const body = `<div class="conn-card-list">${sorted.map(c => connCard(c)).join('')}</div>`;
      return subGroup('agency', company, header, conns.length, body, 'ผู้ประสานงาน');
    }).join('');
  }
  // Lobbyist: list per person (no grouping — each row IS one person)
  function lobbyistListHtml(list, emptyLabel) {
    if (list.length === 0) {
      return `<div class="conn-empty">— ${emptyLabel} —</div>`;
    }
    const sorted = [...list].sort((a, b) => (a.liaison_name || a.company || '').localeCompare(b.liaison_name || b.company || '', 'th'));
    return `<div class="conn-card-list">${sorted.map(c => connCard(c)).join('')}</div>`;
  }
  const agencyHtml = byCompanyHtml(agency, 'ยังไม่มีหน่วยงาน');
  const lobbyistHtml = lobbyistListHtml(lobbyist, 'ยังไม่มี Lobbyist');

  // When the search yields zero matches across both buckets, show a single
  // empty-state instead of two "ไม่มี" sections.
  if (cq && filtered.length === 0) {
    cl.innerHTML = `<div class="text-center text-slate-500 py-12 text-sm">ไม่พบ Connection ที่ตรงกับ "${escapeHtml(cq)}"</div>`;
    return;
  }
  if (!cq && state.connections.length === 0) {
    cl.innerHTML = `<div class="text-center text-slate-500 py-12 text-sm">ยังไม่มี Connections — กดปุ่ม + บนแถบบนเพื่อเพิ่ม</div>`;
    return;
  }

  // ใช้ <details> เป็น collapsible dropdown — เปิดได้โดย default
  // (ผู้ใช้กด ⌃ เพื่อยุบ section ที่ไม่ต้องการดูได้)
  // จำสถานะปิด/เปิดของแต่ละ section ใน localStorage (key 'conn-sec-open-<kind>')
  const isOpen = (kind) => {
    const v = localStorage.getItem('conn-sec-open-' + kind);
    return v === null ? true : v === '1';   // default = open
  };
  const sec = (kind, icon, title, count, html) => `
    <details class="conn-section" data-conn-sec="${kind}" ${isOpen(kind)?'open':''}>
      <summary class="conn-section-summary">
        <span class="text-base">${icon}</span>
        <span class="font-semibold text-sm">${title}</span>
        <span class="text-[11px] text-slate-500">· ${count}</span>
        <span class="conn-section-caret">⌃</span>
      </summary>
      <div class="conn-section-body">${html}</div>
    </details>`;
  cl.innerHTML = `
    <div class="space-y-2">
      ${sec('personal',  '🏢', 'บริษัท',   personal.length,  personalHtml)}
      ${sec('lobbyist',  '🎯', 'Lobbyist', lobbyist.length,  lobbyistHtml)}
      ${sec('agency',    '🏛️', 'หน่วยงาน', agency.length,    agencyHtml)}
    </div>`;
  // Persist open/close state — top section + sub-group (member/company)
  cl.querySelectorAll('details[data-conn-sec]').forEach(d => {
    d.addEventListener('toggle', () => {
      localStorage.setItem('conn-sec-open-' + d.dataset.connSec, d.open ? '1' : '0');
    });
  });
  cl.querySelectorAll('details[data-conn-sub-scope]').forEach(d => {
    d.addEventListener('toggle', () => {
      const k = `conn-sub-${d.dataset.connSubScope}-${d.dataset.connSubId}`;
      localStorage.setItem(k, d.open ? '1' : '0');
    });
  });
}

// ============== Member Detail Sheet ==============
// The 6 fixed radar axes:
//   - 5 are category prefixes ("เอกสาร - X" rolls up to "เอกสาร", etc.)
//   - "participation" is derived: count of meetings the member is an attendee of
//     (kind === 'meeting'). This makes radar reflect both work output AND team
//     engagement, so people who attend lots of meetings aren't penalized just
//     because meetings don't have categories.
const MEMBER_RADAR_AXES = [
  { key: 'เอกสาร',        label: 'เอกสาร',     icon: '📄' },
  { key: 'ศิลป์',         label: 'ศิลป์',      icon: '🎨' },
  { key: 'Extrovert',     label: 'Extrovert',  icon: '🗣️' },
  { key: 'participation', label: 'มีส่วนร่วม', icon: '🤝' },
  { key: 'ม้าเร็ว',       label: 'ม้าเร็ว',    icon: '🏇' },
  { key: 'Dev',           label: 'Dev',        icon: '💻' },
];

// Map a category name like "เอกสาร - Proposal" or "Dev - HW" to one of the 5 axes.
// Returns null if it doesn't match any (those don't show on the radar).
function categoryAxisOf(name) {
  if (!name) return null;
  const head = String(name).split(' - ')[0].trim();
  return MEMBER_RADAR_AXES.find(a => a.key === head)?.key || null;
}

// Build a polygon-style SVG radar chart for a member.
// counts: { 'เอกสาร': n, 'ศิลป์': n, ... } — task count per axis
// Returns an inline SVG string.
//
// Layout: viewBox is wider than tall so left/right labels (e.g. "ศิลป์ 2 งาน",
// "Extrovert 1 งาน") have room without being clipped. The plot itself is centered
// at (cx, cy) and the radius `R` is tuned so axis labels (placed at R + ~18) fit
// inside the viewBox horizontally for the longest expected label.
function memberRadarSvg(counts) {
  // 6 axes (hexagon) — top + bottom now both have labels on the vertical axis,
  // so we need extra vertical room compared to the 5-axis pentagon layout.
  const W = 360;                          // viewBox width  (extra room for side labels)
  const H = 300;                          // viewBox height (extra room for top + bottom labels)
  const cx = W / 2, cy = H / 2 + 4;       // plot center (slight downshift for legend row)
  const R = 80;                           // ring radius — tuned so labels stay inside W
  const axes = MEMBER_RADAR_AXES;
  const maxCount = Math.max(1, ...axes.map(a => counts[a.key] || 0));
  // Round max up to a nice tick scale (3, 5, 10, etc.) so grid rings are readable
  const tickMax = Math.max(3, Math.ceil(maxCount));
  const rings = 4;                        // number of grid rings (ticks)

  // Compute the (x,y) for each axis at radius `r` (0..1 of R)
  function pointFor(i, r) {
    // Start at top (-90deg), rotate clockwise
    const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
  }

  // Background grid rings
  let gridHtml = '';
  for (let k = 1; k <= rings; k++) {
    const r = (R * k) / rings;
    const pts = axes.map((_, i) => pointFor(i, r).map(n => n.toFixed(2)).join(',')).join(' ');
    gridHtml += `<polygon points="${pts}" fill="${k===rings?'#f8fafc':'none'}" stroke="#e2e8f0" stroke-width="1"/>`;
  }
  // Spokes
  let spokesHtml = '';
  axes.forEach((_, i) => {
    const [x, y] = pointFor(i, R);
    spokesHtml += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke="#e2e8f0" stroke-width="1"/>`;
  });
  // Data polygon
  const dataPts = axes.map((a, i) => {
    const v = (counts[a.key] || 0) / tickMax;
    return pointFor(i, R * Math.min(1, v)).map(n => n.toFixed(2)).join(',');
  }).join(' ');
  const dataPolygon = `<polygon points="${dataPts}" fill="rgba(99,102,241,0.25)" stroke="#6366f1" stroke-width="2" stroke-linejoin="round"/>`;
  // Data dots
  let dotsHtml = '';
  axes.forEach((a, i) => {
    const v = (counts[a.key] || 0) / tickMax;
    if (v <= 0) return;
    const [x, y] = pointFor(i, R * Math.min(1, v));
    dotsHtml += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" fill="#6366f1"/>`;
  });
  // Axis labels (positioned slightly outside the ring).
  // Two-line stack — name on top, count below. Anchor flips by x position so
  // text grows AWAY from the polygon and stays inside the viewBox.
  let labelsHtml = '';
  axes.forEach((a, i) => {
    const [x, y] = pointFor(i, R + 16);
    const c = counts[a.key] || 0;
    let anchor = 'middle';
    if (x < cx - 4) anchor = 'end';
    else if (x > cx + 4) anchor = 'start';
    // Top vs bottom — push label further away vertically so it doesn't overlap the polygon
    const isTop    = y < cy - R * 0.5;
    const isBottom = y > cy + R * 0.5;
    const dy1 = isBottom ? 8 : (isTop ? -8 : 0);
    const dy2 = dy1 + 14;
    labelsHtml += `
      <text x="${x.toFixed(2)}" y="${(y + dy1).toFixed(2)}" text-anchor="${anchor}" dominant-baseline="middle"
            font-size="11" font-weight="600" fill="#334155">${a.icon} ${a.label}</text>
      <text x="${x.toFixed(2)}" y="${(y + dy2).toFixed(2)}" text-anchor="${anchor}" dominant-baseline="middle"
            font-size="10" fill="${c > 0 ? '#4338ca' : '#94a3b8'}" font-weight="${c > 0 ? '700' : '500'}">${c} งาน</text>
    `;
  });
  // Top-right scale legend — show what tickMax represents
  const legendHtml = `
    <text x="${W - 8}" y="14" text-anchor="end" font-size="10" fill="#64748b">เต็มเส้น = ${tickMax} งาน</text>
  `;
  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:380px;display:block;margin:0 auto" xmlns="http://www.w3.org/2000/svg">
      ${legendHtml}
      ${gridHtml}
      ${spokesHtml}
      ${dataPolygon}
      ${dotsHtml}
      ${labelsHtml}
    </svg>
  `;
}

// Open the per-member profile sheet — opens the existing right-side sheet via openSheet().
function openMemberDetail(memberId) {
  const m = memberById(memberId);
  if (!m) { toast('ไม่พบสมาชิก', 'error'); return; }
  const isMe = m.id === state.user.id;

  // Scoreboard row for this member (points + completion stats)
  const lb = state.stats?.scoreboard || [];
  const sb = lb.find(x => x.member.id === m.id) || { points: 0, completed_tasks: 0, total_tasks: 0, percent: 0 };

  // Leave status — currently on leave?
  const nowIso = new Date().toISOString();
  const activeLeave = memberLeaveAt(m.id, nowIso);
  // All upcoming leaves (start in the future)
  const upcomingLeaves = (state.leaves || [])
    .filter(l => l.member_id === m.id && new Date(l.start_at).getTime() > Date.now())
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .slice(0, 3);

  // Tasks this member is/was an assignee of — split work tasks vs meetings
  const allMemberItems = state.tasks.filter(t => t.assignees.some(a => a.id === m.id));
  const memberTasks    = allMemberItems.filter(t => !isMeeting(t));
  const memberMeetings = allMemberItems.filter(t =>  isMeeting(t));
  const completed   = memberTasks.filter(t => t.status === 'completed');
  const inProgress  = memberTasks.filter(t => t.status === 'in_progress');
  const onHold      = memberTasks.filter(t => t.status === 'on_hold');

  // Radar — count tasks per axis. A task with multiple categories counts toward
  // each matching axis (not divided), so a multi-skill task is fully credited.
  // Includes both completed AND in-progress so newcomers' radars aren't empty.
  // The "participation" axis is filled separately from meeting attendance count.
  const counts = { 'เอกสาร': 0, 'ศิลป์': 0, 'Extrovert': 0, 'ม้าเร็ว': 0, 'Dev': 0, 'participation': 0 };
  for (const t of [...completed, ...inProgress]) {
    const axesHit = new Set();
    for (const c of (t.categories || [])) {
      const ax = categoryAxisOf(c.name);
      if (ax) axesHit.add(ax);
    }
    axesHit.forEach(ax => counts[ax]++);
  }
  // Participation = total meetings this member is invited to / attended.
  // Meetings of any status (scheduled, completed, etc.) all count — being on the
  // attendee list reflects engagement regardless of whether the meeting happened yet.
  counts['participation'] = memberMeetings.length;
  const totalCategorized = Object.values(counts).reduce((a, b) => a + b, 0);

  // Compact task-row renderer — same style as the existing card but lighter
  function taskRow(t) {
    const g = groupById(t.group_id);
    const gColor = groupColor(t.group_id);
    const dlCls = deadlineClass(t.deadline, t.status);
    const mine = isMyTask(t);
    return `
      <button class="task-card w-full text-left block ${mine?'is-mine':''}" data-task-detail="${t.id}" style="--group-color:${gColor}; border-left-color:${gColor}">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-sm leading-snug truncate">${escapeHtml(t.title)}</div>
            <div class="flex items-center gap-2 mt-0.5 flex-wrap text-[11px]">
              ${priorityBadgeHtml(t)}
              ${g ? `<span class="font-semibold" style="color:${gColor}">📁 ${escapeHtml(g.name)}</span>` : ''}
              ${t.deadline ? `<span class="${dlCls}">⏰ ${deadlineText(t.deadline, t.status)}</span>` : ''}
              ${mine ? `<span class="text-[10px] text-indigo-600 font-semibold">• ของคุณ</span>` : ''}
            </div>
          </div>
          <span class="status-badge status-${t.status} text-[10px]">${statusLabel(t.status)}</span>
        </div>
      </button>
    `;
  }

  // Section helper — collapsible by default-open state (just visual)
  function taskSection(title, list, emptyMsg) {
    return `
      <div>
        <div class="text-xs font-semibold text-slate-500 uppercase mb-2">${title} (${list.length})</div>
        ${list.length === 0
          ? `<div class="text-xs text-slate-400 italic px-2 py-1">${emptyMsg}</div>`
          : `<div class="space-y-1.5">${list.map(taskRow).join('')}</div>`}
      </div>
    `;
  }

  openSheet(`
    <div class="space-y-4">

      <!-- Header — big avatar, name, role, points stat -->
      <div class="flex items-center gap-4 pb-3 border-b border-slate-100">
        ${avatarHtml(m, 72)}
        <div class="flex-1 min-w-0">
          <h2 class="text-xl font-semibold leading-tight truncate">${escapeHtml(m.name)}${isMe?' <span class="text-[11px] text-indigo-600">(คุณ)</span>':''}</h2>
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <span class="role-badge ${m.role} text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase">${m.role}</span>
            ${m.email ? `<a href="mailto:${escapeHtml(m.email)}" class="text-[11px] text-slate-500 hover:underline truncate">✉️ ${escapeHtml(m.email)}</a>` : ''}
            ${m.phone ? `<a href="tel:${escapeHtml(m.phone)}" class="text-[11px] text-slate-500 hover:underline">📞 ${escapeHtml(m.phone)}</a>` : ''}
          </div>
        </div>
      </div>

      <!-- Quick stats — points + completion -->
      <div class="grid grid-cols-3 gap-2">
        <div class="bg-amber-50 rounded-xl p-3 text-center">
          <div class="text-[10px] text-amber-700 uppercase font-semibold">⭐ Points</div>
          <div class="font-bold text-amber-600 text-xl mt-0.5">${sb.points}</div>
        </div>
        <div class="bg-emerald-50 rounded-xl p-3 text-center">
          <div class="text-[10px] text-emerald-700 uppercase font-semibold">✅ เสร็จ</div>
          <div class="font-bold text-emerald-600 text-xl mt-0.5">${sb.completed_tasks}<span class="text-xs text-emerald-500">/${sb.total_tasks}</span></div>
        </div>
        <div class="bg-indigo-50 rounded-xl p-3 text-center">
          <div class="text-[10px] text-indigo-700 uppercase font-semibold">📈 อัตราสำเร็จ</div>
          <div class="font-bold text-indigo-600 text-xl mt-0.5">${sb.percent || 0}<span class="text-xs">%</span></div>
        </div>
      </div>

      <!-- Leave status banner -->
      ${activeLeave ? `
        <div class="rounded-xl p-3 border border-red-200 bg-red-50">
          <div class="flex items-center gap-2">
            <span class="text-2xl">🏖️</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold text-red-800">กำลังลางาน</div>
              <div class="text-[11px] text-red-700">
                ${fmtDateTime(activeLeave.start_at)} → ${fmtDateTime(activeLeave.end_at)}
                ${activeLeave.reason ? ' · ' + escapeHtml(activeLeave.reason) : ''}
              </div>
            </div>
          </div>
        </div>` : `
        <div class="rounded-xl p-3 border border-emerald-200 bg-emerald-50 flex items-center gap-2">
          <span class="text-xl">🟢</span>
          <div class="text-sm font-semibold text-emerald-800">ไม่ได้ลา — ออนทีมตามปกติ</div>
        </div>`}
      ${upcomingLeaves.length ? `
        <div>
          <div class="text-xs font-semibold text-slate-500 uppercase mb-2">📅 วันลาที่จะถึง</div>
          <div class="space-y-1.5">
            ${upcomingLeaves.map(l => `
              <div class="leave-row" style="border-left-color:#94a3b8">
                <span class="text-base">🏖️</span>
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium">${fmtDateTime(l.start_at)} → ${fmtDateTime(l.end_at)}</div>
                  ${l.reason ? `<div class="text-[11px] text-slate-500 truncate">${escapeHtml(l.reason)}</div>` : ''}
                </div>
              </div>`).join('')}
          </div>
        </div>` : ''}

      <!-- Radar chart by 5 category groups -->
      <div class="rounded-2xl border border-slate-200 bg-white p-3">
        <div class="flex items-center justify-between mb-1">
          <div class="text-xs font-semibold text-slate-500 uppercase">🎯 ทักษะตามประเภทงาน</div>
          <div class="text-[10px] text-slate-400">${totalCategorized > 0 ? `${totalCategorized} งานที่จัดประเภทแล้ว` : 'ยังไม่มีงานที่จัดประเภท'}</div>
        </div>
        ${memberRadarSvg(counts)}
        ${totalCategorized === 0 ? `<div class="text-center text-[11px] text-slate-400 mt-1">— ยังไม่มีงานที่จัดอยู่ใน 5 ประเภทหลัก —</div>` : ''}
      </div>

      <!-- Task lists — split by status -->
      ${taskSection('🔄 กำลังดำเนินการ', inProgress, 'ไม่มีงานที่กำลังทำ')}
      ${taskSection('⏸️ พักไว้', onHold, 'ไม่มีงานที่พักไว้')}
      ${taskSection('✅ เสร็จแล้ว', completed, 'ยังไม่มีงานที่ทำเสร็จ')}

    </div>
  `);
}

// global action handler
document.body.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act, id = btn.dataset.id;
  try {
    if (act === 'member-detail') openMemberDetail(id);
    else if (act === 'edit-member') openMemberModal(memberById(id));
    else if (act === 'del-member') {
      const m = memberById(id);
      if ((await uiConfirm(`ลบสมาชิก "${m.name}"?`))) { await api.del('/api/members/' + id); toast('ลบแล้ว', 'success'); await loadAll(); }
    }
    else if (act === 'edit-group') openGroupModal(groupById(id));
    else if (act === 'del-group') {
      const g = groupById(id);
      if ((await uiConfirm(`ลบโครงการ "${g.name}"?`))) { await api.del('/api/groups/' + id); toast('ลบแล้ว', 'success'); await loadAll(); }
    }
    else if (act === 'add-group') openGroupModal();
    else if (act === 'edit-conn') openConnectionModal(state.connections.find(c => c.id === id));
    else if (act === 'del-conn') {
      const c = state.connections.find(x => x.id === id);
      if ((await uiConfirm(`ลบ "${c.company}"?`))) { await api.del('/api/connections/' + id); toast('ลบแล้ว', 'success'); await loadAll(); }
    }
  } catch (err) { toast(err.message, 'error'); }
});

// ============== Profile ==============
function renderProfile() {
  if (!state.user) return;
  document.getElementById('me-name').textContent = state.user.name;
  document.getElementById('me-email').textContent = state.user.email || '';
  const rb = document.getElementById('me-role-badge');
  rb.textContent = state.user.role === 'boss' ? 'Boss' : (state.user.role === 'admin' ? 'Admin' : 'Member');
  // Boss badge ใช้สีต่างจาก admin (ทอง = สิทธิ์สูงสุด)
  rb.classList.toggle('role-badge-boss', state.user.role === 'boss');
  rb.className = `inline-block mt-1 text-xs px-2 py-0.5 rounded-full role-badge ${state.user.role}`;
  const me = state.stats?.scoreboard.find(r => r.member.id === state.user.id) || {};
  document.getElementById('me-pts').textContent = `${me.points || 0}`;
  document.getElementById('me-done').textContent = me.completed_tasks || 0;
  document.getElementById('me-doing').textContent = me.in_progress_tasks || 0;
  document.getElementById('me-all').textContent = me.total_tasks || 0;
  const _emEl = document.getElementById('me-email-optin');
  if (_emEl) _emEl.checked = state.user.email_opt_in !== 0;   // default (undefined/1) = เปิด
  document.getElementById('btn-manage-groups').classList.toggle('hidden', !(isAdmin() || leadsAnyGroup()));
  // System settings — admin only
  const sysBtn = document.getElementById('btn-system-settings');
  if (sysBtn) sysBtn.classList.toggle('hidden', !isAdmin());
  // Dev & Test Tools — admin only
  const devBtn = document.getElementById('btn-dev-tools');
  if (devBtn) devBtn.classList.toggle('hidden', !isAdmin());
  // Show "ลบรูปโปรไฟล์" only when user has uploaded one
  document.getElementById('me-avatar-remove').classList.toggle('hidden', !state.user.avatar_url);
  // Sync theme selector active state ทุกครั้งที่ profile ถูก render
  _syncThemeUI();
}

// ===== System Settings modal (admin only) =====
async function openSystemSettingsModal() {
  if (!isAdmin()) { toast('Admin เท่านั้น', 'error'); return; }
  let s;
  try { s = await api.get('/api/settings'); }
  catch (err) { toast(err.message, 'error'); return; }

  const emailOn = s.email_invitations_enabled !== 'false';   // default true
  const smtpReady = !!s._smtp_configured;

  const smtpBanner = smtpReady
    ? `<div class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
         ✅ SMTP เชื่อมต่อพร้อมใช้งาน — ระบบสามารถส่งอีเมลได้
       </div>`
    : `<div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
         ⚠️ ยังไม่ได้ตั้งค่า SMTP_HOST / SMTP_USER / SMTP_PASS ใน <code>.env</code> — แม้เปิด toggle ก็ส่งอีเมลไม่ได้
       </div>`;

  openModal('⚙️ ตั้งค่าระบบ', `
    <div class="space-y-3">

      ${smtpBanner}

      <label class="flex items-start gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition">
        <input type="checkbox" name="email_invitations_enabled" ${emailOn ? 'checked' : ''}
               class="mt-1 h-5 w-5 accent-indigo-600 cursor-pointer">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold">📧 ส่งอีเมลเชิญประชุมอัตโนมัติ</div>
          <div class="text-[11px] text-slate-500 mt-1 leading-snug">
            เมื่อเปิด — สร้าง / แก้ไข / ลบ meeting จะส่ง iMIP invitation (.ics) ทาง email ให้ assignee ทุกคนที่มี email อัตโนมัติ
            <br>เมื่อปิด — meeting ทำงานปกติทุกอย่าง แต่ไม่มีการส่งเมล
          </div>
        </div>
      </label>

      <div class="text-[11px] text-slate-400 px-1">
        การเปลี่ยนค่ามีผลทันที ไม่ต้อง restart container
      </div>
    </div>
  `, async data => {
    const newOn = data.email_invitations_enabled === 'on';
    await api.put('/api/settings', {
      email_invitations_enabled: newOn ? 'true' : 'false',
    });
    toast(newOn ? 'เปิดส่งอีเมลแล้ว ✓' : 'ปิดส่งอีเมลแล้ว', 'success');
  }, 'บันทึก');
}

// Profile picture upload — camera button opens file picker, selected image is uploaded
// to /api/me/avatar. After save, refresh state.user so all avatars in the app pick up
// the new URL (member chips, Calendar leave bars, task assignee stacks, etc.).
document.getElementById('me-avatar-edit').onclick = () => {
  document.getElementById('me-avatar-input').click();
};
// ใช้ Canvas resize ฝั่ง client ก่อนส่ง → server เก็บไฟล์เล็ก (typically
// < 100 KB) แทนของเดิมที่ 1-4 MB. ลด disk + เร็วในการ render People page
async function resizeImageToBlob(file, maxDim = 384, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const r = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * r), h = Math.round(img.height * r);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise(res => cv.toBlob(res, 'image/webp', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

document.getElementById('me-avatar-input').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast('ไฟล์ใหญ่เกิน 8 MB', 'error'); return; }
  if (!/^image\//.test(file.type)) { toast('กรุณาเลือกไฟล์รูปภาพ', 'error'); return; }
  try {
    // Resize ก่อน upload — เป้าหมาย ≤ 384×384 WebP ~ 30-80 KB
    const resized = await resizeImageToBlob(file, 384, 0.85);
    if (!resized) throw new Error('แปลงรูปไม่สำเร็จ');
    const fd = new FormData();
    fd.append('avatar', resized, 'avatar.webp');
    const res = await api.postForm('/api/me/avatar', fd);
    state.user.avatar_url = res.avatar_url;
    toast('อัพเดตรูปโปรไฟล์แล้ว ✓', 'success');
    await loadAll();
  } catch (err) { toast(err.message, 'error'); }
  e.target.value = '';   // reset input so same file can be re-selected later
};
document.getElementById('me-avatar-remove').onclick = async () => {
  if (!(await uiConfirm('ลบรูปโปรไฟล์? — จะกลับไปใช้ตัวอักษรย่อบนพื้นสี'))) return;
  try {
    await api.del('/api/me/avatar');
    state.user.avatar_url = '';
    toast('ลบรูปโปรไฟล์แล้ว', 'success');
    await loadAll();
  } catch (err) { toast(err.message, 'error'); }
};
document.getElementById('btn-change-pw').onclick = () => {
  openModal('เปลี่ยน PIN', `
    <div><label class="ios-label">PIN ปัจจุบัน</label><input class="ios-input" type="password" name="current_password" required></div>
    <div><label class="ios-label">PIN ใหม่ (อย่างน้อย 4 ตัว)</label><input class="ios-input" type="password" name="new_password" minlength="4" required></div>
  `, async data => { await api.put('/api/me/password', data); toast('เปลี่ยน PIN แล้ว', 'success'); });
};
// Email opt-in toggle — บันทึกทันทีเมื่อสลับ
document.getElementById('me-email-optin')?.addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  try {
    await api.put('/api/me/email-pref', { enabled });
    if (state.user) state.user.email_opt_in = enabled ? 1 : 0;
    toast(enabled ? 'เปิดรับอีเมลแล้ว' : 'ปิดรับอีเมลแล้ว', 'success');
  } catch (err) { toast(err.message, 'error'); e.target.checked = !enabled; }
});
document.getElementById('btn-manage-groups').onclick = () => openGroupListModal();
document.getElementById('btn-extensions').onclick = () => openExtensionsModal();
document.getElementById('btn-trash').onclick = () => openTrashModal();
document.getElementById('btn-manage-leaves').onclick = () => openMyLeavesModal();
document.getElementById('btn-system-settings').onclick = () => openSystemSettingsModal();
document.getElementById('btn-dev-tools').onclick = () => window.open('/dev', '_blank');

// ============== My Leaves modal ==============
function openMyLeavesModal() {
  const me = state.user.id;
  const myLeaves = (state.leaves || [])
    .filter(l => l.member_id === me)
    .sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
  const today = new Date().getTime();

  const rowsHtml = myLeaves.length === 0
    ? `<div class="text-sm text-slate-400 text-center py-4 italic">— ยังไม่มีวันลา —</div>`
    : myLeaves.map(l => {
        const isPast = new Date(l.end_at).getTime() < today;
        const isCurrent = new Date(l.start_at).getTime() <= today && today <= new Date(l.end_at).getTime();
        const cls = isCurrent ? 'border-amber-300 bg-amber-50' : isPast ? 'opacity-60' : '';
        return `
          <div class="leave-row ${cls}" data-leave-id="${l.id}">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">
                🏖️ ${escapeHtml(l.reason || 'ลา')}
                ${isCurrent ? '<span class="text-[10px] text-amber-700 font-bold ml-1">· กำลังลา</span>' : ''}
              </div>
              <div class="text-[11px] text-slate-600 mt-0.5">
                ${fmtDateTime(l.start_at)} → ${fmtDateTime(l.end_at)}
              </div>
            </div>
            <button class="ios-btn-danger text-xs" data-delete-leave="${l.id}">ลบ</button>
          </div>`;
      }).join('');

  // datetime-local default values: now + 1h end
  const now = new Date();
  const fmtDtLocal = d => {
    const z = d.getTime() - d.getTimezoneOffset() * 60000;
    return new Date(z).toISOString().slice(0, 16);
  };
  const defaultStart = fmtDtLocal(now);
  const endDefault = new Date(now.getTime() + 60*60*1000); // +1h
  const defaultEnd = fmtDtLocal(endDefault);

  openModal('🏖️ จัดการวันลาของฉัน', `
    <div class="space-y-3">
      <div class="text-[11px] text-slate-500">วันลาของคุณจะแสดงให้ทุกคนเห็นบน Calendar — ตอนสั่งงาน/เชิญประชุมจะเห็นว่าคุณไม่ว่าง</div>
      <div class="leave-list space-y-2">${rowsHtml}</div>
      <div class="border-t border-slate-200 pt-3 space-y-2">
        <div class="font-semibold text-sm">➕ เพิ่มวันลาใหม่</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label class="ios-label">เริ่ม (วัน + เวลา)</label>
            <input class="ios-input" name="start_at" type="datetime-local" value="${defaultStart}" required>
          </div>
          <div>
            <label class="ios-label">สิ้นสุด (วัน + เวลา)</label>
            <input class="ios-input" name="end_at" type="datetime-local" value="${defaultEnd}" required>
          </div>
        </div>
        <div>
          <label class="ios-label">เหตุผล (ไม่บังคับ)</label>
          <input class="ios-input" name="reason" placeholder="เช่น ลาป่วย / พักร้อน / ลากิจ" value="">
        </div>
      </div>
    </div>
  `, async data => {
    if (!data.start_at || !data.end_at) {
      throw new Error('ต้องระบุวันเริ่มและสิ้นสุด');
    }
    await api.post('/api/leaves', {
      start_at: data.start_at,
      end_at: data.end_at,
      reason: data.reason,
    });
    toast('เพิ่มวันลาแล้ว ✓', 'success');
    await loadAll();
    openMyLeavesModal();  // re-open with refreshed list
  }, 'เพิ่มวันลา');

  // Wire delete buttons
  modalForm.querySelectorAll('[data-delete-leave]').forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      const id = btn.dataset.deleteLeave;
      if (!(await uiConfirm('ลบวันลานี้?'))) return;
      try {
        await api.del('/api/leaves/' + id);
        toast('ลบแล้ว', 'success');
        await loadAll();
        openMyLeavesModal();
      } catch (err) { toast(err.message, 'error'); }
    };
  });
}

function openGroupListModal() {
  const html = `
    <div class="space-y-2">
      ${state.groups.length === 0 ? `<div class="text-sm text-slate-400 text-center py-4">ยังไม่มีโครงการ</div>` : ''}
      ${state.groups.map(g => {
        const tasks = state.tasks.filter(t => t.group_id === g.id);
        const done = tasks.filter(t => t.status === 'completed').length;
        const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
        const canEdit = isAdmin() || g.leader_id === state.user.id;
        return `
          <div class="bg-slate-50 rounded-xl p-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="font-semibold text-sm">${escapeHtml(g.name)}</div>
                <div class="text-[11px] text-slate-600 mt-0.5">👑 หัวหน้า: ${escapeHtml(g.leader_name || '— ยังไม่มี —')}</div>
                ${g.description ? `<div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(g.description)}</div>` : ''}
                <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500 mt-1">
                  <span>📅 ${fmtDate(g.start_date)}</span>
                  <span>⏰ ${fmtDate(g.deadline)}</span>
                  <span>📋 ${done}/${tasks.length}</span>
                </div>
                <div class="mt-1.5 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div class="h-full bg-emerald-500" style="width:${pct}%"></div>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                ${canEdit ? `<button class="ios-btn-ghost text-xs" data-act="edit-group" data-id="${g.id}">แก้ไข</button>` : ''}
                ${isAdmin() ? `<button class="ios-btn-danger text-xs" data-act="del-group" data-id="${g.id}">ลบ</button>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')}
      <button class="ios-btn-secondary w-full mt-2" data-act="add-group">+ เพิ่มโครงการใหม่</button>
    </div>`;
  openModal('จัดการโครงการ', html, async () => closeModal(), 'เสร็จ');
}

function openExtensionsModal() {
  const all = state.extensions;
  const html = !all.length ? `<div class="text-center text-slate-400 py-6 text-sm">ยังไม่มีคำขอ</div>` :
    all.map(r => `
      <div class="bg-slate-50 rounded-xl p-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium truncate">${escapeHtml(r.task_title || '—')}</div>
            <div class="text-[11px] text-slate-500 mt-0.5">โดย ${escapeHtml(r.requester_name || '?')} · ${fmtDate(r.created_at)}</div>
            <div class="text-xs mt-1">${fmtDate(r.current_deadline)} → <b>${fmtDate(r.requested_deadline)}</b></div>
            ${r.reason ? `<div class="text-[11px] text-slate-600 italic mt-1">"${escapeHtml(r.reason)}"</div>` : ''}
          </div>
          <div class="flex flex-col items-end gap-1">
            <span class="status-badge status-${r.status === 'approved'?'completed':r.status==='rejected'?'cancelled':'pending'}">${r.status}</span>
            ${r.status === 'pending' && isAdmin() ? `
              <button class="ios-btn-secondary text-xs" data-decide-ext="${r.id}" data-decision="approved">อนุมัติ</button>
              <button class="ios-btn-danger text-xs" data-decide-ext="${r.id}" data-decision="rejected">ปฏิเสธ</button>` : ''}
          </div>
        </div>
      </div>`).join('');
  openModal('คำขอเลื่อน Deadline', `<div class="space-y-2">${html}</div>`, async () => closeModal(), 'ปิด');
}

// ============== Calendar ==============
document.getElementById('cal-prev').onclick = () => navMonth(-1);
document.getElementById('cal-next').onclick = () => navMonth( 1);
function navMonth(delta) {
  const [y,m] = state.cal.ym.split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  state.cal.ym = ymKey(d); state.cal.selected = null;
  renderCalendar();
}
function renderCalendar() {
  const [y,m] = state.cal.ym.split('-').map(Number);
  const first = new Date(y, m-1, 1);
  const last  = new Date(y, m, 0);
  const startDow = first.getDay();
  const days = last.getDate();
  document.getElementById('cal-title').textContent = first.toLocaleDateString('th-TH', { month:'long', year:'numeric' });

  // Calendar only shows what still needs attention:
  //   - All meetings (always, regardless of status — they're events on a timeline)
  //   - Tasks with status='in_progress' only (hide on_hold + completed + cancelled)
  //   - Leaves (วันลา) — render as gray pills with member name on every covered day
  // Dots on day cells follow the same filter so users don't click an empty day.
  const showOnCalendar = (t) => isMeeting(t) || t.status === 'in_progress';

  const buckets = new Map();
  for (const t of state.tasks) {
    if (!t.deadline || !showOnCalendar(t)) continue;
    const k = t.deadline.slice(0,10);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  // Index leaves by every day they cover
  const leaveBuckets = new Map();
  for (const l of (state.leaves || [])) {
    const start = new Date(l.start_at); start.setHours(0,0,0,0);
    const end   = new Date(l.end_at);   end.setHours(0,0,0,0);
    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0,10);
      if (!leaveBuckets.has(k)) leaveBuckets.set(k, []);
      leaveBuckets.get(k).push(l);
    }
  }
  // Index personal reminders by date (YYYY-MM-DD)
  const reminderBuckets = new Map();
  for (const r of (state.reminders || [])) {
    if (!r.date) continue;
    const k = r.date.slice(0, 10);
    if (!reminderBuckets.has(k)) reminderBuckets.set(k, []);
    reminderBuckets.get(k).push(r);
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(`<div class="cal-cell muted"></div>`);
  // How many event pills to show on each cell before showing "+N more" overflow indicator
  const MAX_PER_TYPE = 3;  // limit 3 ต่อประเภท (task / meeting / leave) แล้วเหลือเป็น "+N"
  for (let d = 1; d <= days; d++) {
    const dateObj = new Date(y, m-1, d);
    const key = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayTasks = buckets.get(key) || [];
    const dayLeaves = leaveBuckets.get(key) || [];
    const isToday = dateObj.getTime() === today.getTime();
    const isSelected = state.cal.selected === key;
    const hasOverdue = dayTasks.some(t => deadlineClass(t.deadline, t.status) === 'deadline-over');

    // แยก meetings / tasks / leaves — แต่ละประเภทแสดง max 3 (เกินกว่านั้น "+N")
    const pills = [];
    const meetings = dayTasks.filter(t => isMeeting(t));
    const tasksOnly = dayTasks.filter(t => !isMeeting(t));
    const renderEventPill = (t) => {
      const meeting = isMeeting(t);
      const color = eventColor(t);
      const icon  = meeting ? '📅' : '📋';
      const overdueCls = (!meeting && deadlineClass(t.deadline, t.status) === 'deadline-over') ? ' is-overdue' : '';
      const meetingCls = meeting ? ' cal-pill-meeting' : '';
      return `<span class="cal-pill${overdueCls}${meetingCls}" style="--pill-color:${color}" title="${escapeHtml(t.title)}">${icon} ${escapeHtml(t.title)}</span>`;
    };
    // 1) Meetings (max 3)
    for (const t of meetings.slice(0, MAX_PER_TYPE)) pills.push(renderEventPill(t));
    if (meetings.length > MAX_PER_TYPE) pills.push(`<span class="cal-pill cal-pill-more">+${meetings.length - MAX_PER_TYPE} ประชุม</span>`);
    // 2) Tasks (max 3)
    for (const t of tasksOnly.slice(0, MAX_PER_TYPE)) pills.push(renderEventPill(t));
    if (tasksOnly.length > MAX_PER_TYPE) pills.push(`<span class="cal-pill cal-pill-more">+${tasksOnly.length - MAX_PER_TYPE} งาน</span>`);
    // 3) Leaves (max 3)
    const visibleLeaves = dayLeaves.slice(0, MAX_PER_TYPE);
    for (const l of visibleLeaves) {
      const m = memberById(l.member_id);
      const mColor = m?.color || l.member_color || '#94a3b8';
      const mAvatar = m?.avatar_url || l.member_avatar || '';
      const tip = `${l.member_name} ลา${l.reason ? ': '+l.reason : ''} (${fmtDateTime(l.start_at)} → ${fmtDateTime(l.end_at)})`;
      const avatarMarkup = mAvatar
        ? `<img class="cal-pill-avatar cal-pill-avatar-img" src="${escapeHtml(mAvatar)}" alt="">`
        : `<span class="cal-pill-avatar" style="background:${mColor}">${escapeHtml(initials(l.member_name))}</span>`;
      pills.push(`<span class="cal-pill cal-pill-leave" title="${escapeHtml(tip)}">${avatarMarkup}${escapeHtml(l.member_name)}${l.reason?' · '+escapeHtml(l.reason):''}</span>`);
    }
    if (dayLeaves.length > MAX_PER_TYPE) pills.push(`<span class="cal-pill cal-pill-more">+${dayLeaves.length - MAX_PER_TYPE} ลา</span>`);
    // 4) Reminders (เตือนความจำ, max 3)
    const dayReminders = reminderBuckets.get(key) || [];
    for (const r of dayReminders.slice(0, MAX_PER_TYPE)) pills.push(`<span class="cal-pill cal-pill-reminder" title="${escapeHtml(r.text)}">🔔 ${escapeHtml(r.text)}</span>`);
    if (dayReminders.length > MAX_PER_TYPE) pills.push(`<span class="cal-pill cal-pill-more">+${dayReminders.length - MAX_PER_TYPE} เตือน</span>`);

    const cls = ['cal-cell'];
    if (isToday)    cls.push('today');
    if (isSelected) cls.push('selected');
    if (hasOverdue) cls.push('has-overdue');
    cells.push(`
      <button class="${cls.join(' ')}" data-cal-day="${key}">
        <div class="cal-cell-num">${d}</div>
        <div class="cal-cell-pills">${pills.join('')}</div>
      </button>`);
  }
  document.getElementById('cal-grid').innerHTML = cells.join('');
  // Restore flat 7-col grid (was overridden during the multi-day-bar experiment)
  document.getElementById('cal-grid').className = 'grid grid-cols-7 gap-1.5';

  // Toggle: คลิกวันเดิมซ้ำ = ยกเลิก selected (กลับไปดูทั้งเดือน)
  document.querySelectorAll('[data-cal-day]').forEach(b => {
    b.onclick = () => {
      state.cal.selected = state.cal.selected === b.dataset.calDay ? null : b.dataset.calDay;
      renderCalendar();
    };
  });

  let listLabel, meetingLabel, list;
  if (state.cal.selected) {
    listLabel    = `📋 งานในวันที่ ${fmtDate(state.cal.selected)}`;
    meetingLabel = `📅 การประชุมในวันที่ ${fmtDate(state.cal.selected)}`;
    list = buckets.get(state.cal.selected) || [];
  } else {
    listLabel    = '📋 งานในเดือนนี้ (เรียงตาม deadline)';
    meetingLabel = '📅 การประชุมในเดือนนี้';
    // Apply the same Calendar visibility filter for the all-month view
    list = state.tasks.filter(t => t.deadline && t.deadline.startsWith(state.cal.ym) && showOnCalendar(t))
      .sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
  }
  document.getElementById('cal-day-label').textContent     = listLabel;
  document.getElementById('cal-meetings-label').textContent = meetingLabel;
  // ปุ่ม "ดูทั้งเดือน" — แสดงเฉพาะเมื่อมี selected day
  const clearBtn = document.getElementById('cal-clear-selection');
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !state.cal.selected);
    clearBtn.onclick = () => { state.cal.selected = null; renderCalendar(); };
  }

  // Split: meetings render under the calendar grid, tasks render in the right column.
  // (Completed/on_hold tasks are already filtered out by showOnCalendar above, so the
  // tasks list here is purely status='in_progress'.)
  const meetings  = list.filter(t => isMeeting(t));
  const tasksOnly = list.filter(t => !isMeeting(t));

  // ===== Meetings (left column, under the calendar) =====
  document.getElementById('cal-meetings-list').innerHTML = meetings.length
    ? meetings.map(taskCardHtml).join('')
    : `<div class="text-center text-slate-400 text-xs py-4 italic">— ไม่มีการประชุมในช่วงนี้ —</div>`;

  // ===== Tasks (right column) — only in_progress tasks =====
  document.getElementById('cal-day-list').innerHTML = tasksOnly.length
    ? tasksOnly.map(taskCardHtml).join('')
    : `<div class="text-center text-slate-400 text-sm py-6">ไม่มีงานที่กำลังดำเนินการในช่วงนี้</div>`;

  // ===== Leaves list (right column) — visible scope follows the selected day or month =====
  const leavesEl = document.getElementById('cal-leaves-list');
  const leavesLabelEl = document.getElementById('cal-leaves-label');
  if (leavesEl) {
    let leavesInScope;
    if (state.cal.selected) {
      leavesInScope = leaveBuckets.get(state.cal.selected) || [];
      leavesLabelEl.textContent = `🏖️ วันลาในวันที่ ${fmtDate(state.cal.selected)}`;
    } else {
      // All leaves overlapping this calendar month
      const monthStart = new Date(y, m-1, 1).getTime();
      const monthEnd   = new Date(y, m, 0, 23, 59, 59).getTime();
      leavesInScope = (state.leaves || []).filter(l => {
        const s = new Date(l.start_at).getTime();
        const e = new Date(l.end_at).getTime();
        return s <= monthEnd && e >= monthStart;
      });
      leavesLabelEl.textContent = '🏖️ วันลาในเดือนนี้';
    }
    leavesEl.innerHTML = leavesInScope.length
      ? leavesInScope.map(l => `
          <div class="leave-row">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              ${avatarHtml({ name: l.member_name, color: l.member_color, avatar_url: l.member_avatar }, 24)}
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium truncate">${escapeHtml(l.member_name)}${l.reason ? ` · ${escapeHtml(l.reason)}` : ''}</div>
                <div class="text-[11px] text-slate-500">${fmtDateTime(l.start_at)} → ${fmtDateTime(l.end_at)}</div>
              </div>
            </div>
          </div>
        `).join('')
      : `<div class="text-center text-slate-400 text-xs py-3 italic">— ไม่มีวันลาในช่วงนี้ —</div>`;
  }

  // ===== Reminders list (เตือนความจำ) — scope follows selected day or month =====
  const remEl = document.getElementById('cal-reminders-list');
  const remLabelEl = document.getElementById('cal-reminders-label');
  if (remEl) {
    let rems;
    if (state.cal.selected) {
      rems = (state.reminders || []).filter(r => r.date === state.cal.selected);
      if (remLabelEl) remLabelEl.textContent = `🔔 เตือนความจำวันที่ ${fmtDate(state.cal.selected)}`;
    } else {
      rems = (state.reminders || []).filter(r => r.date && r.date.startsWith(state.cal.ym));
      if (remLabelEl) remLabelEl.textContent = '🔔 เตือนความจำเดือนนี้';
    }
    rems.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    remEl.innerHTML = rems.length
      ? rems.map(r => `
          <div class="leave-row">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="text-base leading-none">🔔</span>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium truncate">${escapeHtml(r.text)}</div>
                <div class="text-[11px] text-slate-500">${fmtDate(r.date)}</div>
              </div>
            </div>
            <button class="text-rose-500 text-sm px-1.5" data-del-reminder="${r.id}" title="ลบ">🗑</button>
          </div>`).join('')
      : `<div class="text-center text-slate-400 text-xs py-3 italic">— ไม่มีเตือนความจำในช่วงนี้ —</div>`;
    remEl.querySelectorAll('[data-del-reminder]').forEach(b => b.onclick = async () => {
      try { await api.del('/api/reminders/' + b.dataset.delReminder); await loadAll(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  // ===== Create-bar (right column top) =====
  // Updates hint based on selected date + shows/hides task/meeting buttons by role.
  const hint = document.getElementById('cal-create-hint');
  if (hint) {
    hint.textContent = state.cal.selected
      ? `📅 วันที่เลือก: ${fmtDate(state.cal.selected)} — สร้างใหม่ที่นี่:`
      : 'เลือกวันที่บนปฏิทินเพื่อตั้ง deadline ให้งานใหม่';
  }
  // Show "+ งาน" / "+ ประชุม" only if user can actually create (admin or any-group leader)
  const canCreateTask = isAdmin() || leadsAnyGroup();
  document.querySelectorAll('[data-cal-create="task"], [data-cal-create="meeting"]').forEach(b => {
    b.style.display = canCreateTask ? '' : 'none';
  });
}

// Calendar create-bar — opens task/meeting form pre-filled with the selected date.
// (Group creation is offered inline inside the task form when no suitable group exists.)
document.body.addEventListener('click', e => {
  const btn = e.target.closest('[data-cal-create]');
  if (!btn) return;
  const kind = btn.dataset.calCreate; // 'task' | 'meeting'
  const selectedDate = state.cal.selected || null; // YYYY-MM-DD or null
  const preset = selectedDate ? { deadline: selectedDate, start_date: selectedDate } : {};

  if (kind === 'task') {
    openTaskModal({ ...preset, status: 'in_progress', points: 0 });
  } else if (kind === 'meeting') {
    openMeetingModal({ ...preset });
  } else if (kind === 'reminder') {
    const _t = new Date();
    const defDate = selectedDate || `${_t.getFullYear()}-${String(_t.getMonth() + 1).padStart(2, '0')}-${String(_t.getDate()).padStart(2, '0')}`;
    openModal('🔔 เตือนความจำ', `
      <div><label class="ios-label">วันที่ *</label><input class="ios-input" type="date" name="date" value="${defDate}" required></div>
      <div><label class="ios-label">ข้อความ *</label><input class="ios-input" name="text" placeholder="เช่น ไป ทอ." required></div>
    `, async data => {
      if (!data.date) { toast('ต้องระบุวันที่', 'error'); return; }
      await api.post('/api/reminders', { date: data.date, text: data.text });
      toast('เพิ่มเตือนความจำแล้ว', 'success');
      await loadAll();
    });
  }
});

// ============== Summary page (replaces Files page) ==============
function renderSummary() {
  const root = document.getElementById('summary-content');
  if (state.summarySelectedGroup) {
    const g = groupById(state.summarySelectedGroup);
    if (!g) {
      state.summarySelectedGroup = null;
      renderSummary();
      return;
    }
    root.innerHTML = `<div class="text-center text-slate-400 py-8 text-sm">กำลังโหลดสมาชิกกลุ่ม…</div>`;
    api.get('/api/groups/' + g.id + '/members')
      .then(members => {
        root.innerHTML = renderSummaryDetail(g, members);
        wireSummaryDetail(g, members);
      })
      .catch(() => {
        root.innerHTML = renderSummaryDetail(g, []);
        wireSummaryDetail(g, []);
      });
  } else {
    root.innerHTML = renderSummaryIndex();
    wireSummaryIndex();
  }
}

function renderGroupCard(g) {
  const tasks = state.tasks.filter(t => t.group_id === g.id);
  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const pct = total ? Math.round(completed / total * 100) : 0;
  // No upfront budget concept — Points are earned only after completion + workflow.
  const earned = tasks.reduce((s, t) => s + (t.status === 'completed' ? earnedPoints(t) : 0), 0);
  const filesCount = state.files.filter(f => f.group_id === g.id).length;
  const dlCls = deadlineClass(g.deadline, g.status);
  const canClaim = !g.leader_id && !isAdmin();
  const myPendingProposal = state.groupInvitations.find(i =>
    i.group_id === g.id && i.member_id === state.user.id && i.kind === 'proposal' && i.status === 'pending');
  const gColor = groupColor(g.id);
  // Manage permissions: leader of this group OR admin
  const canManage = isAdmin() || g.leader_id === state.user.id;
  const isArchived = g.status === 'archived';
  const isCompleted = g.status === 'completed';
  // status → สีจุด (semantic) สำหรับ pill ขาว
  const STATUS_DOT = { idea:'#94a3b8', proposal:'#3b82f6', pending_approval:'#f59e0b', in_progress:'#f97316', delivery:'#10b981', maintenance:'#3b82f6', completed:'#10b981', on_hold:'#94a3b8', cancelled:'#f43f5e', archived:'#64748b' };
  const sDot = STATUS_DOT[g.status] || '#94a3b8';
  // group color → "r,g,b" สำหรับ tint หัวการ์ด (ใช้ rgba ทำงานได้ทั้ง light/dark)
  const _h = String(gColor).replace('#','');
  const _rgb = _h.length === 6 ? `${parseInt(_h.slice(0,2),16)},${parseInt(_h.slice(2,4),16)},${parseInt(_h.slice(4,6),16)}` : '99,102,241';
  return `
    <div class="group-card sg-card text-left ${isArchived || isCompleted ? 'group-card-faded' : ''}" style="--group-color:${gColor};--group-rgb:${_rgb}">
      <button class="block w-full text-left" data-summary-group="${g.id}">
        <div class="sg-card-head">
          <div class="sg-card-top">
            <div class="sg-card-top-left">
              <span class="sg-card-dot"></span>
              <span class="sg-status"><span class="sg-status-dot" style="background:${sDot}"></span>${statusLabel(g.status)}</span>
            </div>
            <span class="sg-card-frac">${completed}/${total}</span>
          </div>
          <div class="sg-card-title">${escapeHtml(g.name)}</div>
          <div class="sg-card-leader">
            ${(() => {
              if (!g.leader_id) return `<span class="sg-leader-empty">👑 — ยังไม่มีหัวหน้า —</span>`;
              const leader = (state.members || []).find(m => m.id === g.leader_id);
              const lc = leader && leader.color ? leader.color : '#94a3b8';
              const ln = (leader && leader.name) || g.leader_name || '?';
              const ini = (function(s){ const p = String(s).trim().split(/\s+/).filter(Boolean); return p.length>=2 ? ((p[0][0]||'') + (p[1][0]||'')) : String(s).slice(0,2); })(ln);
              return `<span class="sg-leader-avatar" style="background:${lc}">${escapeHtml(ini)}</span><span class="sg-leader-crown">👑</span><span class="sg-leader-name">${escapeHtml(ln)}</span>`;
            })()}
          </div>
        </div>
        <div class="sg-card-body">
        ${g.description ? `<div class="sg-card-desc">${escapeHtml(g.description)}</div>` : ''}
        <div class="sg-stat-grid">
          <div class="sg-stat-tile">
            <div class="sg-stat-label">Tasks</div>
            <div class="sg-stat-value">${completed}/${total}</div>
          </div>
          <div class="sg-stat-tile">
            <div class="sg-stat-label">Points</div>
            <div class="sg-stat-value"><span class="sg-stat-star">★</span> ${earned}</div>
          </div>
          <div class="sg-stat-tile">
            <div class="sg-stat-label">Files</div>
            <div class="sg-stat-value">${filesCount}</div>
          </div>
        </div>
        <div class="sg-progress">
          <div class="sg-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="sg-card-foot">
          ${g.target ? `<span>→ ${escapeHtml(g.target)}</span>` : '<span></span>'}
          <span class="${dlCls}">⏰ ${g.deadline ? deadlineText(g.deadline, g.status) : '—'}</span>
        </div>
        ${(() => {
          // Connection chips ที่ผูกกับ group นี้ (max 4 ตัว + "...อีก N")
          const cIds = Array.isArray(g.connection_ids) ? g.connection_ids : [];
          if (cIds.length === 0) return '';
          const cMap = new Map(state.connections.map(c => [c.id, c]));
          const conns = cIds.map(id => cMap.get(id)).filter(Boolean);
          const kindIcon = { personal: '🏢', lobbyist: '🎯', agency: '🏛️' };
          const labelOf = (c) => {
            if (c.kind === 'lobbyist') return c.liaison_name || c.company;
            if (c.kind === 'agency')   return c.liaison_name ? `${c.company} · ${c.liaison_name}` : c.company;
            return c.company;
          };
          const MAX = 4;
          const visible = conns.slice(0, MAX);
          const overflow = conns.length - visible.length;
          return `
            <div class="group-card-conns">
              ${visible.map(c => `<span class="group-card-conn-chip" title="${escapeHtml(labelOf(c))}">${kindIcon[c.kind] || '🔗'} ${escapeHtml(labelOf(c))}</span>`).join('')}
              ${overflow > 0 ? `<span class="group-card-conn-chip group-card-conn-more">+${overflow}</span>` : ''}
            </div>`;
        })()}
        </div>
      </button>
      ${canClaim ? `<button class="ios-btn-primary w-full text-sm mt-3" data-claim-group="${g.id}">✋ หยิบกลุ่มนี้ — เป็นหัวหน้างาน</button>` : ''}
      ${myPendingProposal ? `<div class="text-center text-[11px] text-amber-700 bg-amber-50 rounded-lg py-1.5 mt-2">⏳ คำขอเข้ากลุ่มของคุณรอพิจารณา</div>` : ''}
      ${canManage ? `
        <div class="group-card-actions flex gap-1 mt-2 pt-2 border-t border-slate-100">
          <button class="group-act-btn" data-edit-group="${g.id}" title="แก้ไข">✏️</button>
          ${isArchived
            ? `<button class="group-act-btn" data-unarchive-group="${g.id}" title="กู้คืน">↩️ กู้คืน</button>`
            : `<button class="group-act-btn" data-archive-group="${g.id}" title="เก็บเข้าโกดัง">📦 เก็บ</button>`
          }
          <button class="group-act-btn group-act-danger ml-auto" data-delete-group="${g.id}" title="ลบ">🗑️</button>
        </div>` : ''}
    </div>`;
}

function renderSummaryIndex() {
  const canCreate = isAdmin() || leadsAnyGroup();
  const createBtn = canCreate
    ? `<button id="summary-create-group" class="ios-btn ios-btn-primary text-sm" style="padding:.5rem 1rem">+ สร้างโครงการใหม่</button>`
    : '';

  if (state.groups.length === 0) {
    return `
      <div class="flex items-center justify-between mb-4 px-1 flex-wrap gap-2">
        <div class="text-sm text-slate-600">กลุ่มงานของคุณ</div>
        ${createBtn}
      </div>
      <div class="empty-hero">
        <div class="empty-hero-icon">📁</div>
        <div class="empty-hero-title">ยังไม่มีกลุ่มงาน</div>
        <div class="empty-hero-sub">${canCreate ? 'กดปุ่ม "+ สร้างโครงการใหม่" เพื่อเริ่ม' : 'รอ admin หรือหัวหน้ากลุ่มสร้าง'}</div>
      </div>`;
  }
  const me = state.user.id;
  // Active = ไม่ archived/completed; ไปแยกเป็น role-based 3 sections เดิม
  const isInactive = g => g.status === 'archived' || g.status === 'completed';
  const activeGroups = state.groups.filter(g => !isInactive(g));
  const doneGroups   = state.groups.filter(g => isInactive(g));

  const leaderGroups = activeGroups.filter(g => g.leader_id === me);
  const memberGroups = activeGroups.filter(g => g.leader_id !== me && g.am_member);
  const otherGroups  = activeGroups.filter(g => g.leader_id !== me && !g.am_member);

  // เปิด/ปิด section — จำสถานะใน localStorage
  // (default: 3 หัวข้อหลักเปิด, archived/completed ปิด)
  const secOpen = (key, def) => {
    try { const v = localStorage.getItem('sml_sum_sec_' + key); return v === null ? def : v === '1'; }
    catch (e) { return def; }
  };
  // ทุก section เป็น dropdown (พับได้) — header: caret + icon + ชื่อ + "X โครงการ"
  const section = (title, icon, key, list, defOpen) => {
    const dim = list.length === 0;
    const body = dim
      ? `<div class="text-xs text-slate-400 italic px-3 py-3 bg-slate-50 rounded-xl mt-2 ml-1">— ไม่มีกลุ่มในหมวดนี้ —</div>`
      : `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">${list.map(renderGroupCard).join('')}</div>`;
    return `
      <details class="mb-6 summary-collapsible summary-section" data-sec-key="${key}" ${secOpen(key, defOpen) ? 'open' : ''}>
        <summary class="summary-sec-summary px-1">
          <span class="summary-collapsible-caret">▸</span>
          <span class="summary-sec-titles">
            <span class="summary-sec-title ${dim ? 'summary-sec-dim' : ''}"><span>${icon}</span>${escapeHtml(title)}</span>
            <span class="summary-sec-count ${dim ? 'summary-sec-dim' : ''}">${list.length} โครงการ</span>
          </span>
        </summary>
        ${body}
      </details>`;
  };

  const archivedGroups  = doneGroups.filter(g => g.status === 'archived');
  const completedGroups = doneGroups.filter(g => g.status === 'completed');

  return `
    <div class="flex items-center justify-between mb-3 px-1 flex-wrap gap-2">
      <div class="text-sm text-slate-600">กลุ่มงานของคุณ — แบ่งตามบทบาท</div>
      ${createBtn}
    </div>
    ${section('งานที่ฉันเป็นหัวหน้า', '👑', 'leader', leaderGroups, true)}
    ${section('งานที่ฉันเป็นสมาชิก', '👥', 'member', memberGroups, true)}
    ${section('งานที่ไม่มีส่วนเกี่ยวข้อง', '🔍', 'other', otherGroups, true)}
    ${archivedGroups.length  ? section('โครงการที่เก็บ', '📦', 'archived', archivedGroups, false) : ''}
    ${completedGroups.length ? section('โครงการที่เสร็จแล้ว', '✅', 'completed', completedGroups, false) : ''}
  `;
}

function wireSummaryIndex() {
  document.querySelectorAll('[data-summary-group]').forEach(b => {
    b.onclick = () => gotoSummaryGroup(b.dataset.summaryGroup);
  });
  document.querySelectorAll('[data-claim-group]').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const g = groupById(b.dataset.claimGroup);
      if (!(await uiConfirm(`รับเป็นหัวหน้ากลุ่ม "${g?.name||''}"?`))) return;
      try { await api.post('/api/groups/' + b.dataset.claimGroup + '/claim'); toast('คุณเป็นหัวหน้ากลุ่มแล้ว 👑', 'success'); await loadAll(); }
      catch (err) { toast(err.message, 'error'); }
    };
  });
  // Create new group
  document.getElementById('summary-create-group')?.addEventListener('click', () => {
    openGroupModal();
  });
  // จำสถานะเปิด/ปิดของแต่ละ section (dropdown) ลง localStorage
  document.querySelectorAll('details[data-sec-key]').forEach(d => {
    d.addEventListener('toggle', () => {
      try { localStorage.setItem('sml_sum_sec_' + d.dataset.secKey, d.open ? '1' : '0'); } catch (e) {}
    });
  });
  // Edit group
  document.querySelectorAll('[data-edit-group]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const g = groupById(b.dataset.editGroup);
      if (g) openGroupModal(g);
    };
  });
  // Archive (status='archived')
  document.querySelectorAll('[data-archive-group]').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const g = groupById(b.dataset.archiveGroup);
      if (!(await uiConfirm(`เก็บโครงการ "${g?.name||''}" เข้าโกดัง?`, { okLabel: '📦 เก็บ', danger: false }))) return;
      try {
        await api.put('/api/groups/' + b.dataset.archiveGroup, { status: 'archived' });
        toast('เก็บโครงการแล้ว 📦', 'success');
        await loadAll();
      } catch (err) { toast(err.message, 'error'); }
    };
  });
  // Unarchive (restore to in_progress)
  document.querySelectorAll('[data-unarchive-group]').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      try {
        await api.put('/api/groups/' + b.dataset.unarchiveGroup, { status: 'in_progress' });
        toast('กู้คืนโครงการแล้ว', 'success');
        await loadAll();
      } catch (err) { toast(err.message, 'error'); }
    };
  });
  // Delete (permanent — DESTRUCTIVE)
  document.querySelectorAll('[data-delete-group]').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const g = groupById(b.dataset.deleteGroup);
      if (!(await uiConfirm(
        `ลบโครงการ "${g?.name||''}"?\n\n⚠️ การลบจะลบ task ทั้งหมดในกลุ่มนี้ออกด้วย ไม่สามารถกู้คืนได้`,
        { okLabel: '🗑️ ลบถาวร', danger: true }
      ))) return;
      try {
        await api.del('/api/groups/' + b.dataset.deleteGroup);
        toast('ลบโครงการแล้ว', 'success');
        await loadAll();
      } catch (err) { toast(err.message, 'error'); }
    };
  });
}

// ============== Overview / Manage all entities page ==============
// หน้า Overview — รวมการจัดการ task / group / member / connection ในที่เดียว
// มี search ครอบคลุมทุก entity + tabs สลับมุมมอง + CRUD action ผ่าน modal เดิม
let _ovMfOutsideBound = false;   // flag กัน double-bind ของ outside-click listener
// Overview state — เก็บ sort/filter แต่ละ entity type แยกกัน
// Filter เก็บเป็น Array<string> — empty = ทุกอย่าง, มี value = filter เฉพาะอันที่ tick
const _overviewState = {
  tab: 'all', query: '',
  // Tasks
  taskSort: 'deadline_asc',
  taskFilter: [],              // statuses ที่ tick — [] = all
  // Groups
  groupSort: 'created_desc',
  groupFilter: [],
  // Members
  memberSort: 'role',          // default = role (boss → admin → member)
  memberFilter: [],            // roles
  memberGroupFilter: [],       // group_ids (multi) — empty = all
  // Connections
  connSort: 'name',
  connFilter: [],              // kinds
};

function renderOverview() {
  // Counts ทุก tab — แสดงเลขข้าง tab name
  const cTasks = state.tasks.filter(t => !isMeeting(t)).length;
  const cGroups = state.groups.length;
  const cMembers = state.members.length;
  const cConns = state.connections.length;
  const cAll = cTasks + cGroups + cMembers + cConns;
  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  set('ov-cnt-all', cAll);
  set('ov-cnt-tasks', cTasks);
  set('ov-cnt-groups', cGroups);
  set('ov-cnt-members', cMembers);
  set('ov-cnt-connections', cConns);

  // Render content per tab
  const content = document.getElementById('overview-content');
  if (!content) return;
  const q = (_overviewState.query || '').trim();
  // ใช้ searchMatches (เดียวกับ Connection search) — รองรับ:
  //  - direct substring + multi-word AND
  //  - abbreviation expansion (เช่น "ทอ" → "ทหารอากาศ")
  //  - case-insensitive
  // เนื้อหา haystack รวม "ทุก field ที่เกี่ยวข้องของ entity" ต่อกันด้วยช่องว่าง

  const sections = [];
  if (_overviewState.tab === 'all' || _overviewState.tab === 'tasks') {
    sections.push(_renderOverviewTasks(q));
  }
  if (_overviewState.tab === 'all' || _overviewState.tab === 'groups') {
    sections.push(_renderOverviewGroups(q));
  }
  if (_overviewState.tab === 'all' || _overviewState.tab === 'members') {
    sections.push(_renderOverviewMembers(q));
  }
  if (_overviewState.tab === 'all' || _overviewState.tab === 'connections') {
    sections.push(_renderOverviewConnections(q));
  }
  content.innerHTML = sections.filter(Boolean).join('') ||
    `<div class="text-center text-slate-400 py-12 text-sm">ไม่พบรายการที่ตรงกับ "${escapeHtml(q)}"</div>`;
  _wireOverviewActions();
  // Wire sort <select> ใน section headers
  content.querySelectorAll('[data-ov-control]').forEach(sel => {
    sel.onchange = (e) => {
      const key = sel.dataset.ovControl;
      _overviewState[key] = e.target.value;
      renderOverview();
    };
  });
  // Wire multi-filter dropdowns (checkbox popover)
  content.querySelectorAll('.ov-multifilter').forEach(mf => {
    const stateKey = mf.dataset.ovMf;
    const trigger = mf.querySelector('.ov-mf-trigger');
    const menu = mf.querySelector('.ov-mf-menu');
    trigger.onclick = (e) => {
      e.stopPropagation();
      // ปิด menu อื่นทั้งหมดก่อน
      content.querySelectorAll('.ov-mf-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
      menu.classList.toggle('hidden');
      trigger.setAttribute('aria-expanded', !menu.classList.contains('hidden'));
    };
    mf.querySelectorAll('input[type="checkbox"][data-mf-val]').forEach(cb => {
      cb.onchange = () => {
        const val = cb.dataset.mfVal;
        const cur = new Set(_overviewState[stateKey] || []);
        if (cb.checked) cur.add(val); else cur.delete(val);
        _overviewState[stateKey] = Array.from(cur);
        renderOverview();   // re-render — DOM ใหม่ ปุ่มจะ reset
      };
    });
    mf.querySelector('[data-mf-action="clear"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      _overviewState[stateKey] = [];
      renderOverview();
    });
  });
  // ปิด multi-filter เมื่อคลิกข้างนอก
  if (!_ovMfOutsideBound) {
    document.addEventListener('click', (e) => {
      if (e.target.closest('.ov-multifilter')) return;
      document.querySelectorAll('.ov-mf-menu').forEach(m => m.classList.add('hidden'));
    });
    _ovMfOutsideBound = true;
  }
  // Boss: Groups section ใช้ summary index — ต้อง wire click handlers (group card, claim, edit, archive)
  if (isBoss() && (_overviewState.tab === 'all' || _overviewState.tab === 'groups')) {
    wireSummaryIndex();
  }
}

// สร้าง haystack ของ task — รวมทุก field ที่เกี่ยวข้อง (รวม Thai status label, formatted budget)
function _taskHaystack(t) {
  const g = t.group_id ? groupById(t.group_id) : null;
  return [
    t.title, t.description, t.target,
    t.status, statusLabel(t.status),
    t.deadline ? fmtDate(t.deadline) : '', t.start_date,
    t.kind, isMeeting(t) ? 'meeting ประชุม' : 'task งาน',
    t.budget != null ? String(t.budget) : '',
    t.budget != null ? formatBudgetDisplay(t.budget) : '',
    t.budget != null ? formatBudgetDisplay(t.budget, { compact: true }) : '',
    t.points != null ? String(t.points) : '',
    g ? [g.name, g.description, g.target].join(' ') : '',
    (t.assignees || []).map(a => [a.name, a.email, a.phone].join(' ')).join(' '),
    (t.categories || []).map(c => c.name).join(' '),
    t.location_detail || '',
    // Connections ที่ผูกกับ group ของ task — ค้นด้วยชื่อ liaison/บริษัท/หน่วยงานก็ match task ที่อยู่ใน group นั้น
    _connNamesFromGroup(g),
  ].filter(Boolean).join(' ');
}
// Helper: คืนชื่อ connections (company + liaison) ที่ผูกกับ group เป็น string เดียว
function _connNamesFromGroup(g) {
  if (!g || !Array.isArray(g.connection_ids) || g.connection_ids.length === 0) return '';
  const byId = new Map(state.connections.map(c => [c.id, c]));
  return g.connection_ids.map(id => {
    const c = byId.get(id); if (!c) return '';
    return [c.company, c.contact_name, c.liaison_name, c.topics].filter(Boolean).join(' ');
  }).filter(Boolean).join(' ');
}
function _groupHaystack(g) {
  return [
    g.name, g.description, g.target,
    g.status, statusLabel(g.status),
    g.leader_name || '',
    g.deadline ? fmtDate(g.deadline) : '',
    g.start_date ? fmtDate(g.start_date) : '',
    g.color || '',
    g.folder_name || '',
    // Connections ของ group — ค้นด้วยชื่อบริษัท/lobbyist/หน่วยงาน หรือ liaison ก็เจอ group นี้
    _connNamesFromGroup(g),
  ].filter(Boolean).join(' ');
}
function _memberHaystack(m) {
  // Connections ที่ member นี้เป็น coordinator (kind=personal) — ค้นด้วยชื่อบริษัท
  // ก็เจอ member ที่ดูแลบริษัทนั้นได้
  const myConns = state.connections
    .filter(c => c.member_id === m.id && (c.kind || 'personal') === 'personal')
    .map(c => [c.company, c.contact_name].filter(Boolean).join(' '))
    .join(' ');
  return [
    m.prefix || '', m.name, m.email || '', m.phone || '',
    m.role,
    m.role === 'boss' ? 'หัวหน้า boss ผู้บริหารสูงสุด'
      : (m.role === 'admin' ? 'แอดมิน ผู้ดูแล admin' : 'สมาชิก member'),
    m.color || '',
    myConns,
  ].filter(Boolean).join(' ');
}
function _connectionHaystack(c) {
  const kindLbl = ({ personal: 'สมาชิก บริษัท ที่ปรึกษา personal',
                    agency: 'หน่วยงาน agency รัฐ', lobbyist: 'lobbyist บุคคลภายนอก' })[c.kind || 'personal'] || '';
  return [
    c.company, c.contact_name, c.contact_role,
    c.phone, c.email,
    c.liaison_name, c.topics, c.notes,
    c.kind, kindLbl,
    c.member_name || '',
  ].filter(Boolean).join(' ');
}

function _overviewSection(title, icon, count, html, controls = '') {
  return `
    <div class="overview-section">
      <div class="overview-section-header">
        <span class="text-base">${icon}</span>
        <h3 class="font-semibold text-sm">${escapeHtml(title)}</h3>
        <span class="text-[11px] text-slate-500">(${count})</span>
        ${controls ? `<div class="overview-section-controls">${controls}</div>` : ''}
      </div>
      ${html || '<div class="text-center text-xs text-slate-400 py-4 italic">— ไม่มีรายการ —</div>'}
    </div>`;
}

// Helper: build <select> สำหรับ sort (single value)
function _ovSelect(name, value, options) {
  const opts = options.map(([v, l]) => `<option value="${v}" ${v===value?'selected':''}>${escapeHtml(l)}</option>`).join('');
  return `<select class="ov-control" data-ov-control="${name}">${opts}</select>`;
}

// Helper: multi-select checkbox dropdown — สำหรับ filter ที่ tick ได้หลายค่า
//   name      = state key (เช่น 'taskFilter')
//   selected  = Array<string> ค่าที่ tick อยู่
//   options   = [['value','label'], ...]
//   labelTpl  = label เริ่มต้น (e.g. 'Status')
function _ovMultiFilter(name, selected, options, labelTpl) {
  const sel = new Set(selected || []);
  const summary = sel.size === 0 ? 'ทั้งหมด'
                : sel.size === 1 ? (options.find(([v]) => sel.has(v))?.[1] || '1 รายการ').replace(/^Status:\s*/, '').replace(/^Role:\s*/, '').replace(/^Type:\s*/, '')
                : `${sel.size} รายการ`;
  const items = options.map(([v, l]) => `
    <label class="ov-mf-item">
      <input type="checkbox" data-mf-val="${escapeHtml(v)}" ${sel.has(v)?'checked':''}>
      <span>${escapeHtml(l)}</span>
    </label>`).join('');
  return `
    <div class="ov-multifilter" data-ov-mf="${name}">
      <button type="button" class="ov-control ov-mf-trigger" aria-expanded="false">
        <span>${escapeHtml(labelTpl)}: <b>${escapeHtml(summary)}</b></span>
        <span class="ov-mf-caret">▾</span>
      </button>
      <div class="ov-mf-menu hidden">
        <div class="ov-mf-actions">
          <button type="button" class="ov-mf-action" data-mf-action="clear">ล้างทั้งหมด</button>
        </div>
        ${items}
      </div>
    </div>`;
}

function _renderOverviewTasks(q) {
  const all = state.tasks.filter(t => !isMeeting(t));
  // Multi-filter: empty array = all, otherwise filter by status in array
  const sf = _overviewState.taskFilter || [];
  let filtered = sf.length === 0 ? all.slice() : all.filter(t => sf.includes(t.status));
  // Apply search
  filtered = filtered.filter(t => !q || searchMatches(q, _taskHaystack(t)));
  // Apply sort — งาน priority (🔥 ด่วน → 🌅 เอาก่อนเช้า) ลอยบนสุดเสมอ แล้วค่อยเรียงตาม sort ที่เลือก
  const sortKey = _overviewState.taskSort;
  const prioRank = t => (t.priority === 'before_morning' ? 0 : t.priority === 'urgent' ? 1 : 2);
  filtered.sort((a, b) => {
    const pr = prioRank(a) - prioRank(b);
    if (pr !== 0) return pr;
    if (sortKey === 'deadline_asc')  return (a.deadline||'9999').localeCompare(b.deadline||'9999');
    if (sortKey === 'deadline_desc') return (b.deadline||'0').localeCompare(a.deadline||'0');
    if (sortKey === 'title')         return (a.title||'').localeCompare(b.title||'', 'th');
    if (sortKey === 'points_desc')   return (b.points||0) - (a.points||0);
    if (sortKey === 'status')        return (a.status||'').localeCompare(b.status||'');
    return 0;
  });
  const rows = filtered.map(t => {
    const g = groupById(t.group_id);
    const gColor = groupColor(t.group_id);
    const canEdit = canEditTask(t);
    const assignees = (t.assignees || []).slice(0, 3).map(a => escapeHtml(a.name)).join(', ') +
                      ((t.assignees || []).length > 3 ? ` +${t.assignees.length - 3}` : '');
    const dlCls = deadlineClass(t.deadline, t.status);
    return `
      <div class="ov-row ov-task-row" style="--group-color:${gColor}">
        <div class="ov-cell ov-title" data-task-detail="${t.id}">
          <div class="flex items-center gap-1.5 min-w-0"><span class="font-medium text-sm truncate min-w-0">${escapeHtml(t.title)}</span>${priorityBadgeHtml(t)}</div>
          ${g ? `<div class="text-[11px] text-slate-500 truncate">📁 ${escapeHtml(g.name)}</div>` : ''}
        </div>
        <div class="ov-cell ov-status">
          <span class="status-badge status-${t.status}">${statusLabel(t.status)}</span>
        </div>
        <div class="ov-cell ov-deadline ${dlCls}">
          ${t.deadline ? fmtDate(t.deadline) : '—'}
        </div>
        <div class="ov-cell ov-assignees text-xs text-slate-600 truncate" title="${escapeHtml((t.assignees||[]).map(a=>a.name).join(', '))}">${assignees || '—'}</div>
        <div class="ov-cell ov-budget text-xs">
          ${t.budget != null ? `💰 ${formatBudgetDisplay(t.budget)}` : ''}
        </div>
        <div class="ov-cell ov-actions">
          ${canEdit ? `<button class="ov-act-btn" data-ov-edit-task="${t.id}" title="แก้ไข">✏️</button>
                      <button class="ov-act-btn ov-act-danger" data-ov-del-task="${t.id}" title="ลบ">🗑️</button>` : ''}
        </div>
      </div>`;
  }).join('');
  const header = `
    <div class="ov-row ov-row-head">
      <div class="ov-cell ov-title">งาน / โครงการ</div>
      <div class="ov-cell ov-status">สถานะ</div>
      <div class="ov-cell ov-deadline">Deadline</div>
      <div class="ov-cell ov-assignees">ผู้รับผิดชอบ</div>
      <div class="ov-cell ov-budget">งบ</div>
      <div class="ov-cell ov-actions">⋯</div>
    </div>`;
  const controls = [
    _ovSelect('taskSort', _overviewState.taskSort, [
      ['deadline_asc',  'Sort: Deadline ↑'],
      ['deadline_desc', 'Sort: Deadline ↓'],
      ['title',         'Sort: ชื่อ'],
      ['points_desc',   'Sort: Points มาก→น้อย'],
      ['status',        'Sort: สถานะ'],
    ]),
    _ovMultiFilter('taskFilter', _overviewState.taskFilter, [
      ['in_progress', 'กำลังทำ'],
      ['completed',   'เสร็จ'],
      ['on_hold',     'พักไว้'],
      ['cancelled',   'ยกเลิก'],
    ], 'Status'),
  ].join('');
  return _overviewSection('Tasks', '📋', filtered.length, filtered.length ? header + rows : '', controls);
}

function _renderOverviewGroups(q) {
  // Boss-only: ใช้ Summary index content (group cards + stats per group) แทน table view
  // → boss เห็นภาพรวมโครงการละเอียดในที่เดียวกับ entities อื่น ๆ
  // (search query 'q' ใน Overview ไม่ apply ที่นี่ — boss ใช้ Summary UI เต็มรูปแบบ)
  if (isBoss()) {
    const total = state.groups.length;
    return _overviewSection('Groups (Summary)', '📁', total, renderSummaryIndex());
  }
  // Multi-filter group status
  const gf = _overviewState.groupFilter || [];
  let filtered = gf.length === 0 ? state.groups.slice() : state.groups.filter(g => gf.includes(g.status));
  // Apply search
  filtered = filtered.filter(g => !q || searchMatches(q, _groupHaystack(g)));
  // Apply sort
  const gSort = _overviewState.groupSort;
  filtered.sort((a, b) => {
    if (gSort === 'created_desc') return (b.created_at||'').localeCompare(a.created_at||'');
    if (gSort === 'created_asc')  return (a.created_at||'').localeCompare(b.created_at||'');
    if (gSort === 'name')         return (a.name||'').localeCompare(b.name||'', 'th');
    if (gSort === 'status')       return (a.status||'').localeCompare(b.status||'');
    if (gSort === 'deadline_asc') return (a.deadline||'9999').localeCompare(b.deadline||'9999');
    return 0;
  });
  const rows = filtered.map(g => {
    const gColor = groupColor(g);
    const tasksInG = state.tasks.filter(t => t.group_id === g.id).length;
    const canManage = isAdmin() || g.leader_id === state.user.id;
    return `
      <div class="ov-row ov-group-row" style="--group-color:${gColor}">
        <div class="ov-cell ov-title">
          <div class="font-medium text-sm truncate">📁 ${escapeHtml(g.name)}</div>
          ${g.target ? `<div class="text-[11px] text-slate-500 truncate">→ ${escapeHtml(g.target)}</div>` : ''}
        </div>
        <div class="ov-cell ov-status">
          <span class="status-badge status-${g.status}">${statusLabel(g.status)}</span>
        </div>
        <div class="ov-cell ov-leader text-xs text-slate-600 truncate">👑 ${escapeHtml(g.leader_name || '—')}</div>
        <div class="ov-cell ov-tasks-count text-xs">📋 ${tasksInG} tasks</div>
        <div class="ov-cell ov-deadline">${g.deadline ? fmtDate(g.deadline) : '—'}</div>
        <div class="ov-cell ov-actions">
          ${canManage ? `<button class="ov-act-btn" data-ov-edit-group="${g.id}" title="แก้ไข">✏️</button>
                        <button class="ov-act-btn" data-ov-archive-group="${g.id}" title="${g.status==='archived'?'กู้คืน':'เก็บ'}">${g.status==='archived'?'↩️':'📦'}</button>
                        <button class="ov-act-btn ov-act-danger" data-ov-del-group="${g.id}" title="ลบ">🗑️</button>` : ''}
        </div>
      </div>`;
  }).join('');
  const header = `
    <div class="ov-row ov-row-head">
      <div class="ov-cell ov-title">โครงการ</div>
      <div class="ov-cell ov-status">สถานะ</div>
      <div class="ov-cell ov-leader">หัวหน้า</div>
      <div class="ov-cell ov-tasks-count">งาน</div>
      <div class="ov-cell ov-deadline">Deadline</div>
      <div class="ov-cell ov-actions">⋯</div>
    </div>`;
  const controls = [
    _ovSelect('groupSort', _overviewState.groupSort, [
      ['created_desc', 'Sort: ใหม่สุด'],
      ['created_asc',  'Sort: เก่าสุด'],
      ['name',         'Sort: ชื่อ'],
      ['status',       'Sort: สถานะ'],
      ['deadline_asc', 'Sort: Deadline'],
    ]),
    _ovMultiFilter('groupFilter', _overviewState.groupFilter, [
      ['idea',             'คิดไอเดีย'],
      ['proposal',         'ทำ Proposal'],
      ['pending_approval', 'รออนุมัติ'],
      ['in_progress',      'กำลังทำ'],
      ['delivery',         'นำเสนอ/ส่งมอบ'],
      ['maintenance',      'Maintenance'],
      ['completed',        'เสร็จ'],
      ['on_hold',          'พักไว้'],
      ['cancelled',        'ยกเลิก'],
    ], 'Status'),
  ].join('');
  return _overviewSection('Groups', '📁', filtered.length, filtered.length ? header + rows : '', controls);
}

function _renderOverviewMembers(q) {
  // Multi-filter role
  const mf = _overviewState.memberFilter || [];
  let filtered = mf.length === 0 ? state.members.slice() : state.members.filter(m => mf.includes(m.role));
  // Multi-filter by group — เก็บ members ที่อยู่ใน groups ที่ tick
  const gf = _overviewState.memberGroupFilter || [];
  if (gf.length > 0) {
    // หา member_ids ของ groups เหล่านั้น (รวม leader + group_members)
    const allowed = new Set();
    for (const g of state.groups) {
      if (!gf.includes(g.id)) continue;
      if (g.leader_id) allowed.add(g.leader_id);
      // assignees ของ tasks ใน group นั้น ก็ถือว่าอยู่ใน group ด้วย
      for (const t of state.tasks.filter(t => t.group_id === g.id)) {
        for (const a of (t.assignees || [])) allowed.add(a.id);
      }
    }
    filtered = filtered.filter(m => allowed.has(m.id));
  }
  // Search
  filtered = filtered.filter(m => !q || searchMatches(q, _memberHaystack(m)));
  // Sort
  const sb = state.stats?.scoreboard || [];
  const ptsOf = (id) => (sb.find(s => s.member?.id === id)?.points || 0);
  const mSort = _overviewState.memberSort;
  filtered.sort((a, b) => {
    if (mSort === 'points_desc') return ptsOf(b.id) - ptsOf(a.id);
    if (mSort === 'name')        return (a.name||'').localeCompare(b.name||'', 'th');
    if (mSort === 'role')        return (a.role||'').localeCompare(b.role||'');   // boss/admin/member
    return 0;
  });
  const rows = filtered.map(m => {
    const myTasks = state.tasks.filter(t => (t.assignees || []).some(a => a.id === m.id));
    const completed = myTasks.filter(t => t.status === 'completed').length;
    const pts = (state.stats?.scoreboard || []).find(s => s.member?.id === m.id)?.points || 0;
    const isMe = m.id === state.user?.id;
    const canEdit = isAdmin();
    const avatar = m.avatar_url
      ? `<img src="${escapeHtml(m.avatar_url)}" class="ov-avatar" alt="">`
      : `<span class="ov-avatar" style="background:${escapeHtml(m.color || '#6366f1')}">${escapeHtml(initials(m.name))}</span>`;
    return `
      <div class="ov-row ov-member-row">
        <div class="ov-cell ov-title">
          ${avatar}
          <span class="font-medium text-sm truncate">${escapeHtml(m.name)}${isMe ? ' <span class="text-[10px] text-indigo-600">(คุณ)</span>' : ''}</span>
        </div>
        <div class="ov-cell ov-status">
          <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${m.role==='boss'?'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-400':(m.role==='admin'?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600')}">${m.role}</span>
        </div>
        <div class="ov-cell text-xs text-slate-600 truncate">${escapeHtml(m.email || '')}</div>
        <div class="ov-cell text-xs">📋 ${myTasks.length}</div>
        <div class="ov-cell text-xs">⭐ ${pts}</div>
        <div class="ov-cell ov-actions">
          ${canEdit ? `<button class="ov-act-btn" data-ov-edit-member="${m.id}" title="แก้ไข">✏️</button>
                      ${!isMe ? `<button class="ov-act-btn ov-act-danger" data-ov-del-member="${m.id}" title="ลบ">🗑️</button>` : ''}` : ''}
        </div>
      </div>`;
  }).join('');
  const header = `
    <div class="ov-row ov-row-head">
      <div class="ov-cell ov-title">สมาชิก</div>
      <div class="ov-cell ov-status">บทบาท</div>
      <div class="ov-cell">อีเมล</div>
      <div class="ov-cell">งาน</div>
      <div class="ov-cell">Points</div>
      <div class="ov-cell ov-actions">⋯</div>
    </div>`;
  // Group options สำหรับ filter — เรียงตามชื่อ
  const groupOpts = state.groups
    .slice().sort((a,b) => (a.name||'').localeCompare(b.name||'', 'th'))
    .map(g => [g.id, g.name]);
  const controls = [
    _ovSelect('memberSort', _overviewState.memberSort, [
      ['role',        'Sort: บทบาท (Boss/Admin/Member)'],
      ['points_desc', 'Sort: Points มาก→น้อย'],
      ['name',        'Sort: ชื่อ'],
    ]),
    _ovMultiFilter('memberFilter', _overviewState.memberFilter, [
      ['boss',   'Boss'],
      ['admin',  'Admin'],
      ['member', 'Member'],
    ], 'Role'),
    _ovMultiFilter('memberGroupFilter', _overviewState.memberGroupFilter, groupOpts, 'Group'),
  ].join('');
  return _overviewSection('Members', '👥', filtered.length, filtered.length ? header + rows : '', controls);
}

function _renderOverviewConnections(q) {
  // Multi-filter kind
  const cf = _overviewState.connFilter || [];
  let filtered = cf.length === 0
    ? state.connections.slice()
    : state.connections.filter(c => cf.includes(c.kind || 'personal'));
  filtered = filtered.filter(c => !q || searchMatches(q, _connectionHaystack(c)));
  // Sort
  const cSort = _overviewState.connSort;
  const nameOf = (c) => c.kind === 'lobbyist' ? (c.liaison_name || c.company || '')
                     : c.kind === 'agency' ? (c.company || c.liaison_name || '')
                     : (c.company || '');
  filtered.sort((a, b) => {
    if (cSort === 'name') return nameOf(a).localeCompare(nameOf(b), 'th');
    if (cSort === 'kind') return (a.kind||'').localeCompare(b.kind||'');
    return 0;
  });
  const kindLabel = (k) => ({
    personal: '🏢 บริษัท',
    lobbyist: '🎯 Lobbyist',
    agency:   '🏛️ หน่วยงาน',
  })[k] || k;
  const kindBadge = (k) => ({
    personal: 'bg-indigo-100 text-indigo-700',
    lobbyist: 'bg-amber-100 text-amber-700',
    agency:   'bg-violet-100 text-violet-700',
  })[k] || 'bg-slate-100 text-slate-700';
  const rows = filtered.map(c => {
    const canEdit = isAdmin() || c.member_id === state.user?.id;
    // Title + subtitle ปรับตาม kind:
    //   - บริษัท (personal): title = company, sub = contact_name + role
    //   - Lobbyist: title = liaison_name (คนๆนั้น), sub = contact_role
    //   - หน่วยงาน (agency): title = company (หน่วยงาน), sub = liaison_name + role
    let title = c.company || '—';
    let sub = '';
    if (c.kind === 'lobbyist') {
      title = c.liaison_name || c.company || '—';
      sub = c.contact_role || '';
    } else if (c.kind === 'agency') {
      title = c.company || '—';
      sub = [c.liaison_name, c.contact_role].filter(Boolean).join(' · ');
    } else {
      sub = [c.contact_name, c.contact_role].filter(Boolean).join(' · ');
    }
    return `
      <div class="ov-row ov-conn-row">
        <div class="ov-cell ov-title">
          <div class="font-medium text-sm truncate">${escapeHtml(title)}</div>
          ${sub ? `<div class="text-[11px] text-slate-500 truncate">${escapeHtml(sub)}</div>` : ''}
        </div>
        <div class="ov-cell ov-status">
          <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${kindBadge(c.kind || 'personal')}">${kindLabel(c.kind || 'personal')}</span>
        </div>
        <div class="ov-cell text-xs truncate">${escapeHtml(c.phone || '')}</div>
        <div class="ov-cell text-xs text-slate-500 truncate">${escapeHtml(c.email || '')}</div>
        <div class="ov-cell text-xs text-slate-500 truncate">${c.kind === 'personal' ? 'โดย: ' + escapeHtml(c.member_name || '?') : ''}</div>
        <div class="ov-cell ov-actions">
          ${canEdit ? `<button class="ov-act-btn" data-ov-edit-conn="${c.id}" title="แก้ไข">✏️</button>
                      <button class="ov-act-btn ov-act-danger" data-ov-del-conn="${c.id}" title="ลบ">🗑️</button>` : ''}
        </div>
      </div>`;
  }).join('');
  const header = `
    <div class="ov-row ov-row-head">
      <div class="ov-cell ov-title">ชื่อ / หน่วยงาน</div>
      <div class="ov-cell ov-status">ประเภท</div>
      <div class="ov-cell">โทร</div>
      <div class="ov-cell">อีเมล</div>
      <div class="ov-cell">เจ้าของ</div>
      <div class="ov-cell ov-actions">⋯</div>
    </div>`;
  const controls = [
    _ovSelect('connSort', _overviewState.connSort, [
      ['name', 'Sort: ชื่อ'],
      ['kind', 'Sort: ประเภท'],
    ]),
    _ovMultiFilter('connFilter', _overviewState.connFilter, [
      ['personal', 'บริษัท'],
      ['lobbyist', 'Lobbyist'],
      ['agency',   'หน่วยงาน'],
    ], 'Type'),
  ].join('');
  return _overviewSection('Connections', '🤝', filtered.length, filtered.length ? header + rows : '', controls);
}

// Wire CRUD actions ใน overview rows — ใช้ modal/handler เดิมจาก task/group/member/conn pages
function _wireOverviewActions() {
  const root = document.getElementById('overview-content');
  if (!root) return;
  // Task actions
  root.querySelectorAll('[data-ov-edit-task]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const t = state.tasks.find(x => x.id === b.dataset.ovEditTask);
    if (t) openTaskEdit(t);
  });
  root.querySelectorAll('[data-ov-del-task]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const t = state.tasks.find(x => x.id === b.dataset.ovDelTask);
    if (!t) return;
    if (!(await uiConfirm(`ลบงาน "${t.title}"?\nย้ายไปถังขยะ — กู้คืนได้ใน 30 วัน`))) return;
    try { await api.del('/api/tasks/' + t.id); toast('ลบแล้ว', 'success'); await loadAll(); }
    catch (err) { toast(err.message, 'error'); }
  });
  // Title click → open detail sheet
  root.querySelectorAll('[data-task-detail]').forEach(b => b.onclick = () => openTaskSheet(b.dataset.taskDetail));
  // Group actions
  root.querySelectorAll('[data-ov-edit-group]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const g = groupById(b.dataset.ovEditGroup);
    if (g) openGroupModal(g);
  });
  root.querySelectorAll('[data-ov-archive-group]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const g = groupById(b.dataset.ovArchiveGroup);
    if (!g) return;
    const isArch = g.status === 'archived';
    const newStatus = isArch ? 'in_progress' : 'archived';
    try {
      await api.put('/api/groups/' + g.id, { status: newStatus });
      toast(isArch ? 'กู้คืนแล้ว' : 'เก็บแล้ว 📦', 'success');
      await loadAll();
    } catch (err) { toast(err.message, 'error'); }
  });
  root.querySelectorAll('[data-ov-del-group]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const g = groupById(b.dataset.ovDelGroup);
    if (!g) return;
    if (!(await uiConfirm(`ลบโครงการ "${g.name}"?\n⚠️ จะลบ task ทั้งหมดในกลุ่มด้วย — กู้คืนไม่ได้`, { danger: true, okLabel: 'ลบถาวร' }))) return;
    try { await api.del('/api/groups/' + g.id); toast('ลบแล้ว', 'success'); await loadAll(); }
    catch (err) { toast(err.message, 'error'); }
  });
  // Member actions
  root.querySelectorAll('[data-ov-edit-member]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const m = memberById(b.dataset.ovEditMember);
    if (m) openMemberModal(m);
  });
  root.querySelectorAll('[data-ov-del-member]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const m = memberById(b.dataset.ovDelMember);
    if (!m) return;
    if (!(await uiConfirm(`ลบสมาชิก "${m.name}"?`, { danger: true }))) return;
    try { await api.del('/api/members/' + m.id); toast('ลบแล้ว', 'success'); await loadAll(); }
    catch (err) { toast(err.message, 'error'); }
  });
  // Connection actions
  root.querySelectorAll('[data-ov-edit-conn]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const c = state.connections.find(x => x.id === b.dataset.ovEditConn);
    if (c) openConnectionModal(c);
  });
  root.querySelectorAll('[data-ov-del-conn]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const c = state.connections.find(x => x.id === b.dataset.ovDelConn);
    if (!c) return;
    if (!(await uiConfirm(`ลบ "${c.company}"?`, { danger: true }))) return;
    try { await api.del('/api/connections/' + c.id); toast('ลบแล้ว', 'success'); await loadAll(); }
    catch (err) { toast(err.message, 'error'); }
  });
}

// Wire toolbar: search input + tab switching (ครั้งเดียวตอน DOMContentLoaded)
(function wireOverviewToolbar() {
  const search = document.getElementById('overview-search');
  const clear = document.getElementById('overview-search-clear');
  if (search) {
    search.addEventListener('input', () => {
      _overviewState.query = search.value;
      if (clear) clear.style.display = search.value ? '' : 'none';
      if (state.currentTab === 'overview') renderOverview();
    });
  }
  if (clear) {
    clear.onclick = () => {
      if (!search) return;
      search.value = ''; _overviewState.query = '';
      clear.style.display = 'none';
      if (state.currentTab === 'overview') renderOverview();
    };
  }
  document.querySelectorAll('.overview-tab').forEach(b => {
    b.onclick = () => {
      _overviewState.tab = b.dataset.overviewTab;
      document.querySelectorAll('.overview-tab').forEach(x => x.classList.toggle('active', x === b));
      if (state.currentTab === 'overview') renderOverview();
    };
  });
})();

function renderSummaryDetail(g, groupMembers = []) {
  const tasks = state.tasks.filter(t => t.group_id === g.id);
  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const pct = total ? Math.round(completed / total * 100) : 0;
  // No upfront budget concept — Points are earned only after completion + workflow.
  const earned = tasks.reduce((s, t) => s + (t.status === 'completed' ? earnedPoints(t) : 0), 0);
  const filesInGroup = state.files.filter(f => f.group_id === g.id);

  const iAmInGroup = groupMembers.some(m => m.id === state.user.id);
  const iAmLeader  = g.leader_id === state.user.id;
  const canManage  = isAdmin() || iAmLeader;
  const myPendingPropose = state.groupInvitations.find(i =>
    i.group_id === g.id && i.member_id === state.user.id && i.kind === 'proposal' && i.status === 'pending');

  // Per-member contribution stats (for those with task participation)
  const memberStats = new Map();
  for (const m of groupMembers) memberStats.set(m.id, { member: m, tasks: 0, completed: 0, points: 0 });
  for (const t of tasks) {
    for (const a of (t.assignees || [])) {
      if (!memberStats.has(a.id)) memberStats.set(a.id, { member: a, tasks: 0, completed: 0, points: 0 });
      const s = memberStats.get(a.id);
      s.tasks++;
      if (t.status === 'completed') {
        s.completed++;
        s.points += a.points_share || 0;
      }
    }
  }
  const memberList = Array.from(memberStats.values()).sort((a, b) => b.points - a.points);

  const tasksHtml = tasks.length === 0
    ? `<div class="text-sm text-slate-400 text-center py-4 italic">ยังไม่มีงานในกลุ่มนี้</div>`
    : tasks.map(t => {
        const fcount = state.files.filter(f => f.task_id === t.id).length;
        const dlCls = deadlineClass(t.deadline, t.status);
        // ตั้ง --group-color + border-left-color inline เหมือนตอน render ใน kanban
        // เพื่อให้ stripe ซ้ายเป็นสีของกลุ่ม (ไม่ใช่เทา default)
        const tColor = groupColor(t.group_id);
        return `
          <button class="task-card w-full text-left block ${isMyTask(t)?'is-mine':''}" data-task-detail="${t.id}"
                  style="--group-color:${tColor}; border-left-color:${tColor}">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="font-medium text-[14px] leading-snug">${escapeHtml(t.title)}</div>
                <div class="flex flex-wrap gap-1.5 mt-1 items-center">
                  ${priorityBadgeHtml(t)}
                  <span class="status-badge status-${t.status}">${statusLabel(t.status)}</span>
                  ${fcount > 0 ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">📎 ${fcount} ไฟล์ · ส่งแล้ว ✓</span>` : ''}
                  ${pointsPillHtml(t)}
                  ${t.target ? `<span class="target-chip">→ ${escapeHtml(t.target)}</span>` : ''}
                </div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-[11px] ${dlCls} mb-1">${t.deadline ? '⏰ '+deadlineText(t.deadline, t.status) : ''}</div>
                <div class="flex items-center justify-end gap-1.5">
                  ${isMyTask(t) ? `<span class="text-[10px] text-indigo-600 font-semibold">• ของคุณ</span>` : ''}
                  ${assigneeStack(t.assignees)}
                </div>
              </div>
            </div>
          </button>`;
      }).join('');

  const filesHtml = filesInGroup.length === 0
    ? `<div class="empty-folder">— ยังไม่มีไฟล์ในโฟลเดอร์ของกลุ่มนี้ —</div>`
    : filesInGroup.map(fileRowHtml).join('');

  const leaderMember = g.leader_id ? memberById(g.leader_id) : null;
  const leaderStats = g.leader_id ? memberStats.get(g.leader_id) : null;

  return `
    <div class="flex items-center justify-between mb-3">
      <button class="text-indigo-600 text-sm font-medium" id="summary-back">‹ กลับไปยังรายชื่อกลุ่ม</button>
      <div class="flex items-center gap-2">
        ${canManage ? `<button class="ios-btn-ghost text-xs" id="summary-edit-group">✏️ แก้ไขโครงการ</button>` : ''}
        <button class="ios-btn-ghost text-xs" id="summary-export">📥 Export CSV</button>
      </div>
    </div>
    <div class="text-white rounded-2xl p-4 ios-card mb-4 shadow-md"
         style="background: linear-gradient(135deg, ${groupColor(g.id)}, color-mix(in srgb, ${groupColor(g.id)} 55%, #0f172a));">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-xs opacity-80">📁 กลุ่มงาน</div>
          <div class="text-xl font-semibold leading-tight">${escapeHtml(g.name)}</div>
        </div>
        <span class="status-badge" style="background:rgba(255,255,255,0.25); color:#fff">${statusLabel(g.status)}</span>
      </div>
      ${g.description ? `<div class="text-xs opacity-90 mt-1.5">${escapeHtml(g.description)}</div>` : ''}
      <div class="flex flex-wrap gap-3 mt-3 text-xs opacity-90">
        <span>📅 ${fmtDate(g.start_date)}</span>
        <span>⏰ ${fmtDate(g.deadline)}</span>
        <span>📋 ${total} งาน</span>
        <span>📎 ${filesInGroup.length} ไฟล์</span>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-2 mb-4">
      <div class="ios-stat-card" style="padding:.6rem .75rem"><div><div class="ios-stat-label">เสร็จ</div><div class="ios-stat-value text-emerald-600">${completed}/${total}</div><div class="text-[10px] text-slate-500">${pct}%</div></div></div>
      <div class="ios-stat-card" style="padding:.6rem .75rem"><div><div class="ios-stat-label">Points</div><div class="ios-stat-value text-amber-600">${earned}</div></div></div>
      <div class="ios-stat-card" style="padding:.6rem .75rem"><div><div class="ios-stat-label">สมาชิก</div><div class="ios-stat-value">${memberList.length}</div></div></div>
    </div>

    ${(!iAmInGroup && !isAdmin()) ? (
      g.leader_id
        ? (myPendingPropose
            ? `<div class="text-center text-sm text-amber-700 bg-amber-50 rounded-xl py-2.5 mb-3">⏳ รอหัวหน้ากลุ่มพิจารณา…</div>`
            : `<button id="propose-group-btn" class="ios-btn-primary w-full mb-3">🙋 เสนอตัวเข้ากลุ่มนี้</button>`)
        : `<button id="claim-group-btn" class="ios-btn-primary w-full mb-3">✋ หยิบกลุ่มนี้ — เป็นหัวหน้า</button>`
    ) : ''}

    ${(() => {
      // Section: Connection ที่ผูกกับ group นี้ — group by kind
      const cIds = new Set(g.connection_ids || []);
      if (cIds.size === 0) return '';
      const conns = state.connections.filter(c => cIds.has(c.id));
      const byKind = { personal: [], lobbyist: [], agency: [] };
      for (const c of conns) (byKind[c.kind || 'personal'] || byKind.personal).push(c);
      const kindMeta = {
        personal: { icon: '🏢', label: 'บริษัท' },
        lobbyist: { icon: '🎯', label: 'Lobbyist' },
        agency:   { icon: '🏛️', label: 'หน่วยงาน' },
      };
      const subLabel = (c) => {
        if (c.kind === 'lobbyist') return c.liaison_name || c.company;
        if (c.kind === 'agency')   return `${c.company}${c.liaison_name ? ' · ' + c.liaison_name : ''}`;
        return `${c.company}${c.member_name ? ' · ' + c.member_name : ''}`;
      };
      const renderGroup = (kind) => {
        const list = byKind[kind] || [];
        if (list.length === 0) return '';
        const m = kindMeta[kind];
        const chips = list.map(c => `
          <button type="button" class="conn-link-chip" data-conn-open="${c.id}" title="${escapeHtml(subLabel(c))}">
            <span class="conn-link-chip-icon">${m.icon}</span>
            <span class="conn-link-chip-text">${escapeHtml(subLabel(c))}</span>
          </button>`).join('');
        return `<div class="conn-link-kind">
          <div class="conn-link-kind-label">${m.icon} ${m.label} <span class="text-[11px] text-slate-400 font-normal">· ${list.length}</span></div>
          <div class="conn-link-chips">${chips}</div>
        </div>`;
      };
      return `
        <div class="bg-white rounded-2xl ios-card overflow-hidden mb-4">
          <div class="px-4 pt-3 pb-2">
            <div class="font-semibold">🤝 Connection ที่เกี่ยวข้อง <span class="text-[11px] text-slate-500 font-normal">(${conns.length})</span></div>
          </div>
          <div class="px-4 pb-3 space-y-2">
            ${renderGroup('personal')}
            ${renderGroup('lobbyist')}
            ${renderGroup('agency')}
          </div>
        </div>`;
    })()}

    <div class="bg-white rounded-2xl ios-card overflow-hidden mb-4">
      <div class="px-4 pt-3 pb-2 flex items-center justify-between">
        <div class="font-semibold">👥 สมาชิกกลุ่ม <span class="text-[11px] text-slate-500 font-normal">(${groupMembers.length})</span></div>
        ${canManage ? `<button class="ios-btn-secondary text-xs" id="invite-group-btn">+ เพิ่มสมาชิก</button>` : ''}
      </div>
      ${leaderMember ? `
        <div class="ios-list-row" style="background:#fef9c3">
          ${avatarHtml(leaderMember, 32)}
          <div class="flex-1 min-w-0 pl-2">
            <div class="text-sm font-medium truncate">${escapeHtml(leaderMember.name)}</div>
            <div class="text-[10px] text-amber-700 font-semibold">
              👑 หัวหน้ากลุ่ม${leaderStats ? ` · ${leaderStats.points} pts · ${leaderStats.tasks} งาน` : ''}
            </div>
          </div>
        </div>` : ''}
      ${groupMembers.filter(m => m.id !== g.leader_id).map(m => {
        const s = memberStats.get(m.id) || { tasks:0, completed:0, points:0 };
        const isMe = m.id === state.user.id;
        return `
          <div class="ios-list-row">
            ${avatarHtml(m, 32)}
            <div class="flex-1 min-w-0 pl-2">
              <div class="text-sm truncate">${escapeHtml(m.name)}${isMe?' <span class="text-[10px] text-indigo-600">(คุณ)</span>':''}</div>
              <div class="text-[10px] text-slate-500">${s.points} pts · ${s.tasks} งาน</div>
            </div>
            ${(canManage && !isMe) || isMe ? `<button class="text-rose-500 text-[11px]" data-remove-from-group="${m.id}">${isMe?'ออกจากกลุ่ม':'นำออก'}</button>` : ''}
          </div>`;
      }).join('')}
      ${groupMembers.length === 0 ? `<div class="p-4 text-sm text-slate-400 text-center">ยังไม่มีสมาชิกในกลุ่ม</div>` : ''}
    </div>

    <div class="bg-white rounded-2xl ios-card overflow-hidden mb-4">
      <div class="px-4 pt-3 pb-2 flex items-center justify-between">
        <div class="font-semibold">📋 งานทั้งหมด <span class="text-[11px] text-slate-500 font-normal">(${total})</span></div>
        ${(isAdmin() || g.leader_id === state.user.id) ? `<button class="ios-btn-secondary text-xs" id="summary-add-task">＋ เพิ่มงาน</button>` : ''}
      </div>
      <div class="px-3 pb-3 space-y-2">
        ${tasksHtml}
      </div>
      <div class="px-4 pb-3 text-[11px] text-slate-500 italic">💡 อัปโหลดไฟล์ให้งาน → ระบบจะถือว่างานนั้นเสร็จสิ้นโดยอัตโนมัติ</div>
    </div>

    <div class="bg-white rounded-2xl ios-card overflow-hidden">
      <div class="px-4 pt-3 pb-2 font-semibold">📂 โฟลเดอร์ไฟล์ของกลุ่ม <span class="text-[11px] text-slate-500 font-normal">(${filesInGroup.length})</span></div>
      <div class="px-3 pb-3 space-y-1.5">
        ${filesHtml}
      </div>
    </div>

    <!-- Auto-generated markdown summary of this group -->
    <div class="bg-white rounded-2xl ios-card overflow-hidden" id="group-summary-card" data-group-id="${escapeHtml(g.id)}">
      <div class="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <span class="font-semibold">📄 สรุปกลุ่มอัตโนมัติ <span class="text-[11px] text-slate-500 font-normal" id="group-summary-meta"></span></span>
        <div class="flex gap-2">
          <button class="text-xs text-indigo-600" id="group-summary-regen">🔄 สร้าง/อัปเดต</button>
          <button class="text-xs text-slate-500" id="group-summary-download">⬇ .md</button>
        </div>
      </div>
      <pre id="group-summary-pre" class="px-4 pb-3 text-xs text-slate-700 whitespace-pre-wrap font-mono overflow-auto" style="max-height:420px;line-height:1.55">— ยังไม่ได้สร้างสรุป — กด <b>🔄 สร้าง/อัปเดต</b></pre>
    </div>
  `;
  loadGroupSummary(g.id);
}

function wireSummaryDetail(g, groupMembers = []) {
  const back = document.getElementById('summary-back');
  if (back) back.onclick = () => gotoSummaryGroup(null);
  const addBtn = document.getElementById('summary-add-task');
  if (addBtn) addBtn.onclick = () => openMultiTaskModal(g.id);
  const exportBtn = document.getElementById('summary-export');
  if (exportBtn) exportBtn.onclick = () => exportGroupCsv(g);
  const editBtn = document.getElementById('summary-edit-group');
  if (editBtn) editBtn.onclick = () => openGroupModal(g, () => renderSummary());

  const inviteBtn = document.getElementById('invite-group-btn');
  if (inviteBtn) inviteBtn.onclick = () => openInviteToGroupModal(g);
  const proposeBtn = document.getElementById('propose-group-btn');
  if (proposeBtn) proposeBtn.onclick = () => openProposeGroupModal(g);
  const claimBtn = document.getElementById('claim-group-btn');
  if (claimBtn) claimBtn.onclick = async () => {
    if (!(await uiConfirm(`รับเป็นหัวหน้ากลุ่ม "${g.name}"?`))) return;
    try { await api.post('/api/groups/' + g.id + '/claim'); toast('คุณเป็นหัวหน้ากลุ่มแล้ว 👑', 'success'); await loadAll(); renderSummary(); }
    catch (err) { toast(err.message, 'error'); }
  };
  document.querySelectorAll('[data-remove-from-group]').forEach(b => {
    b.onclick = async () => {
      const isSelf = b.dataset.removeFromGroup === state.user.id;
      if (!(await uiConfirm(isSelf ? 'ออกจากกลุ่มนี้?' : 'นำสมาชิกออกจากกลุ่ม?'))) return;
      try { await api.del('/api/groups/' + g.id + '/members/' + b.dataset.removeFromGroup); toast(isSelf?'ออกจากกลุ่มแล้ว':'นำออกแล้ว', 'success'); await loadAll(); renderSummary(); }
      catch (err) { toast(err.message, 'error'); }
    };
  });
}

async function exportGroupCsv(g) {
  try {
    const res = await fetch('/api/groups/' + g.id + '/export.csv', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (g.name || 'export').replace(/[^\w฀-๿.\- ]+/g, '_') + '_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Export สำเร็จ', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// File fuzzy score still useful elsewhere — keep export available
function fileFuzzyScore(q, f) {
  if (!q) return 1;
  const query = q.toLowerCase();
  const haystack = [f.original_name, f.filename, f.task_title, f.group_name, f.uploader_name, f.mimetype]
    .filter(Boolean).join(' ').toLowerCase();
  if (haystack.includes(query)) return 1000;
  const words = query.split(/\s+/).filter(Boolean);
  let hits = 0;
  for (const w of words) if (haystack.includes(w)) hits++;
  if (hits) return 500 + hits * 50;
  const bg = s => { const o = new Set(); for (let i=0;i<s.length-1;i++) o.add(s.slice(i,i+2)); return o; };
  const a = bg(query), b = bg(haystack);
  let overlap = 0; for (const x of a) if (b.has(x)) overlap++;
  if (a.size > 0 && overlap / a.size < 0.5) return 0;
  return overlap;
}

function fileRowHtml(f) {
  const ext = (f.original_name.split('.').pop()||'').toLowerCase();
  const previewable = isPreviewable(f.original_name, f.mimetype);
  const dataAttrs = `data-preview-file="${f.id}" data-preview-name="${escapeHtml(f.original_name)}" data-preview-mime="${escapeHtml(f.mimetype||'')}"`;
  const canDelete = isAdmin() || f.uploaded_by === state.user.id;
  return `
    <div class="file-row">
      <button class="file-icon" ${dataAttrs} title="ดูตัวอย่าง" style="border:0; cursor:pointer">${ext.slice(0,4).toUpperCase() || 'FILE'}</button>
      <button class="min-w-0 flex-1 text-left bg-transparent" ${dataAttrs}>
        <div class="font-medium truncate">${escapeHtml(f.original_name)}</div>
        <div class="text-[10px] text-slate-500 truncate">${fmtSize(f.size)} · 📋 ${escapeHtml(f.task_title||'?')} · 👤 ${escapeHtml(f.uploader_name||'?')} · ${fmtDate(f.uploaded_at)}</div>
      </button>
      ${previewable ? `<button class="ios-btn-ghost text-xs" ${dataAttrs} title="เปิดดูในระบบ">👁</button>` : ''}
      <button class="ios-btn-ghost text-xs" data-download-file="${f.id}" title="ดาวน์โหลด">⬇</button>
      <button class="ios-btn-ghost text-xs" data-task-detail="${f.task_id}" title="เปิดงาน">→</button>
      ${canDelete ? `<button class="text-rose-500 text-xs" data-delete-file-global="${f.id}" title="ลบ">✕</button>` : ''}
    </div>`;
}

// Global handlers (work for Files page AND task sheet)
document.body.addEventListener('click', e => {
  const pv = e.target.closest('[data-preview-file]');
  if (pv) {
    e.preventDefault();
    openPreview(pv.dataset.previewFile, pv.dataset.previewName, pv.dataset.previewMime);
  }
});
document.body.addEventListener('click', async e => {
  const dl = e.target.closest('[data-download-file]');
  if (!dl) return;
  e.preventDefault();
  try {
    const res = await fetch('/api/files/' + dl.dataset.downloadFile + '/download', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const row = dl.closest('.file-row');
    link.download = row?.querySelector('.font-medium')?.textContent || 'file';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { toast(err.message, 'error'); }
});
document.body.addEventListener('click', async e => {
  const del = e.target.closest('[data-delete-file-global]');
  if (!del) return;
  if (!(await uiConfirm('ลบไฟล์นี้?'))) return;
  // Optimistic UI: remove the row immediately so the user sees instant feedback.
  const row = del.closest('.file-row');
  if (row) row.style.opacity = '0.4';
  try {
    await api.del('/api/files/' + del.dataset.deleteFileGlobal);
    if (row) row.remove();
    toast('ลบแล้ว', 'success');
    // Re-render whichever sheet is open so file counts / empty-state update.
    // Submission sheet refresh is needed for the "(N)" total + "ยังไม่มีการส่งงาน"
    // empty state to flip; task sheet also re-renders to drop the file from the
    // attachments section.
    if (state.openSubmitTaskId) await openSubmissionSheet(state.openSubmitTaskId);
    else if (state.openTaskId)   await openTaskSheet(state.openTaskId);
    await loadAll();
  } catch (err) {
    // Restore opacity if the delete failed so the user can retry
    if (row) row.style.opacity = '';
    toast(err.message, 'error');
  }
});

// ============== Notifications ==============
function buildNotifications() {
  const out = [];
  const myTasks = state.tasks.filter(t => t.assignees.some(a => a.id === state.user.id));
  const today = new Date(); today.setHours(0,0,0,0);
  const nowIso = new Date().toISOString();

  // 1. My overdue/upcoming tasks — ts = deadline (เหตุการณ์เกิดที่ deadline)
  for (const t of myTasks) {
    if (!t.deadline || t.status === 'completed' || t.status === 'cancelled') continue;
    const d = new Date(t.deadline); d.setHours(0,0,0,0);
    const days = Math.ceil((d - today) / (1000*60*60*24));
    const ts = t.deadline;
    if (days < 0) {
      out.push({ kind:'overdue', icon:'⚠️', title:`เลย Deadline แล้ว ${Math.abs(days)} วัน`, text: t.title, taskId: t.id, ts });
    } else if (days === 0) {
      out.push({ kind:'soon', icon:'⏰', title:`Deadline วันนี้`, text: t.title, taskId: t.id, ts });
    } else if (days <= 3) {
      out.push({ kind:'soon', icon:'⏰', title:`Deadline อีก ${days} วัน`, text: t.title, taskId: t.id, ts });
    }
  }
  // 2. Open tasks in groups I lead — ts = task created_at
  for (const g of state.groups.filter(g => g.leader_id === state.user.id)) {
    const open = state.tasks.filter(t => t.group_id === g.id && !t.assignees.length && t.status !== 'completed' && t.status !== 'cancelled');
    for (const t of open) {
      out.push({ kind:'info', icon:'🪪', title:`งานว่างในกลุ่มของคุณ — "${g.name}"`, text: t.title, taskId: t.id, ts: t.created_at || nowIso });
    }
  }
  // 3. Pending deadline requests (admin only)
  if (isAdmin()) {
    for (const r of state.extensions.filter(r => r.status === 'pending')) {
      out.push({ kind:'info', icon:'⏰', title:`คำขอเลื่อน deadline จาก ${r.requester_name||'?'}`, text: `${r.task_title} → ${fmtDate(r.requested_deadline)}`, extId: r.id, ts: r.created_at || nowIso });
    }
  }
  // 3b. Pending POINT requests (admin only)
  if (isAdmin()) {
    for (const r of state.pointRequests.filter(r => r.status === 'pending')) {
      out.push({ kind:'info', icon:'💎', title:`คำขอเพิ่ม Points จาก ${r.requester_name||'?'}`, text: `${r.task_title}: ${r.current_points} → ${r.requested_points} pts`, pointReqId: r.id, ts: r.created_at || nowIso });
    }
  }
  // 3c. Decided point requests for me (requester) — ts = decided_at
  for (const r of state.pointRequests.filter(r => r.requested_by === state.user.id && r.status !== 'pending')) {
    out.push({
      kind: r.status === 'approved' ? 'success' : 'overdue',
      icon: r.status === 'approved' ? '✅' : '❌',
      title: `คำขอเพิ่ม Points ${r.status === 'approved' ? 'ได้รับอนุมัติแล้ว' : 'ถูกปฏิเสธ'}`,
      text: `${r.task_title}: ${r.requested_points} pts`,
      taskId: r.task_id,
      ts: r.decided_at || r.created_at || nowIso,
    });
  }
  // 4. Decided deadline requests for me
  for (const r of state.extensions.filter(r => r.requested_by === state.user.id && r.status !== 'pending')) {
    out.push({
      kind: r.status === 'approved' ? 'success' : 'overdue',
      icon: r.status === 'approved' ? '✅' : '❌',
      title: `คำขอเลื่อน deadline ${r.status === 'approved' ? 'ได้รับอนุมัติแล้ว' : 'ถูกปฏิเสธ'}`,
      text: r.task_title,
      taskId: r.task_id,
      ts: r.decided_at || r.created_at || nowIso,
    });
  }
  // 5. Pending GROUP invites TO me
  for (const i of state.groupInvitations.filter(i => i.status === 'pending' && i.kind === 'invite' && i.member_id === state.user.id)) {
    out.push({ kind:'info', icon:'🤝', title:`คำเชิญเข้ากลุ่ม — ${i.inviter_name||'?'}`, text: i.group_name || '?', invitationId: i.id, decideKind: 'invite', groupId: i.group_id, ts: i.created_at || nowIso });
  }
  // 6. Pending proposals to join groups I lead
  for (const i of state.groupInvitations.filter(i => i.status === 'pending' && i.kind === 'proposal' && (i.group_leader_id === state.user.id || isAdmin()))) {
    if (i.member_id === state.user.id) continue;
    out.push({ kind:'info', icon:'🙋', title:`${i.member_name||'?'} เสนอตัวเข้ากลุ่ม`, text: i.group_name || '?', invitationId: i.id, decideKind: 'proposal', groupId: i.group_id, ts: i.created_at || nowIso });
  }
  // 8. Mentions
  let mentionLastSeen = '';
  try { mentionLastSeen = localStorage.getItem('sml_mentions_last_seen') || ''; } catch {}
  for (const m of (state.mentions || [])) {
    if (mentionLastSeen && m.created_at <= mentionLastSeen) continue;
    const preview = String(m.body || '').replace(/\s+/g, ' ').slice(0, 80);
    out.push({
      kind: 'info',
      icon: '💬',
      title: `${m.member_name || '?'} แท็กคุณใน comment`,
      text: `"${preview}"${m.task_title ? ' — ' + m.task_title : ''}`,
      taskId: m.task_id,
      mentionId: m.id,
      ts: m.created_at || nowIso,
    });
  }
  // 7. My outgoing invites/proposals decided
  for (const i of state.groupInvitations.filter(i => i.status !== 'pending' && (i.invited_by === state.user.id || (i.kind==='proposal' && i.member_id === state.user.id)))) {
    if (i.kind === 'proposal' && i.member_id !== state.user.id) continue;
    const accepted = i.status === 'accepted';
    out.push({
      kind: accepted ? 'success' : 'overdue',
      icon: accepted ? '✅' : '❌',
      title: i.kind === 'invite'
        ? `คำเชิญเข้ากลุ่มที่คุณส่ง${accepted?'ได้รับการตอบรับ':'ถูกปฏิเสธ'} — ${i.member_name}`
        : `การเสนอตัวเข้ากลุ่มของคุณ${accepted?'ได้รับการอนุมัติ':'ถูกปฏิเสธ'}`,
      text: i.group_name || '',
      groupId: i.group_id,
      ts: i.decided_at || i.created_at || nowIso,
    });
  }
  // เรียงใหม่ → เก่า (newest first) — ใช้ ts (ISO date string ยอม compare ตรง ๆ)
  out.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return out;
}
function renderBellBadge() {
  const items = buildNotifications();
  const badge = document.getElementById('bell-badge');
  if (items.length === 0) { badge.classList.add('hidden'); }
  else { badge.classList.remove('hidden'); badge.textContent = items.length > 99 ? '99+' : items.length; }
}
function openNotifications() {
  const items = buildNotifications();
  // Mark mentions as seen (bell ถูกเปิด = ผู้ใช้รับรู้แล้ว) — เก็บ timestamp ล่าสุด
  // ของ mention ใน localStorage; ครั้งหน้า buildNotifications จะกรองทิ้ง
  try {
    const latestMention = (state.mentions || []).reduce((acc, m) => m.created_at > acc ? m.created_at : acc, '');
    if (latestMention) localStorage.setItem('sml_mentions_last_seen', latestMention);
  } catch {}
  // Refresh badge count หลัง mark-as-seen (mentions ถูก count แล้วในรอบนี้แต่ครั้งหน้าจะหาย)
  setTimeout(renderBellBadge, 0);
  const body = document.getElementById('notif-body');
  if (items.length === 0) {
    body.innerHTML = `<div class="text-center text-slate-400 py-12 text-sm">ไม่มีการแจ้งเตือน 🎉</div>`;
  } else {
    body.innerHTML = items.map((n, i) => `
      <div class="notif-row" data-notif-idx="${i}">
        <span class="ico notif-${n.kind}">${n.icon}</span>
        <div class="min-w-0 flex-1">
          <div class="font-medium text-sm">${escapeHtml(n.title)}</div>
          <div class="text-xs text-slate-500 truncate">${escapeHtml(n.text)}</div>
        </div>
        ${n.invitationId ? `
          <div class="flex flex-col gap-1 ml-2">
            <button class="ios-btn-secondary text-xs" data-decide-inv="${n.invitationId}" data-decision="accepted">รับ</button>
            <button class="ios-btn-danger text-xs" data-decide-inv="${n.invitationId}" data-decision="rejected">ปฏิเสธ</button>
          </div>` : ''}
        ${n.pointReqId ? `
          <div class="flex flex-col gap-1 ml-2">
            <button class="ios-btn-secondary text-xs" data-decide-pr="${n.pointReqId}" data-decision="approved">อนุมัติ</button>
            <button class="ios-btn-danger text-xs" data-decide-pr="${n.pointReqId}" data-decision="rejected">ปฏิเสธ</button>
          </div>` : ''}
      </div>
    `).join('');
    body.querySelectorAll('[data-notif-idx]').forEach(row => {
      row.onclick = (e) => {
        if (e.target.closest('[data-decide-inv]')) return;
        const n = items[+row.dataset.notifIdx];
        closeNotifications();
        if (n.taskId) openTaskSheet(n.taskId);
        else if (n.groupId) gotoSummaryGroup(n.groupId);
        else if (n.extId) { setTab('profile'); openExtensionsModal(); }
      };
    });
    body.querySelectorAll('[data-decide-inv]').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        try {
          await api.post('/api/group-invitations/' + b.dataset.decideInv + '/decide', { decision: b.dataset.decision });
          toast(b.dataset.decision === 'accepted' ? 'ตอบรับแล้ว' : 'ปฏิเสธแล้ว', 'success');
          await loadAll();
          openNotifications();
        } catch (err) { toast(err.message, 'error'); }
      };
    });
    body.querySelectorAll('[data-decide-pr]').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        try {
          await api.post('/api/point-requests/' + b.dataset.decidePr + '/decide', { status: b.dataset.decision });
          toast(b.dataset.decision === 'approved' ? 'อนุมัติงบเพิ่มแล้ว' : 'ปฏิเสธคำขอ', 'success');
          await loadAll();
          openNotifications();
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  }
  document.getElementById('notif-sheet').classList.remove('hidden');
  document.getElementById('notif-sheet').classList.add('flex');
}
function closeNotifications() {
  document.getElementById('notif-sheet').classList.add('hidden');
  document.getElementById('notif-sheet').classList.remove('flex');
}

// ============== 2-step task creation flow (with multi-row quick add) ==============
function openCreateTaskFlow() {
  const availableGroups = isAdmin() ? state.groups : myGroups();
  const html = `
    <div class="space-y-2">
      <div class="text-sm text-slate-600">เลือก Group ที่จะใส่งาน หรือสร้าง Group ใหม่</div>
      <div class="space-y-1.5">
        ${availableGroups.map(g => `
          <button type="button" data-pick-group="${g.id}" class="w-full text-left bg-slate-50 hover:bg-slate-100 rounded-xl p-3">
            <div class="font-medium text-sm">${escapeHtml(g.name)}</div>
            <div class="text-[11px] text-slate-500">${g.leader_name ? `หัวหน้า: ${escapeHtml(g.leader_name)}` : 'ไม่มีหัวหน้า'} · ⏰ ${fmtDate(g.deadline)}</div>
          </button>
        `).join('')}
      </div>
      <button type="button" id="flow-new-group" class="ios-btn-secondary w-full">＋ สร้าง Group ใหม่</button>
      ${isAdmin() ? `<button type="button" id="flow-no-group" class="ios-btn-ghost w-full">งานเดี่ยว — ไม่อยู่ใน Group</button>` : ''}
    </div>
  `;
  openModal('เพิ่มงาน — เลือก Group ก่อน', html, async () => closeModal(), 'ปิด');
  // Swap content IN-PLACE (no closeModal first) — กัน ghost-click บน iPad/Safari
  // ที่ tap แรกโดน button, tap2 ghost ลงตำแหน่งใหม่หลัง modal เปลี่ยน → ชน backdrop → ปิด modal
  // openModal() เขียนทับ modalForm.innerHTML อยู่แล้ว ไม่ต้องปิด-เปิดใหม่
  // setTimeout(0) ให้ click event finish ก่อนแล้วค่อย swap content — กัน race condition
  // กับ event ที่ยังประมวลผลอยู่บน button ที่กำลังจะถูก replace
  const _safeSwap = (fn, label) => {
    setTimeout(() => {
      try { fn(); }
      catch (err) {
        console.error(`[task-flow] ${label} failed`, err);
        toast(`เปิดฟอร์มไม่สำเร็จ: ${err.message || err}`, 'error');
      }
    }, 0);
  };
  document.querySelectorAll('[data-pick-group]').forEach(b => {
    b.onclick = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const gid = b.dataset.pickGroup;
      _safeSwap(() => openMultiTaskModal(gid), 'openMultiTaskModal');
    };
  });
  document.getElementById('flow-new-group').onclick = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    _safeSwap(() => {
      closeModal();
      openGroupModal(null, (newGroup) => openMultiTaskModal(newGroup.id));
    }, 'openGroupModal');
  };
  if (isAdmin()) {
    document.getElementById('flow-no-group').onclick = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      _safeSwap(() => openMultiTaskModal(null), 'openMultiTaskModal(null)');
    };
  }
}

// Multi-row quick task add — create many tasks in one go (with chip-based multi-assignee)
function openMultiTaskModal(groupId) {
  const g = groupId ? groupById(groupId) : null;

  const fields = `
    <div class="text-xs text-slate-600">
      ${g ? `Group: <b>${escapeHtml(g.name)}</b>` : 'งานเดี่ยว — ไม่อยู่ใน Group'}<br>
      ใส่ได้หลายงานพร้อมกัน — กด "＋ เพิ่มอีก" เพื่อเพิ่มแถว · แต่ละ task มีประเภทแยกกัน
    </div>
    <div class="flex justify-end mb-1">
      <button type="button" id="multi-add-category" class="ios-btn-ghost text-xs">＋ เพิ่มประเภทงานใหม่</button>
    </div>
    <div id="multi-rows" class="space-y-3"></div>
    <button type="button" id="multi-add-row" class="ios-btn-ghost w-full">＋ เพิ่มอีก</button>
    <div class="text-[11px] text-slate-500 italic">งานที่ใส่ชื่อแล้วจะถูกสร้างทั้งหมดเมื่อกด "บันทึก"</div>
  `;
  openModal(g ? `เพิ่มงานใน "${g.name}"` : 'เพิ่มงานเดี่ยว', fields, async () => {
    // Per-row categories — each row has its own chip grid (NOT shared across tasks)
    // User feedback: "tag นี้หมายถึง 1 task ต่อการเลือก tag 1 ครั้ง"
    const rows = document.querySelectorAll('#multi-rows .multi-row');
    const tasks = [];
    rows.forEach(r => {
      const title = r.querySelector('[name="title"]').value.trim();
      if (!title) return;
      const assignee_ids = Array.from(r.querySelectorAll('.member-chip.selected'))
        .map(c => c.dataset.memberId);
      const rowCatIds = Array.from(r.querySelectorAll('.row-cat-chip-grid .cat-chip.selected[data-category-id]'))
        .map(c => c.dataset.categoryId);
      const budgetInp = r.querySelector('[name="budget"]');
      // parse "10k" / "1.5m" / "50,000" → raw number; ว่าง = null
      const budgetParsed = budgetInp ? parseBudgetInput(budgetInp.value) : null;
      tasks.push({
        title,
        description: r.querySelector('[name="description"]').value.trim(),
        deadline: r.querySelector('[name="deadline"]').value || null,
        budget: budgetParsed,
        assignee_ids,
        category_ids: rowCatIds,
        group_id: groupId,
        status: 'in_progress',
      });
    });
    if (tasks.length === 0) { toast('ใส่อย่างน้อย 1 งาน (ต้องมีชื่อ)', 'error'); throw new Error('no tasks'); }
    const noAssignees = tasks.filter(t => t.assignee_ids.length === 0);
    if (noAssignees.length > 0) {
      toast(`มี ${noAssignees.length} งานที่ยังไม่ได้เลือกผู้รับผิดชอบ`, 'error');
      throw new Error('missing assignees');
    }
    let ok = 0, fail = 0;
    for (const t of tasks) {
      try { await api.post('/api/tasks', t); ok++; } catch { fail++; }
    }
    toast(`สร้างงานแล้ว ${ok} งาน${fail?` (ล้มเหลว ${fail})`:''}`, fail ? 'error' : 'success');
    await loadAll();
  });

  function memberChipsHtml() {
    return state.members.map(m => {
      // Use uploaded profile picture if available, else colored-initial circle
      const avatarInner = m.avatar_url
        ? `<img class="member-chip-avatar member-chip-avatar-img" src="${escapeHtml(m.avatar_url)}" alt="">`
        : `<span class="member-chip-avatar">${escapeHtml(initials(m.name))}</span>`;
      return `
        <button type="button" class="member-chip" data-member-id="${m.id}" style="--m-color:${m.color}">
          ${avatarInner}
          <span class="member-chip-name">${escapeHtml(m.name)}</span>
        </button>
      `;
    }).join('');
  }

  // Per-row category chip grid HTML — แต่ละ row เลือก tag ของตัวเอง
  // ใช้ module-level `_rowCatChipsHtml` เพื่อให้ click handler (edit/delete) refresh ได้ตรงกัน
  const rowCatChipsHtml = _rowCatChipsHtml;

  // Full row dropdown HTML — `<details>` wrapper + summary chips + body with chip grid
  // ปุ่ม "⚙️ จัดการ" → toggle .edit-mode บน dropdown เพื่อโผล่ไอคอน ✏️🗑️ ใน chips
  function rowCatDropdownHtml() {
    const total = (state.categories || []).length;
    return `
      <details class="form-section row-cat-dropdown">
        <summary class="cat-summary">
          <span class="form-section-title">🏷️ ประเภทงาน
            <span class="text-[11px] font-normal text-slate-500">เลือก <b class="row-cat-sel-count">0</b> / ${total}</span>
          </span>
          <span class="cat-summary-tags row-cat-summary-tags">
            <span class="text-[11px] text-slate-400 italic">— ยังไม่ได้เลือก —</span>
          </span>
          <span class="cat-summary-caret" aria-hidden="true">▾</span>
        </summary>
        <div class="cat-dropdown-body">
          <div class="flex justify-between items-center mb-2 gap-2 flex-wrap">
            <button type="button" class="ios-btn-ghost text-xs row-cat-edit-mode" title="เปิด/ปิดโหมดจัดการประเภท">⚙️ จัดการประเภท</button>
            <button type="button" class="ios-btn-ghost text-xs row-cat-clear" style="display:none">ล้างที่เลือก</button>
          </div>
          <div class="text-[11px] text-slate-400 italic mb-1 row-cat-edit-hint" style="display:none">
            🛠️ โหมดจัดการ — กด ✏️ เพื่อแก้ชื่อ, กด 🗑️ เพื่อลบ (การลบจะ unlink ออกจากทุก task ที่ใช้ tag นี้)
          </div>
          <div class="cat-groups row-cat-chip-grid">${rowCatChipsHtml()}</div>
        </div>
      </details>
    `;
  }

  // Refresh chip grids — delegate ไปยัง module-level เพื่อ reuse logic เดียวกัน
  const refreshRowCatGrids = refreshAllRowCatGrids;

  function addRow() {
    const rowsEl = document.getElementById('multi-rows');
    const idx = rowsEl.children.length + 1;
    const row = document.createElement('div');
    row.className = 'multi-row';
    row.innerHTML = `
      <div class="multi-row-header">
        <span class="multi-row-num">งาน #${idx}</span>
        <button type="button" class="multi-remove">✕ ลบ</button>
      </div>
      <input class="ios-input multi-title" name="title" placeholder="หัวข้องาน *" required>
      <textarea class="ios-textarea" name="description" placeholder="รายละเอียด (ไม่บังคับ)" rows="2"></textarea>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-[11px] text-slate-500 mb-0.5 block">⏰ Deadline *</label>
          <input class="ios-input" name="deadline" type="date" required>
        </div>
        <div>
          <label class="text-[11px] text-slate-500 mb-0.5 block">💰 งบประมาณ (ไม่บังคับ)</label>
          <input class="ios-input budget-input" name="budget" type="text" inputmode="decimal" autocomplete="off" placeholder="เช่น 50k / 1.5m / 2b">
        </div>
      </div>
      ${rowCatDropdownHtml()}
      <div>
        <div class="flex items-center gap-2 mt-1 mb-1.5">
          <span class="text-xs font-semibold text-slate-600 uppercase tracking-wide">ผู้รับผิดชอบ *</span>
          <span class="member-count-pill">เลือกอย่างน้อย 1 คน</span>
        </div>
        <div class="member-chip-grid">${memberChipsHtml()}</div>
      </div>
    `;
    rowsEl.appendChild(row);
    // Re-skin the row's date input as dd/mm/yyyy via flatpickr — rows are
    // added dynamically so the openModal-level init doesn't catch them.
    initFlatpickr(row);

    row.querySelector('.multi-remove').onclick = () => {
      row.remove();
      document.querySelectorAll('#multi-rows .multi-row .multi-row-num').forEach((s, i) => {
        s.textContent = 'งาน #' + (i + 1);
      });
    };
    // chip clicks (member + cat) are handled by modal-form delegation
    // (see modalForm.addEventListener('click', ...))
  }

  addRow();
  document.getElementById('multi-add-row').onclick = addRow;
  // "+ เพิ่มประเภทงานใหม่" ระดับ modal — เพิ่ม category แล้ว refresh ทุก row chip grid
  const addCatBtn = document.getElementById('multi-add-category');
  if (addCatBtn) {
    addCatBtn.onclick = async () => {
      const name = await uiPrompt('ตั้งชื่อประเภทงานใหม่ — แนะนำรูปแบบ "หมวด - ชื่อ" เพื่อจัดกลุ่มอัตโนมัติ:', {
        title: '🏷️ เพิ่มประเภทงาน',
        placeholder: 'เช่น "เอกสาร - MOU", "Dev - Mobile App"',
        okLabel: 'เพิ่ม',
      });
      if (!name) return;
      try {
        const cat = await api.post('/api/categories', { name });
        if (!state.categories.find(c => c.id === cat.id)) {
          state.categories.push(cat);
          state.categories.sort((a, b) => a.name.localeCompare(b.name, 'th'));
        }
        refreshRowCatGrids();
        toast('เพิ่มประเภทงานแล้ว: ' + cat.name, 'success');
      } catch (err) {
        toast(err.message || 'เพิ่มประเภทงานไม่สำเร็จ', 'error');
      }
    };
  }
}

// ============== Drag-and-drop on Kanban (columns + trash bin) ==============
const COL_LABEL_TH = {
  on_hold: 'พักไว้', in_progress: 'กำลังดำเนินการ',
  completed_pending: 'เสร็จแล้ว · รอคอนเฟิร์ม',
  leader_review: 'รอฉัน Approve', admin_final: 'รอฉันคอนเฟิร์ม', confirmed: 'คอนเฟิร์มแล้ว',
  cancelled: 'ยกเลิก',
};

(function setupKanbanDnd() {
  const trash = document.getElementById('trash-bin');
  if (!trash) return;

  // ===== Drag start/end (delegated) =====
  document.body.addEventListener('dragstart', e => {
    const card = e.target.closest('.task-card[data-task-detail]');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.taskDetail);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
    trash.classList.add('hint');
  });
  document.body.addEventListener('dragend', () => {
    document.querySelectorAll('.task-card.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.kanban-col.drop-target,.kanban-col.drop-blocked').forEach(c => c.classList.remove('drop-target','drop-blocked'));
    trash.classList.remove('hint', 'drag-active');
  });

  // ===== Column dragover (highlight target / show "blocked" cue for non-droppable) =====
  document.body.addEventListener('dragover', e => {
    const overTrash = e.target.closest('#trash-bin');
    const col = e.target.closest('.kanban-col[data-col-id]');
    if (col) {
      const droppable = col.hasAttribute('data-drop-status');
      if (droppable) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.kanban-col.drop-target,.kanban-col.drop-blocked').forEach(c => { if (c !== col) c.classList.remove('drop-target','drop-blocked'); });
        col.classList.add('drop-target');
      } else {
        // Show blocked cue but don't preventDefault → drop won't fire here
        document.querySelectorAll('.kanban-col.drop-target,.kanban-col.drop-blocked').forEach(c => { if (c !== col) c.classList.remove('drop-target','drop-blocked'); });
        col.classList.add('drop-blocked');
      }
    } else if (!overTrash) {
      document.querySelectorAll('.kanban-col.drop-target,.kanban-col.drop-blocked').forEach(c => c.classList.remove('drop-target','drop-blocked'));
    }
  });

  // ===== Drop on column → set status (workflow column drops are blocked above) =====
  document.body.addEventListener('drop', async e => {
    if (e.target.closest('#trash-bin')) return; // trash has its own handler
    const col = e.target.closest('.kanban-col[data-col-id][data-drop-status]');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('drop-target');
    const taskId = e.dataTransfer.getData('text/plain');
    const colId = col.dataset.colId;
    const newStatus = col.dataset.dropStatus; // status to apply
    if (!taskId || !newStatus) return;
    // Skip if the task is already in this column (re-render without re-saving)
    const card = document.querySelector(`[data-task-detail="${taskId}"]`);
    const currentCol = card?.closest('.kanban-col[data-col-id]');
    if (currentCol && currentCol.dataset.colId === colId) return;
    try {
      await api.put('/api/tasks/' + taskId, { status: newStatus });
      toast(`ย้ายเป็น "${COL_LABEL_TH[colId] || newStatus}" แล้ว`, 'success');
      await loadAll();
      // If task just landed in "completed", prompt the dragger to set their own points.
      if (newStatus === 'completed') await promptOwnPointsIfNeeded(taskId);
    } catch (err) { toast(err.message, 'error'); }
  });

  // ===== Trash bin handlers =====
  trash.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    trash.classList.add('drag-active');
  });
  trash.addEventListener('dragleave', () => trash.classList.remove('drag-active'));
  trash.addEventListener('drop', async e => {
    e.preventDefault();
    trash.classList.remove('drag-active', 'hint');
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;
    // No confirm dialog — the drop gesture is intentional enough, and the task
    // can be restored from 🗑 ถังขยะ within 30 days if dropped by mistake.
    try {
      await api.del('/api/tasks/' + taskId);
      toast('ย้ายไปถังขยะแล้ว 🗑 — กู้คืนได้ใน 30 วัน', 'success');
      await loadAll();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Click trash on touch devices = hint (no native HTML5 DnD on touch)
  trash.addEventListener('click', () => {
    if (matchMedia('(hover: none)').matches) {
      toast('แตะค้างที่การ์ดแล้วลากมาที่นี่เพื่อย้ายไปถังขยะ — หรือเปิดงานแล้วกดปุ่ม 🗑', '');
    }
  });
})();

// ============== Whiteboard ==============
let _wbEventsInited = false;
let wbCanvas = null;
let wbSocket = null;
let wbBoardId = null;
let wbActiveTool = 'select';
let wbIsDrawingShape = false;
let wbShapeOrigin = null;
let wbActiveShape = null;
// Pan
let wbIsPanning = false;
let wbPanLast = null;
// Eraser
let wbIsErasing = false;
// History (undo/redo)
let wbHistory = [];
let wbHistoryIdx = -1;
let wbSuppressHistory = false;  // when applying remote ops or undo/redo
// Fill mode
let wbFillMode = false;
// Grid
let wbGridOn = false;

async function loadWhiteboards() {
  try {
    const boards = await api.get('/api/whiteboards');
    state.whiteboards = boards || [];
    renderWhiteboardList();
  } catch (e) { console.warn('loadWhiteboards:', e.message); }
}

function renderWhiteboardList() {
  const list = document.getElementById('wb-list');
  if (!list) return;
  const boards = state.whiteboards || [];
  if (!boards.length) {
    list.innerHTML = '<p class="text-slate-400 text-sm text-center py-8">ยังไม่มี Whiteboard — กด "+ สร้างใหม่"</p>';
    return;
  }
  list.innerHTML = boards.map(b => `
    <div class="ios-card bg-white rounded-2xl px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition"
         data-wb-open="${b.id}">
      <div>
        <div class="font-semibold text-sm">${escapeHtml(b.name)}</div>
        <div class="text-xs text-slate-400">โดย ${escapeHtml(b.creator_name || '?')} · ${fmtDate(b.updated_at || b.created_at)}</div>
      </div>
      <span class="text-slate-300 text-lg">›</span>
    </div>`).join('');
}

function initWhiteboardEvents() {
  document.getElementById('wb-new-btn')?.addEventListener('click', async () => {
    const name = prompt('ชื่อ Whiteboard ใหม่:');
    if (!name || !name.trim()) return;
    try {
      await api.post('/api/whiteboards', { name: name.trim() });
      await loadWhiteboards();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('wb-list')?.addEventListener('click', e => {
    const card = e.target.closest('[data-wb-open]');
    if (card) openWhiteboard(card.dataset.wbOpen);
  });

  document.getElementById('wb-back')?.addEventListener('click', closeWhiteboard);

  document.querySelectorAll('.wb-tool[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setWbTool(btn.dataset.tool));
  });

  document.getElementById('wb-delete-btn')?.addEventListener('click', deleteSelectedObjects);
  document.getElementById('wb-clear-btn')?.addEventListener('click', async () => {
    if (!wbCanvas) return;
    if (!(await uiConfirm('ล้าง Whiteboard ทั้งหมด?'))) return;
    wbCanvas.clear();
    wbCanvas.backgroundColor = '#ffffff';
    wbCanvas.renderAll();
    pushHistory();
    broadcastCanvasOp();
  });

  document.getElementById('wb-confirm-btn')?.addEventListener('click', () => {
    if (!wbCanvas || !wbSocket || wbSocket.readyState !== 1) return;
    const json = JSON.stringify(wbCanvas.toJSON());
    wbSocket.send(JSON.stringify({ type: 'confirm', canvasJson: json }));
    toast('บันทึก & sync แล้ว ✅', 'success');
  });

  // ===== Inject modal — 5 tabs (task / group / meeting / recording / points) =====
  document.getElementById('wb-inject-btn')?.addEventListener('click', () => {
    document.getElementById('wb-inject-modal')?.classList.remove('hidden');
    renderInjectList();  // re-render every open so fresh state.tasks/groups is reflected
  });
  document.getElementById('wb-inject-close')?.addEventListener('click', () => {
    document.getElementById('wb-inject-modal')?.classList.add('hidden');
    // Note: do NOT stop the recorder here — it may be running. The toolbar
    // 🎙 button + floating widget own the recorder lifecycle so the user
    // can close the modal and keep recording while drawing.
  });
  // Toolbar 🎙 button — toggle start/stop. Lets the user record without
  // having to open the inject modal at all.
  document.getElementById('wb-rec-toggle')?.addEventListener('click', () => {
    if (_wbRec && _wbRec.state === 'recording') wbStopAndUploadMiniRecorder();
    else wbStartMiniRecorder();
  });
  // Floating widget stop button
  document.getElementById('wb-float-rec-stop')?.addEventListener('click', () => {
    if (_wbRec && _wbRec.state === 'recording') wbStopAndUploadMiniRecorder();
  });
  // Tabs
  document.querySelectorAll('[data-inject-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-inject-tab]').forEach(b => b.classList.toggle('active', b === btn));
      wbInjectTab = btn.dataset.injectTab;
      renderInjectList();
    });
  });
  // Search box — debounced filter
  document.getElementById('wb-inject-search')?.addEventListener('input', e => {
    wbInjectQuery = (e.target.value || '').trim().toLowerCase();
    renderInjectList();
  });
  // Row click — context-sensitive per tab
  document.getElementById('wb-inject-list')?.addEventListener('click', async e => {
    const row = e.target.closest('[data-inject-id]');
    const act = e.target.closest('[data-inj-act]');
    if (!row || !wbBoardId) return;
    const id = row.dataset.injectId;
    const kind = row.dataset.injectKind;
    // Approve / Reject buttons (Points tab)
    if (act?.dataset.injAct === 'approve' || act?.dataset.injAct === 'reject') {
      const status = act.dataset.injAct === 'approve' ? 'approved' : 'rejected';
      try {
        await api.post(`/api/point-requests/${id}/decide`, { status });
        // Inject the decision card so collaborators see what happened
        const pr = (state.pointRequests || []).find(p => p.id === id);
        if (pr) {
          await api.post(`/api/whiteboards/${wbBoardId}/inject`, {
            kind: 'point_decision',
            data: {
              status, task_title: pr.task_title, requested_points: pr.requested_points,
              requester_name: pr.requester_name, decided_by: state.user?.name,
            },
          });
        }
        toast(status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว', 'success');
        await loadAll();
        renderInjectList();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    // Normal row click — inject the appropriate kind
    try {
      const data = JSON.parse(row.dataset.injectData || '{}');
      await api.post(`/api/whiteboards/${wbBoardId}/inject`, { kind, data });
      document.getElementById('wb-inject-modal')?.classList.add('hidden');
      toast('นำข้อมูลเข้าแล้ว', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  // "+ สร้างใหม่" — opens full task/group/meeting form, then auto-injects on save
  document.getElementById('wb-inject-create')?.addEventListener('click', () => {
    const tab = wbInjectTab;
    if (tab === 'task') {
      const auto = (created) => { wbInjectAfterSave('task', created); };
      openTaskModal(null, auto);
    } else if (tab === 'group') {
      openGroupModal(null, (created) => wbInjectAfterSave('group', created));
    } else if (tab === 'meeting') {
      openMeetingModal(null);
      // openMeetingModal doesn't take a callback — set a one-shot flag
      _wbInjectPendingKind = 'meeting';
    }
  });

  // ── Recent colors palette (max 6, LRU, persist in localStorage) ──
  const PRESET_HEXES = new Set(['#1e293b','#ef4444','#f97316','#facc15','#22c55e','#3b82f6','#a855f7','#ec4899']);
  function _wbLoadRecent() {
    try { return JSON.parse(localStorage.getItem('sml_wb_recent_colors') || '[]'); }
    catch { return []; }
  }
  function _wbSaveRecent(arr) {
    try { localStorage.setItem('sml_wb_recent_colors', JSON.stringify(arr.slice(0, 6))); } catch {}
  }
  function _wbRenderRecent() {
    const wrap = document.getElementById('wb-color-recent');
    if (!wrap) return;
    const recent = _wbLoadRecent();
    wrap.innerHTML = recent.map(c =>
      `<button type="button" class="wb-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`
    ).join('');
  }
  function _wbAddRecent(hex) {
    if (!hex) return;
    hex = String(hex).toLowerCase();
    if (PRESET_HEXES.has(hex)) return;   // อยู่ใน preset แล้ว ไม่ต้อง track
    let recent = _wbLoadRecent().filter(c => c !== hex);
    recent.unshift(hex);
    _wbSaveRecent(recent);
    _wbRenderRecent();
  }
  _wbRenderRecent();

  // Color + stroke
  document.getElementById('wb-color-pick')?.addEventListener('input', e => {
    if (!wbCanvas) return;
    if (wbCanvas.freeDrawingBrush) wbCanvas.freeDrawingBrush.color = wbActiveTool === 'highlight'
      ? hexToRgba(e.target.value, 0.35)
      : e.target.value;
    // sync active swatch (ถ้า user เลือกจาก dialog ตรงกับ swatch ไหน)
    document.querySelectorAll('.wb-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color?.toLowerCase() === String(e.target.value).toLowerCase());
    });
  });
  // 'change' fires เมื่อ user ปิด dialog (commit color) — เพิ่มเข้า recent
  document.getElementById('wb-color-pick')?.addEventListener('change', e => {
    _wbAddRecent(e.target.value);
  });

  // Quick color swatches (delegation — รวม preset + recent ใน listener เดียว
  // เผื่อ recent ถูก re-render ใหม่ ก็ยัง click ได้)
  document.addEventListener('click', e => {
    const sw = e.target.closest('.wb-swatch');
    if (!sw) return;
    const c = sw.dataset.color;
    if (!c) return;
    const inp = document.getElementById('wb-color-pick');
    if (inp) {
      inp.value = c;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  // ตั้ง active swatch แรกตาม default color (#1e293b = ดำ)
  document.querySelector('.wb-swatch[data-color="#1e293b"]')?.classList.add('active');
  document.getElementById('wb-stroke-size')?.addEventListener('input', e => {
    if (!wbCanvas) return;
    if (wbCanvas.freeDrawingBrush) wbCanvas.freeDrawingBrush.width = parseInt(e.target.value, 10);
  });

  // Fill toggle
  document.getElementById('wb-fill-toggle')?.addEventListener('click', () => {
    wbFillMode = !wbFillMode;
    const btn = document.getElementById('wb-fill-toggle');
    if (btn) {
      btn.textContent = wbFillMode ? '⬛' : '⬜';
      btn.title = wbFillMode ? 'เติมสี' : 'โปร่งใส';
    }
  });

  // Undo/Redo
  document.getElementById('wb-undo-btn')?.addEventListener('click', wbUndo);
  document.getElementById('wb-redo-btn')?.addEventListener('click', wbRedo);

  // Zoom
  document.getElementById('wb-zoom-in-btn')?.addEventListener('click', () => wbZoom(1.2));
  document.getElementById('wb-zoom-out-btn')?.addEventListener('click', () => wbZoom(0.8));
  document.getElementById('wb-zoom-fit-btn')?.addEventListener('click', wbZoomFit);

  // Paper templates — cycle blank → grid → dot → lined → (repeat)
  // Save per-board ใน localStorage. ใช้ class บน wrap → CSS pattern แสดง
  const PAPER_MODES = ['blank', 'grid', 'dot', 'lined'];
  const PAPER_LABELS = { blank: '📃 เปล่า', grid: '⊞ Grid', dot: '⋮⋮ Dot', lined: '☰ Lined' };
  function _wbApplyPaper(mode) {
    const wrap = document.getElementById('wb-canvas-wrap');
    if (!wrap) return;
    PAPER_MODES.forEach(m => wrap.classList.remove('wb-paper-' + m));
    wrap.classList.remove('wb-grid-on');   // legacy class
    if (mode && mode !== 'blank') wrap.classList.add('wb-paper-' + mode);
    const btn = document.getElementById('wb-grid-btn');
    if (btn) btn.title = `กระดาษ: ${PAPER_LABELS[mode] || PAPER_LABELS.blank} (กดเปลี่ยน)`;
  }
  function _wbPaperKey() { return 'sml_wb_paper_' + (wbBoardId || 'default'); }
  function _wbLoadPaper() {
    let mode = 'blank';
    try { mode = localStorage.getItem(_wbPaperKey()) || 'blank'; } catch {}
    _wbApplyPaper(mode);
  }
  document.getElementById('wb-grid-btn')?.addEventListener('click', () => {
    let cur = 'blank';
    try { cur = localStorage.getItem(_wbPaperKey()) || 'blank'; } catch {}
    const idx = PAPER_MODES.indexOf(cur);
    const next = PAPER_MODES[(idx + 1) % PAPER_MODES.length];
    try { localStorage.setItem(_wbPaperKey(), next); } catch {}
    _wbApplyPaper(next);
    toast(`กระดาษ: ${PAPER_LABELS[next]}`, '');
  });
  // Apply saved paper preference on next board-open
  window._wbLoadPaper = _wbLoadPaper;

  // ── Paper size selector (A4 default) ──
  // 96 dpi: 1mm = 3.78px. Sizes converted to px for canvas.setWidth/Height
  const PAPER_SIZES = {
    'a4-p':     { w: 794,  h: 1123, label: 'A4 ตั้ง' },
    'a4-l':     { w: 1123, h: 794,  label: 'A4 นอน' },
    'a3-p':     { w: 1123, h: 1587, label: 'A3 ตั้ง' },
    'a3-l':     { w: 1587, h: 1123, label: 'A3 นอน' },
    'a5-p':     { w: 559,  h: 794,  label: 'A5 ตั้ง' },
    'letter':   { w: 816,  h: 1056, label: 'Letter' },
    'tabloid':  { w: 1056, h: 1632, label: 'Tabloid' },
    'infinite': { w: 3000, h: 3000, label: '∞ ไม่จำกัด' },
  };
  function _wbPaperSizeKey() { return 'sml_wb_size_' + (wbBoardId || 'default'); }
  function _wbGetSavedSize() {
    let s = 'a4-p';
    try { s = localStorage.getItem(_wbPaperSizeKey()) || 'a4-p'; } catch {}
    return PAPER_SIZES[s] ? s : 'a4-p';
  }
  function _wbApplyPaperSize(sizeKey) {
    if (!wbCanvas) return;
    const sz = PAPER_SIZES[sizeKey] || PAPER_SIZES['a4-p'];
    // Update BASE paper dimensions — zoom math uses these as 1×
    wbCanvas._paperW = sz.w;
    wbCanvas._paperH = sz.h;
    wbCanvas._cssZoom = 1;
    wbCanvas.setWidth(sz.w);
    wbCanvas.setHeight(sz.h);
    wbCanvas.setZoom(1);
    wbCanvas.viewportTransform[4] = 0;
    wbCanvas.viewportTransform[5] = 0;
    wbCanvas.calcOffset();
    wbCanvas.renderAll();
    updateZoomLabel();
    // Mark active item in popover
    document.querySelectorAll('#wb-paper-size-menu .wb-popover-item').forEach(b => {
      b.classList.toggle('active', b.dataset.size === sizeKey);
    });
    const btn = document.getElementById('wb-paper-size-btn');
    if (btn) btn.title = `ขนาดกระดาษ: ${sz.label} (กดเปลี่ยน)`;
  }
  window._wbApplyPaperSize = _wbApplyPaperSize;
  window._wbGetSavedSize = _wbGetSavedSize;
  // Toggle popover on btn click
  document.getElementById('wb-paper-size-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const menu = document.getElementById('wb-paper-size-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
    // Mark current active
    const cur = _wbGetSavedSize();
    menu.querySelectorAll('.wb-popover-item').forEach(b => {
      b.classList.toggle('active', b.dataset.size === cur);
    });
  });
  // Item click → apply + save + close popover
  document.getElementById('wb-paper-size-menu')?.addEventListener('click', e => {
    const item = e.target.closest('.wb-popover-item');
    if (!item) return;
    const size = item.dataset.size;
    if (!size || !PAPER_SIZES[size]) return;
    try { localStorage.setItem(_wbPaperSizeKey(), size); } catch {}
    _wbApplyPaperSize(size);
    document.getElementById('wb-paper-size-menu')?.classList.add('hidden');
    toast(`ขนาดกระดาษ: ${PAPER_SIZES[size].label}`, '');
    if (wbCanvas) { wbCanvas.renderAll(); scheduleBroadcast(); }
  });
  // Click outside to close
  document.addEventListener('click', e => {
    const menu = document.getElementById('wb-paper-size-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (e.target.closest('#wb-paper-size-btn') || e.target.closest('#wb-paper-size-menu')) return;
    menu.classList.add('hidden');
  });

  // Fullscreen
  document.getElementById('wb-fullscreen-btn')?.addEventListener('click', toggleWbFullscreen);

  // Image upload
  document.getElementById('wb-image-btn')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = e => {
      const f = e.target.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = ev => {
        fabric.Image.fromURL(ev.target.result, img => {
          if (!wbCanvas) return;
          const max = 320;
          if (img.width > max) img.scaleToWidth(max);
          img.set({ left: 60, top: 60 });
          wbCanvas.add(img);
          wbCanvas.setActiveObject(img);
          wbCanvas.renderAll();
        });
      };
      reader.readAsDataURL(f);
    };
    input.click();
  });

  // Export PNG
  document.getElementById('wb-export-btn')?.addEventListener('click', () => {
    if (!wbCanvas) return;
    const url = wbCanvas.toDataURL({ format: 'png', multiplier: 2, enableRetinaScaling: true });
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  // Mouse handlers are attached to the Fabric canvas (NOT native DOM on the
  // lower canvas) inside openWhiteboard(), since Fabric's upper canvas would
  // intercept native DOM events on #wb-canvas.

  // Wheel zoom (Ctrl+wheel) — wheel on the wrapper still works because the
  // wheel listener can stay native DOM (it doesn't depend on hit-testing).
  const canvasEl = document.getElementById('wb-canvas');
  if (canvasEl) {
    canvasEl.addEventListener('wheel', e => {
      if (!wbCanvas) return;
      if (e.ctrlKey) {
        e.preventDefault();
        wbZoom(e.deltaY < 0 ? 1.1 : 0.9);
      }
    }, { passive: false });
  }

  // Window resize → re-fit canvas + recompute pointer offset
  window.addEventListener('resize', () => {
    if (wbCanvas && document.getElementById('wb-canvas-view') && !document.getElementById('wb-canvas-view').classList.contains('hidden')) {
      resizeWbCanvas();
      wbCanvas.calcOffset();
    }
  });
  // Scroll inside wrap → invalidate Fabric's offset cache (otherwise pointer
  // reads pre-scroll position → strokes drawn offset from finger)
  document.getElementById('wb-canvas-wrap')?.addEventListener('scroll', () => {
    if (wbCanvas) wbCanvas.calcOffset();
  }, { passive: true });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (!wbCanvas) return;
    if (document.getElementById('wb-canvas-view')?.classList.contains('hidden')) return;
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); wbUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); wbRedo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelectedObjects(); return; }
    const map = { v:'select', h:'pan', p:'draw', e:'eraser', l:'line', a:'arrow', r:'rect', o:'circle', t:'text', s:'sticky', f:null };
    if (k === 'f') { e.preventDefault(); toggleWbFullscreen(); return; }
    if (map[k]) { e.preventDefault(); setWbTool(map[k]); }
  });
}

// ===== Inject modal state =====
let wbInjectTab = 'task';     // 'task' | 'group' | 'meeting' | 'recording' | 'points'
let wbInjectQuery = '';
let _wbInjectPendingKind = null;  // set when "+ สร้างใหม่" was clicked; cleared after auto-inject
// Mini-recorder state (only active while the recording tab is open)
let _wbRec = null;             // MediaRecorder
let _wbRecStream = null;       // MediaStream (mic)
let _wbRecChunks = [];
let _wbRecStartedAt = 0;
let _wbRecTimerHandle = null;

// Render the inject modal's body based on the active tab + search query.
function renderInjectList() {
  const el = document.getElementById('wb-inject-list');
  const search = document.getElementById('wb-inject-search');
  const foot = document.querySelector('.wb-inject-foot');
  const createBtn = document.getElementById('wb-inject-create');
  if (!el) return;

  // Show / hide the search input + create button per tab
  if (search) search.style.display = (wbInjectTab === 'recording') ? 'none' : '';
  if (foot) foot.style.display = (wbInjectTab === 'recording' || wbInjectTab === 'points') ? 'none' : '';
  if (createBtn) {
    createBtn.textContent = (wbInjectTab === 'task')    ? '+ สร้างงานใหม่'
                          : (wbInjectTab === 'group')   ? '+ สร้างโครงการใหม่'
                          : (wbInjectTab === 'meeting') ? '+ สร้างประชุมใหม่'
                          : '+ สร้างใหม่';
  }

  const q = wbInjectQuery;
  const matches = (s) => !q || String(s || '').toLowerCase().includes(q);

  if (wbInjectTab === 'task') {
    const items = (state.tasks || [])
      .filter(t => !isMeeting(t) && t.status !== 'cancelled')
      .filter(t => matches(t.title) || matches(t.status));
    if (!items.length) { el.innerHTML = _wbEmptyMsg('ไม่มีงาน'); return; }
    el.innerHTML = items.map(t => _wbTaskRow(t, 'task')).join('');
    return;
  }
  if (wbInjectTab === 'meeting') {
    const items = (state.tasks || [])
      .filter(t => isMeeting(t) && t.status !== 'cancelled')
      .filter(t => matches(t.title));
    if (!items.length) { el.innerHTML = _wbEmptyMsg('ไม่มีประชุม'); return; }
    el.innerHTML = items.map(t => _wbTaskRow(t, 'meeting')).join('');
    return;
  }
  if (wbInjectTab === 'group') {
    const items = (state.groups || []).filter(g => matches(g.name));
    if (!items.length) { el.innerHTML = _wbEmptyMsg('ไม่มีโครงการ'); return; }
    el.innerHTML = items.map(g => _wbGroupRow(g)).join('');
    return;
  }
  if (wbInjectTab === 'recording') {
    el.innerHTML = _wbRecorderHtml();
    _wbWireRecorderUI();
    return;
  }
  if (wbInjectTab === 'points') {
    const items = (state.pointRequests || []).filter(p => p.status === 'pending');
    if (!items.length) { el.innerHTML = _wbEmptyMsg('ไม่มีคำขอ Points ที่รออนุมัติ'); return; }
    el.innerHTML = items.map(p => _wbPointReqRow(p)).join('');
    return;
  }
}

function _wbEmptyMsg(msg) {
  return `<p class="text-slate-400 text-sm text-center py-6">${escapeHtml(msg)}</p>`;
}
function _wbTaskRow(t, kind) {
  const g = groupById(t.group_id);
  const gColor = g?.color || '#94a3b8';
  const meta = kind === 'meeting'
    ? (t.deadline ? meetingTimeText(t.deadline, t.end_time) : 'ไม่ระบุเวลา')
    : `${t.status || '—'}${t.deadline ? ' · ⏰ ' + fmtDate(t.deadline) : ''}`;
  const payload = JSON.stringify({
    id: t.id, title: t.title, status: t.status,
    deadline: t.deadline, end_time: t.end_time,
    location_type: t.location_type, location_detail: meetingDetailFor?.(t) || '',
    assignees: (t.assignees || []).map(a => ({ name: a.name })),
    group_name: g?.name || '',
  });
  return `<button class="wb-inj-row" style="--row-color:${gColor}"
                  data-inject-id="${t.id}" data-inject-kind="${kind}"
                  data-inject-data='${escapeHtml(payload)}'>
    <span class="wb-inj-icon">${kind === 'meeting' ? '📅' : '📋'}</span>
    <div class="wb-inj-body">
      <div class="wb-inj-title truncate">${escapeHtml(t.title)}</div>
      <div class="wb-inj-meta truncate">${escapeHtml(meta)}</div>
    </div>
  </button>`;
}
function _wbGroupRow(g) {
  const memberCount = (g.members || []).length;
  const meta = `${g.leader_name ? '👤 ' + g.leader_name : 'ไม่มีหัวหน้า'} · ${memberCount} คน${g.deadline ? ' · ⏰ ' + fmtDate(g.deadline) : ''}`;
  const payload = JSON.stringify({
    id: g.id, name: g.name, leader_name: g.leader_name || '',
    member_count: memberCount, status: g.status, deadline: g.deadline,
    color: g.color || '#94a3b8',
  });
  return `<button class="wb-inj-row" style="--row-color:${g.color || '#94a3b8'}"
                  data-inject-id="${g.id}" data-inject-kind="group"
                  data-inject-data='${escapeHtml(payload)}'>
    <span class="wb-inj-icon">📁</span>
    <div class="wb-inj-body">
      <div class="wb-inj-title truncate">${escapeHtml(g.name)}</div>
      <div class="wb-inj-meta truncate">${escapeHtml(meta)}</div>
    </div>
  </button>`;
}
function _wbPointReqRow(p) {
  const meta = `📋 ${p.task_title || '?'} · ⭐ ${p.requested_points || 0} · 👤 ${p.requester_name || '?'}`;
  return `<div class="wb-inj-row" style="--row-color:#facc15"
               data-inject-id="${p.id}" data-inject-kind="point_request"
               data-inject-data='${escapeHtml(JSON.stringify({
                 id: p.id, task_title: p.task_title, requested_points: p.requested_points,
                 requester_name: p.requester_name, reason: p.reason || '',
               }))}'>
    <span class="wb-inj-icon">⭐</span>
    <div class="wb-inj-body">
      <div class="wb-inj-title truncate">ขอเพิ่ม points</div>
      <div class="wb-inj-meta truncate">${escapeHtml(meta)}</div>
    </div>
    <div class="wb-inj-actions">
      <button class="wb-inj-act ok" data-inj-act="approve" title="อนุมัติ">✅</button>
      <button class="wb-inj-act no" data-inj-act="reject"  title="ปฏิเสธ">❌</button>
    </div>
  </div>`;
}

// ===== Mini recorder embedded in the "recording" tab =====
function _wbRecorderHtml() {
  return `
    <div class="wb-rec-panel">
      <div id="wb-rec-state" class="wb-rec-state">⚪ พร้อมอัด</div>
      <div id="wb-rec-timer" class="wb-rec-timer">00:00</div>
      <div class="wb-rec-btns">
        <button id="wb-rec-start" class="wb-rec-start">🔴 อัด</button>
        <button id="wb-rec-stop"  class="wb-rec-stop" disabled>⏹ หยุดและส่ง</button>
      </div>
      <div class="wb-rec-hint">กดอัด → พูด → กดหยุด → ระบบ upload + ถอดเสียง + วาง การ์ดบน whiteboard. ระหว่างถอดเสียงการ์ดจะแสดง "⏳ กำลังถอดเสียง" — เมื่อเสร็จ SSE จะ push transcript snippet เข้ามาเอง</div>
    </div>`;
}
function _wbWireRecorderUI() {
  const startBtn = document.getElementById('wb-rec-start');
  const stopBtn  = document.getElementById('wb-rec-stop');
  if (startBtn) startBtn.onclick = wbStartMiniRecorder;
  if (stopBtn)  stopBtn.onclick  = wbStopAndUploadMiniRecorder;
}
async function wbStartMiniRecorder() {
  if (_wbRec && _wbRec.state === 'recording') return;  // already running
  try {
    _wbRecStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) { toast('เข้าถึงไมค์ไม่ได้: ' + e.message, 'error'); return; }
  _wbRecChunks = [];
  const candidates = ['audio/webm;codecs=opus','audio/webm','audio/mp4;codecs=mp4a.40.2','audio/mp4'];
  const mime = candidates.find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  _wbRec = new MediaRecorder(_wbRecStream, mime ? { mimeType: mime } : undefined);
  _wbRec.ondataavailable = e => { if (e.data?.size) _wbRecChunks.push(e.data); };
  _wbRec.start();
  _wbRecStartedAt = performance.now();
  _wbUpdateRecorderUI('recording');
  _wbRecTimerHandle = setInterval(_wbRecTick, 250);
  // Show the floating widget so the user knows recording is live, and they
  // can keep drawing on the canvas without the inject modal in the way.
  _wbShowFloatRec();
}
function _wbRecTick() {
  if (!_wbRecStartedAt) return;
  const ms = performance.now() - _wbRecStartedAt;
  const s = Math.floor(ms / 1000);
  const label = `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  // Update both the inject-modal timer (if visible) and the floating widget
  const t  = document.getElementById('wb-rec-timer');
  const ft = document.getElementById('wb-float-rec-timer');
  if (t)  t.textContent  = label;
  if (ft) ft.textContent = label;
}

// Floating recorder widget — always-visible while recording so the modal can
// be dismissed and the canvas used normally.
function _wbShowFloatRec() {
  const w = document.getElementById('wb-float-rec');
  const toolBtn = document.getElementById('wb-rec-toggle');
  if (w) { w.classList.remove('hidden', 'uploading'); }
  if (toolBtn) toolBtn.classList.add('is-recording');
}
function _wbHideFloatRec() {
  const w = document.getElementById('wb-float-rec');
  const toolBtn = document.getElementById('wb-rec-toggle');
  if (w) { w.classList.add('hidden'); w.classList.remove('uploading'); }
  if (toolBtn) toolBtn.classList.remove('is-recording');
}
function _wbMarkFloatUploading() {
  const w = document.getElementById('wb-float-rec');
  if (w) w.classList.add('uploading');
}
async function wbStopAndUploadMiniRecorder() {
  if (!_wbRec || _wbRec.state !== 'recording') return;
  const mime = _wbRec.mimeType || 'audio/webm';
  await new Promise(resolve => {
    _wbRec.onstop = resolve;
    _wbRec.stop();
  });
  const durMs = performance.now() - _wbRecStartedAt;
  _wbStopRecStream();
  _wbUpdateRecorderUI('uploading');
  _wbMarkFloatUploading();
  const blob = new Blob(_wbRecChunks, { type: mime });
  const ext = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'bin';
  const fd = new FormData();
  fd.append('audio', blob, `recording.${ext}`);
  fd.append('label', 'Whiteboard ' + plFmt?.(new Date().toISOString()) || 'Whiteboard recording');
  fd.append('duration_ms', String(Math.round(durMs)));
  try {
    const r = await fetch('/api/recordings', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
    if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || 'upload failed');
    const saved = await r.json();
    // Inject the card straight onto the board
    await api.post(`/api/whiteboards/${wbBoardId}/inject`, {
      kind: 'recording',
      data: {
        id: saved.id, label: saved.label, duration_ms: saved.duration_ms,
        transcript_status: saved.transcript_status || 'pending',
        transcript_excerpt: '',
      },
    });
    toast('อัปโหลด + วางการ์ดแล้ว — กำลังถอดเสียง', 'success');
    document.getElementById('wb-inject-modal')?.classList.add('hidden');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    _wbUpdateRecorderUI('idle');
    _wbHideFloatRec();
    _wbRecChunks = [];
  }
}
function wbStopMiniRecorder() {
  if (_wbRec && _wbRec.state === 'recording') {
    try { _wbRec.stop(); } catch {}
  }
  _wbStopRecStream();
  _wbUpdateRecorderUI('idle');
}
function _wbStopRecStream() {
  if (_wbRecTimerHandle) { clearInterval(_wbRecTimerHandle); _wbRecTimerHandle = null; }
  if (_wbRecStream) { _wbRecStream.getTracks().forEach(t => t.stop()); _wbRecStream = null; }
  _wbRec = null;
}
function _wbUpdateRecorderUI(state) {
  const s = document.getElementById('wb-rec-state');
  const start = document.getElementById('wb-rec-start');
  const stop  = document.getElementById('wb-rec-stop');
  if (!s) return;
  s.classList.remove('recording');
  if (state === 'recording') { s.textContent = '🔴 กำลังอัด...'; s.classList.add('recording'); start.disabled = true;  stop.disabled = false; }
  else if (state === 'uploading') { s.textContent = '⬆ กำลังอัปโหลด...';                       start.disabled = true;  stop.disabled = true;  }
  else                           { s.textContent = '⚪ พร้อมอัด';                              start.disabled = false; stop.disabled = true;  }
  if (!_wbRecStartedAt && state === 'idle') document.getElementById('wb-rec-timer').textContent = '00:00';
}

// Called by "+ สร้างใหม่" callbacks — inject the freshly-created entity onto the board
async function wbInjectAfterSave(kind, created) {
  if (!created || !wbBoardId) return;
  if (kind === 'task' || kind === 'meeting') {
    await api.post(`/api/whiteboards/${wbBoardId}/inject`, {
      kind, data: {
        id: created.id, title: created.title, status: created.status,
        deadline: created.deadline, end_time: created.end_time,
        location_type: created.location_type, location_detail: created.location_detail,
        assignees: (created.assignees || []).map(a => ({ name: a.name })),
      },
    });
  } else if (kind === 'group') {
    await api.post(`/api/whiteboards/${wbBoardId}/inject`, {
      kind: 'group', data: {
        id: created.id, name: created.name, leader_name: created.leader_name,
        member_count: (created.members || []).length, status: created.status,
        deadline: created.deadline, color: created.color,
      },
    });
  }
  toast('สร้างและวางบน Whiteboard แล้ว', 'success');
  document.getElementById('wb-inject-modal')?.classList.add('hidden');
  renderInjectList();
}

async function openWhiteboard(id) {
  wbBoardId = id;
  // Apply saved paper template (blank/grid/dot/lined) ของ board นี้
  if (typeof _wbLoadPaper === 'function') _wbLoadPaper();
  document.getElementById('wb-list-view')?.classList.add('hidden');
  const cv = document.getElementById('wb-canvas-view');
  cv?.classList.remove('hidden');

  const board = (state.whiteboards || []).find(b => b.id === id);
  const nameEl = document.getElementById('wb-board-name');
  if (nameEl) nameEl.textContent = board?.name || 'Whiteboard';

  if (wbCanvas) { wbCanvas.dispose(); wbCanvas = null; }
  wbHistory = []; wbHistoryIdx = -1; wbSuppressHistory = false;

  // Wait two animation frames for layout to settle (clientHeight is 0
  // immediately after unhiding the canvas view — falls back to viewport math).
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const wrap = document.getElementById('wb-canvas-wrap');
  // Paper-size aware canvas init — default A4 portrait (794×1123 @ 96dpi).
  // User เปลี่ยนได้ผ่านปุ่ม 📐 (save per-board ใน localStorage).
  // Wrap จะ scroll/overflow ถ้า paper ใหญ่กว่า viewport — user pan/zoom ดู
  const PAPER_FOR_INIT = {
    'a4-p': { w: 794,  h: 1123 }, 'a4-l': { w: 1123, h: 794 },
    'a3-p': { w: 1123, h: 1587 }, 'a3-l': { w: 1587, h: 1123 },
    'a5-p': { w: 559,  h: 794 },  'letter': { w: 816,  h: 1056 },
    'tabloid': { w: 1056, h: 1632 }, 'infinite': { w: 3000, h: 3000 },
  };
  let _initSize = 'a4-p';
  try { _initSize = localStorage.getItem('sml_wb_size_' + id) || 'a4-p'; } catch {}
  const _paperPx = PAPER_FOR_INIT[_initSize] || PAPER_FOR_INIT['a4-p'];
  const W = _paperPx.w;
  const H = _paperPx.h;

  wbCanvas = new fabric.Canvas('wb-canvas', {
    width: W, height: H,
    backgroundColor: '#ffffff',
    selection: true,
    preserveObjectStacking: true,
    enableRetinaScaling: true,    // crisp strokes on iPad retina displays
    allowTouchScrolling: false,   // touch on canvas = draw, not page scroll
  });
  // Remember paper dimensions as the BASE for zoom math (wbZoom multiplies this)
  wbCanvas._paperW = W;
  wbCanvas._paperH = H;
  wbCanvas._cssZoom = 1;
  wbCanvas.freeDrawingBrush.color = '#1e293b';
  wbCanvas.freeDrawingBrush.width = 3;
  // Sync paper-size button title + active state
  if (typeof _wbApplyPaperSize === 'function') _wbApplyPaperSize(_initSize);

  // Goodnote-style pointer handler — รวม 3 อย่างใน listener เดียว:
  //   1) Apple Pencil palm rejection (ปากกาแตะ → ignore touch finger ใน 800ms)
  //   2) Two-finger pinch zoom + pan (single-touch → draw, multi-touch → gesture)
  //   3) Pressure tracking สำหรับ pen tool (อ่าน e.pressure ส่งต่อให้ brush)
  const _upper = wbCanvas.upperCanvasEl;
  if (_upper) {
    const activePointers = new Map();   // pointerId → { type, x, y }
    let _penDownAt = 0;
    let gestureState = null;            // { startDist, startZoom, startCx, startCy }
    const touchCount = () => Array.from(activePointers.values()).filter(p => p.type === 'touch').length;
    const centroidAndDist = () => {
      const touches = Array.from(activePointers.values()).filter(p => p.type === 'touch');
      if (touches.length < 2) return null;
      const cx = (touches[0].x + touches[1].x) / 2;
      const cy = (touches[0].y + touches[1].y) / 2;
      const dx = touches[0].x - touches[1].x;
      const dy = touches[0].y - touches[1].y;
      return { cx, cy, dist: Math.hypot(dx, dy) };
    };

    _upper.addEventListener('pointerdown', e => {
      // Palm rejection: pen takes precedence
      if (e.pointerType === 'pen') { _penDownAt = performance.now(); return; }
      if (e.pointerType === 'touch') {
        // Touch within pen tail → palm, drop
        if (performance.now() - _penDownAt < 800) {
          e.preventDefault(); e.stopPropagation();
          return;
        }
        activePointers.set(e.pointerId, { type: 'touch', x: e.clientX, y: e.clientY });
        // Second finger touched down → enter gesture mode + cancel any in-progress stroke
        if (touchCount() === 2) {
          const c = centroidAndDist();
          gestureState = {
            startDist: c.dist,
            startZoom: wbCanvas.getZoom(),
            startCx: c.cx, startCy: c.cy,
            lastCx: c.cx, lastCy: c.cy,
          };
          // Note: ไม่ force-finish stroke ที่กำลังวาด — เพราะการเรียก
          // freeDrawingBrush.onMouseUp synthetically อาจ throw บน Fabric บาง
          // build. ปล่อยให้ stroke ค้างจนกว่า pointer up จะดีกว่า — gesture
          // mode ตัด event ใหม่ไม่ให้ไป Fabric เอง
          // Block this touch event from reaching Fabric (would start drawing)
          e.preventDefault(); e.stopPropagation();
        }
      }
    }, { passive: false, capture: true });

    _upper.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' && performance.now() - _penDownAt < 800) {
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (e.pointerType === 'touch' && activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { type: 'touch', x: e.clientX, y: e.clientY });
        if (gestureState && touchCount() >= 2) {
          const c = centroidAndDist();
          if (c) {
            // Pinch zoom — resize canvas DOM + Fabric zoom พร้อมกัน
            // (Pure zoomToPoint จะ scale content แต่ DOM นิ่ง → user ไม่เห็น)
            const newZoom = Math.max(0.2, Math.min(5, gestureState.startZoom * (c.dist / gestureState.startDist)));
            if (typeof _wbApplyZoom === 'function') {
              _wbApplyZoom(newZoom);
            } else {
              wbCanvas.setZoom(newZoom);
            }
            // Two-finger pan: scroll wrap แทน Fabric pan (เพราะ canvas โต
            // เกิน wrap แล้ว wrap scroll ได้)
            const wrap = document.getElementById('wb-canvas-wrap');
            if (wrap) {
              wrap.scrollLeft -= (c.cx - gestureState.lastCx);
              wrap.scrollTop  -= (c.cy - gestureState.lastCy);
            }
            gestureState.lastCx = c.cx;
            gestureState.lastCy = c.cy;
            e.preventDefault(); e.stopPropagation();
          }
        }
      }
    }, { passive: false, capture: true });

    const endHandler = e => {
      if (e.pointerType === 'pen') return;
      if (e.pointerType === 'touch') {
        activePointers.delete(e.pointerId);
        if (touchCount() < 2 && gestureState) {
          gestureState = null;
          // Eat the next pointerup so Fabric doesn't think a single-finger
          // tap happened (would deselect or place an object)
          e.preventDefault(); e.stopPropagation();
        }
      }
    };
    _upper.addEventListener('pointerup', endHandler, { passive: false, capture: true });
    _upper.addEventListener('pointercancel', endHandler, { passive: false, capture: true });
    _upper.addEventListener('pointerleave', endHandler, { passive: false, capture: true });

    // Mouse wheel zoom (desktop) — hold Ctrl/Cmd + scroll
    _upper.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const cur = wbCanvas._cssZoom || wbCanvas.getZoom() || 1;
      const next = Math.max(0.2, Math.min(5, cur * (e.deltaY > 0 ? 0.92 : 1.08)));
      if (typeof _wbApplyZoom === 'function') _wbApplyZoom(next);
    }, { passive: false });

    // Expose state for pressure brush + other handlers
    wbCanvas._wbActivePointers = activePointers;

    // ── Pressure-sensitive pen (Apple Pencil) ──
    // Read e.pressure (0..1) per pointermove, scale freeDrawingBrush.width
    // around the user-set base. Each segment of the stroke renders with its
    // own width on the preview canvas. On finalize, the Path saves with the
    // last set width (= compromise: visual feel of variable width during
    // drawing, single-width persisted). For true variable-width paths we'd
    // need a custom Fabric class — overkill for v1.
    let _penStrokeBase = 3;
    let _penStrokePressures = [];
    _upper.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'pen') return;
      if (!wbCanvas.isDrawingMode) return;
      _penStrokeBase = parseInt(document.getElementById('wb-stroke-size')?.value || '3', 10);
      _penStrokePressures = [];
    }, { passive: true, capture: true });
    _upper.addEventListener('pointermove', e => {
      if (e.pointerType !== 'pen') return;
      if (!wbCanvas.isDrawingMode || !wbCanvas._isCurrentlyDrawing) return;
      const p = Math.max(0.1, Math.min(1, e.pressure || 0.5));
      _penStrokePressures.push(p);
      // 0.4× at min pressure, 1.6× at max — feels natural without going too fat
      wbCanvas.freeDrawingBrush.width = _penStrokeBase * (0.4 + p * 1.2);
    }, { passive: true, capture: true });
    const _penEnd = e => {
      if (e.pointerType !== 'pen') return;
      // After stroke ends, average pressure decides the persisted width
      if (_penStrokePressures.length) {
        const avg = _penStrokePressures.reduce((a, b) => a + b, 0) / _penStrokePressures.length;
        wbCanvas.freeDrawingBrush.width = _penStrokeBase * (0.4 + avg * 1.2);
      }
      // Reset for next stroke
      setTimeout(() => { wbCanvas.freeDrawingBrush.width = _penStrokeBase; }, 50);
      _penStrokePressures = [];
    };
    _upper.addEventListener('pointerup',     _penEnd, { passive: true, capture: true });
    _upper.addEventListener('pointercancel', _penEnd, { passive: true, capture: true });
  }

  // Fabric mouse events (NOT native DOM — Fabric's upper canvas would steal them)
  wbCanvas.on('mouse:down', wbOnMouseDown);
  wbCanvas.on('mouse:move', wbOnMouseMove);
  wbCanvas.on('mouse:up',   wbOnMouseUp);
  // Double-click on an injected card → open full form (task/group/meeting),
  // approve/reject prompt (point_request), or recording detail.
  wbCanvas.on('mouse:dblclick', (e) => {
    if (e.target?._injectKind) _wbHandleCardDblClick(e.target);
  });

  // History tracking + broadcast on every modification
  const onChange = () => { if (!wbSuppressHistory) pushHistory(); };
  let _wbInPathCreate = false;
  wbCanvas.on('path:created', e => {
    // Mark the just-created path so the upcoming object:added won't double-broadcast
    _wbInPathCreate = true;
    if (e?.path) e.path._fromPathCreated = true;
    // ── Lasso tool ── ถ้า active tool = lasso → path = วงเลือก ไม่ใช่ stroke
    if (wbActiveTool === 'lasso' && e?.path) {
      const path = e.path;
      // Build absolute polygon points
      const ox = path.left + (path.pathOffset?.x || 0);
      const oy = path.top + (path.pathOffset?.y || 0);
      const poly = (path.path || []).map(seg => {
        const last = seg.length;
        return { x: ox + seg[last - 2], y: oy + seg[last - 1] };
      }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      // Remove the lasso path itself (visual hint only)
      wbSuppressHistory = true;
      wbCanvas.remove(path);
      wbSuppressHistory = false;
      // Point-in-polygon check (ray casting) สำหรับ object centers
      function inside(pt, polygon) {
        let isIn = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const xi = polygon[i].x, yi = polygon[i].y;
          const xj = polygon[j].x, yj = polygon[j].y;
          const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
            (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-9) + xi);
          if (intersect) isIn = !isIn;
        }
        return isIn;
      }
      const selected = wbCanvas.getObjects().filter(obj => {
        if (obj === path) return false;
        const cx = obj.left + (obj.width || 0) / 2;
        const cy = obj.top + (obj.height || 0) / 2;
        return inside({ x: cx, y: cy }, poly);
      });
      if (selected.length === 0) {
        toast('ไม่มี object ในวง', '');
        return;
      }
      // Switch to select tool + create active selection
      setWbTool('select');
      if (selected.length === 1) {
        wbCanvas.setActiveObject(selected[0]);
      } else {
        const sel = new fabric.ActiveSelection(selected, { canvas: wbCanvas });
        wbCanvas.setActiveObject(sel);
      }
      wbCanvas.renderAll();
      toast(`เลือก ${selected.length} object`, 'success');
      return;
    }
    // ── Smart line straightener ── หลัง stroke จบ ดูว่า "ตรงพอ" ไหม
    // straightness = straight-line distance / total path length. ใกล้ 1 = ตรง
    // ถ้า > 0.985 และยาว > 40px → replace ด้วย Line clean (silent auto-snap)
    const path = e?.path;
    if (path && path.path && path.path.length >= 2) {
      const pts = path.path.map(seg => {
        // Each path segment is array like ['M', x, y] or ['Q'/'L', x, y, ...] etc
        const last = seg.length;
        return { x: seg[last - 2], y: seg[last - 1] };
      }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length >= 3) {
        let totalLen = 0;
        for (let i = 1; i < pts.length; i++) {
          totalLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        }
        const first = pts[0], last = pts[pts.length - 1];
        const directDist = Math.hypot(last.x - first.x, last.y - first.y);
        const straightness = totalLen > 0 ? directDist / totalLen : 0;
        if (straightness > 0.985 && directDist > 40) {
          // Replace path with a clean Line — Fabric path uses local coords
          // (relative to its left/top), so add path.left/top to get absolute
          const ox = path.left + (path.pathOffset?.x || 0);
          const oy = path.top + (path.pathOffset?.y || 0);
          const line = new fabric.Line(
            [ox + first.x, oy + first.y, ox + last.x, oy + last.y],
            {
              stroke: path.stroke,
              strokeWidth: path.strokeWidth,
              strokeLineCap: 'round',
              selectable: true,
            }
          );
          // Replace silently — มัน look like ทำเอง (no flicker)
          wbSuppressHistory = true;
          wbCanvas.remove(path);
          wbCanvas.add(line);
          wbSuppressHistory = false;
          wbCanvas.renderAll();
        }
      }
    }
  });
  wbCanvas.on('object:added', e => {
    // If this object came from a path:created event, skip the duplicate broadcast.
    // Path-creation already triggers object:added; without dedup we'd JSON-stringify
    // and broadcast twice in rapid succession, jank-blocking the drawer's main thread.
    if (e?.target?._fromPathCreated || _wbInPathCreate) {
      delete e?.target?._fromPathCreated;
      _wbInPathCreate = false;
      onChange();
      scheduleBroadcast();
      return;
    }
    onChange();
    scheduleBroadcast();
  });
  wbCanvas.on('object:modified', () => { onChange(); scheduleBroadcast(); });
  wbCanvas.on('object:removed',  () => { onChange(); scheduleBroadcast(); });

  setWbTool('select');
  updateZoomLabel();

  // WebSocket — auto-reconnect on drop (iOS Safari ฆ่า WS หลัง background)
  _wbWantConn = true;
  _wbConnect(id);
}

// state สำหรับ WS reconnect
let _wbWantConn = false;
let _wbReconnectTimer = null;
let _wbReconnectTries = 0;

function _wbConnect(id) {
  closeWbSocket();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  wbSocket = new WebSocket(`${proto}://${location.host}/ws`);
  wbSocket.onopen = () => {
    _wbReconnectTries = 0;
    wbSocket.send(JSON.stringify({ type: 'join', token, boardId: id }));
  };
  wbSocket.onmessage = e => { try { handleWbMessage(JSON.parse(e.data)); } catch {} };
  wbSocket.onerror = () => {/* onclose จะ trigger reconnect */};
  wbSocket.onclose = () => {
    if (!_wbWantConn || wbBoardId !== id) return;
    // exponential backoff, cap ที่ 8s
    const delay = Math.min(8000, 500 * Math.pow(2, _wbReconnectTries++));
    clearTimeout(_wbReconnectTimer);
    _wbReconnectTimer = setTimeout(() => {
      if (_wbWantConn && wbBoardId === id) _wbConnect(id);
    }, delay);
  };
}

// เมื่อ tab กลับมา foreground (iOS/Android เปลี่ยน app แล้วกลับมา) — ถ้า
// WS ตายให้รีคอนเนคทันทีโดยไม่ต้อง F5
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!wbBoardId || !_wbWantConn) return;
  if (!wbSocket || wbSocket.readyState >= 2) {
    _wbReconnectTries = 0;
    _wbConnect(wbBoardId);
  }
});

function closeWhiteboard() {
  _wbWantConn = false;
  closeWbSocket();
  if (wbCanvas) { wbCanvas.dispose(); wbCanvas = null; }
  wbBoardId = null;
  // Exit fullscreen on close
  if (document.body.classList.contains('wb-fullscreen-mode')) {
    document.body.classList.remove('wb-fullscreen-mode');
  }
  document.getElementById('wb-canvas-view')?.classList.add('hidden');
  document.getElementById('wb-list-view')?.classList.remove('hidden');
}

function closeWbSocket() {
  // ตอนปิด/ย้ายบอร์ดให้ stop reconnect ด้วย ไม่งั้นจะวน reconnect ลอย ๆ
  clearTimeout(_wbReconnectTimer);
  if (wbSocket) {
    try { wbSocket.onclose = null; } catch {}
    try { wbSocket.close(); } catch {}
    wbSocket = null;
  }
  const ub = document.getElementById('wb-users');
  if (ub) ub.innerHTML = '';
}

function handleWbMessage(msg) {
  if (!wbCanvas) return;
  if (msg.type === 'init') {
    if (msg.canvasJson) {
      wbSuppressHistory = true;
      wbCanvas.loadFromJSON(msg.canvasJson, () => {
        wbCanvas.renderAll();
        wbSuppressHistory = false;
        pushHistory();
        // สำคัญ — snapshot ที่เก็บใน Fabric JSON เป็น state ตอน inject เท่านั้น
        // task/group ที่ถูกแก้ที่อื่นจะค้าง ถ้าไม่ resync หลังโหลด
        try { wbSyncCardsToState(); } catch {}
      });
    } else {
      pushHistory();
    }
    renderWbUsers(msg.users || []);
  } else if (msg.type === 'confirmed') {
    if (msg.canvasJson) {
      wbSuppressHistory = true;
      wbCanvas.loadFromJSON(msg.canvasJson, () => {
        wbCanvas.renderAll();
        wbSuppressHistory = false;
      });
    }
    toast(`${msg.by || '?'} บันทึก Whiteboard แล้ว`, '');
  } else if (msg.type === 'op') {
    // Simple sync — server broadcasts canvasJson via op; merge if provided
    if (msg.op?.canvasJson) {
      wbSuppressHistory = true;
      wbCanvas.loadFromJSON(msg.op.canvasJson, () => {
        wbCanvas.renderAll();
        wbSuppressHistory = false;
      });
    }
  } else if (msg.type === 'inject') {
    addInjectCard(msg.op);
  } else if (msg.type === 'user_join' || msg.type === 'user_leave') {
    // Optional: re-render users bar — server already pushes init/users on join
  } else if (msg.type === 'error') {
    toast(msg.message || 'WS error', 'error');
  }
}

function renderWbUsers(users) {
  const bar = document.getElementById('wb-users');
  if (!bar) return;
  bar.innerHTML = (users || []).map(u =>
    `<div class="wb-user-dot" data-uid="${escapeHtml(u.clientId)}"
          style="background:${escapeHtml(u.color || '#6366f1')}"
          title="${escapeHtml(u.name)}">${escapeHtml((u.name || '?')[0].toUpperCase())}</div>`
  ).join('');
}

// Card visual styles per kind — header colour + icon + how to build body lines
const WB_CARD_STYLE = {
  task:           { color: '#0ea5e9', icon: '📋', title: (d) => d.title || 'task' },
  meeting:        { color: '#7c3aed', icon: '📅', title: (d) => d.title || 'meeting' },
  group:          { color: '#10b981', icon: '📁', title: (d) => d.name  || 'group' },
  recording:      { color: '#f59e0b', icon: '🎙', title: (d) => d.label || 'recording' },
  point_request:  { color: '#eab308', icon: '⭐', title: (d) => `ขอเพิ่ม ${d.requested_points || 0} pts` },
  point_decision: { color: '#22c55e', icon: '✅', title: (d) => d.status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว' },
};

function _wbCardLines(kind, d) {
  if (kind === 'task') {
    const lines = [];
    // โครงการที่อยู่ใต้ (ดึงจาก state.groups เพราะ data อาจเก็บแค่ group_id)
    const grp = d.group_id ? (state.groups || []).find(g => g.id === d.group_id) : null;
    if (grp) lines.push(`📁 ${grp.name}`);
    if (d.status)   lines.push(`สถานะ: ${d.status === 'done' ? '✅ เสร็จ' : d.status === 'in_progress' ? '🟡 กำลังทำ' : '⚪ ยังไม่เริ่ม'}`);
    if (d.deadline) lines.push(`⏰ Deadline: ${fmtDate(d.deadline)}`);
    if (d.points != null && d.points > 0) lines.push(`⭐ ${d.points} pts`);
    if (Array.isArray(d.assignees) && d.assignees.length) {
      lines.push(`👥 มอบหมาย (${d.assignees.length}):`);
      lines.push(`   ${d.assignees.map(a => a.name).join(', ')}`);
    }
    if (d.description && String(d.description).trim()) {
      lines.push(''); // เว้น 1 บรรทัด
      lines.push(`📝 ${String(d.description).trim()}`);
    }
    return lines;
  }
  if (kind === 'meeting') {
    const lines = [];
    const grp = d.group_id ? (state.groups || []).find(g => g.id === d.group_id) : null;
    if (grp) lines.push(`📁 ${grp.name}`);
    if (d.deadline) lines.push(`📅 ${meetingTimeText(d.deadline, d.end_time)}`);
    if (d.location_type) {
      const m = LOCATION_META[d.location_type];
      if (m) lines.push(`${m.icon} ${m.label}${d.location_detail ? ' · ' + d.location_detail : ''}`);
    }
    if (Array.isArray(d.assignees) && d.assignees.length) {
      lines.push(`👥 ผู้เข้าร่วม (${d.assignees.length}):`);
      lines.push(`   ${d.assignees.map(a => a.name).join(', ')}`);
    }
    if (d.description && String(d.description).trim()) {
      lines.push('');
      lines.push(`📝 ${String(d.description).trim()}`);
    }
    return lines;
  }
  if (kind === 'group') {
    const lines = [];
    if (d.leader_name) lines.push(`👤 หัวหน้า: ${d.leader_name}`);
    if (d.member_count != null) lines.push(`👥 สมาชิก: ${d.member_count} คน`);
    if (d.status)   lines.push(`สถานะ: ${d.status === 'done' ? '✅ เสร็จ' : d.status === 'in_progress' ? '🟡 กำลังทำ' : '⚪ ยังไม่เริ่ม'}`);
    // Progress: นับงานในกลุ่มจาก state.tasks
    if (d.id) {
      const tasksInGroup = (state.tasks || []).filter(t => t.group_id === d.id && t.kind !== 'meeting');
      if (tasksInGroup.length) {
        const done = tasksInGroup.filter(t => t.status === 'done').length;
        lines.push(`📊 ความคืบหน้า: ${done}/${tasksInGroup.length} งาน (${Math.round(done * 100 / tasksInGroup.length)}%)`);
      }
    }
    if (d.start_date && d.deadline) lines.push(`⏰ ${fmtDate(d.start_date)} → ${fmtDate(d.deadline)}`);
    else if (d.deadline) lines.push(`⏰ ${fmtDate(d.deadline)}`);
    if (d.target && String(d.target).trim()) {
      lines.push('');
      lines.push(`🎯 ${String(d.target).trim()}`);
    }
    if (d.description && String(d.description).trim()) {
      lines.push('');
      lines.push(`📝 ${String(d.description).trim()}`);
    }
    return lines;
  }
  if (kind === 'recording') {
    const lines = [];
    if (d.duration_ms) {
      const s = Math.floor(d.duration_ms / 1000);
      lines.push(`⏱ ${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`);
    }
    if (d.transcript_status === 'pending' || d.transcript_status === 'processing') lines.push('⏳ กำลังถอดเสียง...');
    else if (d.transcript_excerpt) lines.push(`📝 ${String(d.transcript_excerpt).slice(0, 80)}...`);
    else if (d.transcript_status === 'done') lines.push('✅ ถอดเสียงเสร็จแล้ว — ดับเบิลคลิกเพื่อดู');
    return lines;
  }
  if (kind === 'point_request') {
    const lines = [];
    if (d.task_title) lines.push(`📋 ${d.task_title}`);
    if (d.requester_name) lines.push(`👤 ${d.requester_name}`);
    lines.push('— ดับเบิลคลิก: อนุมัติ / ปฏิเสธ —');
    return lines;
  }
  if (kind === 'point_decision') {
    const lines = [];
    if (d.task_title) lines.push(`📋 ${d.task_title}`);
    if (d.requested_points != null) lines.push(`⭐ ${d.requested_points} pts`);
    if (d.requester_name) lines.push(`ผู้ขอ: ${d.requester_name}`);
    if (d.decided_by) lines.push(`โดย: ${d.decided_by}`);
    return lines;
  }
  return [];
}

function addInjectCard(op) {
  if (!wbCanvas || !op?.data) return;
  const d = op.data;
  const kind = op.kind || 'task';
  const style = WB_CARD_STYLE[kind] || WB_CARD_STYLE.task;
  const headerColor = style.color;
  // Special-case the rejected decision so it visually pops red
  const realHeaderColor = (kind === 'point_decision' && d.status === 'rejected') ? '#ef4444' : headerColor;
  const icon = (kind === 'point_decision' && d.status === 'rejected') ? '❌' : style.icon;
  const title = `${icon} ${style.title(d)}`;
  const lines = _wbCardLines(kind, d);

  // กว้างกว่าเดิม (230→300) เพื่อให้รายละเอียดอ่านง่าย ไม่ wrap บ่อย
  const cardW = 300;
  const padX = 10, padY = 8;
  const titleHeight = 32;

  // ใหญ่ขึ้น 1 step ให้คมชัดบน iPad/Retina (font 11 บน high-DPI ดูแตก)
  const bodyFontSize = 12;
  const titleFontSize = 14;

  // สร้าง Textbox ของรายละเอียดก่อน เพื่อวัดความสูงจริง (Fabric auto-wrap
  // ตาม width). บรรทัดว่าง ('') ใช้เป็น spacer สูง ~ 6px
  // `objectCaching: false` กัน Fabric raster-cache text เป็น bitmap ที่ DPR=1
  // แล้วเอามาสเกล (= ตัวอักษรแตก/blur บน Retina + ตอน zoom canvas)
  const detailTexts = lines.map(l => {
    if (l === '') return { _spacer: true, calcTextHeight: () => 6 };
    return new fabric.Textbox(l, {
      left: padX, width: cardW - padX * 2,
      fontSize: bodyFontSize, fill: '#334155',
      fontFamily: 'Sarabun, sans-serif',
      lineHeight: 1.35,
      objectCaching: false,
    });
  });

  // วาง top แต่ละกล่องต่อกัน + คำนวณ cardH รวม
  let cursor = titleHeight + padY;
  for (const tb of detailTexts) {
    if (!tb._spacer) tb.set('top', cursor);
    cursor += (tb.calcTextHeight?.() ?? 16) + 2;
  }
  const cardH = cursor + padY;

  const header      = new fabric.Rect({ width: cardW, height: titleHeight, fill: realHeaderColor, rx: 8, ry: 8 });
  const headerCover = new fabric.Rect({ top: 16, width: cardW, height: titleHeight - 16, fill: realHeaderColor });
  const body        = new fabric.Rect({ top: titleHeight, width: cardW, height: cardH - titleHeight, fill: '#f8fafc' });
  const border      = new fabric.Rect({ width: cardW, height: cardH, fill: 'transparent', stroke: realHeaderColor, strokeWidth: 1, rx: 8, ry: 8 });
  const titleText   = new fabric.Textbox(title, {
    left: padX, top: 7, width: cardW - padX * 2,
    fontSize: titleFontSize, fill: '#fff', fontWeight: 'bold',
    fontFamily: 'Sarabun, sans-serif', objectCaching: false,
  });
  const realDetailTexts = detailTexts.filter(t => !t._spacer);
  const grp = new fabric.Group([body, header, headerCover, border, titleText, ...realDetailTexts], {
    left: 60 + Math.random() * 200,
    top:  60 + Math.random() * 150,
    // ปิด group cache ด้วย — ถ้า group cache เปิด แม้ child จะปิดก็ยัง raster
    objectCaching: false,
  });
  // Stash the source metadata on the group so double-click + SSE refresh can find it
  grp._injectKind   = kind;
  grp._injectId     = d.id || null;
  grp._injectData   = d;
  wbCanvas.add(grp);
  wbCanvas.renderAll();
}

// Double-click on a card → open the matching full form (task / meeting / group)
// or show the approve/reject prompt for a pending point request.
// Wired once via initWhiteboardEvents (via wbCanvas) — see the canvas init code.
async function _wbHandleCardDblClick(target) {
  if (!target || !target._injectKind) return;
  const kind = target._injectKind;
  const id = target._injectId;
  if (kind === 'task' && id) {
    const t = (state.tasks || []).find(x => x.id === id);
    if (t) openTaskEdit(t);
    else toast('งานนี้ถูกลบไปแล้ว', 'error');
    return;
  }
  if (kind === 'meeting' && id) {
    const t = (state.tasks || []).find(x => x.id === id);
    if (t) openMeetingModal(t);
    else toast('ประชุมนี้ถูกลบไปแล้ว', 'error');
    return;
  }
  if (kind === 'group' && id) {
    const g = (state.groups || []).find(x => x.id === id);
    if (g) openGroupModal(g);
    else toast('โครงการนี้ถูกลบไปแล้ว', 'error');
    return;
  }
  if (kind === 'point_request' && id) {
    // Show a 3-button modal: Approve / Reject / Cancel
    const d = target._injectData || {};
    const action = await new Promise(resolve => {
      const m = document.getElementById('confirm-modal');
      const title = document.getElementById('confirm-title');
      const msg = document.getElementById('confirm-msg');
      const ok = document.getElementById('confirm-ok');
      const cancel = document.getElementById('confirm-cancel');
      title.textContent = '⭐ คำขอ Points';
      msg.textContent = `${d.task_title || ''} — ${d.requested_points || 0} pts จาก ${d.requester_name || ''}`;
      ok.textContent = '✅ อนุมัติ'; ok.classList.remove('text-rose-600'); ok.classList.add('text-emerald-600');
      cancel.textContent = '❌ ปฏิเสธ'; cancel.classList.remove('text-slate-600'); cancel.classList.add('text-rose-600');
      m.classList.remove('hidden'); m.classList.add('flex');
      const cleanup = (v) => {
        m.classList.add('hidden'); m.classList.remove('flex');
        ok.onclick = cancel.onclick = m.onclick = null;
        ok.classList.remove('text-emerald-600'); ok.classList.add('text-rose-600');
        cancel.classList.remove('text-rose-600'); cancel.classList.add('text-slate-600');
        resolve(v);
      };
      ok.onclick = () => cleanup('approved');
      cancel.onclick = () => cleanup('rejected');
      m.onclick = (e) => { if (e.target === m) cleanup(null); };
    });
    if (!action) return;
    try {
      await api.post(`/api/point-requests/${id}/decide`, { status: action });
      await api.post(`/api/whiteboards/${wbBoardId}/inject`, {
        kind: 'point_decision',
        data: {
          status: action, task_title: d.task_title,
          requested_points: d.requested_points,
          requester_name: d.requester_name,
          decided_by: state.user?.name,
        },
      });
      toast(action === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว', 'success');
      await loadAll();
    } catch (e) { toast(e.message, 'error'); }
    return;
  }
  if (kind === 'recording' && id) {
    // Open the existing recording detail (simplified: just navigate the dev panel via toast)
    toast('Recording id: ' + id + ' — เปิด /dev → Audio Recorder เพื่อดู transcript เต็ม', '');
    return;
  }
}

// Sync card text to fresh state — called after every loadAll() so edits made
// elsewhere (Todo tab, /dev, another browser) propagate to the canvas.
function wbSyncCardsToState() {
  if (!wbCanvas) return;
  let touched = 0;
  wbCanvas.getObjects().forEach(obj => {
    if (!obj._injectKind || !obj._injectId) return;
    const kind = obj._injectKind, id = obj._injectId;
    let fresh = null;
    if (kind === 'task' || kind === 'meeting') {
      fresh = (state.tasks || []).find(x => x.id === id);
      if (fresh) fresh = {
        id: fresh.id, title: fresh.title, status: fresh.status,
        deadline: fresh.deadline, end_time: fresh.end_time,
        location_type: fresh.location_type, location_detail: meetingDetailFor?.(fresh) || '',
        assignees: (fresh.assignees || []).map(a => ({ name: a.name })),
      };
    } else if (kind === 'group') {
      const g = (state.groups || []).find(x => x.id === id);
      if (g) fresh = {
        id: g.id, name: g.name, leader_name: g.leader_name || '',
        member_count: (g.members || []).length, status: g.status,
        deadline: g.deadline, color: g.color,
      };
    }
    if (!fresh) return;
    // Cheap diff — JSON shorthand to skip identical
    const same = JSON.stringify(obj._injectData) === JSON.stringify(fresh);
    if (same) return;
    // Easiest: remove old card + add new at same position
    const left = obj.left, top = obj.top, angle = obj.angle, scaleX = obj.scaleX, scaleY = obj.scaleY;
    wbCanvas.remove(obj);
    addInjectCard({ kind, data: fresh });
    const newest = wbCanvas.getObjects().at(-1);
    if (newest) { newest.set({ left, top, angle, scaleX, scaleY }); }
    touched++;
  });
  if (touched) wbCanvas.renderAll();
}

function setWbTool(tool) {
  wbActiveTool = tool;
  document.querySelectorAll('.wb-tool[data-tool]').forEach(b => {
    b.classList.toggle('wb-tool-active', b.dataset.tool === tool);
  });
  const wrap = document.getElementById('wb-canvas-wrap');
  if (wrap) wrap.dataset.tool = tool;
  if (!wbCanvas) return;

  // Reset modes
  wbCanvas.isDrawingMode = false;
  wbCanvas.selection = false;
  wbCanvas.skipTargetFind = false;
  wbCanvas.defaultCursor = 'default';

  if (tool === 'select') {
    wbCanvas.selection = true;
  } else if (tool === 'lasso') {
    // Lasso: ใช้ pencil brush วาด path ชั่วคราว, ตอน path สร้างเสร็จ
    // ตรวจว่าวัตถุไหน center อยู่ในวงนั้นแล้ว selection. Path ตัวเองถูกลบทิ้ง
    wbCanvas.isDrawingMode = true;
    const brush = new fabric.PencilBrush(wbCanvas);
    brush.color = 'rgba(99,102,241,.6)';   // indigo dashed-look hint
    brush.width = 2;
    wbCanvas.freeDrawingBrush = brush;
    wbCanvas.defaultCursor = 'crosshair';
  } else if (tool === 'pan') {
    wbCanvas.skipTargetFind = true;
    wbCanvas.defaultCursor = 'grab';
  } else if (tool === 'draw') {
    wbCanvas.isDrawingMode = true;
    const brush = new fabric.PencilBrush(wbCanvas);
    brush.color = document.getElementById('wb-color-pick')?.value || '#1e293b';
    brush.width = parseInt(document.getElementById('wb-stroke-size')?.value || 3, 10);
    wbCanvas.freeDrawingBrush = brush;
  } else if (tool === 'highlight') {
    wbCanvas.isDrawingMode = true;
    const brush = new fabric.PencilBrush(wbCanvas);
    brush.color = hexToRgba(document.getElementById('wb-color-pick')?.value || '#fde047', 0.35);
    brush.width = Math.max(15, parseInt(document.getElementById('wb-stroke-size')?.value || 18, 10));
    wbCanvas.freeDrawingBrush = brush;
  } else if (tool === 'eraser') {
    wbCanvas.skipTargetFind = false;
    wbCanvas.defaultCursor = 'none';   // hide native cursor, use overlay
  }
  // Show/hide custom eraser cursor overlay
  const eraserCur = document.getElementById('wb-eraser-cursor');
  if (eraserCur) eraserCur.classList.toggle('active', tool === 'eraser');
}

// Eraser cursor overlay — follow pointer + size by radius slider
(function setupEraserCursor() {
  const wrap = document.getElementById('wb-canvas-wrap');
  const cur  = document.getElementById('wb-eraser-cursor');
  if (!wrap || !cur) return;
  function updateSize() {
    const r = (typeof wbEraserRadius === 'function') ? wbEraserRadius() : 30;
    // Convert canvas-space radius to screen-space via current zoom
    const zoom = (typeof wbCanvas !== 'undefined' && wbCanvas) ? wbCanvas.getZoom() : 1;
    const screenR = r * zoom;
    cur.style.width = (screenR * 2) + 'px';
    cur.style.height = (screenR * 2) + 'px';
  }
  wrap.addEventListener('pointermove', e => {
    if (wbActiveTool !== 'eraser') return;
    const rect = wrap.getBoundingClientRect();
    cur.style.left = (e.clientX - rect.left + wrap.scrollLeft) + 'px';
    cur.style.top  = (e.clientY - rect.top  + wrap.scrollTop)  + 'px';
    updateSize();
  });
  // Update size when slider changes
  document.getElementById('wb-stroke-size')?.addEventListener('input', updateSize);
})();

function getWbPointer(e) {
  if (!wbCanvas) return { x: 0, y: 0 };
  const p = wbCanvas.getPointer(e);
  return { x: p.x, y: p.y };
}

function getStrokeColor() { return document.getElementById('wb-color-pick')?.value || '#1e293b'; }
function getStrokeWidth() { return parseInt(document.getElementById('wb-stroke-size')?.value || 2, 10); }
function getFill(color) { return wbFillMode ? hexToRgba(color, 0.25) : 'transparent'; }

function wbOnMouseDown(opt) {
  if (!wbCanvas) return;
  const e = opt?.e || opt;
  const p = opt?.pointer || (e && wbCanvas.getPointer(e)) || { x: 0, y: 0 };
  // Pan
  if (wbActiveTool === 'pan') {
    wbIsPanning = true;
    wbPanLast = { x: e.clientX, y: e.clientY };
    document.getElementById('wb-canvas-wrap')?.classList.add('wb-panning');
    return;
  }
  // Eraser
  if (wbActiveTool === 'eraser') {
    wbIsErasing = true;
    eraserAtPoint(p);
    return;
  }
  if (wbActiveTool === 'select' || wbActiveTool === 'draw' || wbActiveTool === 'highlight') return;
  wbIsDrawingShape = true;
  wbShapeOrigin = { x: p.x, y: p.y };
  const color = getStrokeColor();
  const sw = getStrokeWidth();
  const fill = getFill(color);

  if (wbActiveTool === 'rect') {
    wbActiveShape = new fabric.Rect({
      left: wbShapeOrigin.x, top: wbShapeOrigin.y,
      width: 0, height: 0,
      fill, stroke: color, strokeWidth: sw, selectable: false,
    });
  } else if (wbActiveTool === 'circle') {
    wbActiveShape = new fabric.Ellipse({
      left: wbShapeOrigin.x, top: wbShapeOrigin.y,
      rx: 0, ry: 0,
      fill, stroke: color, strokeWidth: sw, selectable: false,
    });
  } else if (wbActiveTool === 'triangle') {
    wbActiveShape = new fabric.Triangle({
      left: wbShapeOrigin.x, top: wbShapeOrigin.y,
      width: 0, height: 0,
      fill, stroke: color, strokeWidth: sw, selectable: false,
    });
  } else if (wbActiveTool === 'diamond') {
    // Start as a polygon; resize in mousemove via scaling its bounding rect approximation
    wbActiveShape = new fabric.Rect({
      left: wbShapeOrigin.x, top: wbShapeOrigin.y,
      width: 0, height: 0, angle: 45,
      fill, stroke: color, strokeWidth: sw, selectable: false,
    });
  } else if (wbActiveTool === 'line' || wbActiveTool === 'arrow') {
    wbActiveShape = new fabric.Line(
      [wbShapeOrigin.x, wbShapeOrigin.y, wbShapeOrigin.x, wbShapeOrigin.y],
      { stroke: color, strokeWidth: sw, selectable: false, _isArrow: wbActiveTool === 'arrow' }
    );
  } else if (wbActiveTool === 'text') {
    const t = new fabric.IText('ข้อความ', {
      left: wbShapeOrigin.x, top: wbShapeOrigin.y, fontSize: 16, fill: color,
      fontFamily: 'Sarabun, sans-serif',
    });
    wbCanvas.add(t); wbCanvas.setActiveObject(t); t.enterEditing();
    wbIsDrawingShape = false; setWbTool('select'); return;
  } else if (wbActiveTool === 'sticky') {
    const stickyColor = '#fef08a';
    const g = new fabric.Group([
      new fabric.Rect({ width: 160, height: 120, fill: stickyColor, rx: 8, ry: 8, shadow: '2px 2px 6px rgba(0,0,0,0.15)' }),
      new fabric.Textbox('Sticky\nNote', { width: 144, fontSize: 13, fill: '#713f12', left: 8, top: 8, fontFamily: 'Sarabun, sans-serif' }),
    ], { left: wbShapeOrigin.x, top: wbShapeOrigin.y });
    wbCanvas.add(g); wbIsDrawingShape = false; setWbTool('select'); return;
  }
  if (wbActiveShape) wbCanvas.add(wbActiveShape);
}

function wbOnMouseMove(opt) {
  if (!wbCanvas) return;
  const e = opt?.e || opt;
  const p = opt?.pointer || (e && wbCanvas.getPointer(e)) || { x: 0, y: 0 };
  // Pan
  if (wbIsPanning && wbPanLast) {
    const vpt = wbCanvas.viewportTransform;
    vpt[4] += e.clientX - wbPanLast.x;
    vpt[5] += e.clientY - wbPanLast.y;
    wbCanvas.requestRenderAll();
    wbPanLast = { x: e.clientX, y: e.clientY };
    return;
  }
  if (wbIsErasing) { eraserAtPoint(p); return; }
  if (!wbIsDrawingShape || !wbActiveShape || !wbShapeOrigin) return;
  const w = p.x - wbShapeOrigin.x, h = p.y - wbShapeOrigin.y;
  if (wbActiveTool === 'rect' || wbActiveTool === 'triangle' || wbActiveTool === 'diamond') {
    wbActiveShape.set({
      width: Math.abs(w), height: Math.abs(h),
      left: w < 0 ? p.x : wbShapeOrigin.x,
      top:  h < 0 ? p.y : wbShapeOrigin.y,
    });
  } else if (wbActiveTool === 'circle') {
    wbActiveShape.set({
      rx: Math.abs(w) / 2, ry: Math.abs(h) / 2,
      left: w < 0 ? p.x : wbShapeOrigin.x,
      top:  h < 0 ? p.y : wbShapeOrigin.y,
    });
  } else if (wbActiveTool === 'line' || wbActiveTool === 'arrow') {
    wbActiveShape.set({ x2: p.x, y2: p.y });
  }
  wbCanvas.renderAll();
}

function wbOnMouseUp(opt) {
  if (wbIsPanning) {
    wbIsPanning = false;
    wbPanLast = null;
    document.getElementById('wb-canvas-wrap')?.classList.remove('wb-panning');
    return;
  }
  if (wbIsErasing) { wbIsErasing = false; return; }
  if (!wbIsDrawingShape) return;
  wbIsDrawingShape = false;
  if (wbActiveShape) {
    // Convert arrow line into a group with arrowhead
    if (wbActiveShape._isArrow) {
      const ln = wbActiveShape;
      wbCanvas.remove(ln);
      const arrowHead = makeArrowHead(ln.x1, ln.y1, ln.x2, ln.y2, ln.stroke);
      const grp = new fabric.Group([
        new fabric.Line([ln.x1, ln.y1, ln.x2, ln.y2], { stroke: ln.stroke, strokeWidth: ln.strokeWidth }),
        arrowHead,
      ], {});
      wbCanvas.add(grp);
    } else {
      wbActiveShape.set({ selectable: true });
    }
    wbActiveShape = null;
  }
  wbCanvas?.renderAll();
  // Stay in shape tool? Or go back to select. Let's keep tool active.
}

function makeArrowHead(x1, y1, x2, y2, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const headLen = 14;
  const p1 = { x: x2, y: y2 };
  const p2 = { x: x2 - headLen * Math.cos(angle - Math.PI / 6), y: y2 - headLen * Math.sin(angle - Math.PI / 6) };
  const p3 = { x: x2 - headLen * Math.cos(angle + Math.PI / 6), y: y2 - headLen * Math.sin(angle + Math.PI / 6) };
  return new fabric.Polygon([p1, p2, p3], { fill: color, stroke: color, strokeWidth: 1 });
}

// Eraser radius (canvas-space) — slider value × 6, min 20
function wbEraserRadius() {
  const w = parseInt(document.getElementById('wb-stroke-size')?.value || '3', 10);
  return Math.max(20, w * 6);
}
// Check if a circle (cx, cy, r) intersects an object's bounding rect
function _circleIntersectsRect(cx, cy, r, rect) {
  const nx = Math.max(rect.left, Math.min(cx, rect.left + rect.width));
  const ny = Math.max(rect.top,  Math.min(cy, rect.top  + rect.height));
  return Math.hypot(cx - nx, cy - ny) <= r;
}
function eraserAtPoint(p) {
  if (!wbCanvas || !p) return;
  const r = wbEraserRadius();
  // Erase ALL objects whose bounding rect intersects with the eraser circle
  // (not just the topmost one) — feels closer to a real eraser
  const toRemove = wbCanvas.getObjects().filter(o => {
    if (o._isLive) return false;             // never erase live preview
    if (o._injectKind) return false;         // protect injected cards (task/group/meeting)
    const br = o.getBoundingRect(true, true);
    return _circleIntersectsRect(p.x, p.y, r, br);
  });
  if (toRemove.length) {
    toRemove.forEach(o => wbCanvas.remove(o));
  }
}

function deleteSelectedObjects() {
  if (!wbCanvas) return;
  const active = wbCanvas.getActiveObjects();
  if (!active.length) return;
  wbCanvas.remove(...active);
  wbCanvas.discardActiveObject();
  wbCanvas.renderAll();
}

function broadcastCanvasOp() {
  if (!wbSocket || wbSocket.readyState !== 1 || !wbCanvas) return;
  if (wbSuppressHistory) return;
  const json = JSON.stringify(wbCanvas.toJSON());
  wbSocket.send(JSON.stringify({ type: 'op', op: { canvasJson: json } }));
}

let _wbBroadcastTimer = null;
function scheduleBroadcast() {
  // Don't schedule while we're applying remote changes — otherwise the
  // receiver echoes back the remote state to the server, server fans it
  // out, and everyone reloads → flicker on every client.
  if (wbSuppressHistory) return;
  if (_wbBroadcastTimer) return;
  _wbBroadcastTimer = setTimeout(() => {
    _wbBroadcastTimer = null;
    if (wbSuppressHistory) return;     // re-check at fire time
    broadcastCanvasOp();
  }, 1500);     // was 120 — 1.5s for stability + auto-save semantics
}

// ===== History =====
let _wbHistoryPending = false;
function pushHistory() {
  if (!wbCanvas || wbSuppressHistory || _wbHistoryPending) return;
  _wbHistoryPending = true;
  // Defer to idle so we don't block the main thread during drawing
  (window.requestIdleCallback || requestAnimationFrame)(() => {
    _wbHistoryPending = false;
    if (!wbCanvas || wbSuppressHistory) return;
    if (wbHistoryIdx < wbHistory.length - 1) wbHistory = wbHistory.slice(0, wbHistoryIdx + 1);
    let snap;
    try { snap = JSON.stringify(wbCanvas.toJSON()); } catch { return; }
    if (wbHistory[wbHistoryIdx] === snap) return;
    wbHistory.push(snap);
    if (wbHistory.length > 50) wbHistory.shift();
    wbHistoryIdx = wbHistory.length - 1;
  });
}

function wbUndo() {
  if (wbHistoryIdx <= 0 || !wbCanvas) return;
  wbHistoryIdx--;
  wbSuppressHistory = true;
  wbCanvas.loadFromJSON(wbHistory[wbHistoryIdx], () => {
    wbCanvas.renderAll();
    wbSuppressHistory = false;
    broadcastCanvasOp();
  });
}

function wbRedo() {
  if (wbHistoryIdx >= wbHistory.length - 1 || !wbCanvas) return;
  wbHistoryIdx++;
  wbSuppressHistory = true;
  wbCanvas.loadFromJSON(wbHistory[wbHistoryIdx], () => {
    wbCanvas.renderAll();
    wbSuppressHistory = false;
    broadcastCanvasOp();
  });
}

// ===== Zoom =====
// Zoom = resize canvas DOM × set Fabric internal zoom together
// → ทำให้ paper visually โต/หด ตามจริง (ไม่ใช่แค่ content inside fixed-size canvas)
// _paperW/_paperH คือขนาด base ที่เก็บไว้ตอน init/setSize เพื่อคำนวณ scaled DOM
function _wbApplyZoom(newZoom, pivotCanvas) {
  if (!wbCanvas) return;
  const z = Math.max(0.2, Math.min(newZoom, 5));
  const baseW = wbCanvas._paperW || wbCanvas.getWidth() / (wbCanvas._cssZoom || 1);
  const baseH = wbCanvas._paperH || wbCanvas.getHeight() / (wbCanvas._cssZoom || 1);
  wbCanvas._cssZoom = z;
  wbCanvas.setWidth(baseW * z);
  wbCanvas.setHeight(baseH * z);
  wbCanvas.setZoom(z);
  // CRITICAL — recompute cached offset for pointer math. Fabric caches
  // canvas position internally; after resize/scroll, pointer reads wrong
  // coords → strokes appear offset from where user actually drew
  wbCanvas.calcOffset();
  wbCanvas.requestRenderAll();
  updateZoomLabel();
}
function wbZoom(factor) {
  if (!wbCanvas) return;
  const cur = wbCanvas._cssZoom || wbCanvas.getZoom() || 1;
  _wbApplyZoom(cur * factor);
}

function wbZoomFit() {
  if (!wbCanvas) return;
  _wbApplyZoom(1);
  wbCanvas.viewportTransform[4] = 0;
  wbCanvas.viewportTransform[5] = 0;
  wbCanvas.requestRenderAll();
}

function updateZoomLabel() {
  const lbl = document.getElementById('wb-zoom-label');
  if (lbl && wbCanvas) lbl.textContent = `${Math.round(wbCanvas.getZoom() * 100)}%`;
}

function resizeWbCanvas() {
  // Paper-size aware — ไม่ override A4/A3/Letter etc. ตอน window resize
  // เฉพาะ infinite canvas เท่านั้นที่ resize ตาม viewport
  if (!wbCanvas || !wbBoardId) return;
  let savedSize = 'a4-p';
  try { savedSize = localStorage.getItem('sml_wb_size_' + wbBoardId) || 'a4-p'; } catch {}
  if (savedSize !== 'infinite') return;   // fixed paper size → no resize
  const wrap = document.getElementById('wb-canvas-wrap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const W = Math.max(rect.width  || window.innerWidth, 800);
  const H = Math.max(rect.height || (window.innerHeight - 180), 901);
  wbCanvas.setWidth(W);
  wbCanvas.setHeight(H);
  wbCanvas.requestRenderAll();
}

// ===== Fullscreen =====
function toggleWbFullscreen() {
  document.body.classList.toggle('wb-fullscreen-mode');
  // Allow CSS to settle, then resize canvas
  setTimeout(resizeWbCanvas, 50);
  setTimeout(resizeWbCanvas, 250);
}

// ===== Helpers =====
function hexToRgba(hex, alpha) {
  const h = (hex || '#000000').replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ============== Embed mode ==============
// When the page loads with `?embed=task|meeting|group&id=X` (or just `?embed=1`
// with a hash deep-link), strip the chrome (topbar, tabs, sidebar) so only the
// edit form is visible. Used by `/dev` whiteboard's double-click handler to
// show a focused edit page inside an iframe without leaving the dev panel.
// On save, post a message back to the parent so it can close the overlay.
const _embedParams = new URLSearchParams(location.search);
const IS_EMBED = _embedParams.has('embed');
if (IS_EMBED) document.documentElement.classList.add('embed-mode');

async function _embedAutoOpen() {
  const kind = _embedParams.get('embed');
  const id = _embedParams.get('id');
  if (!id) return;
  // Force the modal visible immediately and show a loading state so the user
  // sees feedback even before the API call returns.
  const modalEl = document.getElementById('modal');
  const formEl  = document.getElementById('modal-form');
  const titleEl = document.getElementById('modal-title');
  if (modalEl) { modalEl.classList.remove('hidden'); modalEl.classList.add('flex'); }
  if (titleEl) titleEl.textContent = kind === 'group' ? 'กำลังโหลดโครงการ...' :
                                     kind === 'meeting' ? 'กำลังโหลดประชุม...' : 'กำลังโหลดงาน...';
  if (formEl)  formEl.innerHTML = '<div class="p-8 text-center text-slate-500"><div class="text-3xl mb-2">⏳</div>กำลังโหลดข้อมูล...</div>';

  try {
    let entity = null;
    if (kind === 'task' || kind === 'meeting') {
      // Fetch directly via API — don't depend on state.tasks being populated
      // (admin sees all but state might be filtered; regular users might not
      // have this task in state at all but still pass server-side auth).
      try { entity = await api.get('/api/tasks/' + encodeURIComponent(id)); } catch (e) {
        throw new Error('โหลดงานไม่สำเร็จ: ' + (e.message || 'unknown'));
      }
      if (!entity) throw new Error('ไม่พบงาน ID: ' + id);
      if (kind === 'task')    openTaskEdit(entity);
      else                    openMeetingModal(entity);
    } else if (kind === 'group') {
      try { entity = await api.get('/api/groups/' + encodeURIComponent(id)); } catch (e) {
        throw new Error('โหลดโครงการไม่สำเร็จ: ' + (e.message || 'unknown'));
      }
      if (!entity) throw new Error('ไม่พบโครงการ ID: ' + id);
      openGroupModal(entity);
    } else {
      throw new Error('ประเภทไม่ถูกต้อง: ' + kind);
    }
  } catch (err) {
    // Show the error INSIDE the modal so the user sees it (the toast may be
    // covered by the modal in embed mode).
    if (titleEl) titleEl.textContent = '❌ เกิดข้อผิดพลาด';
    if (formEl)  formEl.innerHTML = `
      <div class="p-8 text-center">
        <div class="text-5xl mb-3">⚠️</div>
        <p class="font-medium text-rose-600 mb-3">${escapeHtml(err.message || String(err))}</p>
        <p class="text-xs text-slate-500">ปิดหน้านี้แล้วลองอีกครั้ง หรือเปิด ${escapeHtml(kind)} ID นี้บนหน้าหลัก</p>
      </div>`;
    console.error('[embed] auto-open failed:', err);
  }
}

// Notify parent (the /dev iframe host) when the modal closes — whether the
// user clicked "ยกเลิก", submitted the form, clicked the backdrop, or pressed
// Escape. A MutationObserver on the modal's `class` attribute catches every
// close path uniformly without needing to patch each handler. The earlier
// approach of patching `closeModal` missed the Cancel button because its
// click handler captured the original function reference at module load.
if (IS_EMBED) {
  const _embedModalEl = document.getElementById('modal');
  if (_embedModalEl) {
    let _embedWasOpen = false;
    new MutationObserver(() => {
      const open = !_embedModalEl.classList.contains('hidden');
      if (_embedWasOpen && !open) {
        // Transition: open → closed. Tell the parent to close its iframe.
        try { window.parent?.postMessage({ type: 'sml-embed-closed' }, location.origin); } catch {}
      }
      _embedWasOpen = open;
    }).observe(_embedModalEl, { attributes: true, attributeFilter: ['class'] });
  }
}

// When embedded inside an iframe (e.g. /dev whiteboard's edit overlay), the
// browser's tracking-prevention sometimes blocks the iframe from reading
// localStorage. Ask the parent window for the auth token; it has access to
// the same localStorage (same origin) and forwards it via postMessage.
async function _maybeGetTokenFromParent() {
  if (!IS_EMBED || token || window.parent === window) return;
  return new Promise(resolve => {
    const handler = (e) => {
      if (e.origin !== location.origin) return;
      if (e.data?.type === 'sml-embed-token' && e.data.token) {
        window.removeEventListener('message', handler);
        token = e.data.token;
        try { localStorage.setItem(TOKEN_KEY, token); } catch {}
        resolve();
      }
    };
    window.addEventListener('message', handler);
    try { window.parent.postMessage({ type: 'sml-embed-need-token' }, location.origin); } catch {}
    // Don't hang forever if parent doesn't reply
    setTimeout(() => { window.removeEventListener('message', handler); resolve(); }, 1500);
  });
}

// ============== Init ==============
(async function init() {
  await _maybeGetTokenFromParent();
  if (await tryRestore()) {
    hideLogin();
    await loadAll();
    startEvents();
    if (!_wbEventsInited) { initWhiteboardEvents(); _wbEventsInited = true; }
    setTab(initialTabFromHash());
    if (IS_EMBED) _embedAutoOpen();
  } else {
    // In embed mode the login screen is hidden by CSS — show a visible error
    // instead so the user knows what went wrong (likely token issue).
    if (IS_EMBED) {
      const modalEl = document.getElementById('modal');
      const titleEl = document.getElementById('modal-title');
      const formEl  = document.getElementById('modal-form');
      if (modalEl) { modalEl.classList.remove('hidden'); modalEl.classList.add('flex'); }
      if (titleEl) titleEl.textContent = '❌ ไม่ได้ล็อกอิน';
      if (formEl)  formEl.innerHTML = `
        <div class="p-8 text-center">
          <div class="text-5xl mb-3">🔒</div>
          <p class="font-medium text-rose-600 mb-2">ไม่สามารถ authenticate ใน iframe ได้</p>
          <p class="text-xs text-slate-500">browser อาจบล็อก storage ใน iframe<br>กด "↗ เปิดเต็มจอ" แทน</p>
        </div>`;
    } else {
      showLogin();
    }
  }
})();
