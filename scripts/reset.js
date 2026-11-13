// DB 를 비우고 처음부터 다시 만든다 (migrate + seed). 예제 전용 DB 에서만 쓴다.
import { fileURLToPath } from 'node:url';
import { loadEnv, createPool } from '../src/db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

export async function reset(pool) {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  await seed(pool);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv();
  const pool = createPool();
  await reset(pool);
  console.log('DB 를 처음 상태로 되돌렸습니다.');
  await pool.end();
}
