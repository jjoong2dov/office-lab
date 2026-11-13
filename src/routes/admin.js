// 관리 화면: 직원 목록, 부서 이동, 퇴사 처리.
// 모든 경로가 서버에서 canManageUsers() 를 거친다. 아니면 없는 주소와 같은 404 로 답한다.
// 여기서 주는 것은 계정·조직 관리뿐이다. 게시판 열람은 여전히 canReadBoard 가 정한다.
import express from 'express';
import { requireLogin } from '../auth.js';
import { canManageUsers } from '../policy.js';
import { transferUser, offboardUser } from '../org.js';
import { layout, esc, csrfField, notFound } from '../views.js';

const TITLE_MAX = 50;
const ROLE_LABELS = { system_admin: '시스템 관리자' };

// 주소의 id 는 숫자만 받는다. 아니면 null (→ 404).
const parseId = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null);
const len = (s) => [...s].length;
const statusTag = (status) => (status === 'left' ? '<span class="tag gray">퇴사</span>' : '<span class="tag">재직</span>');
const roleTags = (roles) => roles.map((r) => `<span class="tag amber">${esc(ROLE_LABELS[r] || r)}</span>`).join(' ');

export function adminRoutes(pool) {
  const r = express.Router();

  // /admin 아래는 전부 여기서 먼저 걸러진다. 로그인하지 않았으면 로그인 화면으로, 관리자가 아니면 404.
  r.use('/admin', requireLogin, (req, res, next) => (canManageUsers(req.user) ? next() : notFound(req, res)));

  // 한 사람과 화면에 필요한 것(소속 이력, 부서 목록)을 읽는다. 없으면 null.
  async function findUser(rawId) {
    const id = parseId(rawId);
    if (id === null) return null;
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.title, u.status, u.department_id, d.name AS department_name,
              to_char(u.left_on, 'YYYY-MM-DD') AS left_on,
              ARRAY(SELECT role FROM user_roles WHERE user_id = u.id ORDER BY role) AS roles
         FROM users u JOIN departments d ON d.id = u.department_id
        WHERE u.id = $1`, [id]);
    return rows[0] || null;
  }

  async function userPage(req, user, { error = '', form = {} } = {}) {
    // 소속 이력: 최근 것이 위로. 날짜는 DB 에서 글자로 받아 시간대에 흔들리지 않게 한다.
    const { rows: history } = await pool.query(
      `SELECT d.name AS department_name, a.title,
              to_char(a.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(a.ends_on, 'YYYY-MM-DD') AS ends_on
         FROM org_assignments a JOIN departments d ON d.id = a.department_id
        WHERE a.user_id = $1
        ORDER BY a.starts_on DESC, a.id DESC`, [user.id]);
    const { rows: depts } = await pool.query('SELECT id, name FROM departments ORDER BY id');
    const active = user.status === 'active';
    const isMe = Number(user.id) === req.user.id;
    const deptId = String(form.department_id ?? user.department_id);
    const title = form.title ?? user.title;
    return layout(req, {
      title: `${user.display_name} · 관리`, active: 'admin',
      body: `<p class="meta"><a href="/admin/users">직원 목록</a></p>
<h1>${esc(user.display_name)} ${esc(user.title)}</h1>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<div class="card"><h2>계정</h2>
<dl><dt>아이디</dt><dd>${esc(user.username)}</dd><dt>소속</dt><dd>${esc(user.department_name)}</dd><dt>직급</dt><dd>${esc(user.title)}</dd>
<dt>상태</dt><dd>${statusTag(user.status)}${user.left_on ? ` <span class="meta">${esc(user.left_on)} 부터 직원이 아님</span>` : ''}</dd>
<dt>역할</dt><dd>${user.roles.length ? roleTags(user.roles) : '<span class="meta">없음</span>'}</dd></dl></div>
<h2>소속 이력</h2>
<table><thead><tr><th>부서</th><th>직급</th><th>시작일</th><th>종료일 <small>(이날부터 다른 소속)</small></th></tr></thead><tbody>
${history.map((a) => `<tr><td>${esc(a.department_name)}</td><td>${esc(a.title)}</td><td>${esc(a.starts_on)}</td>
<td>${a.ends_on === null ? '<span class="tag">현재</span>' : esc(a.ends_on)}</td></tr>`).join('\n')}
</tbody></table>
${active ? `<form class="card" method="post" action="/admin/users/${user.id}/transfer">
${csrfField(req)}
<h2>부서 이동</h2>
<p class="meta">오늘 날짜로 옮긴다. 지난 글에 남은 소속은 바뀌지 않는다.</p>
<label>부서 <select name="department_id" required>
${depts.map((d) => `<option value="${d.id}"${String(d.id) === deptId ? ' selected' : ''}>${esc(d.name)}</option>`).join('\n')}
</select></label>
<label>직급 <input name="title" value="${esc(title)}" maxlength="${TITLE_MAX}"></label>
<button class="primary">옮기기</button>
</form>
<div class="card"><h2>퇴사 처리</h2>
${isMe ? '<p class="notice">자기 자신은 퇴사 처리할 수 없습니다. 다른 시스템 관리자에게 맡기세요.</p>'
    : `<p class="meta">로그인을 막고 열려 있는 로그인도 끊는다. 계정과 쓴 글은 남는다. 되돌리는 화면은 없다.</p>
<form class="inline" method="post" action="/admin/users/${user.id}/offboard">
${csrfField(req)}
<button class="danger">퇴사 처리</button>
</form>`}</div>` : '<p class="notice">퇴사한 사람입니다. 부서 이동과 퇴사 처리를 할 수 없습니다.</p>'}`,
    });
  }

  // org.js 가 던진 업무 오류(문구가 있는 Error)는 400 으로 화면에 보여 준다. DB 오류(code 가 있다)는 그대로 500 으로 넘긴다.
  async function fail(req, res, user, e, form) {
    if (e.code) throw e;
    const fresh = (await findUser(user.id)) || user;
    res.status(400).send(await userPage(req, fresh, { error: e.message, form }));
  }

  // 직원 목록. 퇴사한 사람도 함께 보여 준다.
  r.get('/admin/users', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.title, u.status, d.name AS department_name,
              ARRAY(SELECT role FROM user_roles WHERE user_id = u.id ORDER BY role) AS roles
         FROM users u JOIN departments d ON d.id = u.department_id
        ORDER BY u.status = 'left', d.id, u.id`);
    res.send(layout(req, {
      title: '관리', active: 'admin',
      body: `<h1>직원 관리</h1>
<p class="lead">부서 이동과 퇴사 처리를 한다. 이 화면을 쓸 수 있다고 다른 부서의 글이 보이지는 않는다.</p>
<table><thead><tr><th>이름</th><th>아이디</th><th>부서</th><th>직급</th><th>상태</th><th>역할</th></tr></thead><tbody>
${rows.map((u) => `<tr><td><a href="/admin/users/${u.id}">${esc(u.display_name)}</a></td><td>${esc(u.username)}</td>
<td>${esc(u.department_name)}</td><td>${esc(u.title)}</td><td>${statusTag(u.status)}</td><td>${roleTags(u.roles)}</td></tr>`).join('\n')}
</tbody></table>`,
    }));
  });

  // 한 사람: 소속 이력, 부서 이동 폼, 퇴사 처리 버튼
  r.get('/admin/users/:id', async (req, res) => {
    const user = await findUser(req.params.id);
    if (!user) return notFound(req, res);
    res.send(await userPage(req, user));
  });

  // 부서 이동. 직급 칸을 비우면 직급은 그대로 둔다.
  r.post('/admin/users/:id/transfer', async (req, res) => {
    const user = await findUser(req.params.id);
    if (!user) return notFound(req, res);
    const form = { department_id: String(req.body?.department_id ?? '').trim(), title: String(req.body?.title ?? '').trim() };
    try {
      const departmentId = parseId(form.department_id);
      if (departmentId === null) throw new Error('부서를 골라 주세요.');
      if (len(form.title) > TITLE_MAX) throw new Error(`직급은 ${TITLE_MAX}자까지 적을 수 있습니다.`);
      await transferUser(pool, { userId: user.id, departmentId, title: form.title === '' ? undefined : form.title });
    } catch (e) {
      return fail(req, res, user, e, form);
    }
    res.redirect(`/admin/users/${user.id}`);
  });

  // 퇴사 처리. 자기 자신은 할 수 없다 — 이 화면을 쓰는 사람은 늘 남으므로 관리자가 한 명도 없게 되지 않는다.
  r.post('/admin/users/:id/offboard', async (req, res) => {
    const user = await findUser(req.params.id);
    if (!user) return notFound(req, res);
    try {
      if (Number(user.id) === req.user.id) throw new Error('자기 자신은 퇴사 처리할 수 없습니다.');
      await offboardUser(pool, { userId: user.id });
    } catch (e) {
      return fail(req, res, user, e);
    }
    res.redirect(`/admin/users/${user.id}`);
  });

  return r;
}
