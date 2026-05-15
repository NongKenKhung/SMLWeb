// SMTP + iMIP (RFC 6047) calendar invitation mailer.
//
// Sends a real "meeting invitation" email — recipients' calendar apps (iCloud,
// Google, Outlook) auto-recognize the .ics attachment with METHOD:REQUEST or
// CANCEL and surface RSVP / add-to-calendar UI inline.
//
// Configure via .env:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=587
//   SMTP_USER=lab.smartcity@gmail.com
//   SMTP_PASS=<16-char app password>
//   SMTP_FROM="Smart City Lab <lab.smartcity@gmail.com>"
//
// If SMTP_HOST is unset the module turns into a no-op and logs a warning —
// meeting create/update flows still succeed but no emails go out.

const nodemailer = require('nodemailer');

// Sanitize env values: trim outer whitespace (env file pasting often leaves stray spaces)
const env = (k, dflt = '') => String(process.env[k] ?? dflt).trim();

const SMTP_HOST = env('SMTP_HOST');
const SMTP_PORT = +(env('SMTP_PORT', 587) || 587);
const SMTP_USER = env('SMTP_USER');
const SMTP_PASS = env('SMTP_PASS');
// SMTP_FROM may include a display name; normalize "Name < addr  >" → "Name <addr>" so
// SMTP servers don't reject the address for stray whitespace inside angle brackets.
function normalizeFromHeader(s) {
  if (!s) return '';
  const m = String(s).match(/^(.*)<\s*([^>\s]+)\s*>\s*$/);
  if (m) return `${m[1].trim()} <${m[2].trim()}>`.trim();
  return String(s).trim();
}
const SMTP_FROM = normalizeFromHeader(env('SMTP_FROM') || SMTP_USER || 'no-reply@example.com');
const SMTP_SECURE = (env('SMTP_SECURE') || (SMTP_PORT === 465 ? 'true' : 'false')) === 'true';

// Extract bare email from a "Display Name <email@host>" string for the ORGANIZER
// mailto: URI in the ICS. Falls back to SMTP_FROM itself if it's already bare.
function bareEmail(s) {
  const m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}
const ORGANIZER_EMAIL = bareEmail(SMTP_FROM) || 'no-reply@example.com';
const ORGANIZER_HOST  = ORGANIZER_EMAIL.split('@')[1] || 'localhost';

let transport = null;
function getTransport() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,                  // true for :465, false for STARTTLS on :587
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transport;
}

// Admin-controlled kill switch. Default ON; server.js loads the persisted value
// from app_settings on boot and pushes any future change here. When false, all
// sendInvite/sendCancel calls become no-ops with reason="disabled".
let adminEnabled = true;
function setAdminEnabled(v) { adminEnabled = !!v; }
function getAdminEnabled() { return adminEnabled; }

// SMTP credentials are present (regardless of admin toggle)
function smtpConfigured() { return !!(SMTP_HOST && SMTP_USER && SMTP_PASS); }

// True only when both SMTP is configured AND admin hasn't disabled sending.
function isEnabled() { return adminEnabled && smtpConfigured(); }

