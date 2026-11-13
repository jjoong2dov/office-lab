// 확인 스크립트 공통: DB 를 처음 상태로 돌리고, 앱을 임시 포트에 띄우고, 사용자별로 요청을 보낸다.
import { loadEnv, createPool } from '../src/db.js';
import { createApp } from '../src/app.js';
import { reset } from '../scripts/reset.js';
import { PASSWORD } from '../scripts/seed.js';

export async function startLab() {
  loadEnv();
  const pool = createPool();
  await reset(pool);
  const server = await new Promise((ok) => {
    const s = createApp(pool).listen(0, '127.0.0.1', () => ok(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    pool, base,
    sql: (text, params) => pool.query(text, params).then((r) => r.rows),
    as: (username) => login(base, username),
    anon: () => new Client(base),
    async stop() { await new Promise((ok) => server.close(ok)); await pool.end(); },
  };
}

// 쿠키를 들고 다니는 아주 작은 클라이언트. 리다이렉트는 따라가지 않는다.
export class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }

  async get(path) {
    const res = await fetch(this.base + path, { headers: { cookie: this.cookie }, redirect: 'manual' });
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, text, location: res.headers.get('location'), headers: res.headers };
  }

  async post(path, fields = {}) {
    const body = new URLSearchParams({ _csrf: this.csrf, ...fields });
    const res = await fetch(this.base + path, {
      method: 'POST', body, redirect: 'manual',
      headers: { cookie: this.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) { const v = c.split(';')[0]; if (v.startsWith('sid=')) this.cookie = v; }
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  }
}

export async function login(base, username, password = PASSWORD) {
  const c = new Client(base);
  const res = await c.post('/login', { username, password });
  if (res.status !== 302) throw new Error(`${username} 로그인 실패 (${res.status})`);
  await c.get('/');           // CSRF 토큰을 받아 둔다
  return c;
}
