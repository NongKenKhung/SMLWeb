#!/usr/bin/env node
// One-off cleanup ของ abbreviations.json:
//   A. ลบ entries ที่ parser โดน hyphen ใน parens หลอก แล้วเติม version ที่ถูกต้อง
//   B. แตก entries ที่มี comma / "หรือ" / slash (ที่ใช้แทน "หรือ") เป็นหลายแถว
//
// Run: node scripts/clean-abbreviations.js

const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'backend', 'data', 'abbreviations.json');

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const before = data.length;

// === A. Mis-parsed paren-with-hyphen — แทนที่ด้วย entry ที่ถูก ===
// Manual fixes ตามต้นฉบับ wikitext
const replacements = [
  // [oldAbbr, oldFull] → ลบ
  // และเพิ่ม [newAbbr, newFull]
  {
    remove: ['เครื่องบิน (ราชการทหาร', 'ตำรวจ)'],
    add: ['บ.', 'เครื่องบิน (ราชการทหาร-ตำรวจ)'],
  },
  {
    remove: ['สมาคมส่งเสริมเทคโนโลยี (ไทย', 'ญี่ปุ่น)'],
    add: ['ส.ส.ท.', 'สมาคมส่งเสริมเทคโนโลยี (ไทย-ญี่ปุ่น)'],
  },
];

let cleaned = data.filter(([k, v]) =>
  !replacements.some(r => r.remove[0] === k && r.remove[1] === v)
);
for (const r of replacements) cleaned.push(r.add);

// === B. แตก abbr ที่มี comma / "หรือ" — เก็บ meaning เดิม ===
const expanded = [];
const seen = new Set();
function push(abbr, full) {
  abbr = String(abbr).trim();
  full = String(full).trim();
  if (!abbr || !full) return;
  const key = abbr + ' || ' + full;
  if (seen.has(key)) return;
  seen.add(key);
  expanded.push([abbr, full]);
}
let splitCount = 0;
for (const [k, v] of cleaned) {
  // Split on " หรือ " or "," — but ONLY if abbr has these separators
  const parts = k.split(/\s*(?:,|\s+หรือ\s+)\s*/).filter(Boolean);
  if (parts.length > 1) {
    splitCount += parts.length - 1;
    for (const p of parts) push(p, v);
  } else {
    push(k, v);
  }
}

// Sort by Thai locale
expanded.sort((a, b) => a[0].localeCompare(b[0], 'th'));

// Backup + write
const bak = FILE + '.cleanup-bak';
fs.copyFileSync(FILE, bak);
fs.writeFileSync(FILE, JSON.stringify(expanded, null, 2), 'utf8');

console.log('=== Cleanup summary ===');
console.log('Before:', before, 'entries');
console.log('After :', expanded.length, 'entries (' + (expanded.length - before) + ')');
console.log('Replaced (paren-hyphen mis-parse):', replacements.length);
console.log('Expanded (comma/"หรือ" → multiple):', splitCount, 'new entries');
console.log('Backup at:', bak);
