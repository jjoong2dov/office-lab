// 로그인, 세션, CSRF. 이 파일은 시작 코드에 들어 있는 기반이다.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'sid';
const SESSION_HOURS = 12;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, saltHex, keyHex] = String(stored).split('$');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export async function createSession(pool, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [sha256(token), userId, crypto.randomBytes(16).toString('hex'), SESSION_HOURS],
  );
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
}

export async function destroySession(pool, req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// 요청마다 쿠키 → 세션 → 사용자를 DB 에서 다시 읽는다.
// 퇴사한 사람(status 가 active 가 아님)은 세션 행이 남아 있어도 로그인한 사람으로 취급하지 않는다.
// 역할(roles)도 요청마다 다시 읽는다. 역할을 빼면 다시 로그인하지 않아도 다음 요청부터 바로 막힌다.
export function loadUser(pool) {
  return async (req, res, next) => {
    req.user = null;
    req.csrf = null;
    const token = readCookie(req, COOKIE);
    if (token) {
      const { rows } = await pool.query(
        `SELECT u.id, u.username, u.display_name, u.title, u.department_id,
                d.name AS department_name, s.csrf_token,
                ARRAY(SELECT role FROM user_roles WHERE user_id = u.id ORDER BY role) AS roles
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           JOIN departments d ON d.id = u.department_id
          WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
        [sha256(token)],
      );
      if (rows[0]) {
        const r = rows[0];
        req.user = {
          id: Number(r.id), username: r.username, displayName: r.display_name, title: r.title,
          departmentId: Number(r.department_id), departmentName: r.department_name,
          roles: r.roles,
        };
        req.csrf = r.csrf_token;
      }
    }
    next();
  };
}

export function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

export const CSRF_MESSAGE = '요청을 확인할 수 없습니다. 화면을 새로 고친 뒤 다시 시도하세요.';

// 요청에 실려 온 토큰이 세션의 토큰과 같은가.
export function csrfOk(req) {
  const sent = req.body?._csrf || req.headers['x-csrf-token'];
  return Boolean(sent && req.csrf && sent === req.csrf);
}

export const isMultipart = (req) => /^multipart\//i.test(req.headers['content-type'] || '');

// 로그인한 사용자의 POST 는 화면에 심어 둔 토큰이 같이 와야 한다.
// multipart 요청은 본문을 읽기 전에는 _csrf 를 알 수 없어서 여기서는 건너뛴다.
// 건너뛴 요청은 그 경로가 본문을 읽은 뒤에 csrfOk() 로 같은 검사를 해야 한다 (app.js 가 그런 경로만 통과시킨다).
export function checkCsrf(req, res, next) {
  if (req.method !== 'POST' || !req.user) return next();
  if (isMultipart(req)) return next();
  if (!csrfOk(req)) return res.status(403).send(CSRF_MESSAGE);
  next();
}
