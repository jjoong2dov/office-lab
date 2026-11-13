import fs from 'node:fs';
import pg from 'pg';

// .env 를 읽는다 (별도 라이브러리 없이)
export function loadEnv(file = new URL('../.env', import.meta.url)) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL 이 없습니다. .env.example 을 .env 로 복사해 고치세요.');
  return new pg.Pool({ connectionString: url, max: 5 });
}

// 한 트랜잭션으로 묶어 실행한다. fn 이 오류를 던지면 전부 되돌리고 그 오류를 다시 던진다.
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
