// 부서 게시판. 다섯 경로 모두 서버에서 canReadBoard() 를 거친다.
import express from 'express';
import { requireLogin } from '../auth.js';
import { canReadBoard } from '../policy.js';
import { layout, esc, fmtDate, csrfField, notFound } from '../views.js';

const TITLE_MAX = 200;
const BODY_MAX = 20000;

// 주소의 id 는 숫자만 받는다. 아니면 null (→ 404).
const parseId = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null);
// 글자 수는 DB 의 char_length 와 같게 센다.
const len = (s) => [...s].length;

export function boardRoutes(pool) {
  const r = express.Router();

  // 볼 수 있는 게시판만 돌려준다. 없거나 볼 수 없으면 null — 둘을 구분하지 않는다.
  async function findBoard(user, rawId) {
    const id = parseId(rawId);
    if (id === null) return null;
    const { rows } = await pool.query('SELECT id, name, department_id FROM boards WHERE id = $1', [id]);
    return rows[0] && canReadBoard(user, rows[0]) ? rows[0] : null;
  }

  // 내가 볼 수 있는 게시판 목록
  r.get('/boards', requireLogin, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT b.id, b.name, b.department_id, d.name AS department_name,
              (SELECT count(*) FROM posts p WHERE p.board_id = b.id) AS post_count
         FROM boards b LEFT JOIN departments d ON d.id = b.department_id
        ORDER BY b.department_id IS NOT NULL, b.id`);
    const boards = rows.filter((b) => canReadBoard(req.user, b));
    res.send(layout(req, {
      title: '게시판', active: 'boards',
      body: `<h1>게시판</h1>
<table><thead><tr><th>게시판</th><th>대상</th><th>글</th></tr></thead><tbody>
${boards.map((b) => `<tr><td><a href="/boards/${b.id}">${esc(b.name)}</a></td>
<td>${b.department_id === null ? '<span class="tag gray">전 직원</span>' : `<span class="tag">${esc(b.department_name)}</span>`}</td>
<td>${esc(b.post_count)}</td></tr>`).join('\n')}
</tbody></table>`,
    }));
  });

  // 글 목록. 작성자 소속·직급은 글에 남긴 값(쓴 당시)으로 보여 준다.
  r.get('/boards/:id', requireLogin, async (req, res) => {
    const board = await findBoard(req.user, req.params.id);
    if (!board) return notFound(req, res);
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.created_at, u.display_name, p.author_title, p.author_department_name
         FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.board_id = $1
        ORDER BY p.created_at DESC, p.id DESC`, [board.id]);
    res.send(layout(req, {
      title: board.name, active: 'boards',
      body: `<div class="bar"><h1>${esc(board.name)}</h1><a class="btn" href="/boards/${board.id}/new">글쓰기</a></div>
${rows.length ? `<table><thead><tr><th>제목</th><th>작성자</th><th>소속</th><th>날짜</th></tr></thead><tbody>
${rows.map((p) => `<tr><td><a href="/posts/${p.id}">${esc(p.title)}</a></td><td>${esc(p.display_name)} ${esc(p.author_title)}</td>
<td>${esc(p.author_department_name)}</td><td class="meta">${esc(fmtDate(p.created_at))}</td></tr>`).join('\n')}
</tbody></table>` : '<div class="card"><p class="meta">아직 글이 없습니다.</p></div>'}
<p><a href="/boards">← 게시판 목록</a></p>`,
    }));
  });

  // 글쓰기 화면
  r.get('/boards/:id/new', requireLogin, async (req, res) => {
    const board = await findBoard(req.user, req.params.id);
    if (!board) return notFound(req, res);
    res.send(writePage(req, board));
  });

  // 글 저장. 권한을 먼저 보고, 그다음에 입력을 본다 (볼 수 없는 게시판은 입력이 어떻든 404).
  r.post('/boards/:id/posts', requireLogin, async (req, res) => {
    const board = await findBoard(req.user, req.params.id);
    if (!board) return notFound(req, res);
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '').replace(/\r\n/g, '\n').trim();
    let error = '';
    if (len(title) < 1 || len(title) > TITLE_MAX) error = `제목은 1~${TITLE_MAX}자로 적어 주세요.`;
    else if (len(body) < 1 || len(body) > BODY_MAX) error = `본문은 1~${BODY_MAX}자로 적어 주세요.`;
    if (error) return res.status(400).send(writePage(req, board, { error, title, body }));
    // 소속·직급은 저장하는 순간의 값을 글에 남긴다. 나중에 부서를 옮겨도 이 값은 바뀌지 않는다.
    const { rows } = await pool.query(
      `INSERT INTO posts(board_id, author_id, title, body, author_department_name, author_title)
       SELECT $1, u.id, $3, $4, d.name, u.title
         FROM users u JOIN departments d ON d.id = u.department_id
        WHERE u.id = $2
       RETURNING id`,
      [board.id, req.user.id, title, body]);
    res.redirect(`/posts/${rows[0].id}`);
  });

  // 글 상세. 없는 글과 볼 수 없는 글은 같은 404 로 답한다.
  r.get('/posts/:id', requireLogin, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return notFound(req, res);
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.body, p.created_at, u.display_name, p.author_title,
              p.author_department_name, b.id AS board_id, b.name AS board_name, b.department_id
         FROM posts p JOIN boards b ON b.id = p.board_id
         JOIN users u ON u.id = p.author_id
        WHERE p.id = $1`, [id]);
    const p = rows[0];
    if (!p || !canReadBoard(req.user, { id: p.board_id, department_id: p.department_id })) return notFound(req, res);
    res.send(layout(req, {
      title: p.title, active: 'boards',
      body: `<p class="meta"><a href="/boards/${p.board_id}">${esc(p.board_name)}</a></p>
<h1>${esc(p.title)}</h1>
<p class="meta">${esc(p.display_name)} ${esc(p.author_title)} · <span class="tag">${esc(p.author_department_name)}</span> · ${esc(fmtDate(p.created_at))}</p>
<div class="card post-body">${esc(p.body)}</div>
<p><a class="btn ghost" href="/boards/${p.board_id}">목록으로</a></p>`,
    }));
  });

  return r;
}

function writePage(req, board, { error = '', title = '', body = '' } = {}) {
  return layout(req, {
    title: `글쓰기 · ${board.name}`, active: 'boards',
    body: `<h1>글쓰기</h1>
<p class="lead">${esc(board.name)}</p>
<form class="card" method="post" action="/boards/${board.id}/posts">
${csrfField(req)}
${error ? `<p class="error">${esc(error)}</p>` : ''}
<label>제목 <input name="title" value="${esc(title)}" maxlength="${TITLE_MAX}" required autofocus></label>
<label>본문 <textarea name="body" maxlength="${BODY_MAX}" required>${esc(body)}</textarea></label>
<div class="row"><button class="primary">저장</button><a class="btn ghost" href="/boards/${board.id}">취소</a></div>
</form>`,
  });
}
