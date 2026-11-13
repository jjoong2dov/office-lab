// 부서 게시판. 여섯 경로 모두 서버에서 canReadBoard() 를 거친다. (첨부 올리기·내려받기는 routes/files.js)
// 글 목록·내보내기·글 저장·글 상세는 허용된 것도 거부된 것도 기록한다 (audit.js). 기록에 제목·본문은 넣지 않는다.
import express from 'express';
import { requireLogin } from '../auth.js';
import { canReadBoard, canAttachToPost } from '../policy.js';
import { withTransaction } from '../db.js';
import { record } from '../audit.js';
import { layout, esc, fmtDate, fmtSize, csrfField, notFound } from '../views.js';
import { contentDisposition, FILE_MAX_BYTES } from './files.js';

const TITLE_MAX = 200;
const BODY_MAX = 20000;

// 주소의 id 는 숫자만 받는다. 아니면 null (→ 404).
const parseId = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null);
// 글자 수는 DB 의 char_length 와 같게 센다.
const len = (s) => [...s].length;
// 작성자 이름 옆에 붙이는 딱지. 퇴사한 사람의 글도 그대로 보여 주되 퇴사했음을 표시한다.
const leftTag = (status) => (status === 'left' ? ' <span class="tag gray">퇴사</span>' : '');

