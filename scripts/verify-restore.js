// 복원 대조: node scripts/verify-restore.js <백업 폴더> <대상 DATABASE_URL> <대상 파일 폴더>
// 백업의 목록표(manifest.json)와 복원한 대상을 비교한다. 하나라도 다르면 문제를 한 줄씩 찍고 종료 코드 1.
//  - migration 목록이 같은가
//  - 표마다 행 수와 내용 지문(md5)이 같은가, 빠지거나 더 생긴 표는 없는가
//  - 세션이 비어 있는가 (복원한 시스템에서는 모두 다시 로그인한다)
//  - 목록표의 파일마다 있는가, 크기·sha256 이 같은가
//  - DB 의 attachments 행과 폴더의 파일이 서로 빠짐없이 짝이 맞는가 (행만 있는 것, 파일만 있는 것이 없는가)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { MANIFEST_VERSION, sha256File, fixSessionFormat, tableStats, migrationNames } from './backup-common.js';

export function readManifest(backupDir) {
  const file = path.join(backupDir, 'manifest.json');
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new Error(`목록표를 읽지 못했습니다: ${file} (${e.message})`);
  }
  if (m.version !== MANIFEST_VERSION) throw new Error(`모르는 목록표 형식입니다: ${m.version}`);
  return m;
}

export async function verifyRestore({ backupDir, databaseUrl, filesDir }) {
  const m = readManifest(backupDir);
  const problems = [];
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let atts;
  try {
    // DB 쪽은 한 스냅숏에서 읽는다
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await fixSessionFormat(client);
    // 한 질의가 실패해도(표가 없는 등) 트랜잭션이 깨지지 않게 저장점 안에서 읽는다. 실패하면 문제로 적고 fallback 을 쓴다.
    const attempt = async (what, fn, fallback) => {
      await client.query('SAVEPOINT verify_step');
      try {
        const out = await fn();
        await client.query('RELEASE SAVEPOINT verify_step');
        return out;
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT verify_step');
        problems.push(`${what} 읽지 못했습니다: ${e.message}`);
        return fallback;
      }
    };

    // migration 목록
    const migrations = await attempt('migration 목록을', () => migrationNames(client), []);
    const want = new Set(m.migrations);
    const have = new Set(migrations);
    for (const n of m.migrations) if (!have.has(n)) problems.push(`migration 이 빠졌습니다: ${n}`);
    for (const n of migrations) if (!want.has(n)) problems.push(`백업에 없던 migration 이 있습니다: ${n}`);

    // 표마다 행 수·내용
    const tables = await attempt('표 목록을', () => tableStats(client), {});
    for (const [name, w] of Object.entries(m.tables)) {
      const h = tables[name];
      if (!h) { problems.push(`표가 없습니다: ${name}`); continue; }
      if (h.rows !== w.rows) problems.push(`${name} 행 수가 다릅니다: 백업 ${w.rows}, 복원 ${h.rows}`);
      else if (h.md5 !== w.md5) problems.push(`${name} 내용이 다릅니다 (행 수는 ${h.rows} 로 같음)`);
    }
    for (const name of Object.keys(tables)) if (!m.tables[name]) problems.push(`백업에 없던 표가 있습니다: ${name}`);

    // 세션
    const n = await attempt('sessions 표를', async () => Number((await client.query('SELECT count(*) AS n FROM sessions')).rows[0].n), 0);
    if (n !== 0) problems.push(`로그인 세션이 ${n}개 남아 있습니다 (복원 뒤에는 비어 있어야 합니다)`);

    atts = await attempt('attachments 표를', async () => (await client.query(
      'SELECT id, storage_key::text AS key, size_bytes FROM attachments ORDER BY id')).rows, []);
    await client.query('COMMIT');
  } finally {
    client.release();
    await pool.end();
  }

  // 파일 폴더에 실제로 있는 것 (하위 폴더까지)
  const onDisk = new Map();   // 폴더 안의 상대 경로 → 크기 (일반 파일만)
  if (!fs.existsSync(filesDir)) {
    problems.push(`파일 폴더가 없습니다: ${filesDir}`);
  } else {
    for (const rel of fs.readdirSync(filesDir, { recursive: true })) {
      const st = fs.lstatSync(path.join(filesDir, rel));
      if (st.isFile()) onDisk.set(String(rel), st.size);
      else if (!st.isDirectory()) problems.push(`파일 폴더에 일반 파일이 아닌 것이 있습니다: ${rel}`);
    }
  }

  // 목록표의 파일마다: 있는가, 크기·sha256
  for (const f of m.files) {
    const size = onDisk.get(f.storage_key);
    if (size === undefined) { problems.push(`파일이 없습니다: ${f.storage_key}`); continue; }
    if (size !== f.size) { problems.push(`파일 크기가 다릅니다: ${f.storage_key} (백업 ${f.size}, 복원 ${size})`); continue; }
    if (await sha256File(path.join(filesDir, f.storage_key)) !== f.sha256) problems.push(`파일 내용(sha256)이 다릅니다: ${f.storage_key}`);
  }

  // attachments 행 ↔ 파일: 서로 빠짐없이 짝이 맞는가
  const keys = new Set(atts.map((a) => a.key));
  const inManifest = new Set(m.files.map((f) => f.storage_key));
  for (const a of atts) {
    if (!onDisk.has(a.key)) {
      if (inManifest.has(a.key)) continue;   // 위에서 이미 "파일이 없습니다" 로 적었다
      problems.push(`첨부 ${a.id} 의 파일이 없습니다: ${a.key}`);
    } else if (onDisk.get(a.key) !== Number(a.size_bytes)) {
      problems.push(`첨부 ${a.id} 의 크기가 DB 와 다릅니다: DB ${a.size_bytes}, 파일 ${onDisk.get(a.key)}`);
    }
    if (!inManifest.has(a.key)) problems.push(`첨부 ${a.id} 가 백업 목록표에 없습니다: ${a.key}`);
  }
  for (const rel of onDisk.keys()) if (!keys.has(rel)) problems.push(`DB 에 첨부 행이 없는 파일이 있습니다: ${rel}`);

  return { ok: problems.length === 0, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [backupDir, databaseUrl, filesDir] = process.argv.slice(2);
  if (!backupDir || !databaseUrl || !filesDir) {
    console.error('사용법: node scripts/verify-restore.js <백업 폴더> <대상 DATABASE_URL> <대상 파일 폴더>');
    process.exit(1);
  }
  try {
    const v = await verifyRestore({ backupDir: path.resolve(backupDir), databaseUrl, filesDir: path.resolve(filesDir) });
    for (const p of v.problems) console.log(p);
    console.log(v.ok ? '대조 통과: 백업과 같습니다.' : `대조 실패: 다른 곳 ${v.problems.length}개`);
    if (!v.ok) process.exitCode = 1;
  } catch (e) {
    console.error(`대조하지 못했습니다: ${e.message}`);
    process.exitCode = 1;
  }
}
