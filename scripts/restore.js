// 복원: node scripts/restore.js <백업 폴더> <대상 DATABASE_URL> <대상 파일 폴더>
// 복원은 비어 있는 다른 DB 와 비어 있는 다른 파일 폴더에만 한다. 쓰기 전에 아래를 모두 확인하고, 하나라도 걸리면 아무것도 쓰지 않는다.
//  - 백업 한 벌이 온전한가: 목록표, db.dump·files.tar.gz 의 sha256, 묶음 안의 파일이 목록표와 같은가
//  - 대상 DB 가 원본(백업한 DB)이 아닌가, 표·뷰·시퀀스가 하나도 없는가
//  - 대상 파일 폴더가 없거나 비어 있는가
// 그다음 pg_restore(한 트랜잭션) → 세션 비우기 → 파일 묶음 풀기 → 대조(verify-restore) 순서로 한다. 대조가 실패하면 오류.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEY, pgToolArgs, run, sha256File } from './backup-common.js';
import { dbIdentity } from './backup.js';
import { readManifest, verifyRestore } from './verify-restore.js';

// 백업 한 벌을 확인한다. 문제가 있으면 오류를 던진다.
async function checkBackup(backupDir) {
  const m = readManifest(backupDir);
  for (const name of ['db.dump', 'files.tar.gz']) {
    const file = path.join(backupDir, name);
    if (!fs.existsSync(file)) throw new Error(`백업에 ${name} 이 없습니다.`);
    if (await sha256File(file) !== m.archives?.[name]) throw new Error(`${name} 이 목록표와 다릅니다 (sha256 불일치). 손상된 백업입니다.`);
  }
  // 묶음 안의 이름이 목록표의 파일 이름(UUID)과 정확히 같아야 한다. 경로가 붙은 이름, 폴더, 모르는 파일은 받지 않는다.
  const names = (await run('tar', ['-tzf', path.join(backupDir, 'files.tar.gz')])).split('\n').filter(Boolean);
  const want = new Set(m.files.map((f) => f.storage_key));
  for (const n of names) {
    if (!STORAGE_KEY.test(n) || !want.has(n)) throw new Error(`파일 묶음에 목록표에 없는 항목이 있습니다: ${n}`);
  }
  if (names.length !== want.size || new Set(names).size !== names.length) {
    throw new Error(`파일 묶음의 파일 수(${names.length})가 목록표(${want.size})와 다릅니다.`);
  }
  return m;
}

// 대상 DB 가 원본이 아니고 비어 있는지 확인한다.
async function checkTargetDb(databaseUrl, manifest) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const id = await dbIdentity(client);
      const src = manifest.source || {};
      const sameServer = id.server && src.server ? id.server === src.server : true;   // 알 수 없으면 같은 서버로 보고 더 조심한다
      if (sameServer && id.database === src.database && id.oid === src.oid) {
        throw new Error(`대상 DB(${id.database})가 백업한 원본 DB 입니다. 원본에는 복원하지 않습니다.`);
      }
      const { rows } = await client.query(
        `SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m','S','f')
            AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'
            AND n.nspname NOT LIKE 'pg\\_temp%'
          LIMIT 1`);
      if (rows.length) {
        throw new Error(`대상 DB(${id.database})가 비어 있지 않습니다 (${rows[0].nspname}.${rows[0].relname} 등). 복원은 빈 DB 에만 합니다.`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// 대상 파일 폴더가 없거나 비어 있는지 확인한다. 이미 있으면 true.
function checkTargetDir(filesDir) {
  if (!fs.existsSync(filesDir)) return false;
  if (!fs.statSync(filesDir).isDirectory()) throw new Error(`대상 파일 폴더 자리에 폴더가 아닌 것이 있습니다: ${filesDir}`);
  if (fs.readdirSync(filesDir).length) throw new Error(`대상 파일 폴더가 비어 있지 않습니다: ${filesDir}. 복원은 빈 폴더에만 합니다.`);
  return true;
}

export async function restore({ backupDir, databaseUrl, filesDir }) {
  if (!backupDir || !databaseUrl || !filesDir) throw new Error('백업 폴더, 대상 DATABASE_URL, 대상 파일 폴더가 모두 있어야 합니다.');
  backupDir = path.resolve(backupDir);
  filesDir = path.resolve(filesDir);

  // 1. 거부 조건. 여기까지는 아무것도 쓰지 않는다.
  const manifest = await checkBackup(backupDir);
  const dirExisted = checkTargetDir(filesDir);
  await checkTargetDb(databaseUrl, manifest);

  // 2. DB: 한 트랜잭션으로 넣는다. 실패하면 대상 DB 는 빈 채로 남는다.
  //    --no-owner/--no-acl: 원본의 계정 이름이 대상 서버에 없어도 되게, 복원하는 계정이 주인이 된다.
  const { dbArg, env } = pgToolArgs(databaseUrl);
  try {
    await run('pg_restore', ['--no-owner', '--no-acl', '--exit-on-error', '--single-transaction',
      dbArg, path.join(backupDir, 'db.dump')], { env });
  } catch (e) {
    throw new Error(`DB 를 복원하지 못했습니다 (대상 DB 는 그대로입니다): ${e.message}`);
  }

  // 3. 세션은 백업에 넣지 않았지만, 혹시 있더라도 비운다. 복원한 시스템에서는 모두 다시 로그인한다.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try { await pool.query('DELETE FROM sessions'); } finally { await pool.end(); }

  // 4. 파일 묶음을 푼다. 소유자·권한은 원본 것을 따르지 않는다.
  try {
    fs.mkdirSync(filesDir, { recursive: true });
    await run('tar', ['-xzf', path.join(backupDir, 'files.tar.gz'), '-C', filesDir, '--no-same-owner', '--no-same-permissions']);
  } catch (e) {
    if (!dirExisted) fs.rmSync(filesDir, { recursive: true, force: true });
    throw new Error(`DB 는 복원했지만 파일을 풀지 못했습니다. 대상 DB 를 지우고 다시 하세요: ${e.message}`);
  }

  // 5. 바로 대조한다
  const v = await verifyRestore({ backupDir, databaseUrl, filesDir });
  if (!v.ok) {
    const err = new Error(`복원 뒤 대조에서 다른 곳이 ${v.problems.length}개 있습니다:\n${v.problems.join('\n')}`);
    err.problems = v.problems;
    throw err;
  }
  return { manifest, problems: [] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [backupDir, databaseUrl, filesDir] = process.argv.slice(2);
  if (!backupDir || !databaseUrl || !filesDir) {
    console.error('사용법: node scripts/restore.js <백업 폴더> <대상 DATABASE_URL> <대상 파일 폴더>');
    process.exit(1);
  }
  try {
    const { manifest } = await restore({ backupDir, databaseUrl, filesDir });
    console.log(`복원하고 대조했습니다: ${manifest.created_at} 백업, 첨부 파일 ${manifest.files.length}개. 모두 다시 로그인해야 합니다.`);
  } catch (e) {
    console.error(`복원하지 못했습니다: ${e.message}`);
    process.exitCode = 1;
  }
}
