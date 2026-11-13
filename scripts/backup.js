// 백업: node scripts/backup.js [백업을 둘 폴더]   (기본 .data/backups)
// 한 벌 = <폴더>/<시각>/ 아래 db.dump(pg_dump -Fc) + files.tar.gz(첨부 파일) + manifest.json(목록표).
//
// DB 와 파일은 같은 시점의 것이어야 한다. 그래서
//  - DB 스냅숏 하나를 열어 두고(pg_export_snapshot), pg_dump 와 목록표의 행 수·첨부 목록을 모두 그 스냅숏에서 읽는다.
//  - 파일 묶음에는 그 스냅숏의 attachments 행이 가리키는 파일만 넣는다. 백업 도중 새로 올라온 파일은 다음 백업에 들어간다.
//    (파일은 디스크에 먼저 쓰고 행을 나중에 넣으므로, 스냅숏에 있는 행의 파일은 이미 디스크에 있다.)
// 세션(sessions)은 표 구조만 넣고 내용은 넣지 않는다. 복원한 시스템에서는 모두 다시 로그인한다.
// 다 만든 뒤에야 폴더 이름을 <시각> 으로 바꾼다. 중간에 실패하면 .partial 폴더를 지우고 오류를 낸다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/db.js';
import {
  MANIFEST_VERSION, STORAGE_KEY, pgToolArgs, run, sha256File, fixSessionFormat, tableStats, migrationNames,
} from './backup-common.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// DB 를 알아보는 값: 서버 고유 번호(system_identifier, 볼 권한이 없으면 null) + DB 이름 + DB 의 oid.
export async function dbIdentity(client) {
  const db = (await client.query(
    'SELECT current_database() AS database, (SELECT oid FROM pg_database WHERE datname = current_database())::text AS oid')).rows[0];
  let server = null;
  try { server = (await client.query('SELECT system_identifier::text AS s FROM pg_control_system()')).rows[0].s; } catch { /* 권한 없음 */ }
  return { server, database: db.database, oid: db.oid };
}

export async function backup({ databaseUrl, filesDir, outDir }) {
  if (!databaseUrl) throw new Error('DATABASE_URL 이 없습니다.');
  filesDir = path.resolve(root, filesDir || process.env.FILES_DIR || '.data/files');
  outDir = path.resolve(root, outDir || '.data/backups');

  const createdAt = new Date();
  const stamp = createdAt.toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(outDir, { recursive: true });
  const finalDir = path.join(outDir, stamp);
  if (fs.existsSync(finalDir)) throw new Error(`이미 있는 백업 폴더입니다: ${finalDir}`);
  const work = path.join(outDir, `${stamp}.partial`);
  fs.mkdirSync(work);

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    // 0. 원본이 어느 DB 인지 적어 둔다. 복원할 때 원본에 덮어쓰지 않도록 비교한다.
    const source = await dbIdentity(client);

    // 1. 스냅숏을 열고, 같은 스냅숏으로 pg_dump 를 돌린다
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS s')).rows[0].s;
    const { dbArg, env } = pgToolArgs(databaseUrl);
    await run('pg_dump', ['-Fc', `--snapshot=${snapshot}`, '--exclude-table-data=sessions',
      '-f', path.join(work, 'db.dump'), dbArg], { env });

    // 2. 같은 스냅숏에서 목록표에 쓸 것을 읽는다
    await fixSessionFormat(client);
    const migrations = await migrationNames(client);
    const tables = await tableStats(client);
    const atts = (await client.query(
      'SELECT storage_key::text AS key, size_bytes FROM attachments ORDER BY storage_key')).rows;
    await client.query('COMMIT');

    // 3. 첨부 파일: 행마다 파일이 있어야 하고 크기가 맞아야 한다. 원본이 이미 어긋나 있으면 백업하지 않는다.
    const files = [];
    for (const a of atts) {
      if (!STORAGE_KEY.test(a.key)) throw new Error(`저장 이름이 UUID 가 아닌 첨부가 있습니다: ${a.key}`);
      const file = path.join(filesDir, a.key);
      let st;
      try { st = fs.statSync(file); } catch { throw new Error(`첨부 파일이 디스크에 없습니다: ${a.key}`); }
      if (!st.isFile()) throw new Error(`첨부 파일이 일반 파일이 아닙니다: ${a.key}`);
      if (st.size !== Number(a.size_bytes)) {
        throw new Error(`첨부 파일 크기가 DB 와 다릅니다: ${a.key} (DB ${a.size_bytes}, 디스크 ${st.size})`);
      }
      files.push({ storage_key: a.key, size: st.size, sha256: await sha256File(file) });
    }

    // 4. 파일 묶음: 위 목록에 있는 파일만 넣는다
    const list = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'office-lab-backup-list-')), 'files.txt');
    try {
      fs.writeFileSync(list, files.map((f) => `${f.storage_key}\n`).join(''));
      await run('tar', ['-czf', path.join(work, 'files.tar.gz'), '-C', filesDir, '--no-recursion', '-T', list]);
    } finally {
      fs.rmSync(path.dirname(list), { recursive: true, force: true });
    }

    // 5. 목록표. 묶음 두 개의 sha256 도 적어 두고, 복원할 때 먼저 확인한다.
    const manifest = {
      version: MANIFEST_VERSION,
      created_at: createdAt.toISOString(),
      source,
      migrations,
      tables,
      files,
      archives: {
        'db.dump': await sha256File(path.join(work, 'db.dump')),
        'files.tar.gz': await sha256File(path.join(work, 'files.tar.gz')),
      },
    };
    fs.writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.renameSync(work, finalDir);
    return finalDir;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv();
  try {
    const dir = await backup({ databaseUrl: process.env.DATABASE_URL, filesDir: process.env.FILES_DIR, outDir: process.argv[2] && path.resolve(process.argv[2]) });
    console.log(dir);
  } catch (e) {
    console.error(`백업하지 못했습니다: ${e.message}`);
    process.exitCode = 1;
  }
}
