// One-off script: delete ~half the tasks, then attach 5 mockup files
// Run with: npm run mock-files
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

(async () => {
  await db.init();
  console.log('--- Mockup files script ---');

  const all = await db.listTasks();
  console.log(`Tasks before: ${all.length}`);

  const sorted = [...all].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const toDelete = sorted.filter((_, i) => i % 2 === 1);
  for (const t of toDelete) await db.deleteTask(t.id);

  const remaining = await db.listTasks();
  console.log(`Deleted ${toDelete.length} tasks → ${remaining.length} remain.\n`);

  const members = await db.listMembers();

const mocks = [
  {
    matchers: ['TOR', 'Proposal', 'Smart Traffic'],
    filename: 'Smart_Traffic_Proposal_v3.md',
    mime: 'text/markdown',
    content: [
      '# โครงการ Smart Traffic Monitoring',
      '',
      '## บทคัดย่อ',
      'โครงการนี้เสนอการพัฒนาระบบติดตามและวิเคราะห์การจราจร',
      'ในเขตเทศบาลเมืองฉะเชิงเทรา โดยใช้กล้อง CCTV ที่มีอยู่เดิม',
      'ร่วมกับ Computer Vision (YOLOv8) และ Edge AI เพื่อ:',
      '',
      '1. นับยานพาหนะและจำแนกประเภท (รถยนต์/มอเตอร์ไซค์/รถบรรทุก)',
      '2. ตรวจจับเหตุการณ์ผิดปกติ (อุบัติเหตุ, การจอดในเขตห้าม)',
      '3. คาดการณ์ปริมาณจราจร 30 นาทีล่วงหน้า',
      '',
      '## งบประมาณ',
      'รวม 356,000 บาท (รายละเอียดในไฟล์ budget CSV)',
      '',
      '## ระยะเวลาดำเนินการ',
      '6 เดือน — เริ่ม Q3 2026',
      '',
      '## ผลลัพธ์ที่คาดหวัง',
      '- ลดเวลารอที่แยกหลัก > 25%',
      '- รายงานเหตุเร่งด่วน real-time ภายใน < 30 วินาที',
      '- รายงานสรุปประจำเดือนสำหรับเทศบาล',
      '',
    ].join('\n'),
  },
  {
    matchers: ['งบประมาณ', 'Slide'],
    filename: 'งบประมาณ_Smart_Traffic_v1.csv',
    mime: 'text/csv',
    content: [
      'รายการ,หน่วย,ราคา/หน่วย (บาท),รวม (บาท)',
      'กล้อง CCTV 4K + IR night,10,15000,150000',
      'NVR Server (Edge AI),1,75000,75000',
      'จอแสดงผล Public 32",2,8000,16000',
      'เสาติดตั้ง + ฐาน 6 เมตร,10,3500,35000',
      'ค่าเดินสายไฟ + เน็ต,1,40000,40000',
      'ค่าแรงติดตั้ง,1,40000,40000',
      ',,,',
      'รวมทั้งสิ้น,,,356000',
      '',
    ].join('\n'),
  },
  {
    matchers: ['Firmware', 'Sensor', 'Dashboard', 'IoT', 'ติดตั้ง', 'จัดซื้อ'],
    filename: 'PMS7003_Calibration_Notes.md',
    mime: 'text/markdown',
    content: [
      '# Sensor Calibration Notes — PMS7003',
      '',
      '## Hardware',
      '- ESP32-WROOM-32 + PMS7003 ผ่าน UART',
      '- BME680 (RH/T) เพื่อชดเชยความชื้น',
      '- ส่งข้อมูลผ่าน MQTT ทุก 30 วินาที',
      '',
      '## Calibration formula',
      '```',
      'PM2.5_corrected = K * PM2.5_raw - C * RH',
      'where K = 0.93 ± 0.04, C = 0.18',
      '```',
      '',
      '## Field validation (vs reference TEOM)',
      '',
      '| Site                 | R²   | RMSE (µg/m³) |',
      '|----------------------|------|--------------|',
      '| ตลาดสด               | 0.92 | 4.3          |',
      '| โรงเรียนบ้านเทพารักษ์ | 0.89 | 5.1          |',
      '| โรงพยาบาลส่งเสริมฯ   | 0.94 | 3.7          |',
      '',
      '## Known issues',
      '- ค่า raw จะ drift +5-8 µg/m³ เมื่อ RH > 90% — ใช้สูตรชดเชย',
      '- ฝุ่นเกาะที่ inlet ทุก 6 เดือน — ต้อง maintenance',
      '',
    ].join('\n'),
  },
  {
    matchers: ['Workshop', 'Poster', 'โปสเตอร์', 'จองสถาน', 'วิทยากร'],
    filename: 'Workshop_Poster_Draft_v2.svg',
    mime: 'image/svg+xml',
    content: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">',
      '  <defs>',
      '    <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">',
      '      <stop offset="0%" stop-color="#4f46e5"/>',
      '      <stop offset="60%" stop-color="#0ea5e9"/>',
      '      <stop offset="100%" stop-color="#06b6d4"/>',
      '    </linearGradient>',
      '  </defs>',
      '  <rect width="400" height="600" fill="url(#bg)"/>',
      '  <text x="200" y="120" text-anchor="middle" font-family="Prompt, sans-serif" font-size="44" font-weight="700" fill="#fff">Smart City</text>',
      '  <text x="200" y="172" text-anchor="middle" font-family="Prompt, sans-serif" font-size="38" font-weight="700" fill="#fff">For All</text>',
      '  <line x1="80" y1="200" x2="320" y2="200" stroke="#fff" stroke-width="2" opacity="0.5"/>',
      '  <text x="200" y="240" text-anchor="middle" font-family="Prompt, sans-serif" font-size="20" fill="#fff">Workshop 2026</text>',
      '  <text x="200" y="280" text-anchor="middle" font-family="Prompt, sans-serif" font-size="14" fill="#fff" opacity="0.95">12 พฤษภาคม 2026 - 09:00-16:00</text>',
      '  <text x="200" y="305" text-anchor="middle" font-family="Prompt, sans-serif" font-size="13" fill="#fff" opacity="0.85">หอประชุม สมาร์ทซิตี้ แล็บ</text>',
      '  <circle cx="200" cy="430" r="70" fill="#fff" opacity="0.18"/>',
      '  <text x="200" y="448" text-anchor="middle" font-size="64">CITY</text>',
      '  <text x="200" y="540" text-anchor="middle" font-family="Prompt, sans-serif" font-size="13" fill="#fff" opacity="0.9">— ฟรี! ไม่เสียค่าใช้จ่าย —</text>',
      '  <text x="200" y="565" text-anchor="middle" font-family="Prompt, sans-serif" font-size="11" fill="#fff" opacity="0.8">Smart City Lab x เทศบาลเมืองฉะเชิงเทรา</text>',
      '</svg>',
      '',
    ].join('\n'),
  },
  {
    matchers: ['Paper', 'Methodology', 'LSTM', 'PM2.5', 'รวบรวม', 'ทดลอง', 'Review'],
    filename: 'PM25_dataset_summary_2023-2025.csv',
    mime: 'text/csv',
    content: [
      'station_id,station_name,year,n_samples,mean_pm25,std,p95,missing_pct',
      'CCS-001,ตลาดสด,2023,8760,42.3,18.4,87.6,1.2',
      'CCS-001,ตลาดสด,2024,8784,38.7,16.1,78.4,0.8',
      'CCS-001,ตลาดสด,2025,8760,41.5,17.8,84.2,1.1',
      'CCS-002,โรงเรียน,2023,8760,55.2,24.1,112.3,2.4',
      'CCS-002,โรงเรียน,2024,8784,52.1,22.6,108.7,1.7',
      'CCS-002,โรงเรียน,2025,8760,53.8,23.4,110.5,1.9',
      'CCS-003,รพ.สต.,2023,8760,38.4,16.8,76.5,1.5',
      'CCS-003,รพ.สต.,2024,8784,35.1,14.9,71.2,1.0',
      'CCS-003,รพ.สต.,2025,8760,37.8,16.2,75.8,1.3',
      '',
    ].join('\n'),
  },
];

  let attached = 0;
  const used = new Set();

  for (const m of mocks) {
    let task = remaining.find(t => !used.has(t.id) && m.matchers.some(kw => t.title.includes(kw)));
    if (!task) task = remaining.find(t => !used.has(t.id));
    if (!task) { console.log(`  ⚠ no task left for "${m.filename}"`); continue; }
    used.add(task.id);

    const dir = db.uploadDir(task.group_id);
    const safe = m.filename.replace(/[^\w฀-๿.\-]+/g, '_');
    const onDisk = crypto.randomBytes(8).toString('hex') + '_' + safe;
    const fullPath = path.join(dir, onDisk);
    fs.writeFileSync(fullPath, m.content, 'utf-8');
    const stat = fs.statSync(fullPath);

    const uploadedBy = task.assignees[0]?.id || members[0]?.id;
    await db.recordFile({
      task_id: task.id, group_id: task.group_id, uploaded_by: uploadedBy,
      filename: onDisk, original_name: m.filename, mimetype: m.mime, size: stat.size,
    });
    attached++;
    console.log(`  ✓ ${m.filename}  (${stat.size} B)  →  "${task.title.slice(0,50)}"`);
  }

  console.log(`\nDone! Tasks remaining: ${remaining.length}, files attached: ${attached}.`);
  await db.close();
})().catch(err => { console.error(err); process.exit(1); });
