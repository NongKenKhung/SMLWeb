// PostgreSQL data layer. DATABASE_URL must be set (no fallback — SQLite mode was retired).
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const crypto = require('crypto');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is required. Example: postgres://smluser:smlpass@localhost:5432/smartcitylab');
  process.exit(1);
}

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (process.env.NODE_ENV !== 'test') {
  console.log(`[db] using PostgreSQL (${new URL(process.env.DATABASE_URL).host})`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL only when explicitly requested (PGSSLMODE=require). Local docker → no SSL.
  ssl: /^(require|verify-ca|verify-full)$/i.test(process.env.PGSSLMODE || '') ? { rejectUnauthorized: false } : false,
  max: +(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
});

// Surface pool-level errors so they don't crash the process silently.
pool.on('error', (err) => console.error('[pg pool]', err.message));

const uid = () => crypto.randomBytes(8).toString('hex');
const nowIso = () => new Date().toISOString();
const palette = ['#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899'];
const randomColor = () => palette[Math.floor(Math.random() * palette.length)];

const VALID_STATUS = ['in_progress', 'completed', 'cancelled', 'on_hold'];
const VALID_ROLE = ['admin', 'member'];
const VALID_TASK_ROLE = ['leader', 'member'];
const VALID_KIND = ['task', 'meeting'];
const VALID_LOCATION_TYPE = ['', 'online', 'onsite_internal', 'onsite_external'];

const GROUP_PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#0ea5e9','#6366f1','#a855f7','#ec4899','#84cc16'];

// Tiny query helpers — keep call sites short
async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}
async function q1(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows[0] || null;
}
async function exec(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rowCount;
}

