require('dotenv').config();
const db = require('./db');
const auth = require('./auth');

const args = process.argv.slice(2);
const RESET = args.includes('--reset') || args.includes('-r');
const DEFAULT_PIN = '1234';

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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

  const total = (await db.listMembers()).length + (await db.listGroups()).length + (await db.listTasks()).length;
  if (total > 0 && !RESET) {
    console.log(`DB already has data. Use 'npm run reset' to wipe and re-seed.`);
    await db.close();
    process.exit(0);
  }

  console.log('Seeding members…');
  const memberSeeds = [
    { name: 'อาจารย์', role: 'admin',  email: 'ajan@smartcitylab.org',   color: '#4f46e5' },
    { name: 'วิว',     role: 'admin',  email: 'view@smartcitylab.org',   color: '#0ea5e9' },
    { name: 'เคน',     role: 'member', email: 'ken@smartcitylab.org',    color: '#10b981' },
    { name: 'นะนิ้ง',  role: 'member', email: 'naning@smartcitylab.org', color: '#f59e0b' },
    { name: 'ตี้',     role: 'member', email: 'tee@smartcitylab.org',    color: '#ec4899' },
    { name: 'สอง',     role: 'member', email: 'song@smartcitylab.org',   color: '#a855f7' },
    { name: 'โอ๊ต',    role: 'member', email: 'oat@smartcitylab.org',    color: '#14b8a6' },
  ];
  const members = [];
  for (const m of memberSeeds) members.push(await db.createMember({ ...m, password_hash: auth.hashPassword(DEFAULT_PIN) }));
  const M = Object.fromEntries(members.map(m => [m.name.split(' ').slice(-1)[0], m.id]));
  const adminId = M['อาจารย์'];

  console.log('Seeding task groups…');
  const groupSeeds = [
    { name: 'Smart Traffic Monitoring Proposal',
      description: 'งานเสนอโครงการวิเคราะห์การจราจรอัจฉริยะด้วย CCTV + AI ส่งเทศบาลเมือง',
      target: 'เทศบาลเมืองฉะเชิงเทรา',
      leader_id: M['อาจารย์'],
      start_date: dateOffset(-25), deadline: dateOffset(15), status: 'in_progress' },
    { name: 'IoT Air Quality Sensor Deployment',
      description: 'ติดตั้งและทดสอบเซ็นเซอร์วัด PM2.5 ในพื้นที่ชุมชน 10 จุด',
      target: 'เทศบาลตำบลเทพารักษ์',
      leader_id: M['เคน'],
      start_date: dateOffset(-50), deadline: dateOffset(7),  status: 'in_progress' },
    { name: 'Workshop "Smart City for All" 2026',
      description: 'จัด Workshop เผยแพร่ผลงานวิจัยและรับฟังเสียงประชาชน',
      target: 'มหาวิทยาลัย',
      leader_id: M['นะนิ้ง'],
      start_date: dateOffset(-10), deadline: dateOffset(45), status: 'on_hold' },
    { name: 'Research Paper — Air Quality ML Model',
      description: 'งานวิจัยตีพิมพ์โมเดล Machine Learning สำหรับพยากรณ์ค่าฝุ่นละออง',
      target: 'IEEE Access',
      leader_id: M['วิว'],
      start_date: dateOffset(-90), deadline: dateOffset(-5), status: 'in_progress' },
    { name: 'Lab Infrastructure & Onboarding',
      description: 'งานสนับสนุนภายในแล็บ — เซิร์ฟเวอร์, ระบบสมาชิก, เอกสาร',
      target: 'แล็บภายใน',
      leader_id: M['เคน'],
      start_date: dateOffset(-120), deadline: null, status: 'in_progress' },
    { name: 'Open Group — รอผู้นำ',
      description: 'กลุ่มเปิดที่ยังไม่มีหัวหน้า — Member สามารถ "หยิบกลุ่มนี้" เพื่อเป็นหัวหน้าได้',
      target: '',
      leader_id: null,
      start_date: dateOffset(0), deadline: dateOffset(30), status: 'on_hold' },
  ];
  const groups = [];
  for (const g of groupSeeds) groups.push(await db.createGroup(g));
  const [G_TRAFFIC, G_IOT, G_WORKSHOP, G_PAPER, G_LAB] = groups.map(g => g.id);

  function A(...rows) { return rows.map(r => Array.isArray(r) ? { id: r[0], role: 'member', points_share: r[2] || 0 } : r); }
  // Task-level leader concept removed — both helpers produce equal members.
  const lead = (id, pts) => [id, 'member', pts];
  const memb = (id, pts) => [id, 'member', pts];

  console.log('Seeding tasks…');
  const tasks = [
    { title: 'เขียน TOR (Terms of Reference)', description: 'TOR ฉบับสมบูรณ์ส่งเทศบาล',
      group_id: G_TRAFFIC, target: 'เทศบาลเมืองฉะเชิงเทรา',
      assignees: A(lead(M['อาจารย์'], 8)), points: 8,
      start_date: dateOffset(-25), deadline: dateOffset(-15), status: 'completed' },
    { title: 'ร่าง Proposal โครงการ Smart Traffic', description: 'Proposal ตาม template เทศบาล',
      group_id: G_TRAFFIC, target: 'เทศบาลเมืองฉะเชิงเทรา',
      assignees: A(lead(M['อาจารย์'], 3), memb(M['วิว'], 2)), points: 5,
      start_date: dateOffset(-25), deadline: dateOffset(-15), status: 'completed' },
    { title: 'ทำ Slide นำเสนอ Smart Traffic', description: 'สไลด์ 15 นาที สำหรับเสนอกรรมการ',
      group_id: G_TRAFFIC, target: 'เทศบาลเมืองฉะเชิงเทรา',
      assignees: A(lead(M['วิว'], 10)), points: 10,
      start_date: dateOffset(-12), deadline: dateOffset(-2),  status: 'completed' },
    { title: 'จัดทำงบประมาณโครงการ', description: 'ประเมินค่าอุปกรณ์ + ค่าแรง',
      group_id: G_TRAFFIC, target: 'อบจ.ฉะเชิงเทรา',
      assignees: A(lead(M['เคน'], 4), memb(M['ตี้'], 2)), points: 6,
      start_date: dateOffset(-8), deadline: dateOffset(2), status: 'in_progress' },
    { title: 'ส่ง Proposal ให้เทศบาล',
      group_id: G_TRAFFIC, target: 'เทศบาลเมืองฉะเชิงเทรา',
      assignees: A(lead(M['อาจารย์'], 3)), points: 3,
      start_date: dateOffset(0), deadline: dateOffset(15), status: 'on_hold' },
    { title: 'รวบรวมข้อมูลกล้อง CCTV ในเขตเทศบาล',
      group_id: G_TRAFFIC, target: 'เทศบาลเมืองฉะเชิงเทรา',
      assignees: A(lead(M['อาจารย์'], 4)), points: 4,
      start_date: dateOffset(-5), deadline: dateOffset(10), status: 'on_hold' },
    { title: 'จัดซื้ออุปกรณ์ ESP32 + เซ็นเซอร์ PMS7003',
      group_id: G_IOT, target: 'แล็บภายใน',
      assignees: A(lead(M['ตี้'], 4)), points: 4,
      start_date: dateOffset(-50), deadline: dateOffset(-40), status: 'completed' },
    { title: 'ออกแบบกล่องบรรจุเซ็นเซอร์ (3D Print)',
      group_id: G_IOT, target: 'แล็บภายใน',
      assignees: A(lead(M['สอง'], 8)), points: 8,
      start_date: dateOffset(-40), deadline: dateOffset(-25), status: 'completed' },
    { title: 'เขียน Firmware ส่งข้อมูลขึ้น MQTT',
      group_id: G_IOT, target: 'แล็บภายใน',
      assignees: A(lead(M['เคน'], 10), memb(M['ตี้'], 5)), points: 15,
      start_date: dateOffset(-35), deadline: dateOffset(-10), status: 'completed' },
    { title: 'ติดตั้งเซ็นเซอร์ 10 จุดในชุมชน', description: 'ลงพื้นที่จริง พร้อมขออนุญาตเจ้าของพื้นที่',
      group_id: G_IOT, target: 'เทศบาลตำบลเทพารักษ์',
      assignees: A(lead(M['นะนิ้ง'], 8), memb(M['โอ๊ต'], 4)), points: 12,
      start_date: dateOffset(-15), deadline: dateOffset(3), status: 'in_progress' },
    { title: 'ทำ Dashboard แสดงข้อมูลแบบ Real-time',
      group_id: G_IOT, target: 'เทศบาลตำบลเทพารักษ์',
      assignees: A(lead(M['ตี้'], 12), memb(M['เคน'], 6)), points: 18,
      start_date: dateOffset(-20), deadline: dateOffset(7), status: 'in_progress' },
    { title: 'เขียนคู่มือการใช้งานสำหรับชาวบ้าน',
      group_id: G_IOT, target: 'เทศบาลตำบลเทพารักษ์',
      assignees: A(lead(M['สอง'], 5)), points: 5,
      start_date: dateOffset(-5), deadline: dateOffset(10), status: 'on_hold' },
    { title: 'จองสถานที่จัด Workshop',
      group_id: G_WORKSHOP, target: 'มหาวิทยาลัย',
      assignees: A(lead(M['นะนิ้ง'], 4)), points: 4,
      start_date: dateOffset(-10), deadline: dateOffset(-2), status: 'completed' },
    { title: 'ออกแบบโปสเตอร์ประชาสัมพันธ์',
      group_id: G_WORKSHOP, target: 'แล็บภายใน',
      assignees: A(lead(M['สอง'], 10)), points: 10,
      start_date: dateOffset(-5), deadline: dateOffset(5), status: 'in_progress' },
    { title: 'ติดต่อวิทยากรรับเชิญ 3 ท่าน',
      group_id: G_WORKSHOP, target: 'แล็บภายใน',
      assignees: A(lead(M['วิว'], 6)), points: 6,
      start_date: dateOffset(-3), deadline: dateOffset(20), status: 'on_hold' },
    { title: 'เตรียม Slide สรุปงานวิจัยของแล็บ',
      group_id: G_WORKSHOP, target: 'มหาวิทยาลัย',
      assignees: A(lead(M['อาจารย์'], 8), memb(M['วิว'], 4)), points: 12,
      start_date: dateOffset(0), deadline: dateOffset(35), status: 'on_hold' },
    { title: 'จัดทำเอกสารสำหรับผู้เข้าร่วม',
      group_id: G_WORKSHOP, target: 'แล็บภายใน',
      assignees: A(lead(M['สอง'], 5), memb(M['โอ๊ต'], 3)), points: 8,
      start_date: dateOffset(10), deadline: dateOffset(40), status: 'on_hold' },
    { title: 'รวบรวมและทำความสะอาดข้อมูล PM2.5 ปี 2023-2025',
      group_id: G_PAPER, target: 'IEEE Access',
      assignees: A(lead(M['นะนิ้ง'], 15)), points: 15,
      start_date: dateOffset(-90), deadline: dateOffset(-70), status: 'completed' },
    { title: 'ทดลองโมเดล LSTM, GRU, Transformer',
      group_id: G_PAPER, target: 'IEEE Access',
      assignees: A(lead(M['เคน'], 25)), points: 25,
      start_date: dateOffset(-65), deadline: dateOffset(-30), status: 'completed' },
    { title: 'เขียนบท Methodology และ Results',
      group_id: G_PAPER, target: 'IEEE Access',
      assignees: A(lead(M['เคน'], 14), memb(M['วิว'], 6)), points: 20,
      start_date: dateOffset(-30), deadline: dateOffset(-10), status: 'in_progress' },
    { title: 'Review และแก้ไข Paper โดย Senior',
      group_id: G_PAPER, target: 'IEEE Access',
      assignees: A(lead(M['วิว'], 12)), points: 12,
      start_date: dateOffset(-10), deadline: dateOffset(-3), status: 'in_progress' },
    { title: 'Submit Paper ไปยัง IEEE Access',
      group_id: G_PAPER, target: 'IEEE Access',
      assignees: A(lead(M['อาจารย์'], 5)), points: 5,
      start_date: dateOffset(-2), deadline: dateOffset(-5), status: 'on_hold' },
    { title: 'ตั้งค่า Server สำหรับเก็บข้อมูล IoT',
      group_id: G_LAB, target: 'แล็บภายใน',
      assignees: A(lead(M['ตี้'], 10)), points: 10,
      start_date: dateOffset(-120), deadline: dateOffset(-100), status: 'completed' },
    { title: 'พัฒนาระบบ Member Management',
      group_id: G_LAB, target: 'แล็บภายใน',
      assignees: A(lead(M['เคน'], 14), memb(M['ตี้'], 6)), points: 20,
      start_date: dateOffset(-7), deadline: dateOffset(7), status: 'in_progress' },
    { title: 'จัดทำ Onboarding Document สำหรับสมาชิกใหม่',
      group_id: G_LAB, target: 'แล็บภายใน',
      assignees: A(lead(M['โอ๊ต'], 6)), points: 6,
      start_date: dateOffset(-30), deadline: dateOffset(-10), status: 'on_hold' },
    { title: 'อ่าน Paper เกี่ยวกับ Federated Learning',
      description: 'งานพัฒนาตนเอง',
      target: 'งานส่วนตัว',
      assignees: A(lead(M['เคน'], 3)), points: 3,
      start_date: dateOffset(-2), deadline: dateOffset(14), status: 'on_hold' },
    { title: 'จัดส่งรายงานผลการทดสอบเซ็นเซอร์ราย 6 เดือน',
      description: 'ส่งกระทรวงคมนาคม',
      target: 'กระทรวงคมนาคม',
      assignees: A(lead(M['อาจารย์'], 5), memb(M['นะนิ้ง'], 5)), points: 10,
      start_date: dateOffset(-30), deadline: dateOffset(-2), status: 'in_progress' },

    // ===== Meetings =====
    // Meetings have NO start_date — only a `deadline` carrying the meeting date+time.
    // Group-level meetings (one per active group)
    { title: 'ประชุมความคืบหน้า Smart Traffic', description: 'ประจำสัปดาห์',
      group_id: G_TRAFFIC,
      kind: 'meeting', location_type: 'onsite_internal', location_detail: 'ห้องประชุม Lab A203',
      assignees: A(lead(M['อาจารย์']), memb(M['วิว']), memb(M['เคน']), memb(M['ตี้'])),
      deadline: dateOffset(2) + 'T10:00', status: 'on_hold' },
    { title: 'นัดดูงานติดตั้งเซ็นเซอร์ภาคสนาม', description: 'ลงพื้นที่ตรวจการติดตั้ง 5 จุดแรก',
      group_id: G_IOT,
      kind: 'meeting', location_type: 'onsite_external', location_detail: 'เทศบาลตำบลเทพารักษ์ (จุดที่ 3)',
      assignees: A(lead(M['เคน']), memb(M['นะนิ้ง']), memb(M['ตี้']), memb(M['โอ๊ต'])),
      deadline: dateOffset(5) + 'T13:30', status: 'on_hold' },
    { title: 'Sync ทีม Workshop เตรียมงานวันงาน', description: 'เช็ค checklist โปสเตอร์ + วิทยากร',
      group_id: G_WORKSHOP,
      kind: 'meeting', location_type: 'online', location_detail: 'https://meet.google.com/abc-defg-hij',
      assignees: A(lead(M['นะนิ้ง']), memb(M['สอง']), memb(M['วิว'])),
      deadline: dateOffset(7) + 'T15:00', status: 'on_hold' },
    { title: 'Review Paper Methodology พร้อม Senior', description: 'ก่อน submit IEEE Access',
      group_id: G_PAPER,
      kind: 'meeting', location_type: 'online', location_detail: 'https://zoom.us/j/123456789',
      assignees: A(lead(M['วิว']), memb(M['เคน'])),
      deadline: dateOffset(1) + 'T16:00', status: 'in_progress' },

    // Lab-wide meetings (no group_id — these are cross-team meetings)
    { title: 'Lab Weekly All-hands', description: 'ประชุมสรุปงานทุกกลุ่ม + แจก Point ประจำสัปดาห์',
      group_id: null,
      kind: 'meeting', location_type: 'onsite_internal', location_detail: 'ห้องประชุมใหญ่ ชั้น 4',
      assignees: A(lead(M['อาจารย์']), memb(M['วิว']), memb(M['เคน']), memb(M['นะนิ้ง']), memb(M['ตี้']), memb(M['สอง']), memb(M['โอ๊ต'])),
      deadline: dateOffset(1) + 'T09:00', status: 'on_hold' },
    { title: 'Lab Retrospective & Planning Q2', description: 'มองย้อน Q1 + วางแผน Q2',
      group_id: null,
      kind: 'meeting', location_type: 'onsite_internal', location_detail: 'ห้องประชุมใหญ่ ชั้น 4',
      assignees: A(lead(M['อาจารย์']), memb(M['วิว']), memb(M['เคน']), memb(M['นะนิ้ง']), memb(M['ตี้']), memb(M['สอง']), memb(M['โอ๊ต'])),
      deadline: dateOffset(-30) + 'T13:00', status: 'completed' },
  ];
  // Completed tasks in the seed represent "history" — points already confirmed at past meetings.
  // So we mark them as phase='confirmed' so points_share gets honored and feeds the scoreboard.
  // Other statuses default to phase='none' (workflow not started yet).
  for (const t of tasks) {
    const seeded = t.status === 'completed' ? { ...t, points_phase: 'confirmed' } : t;
    await db.createTask(seeded, { created_by: adminId });
  }

  console.log('Seeding connections…');
  const connections = [
    { member_id: M['อาจารย์'],       company: 'อบจ.ฉะเชิงเทรา',         contact_name: 'คุณวิชัย ภูมิดี',  contact_role: 'นายกฯ',          phone: '038-111111', email: 'wichai@chachoengsao.go.th', notes: 'ผู้สนับสนุนหลักโครงการ Smart Traffic' },
    { member_id: M['อาจารย์'],       company: 'เทศบาลเมืองฉะเชิงเทรา',  contact_name: 'คุณรัตนา สวัสดิ์',  contact_role: 'นายกเทศมนตรี',  phone: '038-222222', email: 'rattana@cco.local',         notes: 'ติดต่อเรื่องการติดตั้ง CCTV' },
    { member_id: M['วิว'],    company: 'กระทรวงคมนาคม',         contact_name: 'ดร.ชลธี ทองทวี', contact_role: 'นักวิชาการ',     phone: '02-2832000', email: 'cholthi@motc.go.th',        notes: 'พี่เลี้ยงโครงการกระทรวง' },
    { member_id: M['นะนิ้ง'],   company: 'เทศบาลตำบลเทพารักษ์',   contact_name: 'คุณสมศักดิ์ ใจกล้า', contact_role: 'ปลัดเทศบาล',  phone: '02-7575757', email: 'somsak@theparak.local',     notes: 'ขอใช้พื้นที่ติดตั้ง IoT 10 จุด' },
    { member_id: M['เคน'], company: 'IEEE Access',           contact_name: 'Dr. James Wilson', contact_role: 'Editor',         phone: '',           email: 'jwilson@ieee.org',          notes: 'Editor for Air Quality ML paper' },
    { member_id: M['ตี้'],      company: 'บริษัท IoT Asia จำกัด',  contact_name: 'คุณภัทรพล',         contact_role: 'Sales',          phone: '02-5555555', email: 'pat@iotasia.co.th',         notes: 'Vendor ขายเซ็นเซอร์ PMS7003' },
    { member_id: M['สอง'],       company: 'Print Studio Bangkok',   contact_name: 'คุณนาย',             contact_role: 'Owner',          phone: '081-2345678', email: 'studio@print.local',        notes: 'พิมพ์โปสเตอร์ และของชำร่วย' },
  ];
  for (const c of connections) await db.createConnection(c);

  console.log('Seeding sample leaves…');
  // dateOffset(5) intentionally has 3 overlapping leaves (ตี้ + นะนิ้ง + เคน)
  // so the calendar shows multi-row stacking on a single day.
  const leaveSeeds = [
    { member_id: M['ตี้'],     start_at: dateOffset(3) + 'T00:00', end_at: dateOffset(5) + 'T23:59', reason: 'พักร้อน' },
    { member_id: M['นะนิ้ง'],  start_at: dateOffset(4) + 'T00:00', end_at: dateOffset(5) + 'T23:59', reason: 'ลากิจ' },
    { member_id: M['เคน'],    start_at: dateOffset(5) + 'T08:00', end_at: dateOffset(5) + 'T17:00', reason: 'ลาครึ่งวัน — สัมภาษณ์' },
    { member_id: M['สอง'],    start_at: dateOffset(1) + 'T13:00', end_at: dateOffset(1) + 'T17:00', reason: 'ลากิจ — ไปพบหมอ' },
    { member_id: M['โอ๊ต'],   start_at: dateOffset(7) + 'T00:00', end_at: dateOffset(8) + 'T23:59', reason: 'ลาป่วย' },
  ];
  for (const l of leaveSeeds) await db.createLeave(l);

  console.log('Seeding sample deadline request…');
  const inProgressTasks = await db.listTasks({ status: 'in_progress' });
  if (inProgressTasks.length > 0) {
    const t = inProgressTasks.find(x => x.assignees.length > 0);
    if (t) {
      const requester = t.assignees[0];
      await db.requestDeadline({
        task_id: t.id,
        requested_by: requester.id,
        requested_deadline: dateOffset(20),
        reason: 'ต้องการเวลาเพิ่มเพื่อทดสอบเพิ่มเติมในพื้นที่จริง',
      });
    }
  }

  console.log('---');
  const allMembers = await db.listMembers();
  console.log(`Members: ${allMembers.length}  (admins: ${allMembers.filter(m=>m.role==='admin').length})`);
  console.log(`Groups:  ${(await db.listGroups()).length}`);
  console.log(`Tasks:   ${(await db.listTasks()).length}`);
  console.log(`Connections: ${(await db.listConnections()).length}`);
  console.log(`Deadline requests pending: ${(await db.listDeadlineRequests()).filter(r => r.status === 'pending').length}`);
  const stats = await db.getStats();
  console.log(`Completed: ${stats.summary.completed}, In progress: ${stats.summary.in_progress}, On hold: ${stats.summary.on_hold}, Overdue: ${stats.summary.overdue}`);
  console.log(`Total points distributed (completed tasks): ${stats.summary.total_points_completed}`);
  console.log('Top 3 scoreboard:');
  stats.scoreboard.slice(0, 3).forEach(r => console.log(`  - ${r.member.name}: ${r.points} pts (${r.percent}%)`));
  console.log('---');
  console.log(`Default password (PIN) for everyone: ${DEFAULT_PIN}`);
  console.log('Admin login: "อาจารย์" / 1234   หรือ   "วิว" / 1234');
  console.log('Seed complete!');
  await db.close();
})().catch(err => { console.error(err); process.exit(1); });
