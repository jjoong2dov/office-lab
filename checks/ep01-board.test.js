// 1편 확인: 부서 게시판 — 다른 부서 글은 목록에도, 직접 주소로도 안 보인다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLab } from './helper.js';

let lab, salesBoard, devBoard, allBoard;
before(async () => {
  lab = await startLab();
  const board = async (dept) => (await lab.sql(
    `SELECT b.id FROM boards b LEFT JOIN departments d ON d.id = b.department_id
      WHERE d.name IS NOT DISTINCT FROM $1`, [dept]))[0]?.id;
  salesBoard = await board('영업팀');
  devBoard = await board('개발팀');
  allBoard = await board(null);
});
after(async () => { await lab.stop(); });

const count = async () => Number((await lab.sql('SELECT count(*) AS n FROM posts'))[0].n);
const write = async (who, boardId, title, body = '본문입니다.') => {
  await who.get(`/boards/${boardId}/new`);
  return who.post(`/boards/${boardId}/posts`, { title, body });
};

test('가상 데이터: 전사 게시판 하나와 부서마다 게시판 하나', () => {
  assert.ok(salesBoard && devBoard && allBoard);
});

test('정상: 영업팀 직원이 영업팀 게시판에 글을 쓰고, 같은 팀 직원이 읽는다', async () => {
  const kim = await lab.as('kim');
  const res = await write(kim, salesBoard, '10월 거래처 방문 일정', '화요일 오전에 방문합니다.');
  assert.equal(res.status, 302);
  assert.match(res.location, /^\/posts\/\d+$/);

  const lee = await lab.as('lee');
  const list = await lee.get(`/boards/${salesBoard}`);
  assert.equal(list.status, 200);
  assert.match(list.text, /10월 거래처 방문 일정/);
  const detail = await lee.get(res.location);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /화요일 오전에 방문합니다\./);
  assert.match(detail.text, /김하늘/);
  assert.match(detail.text, /영업팀/);
});

test('거부: 다른 부서 직원에게는 게시판 목록에 나오지 않는다', async () => {
  const park = await lab.as('park');
  const res = await park.get('/boards');
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, new RegExp(`href="/boards/${salesBoard}"`));
  assert.match(res.text, new RegExp(`href="/boards/${devBoard}"`));
  assert.match(res.text, new RegExp(`href="/boards/${allBoard}"`));
});

test('거부: 주소를 직접 쳐도 글 목록·상세·글쓰기 화면이 열리지 않는다', async () => {
  const kim = await lab.as('kim');
  const made = await write(kim, salesBoard, '영업팀만 보는 글', '단가표 초안');
  const park = await lab.as('park');
  for (const path of [`/boards/${salesBoard}`, made.location, `/boards/${salesBoard}/new`]) {
    const res = await park.get(path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.text, /영업팀만 보는 글|단가표 초안/, path);
  }
});

test('거부: 다른 부서 게시판에 글을 저장할 수 없고 DB 에 아무것도 남지 않는다', async () => {
  const park = await lab.as('park');
  const before = await count();
  const res = await park.post(`/boards/${salesBoard}/posts`, { title: '몰래 쓴 글', body: 'x' });
  assert.equal(res.status, 404);
  assert.equal(await count(), before);
});

test('경계: 없는 글과 볼 수 없는 글의 응답이 같다', async () => {
  const kim = await lab.as('kim');
  const made = await write(kim, salesBoard, '응답 비교용', '본문');
  const park = await lab.as('park');
  const forbidden = await park.get(made.location);
  const missing = await park.get('/posts/99999999');
  const strip = (t) => t.replace(/name="_csrf" value="[^"]+"/g, '');
  assert.equal(forbidden.status, missing.status);
  assert.equal(strip(forbidden.text), strip(missing.text));
  assert.equal((await park.get('/posts/abc')).status, 404);
  assert.equal((await park.get('/boards/abc')).status, 404);
});

test('경계: 전사 게시판은 모든 부서가 읽고 쓴다', async () => {
  const park = await lab.as('park');
  const made = await write(park, allBoard, '사내 시스템 점검 안내', '금요일 저녁에 점검합니다.');
  assert.equal(made.status, 302);
  const kim = await lab.as('kim');
  const detail = await kim.get(made.location);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /박서준/);
  assert.match(detail.text, /개발팀/);
});

test('경계: 로그인하지 않으면 전부 로그인 화면으로', async () => {
  const anon = lab.anon();
  for (const path of ['/boards', `/boards/${salesBoard}`, '/posts/1']) {
    const res = await anon.get(path);
    assert.equal(res.status, 302, path);
    assert.equal(res.location, '/login', path);
  }
});

test('경계: 제목의 태그는 글자 그대로 나오고, 빈 제목은 저장되지 않는다', async () => {
  const kim = await lab.as('kim');
  const made = await write(kim, salesBoard, '<script>alert(1)</script>', '본문');
  const detail = await kim.get(made.location);
  assert.doesNotMatch(detail.text, /<script>alert\(1\)<\/script>/);
  assert.match(detail.text, /&lt;script&gt;/);
  const before = await count();
  const empty = await write(kim, salesBoard, '   ', '본문');
  assert.equal(empty.status, 400);
  assert.equal(await count(), before);
});
