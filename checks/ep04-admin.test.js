// 4편 확인: 시스템 관리자는 계정·조직을 고치지만, 그것만으로 다른 부서 글을 읽지는 못한다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLab } from './helper.js';

let lab, salesBoard, id, salesPost;
before(async () => {
  lab = await startLab();
  salesBoard = (await lab.sql(
    `SELECT b.id FROM boards b JOIN departments d ON d.id = b.department_id WHERE d.name = '영업팀'`))[0].id;
  const uid = async (u) => (await lab.sql(`SELECT id FROM users WHERE username = $1`, [u]))[0].id;
  id = { kim: await uid('kim'), lee: await uid('lee'), park: await uid('park'), choi: await uid('choi'),
    dev: (await lab.sql(`SELECT id FROM departments WHERE name = '개발팀'`))[0].id };
  const kim = await lab.as('kim');
  await kim.get(`/boards/${salesBoard}/new`);
  salesPost = (await kim.post(`/boards/${salesBoard}/posts`, { title: '3분기 단가 협의', body: '영업팀만 보는 내용' })).location;
});
after(async () => { await lab.stop(); });

const userRow = async (uid) => (await lab.sql(`SELECT department_id, title, status FROM users WHERE id = $1`, [uid]))[0];

test('정상: 시스템 관리자에게 관리 메뉴와 직원 목록이 보인다', async () => {
  const choi = await lab.as('choi');
  assert.match((await choi.get('/')).text, /href="\/admin\/users"/);
  const res = await choi.get('/admin/users');
  assert.equal(res.status, 200);
  for (const name of ['김하늘', '이도윤', '박서준', '정유나', '최지우']) assert.match(res.text, new RegExp(name));
});

test('정상: 관리 화면에서 부서를 옮긴다', async () => {
  const choi = await lab.as('choi');
  await choi.get(`/admin/users/${id.lee}`);
  const res = await choi.post(`/admin/users/${id.lee}/transfer`, { department_id: String(id.dev), title: '대리' });
  assert.equal(res.status, 302);
  assert.equal(res.location, `/admin/users/${id.lee}`);
  const row = await userRow(id.lee);
  assert.equal(String(row.department_id), String(id.dev));
  assert.equal(row.title, '대리');
  const page = await choi.get(`/admin/users/${id.lee}`);
  assert.match(page.text, /영업팀/);
  assert.match(page.text, /개발팀/);
});

test('핵심: 시스템 관리자도 다른 부서 게시판과 글은 열지 못한다', async () => {
  const choi = await lab.as('choi');
  assert.equal((await choi.get(`/boards/${salesBoard}`)).status, 404);
  const res = await choi.get(salesPost);
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.text, /3분기 단가 협의|영업팀만 보는 내용/);
  assert.doesNotMatch((await choi.get('/boards')).text, new RegExp(`href="/boards/${salesBoard}"`));
});

test('거부: 관리자가 아니면 관리 메뉴가 없고, 주소를 직접 쳐도 열리지 않는다', async () => {
  const kim = await lab.as('kim');
  assert.doesNotMatch((await kim.get('/')).text, /href="\/admin\/users"/);
  for (const path of ['/admin/users', `/admin/users/${id.park}`]) {
    const res = await kim.get(path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.text, /박서준/, path);
  }
});

test('거부: 관리자가 아닌 사람의 부서 이동·퇴사 처리 요청은 아무것도 바꾸지 않는다', async () => {
  const kim = await lab.as('kim');
  const beforeRow = await userRow(id.park);
  assert.equal((await kim.post(`/admin/users/${id.park}/transfer`, { department_id: String(id.dev), title: '사원' })).status, 404);
  assert.equal((await kim.post(`/admin/users/${id.park}/offboard`)).status, 404);
  assert.deepEqual(await userRow(id.park), beforeRow);
});

test('정상: 관리 화면에서 퇴사 처리하면 그 사람의 열린 로그인이 끊긴다', async () => {
  const park = await lab.as('park');
  const choi = await lab.as('choi');
  await choi.get(`/admin/users/${id.park}`);
  const res = await choi.post(`/admin/users/${id.park}/offboard`);
  assert.equal(res.status, 302);
  assert.equal((await userRow(id.park)).status, 'left');
  assert.equal((await park.get('/')).status, 302);
  assert.match((await choi.get('/admin/users')).text, /퇴사/);
});

test('경계: 자기 자신은 퇴사 처리할 수 없고, 잘못된 부서 이동은 400', async () => {
  const choi = await lab.as('choi');
  await choi.get(`/admin/users/${id.choi}`);
  assert.equal((await choi.post(`/admin/users/${id.choi}/offboard`)).status, 400);
  assert.equal((await userRow(id.choi)).status, 'active');
  await choi.get(`/admin/users/${id.kim}`);
  assert.equal((await choi.post(`/admin/users/${id.kim}/transfer`, { department_id: '999999', title: '' })).status, 400);
  assert.equal((await choi.get('/admin/users/abc')).status, 404);
  assert.equal((await choi.get('/admin/users/999999')).status, 404);
});

test('경계: 역할을 빼면 다시 로그인하지 않아도 다음 요청부터 막힌다', async () => {
  const choi = await lab.as('choi');
  assert.equal((await choi.get('/admin/users')).status, 200);
  await lab.sql(`DELETE FROM user_roles WHERE user_id = $1`, [id.choi]);
  assert.equal((await choi.get('/admin/users')).status, 404);
  assert.doesNotMatch((await choi.get('/')).text, /href="\/admin\/users"/);
});

test('경계: 표에 없는 역할 이름은 DB 가 거부한다', async () => {
  await assert.rejects(lab.sql(`INSERT INTO user_roles(user_id, role) VALUES ($1, 'superuser')`, [id.kim]));
});
