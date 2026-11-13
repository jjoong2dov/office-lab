// 백업·복원·대조가 같이 쓰는 것: pg 도구 실행, 표 목록과 행 수·내용 지문, 파일 sha256.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

// 백업 목록표(manifest)의 형식 번호. 형식을 바꾸면 올린다.
export const MANIFEST_VERSION = 1;

// 행 수·내용을 남기지 않는 표: migration 기록(따로 목록으로 남긴다)과 로그인 세션(백업하지 않는다).
export const SKIP_TABLES = ['schema_migrations', 'sessions'];

// 첨부 파일의 디스크 이름은 서버가 만든 UUID 뿐이다. 이 모양이 아니면 백업·복원에서 다루지 않는다.
export const STORAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// pg_dump·pg_restore 에 넘길 접속 정보. 비밀번호는 명령줄(다른 사람도 ps 로 볼 수 있다)에 싣지 않고 환경 변수로 넘긴다.
export function pgToolArgs(databaseUrl) {
  const u = new URL(databaseUrl);
  const env = { ...process.env };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  u.password = '';
  return { dbArg: `--dbname=${u.toString()}`, env };
}

// 외부 명령을 돌린다. 실패하면 stderr 를 붙여 오류를 던진다.
export function run(cmd, args, { env, cwd } = {}) {
  return new Promise((ok, fail) => {
    let child;
    try {
      child = spawn(cmd, args, { env: env || process.env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { fail(e); return; }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => fail(new Error(`${cmd} 를 실행하지 못했습니다: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) ok(out);
      else fail(new Error(`${cmd} 실패 (종료 코드 ${code}): ${err.trim()}`));
    });
  });
}

export function sha256File(file) {
  return new Promise((ok, fail) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', fail).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex')));
  });
}

// 내용 지문을 어느 서버·세션에서 계산해도 같게: 시간대·날짜 모양·실수 자릿수를 고정한다.
export async function fixSessionFormat(client) {
  await client.query(`SET TimeZone = 'UTC'; SET DateStyle = 'ISO, YMD'; SET IntervalStyle = 'postgres'; SET extra_float_digits = 1`);
}

// public 의 표마다 행 수와 내용 지문(md5). SKIP_TABLES 는 뺀다.
// 지문은 행을 글자로 바꿔 정렬(C 정렬)한 뒤 이어 붙인 것의 md5 다. 행 수가 같아도 내용이 바뀌면 다르게 나온다.
export async function tableStats(client) {
  const { rows } = await client.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE "C"`);
  const out = {};
  for (const { name } of rows) {
    if (SKIP_TABLES.includes(name)) continue;
    const q = `"${name.replace(/"/g, '""')}"`;
    const r = (await client.query(
      `SELECT count(*) AS n, coalesce(md5(string_agg(t::text, E'\\n' ORDER BY t::text COLLATE "C")), '') AS digest FROM ${q} t`)).rows[0];
    out[name] = { rows: Number(r.n), md5: r.digest };
  }
  return out;
}

export async function migrationNames(client) {
  const { rows } = await client.query(
    `SELECT name FROM schema_migrations ORDER BY name COLLATE "C"`);
  return rows.map((r) => r.name);
}
