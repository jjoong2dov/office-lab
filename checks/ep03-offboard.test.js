// 3편 확인: 퇴사 처리 — 새 로그인과 이미 열린 로그인을 모두 막고, 작성 기록은 남긴다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startLab } from './helper.js';
import { offboardUser, transferUser } from '../src/org.js';

let lab, allBoard, devBoard, id, parkPost;
before(async () => {
  lab = await startLab();
  const board = async (dept) => (await lab.sql(
    `SELECT b.id FROM boards b LEFT JOIN departments d ON d.id = b.department_id
      WHERE d.name IS NOT DISTINCT FROM $1`, [dept]))[0].id;
  [allBoard, devBoard] = [await board(null), await board('개발팀')];
  const uid = async (u) => (await lab.sql(`SELECT id FROM users WHERE username = $1`, [u]))[0].id;
  id = { park: await uid('park'), jung: await uid('jung'), kim: await uid('kim'),
    sales: (await lab.sql(`SELECT id FROM departments WHERE name = '영업팀'`))[0].id };
});
after(async () => { await lab.stop(); });

const write = async (who, boardId, title, body = '본문입니다.') => {
  await who.get(`/boards/${boardId}/new`);
  return who.post(`/boards/${boardId}/posts`, { title, body });
};
const strip = (t) => t.replace(/name="_csrf" value="[^"]*"/g, '');

test('정상: 퇴사 처리하면 이미 열려 있던 로그인이 바로 끊긴다', async () => {
  const park = await lab.as('park');
  const park2 = await lab.as('park');            // 다른 브라우저
  parkPost = (await write(park, devBoard, '배포 절차 정리', '박서준 팀장이 쓴 글')).location;
  assert.equal((await park.get('/boards')).status, 200);

  await offboardUser(lab.pool, { userId: id.park });

  for (const c of [park, park2]) {
    const res = await c.get('/boards');
    assert.equal(res.status, 302);
    assert.equal(res.location, '/login');
  }
  const sessions = await lab.sql(`SELECT count(*) AS n FROM sessions WHERE user_id = $1`, [id.park]);
  assert.equal(Number(sessions[0].n), 0);
});

test('정상: 새 로그인도 안 되고, 응답은 비밀번호가 틀렸을 때와 같다', async () => {
  const a = lab.anon();
  const left = await a.post('/login', { username: 'park', password: 'pass1234' });
  const b = lab.anon();
  const wrong = await b.post('/login', { username: 'park', password: 'wrong-password' });
  assert.equal(left.status, 401);
  assert.equal(left.status, wrong.status);
  assert.equal(strip(left.text), strip(wrong.text));
});

test('정상: 계정 행과 쓴 글은 남고, 작성자 옆에 퇴사 딱지가 붙는다', async () => {
  const user = (await lab.sql(`SELECT status, left_on FROM users WHERE id = $1`, [id.park]))[0];
  assert.equal(user.status, 'left');
  assert.ok(user.left_on);
  const jung = await lab.as('jung');
  const detail = await jung.get(parkPost);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /박서준/);
  assert.match(detail.text, /퇴사/);
  const list = (await jung.get(`/boards/${devBoard}`)).text;
  const row = list.split('<tr').find((r) => r.includes('배포 절차 정리')) || '';
  assert.match(row, /박서준/);
  assert.match(row, /퇴사/);
});

test('정상: 열린 소속이 닫힌다', async () => {
  const open = await lab.sql(`SELECT count(*) AS n FROM org_assignments WHERE user_id = $1 AND ends_on IS NULL`, [id.park]);
  assert.equal(Number(open[0].n), 0);
});

test('경계: 다른 사람의 로그인은 그대로다', async () => {
  const jung = await lab.as('jung');
  await offboardUser(lab.pool, { userId: id.kim });
  assert.equal((await jung.get('/boards')).status, 200);
});

test('경계: 세션 행이 남아 있어도 퇴사자는 들어오지 못한다', async () => {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await lab.sql(
    `INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at) VALUES ($1, $2, 'x', now() + interval '1 hour')`,
    [hash, id.park]);
  const c = lab.anon();
  c.cookie = `sid=${token}`;
  const res = await c.get('/boards');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/login');
});

test('경계: 글이 있는 계정은 DB 에서 지워지지 않는다', async () => {
  await assert.rejects(lab.sql(`DELETE FROM users WHERE id = $1`, [id.park]));
});

test('경계: 두 번 퇴사 처리, 없는 사용자, 퇴사자 부서 이동은 오류가 나고 아무것도 바뀌지 않는다', async () => {
  const snap = () => lab.sql(`SELECT status, left_on, department_id FROM users WHERE id = $1`, [id.park]);
  const beforeRow = await snap();
  await assert.rejects(offboardUser(lab.pool, { userId: id.park }));
  await assert.rejects(offboardUser(lab.pool, { userId: 999999 }));
  await assert.rejects(transferUser(lab.pool, { userId: id.park, departmentId: id.sales }));
  assert.deepEqual(await snap(), beforeRow);
});
