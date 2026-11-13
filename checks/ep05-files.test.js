// 5편 확인: 글을 볼 수 없는 사람은 첨부도, 내보내기도 받을 수 없다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startLab } from './helper.js';
import { transferUser } from '../src/org.js';

let lab, salesBoard, id, postPath, postId, attId;
const CONTENT = Buffer.from('품목,단가\nA-100,12000\nB-200,8500\n', 'utf8');

before(async () => {
  lab = await startLab();
  salesBoard = (await lab.sql(
    `SELECT b.id FROM boards b JOIN departments d ON d.id = b.department_id WHERE d.name = '영업팀'`))[0].id;
  id = { kim: (await lab.sql(`SELECT id FROM users WHERE username = 'kim'`))[0].id,
    dev: (await lab.sql(`SELECT id FROM departments WHERE name = '개발팀'`))[0].id };
  const kim = await lab.as('kim');
  await kim.get(`/boards/${salesBoard}/new`);
  postPath = (await kim.post(`/boards/${salesBoard}/posts`, { title: '거래처 단가표', body: '첨부를 확인하세요.' })).location;
  postId = postPath.split('/').pop();
});
after(async () => { await lab.stop(); });

const rows = async () => Number((await lab.sql('SELECT count(*) AS n FROM attachments'))[0].n);
const files = () => fs.readdirSync(lab.filesDir, { recursive: true }).filter((f) => fs.statSync(`${lab.filesDir}/${f}`).isFile());

test('정상: 글쓴이가 파일을 붙이고, 같은 부서 직원이 내려받는다', async () => {
  const kim = await lab.as('kim');
  await kim.get(postPath);
  const up = await kim.postFile(`${postPath}/attachments`, { name: '단가표 2026.csv', content: CONTENT, type: 'text/csv' });
  assert.equal(up.status, 302);
  assert.equal(up.location, postPath);
  const row = (await lab.sql('SELECT id, storage_key, original_name, size_bytes FROM attachments WHERE post_id = $1', [postId]))[0];
  attId = row.id;
  assert.equal(row.original_name, '단가표 2026.csv');
  assert.equal(Number(row.size_bytes), CONTENT.length);

  const lee = await lab.as('lee');
  assert.match((await lee.get(postPath)).text, new RegExp(`href="/attachments/${attId}/download"`));
  const down = await lee.get(`/attachments/${attId}/download`, { raw: true });
  assert.equal(down.status, 200);
  assert.ok(down.body.equals(CONTENT));
  assert.match(down.headers.get('content-disposition'), /^attachment/);
  assert.match(down.headers.get('content-disposition'), /filename\*=UTF-8''/);
  assert.equal(down.headers.get('x-content-type-options'), 'nosniff');
});

test('정상: 디스크의 파일 이름은 올린 이름이 아니라 서버가 만든 값이다', async () => {
  const key = (await lab.sql('SELECT storage_key FROM attachments WHERE id = $1', [attId]))[0].storage_key;
  const list = files();
  assert.equal(list.length, 1);
  assert.ok(list[0].includes(key), '디스크 이름에 storage_key 가 들어 있어야 한다');
  assert.ok(!list[0].includes('단가표'));
});

test('거부: 다른 부서 직원과 시스템 관리자는 주소를 직접 쳐도 첨부를 받지 못한다', async () => {
  for (const who of ['park', 'choi']) {
    const c = await lab.as(who);
    const res = await c.get(`/attachments/${attId}/download`, { raw: true });
    assert.equal(res.status, 404, who);
    assert.ok(!res.body.includes(CONTENT), who);
    const missing = await c.get('/attachments/99999999/download', { raw: true });
    assert.equal(missing.status, 404);
    const strip = (t) => t.replace(/name="_csrf" value="[^"]*"/g, '');
    assert.equal(strip(res.text), strip(missing.text), '없는 첨부와 응답이 같아야 한다');
  }
});

