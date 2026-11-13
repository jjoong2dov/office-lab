// 7편 확인: 백업을 다른 DB 에 복원하고, 원본과 같은지 대조한다.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { startLab } from './helper.js';
import { transferUser } from '../src/org.js';
import { backup } from '../scripts/backup.js';
import { restore } from '../scripts/restore.js';
import { verifyRestore } from '../scripts/verify-restore.js';

let lab, tmp, srcUrl, admin, backupDir, postPath, attId, id;
const CONTENT = Buffer.from('품목,단가\nA-100,12000\n', 'utf8');
const made = [];

const urlFor = (name) => { const u = new URL(srcUrl); u.pathname = `/${name}`; return u.toString(); };
async function freshDb(tag) {
  const name = `${new URL(srcUrl).pathname.slice(1)}_${tag}`;
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.query(`CREATE DATABASE "${name}"`);
  made.push(name);
  return urlFor(name);
}

before(async () => {
  lab = await startLab();
  srcUrl = process.env.DATABASE_URL;
  admin = new pg.Pool({ connectionString: srcUrl, max: 1 });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-lab-backup-'));
  const salesBoard = (await lab.sql(
    `SELECT b.id FROM boards b JOIN departments d ON d.id = b.department_id WHERE d.name = '영업팀'`))[0].id;
  id = { lee: (await lab.sql(`SELECT id FROM users WHERE username = 'lee'`))[0].id,
    dev: (await lab.sql(`SELECT id FROM departments WHERE name = '개발팀'`))[0].id };
  const kim = await lab.as('kim');
  await kim.get(`/boards/${salesBoard}/new`);
  postPath = (await kim.post(`/boards/${salesBoard}/posts`, { title: '복원 확인용 글', body: '이 글이 그대로 나와야 한다' })).location;
  await kim.get(postPath);
  await kim.postFile(`${postPath}/attachments`, { name: '단가표.csv', content: CONTENT, type: 'text/csv' });
  attId = (await lab.sql('SELECT id FROM attachments ORDER BY id DESC LIMIT 1'))[0].id;
  await transferUser(lab.pool, { userId: id.lee, departmentId: id.dev });
  backupDir = await backup({ databaseUrl: srcUrl, filesDir: lab.filesDir, outDir: path.join(tmp, 'backups') });
});
after(async () => {
  await lab.stop();
  for (const name of made) await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('정상: 백업 한 벌에 DB 덤프, 파일 묶음, 목록표가 있다', () => {
  for (const f of ['db.dump', 'files.tar.gz', 'manifest.json']) assert.ok(fs.statSync(path.join(backupDir, f)).size > 0, f);
  const m = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  const text = JSON.stringify(m);
  for (const t of ['users', 'posts', 'attachments', 'org_assignments', 'audit_events']) assert.ok(text.includes(t), t);
  assert.ok(/[0-9a-f]{64}/.test(text), '파일의 sha256 이 있어야 한다');
  assert.ok(!text.includes('pass1234'));
});

test('핵심: 다른 DB 에 복원하면 대조가 통과하고, 글·첨부·소속 이력이 그대로 나온다', async () => {
  const url = await freshDb('restore_a');
  const filesDir = path.join(tmp, 'files_a');
  await restore({ backupDir, databaseUrl: url, filesDir });
  const v = await verifyRestore({ backupDir, databaseUrl: url, filesDir });
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);

  const copy = await startLab({ databaseUrl: url, filesDir, keep: true });
  try {
    const kim = await copy.as('kim');
    const page = await kim.get(postPath);
    assert.equal(page.status, 200);
    assert.match(page.text, /이 글이 그대로 나와야 한다/);
    const down = await kim.get(`/attachments/${attId}/download`, { raw: true });
    assert.ok(down.body.equals(CONTENT));
    const park = await copy.as('park');
    assert.equal((await park.get(postPath)).status, 404, '복원한 시스템에서도 권한은 그대로다');
    const hist = await copy.sql(`SELECT count(*) AS n FROM org_assignments WHERE user_id = $1`, [id.lee]);
    assert.equal(Number(hist[0].n), 2);
    await assert.rejects(copy.sql(`DELETE FROM audit_events`), '복원한 DB 에서도 기록은 지울 수 없다');
  } finally { await copy.stop(); }
});

test('핵심: 복원한 시스템에는 옛 로그인이 남아 있지 않다', async () => {
  const url = await freshDb('restore_b');
  const filesDir = path.join(tmp, 'files_b');
  await restore({ backupDir, databaseUrl: url, filesDir });
  const p = new pg.Pool({ connectionString: url, max: 1 });
  try {
    assert.equal(Number((await p.query('SELECT count(*) AS n FROM sessions')).rows[0].n), 0);
  } finally { await p.end(); }
});

test('핵심: 복원 뒤 파일 하나가 없어지거나 내용이 바뀌면 대조가 실패한다', async () => {
  const url = await freshDb('restore_c');
  const filesDir = path.join(tmp, 'files_c');
  await restore({ backupDir, databaseUrl: url, filesDir });
  const all = fs.readdirSync(filesDir, { recursive: true }).map((f) => path.join(filesDir, f)).filter((f) => fs.statSync(f).isFile());
  assert.ok(all.length >= 1);
  fs.appendFileSync(all[0], 'x');
  let v = await verifyRestore({ backupDir, databaseUrl: url, filesDir });
  assert.equal(v.ok, false);
  assert.ok(v.problems.length >= 1);
  fs.rmSync(all[0]);
  v = await verifyRestore({ backupDir, databaseUrl: url, filesDir });
  assert.equal(v.ok, false);
});

test('핵심: 복원 뒤 행이 하나 빠지면 대조가 실패한다', async () => {
  const url = await freshDb('restore_d');
  const filesDir = path.join(tmp, 'files_d');
  await restore({ backupDir, databaseUrl: url, filesDir });
  const p = new pg.Pool({ connectionString: url, max: 1 });
  try { await p.query(`DELETE FROM org_assignments WHERE id = (SELECT max(id) FROM org_assignments)`); } finally { await p.end(); }
  const v = await verifyRestore({ backupDir, databaseUrl: url, filesDir });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((s) => s.includes('org_assignments')));
});

