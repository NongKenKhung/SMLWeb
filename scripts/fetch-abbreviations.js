#!/usr/bin/env node
// Fetch Thai abbreviations from Thai Wiktionary and rewrite backend/data/abbreviations.json
// Source: https://th.wiktionary.org/wiki/ภาคผนวก:รายชื่ออักษรย่อในภาษาไทย
// Output schema: [[abbr, full], ...]  (same as existing abbreviations.json)
//
// Run:  node scripts/fetch-abbreviations.js
//
// Notes:
//   - Wikitext มี 2 รูปแบบ:
//       (1) Single-meaning:  "* ABBR - MEANING"  (รองรับ – / — / - เป็น separator)
//       (2) Multi-meaning:   "* ABBR"            (parent ไม่มี meaning)
//                            "** meaning 1"
//                            "** meaning 2"      ← แต่ละ sub-bullet pair กับ parent
//   - บางครั้ง sub-bullet เป็น "** X - Y" (sub-abbreviation ในใต้ parent) → จับ X-Y แทน
//   - Strip wiki links [[X]] / [[X|Y]] / templates {{...}} / refs / HTML tags

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TITLE = 'ภาคผนวก:รายชื่ออักษรย่อในภาษาไทย';
const URL = `https://th.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(TITLE)}&format=json&prop=wikitext`;
const OUT = path.join(__dirname, '..', 'backend', 'data', 'abbreviations.json');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SMLWeb-abbreviations-fetch/1.0' } }, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function cleanMeaning(s) {
  return String(s || '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<ref[^/]*\/>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'''/g, '').replace(/''/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  console.log('Fetching wikitext for:', TITLE);
  const json = JSON.parse(await get(URL));
  if (json.error) throw new Error(`API error: ${json.error.info || JSON.stringify(json.error)}`);
  const wikitext = json.parse && json.parse.wikitext && json.parse.wikitext['*'];
  if (!wikitext) throw new Error('No wikitext in response');
  console.log('Wikitext size:', wikitext.length, 'bytes');

  const lines = wikitext.split(/\r?\n/);
  const pairs = [];
  const seen = new Set();
  let lastParent = '';

  function tryPush(abbr, full) {
    abbr = String(abbr || '').trim();
    full = cleanMeaning(full);
    if (!abbr || !full) return;
    if (abbr.length > 40 || full.length > 250) return;
    const key = abbr + ' ' + full;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([abbr, full]);
  }

  // Helper: split "ABBR - MEANING" โดย split เฉพาะ hyphen ที่ "ไม่อยู่ใน parens"
  // (ป้องกัน parser โดน "(ราชการทหาร-ตำรวจ)" หลอกเป็น split point)
  // คืน [abbr, meaning] หรือ null ถ้าไม่มี dash อยู่นอก parens
  function splitOnDashOutsideParens(s) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && /[—–\-]/.test(ch)) {
        // ตรวจว่ามี whitespace อย่างน้อย 1 ตัวขนาบทั้ง 2 ฝั่ง (เพื่อกัน abbr ที่มี dash เช่น "ว.ด.ป.")
        const before = s.slice(0, i), after = s.slice(i + 1);
        if (/\s$/.test(before) && /^\s/.test(after)) {
          return [before.trim(), after.trim()];
        }
      }
    }
    return null;
  }

  for (const raw of lines) {
    const line = raw.replace(/^\s+|\s+$/g, '');
    // Sub-bullet "** meaning" — pair กับ lastParent (หรือ inner "X - Y" ถ้ามี)
    const sub = line.match(/^\*\*+\s*(.+)$/);
    if (sub) {
      if (!lastParent) continue;
      const inner = sub[1].trim();
      const innerSplit = splitOnDashOutsideParens(inner);
      if (innerSplit) tryPush(innerSplit[0], innerSplit[1]);
      else tryPush(lastParent, inner);
      continue;
    }
    // Top-level "* X - Y" (single meaning) — split ที่ dash นอก parens
    const singleStripped = line.replace(/^\*\s*/, '');
    const topSplit = line.startsWith('*') && !line.startsWith('**')
      ? splitOnDashOutsideParens(singleStripped) : null;
    if (topSplit) {
      tryPush(topSplit[0], topSplit[1]);
      lastParent = '';
      continue;
    }
    // Top-level "* X" alone — parent for upcoming sub-bullets
    const parent = line.match(/^\*\s*([^\s*][^\n]*)$/);
    if (parent) {
      const candidate = parent[1].trim();
      lastParent = (candidate.length <= 40 && !/^\s*(?:ของ|เป็น)/.test(candidate))
        ? candidate : '';
      continue;
    }
    // Blank / section header → clear parent
    if (line === '' || /^==+/.test(line)) lastParent = '';
  }

  console.log('Parsed entries:', pairs.length);

  // Sort by Thai locale on abbr
  pairs.sort((a, b) => a[0].localeCompare(b[0], 'th'));

  if (fs.existsSync(OUT)) {
    const bak = OUT + '.bak';
    fs.copyFileSync(OUT, bak);
    console.log('Backup:', bak);
  }

  fs.writeFileSync(OUT, JSON.stringify(pairs, null, 2), 'utf8');
  console.log('Wrote:', OUT, '(' + pairs.length + ' entries)');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