// ===== Schema =====
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'member',
      password_hash TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      color         TEXT NOT NULL DEFAULT '#6366f1',
      avatar_url    TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL
    );
    -- Migration for DBs created before phone column was added
    ALTER TABLE members ADD COLUMN IF NOT EXISTS phone  TEXT NOT NULL DEFAULT '';
    ALTER TABLE members ADD COLUMN IF NOT EXISTS prefix TEXT NOT NULL DEFAULT '';
    -- Per-meeting iCalendar SEQUENCE (RFC 5545) — bumps each time we send a REQUEST/CANCEL
    ALTER TABLE tasks   ADD COLUMN IF NOT EXISTS ics_sequence INTEGER NOT NULL DEFAULT 0;

    -- Connection categories:
    --   'personal' (default, existing behavior) — สมาชิก ↔ บริษัทที่ปรึกษา / บุคคลภายนอกส่วนตัว
    --   'agency'   — หน่วยงาน (อบจ./เทศบาล/กระทรวง) ที่ทีมส่งใครไปประสานงาน
    -- For agency rows, member_id is the LIAISON (ทีม member ที่ไปคุย), not the owner.
    -- topics = comma-separated list of subjects ("งบประมาณ, TOR, ติดตาม") relevant to agency rows.
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS kind   TEXT NOT NULL DEFAULT 'personal';
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS topics TEXT NOT NULL DEFAULT '';
    -- liaison_name: free-text name of the EXTERNAL person handling the agency relationship
    -- (not a lab member). Required for kind='agency' rows. member_id still records the
    -- creator for permission tracking (creator/admin can edit), but the displayed
    -- "person → agency" mapping uses liaison_name.
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS liaison_name TEXT NOT NULL DEFAULT '';

    -- Admin-managed runtime flags (e.g. "email_invitations_enabled"). Read at boot
    -- and on settings change so changes take effect without restarting.
    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL,
      updated_by  TEXT REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS task_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_date  TEXT,
      deadline    TEXT,
      status      TEXT NOT NULL DEFAULT 'on_hold',
      target      TEXT NOT NULL DEFAULT '',
      color       TEXT NOT NULL DEFAULT '',
      leader_id   TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      group_id        TEXT REFERENCES task_groups(id) ON DELETE SET NULL,
      points          INTEGER NOT NULL DEFAULT 0,
      start_date      TEXT,
      deadline        TEXT,
      status          TEXT NOT NULL DEFAULT 'on_hold',
      target          TEXT NOT NULL DEFAULT '',
      points_phase    TEXT NOT NULL DEFAULT 'none',
      kind            TEXT NOT NULL DEFAULT 'task',
      location_type   TEXT NOT NULL DEFAULT '',
      location_detail TEXT NOT NULL DEFAULT '',
      created_by      TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_at      TEXT NOT NULL,
      completed_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id      TEXT NOT NULL REFERENCES tasks(id)   ON DELETE CASCADE,
      member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      task_role    TEXT NOT NULL DEFAULT 'member',
      is_supreme   INTEGER NOT NULL DEFAULT 0,
      points_share INTEGER NOT NULL DEFAULT 0,
      claimed_self INTEGER NOT NULL DEFAULT 0,
      assigned_at  TEXT NOT NULL,
      proposed_at  TEXT,
      PRIMARY KEY (task_id, member_id)
    );
    CREATE TABLE IF NOT EXISTS connections (
      id           TEXT PRIMARY KEY,
      member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      company      TEXT NOT NULL,
      contact_name TEXT NOT NULL DEFAULT '',
      contact_role TEXT NOT NULL DEFAULT '',
      phone        TEXT NOT NULL DEFAULT '',
      email        TEXT NOT NULL DEFAULT '',
      notes        TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_files (
      id            TEXT PRIMARY KEY,
      task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      group_id      TEXT REFERENCES task_groups(id) ON DELETE SET NULL,
      uploaded_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
      filename      TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mimetype      TEXT NOT NULL DEFAULT '',
      size          INTEGER NOT NULL DEFAULT 0,
      kind          TEXT NOT NULL DEFAULT 'file',
      url           TEXT,
      label         TEXT,
      uploaded_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id  TEXT NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (group_id, member_id)
    );
    CREATE TABLE IF NOT EXISTS group_invitations (
      id          TEXT PRIMARY KEY,
      group_id    TEXT NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
      member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      invited_by  TEXT REFERENCES members(id) ON DELETE SET NULL,
      kind        TEXT NOT NULL,
      message     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'pending',
      decided_by  TEXT REFERENCES members(id) ON DELETE SET NULL,
      decided_at  TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_invitations (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      invited_by  TEXT REFERENCES members(id) ON DELETE SET NULL,
      kind        TEXT NOT NULL,
      message     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'pending',
      decided_by  TEXT REFERENCES members(id) ON DELETE SET NULL,
      decided_at  TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deadline_requests (
      id                 TEXT PRIMARY KEY,
      task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      requested_by       TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      current_deadline   TEXT,
      requested_deadline TEXT NOT NULL,
      reason             TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'pending',
      decided_by         TEXT REFERENCES members(id) ON DELETE SET NULL,
      decided_at         TEXT,
      created_at         TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_categories (
      task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, category_id)
    );
    CREATE TABLE IF NOT EXISTS leaves (
      id          TEXT PRIMARY KEY,
      member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      start_at    TEXT NOT NULL,
      end_at      TEXT NOT NULL,
      reason      TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS point_requests (
      id               TEXT PRIMARY KEY,
      task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      requested_by     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      current_points   INTEGER NOT NULL,
      requested_points INTEGER NOT NULL,
      reason           TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'pending',
      decided_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
      decided_at       TEXT,
      created_at       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gm_member            ON group_members(member_id);
    CREATE INDEX IF NOT EXISTS idx_gi_group             ON group_invitations(group_id);
    CREATE INDEX IF NOT EXISTS idx_gi_member            ON group_invitations(member_id);
    CREATE INDEX IF NOT EXISTS idx_gi_status            ON group_invitations(status);
    CREATE INDEX IF NOT EXISTS idx_invitations_task     ON task_invitations(task_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_member   ON task_invitations(member_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_status   ON task_invitations(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_group          ON tasks(group_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status         ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_deadline       ON tasks(deadline);
    CREATE INDEX IF NOT EXISTS idx_assignees_member     ON task_assignees(member_id);
    CREATE INDEX IF NOT EXISTS idx_assignees_task       ON task_assignees(task_id);
    CREATE INDEX IF NOT EXISTS idx_connections_member   ON connections(member_id);
    CREATE INDEX IF NOT EXISTS idx_files_task           ON task_files(task_id);
    CREATE INDEX IF NOT EXISTS idx_files_group          ON task_files(group_id);
    CREATE INDEX IF NOT EXISTS idx_dr_status            ON deadline_requests(status);
    CREATE INDEX IF NOT EXISTS idx_tc_task              ON task_categories(task_id);
    CREATE INDEX IF NOT EXISTS idx_tc_cat               ON task_categories(category_id);
    CREATE INDEX IF NOT EXISTS idx_leaves_member        ON leaves(member_id);
    CREATE INDEX IF NOT EXISTS idx_leaves_range         ON leaves(start_at, end_at);
    CREATE INDEX IF NOT EXISTS idx_pr_status            ON point_requests(status);

    CREATE TABLE IF NOT EXISTS whiteboards (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      canvas_json TEXT NOT NULL DEFAULT '{"version":"5.3.1","objects":[]}',
      created_by  TEXT REFERENCES members(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- Audio recordings (binary blobs stored on disk; metadata here)
    CREATE TABLE IF NOT EXISTS recordings (
      id          TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,         -- on-disk file (random hex + ext)
      label       TEXT NOT NULL DEFAULT '',
      mime        TEXT NOT NULL DEFAULT 'audio/webm',
      size_bytes  BIGINT NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      member_id   TEXT REFERENCES members(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rec_member  ON recordings(member_id);
    CREATE INDEX IF NOT EXISTS idx_rec_created ON recordings(created_at DESC);

    -- Transcript columns (added later; safe to re-run)
    -- transcript_status: pending | processing | done | error | skipped
    ALTER TABLE recordings ADD COLUMN IF NOT EXISTS transcript        TEXT NOT NULL DEFAULT '';
    ALTER TABLE recordings ADD COLUMN IF NOT EXISTS transcript_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE recordings ADD COLUMN IF NOT EXISTS transcript_error  TEXT NOT NULL DEFAULT '';
    ALTER TABLE recordings ADD COLUMN IF NOT EXISTS transcribed_at    TEXT;
  `);

  // One-time backfill: assign unique palette colors to existing groups in creation order.
  {
    const blanks = await q("SELECT id FROM task_groups WHERE color = '' ORDER BY created_at ASC");
    if (blanks.length) {
      const taken = new Set((await q("SELECT color FROM task_groups WHERE color != ''")).map(r => r.color));
      for (const row of blanks) {
        let pick = GROUP_PALETTE.find(c => !taken.has(c));
        if (!pick) pick = GROUP_PALETTE[taken.size % GROUP_PALETTE.length];
        await exec('UPDATE task_groups SET color = $1 WHERE id = $2', [pick, row.id]);
        taken.add(pick);
      }
    }
  }

  // Retired status migration (kept for parity with SQLite version)
  await exec(`UPDATE tasks       SET status = 'on_hold' WHERE status = 'pending'`);
  await exec(`UPDATE task_groups SET status = 'on_hold' WHERE status = 'pending'`);
}

// First-run-only data seeding. Skipped when migrating from SQLite (otherwise
// the pre-seeded category IDs would diverge from the source data and break
// task_categories foreign keys).
async function seedDefaults() {
  const c = await q1('SELECT COUNT(*)::int AS c FROM categories');
  if ((c?.c || 0) === 0) {
    const defaults = [
      'เอกสาร - Proposal', 'เอกสาร - TOR', 'เอกสาร - ข้อเสนอราคา',
      'เอกสาร - ข้อเสนอทางเทคนิค', 'เอกสาร - BOQ', 'เอกสาร - หนังสือนำส่ง',
      'เอกสาร - สัญญา', 'เอกสาร - คู่มือ', 'เอกสาร - อื่นๆ',
      'ศิลป์ - ออกแบบสไลด์', 'ศิลป์ - ตัดต่อ VDO', 'ศิลป์ - Poster',
      'Extrovert - วิทยากร', 'Extrovert - Present',
      'Extrovert - คุยงานกับผู้ใหญ่', 'Extrovert - ติวเตอร์',
      'Extrovert - ประสานงาน',
      'ม้าเร็ว - ปริ้นเอกสาร', 'ม้าเร็ว - สั่งของ',
      'ม้าเร็ว - เดินเอกสาร/พัสดุ', 'ม้าเร็ว - คนขับรถ',
      'Dev - HW', 'Dev - SW', 'Dev - AI', 'Dev - CAD',
    ];
    for (const name of defaults) {
      await exec('INSERT INTO categories (id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [uid(), name, nowIso()]);
    }
  }
}

// init() = schema + first-run defaults. server.js calls this on boot.
async function init() {
  await initSchema();
  await seedDefaults();
  return true;
}

// ===== Members =====
// Sort: admins first (CASE = 0), then members (CASE = 1); within each role, oldest first.
async function listMembers() {
  return q(`SELECT id, prefix, name, role, email, phone, color, avatar_url, created_at FROM members
            ORDER BY (CASE role WHEN 'admin' THEN 0 ELSE 1 END), created_at ASC`);
}
async function getMember(id) {
  return q1('SELECT id, prefix, name, role, email, phone, color, avatar_url, created_at FROM members WHERE id = $1', [id]);
}
async function getMemberFull(id) {
  return q1('SELECT * FROM members WHERE id = $1', [id]);
}
async function findMemberByName(name) {
  return q1('SELECT * FROM members WHERE LOWER(name) = LOWER($1)', [name]);
}
async function createMember({ name, prefix, role, password_hash, email, phone, color, avatar_url }) {
  const m = {
    id: uid(),
    name: String(name || '').trim(),
    prefix: String(prefix || '').trim(),
    role: VALID_ROLE.includes(role) ? role : 'member',
    password_hash: password_hash || '',
    email: String(email || '').trim(),
    phone: String(phone || '').trim(),
    color: color || randomColor(),
    avatar_url: avatar_url || '',
    created_at: nowIso(),
  };
  await exec(
    'INSERT INTO members (id, prefix, name, role, password_hash, email, phone, color, avatar_url, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [m.id, m.prefix, m.name, m.role, m.password_hash, m.email, m.phone, m.color, m.avatar_url, m.created_at]
  );
  const { password_hash: _, ...pub } = m;
  return pub;
}
async function setMemberAvatar(id, avatar_url) {
  await exec('UPDATE members SET avatar_url = $1 WHERE id = $2', [avatar_url || '', id]);
  return getMember(id);
}
async function updateMember(id, patch) {
  const cur = await getMember(id);
  if (!cur) return null;
  await exec(
    'UPDATE members SET prefix=$1, name=$2, role=$3, email=$4, phone=$5, color=$6 WHERE id=$7',
    [
      patch.prefix !== undefined ? String(patch.prefix).trim() : (cur.prefix || ''),
      patch.name  !== undefined ? String(patch.name).trim()  : cur.name,
      patch.role  !== undefined && VALID_ROLE.includes(patch.role) ? patch.role : cur.role,
      patch.email !== undefined ? String(patch.email).trim() : cur.email,
      patch.phone !== undefined ? String(patch.phone).trim() : (cur.phone || ''),
      patch.color !== undefined ? String(patch.color)        : cur.color,
      id,
    ]
  );
  return getMember(id);
}
async function setMemberPassword(id, password_hash) {
  await exec('UPDATE members SET password_hash = $1 WHERE id = $2', [password_hash, id]);
}
async function deleteMember(id) {
  return (await exec('DELETE FROM members WHERE id = $1', [id])) > 0;
}

// ===== Groups =====
async function listGroups() {
  return q(`SELECT g.*, m.name AS leader_name, m.color AS leader_color,
                   (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count
            FROM task_groups g LEFT JOIN members m ON m.id = g.leader_id
            ORDER BY g.created_at ASC`);
}
async function getGroup(id) {
  return q1('SELECT * FROM task_groups WHERE id = $1', [id]);
}
function normalizeColor(c) {
  if (!c) return '';
  const s = String(c).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : '';
}
async function pickUnusedColor(excludeId = null) {
  const taken = new Set((await q("SELECT color FROM task_groups WHERE color != ''")).map(r => r.color));
  if (excludeId) {
    const cur = await getGroup(excludeId);
    if (cur && cur.color) taken.delete(cur.color);
  }
  let pick = GROUP_PALETTE.find(c => !taken.has(c));
  if (!pick) pick = GROUP_PALETTE[taken.size % GROUP_PALETTE.length];
  return pick;
}
async function createGroup(input) {
  let leader_id = input.leader_id || null;
  if (leader_id && !(await getMember(leader_id))) leader_id = null;

  let color = normalizeColor(input.color);
  if (color) {
    const taken = await q1('SELECT id FROM task_groups WHERE color = $1', [color]);
    if (taken) throw new Error('สีที่เลือกถูกใช้กับกลุ่มอื่นแล้ว — กรุณาเลือกสีอื่น');
  } else {
    color = await pickUnusedColor();
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const g = {
    id: uid(),
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
    start_date: input.start_date || todayIso,
    deadline:   input.deadline   || null,
    status: VALID_STATUS.includes(input.status) ? input.status : 'on_hold',
    target: String(input.target || '').trim(),
    color,
    leader_id,
    created_at: nowIso(),
  };
  await exec(
    `INSERT INTO task_groups (id, name, description, start_date, deadline, status, target, color, leader_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [g.id, g.name, g.description, g.start_date, g.deadline, g.status, g.target, g.color, g.leader_id, g.created_at]
  );
  if (g.leader_id) await addGroupMember(g.id, g.leader_id);
  return g;
}
async function updateGroup(id, patch) {
  const cur = await getGroup(id);
  if (!cur) return null;
  let leader_id = cur.leader_id;
  if (patch.leader_id !== undefined) {
    leader_id = patch.leader_id || null;
    if (leader_id && !(await getMember(leader_id))) leader_id = null;
  }
  let color = cur.color;
  if (patch.color !== undefined && patch.color !== null && patch.color !== '') {
    const newColor = normalizeColor(patch.color);
    if (!newColor) throw new Error('รหัสสีไม่ถูกต้อง (ต้องเป็น #RRGGBB)');
    if (newColor !== cur.color) {
      const taken = await q1('SELECT id FROM task_groups WHERE color = $1 AND id != $2', [newColor, id]);
      if (taken) throw new Error('สีที่เลือกถูกใช้กับกลุ่มอื่นแล้ว — กรุณาเลือกสีอื่น');
    }
    color = newColor;
  }
  await exec(
    `UPDATE task_groups SET name=$1, description=$2, start_date=$3, deadline=$4, status=$5,
                            target=$6, color=$7, leader_id=$8 WHERE id=$9`,
    [
      patch.name        !== undefined ? String(patch.name).trim()        : cur.name,
      patch.description !== undefined ? String(patch.description).trim() : cur.description,
      patch.start_date  !== undefined ? (patch.start_date || null)       : cur.start_date,
      patch.deadline    !== undefined ? (patch.deadline   || null)       : cur.deadline,
      patch.status      !== undefined && VALID_STATUS.includes(patch.status) ? patch.status : cur.status,
      patch.target      !== undefined ? String(patch.target).trim()      : (cur.target || ''),
      color,
      leader_id,
      id,
    ]
  );
  if (leader_id && leader_id !== cur.leader_id) await addGroupMember(id, leader_id);
  return getGroup(id);
}
async function deleteGroup(id) {
  return (await exec('DELETE FROM task_groups WHERE id = $1', [id])) > 0;
}
async function isGroupLeader(groupId, memberId) {
  const g = await getGroup(groupId);
  return !!(g && g.leader_id === memberId);
}

// ===== Tasks =====
async function listAssigneesForTask(taskId) {
  // email is required by the mailer (iMIP invitations); phone is included for completeness
  return q(`
    SELECT m.id, m.name, m.role, m.email, m.phone, m.color, m.avatar_url,
           ta.task_role, ta.is_supreme, ta.points_share, ta.claimed_self, ta.assigned_at, ta.proposed_at
    FROM task_assignees ta JOIN members m ON m.id = ta.member_id
    WHERE ta.task_id = $1
    ORDER BY ta.is_supreme DESC, ta.task_role DESC, ta.assigned_at ASC
  `, [taskId]);
}
async function listCategoriesForTask(taskId) {
  return q(`SELECT c.id, c.name FROM categories c
            JOIN task_categories tc ON tc.category_id = c.id
            WHERE tc.task_id = $1 ORDER BY c.name ASC`, [taskId]);
}
async function attachAssignees(taskRow) {
  if (!taskRow) return null;
  let target = taskRow.target || '';
  if (taskRow.group_id) {
    const g = await getGroup(taskRow.group_id);
    if (g && g.target) target = g.target;
    else if (g) target = '';
  }
  const [assignees, categories] = await Promise.all([
    listAssigneesForTask(taskRow.id),
    listCategoriesForTask(taskRow.id),
  ]);
  return { ...taskRow, target, assignees, categories };
}
async function getTask(id) {
  const row = await q1('SELECT * FROM tasks WHERE id = $1', [id]);
  return attachAssignees(row);
}

// Common Thai abbreviations used in the lab's domain.
// Bidirectional: search query in either form matches haystack containing the other.
// Mirror of public/app.js#ABBREVIATIONS — keep them in sync when adding pairs.
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
// One-way expansion: SHORT → LONG only. Reverse direction would over-match
// because 2-letter abbreviations like "ทอ" are substrings of many Thai words.
function expandSearchToken(token) {
  const t = String(token).toLowerCase().trim().replace(/\.+$/, '');
  if (!t) return [];
  const out = new Set([t]);
  for (const [abbr, full] of ABBREVIATIONS) {
    const a = abbr.toLowerCase().replace(/\.+$/, '');
    if (t === a) out.add(full.toLowerCase());
  }
  return Array.from(out);
}
// Returns true iff at least one variant of `tok` appears in lower-cased `hay`.
function tokenInHay(tok, hay) {
  return expandSearchToken(tok).some(v => hay.includes(v));
}

async function fuzzyScoreAsync(query, task) {
  if (!query) return 1;
  const qLow = String(query).toLowerCase().trim();
  if (!qLow) return 1;
  const grp = task.group_id ? await getGroup(task.group_id) : null;
  const haystack = [
    task.title, task.description, task.target,
    grp?.name, grp?.description,
    ...(task.assignees || []).map(a => a.name),
  ].filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return 0;
  // Direct phrase match (fastest, highest weight)
  if (haystack.includes(qLow)) return 1000 + Math.max(0, 100 - qLow.length);
  // Per-word match WITH abbreviation expansion (e.g. "ทอ" → also tries "ทหารอากาศ")
  const words = qLow.split(/\s+/).filter(Boolean);
  let wordHits = 0;
  for (const w of words) if (tokenInHay(w, haystack)) wordHits++;
  if (wordHits) return 500 + wordHits * 50 + (wordHits === words.length ? 200 : 0);
  // Final fallback: bigram overlap (typo / partial match heuristic)
  const bigrams = (s) => { const out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };
  const a = bigrams(qLow), b = bigrams(haystack);
  let overlap = 0; for (const x of a) if (b.has(x)) overlap++;
  if (qLow.length < 4 && overlap < 2) return 0;
  return overlap;
}

async function listTasks(filter = {}) {
  let sql = 'SELECT t.* FROM tasks t WHERE 1=1';
  const params = [];
  let i = 1;
  if (filter.group)  { sql += ` AND t.group_id = $${i++}`; params.push(filter.group); }
  if (filter.status) { sql += ` AND t.status = $${i++}`;   params.push(filter.status); }
  if (filter.member) {
    sql += ` AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.member_id = $${i++})`;
    params.push(filter.member);
  }
  if (filter.unassigned === true || filter.unassigned === '1' || filter.unassigned === 'true') {
    sql += ' AND NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)';
  }
  if (filter.target) {
    sql += ` AND EXISTS (SELECT 1 FROM task_groups g WHERE g.id = t.group_id AND LOWER(g.target) LIKE $${i++})`;
    params.push('%' + String(filter.target).toLowerCase() + '%');
  }
  // ISO date strings sort lexically the same as date order — no need for ::date cast
  const sortMap = {
    deadline:      't.deadline ASC NULLS LAST, t.created_at ASC',
    deadline_desc: 't.deadline DESC NULLS LAST, t.created_at ASC',
    start:         't.start_date ASC NULLS LAST, t.created_at ASC',
    start_desc:    't.start_date DESC NULLS LAST, t.created_at ASC',
    points:        't.points DESC',
    created:       't.created_at ASC',
    created_desc:  't.created_at DESC',
  };
  const sortKey = (filter.sort || 'created') + (filter.sort && filter.dir === 'desc' ? '_desc' : '');
  const orderBy = sortMap[sortKey] || sortMap[filter.sort] || sortMap.created;
  sql += ' ORDER BY ' + orderBy;

  const rows = await q(sql, params);
  let attached = await Promise.all(rows.map(attachAssignees));
  if (filter.q) {
    const scored = await Promise.all(attached.map(async t => ({ t, score: await fuzzyScoreAsync(filter.q, t) })));
    attached = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.t);
  }
  return attached;
}

async function createTask(input, opts = {}) {
  if (input.group_id && !(await getGroup(input.group_id))) throw new Error('invalid group_id');

  const assigneeSpec = Array.isArray(input.assignees) ? input.assignees
                     : Array.isArray(input.assignee_ids) ? input.assignee_ids.map(id => ({ id, role: 'member', points_share: 0 }))
                     : (input.assignee_id ? [{ id: input.assignee_id, role: 'member', points_share: 0 }] : []);
  if (!assigneeSpec.length) throw new Error('ต้องระบุผู้รับผิดชอบอย่างน้อย 1 คน');

  const validSpecs = [];
  for (const raw of assigneeSpec) {
    const spec = typeof raw === 'string' ? { id: raw } : raw;
    if (await getMember(spec.id)) validSpecs.push(spec);
  }
  if (validSpecs.length === 0) throw new Error('ผู้รับผิดชอบที่ระบุไม่มีในระบบ');

  const status = VALID_STATUS.includes(input.status) ? input.status : 'on_hold';
  const explicitPhase = input.points_phase && ['none','proposing','leader_review','final_review','confirmed'].includes(input.points_phase);
  let points_phase = explicitPhase ? input.points_phase : (status === 'completed' ? 'proposing' : 'none');

  const kind = VALID_KIND.includes(input.kind) ? input.kind : 'task';
  const location_type = (kind === 'meeting' && VALID_LOCATION_TYPE.includes(input.location_type))
    ? input.location_type : '';
  const location_detail = kind === 'meeting' ? String(input.location_detail || '').trim() : '';

  if (!input.deadline) throw new Error('ต้องระบุ Deadline');

  const todayIso = new Date().toISOString().slice(0, 10);
  const startDate = input.start_date || (kind === 'meeting' ? null : todayIso);

  const t = {
    id: uid(),
    title: String(input.title || '').trim(),
    description: String(input.description || '').trim(),
    group_id: input.group_id || null,
    points: Number.isFinite(+input.points) ? Math.max(0, +input.points) : 0,
    start_date: startDate,
    deadline:   input.deadline   || null,
    status,
    target: String(input.target || '').trim(),
    points_phase,
    kind,
    location_type,
    location_detail,
    created_by: opts.created_by || null,
    created_at: nowIso(),
    completed_at: status === 'completed' ? nowIso() : null,
  };
  await exec(
    `INSERT INTO tasks
     (id, title, description, group_id, points, start_date, deadline, status, target, points_phase,
      kind, location_type, location_detail, created_by, created_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [t.id, t.title, t.description, t.group_id, t.points, t.start_date, t.deadline, t.status, t.target, t.points_phase,
     t.kind, t.location_type, t.location_detail, t.created_by, t.created_at, t.completed_at]
  );

  for (const spec of validSpecs) {
    const points_share = (points_phase === 'confirmed' && Number.isFinite(+spec.points_share))
      ? Math.max(0, +spec.points_share) : 0;
    const proposed_at = (points_phase !== 'none' && points_share > 0) ? nowIso() : null;
    await exec(
      `INSERT INTO task_assignees (task_id, member_id, task_role, is_supreme, points_share, claimed_self, assigned_at, proposed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [t.id, spec.id, 'member', 0, points_share, 0, nowIso(), proposed_at]
    );
    if (t.group_id) await addGroupMember(t.group_id, spec.id);
  }
  if (Array.isArray(input.category_ids)) {
    for (const cid of input.category_ids) {
      if (cid && await q1('SELECT 1 FROM categories WHERE id = $1', [cid])) {
        await exec('INSERT INTO task_categories (task_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t.id, cid]);
      }
    }
  }
  return getTask(t.id);
}

async function updateTask(id, patch) {
  const cur = await q1('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!cur) return null;
  if (patch.group_id !== undefined && patch.group_id && !(await getGroup(patch.group_id))) throw new Error('invalid group_id');
  const nextStatus = patch.status !== undefined && VALID_STATUS.includes(patch.status) ? patch.status : cur.status;
  let completed_at = cur.completed_at;
  if (nextStatus === 'completed' && cur.status !== 'completed') completed_at = nowIso();
  if (nextStatus !== 'completed') completed_at = null;

  const nextPoints = patch.points !== undefined && Number.isFinite(+patch.points)
                       ? Math.max(0, +patch.points) : cur.points;

  let nextPhase = cur.points_phase || 'none';
  if (nextStatus === 'completed' && cur.status !== 'completed') {
    nextPhase = 'proposing';
  } else if (cur.status === 'completed' && nextStatus !== 'completed') {
    nextPhase = 'none';
  }
  if (patch.points_phase && ['none','proposing','leader_review','final_review','confirmed'].includes(patch.points_phase)) {
    nextPhase = patch.points_phase;
  }

  const nextKind = patch.kind !== undefined && VALID_KIND.includes(patch.kind) ? patch.kind : cur.kind;
  let nextLocType = cur.location_type, nextLocDetail = cur.location_detail;
  if (nextKind !== 'meeting') {
    nextLocType = '';
    nextLocDetail = '';
  } else {
    if (patch.location_type !== undefined) {
      nextLocType = VALID_LOCATION_TYPE.includes(patch.location_type) ? patch.location_type : nextLocType;
    }
    if (patch.location_detail !== undefined) {
      nextLocDetail = String(patch.location_detail || '').trim();
    }
  }

  await exec(
    `UPDATE tasks SET title=$1, description=$2, group_id=$3, points=$4, start_date=$5, deadline=$6,
                      status=$7, target=$8, points_phase=$9, kind=$10, location_type=$11,
                      location_detail=$12, completed_at=$13 WHERE id=$14`,
    [
      patch.title       !== undefined ? String(patch.title).trim()       : cur.title,
      patch.description !== undefined ? String(patch.description).trim() : cur.description,
      patch.group_id    !== undefined ? (patch.group_id || null)         : cur.group_id,
      nextPoints,
      patch.start_date  !== undefined ? (patch.start_date || null)       : cur.start_date,
      patch.deadline    !== undefined ? (patch.deadline   || null)       : cur.deadline,
      nextStatus,
      patch.target      !== undefined ? String(patch.target).trim()      : cur.target,
      nextPhase,
      nextKind,
      nextLocType,
      nextLocDetail,
      completed_at,
      id,
    ]
  );

  if (cur.status === 'completed' && nextStatus !== 'completed') {
    await exec('UPDATE task_assignees SET points_share = 0, proposed_at = NULL WHERE task_id = $1', [id]);
  }
  if (nextStatus === 'completed' && cur.status !== 'completed') {
    await exec('UPDATE task_assignees SET points_share = 0, proposed_at = NULL WHERE task_id = $1', [id]);
  }

  if (Array.isArray(patch.assignee_ids)) {
    if (patch.assignee_ids.length === 0) throw new Error('ต้องระบุผู้รับผิดชอบอย่างน้อย 1 คน');
    const validIds = [];
    for (const mid of patch.assignee_ids) {
      if (await getMember(mid)) validIds.push(mid);
    }
    if (validIds.length === 0) throw new Error('ผู้รับผิดชอบที่ระบุไม่มีในระบบ');
    await exec('DELETE FROM task_assignees WHERE task_id = $1', [id]);
    for (const mid of validIds) {
      await exec(
        `INSERT INTO task_assignees (task_id, member_id, task_role, is_supreme, points_share, claimed_self, assigned_at, proposed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [id, mid, 'member', 0, 0, 0, nowIso(), null]
      );
    }
  }
  if (Array.isArray(patch.category_ids)) {
    await exec('DELETE FROM task_categories WHERE task_id = $1', [id]);
    for (const cid of patch.category_ids) {
      if (cid && await q1('SELECT 1 FROM categories WHERE id = $1', [cid])) {
        await exec('INSERT INTO task_categories (task_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, cid]);
      }
    }
  }
  return getTask(id);
}
async function deleteTask(id) {
  return (await exec('DELETE FROM tasks WHERE id = $1', [id])) > 0;
}

// Atomically increment + return the new ICS sequence for a meeting.
// Used by the mailer when sending REQUEST or CANCEL for a meeting that has
// already been invited at least once (every send bumps SEQUENCE by 1).
async function bumpIcsSequence(taskId) {
  const r = await q1('UPDATE tasks SET ics_sequence = ics_sequence + 1 WHERE id = $1 RETURNING ics_sequence', [taskId]);
  return r ? r.ics_sequence : 0;
}

// ===== App settings (key/value, admin-managed) =====
async function getSetting(key, defaultVal = null) {
  const r = await q1('SELECT value FROM app_settings WHERE key = $1', [key]);
  return r ? r.value : defaultVal;
}
async function setSetting(key, value, byMemberId = null) {
  await exec(
    `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [key, String(value ?? ''), nowIso(), byMemberId]
  );
}
async function listSettings() {
  return q('SELECT key, value, updated_at, updated_by FROM app_settings ORDER BY key');
}

async function claimTask(taskId, memberId, opts = {}) {
  const task = await q1('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (!task) throw new Error('task not found');
  if (!(await getMember(memberId))) throw new Error('member not found');
  const exists = await q1('SELECT * FROM task_assignees WHERE task_id = $1 AND member_id = $2', [taskId, memberId]);
  if (exists) return getTask(taskId);
  await exec(
    `INSERT INTO task_assignees (task_id, member_id, task_role, is_supreme, points_share, claimed_self, assigned_at, proposed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [taskId, memberId, 'member', 0, 0, opts.claimedSelf ? 1 : 0, nowIso(), null]
  );
  if (task.group_id) await addGroupMember(task.group_id, memberId);
  return getTask(taskId);
}
async function dropTask(taskId, memberId) {
  const assignees = await listAssigneesForTask(taskId);
  if (assignees.length <= 1 && assignees.some(a => a.id === memberId)) {
    throw new Error('ปล่อยงานไม่ได้ — งานต้องมีผู้รับผิดชอบอย่างน้อย 1 คน (มอบหมายให้คนอื่นก่อน)');
  }
  await exec('DELETE FROM task_assignees WHERE task_id = $1 AND member_id = $2', [taskId, memberId]);
  return getTask(taskId);
}
async function getAssignee(taskId, memberId) {
  return q1('SELECT * FROM task_assignees WHERE task_id = $1 AND member_id = $2', [taskId, memberId]);
}
async function isAssigned(taskId, memberId)  { return !!(await getAssignee(taskId, memberId)); }
async function isLeader(taskId, memberId) { const a = await getAssignee(taskId, memberId); return !!(a && a.task_role === 'leader'); }
async function isSupremeLeader(taskId, memberId) { const a = await getAssignee(taskId, memberId); return !!(a && a.is_supreme === 1); }
async function setAssigneeRole(taskId, memberId, taskRole) {
  if (!VALID_TASK_ROLE.includes(taskRole)) throw new Error('invalid task_role');
  await exec('UPDATE task_assignees SET task_role = $1 WHERE task_id = $2 AND member_id = $3', [taskRole, taskId, memberId]);
  return getTask(taskId);
}
async function setAssigneePointsShare(taskId, memberId, pts) {
  const t = await q1('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (!t) throw new Error('task not found');
  if (t.status !== 'completed') throw new Error('แบ่ง Points ได้เฉพาะงานที่เสร็จแล้ว');
  if (t.points_phase === 'none') throw new Error('งานนี้ยังไม่อยู่ในขั้นตอนแบ่ง Point');
  await exec('UPDATE task_assignees SET points_share = $1 WHERE task_id = $2 AND member_id = $3',
    [Math.max(0, +pts || 0), taskId, memberId]);
  return getTask(taskId);
}

async function proposeOwnPoints(taskId, memberId, pts) {
  const t = await q1('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (!t) throw new Error('task not found');
  if (t.status !== 'completed') throw new Error('กำหนด Point ได้เฉพาะงานที่เสร็จแล้ว');
  if (t.points_phase !== 'proposing') throw new Error('ตอนนี้ไม่อยู่ในขั้นตอนผู้รับผิดชอบกำหนด Point');
  const a = await getAssignee(taskId, memberId);
  if (!a) throw new Error('คุณไม่ได้รับผิดชอบงานนี้');
  await exec('UPDATE task_assignees SET points_share = $1, proposed_at = $2 WHERE task_id = $3 AND member_id = $4',
    [Math.max(0, +pts || 0), nowIso(), taskId, memberId]);
  const all = await listAssigneesForTask(taskId);
  if (all.length > 0 && all.every(x => x.proposed_at)) {
    await exec('UPDATE tasks SET points_phase = $1 WHERE id = $2', ['leader_review', taskId]);
  }
  return getTask(taskId);
}
async function leaderApprovePoints(taskId) {
  const t = await q1('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (!t) throw new Error('task not found');
  if (t.points_phase !== 'leader_review') throw new Error('งานนี้ยังไม่อยู่ในขั้นตอนหัวหน้ากลุ่มตรวจสอบ');
  await exec('UPDATE tasks SET points_phase = $1 WHERE id = $2', ['final_review', taskId]);
  return getTask(taskId);
}
async function confirmPoints(taskId) {
  const t = await q1('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (!t) throw new Error('task not found');
  if (t.points_phase !== 'final_review') throw new Error('งานนี้ยังไม่อยู่ในขั้นตอนยืนยัน Point');
  await exec('UPDATE tasks SET points_phase = $1 WHERE id = $2', ['confirmed', taskId]);
  return getTask(taskId);
}
async function reopenPoints(taskId) {
  const t = await q1('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (!t) throw new Error('task not found');
  if (t.points_phase !== 'confirmed') throw new Error('เปิด Point อีกครั้งได้เฉพาะงานที่ยืนยันแล้ว');
  await exec('UPDATE tasks SET points_phase = $1 WHERE id = $2', ['final_review', taskId]);
  return getTask(taskId);
}
async function bulkSetShares(taskId, sharesMap) {
  const t = await q1('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (!t) throw new Error('task not found');
  if (!['leader_review','final_review'].includes(t.points_phase)) {
    throw new Error('แก้ไข Point ได้เฉพาะขั้นตอนตรวจสอบหัวหน้ากลุ่ม / ที่ประชุม');
  }
  for (const [memberId, pts] of Object.entries(sharesMap || {})) {
    const exists = await getAssignee(taskId, memberId);
    if (exists) {
      await exec('UPDATE task_assignees SET points_share = $1 WHERE task_id = $2 AND member_id = $3',
        [Math.max(0, +pts || 0), taskId, memberId]);
    }
  }
  return getTask(taskId);
}

// ===== Connections =====
async function listConnections() {
  return q(`SELECT c.*, m.name AS member_name, m.color AS member_color, m.avatar_url AS member_avatar
            FROM connections c JOIN members m ON m.id = c.member_id
            ORDER BY c.created_at DESC`);
}
async function getConnection(id) {
  return q1('SELECT * FROM connections WHERE id = $1', [id]);
}
const VALID_CONNECTION_KIND = ['personal', 'agency'];
async function createConnection(input) {
  if (!input.member_id || !(await getMember(input.member_id))) throw new Error('invalid member_id');
  if (!input.company || !String(input.company).trim()) throw new Error('company required');
  const kind = VALID_CONNECTION_KIND.includes(input.kind) ? input.kind : 'personal';
  const liaison_name = String(input.liaison_name || '').trim();
  if (kind === 'agency' && !liaison_name) throw new Error('ชื่อผู้ประสานงานจำเป็นสำหรับ agency contact');
  const c = {
    id: uid(),
    member_id: input.member_id,
    company: String(input.company).trim(),
    contact_name: String(input.contact_name || '').trim(),
    contact_role: String(input.contact_role || '').trim(),
    phone: String(input.phone || '').trim(),
    email: String(input.email || '').trim(),
    notes: String(input.notes || '').trim(),
    kind,
    topics: String(input.topics || '').trim(),
    liaison_name,
    created_at: nowIso(),
  };
  await exec(
    `INSERT INTO connections (id, member_id, company, contact_name, contact_role, phone, email, notes, kind, topics, liaison_name, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [c.id, c.member_id, c.company, c.contact_name, c.contact_role, c.phone, c.email, c.notes, c.kind, c.topics, c.liaison_name, c.created_at]
  );
  return c;
}
async function updateConnection(id, patch) {
  const cur = await getConnection(id);
  if (!cur) return null;
  const nextKind = patch.kind !== undefined && VALID_CONNECTION_KIND.includes(patch.kind) ? patch.kind : (cur.kind || 'personal');
  const nextLiaison = patch.liaison_name !== undefined ? String(patch.liaison_name).trim() : (cur.liaison_name || '');
  if (nextKind === 'agency' && !nextLiaison) throw new Error('ชื่อผู้ประสานงานจำเป็นสำหรับ agency contact');
  await exec(
    `UPDATE connections SET member_id=$1, company=$2, contact_name=$3, contact_role=$4,
                            phone=$5, email=$6, notes=$7, kind=$8, topics=$9, liaison_name=$10 WHERE id=$11`,
    [
      patch.member_id    !== undefined ? patch.member_id : cur.member_id,
      patch.company      !== undefined ? String(patch.company).trim() : cur.company,
      patch.contact_name !== undefined ? String(patch.contact_name).trim() : cur.contact_name,
      patch.contact_role !== undefined ? String(patch.contact_role).trim() : cur.contact_role,
      patch.phone        !== undefined ? String(patch.phone).trim()  : cur.phone,
      patch.email        !== undefined ? String(patch.email).trim() : cur.email,
      patch.notes        !== undefined ? String(patch.notes).trim() : cur.notes,
      nextKind,
      patch.topics       !== undefined ? String(patch.topics).trim() : (cur.topics || ''),
      nextLiaison,
      id,
    ]
  );
  return getConnection(id);
}
async function deleteConnection(id) {
  return (await exec('DELETE FROM connections WHERE id = $1', [id])) > 0;
}

// ===== Files =====
function folderForGroup(groupId) { return groupId || '_nogroup'; }
function uploadDir(groupId) {
  const dir = path.join(UPLOAD_DIR, folderForGroup(groupId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
async function recordFile({ task_id, group_id, uploaded_by, filename, original_name, mimetype, size }) {
  const f = {
    id: uid(),
    task_id, group_id: group_id || null, uploaded_by: uploaded_by || null,
    filename, original_name, mimetype: mimetype || '', size: size || 0,
    kind: 'file', url: null, label: null,
    uploaded_at: nowIso(),
  };
  await exec(
    `INSERT INTO task_files (id, task_id, group_id, uploaded_by, filename, original_name, mimetype, size, kind, url, label, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [f.id, f.task_id, f.group_id, f.uploaded_by, f.filename, f.original_name, f.mimetype, f.size, f.kind, f.url, f.label, f.uploaded_at]
  );
  return f;
}
async function recordUrl({ task_id, group_id, uploaded_by, url, label }) {
  if (!url) throw new Error('url required');
  const f = {
    id: uid(),
    task_id, group_id: group_id || null, uploaded_by: uploaded_by || null,
    filename: '', original_name: label || url, mimetype: 'text/uri-list', size: 0,
    kind: 'url', url, label: label || null,
    uploaded_at: nowIso(),
  };
  await exec(
    `INSERT INTO task_files (id, task_id, group_id, uploaded_by, filename, original_name, mimetype, size, kind, url, label, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [f.id, f.task_id, f.group_id, f.uploaded_by, f.filename, f.original_name, f.mimetype, f.size, f.kind, f.url, f.label, f.uploaded_at]
  );
  return f;
}
async function listFilesForTask(taskId) {
  return q(`SELECT f.*, m.name AS uploader_name, m.color AS uploader_color, t.title AS task_title, g.name AS group_name
            FROM task_files f
            LEFT JOIN members m ON m.id = f.uploaded_by
            LEFT JOIN tasks t ON t.id = f.task_id
            LEFT JOIN task_groups g ON g.id = f.group_id
            WHERE f.task_id = $1 ORDER BY f.uploaded_at DESC`, [taskId]);
}
async function listFilesForGroup(groupId) {
  if (groupId == null) {
    return q(`SELECT f.*, m.name AS uploader_name, m.color AS uploader_color, t.title AS task_title
              FROM task_files f
              LEFT JOIN members m ON m.id = f.uploaded_by
              LEFT JOIN tasks t ON t.id = f.task_id
              WHERE f.group_id IS NULL ORDER BY f.uploaded_at DESC`);
  }
  return q(`SELECT f.*, m.name AS uploader_name, m.color AS uploader_color, t.title AS task_title
            FROM task_files f
            LEFT JOIN members m ON m.id = f.uploaded_by
            LEFT JOIN tasks t ON t.id = f.task_id
            WHERE f.group_id = $1 ORDER BY f.uploaded_at DESC`, [groupId]);
}
async function listAllFiles() {
  return q(`SELECT f.*, m.name AS uploader_name, m.color AS uploader_color, t.title AS task_title, g.name AS group_name
            FROM task_files f
            LEFT JOIN members m ON m.id = f.uploaded_by
            LEFT JOIN tasks t ON t.id = f.task_id
            LEFT JOIN task_groups g ON g.id = f.group_id
            ORDER BY f.uploaded_at DESC`);
}
async function getFile(id) { return q1('SELECT * FROM task_files WHERE id = $1', [id]); }
async function deleteFile(id) {
  const f = await getFile(id);
  if (!f) return false;
  await exec('DELETE FROM task_files WHERE id = $1', [id]);
  if (f.kind !== 'url' && f.filename) {
    const onDisk = path.join(UPLOAD_DIR, folderForGroup(f.group_id), f.filename);
    try { if (fs.existsSync(onDisk)) fs.unlinkSync(onDisk); } catch {}
  }
  return true;
}

// ===== Deadline requests =====
async function requestDeadline({ task_id, requested_by, requested_deadline, reason }) {
  const t = await q1('SELECT * FROM tasks WHERE id = $1', [task_id]);
  if (!t) throw new Error('task not found');
  if (!requested_deadline) throw new Error('requested_deadline required');
  const r = {
    id: uid(), task_id, requested_by,
    current_deadline: t.deadline, requested_deadline, reason: reason || '',
    created_at: nowIso(),
  };
  await exec(
    `INSERT INTO deadline_requests (id, task_id, requested_by, current_deadline, requested_deadline, reason, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
    [r.id, r.task_id, r.requested_by, r.current_deadline, r.requested_deadline, r.reason, r.created_at]
  );
  return { ...r, status: 'pending' };
}
async function listDeadlineRequests() {
  return q(`SELECT dr.*, t.title AS task_title, m.name AS requester_name, m.color AS requester_color
            FROM deadline_requests dr
            LEFT JOIN tasks t ON t.id = dr.task_id
            LEFT JOIN members m ON m.id = dr.requested_by
            ORDER BY dr.created_at DESC`);
}
async function decideDeadline(reqId, status, deciderId) {
  const req = await q1('SELECT * FROM deadline_requests WHERE id = $1', [reqId]);
  if (!req) throw new Error('request not found');
  if (req.status !== 'pending') throw new Error('already decided');
  if (!['approved', 'rejected'].includes(status)) throw new Error('invalid status');
  await exec('UPDATE deadline_requests SET status=$1, decided_by=$2, decided_at=$3 WHERE id=$4',
    [status, deciderId, nowIso(), reqId]);
  if (status === 'approved') {
    await exec('UPDATE tasks SET deadline=$1 WHERE id=$2', [req.requested_deadline, req.task_id]);
  }
  return q1('SELECT * FROM deadline_requests WHERE id = $1', [reqId]);
}

// ===== Group membership =====
async function addGroupMember(groupId, memberId) {
  if (!groupId || !memberId) return;
  await exec(
    'INSERT INTO group_members (group_id, member_id, joined_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [groupId, memberId, nowIso()]
  );
}
async function removeGroupMember(groupId, memberId) {
  return (await exec('DELETE FROM group_members WHERE group_id = $1 AND member_id = $2', [groupId, memberId])) > 0;
}
async function listGroupMembers(groupId) {
  return q(`SELECT m.id, m.name, m.role, m.color, m.avatar_url, m.email, gm.joined_at
            FROM group_members gm JOIN members m ON m.id = gm.member_id
            WHERE gm.group_id = $1 ORDER BY gm.joined_at ASC`, [groupId]);
}
async function isGroupMember(groupId, memberId) {
  const r = await q1('SELECT 1 AS x FROM group_members WHERE group_id = $1 AND member_id = $2', [groupId, memberId]);
  return !!r;
}
async function groupIdsForMember(memberId) {
  return (await q('SELECT group_id FROM group_members WHERE member_id = $1', [memberId])).map(r => r.group_id);
}

// ===== Group invitations =====
async function createGroupInvitation({ group_id, member_id, invited_by, kind, message }) {
  if (!['invite','proposal'].includes(kind)) throw new Error('kind must be invite or proposal');
  if (!(await getGroup(group_id))) throw new Error('group not found');
  if (!(await getMember(member_id))) throw new Error('member not found');
  if (await isGroupMember(group_id, member_id)) throw new Error('member already in group');
  const dup = await q1(`SELECT * FROM group_invitations WHERE group_id = $1 AND member_id = $2 AND kind = $3 AND status = 'pending'`,
    [group_id, member_id, kind]);
  if (dup) throw new Error('a pending ' + kind + ' already exists');
  const r = {
    id: uid(), group_id, member_id, invited_by: invited_by || null,
    kind, message: message || '', created_at: nowIso(),
  };
  await exec(
    `INSERT INTO group_invitations (id, group_id, member_id, invited_by, kind, message, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
    [r.id, r.group_id, r.member_id, r.invited_by, r.kind, r.message, r.created_at]
  );
  return { ...r, status: 'pending' };
}
async function getGroupInvitation(id) {
  return q1('SELECT * FROM group_invitations WHERE id = $1', [id]);
}
async function listAllGroupInvitations() {
  return q(`
    SELECT i.*, g.name AS group_name, g.leader_id AS group_leader_id,
           m.name AS member_name, m.color AS member_color,
           inviter.name AS inviter_name, inviter.color AS inviter_color
    FROM group_invitations i
    LEFT JOIN task_groups g ON g.id = i.group_id
    LEFT JOIN members m ON m.id = i.member_id
    LEFT JOIN members inviter ON inviter.id = i.invited_by
    ORDER BY i.created_at DESC
  `);
}
async function decideGroupInvitation(id, status, deciderId) {
  const inv = await getGroupInvitation(id);
  if (!inv) throw new Error('invitation not found');
  if (inv.status !== 'pending') throw new Error('already decided');
  if (!['accepted','rejected'].includes(status)) throw new Error('invalid status');
  await exec('UPDATE group_invitations SET status=$1, decided_by=$2, decided_at=$3 WHERE id=$4',
    [status, deciderId, nowIso(), id]);
  if (status === 'accepted') await addGroupMember(inv.group_id, inv.member_id);
  return getGroupInvitation(id);
}

// ===== Task invitations (legacy) =====
async function createInvitation({ task_id, member_id, invited_by, kind, message }) {
  if (!['invite','proposal'].includes(kind)) throw new Error('kind must be invite or proposal');
  if (!(await q1('SELECT 1 FROM tasks WHERE id = $1', [task_id]))) throw new Error('task not found');
  if (!(await getMember(member_id))) throw new Error('member not found');
  if (await getAssignee(task_id, member_id)) throw new Error('member already assigned to this task');
  const dup = await q1(`SELECT * FROM task_invitations WHERE task_id = $1 AND member_id = $2 AND kind = $3 AND status = 'pending'`,
    [task_id, member_id, kind]);
  if (dup) throw new Error('a pending ' + kind + ' already exists for this member on this task');
  const r = {
    id: uid(), task_id, member_id, invited_by: invited_by || null,
    kind, message: message || '', created_at: nowIso(),
  };
  await exec(
    `INSERT INTO task_invitations (id, task_id, member_id, invited_by, kind, message, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
    [r.id, r.task_id, r.member_id, r.invited_by, r.kind, r.message, r.created_at]
  );
  return { ...r, status: 'pending' };
}
async function getInvitation(id) { return q1('SELECT * FROM task_invitations WHERE id = $1', [id]); }
async function listAllInvitations() {
  return q(`
    SELECT i.*, t.title AS task_title, t.group_id, g.name AS group_name, g.leader_id AS group_leader_id,
           m.name AS member_name, m.color AS member_color,
           inviter.name AS inviter_name, inviter.color AS inviter_color
    FROM task_invitations i
    LEFT JOIN tasks t ON t.id = i.task_id
    LEFT JOIN task_groups g ON g.id = t.group_id
    LEFT JOIN members m ON m.id = i.member_id
    LEFT JOIN members inviter ON inviter.id = i.invited_by
    ORDER BY i.created_at DESC
  `);
}
async function decideInvitation(id, status, deciderId) {
  const inv = await getInvitation(id);
  if (!inv) throw new Error('invitation not found');
  if (inv.status !== 'pending') throw new Error('already decided');
  if (!['accepted','rejected'].includes(status)) throw new Error('invalid status');
  await exec('UPDATE task_invitations SET status=$1, decided_by=$2, decided_at=$3 WHERE id=$4',
    [status, deciderId, nowIso(), id]);
  if (status === 'accepted') {
    const exists = await getAssignee(inv.task_id, inv.member_id);
    if (!exists) {
      await exec(
        `INSERT INTO task_assignees (task_id, member_id, task_role, is_supreme, points_share, claimed_self, assigned_at, proposed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [inv.task_id, inv.member_id, 'member', 0, 0, 0, nowIso(), null]
      );
    }
  }
  return getInvitation(id);
}

// ===== Group claim =====
async function claimGroup(groupId, memberId) {
  const g = await getGroup(groupId);
  if (!g) throw new Error('group not found');
  if (g.leader_id) throw new Error('group already has a leader');
  if (!(await getMember(memberId))) throw new Error('member not found');
  await exec('UPDATE task_groups SET leader_id = $1 WHERE id = $2', [memberId, groupId]);
  await addGroupMember(groupId, memberId);
  return getGroup(groupId);
}

// ===== Categories =====
async function listCategories() {
  return q('SELECT * FROM categories ORDER BY name ASC');
}
async function createCategory(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('name required');
  const existing = await q1('SELECT * FROM categories WHERE name = $1', [trimmed]);
  if (existing) return existing;
  const c = { id: uid(), name: trimmed, created_at: nowIso() };
  await exec('INSERT INTO categories (id, name, created_at) VALUES ($1, $2, $3)', [c.id, c.name, c.created_at]);
  return c;
}

// ===== Leaves =====
async function listLeaves() {
  return q(`SELECT l.*, m.name AS member_name, m.color AS member_color, m.avatar_url AS member_avatar
            FROM leaves l JOIN members m ON m.id = l.member_id
            ORDER BY l.start_at ASC`);
}
async function getLeave(id) { return q1('SELECT * FROM leaves WHERE id = $1', [id]); }
async function listLeavesForMember(memberId) {
  return q('SELECT * FROM leaves WHERE member_id = $1 ORDER BY start_at ASC', [memberId]);
}
async function createLeave({ member_id, start_at, end_at, reason }) {
  if (!member_id) throw new Error('member_id required');
  if (!(await getMember(member_id))) throw new Error('member not found');
  if (!start_at || !end_at) throw new Error('start_at + end_at required');
  if (new Date(end_at).getTime() < new Date(start_at).getTime()) {
    throw new Error('end_at must be on or after start_at');
  }
  const r = {
    id: uid(), member_id, start_at, end_at,
    reason: String(reason || '').trim(),
    created_at: nowIso(),
  };
  await exec(
    'INSERT INTO leaves (id, member_id, start_at, end_at, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [r.id, r.member_id, r.start_at, r.end_at, r.reason, r.created_at]
  );
  return r;
}
async function updateLeave(id, patch) {
  const cur = await getLeave(id);
  if (!cur) return null;
  const start_at = patch.start_at || cur.start_at;
  const end_at   = patch.end_at   || cur.end_at;
  if (new Date(end_at).getTime() < new Date(start_at).getTime()) {
    throw new Error('end_at must be on or after start_at');
  }
  await exec('UPDATE leaves SET start_at=$1, end_at=$2, reason=$3 WHERE id=$4',
    [start_at, end_at,
     patch.reason !== undefined ? String(patch.reason).trim() : cur.reason,
     id]);
  return getLeave(id);
}
async function deleteLeave(id) {
  return (await exec('DELETE FROM leaves WHERE id = $1', [id])) > 0;
}

// ===== Point increase requests =====
async function requestPoints({ task_id, requested_by, requested_points, reason }) {
  const t = await q1('SELECT * FROM tasks WHERE id = $1', [task_id]);
  if (!t) throw new Error('task not found');
  const reqPts = +requested_points;
  if (!Number.isFinite(reqPts) || reqPts < 0) throw new Error('invalid requested_points');
  if (reqPts <= t.points) throw new Error(`requested_points ต้องมากกว่าค่าปัจจุบัน (${t.points})`);
  const r = {
    id: uid(), task_id, requested_by,
    current_points: t.points,
    requested_points: Math.floor(reqPts),
    reason: reason || '',
    created_at: nowIso(),
  };
  await exec(
    `INSERT INTO point_requests (id, task_id, requested_by, current_points, requested_points, reason, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
    [r.id, r.task_id, r.requested_by, r.current_points, r.requested_points, r.reason, r.created_at]
  );
  return { ...r, status: 'pending' };
}
async function listPointRequests() {
  return q(`SELECT pr.*, t.title AS task_title, m.name AS requester_name, m.color AS requester_color
            FROM point_requests pr
            LEFT JOIN tasks t ON t.id = pr.task_id
            LEFT JOIN members m ON m.id = pr.requested_by
            ORDER BY pr.created_at DESC`);
}
async function decidePoints(reqId, status, deciderId) {
  const req = await q1('SELECT * FROM point_requests WHERE id = $1', [reqId]);
  if (!req) throw new Error('request not found');
  if (req.status !== 'pending') throw new Error('already decided');
  if (!['approved', 'rejected'].includes(status)) throw new Error('invalid status');
  await exec('UPDATE point_requests SET status=$1, decided_by=$2, decided_at=$3 WHERE id=$4',
    [status, deciderId, nowIso(), reqId]);
  if (status === 'approved') {
    await exec('UPDATE tasks SET points = $1 WHERE id = $2', [req.requested_points, req.task_id]);
  }
  return q1('SELECT * FROM point_requests WHERE id = $1', [reqId]);
}

// ===== Stats =====
async function getStats() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayIso = today.toISOString().slice(0,10);

  const [members, statsRows, totalRow, summaryRow, upcomingRows] = await Promise.all([
    listMembers(),
    q(`
      SELECT m.id AS member_id,
        COUNT(DISTINCT t.id)::int AS total_tasks,
        COUNT(DISTINCT CASE WHEN t.status='completed'   THEN t.id END)::int AS completed_tasks,
        COUNT(DISTINCT CASE WHEN t.status='in_progress' THEN t.id END)::int AS in_progress_tasks,
        COUNT(DISTINCT CASE WHEN t.status='on_hold'     THEN t.id END)::int AS on_hold_tasks,
        COALESCE(SUM(CASE WHEN t.points_phase='confirmed' THEN ta.points_share ELSE 0 END), 0)::int AS points
      FROM members m
      LEFT JOIN task_assignees ta ON ta.member_id = m.id
      LEFT JOIN tasks t ON t.id = ta.task_id
      GROUP BY m.id
    `),
    q1(`SELECT COALESCE(SUM(ta.points_share),0)::int AS s
        FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id
        WHERE t.points_phase='confirmed'`),
    q1(`
      SELECT
        (SELECT COUNT(*)::int FROM members)     AS members,
        (SELECT COUNT(*)::int FROM task_groups) AS groups,
        (SELECT COUNT(*)::int FROM tasks)       AS tasks,
        (SELECT COUNT(*)::int FROM tasks WHERE status='completed')   AS completed,
        (SELECT COUNT(*)::int FROM tasks WHERE status='in_progress') AS in_progress,
        (SELECT COUNT(*)::int FROM tasks WHERE status='on_hold')     AS on_hold,
        (SELECT COUNT(*)::int FROM tasks
         WHERE deadline IS NOT NULL AND LEFT(deadline, 10) < $1
           AND status NOT IN ('completed','cancelled'))               AS overdue
    `, [todayIso]),
    q(`SELECT * FROM tasks WHERE deadline IS NOT NULL AND status = 'in_progress' ORDER BY deadline ASC NULLS LAST`),
  ]);

  const totalPoints = totalRow?.s || 0;
  const byMember = new Map(statsRows.map(r => [r.member_id, r]));
  const scoreboard = members.map(m => {
    const s = byMember.get(m.id) || {};
    const pts = s.points || 0;
    return {
      member: m,
      total_tasks: s.total_tasks || 0,
      completed_tasks: s.completed_tasks || 0,
      in_progress_tasks: s.in_progress_tasks || 0,
      on_hold_tasks: s.on_hold_tasks || 0,
      points: pts,
      percent: totalPoints > 0 ? +(pts / totalPoints * 100).toFixed(1) : 0,
    };
  }).sort((a, b) => b.points - a.points);

  const upcoming = await Promise.all(upcomingRows.map(async t => ({
    ...(await attachAssignees(t)),
    days_left: Math.ceil((new Date(t.deadline) - today) / 86400000),
  })));

  const summary = {
    members:                summaryRow?.members     || 0,
    groups:                 summaryRow?.groups      || 0,
    tasks:                  summaryRow?.tasks       || 0,
    completed:              summaryRow?.completed   || 0,
    in_progress:            summaryRow?.in_progress || 0,
    on_hold:                summaryRow?.on_hold     || 0,
    overdue:                summaryRow?.overdue     || 0,
    total_points_completed: totalPoints,
  };

  return { scoreboard, leaderboard: scoreboard, upcoming, summary };
}

// ===== Point Ledger (read-only audit) =====
// Per-row breakdown of every point share that contributes to a member's total.
// Source = task title + group; Timestamp = the best available signal we have
// without altering the schema (proposed_at, falling back to assigned_at). Each
// row is the unit awarded — sum these per-member to reproduce the scoreboard.
async function getPointLedger(opts = {}) {
  const { memberId = null, includeUnconfirmed = false } = opts;
  const where = [];
  const params = [];
  if (!includeUnconfirmed) where.push(`t.points_phase = 'confirmed'`);
  if (memberId) { params.push(memberId); where.push(`ta.member_id = $${params.length}`); }
  // Always exclude rows that contribute zero — they're noise.
  where.push(`COALESCE(ta.points_share, 0) > 0`);

  const sql = `
    SELECT
      ta.task_id,
      ta.member_id,
      m.name           AS member_name,
      m.color          AS member_color,
      m.role           AS member_role,
      t.title          AS task_title,
      t.status         AS task_status,
      t.points         AS task_points_total,
      t.points_phase   AS phase,
      t.deadline       AS task_deadline,
      t.kind           AS task_kind,
      t.group_id,
      g.name           AS group_name,
      g.color          AS group_color,
      ta.task_role,
      ta.is_supreme,
      ta.points_share  AS points,
      ta.claimed_self,
      ta.assigned_at,
      ta.proposed_at,
      COALESCE(ta.proposed_at, ta.assigned_at) AS earned_at
    FROM task_assignees ta
    JOIN members        m ON m.id = ta.member_id
    JOIN tasks          t ON t.id = ta.task_id
    LEFT JOIN task_groups g ON g.id = t.group_id
    WHERE ${where.join(' AND ')}
    ORDER BY earned_at DESC NULLS LAST, ta.task_id, ta.member_id
  `;
  return q(sql, params);
}

// ===== Whiteboards =====
async function listWhiteboards() {
  return q(`SELECT w.*, m.name AS creator_name FROM whiteboards w
            LEFT JOIN members m ON m.id = w.created_by
            ORDER BY w.updated_at DESC`);
}
async function createWhiteboard(name, created_by) {
  const id = uid();
  const now = nowIso();
  await exec(
    'INSERT INTO whiteboards (id, name, canvas_json, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, name, '{"version":"5.3.1","objects":[]}', created_by || null, now, now]
  );
  return getWhiteboard(id);
}
async function getWhiteboard(id) {
  return q1(`SELECT w.*, m.name AS creator_name FROM whiteboards w
             LEFT JOIN members m ON m.id = w.created_by WHERE w.id = $1`, [id]);
}
async function updateWhiteboardCanvas(id, canvas_json) {
  await exec('UPDATE whiteboards SET canvas_json=$1, updated_at=$2 WHERE id=$3',
    [canvas_json, nowIso(), id]);
}
async function deleteWhiteboard(id) {
  return (await exec('DELETE FROM whiteboards WHERE id=$1', [id])) > 0;
}

// ===== Recordings (audio) =====
// Metadata only — the blob lives on disk under UPLOAD_DIR/_audio/<filename>.
async function listRecordings({ memberId = null, all = false } = {}) {
  const where = []; const params = [];
  if (!all && memberId) { params.push(memberId); where.push(`r.member_id = $${params.length}`); }
  return q(`
    SELECT r.id, r.filename, r.label, r.mime, r.size_bytes, r.duration_ms,
           r.member_id, r.created_at,
           r.transcript, r.transcript_status, r.transcript_error, r.transcribed_at,
           m.name AS member_name, m.color AS member_color
    FROM recordings r
    LEFT JOIN members m ON m.id = r.member_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.created_at DESC
  `, params);
}
async function getRecording(id) {
  const r = await q1(`SELECT * FROM recordings WHERE id=$1`, [id]);
  return r;
}
async function createRecording({ id, filename, label, mime, size_bytes, duration_ms, member_id }) {
  await exec(
    `INSERT INTO recordings (id, filename, label, mime, size_bytes, duration_ms, member_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, filename, label || '', mime || 'audio/webm', size_bytes || 0, duration_ms || 0, member_id || null, nowIso()]
  );
  return getRecording(id);
}
async function updateRecording(id, patch) {
  const fields = []; const params = []; let i = 1;
  if (patch.label != null)             { fields.push(`label=$${i++}`);             params.push(String(patch.label)); }
  if (patch.duration_ms != null)       { fields.push(`duration_ms=$${i++}`);       params.push(+patch.duration_ms || 0); }
  if (patch.transcript != null)        { fields.push(`transcript=$${i++}`);        params.push(String(patch.transcript)); }
  if (patch.transcript_status != null) { fields.push(`transcript_status=$${i++}`); params.push(String(patch.transcript_status)); }
  if (patch.transcript_error != null)  { fields.push(`transcript_error=$${i++}`);  params.push(String(patch.transcript_error)); }
  if (patch.transcribed_at != null)    { fields.push(`transcribed_at=$${i++}`);    params.push(String(patch.transcribed_at)); }
  if (!fields.length) return getRecording(id);
  params.push(id);
  await exec(`UPDATE recordings SET ${fields.join(', ')} WHERE id=$${i}`, params);
  return getRecording(id);
}
async function deleteRecording(id) {
  return (await exec('DELETE FROM recordings WHERE id=$1', [id])) > 0;
}

async function reset() {
  // Single statement; all CASCADE-truncated together
  await pool.query(`TRUNCATE TABLE
    point_requests, group_invitations, group_members, task_invitations,
    deadline_requests, task_files, connections, task_assignees, tasks,
    task_groups, members
    RESTART IDENTITY CASCADE`);
}

async function close() {
  try { await pool.end(); } catch {}
}

module.exports = {
  init, initSchema, seedDefaults, close, pool, sqlite: null,
  VALID_STATUS, VALID_ROLE, VALID_TASK_ROLE, UPLOAD_DIR, GROUP_PALETTE,
  listMembers, getMember, getMemberFull, findMemberByName,
  createMember, updateMember, setMemberPassword, setMemberAvatar, deleteMember,
  listGroups, getGroup, createGroup, updateGroup, deleteGroup, isGroupLeader,
  listTasks, getTask, createTask, updateTask, deleteTask, bumpIcsSequence,
  getSetting, setSetting, listSettings,
  getSetting, setSetting, listSettings,
  claimTask, dropTask, getAssignee, isAssigned, isLeader, isSupremeLeader,
  setAssigneeRole, setAssigneePointsShare,
  proposeOwnPoints, leaderApprovePoints, confirmPoints, reopenPoints, bulkSetShares,
  listConnections, getConnection, createConnection, updateConnection, deleteConnection,
  recordFile, recordUrl, listFilesForTask, listFilesForGroup, listAllFiles, getFile, deleteFile,
  folderForGroup, uploadDir,
  requestDeadline, listDeadlineRequests, decideDeadline,
  requestPoints, listPointRequests, decidePoints,
  listLeaves, getLeave, listLeavesForMember, createLeave, updateLeave, deleteLeave,
  listCategories, createCategory,
  createInvitation, getInvitation, listAllInvitations, decideInvitation, claimGroup,
  addGroupMember, removeGroupMember, listGroupMembers, isGroupMember, groupIdsForMember,
  createGroupInvitation, getGroupInvitation, listAllGroupInvitations, decideGroupInvitation,
  getStats, getPointLedger, reset,
  listWhiteboards, createWhiteboard, getWhiteboard, updateWhiteboardCanvas, deleteWhiteboard,
  listRecordings, getRecording, createRecording, updateRecording, deleteRecording,
};