test('거부: 원본 DB, 비어 있지 않은 DB, 비어 있지 않은 폴더에는 복원하지 않는다', async () => {
  const n = async () => Number((await lab.sql('SELECT count(*) AS n FROM posts'))[0].n);
  const before = await n();
  await assert.rejects(restore({ backupDir, databaseUrl: srcUrl, filesDir: path.join(tmp, 'files_x') }));
  assert.equal(await n(), before);
  assert.ok(!fs.existsSync(path.join(tmp, 'files_x')) || fs.readdirSync(path.join(tmp, 'files_x')).length === 0);

  const url = await freshDb('restore_e');
  const p = new pg.Pool({ connectionString: url, max: 1 });
  try { await p.query('CREATE TABLE already_here (id int)'); } finally { await p.end(); }
  await assert.rejects(restore({ backupDir, databaseUrl: url, filesDir: path.join(tmp, 'files_e') }));

  const url2 = await freshDb('restore_f');
  const busy = path.join(tmp, 'files_f');
  fs.mkdirSync(busy);
  fs.writeFileSync(path.join(busy, 'something'), 'x');
  await assert.rejects(restore({ backupDir, databaseUrl: url2, filesDir: busy }));
  const p2 = new pg.Pool({ connectionString: url2, max: 1 });
  try {
    const t = await p2.query(`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'`);
    assert.equal(Number(t.rows[0].n), 0, '거부했으면 DB 에도 아무것도 쓰지 않는다');
  } finally { await p2.end(); }
});
