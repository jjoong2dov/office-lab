import express from 'express';
import { verifyPassword, createSession, destroySession, requireLogin } from '../auth.js';
import { withTransaction } from '../db.js';
import { record } from '../audit.js';
import { layout, esc } from '../views.js';

export function homeRoutes(pool) {
  const r = express.Router();

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.send(loginPage(req, ''));
  });

  r.post('/login', async (req, res) => {
    const { username = '', password = '' } = req.body || {};
    const { rows } = await pool.query('SELECT id, password_hash, status FROM users WHERE username = $1', [username]);
    // 퇴사한 사람은 비밀번호가 맞아도 들여보내지 않는다. 응답은 비밀번호가 틀렸을 때와 같다 (퇴사 여부를 알려 주지 않는다).
    const ok = rows[0] && await verifyPassword(password, rows[0].password_hash) && rows[0].status === 'active';
    if (!ok) {
      // 실패 기록에는 누구인지 남기지 않는다 (적어 넣은 아이디도, 그 아이디가 실제로 있는지도).
      await record(pool, req, { action: 'login.fail', result: 'denied', actorId: null });
      return res.status(401).send(loginPage(req, '아이디 또는 비밀번호가 맞지 않습니다.', username));
    }
    // 세션을 만드는 것과 기록을 한 트랜잭션에 넣는다. 아직 req.user 가 없으므로 누구인지는 직접 준다.
    await withTransaction(pool, async (client) => {
      await createSession(client, res, rows[0].id);
      await record(client, req, { action: 'login.ok', resourceType: 'user', resourceId: rows[0].id, result: 'ok', actorId: rows[0].id });
    });
    res.redirect('/');
  });

  r.post('/logout', async (req, res) => {
    await destroySession(pool, req, res);
    res.redirect('/login');
  });

  r.get('/', requireLogin, async (req, res) => {
    // 소속 이력: 최근 것이 위로. 종료일(ends_on)은 그 부서에 더는 속하지 않는 첫날이다. 날짜는 DB 에서 글자로 받아 시간대에 흔들리지 않게 한다.
    const { rows: history } = await pool.query(
      `SELECT d.name AS department_name, a.title,
              to_char(a.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(a.ends_on, 'YYYY-MM-DD') AS ends_on
         FROM org_assignments a JOIN departments d ON d.id = a.department_id
        WHERE a.user_id = $1
        ORDER BY a.starts_on DESC, a.id DESC`, [req.user.id]);
    res.send(layout(req, {
      title: '홈', active: 'home',
      body: `<h1>홈</h1>
<p class="lead">${esc(req.user.displayName)} ${esc(req.user.title)}님, 안녕하세요.</p>
<div class="card"><h2>내 정보</h2>
<dl><dt>아이디</dt><dd>${esc(req.user.username)}</dd><dt>소속</dt><dd>${esc(req.user.departmentName)}</dd><dt>직급</dt><dd>${esc(req.user.title)}</dd></dl></div>
<h2>소속 이력</h2>
<table><thead><tr><th>부서</th><th>직급</th><th>시작일</th><th>종료일 <small>(이날부터 다른 소속)</small></th></tr></thead><tbody>
${history.map((a) => `<tr><td>${esc(a.department_name)}</td><td>${esc(a.title)}</td><td>${esc(a.starts_on)}</td>
<td>${a.ends_on === null ? '<span class="tag">현재</span>' : esc(a.ends_on)}</td></tr>`).join('\n')}
</tbody></table>`,
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
<p class="hint">예제 계정: kim, lee, park, jung, choi, han · 비밀번호 pass1234</p>
</form>`,
  });
}
