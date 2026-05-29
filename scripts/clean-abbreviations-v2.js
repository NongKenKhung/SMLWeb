#!/usr/bin/env node
// Cleanup ครั้งที่ 2 — เอา entries ที่ไม่ relevant กับ context การจัดการ task/lab ออก:
//   - Slang (ภาษาปาก) เป็น qualifier เต็ม — เช่น "กางเกงใน (ภาษาปาก)"
//   - Dictionary metadata (พจนานุกรม) — เช่น "คำนาม (พจนานุกรม)", "ภาษาอังกฤษ (พจนานุกรม)"
//   - Bible (พระคริสตธรรมใหม่) — ชื่อย่อหนังสือไบเบิ้ล
//
// เก็บไว้ (user ขอเก็บ):
//   - รถไฟ (โบกี้รถไฟ) — railway specific
//   - "ภาษาปากว่า X" — main meaning ที่ legit + note อธิบาย slang variant

const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'backend', 'data', 'abbreviations.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const before = data.length;

const removed = { slang: [], dict: [], bible: [] };

const cleaned = data.filter(([k, v]) => {
  // (ภาษาปาก) เป็น qualifier เต็ม — strict end-with ป้องกัน "ภาษาปากว่า" หลุด
  if (/\(ภาษาปาก\)\s*$/.test(v)) { removed.slang.push([k, v]); return false; }
  // (พจนานุกรม) เป็น qualifier
  if (/\(พจนานุกรม\)\s*$/.test(v)) { removed.dict.push([k, v]); return false; }
  // Bible — พระคริสตธรรมใหม่ / พระคริสตธรรมเก่า / พระคัมภีร์
  if (/\(พระคริสตธรรม(?:ใหม่|เก่า)?\)|พระคัมภีร์/.test(v)) { removed.bible.push([k, v]); return false; }
  return true;
});

// Sort คงเดิม (already sorted) — แต่ re-sort safety
cleaned.sort((a, b) => a[0].localeCompare(b[0], 'th'));

const bak = FILE + '.v2-bak';
fs.copyFileSync(FILE, bak);
fs.writeFileSync(FILE, JSON.stringify(cleaned, null, 2), 'utf8');

console.log('=== Cleanup v2 summary ===');
console.log('Before:', before);
console.log('After :', cleaned.length, '(' + (cleaned.length - before) + ')');
console.log();
console.log('--- Slang (ภาษาปาก) removed:', removed.slang.length);
removed.slang.forEach(([k, v]) => console.log('  [' + k + '] -> ' + v));
console.log();
console.log('--- Dictionary (พจนานุกรม) removed:', removed.dict.length);
removed.dict.forEach(([k, v]) => console.log('  [' + k + '] -> ' + v));
console.log();
console.log('--- Bible removed:', removed.bible.length);
removed.bible.forEach(([k, v]) => console.log('  [' + k + '] -> ' + v));
console.log();
console.log('Backup at:', bak);
