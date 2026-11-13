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
