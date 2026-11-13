// 6편 확인: 허용된 일과 거부된 시도가 기록되고, 내용은 기록되지 않으며, 기록은 고칠 수 없다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLab } from './helper.js';

let lab, salesBoard, id, postPath, postId, attId;
const TITLE = '비공개 단가 협의 메모';
const BODY = '거래처별 할인율 초안입니다';
const FILE = '할인율_초안.csv';

before(async () => {
  lab = await startLab();
  salesBoard = (await lab.sql(
    `SELECT b.id FROM boards b JOIN departments d ON d.id = b.department_id WHERE d.name = '영업팀'`))[0].id;
  const uid = async (u) => (await lab.sql(`SELECT id FROM users WHERE username = $1`, [u]))[0].id;
  id = { kim: await uid('kim'), lee: await uid('lee'), park: await uid('park'), choi: await uid('choi'), han: await uid('han'),
    dev: (await lab.sql(`SELECT id FROM departments WHERE name = '개발팀'`))[0].id };
  const kim = await lab.as('kim');
  await kim.get(`/boards/${salesBoard}/new`);
  postPath = (await kim.post(`/boards/${salesBoard}/posts`, { title: TITLE, body: BODY })).location;
  postId = Number(postPath.split('/').pop());
  await kim.get(postPath);
  await kim.postFile(`${postPath}/attachments`, { name: FILE, content: 'a,b\n1,2\n', type: 'text/csv' });
  attId = Number((await lab.sql('SELECT id FROM attachments WHERE post_id = $1', [postId]))[0].id);
});
after(async () => { await lab.stop(); });

const events = (where = 'true', params = []) => lab.sql(
  `SELECT actor_id, action, resource_type, resource_id, result, request_id, detail FROM audit_events WHERE ${where} ORDER BY id`, params);
const last = async (action, actor) => (await events('action = $1 AND actor_id IS NOT DISTINCT FROM $2', [action, actor])).pop();
const total = async () => Number((await lab.sql('SELECT count(*) AS n FROM audit_events'))[0].n);

test('정상: 글을 쓰고 읽은 일이 기록된다', async () => {
  const made = await last('post.create', id.kim);
  assert.equal(made.result, 'ok');
  assert.equal(made.resource_type, 'post');
  assert.equal(Number(made.resource_id), postId);
  const lee = await lab.as('lee');
  await lee.get(postPath);
  const read = await last('post.read', id.lee);
  assert.equal(read.result, 'ok');
  assert.equal(Number(read.resource_id), postId);
  assert.match(read.request_id, /^[0-9a-f-]{36}$/);
});

test('핵심: 거부된 시도도 기록된다 — 글, 게시판, 첨부, 내보내기, 글 저장', async () => {
  const park = await lab.as('park');
  await park.get(postPath);
  await park.get(`/boards/${salesBoard}`);
  await park.get(`/attachments/${attId}/download`, { raw: true });
  await park.get(`/boards/${salesBoard}/export.csv`, { raw: true });
  await park.post(`/boards/${salesBoard}/posts`, { title: 'x', body: 'y' });
  const want = [['post.read', 'post', postId], ['board.read', 'board', Number(salesBoard)],
    ['attachment.download', 'attachment', attId], ['board.export', 'board', Number(salesBoard)], ['post.create', 'board', Number(salesBoard)]];
  for (const [action, type, rid] of want) {
    const e = await last(action, id.park);
    assert.ok(e, `${action} 기록이 없다`);
    assert.equal(e.result, 'denied', action);
    assert.equal(e.resource_type, type, action);
    assert.equal(Number(e.resource_id), rid, action);
  }
});

test('경계: 없는 글을 열려던 것은 글 열람 거부로 기록하지 않는다', async () => {
  const park = await lab.as('park');
  const n = (await events(`action = 'post.read' AND actor_id = $1`, [id.park])).length;
  await park.get('/posts/99999999');
  assert.equal((await events(`action = 'post.read' AND actor_id = $1`, [id.park])).length, n);
});

test('정상: 내려받기와 내보내기가 기록된다', async () => {
  const lee = await lab.as('lee');
  await lee.get(`/attachments/${attId}/download`, { raw: true });
  await lee.get(`/boards/${salesBoard}/export.csv`, { raw: true });
  assert.equal((await last('attachment.download', id.lee)).result, 'ok');
  assert.equal((await last('board.export', id.lee)).result, 'ok');
});