test('거부: 저장 이름을 알아도 파일 폴더는 웹으로 열리지 않는다', async () => {
  const key = (await lab.sql('SELECT storage_key FROM attachments WHERE id = $1', [attId]))[0].storage_key;
  const park = await lab.as('park');
  for (const p of [`/${key}`, `/files/${key}`, `/.data/files/${key}`, `/attachments/${key}`, `/attachments/${key}/download`]) {
    const res = await park.get(p, { raw: true });
    assert.ok(res.status === 404 || res.status === 302, `${p} → ${res.status}`);
    assert.ok(!res.body.includes(CONTENT), p);
  }
  const anon = await lab.anon().get(`/attachments/${attId}/download`, { raw: true });
  assert.equal(anon.status, 302);
  assert.equal(anon.location, '/login');
});

test('거부: 글쓴이가 아니면 파일을 붙일 수 없고, 아무것도 남지 않는다', async () => {
  const n = await rows();
  const f = files().length;
  const lee = await lab.as('lee');
  await lee.get(postPath);
  assert.equal((await lee.postFile(`${postPath}/attachments`, { name: 'a.txt', content: 'x' })).status, 403);
  const park = await lab.as('park');
  assert.equal((await park.postFile(`${postPath}/attachments`, { name: 'a.txt', content: 'x' })).status, 404);
  assert.equal(await rows(), n);
  assert.equal(files().length, f);
});

test('경계: 5MB 를 넘는 파일, 파일 없는 요청, 토큰이 틀린 요청은 아무것도 남기지 않는다', async () => {
  const n = await rows();
  const f = files().length;
  const kim = await lab.as('kim');
  await kim.get(postPath);
  const big = await kim.postFile(`${postPath}/attachments`, { name: 'big.bin', content: Buffer.alloc(5 * 1024 * 1024 + 1) });
  assert.equal(big.status, 413);
  assert.equal((await kim.postFile(`${postPath}/attachments`, null)).status, 400);
  const good = kim.csrf;
  kim.csrf = 'wrong';
  assert.equal((await kim.postFile(`${postPath}/attachments`, { name: 'a.txt', content: 'x' })).status, 403);
  kim.csrf = good;
  assert.equal(await rows(), n);
  assert.equal(files().length, f);
});

test('경계: 경로가 섞인 파일 이름을 올려도 파일 폴더 밖에 쓰지 않는다', async () => {
  const kim = await lab.as('kim');
  await kim.get(postPath);
  const f = files().length;
  const up = await kim.postFile(`${postPath}/attachments`, { name: '../../evil.txt', content: 'x' });
  assert.equal(up.status, 302);
  assert.equal(files().length, f + 1);
  assert.ok(!fs.existsSync(`${lab.filesDir}/../evil.txt`) && !fs.existsSync(`${lab.filesDir}/../../evil.txt`));
});

test('정상·거부: CSV 내보내기도 같은 권한을 따른다', async () => {
  const lee = await lab.as('lee');
  assert.match((await lee.get(`/boards/${salesBoard}`)).text, new RegExp(`href="/boards/${salesBoard}/export.csv"`));
  const ok = await lee.get(`/boards/${salesBoard}/export.csv`, { raw: true });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/csv/);
  assert.match(ok.text, /거래처 단가표/);
  for (const who of ['park', 'choi']) {
    const c = await lab.as(who);
    const res = await c.get(`/boards/${salesBoard}/export.csv`, { raw: true });
    assert.equal(res.status, 404, who);
    assert.doesNotMatch(res.text, /거래처 단가표/, who);
  }
});

test('경계: CSV 에서 수식으로 읽힐 값은 앞에 작은따옴표가 붙는다', async () => {
  const kim = await lab.as('kim');
  await kim.get(`/boards/${salesBoard}/new`);
  await kim.post(`/boards/${salesBoard}/posts`, { title: '=1+1', body: '본문' });
  const csv = (await kim.get(`/boards/${salesBoard}/export.csv`, { raw: true })).text;
  assert.match(csv, /'=1\+1/);
  assert.doesNotMatch(csv, /(^|,)"?=1\+1/m);
});

test('경계: 부서를 옮기면 자기가 붙인 옛 첨부도 받지 못한다', async () => {
  const kim = await lab.as('kim');
  assert.equal((await kim.get(`/attachments/${attId}/download`, { raw: true })).status, 200);
  await transferUser(lab.pool, { userId: id.kim, departmentId: id.dev });
  assert.equal((await kim.get(`/attachments/${attId}/download`, { raw: true })).status, 404);
});