// Verify SMTP connectivity (used at boot for diagnostics — not required to start)
async function verify() {
  const t = getTransport();
  if (!t) return { ok: false, reason: 'SMTP_HOST/USER/PASS not configured' };
  try {
    await t.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ===== ICS (iCalendar) generation =====

// Escape per RFC 5545 §3.3.11
function escIcs(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold long content lines: max 75 octets per line, continuation starts with single space.
function foldLine(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  for (let i = 75; i < line.length; i += 74) out += '\r\n ' + line.slice(i, i + 74);
  return out;
}

// Convert a deadline string ("2026-05-05T14:00") to a TZID-formatted local
// datetime ("20260505T140000") in Asia/Bangkok. Stored times in SML are
// interpreted as Bangkok (UTC+7).  Apple Calendar parses TZID + VTIMEZONE
// significantly more reliably than UTC Z form (it can render local time
// directly without converting from UTC).  Returns:
//   { value: "YYYYMMDDTHHMMSS", tzid: "Asia/Bangkok", dateOnly: false }
// or for a date-only input:
//   { value: "YYYYMMDD",       dateOnly: true }
function toIcsDateTime(s, addMinutes = 0) {
  if (!s) return null;
  const hasTime = String(s).includes('T');
  if (!hasTime) {
    const d = new Date(s + 'T00:00:00+07:00');
    if (addMinutes) d.setMinutes(d.getMinutes() + addMinutes);
    // Convert to Bangkok local for the date stamp
    const opts = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' };
    const parts = new Intl.DateTimeFormat('en-CA', opts).format(d);
    return { value: parts.replace(/-/g, ''), dateOnly: true };
  }
  const d = new Date(s + ':00+07:00');
  if (addMinutes) d.setMinutes(d.getMinutes() + addMinutes);
  // Re-extract Bangkok local components — guarantees the value matches user-typed time
  const opts = { timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(d);
  const get = (k) => parts.find(p => p.type === k).value;
  const yyyy = get('year'), mm = get('month'), dd = get('day');
  let hh = get('hour'), mi = get('minute'), ss = get('second');
  if (hh === '24') hh = '00';
  return { value: `${yyyy}${mm}${dd}T${hh}${mi}${ss}`, tzid: 'Asia/Bangkok', dateOnly: false };
}

function nowUtcStamp() {
  const iso = new Date().toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

const LOCATION_LABELS = {
  online: 'Online',
  onsite_internal: 'In-house',
  onsite_external: 'On-site',
};

function locationString(meeting) {
  const t = LOCATION_LABELS[meeting.location_type] || '';
  const d = meeting.location_detail || '';
  return [t, d].filter(Boolean).join(' — ');
}

// Asia/Bangkok VTIMEZONE block — included in every ICS so Apple/iCloud Calendar
// can render the local time correctly without inferring offset. Single STANDARD
// observance (no DST in Thailand since 1920).
const VTIMEZONE_BANGKOK = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Bangkok',
  'X-LIC-LOCATION:Asia/Bangkok',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0700',
  'TZOFFSETTO:+0700',
  'TZNAME:+07',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function buildIcs({ method, meeting, organizerName, sequence, recipients }) {
  const uid = `sml-meeting-${meeting.id}@${ORGANIZER_HOST}`;
  const status = method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED';
  const start = toIcsDateTime(meeting.deadline);
  const end   = toIcsDateTime(meeting.deadline, 60);  // default 1-hour meeting

  // TZID-formatted dates (Apple parses these more reliably than UTC Z form)
  const fmtDt = (d, prop) => {
    if (!d) return null;
    if (d.dateOnly) return `${prop};VALUE=DATE:${d.value}`;
    return `${prop};TZID=${d.tzid}:${d.value}`;
  };
  const dtStart = fmtDt(start, 'DTSTART');
  const dtEnd   = fmtDt(end,   'DTEND');
  const includeTz = !!(start && !start.dateOnly);

  // ATTENDEE line builder — matches iCloud's parameter set: CUTYPE + EMAIL=
  // alongside mailto: makes Apple/iCloud match recipients more reliably.
  const attendeeLine = (a, role = 'REQ-PARTICIPANT', partstat = 'NEEDS-ACTION', rsvp = true) =>
    `ATTENDEE;CN=${escIcs(a.name)};CUTYPE=INDIVIDUAL;ROLE=${role};PARTSTAT=${partstat}${rsvp ? ';RSVP=TRUE' : ''};EMAIL=${a.email}:mailto:${a.email}`;

  // RFC 5545 says the organizer is implicitly the meeting "chair". Apple Calendar
  // expects to see the organizer ALSO listed as ATTENDEE with ROLE=CHAIR + PARTSTAT=ACCEPTED.
  const organizerAsAttendee = attendeeLine(
    { name: organizerName, email: ORGANIZER_EMAIL },
    'CHAIR', 'ACCEPTED', false
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Smart City Lab//SML Web//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    ...(includeTz ? VTIMEZONE_BANGKOK : []),
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUtcStamp()}`,
    `CREATED:${nowUtcStamp()}`,
    dtStart, dtEnd,
    `SEQUENCE:${sequence}`,
    `STATUS:${status}`,
    `SUMMARY:${escIcs(meeting.title)}`,
    meeting.description ? `DESCRIPTION:${escIcs(meeting.description)}` : null,
    `LOCATION:${escIcs(locationString(meeting))}`,
    `ORGANIZER;CN=${escIcs(organizerName)};EMAIL=${ORGANIZER_EMAIL}:mailto:${ORGANIZER_EMAIL}`,
    organizerAsAttendee,
    ...recipients
      // Don't list the organizer twice if they're also an assignee
      .filter(a => a.email && a.email.toLowerCase() !== ORGANIZER_EMAIL.toLowerCase())
      .map(a => attendeeLine(a)),
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ===== Email body =====

function fmtThaiDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(String(s).includes('T') ? s + ':00+07:00' : s + 'T00:00:00+07:00');
    return d.toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return s; }
}

function buildSubject({ method, meeting }) {
  const tag = method === 'CANCEL' ? '[ยกเลิก]' : '[เชิญประชุม]';
  return `${tag} ${meeting.title} — ${fmtThaiDate(meeting.deadline)}`;
}

function buildHtmlBody({ method, meeting, organizerName }) {
  const isCancel = method === 'CANCEL';
  const accentColor = isCancel ? '#b91c1c' : '#4f46e5';
  const banner = isCancel
    ? '<strong style="color:#b91c1c">การประชุมนี้ถูกยกเลิก</strong>'
    : '<strong style="color:#15803d">เชิญเข้าร่วมประชุม</strong>';
  return `
  <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;max-width:560px;margin:auto">
    <div style="border-left:4px solid ${accentColor};padding:0.5rem 1rem;background:#f8fafc;border-radius:6px">
      <div style="font-size:13px;color:#64748b;letter-spacing:.04em;text-transform:uppercase">SMART CITY LAB</div>
      <div style="font-size:13px;margin-top:4px">${banner}</div>
    </div>
    <h2 style="margin:1rem 0 .25rem;font-size:1.25rem;line-height:1.3">${escapeHtml(meeting.title)}</h2>
    <table style="font-size:14px;line-height:1.6;border-collapse:collapse;margin-top:.5rem">
      <tr><td style="color:#64748b;padding-right:1rem">📅 วัน-เวลา</td><td><b>${escapeHtml(fmtThaiDate(meeting.deadline))}</b></td></tr>
      <tr><td style="color:#64748b;padding-right:1rem">📍 สถานที่</td><td>${escapeHtml(locationString(meeting) || '—')}</td></tr>
      <tr><td style="color:#64748b;padding-right:1rem">👤 ผู้จัด</td><td>${escapeHtml(organizerName)}</td></tr>
    </table>
    ${meeting.description ? `<div style="margin-top:1rem;padding:.75rem 1rem;background:#f1f5f9;border-radius:6px;white-space:pre-wrap;font-size:13px">${escapeHtml(meeting.description)}</div>` : ''}
    <hr style="margin:1.25rem 0;border:none;border-top:1px solid #e2e8f0">
    <div style="font-size:12px;color:#64748b">
      ${isCancel
        ? 'อีเมลฉบับนี้แจ้งการยกเลิกประชุม — ระบบปฏิทินของคุณจะลบ event นี้ออกอัตโนมัติ'
        : 'หากแอปปฏิทินของคุณไม่ขึ้น "Add to Calendar" ให้ดับเบิลคลิก attachment <code>invite.ics</code> ที่แนบมา'}
      <br>ส่งจาก Smart City Lab Web ที่ ${escapeHtml(ORGANIZER_EMAIL)}
    </div>
  </div>`;
}

function buildTextBody({ method, meeting, organizerName }) {
  const isCancel = method === 'CANCEL';
  return [
    isCancel ? '⚠️  การประชุมนี้ถูกยกเลิก' : '📅  เชิญเข้าร่วมประชุม',
    '',
    `เรื่อง:   ${meeting.title}`,
    `วันเวลา: ${fmtThaiDate(meeting.deadline)}`,
    `สถานที่: ${locationString(meeting) || '—'}`,
    `ผู้จัด:    ${organizerName}`,
    meeting.description ? '\n' + meeting.description : '',
    '',
    isCancel
      ? 'ระบบปฏิทินของคุณจะลบ event นี้ออกอัตโนมัติ'
      : 'หากปฏิทินไม่ auto-import ให้เปิดไฟล์ invite.ics ที่แนบมา',
    '',
    `— Smart City Lab (${ORGANIZER_EMAIL})`,
  ].filter(x => x !== null).join('\n');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===== Send =====

// Filter assignees → only those with a non-empty email. Logs others.
function pickRecipients(meeting, override) {
  const list = override || meeting.assignees || [];
  const haveEmail = list.filter(a => a.email && a.email.trim());
  const skipped = list.length - haveEmail.length;
  if (skipped > 0) {
    console.warn(`[mailer] skipping ${skipped} attendee(s) without email on meeting "${meeting.title}"`);
  }
  return haveEmail;
}

// Internal: send one ICS to a list of recipients
async function sendCalendarMail({ method, meeting, organizer, sequence, recipientsOverride }) {
  // Honor the admin's "ส่งอีเมลเชิญประชุม" toggle. The flag lives in-memory and
  // is kept in sync via setAdminEnabled() — called at boot from DB and by
  // PUT /api/settings whenever the admin flips the switch in the UI.
  if (!adminEnabled) {
    console.log(`[mailer] disabled by admin — skipping ${method} for meeting ${meeting.id}`);
    return { ok: true, sent: 0, reason: 'disabled_by_setting' };
  }

  const t = getTransport();
  if (!t) {
    console.warn('[mailer] SMTP not configured — would have sent', method, 'for meeting', meeting.id);
    return { ok: false, reason: 'no_smtp', sent: 0 };
  }
  const recipients = pickRecipients(meeting, recipientsOverride);
  if (recipients.length === 0) {
    return { ok: true, sent: 0, reason: 'no_recipients_with_email' };
  }
  const organizerName = organizer?.name || 'Smart City Lab';

  // ICS embeds ALL recipients in ATTENDEE list — same content for everyone.
  // Email is sent individually so spam filters don't see a shared To: blast.
  const icsContent = buildIcs({ method, meeting, organizerName, sequence, recipients });
  const subject = buildSubject({ method, meeting });
  const html = buildHtmlBody({ method, meeting, organizerName });
  const text = buildTextBody({ method, meeting, organizerName });

  const results = await Promise.allSettled(recipients.map(r =>
    t.sendMail({
      from: SMTP_FROM,
      to: `"${r.name}" <${r.email}>`,
      subject,
      text,
      html,
      icalEvent: { method, content: icsContent, filename: 'invite.ics' },
    })
  ));
  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  if (failed > 0) {
    const errs = results.filter(r => r.status === 'rejected').map(r => r.reason?.message);
    console.warn(`[mailer] ${failed}/${results.length} sends failed for meeting ${meeting.id}:`, errs);
  }
  console.log(`[mailer] ${method} meeting=${meeting.id} seq=${sequence} sent=${sent}/${results.length}`);
  return { ok: failed === 0, sent, failed };
}

async function sendInvite(meeting, organizer, sequence, recipientsOverride) {
  return sendCalendarMail({ method: 'REQUEST', meeting, organizer, sequence, recipientsOverride });
}
async function sendCancel(meeting, organizer, sequence, recipientsOverride) {
  return sendCalendarMail({ method: 'CANCEL', meeting, organizer, sequence, recipientsOverride });
}

// Decides whether two meeting snapshots differ in a way that warrants re-inviting.
function meaningfulChange(before, after) {
  if (!before || !after) return false;
  if (before.title          !== after.title)          return true;
  if (before.description    !== after.description)    return true;
  if (before.deadline       !== after.deadline)       return true;
  if (before.location_type  !== after.location_type)  return true;
  if (before.location_detail!== after.location_detail)return true;
  // Status flip → cancellation handled by caller, but treat resurrection (cancelled→on_hold)
  // as a fresh invite too
  if (before.status !== after.status) return true;
  return false;
}

// Diff attendee lists by member id — for split REQUEST (current) + CANCEL (removed)
function attendeeDiff(before, after) {
  const beforeIds = new Set((before?.assignees || []).map(a => a.id));
  const afterIds  = new Set((after?.assignees  || []).map(a => a.id));
  const added   = (after?.assignees  || []).filter(a => !beforeIds.has(a.id));
  const removed = (before?.assignees || []).filter(a => !afterIds.has(a.id));
  return { added, removed };
}

module.exports = {
  isEnabled, smtpConfigured, getAdminEnabled, setAdminEnabled, verify,
  sendInvite, sendCancel,
  meaningfulChange, attendeeDiff,
};
