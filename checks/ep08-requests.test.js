// 8편 확인: 승인 요청 — 두 사람만 보고, 한 번만 처리되고, 동시에 와도 하나만 반영된다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLab } from './helper.js';
import { transferUser, offboardUser } from '../src/org.js';

let lab, id;
before(async () => {
  lab = await startLab();
  const uid = async (u) => Number((await lab.sql(`SELECT id FROM users WHERE username = $1`, [u]))[0].id);
  id = { kim: await uid('kim'), lee: await uid('lee'), park: await uid('park'), jung: await uid('jung'), choi: await uid('choi'),
    dev: (await lab.sql(`SELECT id FROM departments WHERE name = '개발팀'`))[0].id };
});
after(async () => { await lab.stop(); });

const submit = async (who, approverId, title = '모니터 구매 요청', body = '27인치 모니터 한 대') => {
  await who.get('/requests/new');
  return who.post('/requests', { title, body, approver_id: String(approverId) });
};
const row = async (path) => (await lab.sql(
  `SELECT status, decision_note, decided_at, requester_department_name, requester_title FROM requests WHERE id = $1`, [path.split('/').pop()]))[0];
const count = async () => Number((await lab.sql('SELECT count(*) AS n FROM requests'))[0].n);
const act = async (who, path, action, fields = {}) => { await who.get(path); return who.post(`${path}/${action}`, fields); };
const strip = (t) => t.replace(/name="_csrf" value="[^"]*"/g, '');

test('정상: 요청을 올리면 승인자의 처리할 목록에 뜨고, 승인하면 끝난다', async () => {
  const kim = await lab.as('kim');
  const made = await submit(kim, id.choi);
  assert.equal(made.status, 302);
  assert.match(made.location, /^\/requests\/\d+$/);
  assert.match((await kim.get('/')).text, /href="\/requests"/);

  const choi = await lab.as('choi');
  assert.match((await choi.get('/requests')).text, /모니터 구매 요청/);
  const detail = await choi.get(made.location);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /김하늘/);
  assert.match(detail.text, /영업팀/);

  const res = await choi.post(`${made.location}/approve`, { note: '진행하세요' });
  assert.equal(res.status, 302);
  assert.equal(res.location, made.location);
  const r = await row(made.location);
  assert.equal(r.status, 'approved');
  assert.equal(r.decision_note, '진행하세요');
  assert.ok(r.decided_at);
  assert.match((await kim.get(made.location)).text, /진행하세요/);
});

test('정상: 반려에는 의견이 있어야 한다', async () => {
  const kim = await lab.as('kim');
  const made = await submit(kim, id.choi, '출장 신청');
  const choi = await lab.as('choi');
  assert.equal((await act(choi, made.location, 'reject', { note: '  ' })).status, 400);
  assert.equal((await row(made.location)).status, 'pending');
  assert.equal((await act(choi, made.location, 'reject', { note: '일정을 다시 잡아 주세요' })).status, 302);
  assert.equal((await row(made.location)).status, 'rejected');
});

test('거부: 두 사람이 아니면 같은 부서도, 시스템 관리자도 요청을 볼 수 없다', async () => {
  const kim = await lab.as('kim');
  const made = await submit(kim, id.park, '서버 접근 권한 요청', '개발 서버 접근이 필요합니다');
  for (const who of ['lee', 'jung', 'choi']) {
    const c = await lab.as(who);
    const res = await c.get(made.location);
    assert.equal(res.status, 404, who);
    assert.doesNotMatch(res.text, /서버 접근 권한 요청|개발 서버 접근이 필요합니다/, who);
    assert.equal(strip(res.text), strip((await c.get('/requests/99999999')).text), who);
    assert.doesNotMatch((await c.get('/requests')).text, /서버 접근 권한 요청/, who);
    for (const a of ['approve', 'reject', 'cancel']) {
      assert.equal((await c.post(`${made.location}/${a}`, { note: 'x' })).status, 404, `${who} ${a}`);
    }
  }
  assert.equal((await row(made.location)).status, 'pending');
  assert.equal((await lab.as('park').then((p) => p.get(made.location))).status, 200);
});

test('거부: 올린 사람은 자기 요청을 승인할 수 없고, 승인자는 남의 요청을 취소할 수 없다', async () => {
  const kim = await lab.as('kim');
  const made = await submit(kim, id.park, '교육 신청');
  assert.equal((await act(kim, made.location, 'approve', { note: '' })).status, 403);
  const park = await lab.as('park');
  assert.equal((await act(park, made.location, 'cancel')).status, 403);
  assert.equal((await row(made.location)).status, 'pending');
  assert.equal((await act(kim, made.location, 'cancel')).status, 302);
  assert.equal((await row(made.location)).status, 'cancelled');
});