test('핵심: 기록에는 제목·본문·파일 이름·아이디·비밀번호가 들어가지 않는다', async () => {
  await lab.anon().post('/login', { username: 'kim', password: 'my-secret-guess' });
  await lab.anon().post('/login', { username: 'nobody-here', password: 'x' });
  const fail = (await events(`action = 'login.fail'`)).pop();
  assert.equal(fail.actor_id, null);
  const dump = JSON.stringify(await lab.sql('SELECT * FROM audit_events'));
  for (const secret of [TITLE, BODY, FILE, 'my-secret-guess', 'nobody-here', 'pass1234']) {
    assert.ok(!dump.includes(secret), `기록에 "${secret}" 가 들어 있다`);
  }
});

test('핵심: 기록은 고치거나 지울 수 없다', async () => {
  const n = await total();
  await assert.rejects(lab.sql(`UPDATE audit_events SET result = 'ok' WHERE result = 'denied'`));
  await assert.rejects(lab.sql(`DELETE FROM audit_events`));
  await assert.rejects(lab.sql(`TRUNCATE audit_events`));
  assert.equal(await total(), n);
  await assert.rejects(lab.sql(`INSERT INTO audit_events(action, resource_type, result, request_id) VALUES ('x', 'x', 'maybe', gen_random_uuid())`));
});

test('정상: 관리 화면의 부서 이동이 이전·이후 부서와 함께 기록된다', async () => {
  const choi = await lab.as('choi');
  await choi.get(`/admin/users/${id.lee}`);
  await choi.post(`/admin/users/${id.lee}/transfer`, { department_id: String(id.dev), title: '사원' });
  const e = await last('user.transfer', id.choi);
  assert.equal(e.result, 'ok');
  assert.equal(Number(e.resource_id), Number(id.lee));
  assert.ok(JSON.stringify(e.detail).includes(String(id.dev)));
});

test('거부·경계: 관리자가 아닌 사람의 시도는 거부로 기록되고, 실패한 변경은 ok 기록을 남기지 않는다', async () => {
  const kim = await lab.as('kim');
  await kim.post(`/admin/users/${id.park}/offboard`);
  const denied = await last('user.offboard', id.kim);
  assert.equal(denied.result, 'denied');
  assert.equal(Number(denied.resource_id), Number(id.park));
  const choi = await lab.as('choi');
  await choi.get(`/admin/users/${id.kim}`);
  const n = (await events(`action = 'user.transfer' AND result = 'ok'`)).length;
  assert.equal((await choi.post(`/admin/users/${id.kim}/transfer`, { department_id: '999999', title: '' })).status, 400);
  assert.equal((await events(`action = 'user.transfer' AND result = 'ok'`)).length, n);
});

test('정상: 감사 담당은 기록 화면을 보고, 본 것도 기록된다', async () => {
  const han = await lab.as('han');
  assert.match((await han.get('/')).text, /href="\/audit"/);
  const res = await han.get('/audit');
  assert.equal(res.status, 200);
  assert.match(res.text, /post\.read/);
  assert.match(res.text, /박서준/);
  assert.equal((await last('audit.read', id.han)).result, 'ok');
  const denied = await han.get('/audit?result=denied');
  assert.equal(denied.status, 200);
  const main = denied.text.split('<main>')[1];
  assert.match(main, /denied|거부/);
  assert.doesNotMatch(main, /login\.ok/);
});

test('핵심: 시스템 관리자와 일반 직원은 기록 화면을 열 수 없고, 그 시도가 기록된다', async () => {
  for (const [who, uid] of [['choi', id.choi], ['kim', id.kim]]) {
    const c = await lab.as(who);
    assert.doesNotMatch((await c.get('/')).text, /href="\/audit"/, who);
    const res = await c.get('/audit');
    assert.equal(res.status, 404, who);
    assert.doesNotMatch(res.text, /post\.read/, who);
    assert.equal((await last('audit.read', uid)).result, 'denied', who);
  }
});

test('정상: 로그인 성공이 기록된다', async () => {
  await lab.as('jung');
  const jung = (await lab.sql(`SELECT id FROM users WHERE username = 'jung'`))[0].id;
  assert.equal((await last('login.ok', jung)).result, 'ok');
});
