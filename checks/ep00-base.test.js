// 시작 코드 확인: 로그인이 되고, 로그인하지 않으면 들어갈 수 없다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLab } from './helper.js';

let lab;
before(async () => { lab = await startLab(); });
after(async () => { await lab.stop(); });

test('로그인하지 않으면 로그인 화면으로 보낸다', async () => {
  const res = await lab.anon().get('/');
  assert.equal(res.status, 302);
  assert.equal(res.location, '/login');
});

test('로그인하면 홈에 이름과 소속이 보인다', async () => {
  const kim = await lab.as('kim');
  const res = await kim.get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /김하늘/);
  assert.match(res.text, /영업팀/);
});

test('비밀번호가 틀리면 로그인되지 않는다', async () => {
  const c = lab.anon();
  const res = await c.post('/login', { username: 'kim', password: 'wrong' });
  assert.equal(res.status, 401);
});

test('토큰 없는 POST 는 거부한다', async () => {
  const kim = await lab.as('kim');
  kim.csrf = 'x';
  const res = await kim.post('/logout');
  assert.equal(res.status, 403);
});
