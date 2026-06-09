require('dotenv').config();
const db = require('./db');
const auth = require('./auth');

// SEED — สมาชิกอย่างเดียว (ตามคำขอ: "ตัว seed ขอให้เหลือแค่สมาชิก")
// ใช้เมื่อเริ่ม DB ใหม่ (development / first install) เพื่อให้มี admin login ได้
// ไม่ seed groups/tasks/connections/leaves เพื่อให้ผู้ใช้สร้างข้อมูลเองตามจริง

const args = process.argv.slice(2);
const RESET = args.includes('--reset') || args.includes('-r');
const DEFAULT_PIN = '1234';

(async () => {
  try {
    await db.init();
  } catch (err) {
    console.error('[FATAL] DB init failed:', err.message);
    process.exit(1);
  }

  if (RESET) {
    console.log('Resetting database…');
    await db.reset();
    const fs = require('fs'), path = require('path');
    try {
      for (const sub of fs.readdirSync(db.UPLOAD_DIR)) {
        fs.rmSync(path.join(db.UPLOAD_DIR, sub), { recursive: true, force: true });
      }
    } catch {}
  }

  // ถ้ามี member อยู่แล้ว → skip (ไม่ overwrite ของจริง)
  const existing = await db.listMembers();
  if (existing.length > 0 && !RESET) {
    console.log(`Members already exist (${existing.length}). Use 'npm run reset' to wipe and re-seed.`);
    await db.close();
    process.exit(0);
  }

  console.log('Seeding members…');
  // เบอร์โทร = dummy รูปแบบไทย (08x-xxx-xxxx) สำหรับ dev/test เท่านั้น
  // ผู้ใช้จริงควรแก้ผ่านหน้า Profile หรือ admin แก้ผ่านหน้า People
  const memberSeeds = [
    { name: 'AJ', role: 'boss',   email: '',   phone: '', color: '#4f46e5' },
    { name: 'วิว',     role: 'admin',  email: '',   phone: '', color: '#0ea5e9' },
    { name: 'เคน',     role: 'admin', email: '',    phone: '', color: '#10b981' },
    { name: 'นะนิ้ง',  role: 'admin', email: '', phone: '', color: '#f59e0b' },
    { name: 'ตี้',     role: 'admin', email: '',    phone: '', color: '#ec4899' },
    { name: 'สอง',     role: 'admin', email: '',   phone: '', color: '#a855f7' },
    { name: 'โอ๊ต',    role: 'admin', email: '',    phone: '', color: '#14b8a6' },
  ];
  for (const m of memberSeeds) {
    await db.createMember({ ...m, password_hash: auth.hashPassword(DEFAULT_PIN) });
  }

  console.log('---');
  const allMembers = await db.listMembers();
  console.log(`Members: ${allMembers.length}  (admins: ${allMembers.filter(m => m.role === 'admin').length})`);
  console.log('---');
  console.log(`Default password (PIN) for everyone: ${DEFAULT_PIN}`);
  console.log('Admin login: "AJ" / 1234   หรือ   "วิว" / 1234');
  console.log('Seed complete! (members only — สร้าง group/task/connection ผ่าน UI เองได้เลย)');
  await db.close();
})().catch(err => { console.error(err); process.exit(1); });
