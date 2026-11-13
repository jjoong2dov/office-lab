import express from 'express';
import { verifyPassword, createSession, destroySession, requireLogin } from '../auth.js';
import { layout, esc } from '../views.js';

export function homeRoutes(pool) {
  const r = express.Router();

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.send(loginPage(req, ''));
  });

  r.post('/login', async (req, res) => {
    const { username = '', password = '' } = req.body || {};
    const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE username = $1', [username]);
    const ok = rows[0] && await verifyPassword(password, rows[0].password_hash);
    if (!ok) return res.status(401).send(loginPage(req, '아이디 또는 비밀번호가 맞지 않습니다.', username));
    await createSession(pool, res, rows[0].id);
    res.redirect('/');
  });

  r.post('/logout', async (req, res) => {
    await destroySession(pool, req, res);
    res.redirect('/login');
  });

  r.get('/', requireLogin, (req, res) => {
    res.send(layout(req, {
      title: '홈', active: 'home',
      body: `<h1>홈</h1>
<p class="lead">${esc(req.user.displayName)} ${esc(req.user.title)}님, 안녕하세요.</p>
<div class="card"><h2>내 정보</h2>
<dl><dt>아이디</dt><dd>${esc(req.user.username)}</dd><dt>소속</dt><dd>${esc(req.user.departmentName)}</dd><dt>직급</dt><dd>${esc(req.user.title)}</dd></dl></div>`,
    }));
  });

  return r;
}

function loginPage(req, error, username = '') {
  return layout(req, {
    title: '로그인',
    body: `<form class="login card" method="post" action="/login">
<h1>로그인</h1>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<label>아이디 <input name="username" value="${esc(username)}" autofocus required></label>
<label>비밀번호 <input name="password" type="password" required></label>
<button class="primary">로그인</button>
<p class="hint">예제 계정: kim, lee, park, jung, choi · 비밀번호 pass1234</p>
</form>`,
  });
}
