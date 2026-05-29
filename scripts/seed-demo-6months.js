#!/usr/bin/env node
/**
 * Seed Demo Data — 6 เดือนย้อนหลัง (Nov 2025 → May 2026)
 *
 * เก็บไว้: members, categories, leaves, polls, audit_events, app_settings, whiteboards
 * ลบทั้งหมด: groups, tasks, connections, point_requests, deadline_requests
 *   + junctions (task_assignees, task_categories, group_members, group_connections, etc.)
 *
 * Seed:
 *   ~18 groups (ครบทุก lifecycle status)
 *   ~200 tasks (กระจาย status, มี points workflow ครบ 4 phase)
 *   ~18 connections (บริษัท + Lobbyist + หน่วยงาน)
 *   ~5 point_requests + ~4 deadline_requests
 *
 * Run: node scripts/seed-demo-6months.js   (ต้องมี DATABASE_URL ใน env)
 *   หรือผ่าน docker: docker exec -e DATABASE_URL="..." sml_app node scripts/seed-demo-6months.js
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'backend', 'db'));

// ── Helpers ──────────────────────────────────────────────────────────────
const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickMany = (arr, n) => {
  const out = []; const used = new Set();
  while (out.length < Math.min(n, arr.length)) {
    const i = Math.floor(Math.random() * arr.length);
    if (used.has(i)) continue;
    used.add(i); out.push(arr[i]);
  }
  return out;
};
const dateISO = (d) => new Date(d).toISOString();
const dateOnly = (d) => new Date(d).toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const daysFromStart = (startDate, n) => {
  const d = new Date(startDate);
  d.setDate(d.getDate() + n);
  return d;
};

async function exec(sql, params = []) {
  return (await db.pool.query(sql, params)).rowCount;
}
async function query(sql, params = []) {
  return (await db.pool.query(sql, params)).rows;
}

// ── DELETE all task/group/connection data (FK-safe order) ───────────────
async function wipeAll() {
  console.log('🗑️  Wiping existing data...');
  // ลูกของ tasks
  await exec('DELETE FROM task_comments');
  await exec('DELETE FROM task_files');
  await exec('DELETE FROM task_assignees');
  await exec('DELETE FROM task_categories');
  await exec('DELETE FROM task_invitations');
  await exec('DELETE FROM deadline_requests');
  await exec('DELETE FROM point_requests');
  // tasks
  await exec('DELETE FROM tasks');
  // ลูกของ groups
  await exec('DELETE FROM group_members');
  await exec('DELETE FROM group_invitations');
  await exec('DELETE FROM group_connections');
  // groups
  await exec('DELETE FROM task_groups');
  // connections
  await exec('DELETE FROM connections');
  console.log('   ✓ Cleared 12 tables');
}

// ── Connections (18) ────────────────────────────────────────────────────
async function seedConnections(members) {
  console.log('🤝 Seeding connections...');
  const m = Object.fromEntries(members.map(x => [x.name, x.id]));
  const conns = [
    // บริษัท (personal) — coordinator = lab member
    { kind: 'personal', company: 'บริษัท ABC จำกัด',           contact_name: 'คุณภาสกร', contact_role: 'ผู้จัดการโครงการ', phone: '02-100-0001', email: 'contact@abc.co.th',     member_id: m['เคน'] },
    { kind: 'personal', company: 'บริษัท Smart Tech',          contact_name: 'คุณอรนุช', contact_role: 'CEO',              phone: '02-200-0002', email: 'info@smarttech.io',    member_id: m['วิว'] },
    { kind: 'personal', company: 'บริษัท GeoData Solutions',   contact_name: 'คุณธนาธร', contact_role: 'Solution Architect', phone: '02-300-0003', email: 'sales@geodata.com',    member_id: m['นะนิ้ง'] },
    { kind: 'personal', company: 'บริษัท IoT Devices',         contact_name: 'คุณรพี',  contact_role: 'Sales Director',   phone: '02-400-0004', email: 'biz@iotdevices.co.th', member_id: m['สอง'] },
    { kind: 'personal', company: 'บริษัท Cloud Service',       contact_name: 'คุณวันชัย', contact_role: 'Account Manager',  phone: '02-500-0005', email: 'support@cloudserv.com',member_id: m['โอ๊ต'] },
    { kind: 'personal', company: 'บริษัท AI Engineering',      contact_name: 'คุณอลิสา',  contact_role: 'CTO',              phone: '02-600-0006', email: 'hello@aieng.tech',     member_id: m['เคน'] },

    // Lobbyist — เก็บแค่ข้อมูลคน
    { kind: 'lobbyist', liaison_name: 'คุณวิชัย ใจเย็น',     contact_role: 'ที่ปรึกษาอาวุโส', phone: '081-100-1001', email: 'wichai.j@gmail.com',     member_id: m['AJ'] },
    { kind: 'lobbyist', liaison_name: 'คุณสมศรี รักงาน',    contact_role: 'ผู้แทน',          phone: '081-200-2002', email: 'somsri.rgn@gmail.com',   member_id: m['AJ'] },
    { kind: 'lobbyist', liaison_name: 'คุณประเสริฐ มั่นคง', contact_role: 'ที่ปรึกษากฎหมาย', phone: '081-300-3003', email: 'prasert.mk@gmail.com',   member_id: m['วิว'] },
    { kind: 'lobbyist', liaison_name: 'คุณนภา ไพศาล',       contact_role: 'ที่ปรึกษานโยบาย', phone: '081-400-4004', email: 'napa.ps@gmail.com',      member_id: m['เคน'] },
    { kind: 'lobbyist', liaison_name: 'คุณกฤษณะ ก้าวหน้า', contact_role: 'ที่ปรึกษาเทคนิค', phone: '081-500-5005', email: 'krit.kn@gmail.com',      member_id: m['ตี้'] },

    // หน่วยงาน (agency) — 1 หน่วยงาน อาจมีหลาย liaison
    { kind: 'agency', company: 'อบจ.ฉะเชิงเทรา',          liaison_name: 'คุณวิทยา ใจกล้า',  contact_role: 'กองช่าง',  phone: '038-100-100', email: 'vitya.cco@chacheongsao.go.th',  member_id: m['AJ'] },
    { kind: 'agency', company: 'อบจ.ฉะเชิงเทรา',          liaison_name: 'คุณพิมพ์ใจ ดวงแก้ว', contact_role: 'ปลัด',     phone: '038-100-101', email: 'pim.cco@chacheongsao.go.th',    member_id: m['AJ'] },
    { kind: 'agency', company: 'อบจ.ฉะเชิงเทรา',          liaison_name: 'คุณรัตนา ทองดี',   contact_role: 'กองคลัง',  phone: '038-100-102', email: 'ratana.cco@chacheongsao.go.th', member_id: m['วิว'] },
    { kind: 'agency', company: 'เทศบาลตำบลแปดริ้ว',      liaison_name: 'คุณมานพ สง่างาม',  contact_role: 'นายก',      phone: '038-200-200', email: 'manop.tess@padriew.go.th',      member_id: m['AJ'] },
    { kind: 'agency', company: 'เทศบาลตำบลแปดริ้ว',      liaison_name: 'คุณสุพิน อ่อนน้อม', contact_role: 'รองนายก',   phone: '038-200-201', email: 'supin.tess@padriew.go.th',      member_id: m['เคน'] },
    { kind: 'agency', company: 'กระทรวงคมนาคม',          liaison_name: 'คุณอนันต์ ก่อสร้าง', contact_role: 'วิศวกรอาวุโส', phone: '02-700-7007', email: 'anan.mot@motgo.th',             member_id: m['AJ'] },
    { kind: 'agency', company: 'อบต.บางพระ',              liaison_name: 'คุณชัย พิมพ์เพชร', contact_role: 'นายก',      phone: '038-300-300', email: 'chai.bp@bangpra.go.th',         member_id: m['วิว'] },
    { kind: 'agency', company: 'เทศบาลนครฉะเชิงเทรา',   liaison_name: 'คุณวิภา สุขสวัสดิ์', contact_role: 'ปลัด',      phone: '038-400-400', email: 'wipa.muni@chacityrr.go.th',     member_id: m['AJ'] },
  ];
  const ids = [];
  for (const c of conns) {
    const created = await db.createConnection(c);
    ids.push({ ...created });
  }
  console.log(`   ✓ ${ids.length} connections`);
  return ids;
}

// ── Groups + Tasks ──────────────────────────────────────────────────────
// Helper: pick connections by kind from seeded connections
const connsByKind = { personal: [], lobbyist: [], agency: [] };
const groupColors = [
  '#dc2626','#ea580c','#f59e0b','#eab308','#84cc16','#22c55e','#10b981',
  '#06b6d4','#0ea5e9','#3b82f6','#6366f1','#8b5cf6','#a855f7','#d946ef',
  '#ec4899','#f43f5e','#0d9488','#7c3aed',
];

async function seedGroups(members, allConns) {
  console.log('📁 Seeding groups...');
  const m = Object.fromEntries(members.map(x => [x.name, x.id]));
  for (const c of allConns) (connsByKind[c.kind] || connsByKind.personal).push(c);

  // Helper: pick N random connections of mixed kinds
  const pickConns = (n = 3) => {
    const out = [];
    if (connsByKind.agency.length > 0) out.push(pick(connsByKind.agency));
    if (connsByKind.personal.length > 0 && n > 1) out.push(pick(connsByKind.personal));
    if (connsByKind.lobbyist.length > 0 && n > 2) out.push(pick(connsByKind.lobbyist));
    return out.slice(0, n);
  };

  const today = new Date();
  const defs = [
    { name: 'โครงการนำร่องแปดริ้ว 69 70',              status: 'maintenance',      leader: 'วิว',     daysAgo: 188, desc: 'ระบบนำร่อง Smart City ในพื้นที่แปดริ้ว 69-70 ส่งมอบและกำลังดูแลหลังการใช้งาน' },
    { name: 'Smart Tourism แปดริ้ว',                  status: 'completed',        leader: 'เคน',    daysAgo: 183, desc: 'แพลตฟอร์มท่องเที่ยวอัจฉริยะ ส่งมอบครบและปิดโครงการแล้ว' },
    { name: 'ระบบจัดการน้ำอัจฉริยะ',                  status: 'completed',        leader: 'สอง',    daysAgo: 178, desc: 'IoT sensor ระบบจัดการน้ำให้ อบต. ปิดโครงการเรียบร้อย' },
    { name: 'Smart City อบจ.ฉะเชิงเทรา',              status: 'delivery',         leader: 'เคน',    daysAgo: 172, desc: 'ระบบ Smart City ครอบคลุมจังหวัด กำลังนำเสนอผลงาน' },
    { name: 'ระบบขนส่งสาธารณะอัจฉริยะ',               status: 'delivery',         leader: 'วิว',     daysAgo: 162, desc: 'ระบบติดตามรถสาธารณะ realtime + AI predict ส่งมอบให้ผู้บริหาร' },
    { name: 'แผนแม่บท IoT แปดริ้ว',                  status: 'in_progress',      leader: 'ตี้',    daysAgo: 131, desc: 'จัดทำแผนแม่บทการพัฒนา IoT ในพื้นที่แปดริ้ว 5 ปี' },
    { name: 'ระบบติดตามขยะอัจฉริยะ',                  status: 'in_progress',      leader: 'สอง',    daysAgo: 110, desc: 'ติด sensor ขยะ + Dashboard ติดตาม route เก็บขยะ' },
    { name: 'Smart Lighting สวนสาธารณะ',              status: 'in_progress',      leader: 'นะนิ้ง', daysAgo: 106, desc: 'ระบบไฟส่องสว่างอัจฉริยะปรับตามแสงและการเคลื่อนไหว' },
    { name: 'Dashboard ภาพรวมจังหวัด',                status: 'in_progress',      leader: 'โอ๊ต',   daysAgo: 91,  desc: 'รวบรวม data จากทุกหน่วยงานเข้า Dashboard เดียว' },
    { name: 'โครงการ Carbon Credit',                  status: 'pending_approval', leader: 'นะนิ้ง', daysAgo: 96,  desc: 'ออกแบบระบบ Carbon Credit สำหรับ SMEs ส่ง proposal แล้ว' },
    { name: 'ระบบเตือนภัยน้ำท่วม',                    status: 'pending_approval', leader: 'สอง',    daysAgo: 77,  desc: 'AI predict + sensor เตือนภัยน้ำท่วมล่วงหน้า 24 ชม.' },
    { name: 'AI ตรวจสอบโครงสร้างพื้นฐาน',             status: 'proposal',         leader: 'เคน',    daysAgo: 81,  desc: 'CV + Drone ตรวจสภาพถนน/สะพาน — กำลังเขียน proposal' },
    { name: 'Smart Parking',                          status: 'proposal',         leader: 'โอ๊ต',   daysAgo: 62,  desc: 'ระบบจอดรถอัจฉริยะ — กำลังเขียนเอกสารเสนอ' },
    { name: 'โครงการผู้สูงอายุ Smart',                status: 'idea',             leader: 'วิว',     daysAgo: 67,  desc: 'แนวคิดระบบดูแลผู้สูงอายุด้วย Wearable + Emergency Alert' },
    { name: 'E-Service ประชาชน',                      status: 'idea',             leader: 'เคน',    daysAgo: 41,  desc: 'รวมบริการประชาชนของหน่วยงานเข้าแพลตฟอร์มเดียว' },
    { name: 'Carbon Credit Phase 2',                  status: 'cancelled',        leader: 'นะนิ้ง', daysAgo: 50,  desc: 'ขยายผล Carbon Credit — ยกเลิกเพราะงบไม่ผ่าน' },
    { name: 'ระบบความปลอดภัย CCTV AI',                status: 'on_hold',          leader: 'ตี้',    daysAgo: 26,  desc: 'CCTV + Face Recognition — พักเพื่อรอนโยบายความเป็นส่วนตัว' },
    { name: 'แก้ไขโครงการผู้สูงอายุ',                 status: 'in_progress',      leader: 'ตี้',    daysAgo: 20,  desc: 'แก้ proposal โครงการผู้สูงอายุตามที่หน่วยงาน comment กลับมา' },
  ];

  const groups = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const startDate = daysAgo(d.daysAgo);
    const g = await db.createGroup({
      name: d.name,
      description: d.desc,
      target: pick(['อบจ.ฉะเชิงเทรา','เทศบาลตำบลแปดริ้ว','อบต.บางพระ','เทศบาลนครฉะเชิงเทรา','กระทรวงคมนาคม','แล็บภายใน']),
      status: d.status,
      leader_id: m[d.leader],
      color: groupColors[i % groupColors.length],
      start_date: dateOnly(startDate),
    });

    // Add 2-4 members to group (besides leader)
    const others = members.filter(mm => mm.id !== m[d.leader] && mm.role !== 'boss');
    const groupMembers = pickMany(others, rand(2, 4));
    for (const mem of groupMembers) {
      try { await db.addGroupMember(g.id, mem.id); } catch {}
    }

    // Link 2-4 random connections
    const groupConns = pickConns(rand(2, 4));
    if (groupConns.length > 0) {
      await db.setGroupConnections(g.id, groupConns.map(c => c.id));
    }
    groups.push({ ...g, leader_id: m[d.leader], _members: [m[d.leader], ...groupMembers.map(x => x.id)] });
  }
  console.log(`   ✓ ${groups.length} groups`);
  return groups;
}

// ── Tasks (200+) with points workflow ───────────────────────────────────
async function seedTasks(members, groups) {
  console.log('📋 Seeding tasks (with points workflow)...');
  const m = Object.fromEntries(members.map(x => [x.name, x.id]));
  const taskTitles = {
    research: ['สำรวจตลาด', 'ศึกษาเทคโนโลยี', 'อ่าน paper', 'รวบรวม case study', 'สัมภาษณ์ผู้ใช้', 'analyze data'],
    proposal: ['ร่างเอกสารโครงการ', 'ทำ presentation', 'คำนวณงบประมาณ', 'หา reference', 'เขียน executive summary', 'ทำ timeline', 'ออกแบบโครงสร้างงาน'],
    field:    ['ลงพื้นที่สำรวจ', 'ติดตั้ง sensor', 'เก็บข้อมูล baseline', 'ประชุมหน่วยงาน', 'นัด stakeholder', 'ทดสอบในพื้นที่'],
    dev:      ['ออกแบบ database', 'พัฒนา backend', 'พัฒนา frontend', 'ทำ API', 'integrate sensor', 'ทำ Dashboard', 'ทดสอบระบบ', 'fix bug', 'optimize performance'],
    delivery: ['นำเสนอผลงาน', 'อบรมผู้ใช้', 'ส่งมอบเอกสาร', 'ปิดโครงการ', 'ตรวจรับงาน'],
    maintain: ['monitoring 24/7', 'อัปเดตระบบ', 'แก้ bug หลังส่งมอบ', 'support ผู้ใช้', 'รีวิวการใช้งาน'],
    meeting:  ['ประชุม kickoff', 'ประชุมความคืบหน้า', 'ประชุม stakeholder', 'ประชุมทีม', 'ประชุมกับหน่วยงาน'],
  };
  // Map group status → task title pool + status mix
  const taskMix = {
    idea:              { count: 8,  pools: ['research'],                     status: { in_progress: 0.7, on_hold: 0.3 } },
    proposal:          { count: 12, pools: ['research','proposal'],           status: { in_progress: 0.5, completed: 0.5 } },
    pending_approval:  { count: 14, pools: ['proposal','meeting'],            status: { completed: 0.85, in_progress: 0.15 } },
    in_progress:       { count: 16, pools: ['proposal','field','dev','meeting'], status: { in_progress: 0.5, completed: 0.4, on_hold: 0.1 } },
    delivery:          { count: 18, pools: ['dev','delivery','meeting'],      status: { completed: 0.85, in_progress: 0.15 } },
    maintenance:       { count: 14, pools: ['delivery','maintain','meeting'], status: { completed: 0.9,  in_progress: 0.1 } },
    completed:         { count: 14, pools: ['research','proposal','dev','field','delivery','meeting'], status: { completed: 1.0 } },
    cancelled:         { count: 7,  pools: ['research','proposal'],           status: { cancelled: 0.9, completed: 0.1 } },
    on_hold:           { count: 6,  pools: ['research','proposal','dev'],     status: { on_hold: 0.8, in_progress: 0.2 } },
  };

  // categories — query existing
  const cats = await query('SELECT id, name FROM categories ORDER BY name');
  const pickStatusByMix = (mix) => {
    const r = Math.random(); let acc = 0;
    for (const [st, prob] of Object.entries(mix)) {
      acc += prob; if (r < acc) return st;
    }
    return Object.keys(mix)[0];
  };

  let totalTasks = 0, totalCompleted = 0, withPoints = 0;
  const phaseDistribution = { confirmed: 0, leader_review: 0, final_review: 0, proposing: 0, none: 0 };

  for (const g of groups) {
    const cfg = taskMix[g.status] || taskMix.in_progress;
    const groupStart = new Date(g.start_date);
    const groupAge = Math.max(7, Math.floor((Date.now() - groupStart) / 86400000));
    for (let i = 0; i < cfg.count; i++) {
      const pool = pick(cfg.pools);
      const title = pick(taskTitles[pool]);
      const status = pickStatusByMix(cfg.status);
      const taskStart = daysFromStart(groupStart, rand(0, Math.max(1, groupAge - 7)));
      const deadline = daysFromStart(taskStart, rand(7, 30));
      // 15% เป็น meeting
      const isMeeting = pool === 'meeting' || Math.random() < 0.1;
      const kind = isMeeting ? 'meeting' : 'task';

      // Assignees: 1-3 from group members
      const groupMems = g._members || [];
      const assignees = pickMany(groupMems, rand(1, Math.min(3, groupMems.length)));

      // Points workflow — only for completed non-meeting tasks
      let pointsPhase = 'none';
      let points = 0;
      let pointsShares = null;
      if (status === 'completed' && !isMeeting && Math.random() < 0.75) {
        // 75% ของ completed tasks มี points
        // Phase distribution: 65% confirmed, 15% leader_review, 10% final_review, 10% proposing
        const r = Math.random();
        if      (r < 0.65) pointsPhase = 'confirmed';
        else if (r < 0.80) pointsPhase = 'leader_review';
        else if (r < 0.90) pointsPhase = 'final_review';
        else               pointsPhase = 'proposing';
        points = rand(2, 12);
        // แบ่ง points ระหว่าง assignees (สุ่ม split)
        const totalShares = points;
        const splits = [];
        let remaining = totalShares;
        for (let j = 0; j < assignees.length - 1; j++) {
          const part = j === assignees.length - 1 ? remaining : rand(1, Math.max(1, Math.floor(remaining / (assignees.length - j))));
          splits.push(part); remaining -= part;
        }
        splits.push(remaining);
        pointsShares = splits;
        phaseDistribution[pointsPhase]++;
        withPoints++;
      } else if (status === 'completed') {
        phaseDistribution.none++;
      }

      // Build assignees in createTask format: [{ id, role, points_share }]
      const assigneeSpecs = assignees.map((aid, j) => ({
        id: aid,
        role: j === 0 ? 'leader' : 'member',
        points_share: pointsShares ? (pointsShares[j] || 0) : 0,
      }));
      // For meetings: ensure deadline = datetime not date (createTask validates end_time > deadline)
      const dlForApi = isMeeting ? dateISO(deadline) : dateOnly(deadline);
      // Create task — createTask auto-sets completed_at to now if status=completed.
      // เราจะ UPDATE ทีหลังให้เป็นวันในอดีต (realistic)
      const task = await db.createTask({
        title,
        description: pool === 'meeting' ? `วาระการประชุม: ${title}` : '',
        kind,
        group_id: g.id,
        status,
        start_date: dateOnly(taskStart),
        deadline: dlForApi,
        end_time: isMeeting ? dateISO(new Date(deadline.getTime() + 60 * 60 * 1000)) : null,
        budget: Math.random() < 0.3 ? rand(1, 100) * 10000 : null,
        points,
        points_phase: pointsPhase,
        assignees: assigneeSpecs,
      });

      // Override completed_at to a past date (realistic vs createTask's nowIso())
      let completedDate = null;
      if (status === 'completed' && task.id) {
        completedDate = dateISO(daysFromStart(taskStart, rand(3, Math.max(4, Math.min(60, Math.floor((Date.now() - taskStart) / 86400000))))));
        await exec('UPDATE tasks SET completed_at = $1 WHERE id = $2', [completedDate, task.id]);
      }

      // Override task_assignees.assigned_at / proposed_at เพื่อให้ "วันที่ได้ point"
      // กระจายตามเวลาจริง — ไม่ใช่ปัจจุบันที่ seed ทุกอันเป็น today
      //   - assigned_at = start_date ของ task (วันที่ถูกมอบหมาย)
      //   - proposed_at = completed_at (วันที่งานเสร็จ = วันที่เสนอ points)
      //   - earned_at SQL = COALESCE(proposed_at, assigned_at) → ใช้ proposed_at ถ้ามี
      if (task.id && assignees.length > 0) {
        const assignedIso = dateISO(taskStart);
        const proposedIso = completedDate || null;   // null สำหรับงานที่ยังไม่เสร็จ
        await exec(
          `UPDATE task_assignees SET assigned_at = $1, proposed_at = $2 WHERE task_id = $3`,
          [assignedIso, proposedIso, task.id]
        );
      }

      // Optional: random 1-2 categories
      if (cats.length > 0 && Math.random() < 0.4) {
        const taskCats = pickMany(cats, rand(1, 2));
        for (const cat of taskCats) {
          try { await exec('INSERT INTO task_categories (task_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [task.id, cat.id]); } catch {}
        }
      }

      totalTasks++;
      if (status === 'completed') totalCompleted++;
    }
  }
  console.log(`   ✓ ${totalTasks} tasks (${totalCompleted} completed, ${withPoints} มี points)`);
  console.log(`     Phase: confirmed=${phaseDistribution.confirmed}, leader_review=${phaseDistribution.leader_review}, final_review=${phaseDistribution.final_review}, proposing=${phaseDistribution.proposing}`);
  return totalTasks;
}

// ── Point Requests + Deadline Requests ──────────────────────────────────
async function seedRequests(members) {
  console.log('💰 Seeding point/deadline requests...');
  // Random 5 in_progress tasks → create point_requests
  const tasks = await query(`SELECT t.id, t.title, t.points, t.group_id, ta.member_id
                              FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id
                              WHERE t.status = 'in_progress' ORDER BY RANDOM() LIMIT 5`);
  let pr = 0;
  for (const t of tasks) {
    const req = (t.points || 0) + rand(2, 8);
    const status = pick(['pending', 'pending', 'approved', 'rejected']);
    await exec(
      `INSERT INTO point_requests (id, task_id, requested_by, current_points, requested_points, reason, status, created_at, decided_at, decided_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        require('crypto').randomBytes(8).toString('hex'),
        t.id, t.member_id, t.points || 0, req,
        pick(['งานยากกว่าที่คิด','ต้องทำเอกสารเพิ่มเติม','ใช้เวลามากกว่าประมาณการ','scope ขยาย']),
        status,
        new Date(Date.now() - rand(1, 30) * 86400000).toISOString(),
        status === 'pending' ? null : new Date().toISOString(),
        status === 'pending' ? null : (await query("SELECT id FROM members WHERE role IN ('admin','boss') ORDER BY RANDOM() LIMIT 1"))[0].id,
      ]
    );
    pr++;
  }
  console.log(`   ✓ ${pr} point requests`);

  // Random 4 in_progress tasks → deadline requests
  const dlTasks = await query(`SELECT t.id, t.deadline, ta.member_id
                                FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id
                                WHERE t.status = 'in_progress' AND t.deadline IS NOT NULL ORDER BY RANDOM() LIMIT 4`);
  let dr = 0;
  for (const t of dlTasks) {
    const newDate = new Date(t.deadline);
    newDate.setDate(newDate.getDate() + rand(7, 21));
    const status = pick(['pending', 'approved', 'rejected', 'pending']);
    await exec(
      `INSERT INTO deadline_requests (id, task_id, requested_by, current_deadline, requested_deadline, reason, status, created_at, decided_at, decided_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        require('crypto').randomBytes(8).toString('hex'),
        t.id, t.member_id, t.deadline, dateOnly(newDate),
        pick(['รอข้อมูลจากภาคสนาม','พบปัญหา technical','รออนุมัติงบ','ผู้รับผิดชอบลาป่วย']),
        status,
        new Date(Date.now() - rand(1, 20) * 86400000).toISOString(),
        status === 'pending' ? null : new Date().toISOString(),
        status === 'pending' ? null : (await query("SELECT id FROM members WHERE role IN ('admin','boss') ORDER BY RANDOM() LIMIT 1"))[0].id,
      ]
    );
    dr++;
  }
  console.log(`   ✓ ${dr} deadline requests`);
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Seed Demo Data — 6 เดือนย้อนหลัง ===\n');
  await db.init();
  const members = await db.listMembers();
  console.log(`👥 Found ${members.length} members (keep as-is)`);

  await wipeAll();
  const conns  = await seedConnections(members);
  const groups = await seedGroups(members, conns);
  await seedTasks(members, groups);
  await seedRequests(members);

  console.log('\n=== Summary ===');
  console.log(`Members:     ${(await query('SELECT COUNT(*) FROM members'))[0].count}`);
  console.log(`Connections: ${(await query('SELECT COUNT(*) FROM connections'))[0].count}`);
  console.log(`Groups:      ${(await query('SELECT COUNT(*) FROM task_groups'))[0].count}`);
  console.log(`Tasks:       ${(await query('SELECT COUNT(*) FROM tasks'))[0].count}`);
  console.log(`Assignees:   ${(await query('SELECT COUNT(*) FROM task_assignees'))[0].count}`);
  console.log(`Point reqs:  ${(await query('SELECT COUNT(*) FROM point_requests'))[0].count}`);
  console.log(`DL reqs:     ${(await query('SELECT COUNT(*) FROM deadline_requests'))[0].count}`);
  console.log('\n✅ Done!');
  await db.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ FAILED:', e.message); console.error(e.stack); process.exit(1); });