// CSV 한 칸. 엑셀에서 수식으로 읽히지 않게 =, +, -, @ 로 시작하는 값은 앞에 ' 를 붙이고,
// 쉼표·따옴표·줄바꿈이 있으면 큰따옴표로 감싼다.
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function boardRoutes(pool) {
  const r = express.Router();

  // 볼 수 있는 게시판만 돌려준다. 없거나 볼 수 없으면 null — 둘을 구분하지 않는다.
  // deniedAction 을 주면, 게시판이 실제로 있는데 볼 수 없을 때 그 이름으로 거부를 기록한다 (없는 게시판은 기록하지 않는다).
  async function findBoard(req, rawId, deniedAction) {
    const id = parseId(rawId);
    if (id === null) return null;
    const { rows } = await pool.query('SELECT id, name, department_id FROM boards WHERE id = $1', [id]);
    const board = rows[0];
    if (!board) return null;
    if (canReadBoard(req.user, board)) return board;
    if (deniedAction) {
      await record(pool, req, { action: deniedAction, resourceType: 'board', resourceId: board.id, result: 'denied' });
    }
    return null;
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
    const board = await findBoard(req, req.params.id, 'board.read');
    if (!board) return notFound(req, res);
    await record(pool, req, { action: 'board.read', resourceType: 'board', resourceId: board.id, result: 'ok' });
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.created_at, u.display_name, u.status AS author_status, p.author_title, p.author_department_name
         FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.board_id = $1
        ORDER BY p.created_at DESC, p.id DESC`, [board.id]);
    res.send(layout(req, {
      title: board.name, active: 'boards',
      body: `<div class="bar"><h1>${esc(board.name)}</h1><div class="row"><a class="btn ghost" href="/boards/${board.id}/export.csv">CSV 내보내기</a><a class="btn" href="/boards/${board.id}/new">글쓰기</a></div></div>
${rows.length ? `<table><thead><tr><th>제목</th><th>작성자</th><th>소속</th><th>날짜</th></tr></thead><tbody>
${rows.map((p) => `<tr><td><a href="/posts/${p.id}">${esc(p.title)}</a></td><td>${esc(p.display_name)} ${esc(p.author_title)}${leftTag(p.author_status)}</td>
<td>${esc(p.author_department_name)}</td><td class="meta">${esc(fmtDate(p.created_at))}</td></tr>`).join('\n')}
</tbody></table>` : '<div class="card"><p class="meta">아직 글이 없습니다.</p></div>'}
<p><a href="/boards">← 게시판 목록</a></p>`,
    }));
  });

  // 글 목록을 CSV 로 내보낸다. 목록 화면과 같은 권한(findBoard)을 거친다 — 볼 수 없는 게시판은 404.
  // 날짜는 DB 에서 한국 시간 글자로 받는다. 맨 앞의 BOM 은 엑셀이 한글을 UTF-8 로 읽게 한다.
  r.get('/boards/:id/export.csv', requireLogin, async (req, res) => {
    const board = await findBoard(req, req.params.id, 'board.export');
    if (!board) return notFound(req, res);
    await record(pool, req, { action: 'board.export', resourceType: 'board', resourceId: board.id, result: 'ok' });
    const { rows } = await pool.query(
      `SELECT p.id, p.title, u.display_name, p.author_title, p.author_department_name,
              to_char(p.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS created_at
         FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.board_id = $1
        ORDER BY p.created_at DESC, p.id DESC`, [board.id]);
    const lines = [['번호', '제목', '작성자', '소속', '날짜'],
      ...rows.map((p) => [p.id, p.title, `${p.display_name} ${p.author_title}`.trim(), p.author_department_name, p.created_at])];
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(`${board.name}.csv`),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(`\ufeff${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`);
  });

  // 글쓰기 화면
  r.get('/boards/:id/new', requireLogin, async (req, res) => {
    const board = await findBoard(req, req.params.id);
    if (!board) return notFound(req, res);
    res.send(writePage(req, board));
  });

  // 글 저장. 권한을 먼저 보고, 그다음에 입력을 본다 (볼 수 없는 게시판은 입력이 어떻든 404).
  r.post('/boards/:id/posts', requireLogin, async (req, res) => {
    const board = await findBoard(req, req.params.id, 'post.create');
    if (!board) return notFound(req, res);
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '').replace(/\r\n/g, '\n').trim();
    let error = '';
    if (len(title) < 1 || len(title) > TITLE_MAX) error = `제목은 1~${TITLE_MAX}자로 적어 주세요.`;
    else if (len(body) < 1 || len(body) > BODY_MAX) error = `본문은 1~${BODY_MAX}자로 적어 주세요.`;
    if (error) return res.status(400).send(writePage(req, board, { error, title, body }));
    // 소속·직급은 저장하는 순간의 값을 글에 남긴다. 나중에 부서를 옮겨도 이 값은 바뀌지 않는다.
    // 글과 기록을 한 트랜잭션에 넣는다. 글 저장이 되돌려지면 기록도 남지 않는다.
    const postId = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO posts(board_id, author_id, title, body, author_department_name, author_title)
         SELECT $1, u.id, $3, $4, d.name, u.title
           FROM users u JOIN departments d ON d.id = u.department_id
          WHERE u.id = $2
         RETURNING id`,
        [board.id, req.user.id, title, body]);
      await record(client, req, { action: 'post.create', resourceType: 'post', resourceId: rows[0].id, result: 'ok' });
      return rows[0].id;
    });
    res.redirect(`/posts/${postId}`);
  });

  // 글 상세. 없는 글과 볼 수 없는 글은 같은 404 로 답한다.
  r.get('/posts/:id', requireLogin, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return notFound(req, res);
    const { rows } = await pool.query(
      `SELECT p.id, p.author_id, p.title, p.body, p.created_at, u.display_name, u.status AS author_status, p.author_title,
              p.author_department_name, b.id AS board_id, b.name AS board_name, b.department_id
         FROM posts p JOIN boards b ON b.id = p.board_id
         JOIN users u ON u.id = p.author_id
        WHERE p.id = $1`, [id]);
    const p = rows[0];
    if (!p) return notFound(req, res);
    // 글이 실제로 있는데 볼 수 없을 때만 거부로 기록한다. 응답은 없는 글과 똑같은 404 다.
    if (!canReadBoard(req.user, { id: p.board_id, department_id: p.department_id })) {
      await record(pool, req, { action: 'post.read', resourceType: 'post', resourceId: p.id, result: 'denied' });
      return notFound(req, res);
    }
    await record(pool, req, { action: 'post.read', resourceType: 'post', resourceId: p.id, result: 'ok' });
    // 첨부 목록. 내려받기 주소는 첨부 번호로만 만든다 (저장 이름은 화면에 내보내지 않는다).
    const { rows: files } = await pool.query(
      'SELECT id, original_name, size_bytes FROM attachments WHERE post_id = $1 ORDER BY id', [p.id]);
    res.send(layout(req, {
      title: p.title, active: 'boards',
      body: `<p class="meta"><a href="/boards/${p.board_id}">${esc(p.board_name)}</a></p>
<h1>${esc(p.title)}</h1>
<p class="meta">${esc(p.display_name)} ${esc(p.author_title)}${leftTag(p.author_status)} · <span class="tag">${esc(p.author_department_name)}</span> · ${esc(fmtDate(p.created_at))}</p>
<div class="card post-body">${esc(p.body)}</div>
<div class="card"><h2>첨부 파일</h2>
${files.length ? `<table><thead><tr><th>이름</th><th>크기</th><th>내려받기</th></tr></thead><tbody>
${files.map((f) => `<tr><td>${esc(f.original_name)}</td><td class="meta">${esc(fmtSize(f.size_bytes))}</td>
<td><a href="/attachments/${f.id}/download">내려받기</a></td></tr>`).join('\n')}
</tbody></table>` : '<p class="meta">첨부 파일이 없습니다.</p>'}
${canAttachToPost(req.user, p) ? `<form method="post" action="/posts/${p.id}/attachments" enctype="multipart/form-data">
${csrfField(req)}
<label>파일 올리기 <input type="file" name="file" required></label>
<p class="hint">한 번에 파일 하나, ${FILE_MAX_BYTES / 1024 / 1024}MB 까지 올릴 수 있습니다.</p>
<div class="row"><button class="primary">올리기</button></div>
</form>` : ''}
</div>
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
