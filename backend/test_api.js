const BASE = 'http://localhost:3000';
async function call(method, p, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('application/json') ? await res.json() : await res.text() };
}
let pass = 0, fail = 0;
function ok(label, cond, extra = '') { if (cond) { pass++; console.log(`✓ ${label}${extra ? '  →  ' + extra : ''}`); } else { fail++; console.log(`✗ ${label}${extra ? '  →  ' + extra : ''}`); } }

(async () => {
  console.log('=== Logins ===');
  const aTok = (await call('POST', '/api/login', { body: { name: 'ดร. สมชาย ใจดี', password: '1234' } })).data.token;
  const pakinL = (await call('POST', '/api/login', { body: { name: 'ภาคิน ก้องเกียรติ', password: '1234' } })).data;
  const pTok = pakinL.token; const pakin = pakinL.user;
  const preedaL = (await call('POST', '/api/login', { body: { name: 'ปรีดา ทองคำ', password: '1234' } })).data;
  const prTok = preedaL.token; const preeda = preedaL.user;
  ok('admins + members logged in', aTok && pTok && prTok);

  console.log('\n=== /api/groups returns am_member per current user ===');
  const groupsAdmin = (await call('GET', '/api/groups', { token: aTok })).data;
  ok('admin response has am_member field', groupsAdmin.every(g => 'am_member' in g));

  const groupsPakin = (await call('GET', '/api/groups', { token: pTok })).data;
  // ภาคินเป็นหัวหน้ากลุ่ม IoT + Lab Infra (ตาม seed)
  const iot = groupsPakin.find(g => g.name.includes('IoT'));
  const lab = groupsPakin.find(g => g.name.includes('Lab Infra'));
  ok('ภาคิน leader_id of IoT', iot.leader_id === pakin.id);
  ok('ภาคิน am_member of IoT', iot.am_member === true);
  ok('ภาคิน leader_id of Lab Infra', lab.leader_id === pakin.id);

  // ปรีดา is in IoT (seeded as M['ทองคำ']) but not the leader
  const groupsPreeda = (await call('GET', '/api/groups', { token: prTok })).data;
  const iotForPreeda = groupsPreeda.find(g => g.name.includes('IoT'));
  ok('ปรีดา is NOT leader of IoT', iotForPreeda.leader_id !== preeda.id);
  ok('ปรีดา IS member of IoT (am_member)', iotForPreeda.am_member === true);

  // Smart Traffic — ปรีดาไม่อยู่ในกลุ่ม
  const traffic = groupsPreeda.find(g => g.name.includes('Smart Traffic'));
  ok('ปรีดา is NOT member of Smart Traffic', traffic.am_member === false);

  console.log('\n=== Partition: leader / member / other groups ===');
  const me = preeda.id;
  const leaderGroups = groupsPreeda.filter(g => g.leader_id === me);
  const memberGroups = groupsPreeda.filter(g => g.leader_id !== me && g.am_member);
  const otherGroups  = groupsPreeda.filter(g => g.leader_id !== me && !g.am_member);
  ok('partition is exhaustive (no overlap)',
     leaderGroups.length + memberGroups.length + otherGroups.length === groupsPreeda.length);
  console.log(`  ปรีดา's groups: leader=${leaderGroups.length}, member=${memberGroups.length}, other=${otherGroups.length}`);

  // Open Group — ปรีดายังไม่ได้หยิบ → other
  const openGroup = groupsPreeda.find(g => !g.leader_id);
  ok('Open leaderless group is in "other" set', otherGroups.includes(openGroup));

  console.log('\n=== After ปรีดา claims Open Group, partition shifts ===');
  await call('POST', '/api/groups/' + openGroup.id + '/claim', { token: prTok });
  const groupsPreeda2 = (await call('GET', '/api/groups', { token: prTok })).data;
  const openAfter = groupsPreeda2.find(g => g.id === openGroup.id);
  ok('Open Group now leader_id = preeda', openAfter.leader_id === preeda.id);
  ok('Open Group am_member = true', openAfter.am_member === true);
  const leaderGroups2 = groupsPreeda2.filter(g => g.leader_id === me);
  ok('Open Group moved to leader section', leaderGroups2.includes(openAfter));

  // Reset
  console.log('\n=== Cleanup: undo claim ===');
  // No "unclaim" — admin sets leader_id back to null via update
  await call('PUT', '/api/groups/' + openGroup.id, { token: aTok, body: { leader_id: null } });
  await call('DELETE', '/api/groups/' + openGroup.id + '/members/' + preeda.id, { token: aTok });

  console.log('\n' + (fail === 0 ? `✓ ALL PASSED (${pass}/${pass+fail})` : `✗ ${fail} FAILED, ${pass} passed`));
  process.exitCode = fail === 0 ? 0 : 1;
})().catch(e => { console.error(e); process.exit(1); });