test('핵심: 끝난 요청은 다시 바뀌지 않는다', async () => {
  const kim = await lab.as('kim');
  const made = await submit(kim, id.park, '노트북 교체');
  const park = await lab.as('park');
  assert.equal((await act(park, made.location, 'approve', { note: '승인' })).status, 302);
  const first = await row(made.location);
  assert.equal((await park.post(`${made.location}/reject`, { note: '다시 생각해 보니 반려' })).status, 409);
  assert.equal((await park.post(`${made.location}/approve`, { note: '또 승인' })).status, 409);
  assert.equal((await kim.post(`${made.location}/cancel`)).status, 409);
  assert.deepEqual(await row(made.location), first);
});

test('핵심: 승인과 반려가 동시에 와도 하나만 반영된다', async () => {
  const kim = await lab.as('kim');
  const made = await submit(kim, id.park, '동시 처리 확인');
  const a = await lab.as('park');
  const b = await lab.as('park');
  await a.get(made.location);
  await b.get(made.location);
  const results = await Promise.all([
    a.post(`${made.location}/approve`, { note: '승인' }),
    b.post(`${made.location}/reject`, { note: '반려' }),
    a.post(`${made.location}/approve`, { note: '승인 두 번째' }),
  ]);
  const codes = results.map((r) => r.status).sort();
  assert.deepEqual(codes, [302, 409, 409]);
  const r = await row(made.location);
  assert.ok(['approved', 'rejected'].includes(r.status));
  const ev = await lab.sql(
    `SELECT count(*) AS n FROM audit_events WHERE resource_type = 'request' AND resource_id = $1 AND action IN ('request.approve','request.reject') AND result = 'ok'`,
    [made.location.split('/').pop()]);
  assert.equal(Number(ev[0].n), 1);
});

test('경계: 승인자가 자기 자신, 없는 사람, 퇴사한 사람이면 올릴 수 없다', async () => {
  const kim = await lab.as('kim');
  const n = await count();
  assert.equal((await submit(kim, id.kim)).status, 400);
  assert.equal((await submit(kim, 999999)).status, 400);
  assert.equal((await submit(kim, id.choi, '   ')).status, 400);
  await offboardUser(lab.pool, { userId: id.jung });
  assert.equal((await submit(kim, id.jung)).status, 400);
  assert.equal(await count(), n);
  await assert.rejects(lab.sql(
    `INSERT INTO requests(requester_id, approver_id, title, body, requester_department_name, requester_title) VALUES ($1, $1, 'x', 'y', '영업팀', '대리')`, [id.kim]));
});

test('경계: 올린 뒤에는 고치는 길이 없고, 올린 당시 소속이 남는다', async () => {
  const lee = await lab.as('lee');
  const made = await submit(lee, id.choi, '자리 이동 요청');
  for (const p of [`${made.location}/edit`, `${made.location}/update`]) {
    assert.equal((await lee.post(p, { title: '바꾼 제목', body: '바꾼 본문' })).status, 404, p);
  }
  await transferUser(lab.pool, { userId: id.lee, departmentId: id.dev, title: '대리' });
  const r = await row(made.location);
  assert.equal(r.requester_department_name, '영업팀');
  assert.equal(r.requester_title, '사원');
  const main = (await lab.as('choi').then((c) => c.get(made.location))).text.split('<main>')[1];
  assert.match(main, /영업팀/);
  assert.doesNotMatch(main, /개발팀/);
});

test('경계: 승인자가 퇴사하면 올린 사람이 취소할 수 있다', async () => {
  const kim = await lab.as('kim');
  const made = await submit(kim, id.park, '승인자 퇴사 확인');
  await offboardUser(lab.pool, { userId: id.park });
  const page = await kim.get(made.location);
  assert.equal(page.status, 200);
  assert.match(page.text.split('<main>')[1], /퇴사/);
  assert.equal((await kim.post(`${made.location}/cancel`)).status, 302);
  assert.equal((await row(made.location)).status, 'cancelled');
});

test('기록: 처리와 거부된 시도가 남고, 제목·본문·의견은 남지 않는다', async () => {
  const kim = await lab.as('kim');
  const made = await submit(kim, id.choi, '기록 확인용 비밀 제목', '기록 확인용 비밀 본문');
  const rid = made.location.split('/').pop();
  await lab.as('lee').then((c) => c.get(made.location));
  const choi = await lab.as('choi');
  await act(choi, made.location, 'reject', { note: '기록 확인용 비밀 의견' });
  await choi.post(`${made.location}/approve`, { note: 'x' });   // 409 — 기록하지 않는다
  const ev = await lab.sql(`SELECT action, result, actor_id FROM audit_events WHERE resource_type = 'request' AND resource_id = $1 ORDER BY id`, [rid]);
  const has = (action, result, actor) => ev.some((e) => e.action === action && e.result === result && Number(e.actor_id) === actor);
  assert.ok(has('request.create', 'ok', id.kim));
  assert.ok(has('request.read', 'denied', id.lee));
  assert.ok(has('request.reject', 'ok', id.choi));
  assert.ok(!ev.some((e) => e.action === 'request.approve'));
  const dump = JSON.stringify(await lab.sql(`SELECT * FROM audit_events WHERE resource_type = 'request'`));
  for (const s of ['기록 확인용 비밀 제목', '기록 확인용 비밀 본문', '기록 확인용 비밀 의견']) assert.ok(!dump.includes(s), s);
});
