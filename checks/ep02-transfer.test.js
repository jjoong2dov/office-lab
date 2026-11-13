// 2편 확인: 부서를 옮겨도 지난 글에는 쓴 당시의 소속이 남는다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLab } from './helper.js';
import { transferUser } from '../src/org.js';

let lab, salesBoard, devBoard, allBoard, id;
before(async () => {
  lab = await startLab();
  const board = async (dept) => (await lab.sql(
    `SELECT b.id FROM boards b LEFT JOIN departments d ON d.id = b.department_id
      WHERE d.name IS NOT DISTINCT FROM $1`, [dept]))[0].id;
  [salesBoard, devBoard, allBoard] = [await board('영업팀'), await board('개발팀'), await board(null)];
  id = {
    kim: (await lab.sql(`SELECT id FROM users WHERE username = 'kim'`))[0].id,
    lee: (await lab.sql(`SELECT id FROM users WHERE username = 'lee'`))[0].id,
    dev: (await lab.sql(`SELECT id FROM departments WHERE name = '개발팀'`))[0].id,
    sales: (await lab.sql(`SELECT id FROM departments WHERE name = '영업팀'`))[0].id,
  };
});
after(async () => { await lab.stop(); });

const write = async (who, boardId, title, body = '본문입니다.') => {
  await who.get(`/boards/${boardId}/new`);
  return who.post(`/boards/${boardId}/posts`, { title, body });
};
const assignments = (userId) => lab.sql(
  `SELECT a.title, a.starts_on, a.ends_on, d.name AS dept FROM org_assignments a
     JOIN departments d ON d.id = a.department_id WHERE a.user_id = $1 ORDER BY a.starts_on, a.id`, [userId]);

test('처음에는 사람마다 열린 소속이 하나씩 있다', async () => {
  const rows = await lab.sql(`SELECT user_id, count(*) AS n FROM org_assignments WHERE ends_on IS NULL GROUP BY user_id`);
  const users = await lab.sql(`SELECT count(*) AS n FROM users`);
  assert.equal(rows.length, Number(users[0].n));
  assert.ok(rows.every((r) => Number(r.n) === 1));
});

test('정상: 부서를 옮겨도 옮기기 전에 쓴 글에는 당시 소속과 직급이 남는다', async () => {
  const kim = await lab.as('kim');
  const old = await write(kim, allBoard, '영업팀 김하늘이 쓴 공지', '옮기기 전 글');
  assert.equal(old.status, 302);

  await transferUser(lab.pool, { userId: id.kim, departmentId: id.dev, title: '과장' });

  const fresh = await write(kim, allBoard, '개발팀으로 옮긴 뒤 쓴 글', '옮긴 뒤 글');   // 다시 로그인하지 않아도 새 소속으로
  const lee = await lab.as('lee');
  const oldPage = await lee.get(old.location);
  assert.match(oldPage.text, /영업팀/);
  assert.match(oldPage.text, /대리/);
  assert.doesNotMatch(oldPage.text.split('<main>')[1], /개발팀/);
  const newPage = await lee.get(fresh.location);
  assert.match(newPage.text, /개발팀/);
  assert.match(newPage.text, /과장/);

  const list = (await lee.get(`/boards/${allBoard}`)).text;
  const rowOf = (title) => list.split('<tr').find((r) => r.includes(title)) || '';
  assert.match(rowOf('영업팀 김하늘이 쓴 공지'), /영업팀/);
  assert.match(rowOf('개발팀으로 옮긴 뒤 쓴 글'), /개발팀/);
});

test('정상: 소속 이력이 쌓인다 — 옛 소속은 닫히고 열린 소속은 하나', async () => {
  const rows = await assignments(id.kim);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dept, '영업팀');
  assert.ok(rows[0].ends_on, '옛 소속에 종료일이 있어야 한다');
  assert.equal(rows[1].dept, '개발팀');
  assert.equal(rows[1].title, '과장');
  assert.equal(rows[1].ends_on, null);
  const user = (await lab.sql(`SELECT department_id, title FROM users WHERE id = $1`, [id.kim]))[0];
  assert.equal(String(user.department_id), String(id.dev));
  assert.equal(user.title, '과장');
});

test('정상: 홈 화면에 소속 이력이 보인다', async () => {
  const kim = await lab.as('kim');
  const main = (await kim.get('/')).text.split('<main>')[1];
  assert.match(main, /소속 이력/);
  assert.match(main, /영업팀/);
  assert.match(main, /개발팀/);
  assert.match(main, /현재/);
});

test('거부: 옮긴 뒤에는 옛 부서 게시판과 거기에 쓴 자기 글도 열리지 않는다', async () => {
  const lee = await lab.as('lee');
  const made = await write(lee, salesBoard, '영업팀 이도윤의 글', '영업팀 안에서만');
  assert.equal((await lee.get(made.location)).status, 200);
  await transferUser(lab.pool, { userId: id.lee, departmentId: id.dev });
  assert.equal((await lee.get(made.location)).status, 404);
  assert.equal((await lee.get(`/boards/${salesBoard}`)).status, 404);
  assert.equal((await lee.get(`/boards/${devBoard}`)).status, 200);
  const title = (await lab.sql(`SELECT title FROM users WHERE id = $1`, [id.lee]))[0].title;
  assert.equal(title, '사원', '직급을 주지 않으면 그대로다');
});

test('경계: 열린 소속을 하나 더 넣으면 DB 가 거부한다', async () => {
  await assert.rejects(lab.sql(
    `INSERT INTO org_assignments(user_id, department_id, title, starts_on) VALUES ($1, $2, '대리', current_date)`,
    [id.kim, id.sales]));
});

test('경계: 종료일이 시작일보다 앞서면 DB 가 거부한다', async () => {
  await assert.rejects(lab.sql(
    `INSERT INTO org_assignments(user_id, department_id, title, starts_on, ends_on)
     VALUES ($1, $2, '대리', date '2020-03-01', date '2020-02-01')`, [id.kim, id.sales]));
});

test('경계: 같은 부서로 옮기기, 없는 부서로 옮기기는 오류가 나고 아무것도 바뀌지 않는다', async () => {
  const beforeRows = await assignments(id.kim);
  await assert.rejects(transferUser(lab.pool, { userId: id.kim, departmentId: id.dev }));
  await assert.rejects(transferUser(lab.pool, { userId: id.kim, departmentId: 999999 }));
  await assert.rejects(transferUser(lab.pool, { userId: 999999, departmentId: id.dev }));
  assert.deepEqual(await assignments(id.kim), beforeRows);
  const user = (await lab.sql(`SELECT department_id FROM users WHERE id = $1`, [id.kim]))[0];
  assert.equal(String(user.department_id), String(id.dev));
});
