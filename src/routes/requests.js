// 승인 요청. 직원이 요청을 올리고, 지정한 승인자 한 명이 승인하거나 반려한다. 올린 사람은 대기 중일 때 취소할 수 있다.
// 볼 수 있는지·처리할 수 있는지는 policy.js 의 canReadRequest / canDecideRequest / canCancelRequest 만 부른다.
// 순서: 로그인 → 요청이 있나·볼 수 있나(404) → 그 행동을 할 사람인가(403) → 이미 끝났나(409) → 입력(400) → 상태 변경.
// 상태 변경은 UPDATE ... WHERE id = $1 AND status = 'pending' 한 문장이다. 바뀐 행이 없으면 409 —
// 화면의 버튼 잠금이 아니라 DB 의 조건으로 막으므로, 두 요청이 동시에 와도 하나만 반영된다.
// 기록: 올리기·열람·승인·반려·취소. 볼 수 없는 사람(404)·할 수 없는 사람(403)의 시도는 denied 로 남기고,
// 없는 요청과 이미 끝난 요청(409)은 기록하지 않는다. 제목·본문·의견은 기록에 넣지 않는다.
import express from 'express';
import { requireLogin } from '../auth.js';
import { canReadRequest, canDecideRequest, canCancelRequest } from '../policy.js';
import { withTransaction } from '../db.js';
import { record } from '../audit.js';
import { layout, esc, fmtDate, csrfField, notFound } from '../views.js';

const TITLE_MAX = 200;
const BODY_MAX = 20000;
const NOTE_MAX = 1000;

// 주소의 id 는 숫자만 받는다. 아니면 null (→ 404).
const parseId = (v) => (/^\d{1,15}$/.test(String(v)) ? Number(v) : null);
// 글자 수는 DB 의 char_length 와 같게 센다.
const len = (s) => [...s].length;
// 이름 옆에 붙이는 딱지. 퇴사한 사람도 그대로 보여 주되 퇴사했음을 표시한다.
const leftTag = (status) => (status === 'left' ? ' <span class="tag gray">퇴사</span>' : '');

const STATUS_LABELS = {
  pending: '<span class="tag amber">대기</span>',
  approved: '<span class="tag">승인</span>',
  rejected: '<span class="tag red">반려</span>',
  cancelled: '<span class="tag gray">취소</span>',
};
const statusTag = (s) => STATUS_LABELS[s] || esc(s);

// 처리 행동마다: 누가 할 수 있는지(policy), 바뀔 상태, 의견을 받는지·꼭 있어야 하는지.
const ACTIONS = {
  approve: { can: canDecideRequest, status: 'approved', note: 'optional', forbidden: '승인자만 승인할 수 있습니다.' },
  reject: { can: canDecideRequest, status: 'rejected', note: 'required', forbidden: '승인자만 반려할 수 있습니다.' },
  cancel: { can: canCancelRequest, status: 'cancelled', note: 'none', forbidden: '올린 사람만 취소할 수 있습니다.' },
};

// 403·409 처럼 짧게 알리는 화면
function message(req, res, code, heading, text, back) {
  res.status(code).send(layout(req, {
    title: heading, active: 'requests',
    body: `<div class="empty"><h1>${esc(heading)}</h1><p>${esc(text)}</p><p><a href="${esc(back)}">돌아가기</a></p></div>`,
  }));
}

export function requestRoutes(pool) {
  const r = express.Router();

  // 요청 한 건 (이름·퇴사 여부 포함). 없으면 null.
  async function loadRequest(rawId) {
    const id = parseId(rawId);
    if (id === null) return null;
    const { rows } = await pool.query(
      `SELECT q.id, q.requester_id, q.approver_id, q.title, q.body, q.requester_department_name, q.requester_title,
              q.status, q.decision_note, q.decided_at, q.created_at,
              ru.display_name AS requester_name, ru.status AS requester_status,
              au.display_name AS approver_name, au.title AS approver_title, au.status AS approver_status
         FROM requests q
         JOIN users ru ON ru.id = q.requester_id
         JOIN users au ON au.id = q.approver_id
        WHERE q.id = $1`, [id]);
    return rows[0] || null;
  }

  // 승인자로 고를 수 있는 사람: 재직 중인 다른 직원
  async function approverChoices(userId) {
    const { rows } = await pool.query(
      `SELECT u.id, u.display_name, u.title, d.name AS department_name
         FROM users u JOIN departments d ON d.id = u.department_id
        WHERE u.status = 'active' AND u.id <> $1
        ORDER BY d.name, u.display_name`, [userId]);
    return rows;
  }

  // 두 목록: 내가 올린 요청, 내가 처리할 요청(대기 중인 것이 위)
  r.get('/requests', requireLogin, async (req, res) => {
    const { rows: mine } = await pool.query(
      `SELECT q.id, q.title, q.status, q.created_at, u.display_name, u.status AS user_status
         FROM requests q JOIN users u ON u.id = q.approver_id
        WHERE q.requester_id = $1
        ORDER BY q.created_at DESC, q.id DESC`, [req.user.id]);
    const { rows: todo } = await pool.query(
      `SELECT q.id, q.title, q.status, q.created_at, u.display_name, u.status AS user_status,
              q.requester_department_name
         FROM requests q JOIN users u ON u.id = q.requester_id
        WHERE q.approver_id = $1
        ORDER BY (q.status = 'pending') DESC, q.created_at DESC, q.id DESC`, [req.user.id]);
    const table = (rows, who, extra) => (rows.length
      ? `<table><thead><tr><th>제목</th><th>${who}</th>${extra ? '<th>소속</th>' : ''}<th>상태</th><th>올린 날</th></tr></thead><tbody>
${rows.map((q) => `<tr><td><a href="/requests/${q.id}">${esc(q.title)}</a></td><td>${esc(q.display_name)}${leftTag(q.user_status)}</td>
${extra ? `<td>${esc(q.requester_department_name)}</td>` : ''}<td>${statusTag(q.status)}</td><td class="meta">${esc(fmtDate(q.created_at))}</td></tr>`).join('\n')}
</tbody></table>`
      : '<div class="card"><p class="meta">요청이 없습니다.</p></div>');
    res.send(layout(req, {
      title: '승인 요청', active: 'requests',
      body: `<div class="bar"><h1>승인 요청</h1><div class="row"><a class="btn" href="/requests/new">요청 올리기</a></div></div>
<p class="lead">요청은 올린 사람과 승인자 두 사람만 볼 수 있습니다.</p>
<h2>내가 처리할 요청</h2>
${table(todo, '올린 사람', true)}
<h2>내가 올린 요청</h2>
${table(mine, '승인자', false)}`,
    }));
  });

  // 올리기 화면
  r.get('/requests/new', requireLogin, async (req, res) => {
    res.send(newPage(req, await approverChoices(req.user.id)));
  });

  // 올리기. 입력이 하나라도 맞지 않으면 400, 아무것도 저장하지 않는다.
  r.post('/requests', requireLogin, async (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    const body = String(req.body?.body ?? '').replace(/\r\n/g, '\n').trim();
    const approverRaw = String(req.body?.approver_id ?? '');
    const approverId = parseId(approverRaw);
    const form = { title, body, approverId: approverRaw };
    const fail = async (error) => res.status(400).send(newPage(req, await approverChoices(req.user.id), { error, ...form }));

    if (len(title) < 1 || len(title) > TITLE_MAX) return fail(`제목은 1~${TITLE_MAX}자로 적어 주세요.`);
    if (len(body) < 1 || len(body) > BODY_MAX) return fail(`본문은 1~${BODY_MAX}자로 적어 주세요.`);
    const BAD_APPROVER = '승인자를 다시 골라 주세요. 자기 자신이나 퇴사한 사람은 고를 수 없습니다.';
    if (approverId === null || approverId === req.user.id) return fail(BAD_APPROVER);

    // 승인자 확인과 저장을 한 트랜잭션에서 한다. 승인자 줄을 FOR SHARE 로 잠가, 확인한 뒤 저장 전에 퇴사 처리되는 일을 막는다
    // (퇴사 처리는 같은 줄을 FOR UPDATE 로 잠그므로 둘 중 하나가 기다린다).
    // 올린 사람의 소속·직급은 저장하는 순간의 값을 남긴다. 나중에 부서를 옮겨도 이 값은 바뀌지 않는다.
    const id = await withTransaction(pool, async (client) => {
      const ok = (await client.query(
        `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR SHARE`, [approverId])).rows[0];
      if (!ok) return null;
      const { rows } = await client.query(
        `INSERT INTO requests(requester_id, approver_id, title, body, requester_department_name, requester_title)
         SELECT u.id, $2, $3, $4, d.name, u.title
           FROM users u JOIN departments d ON d.id = u.department_id
          WHERE u.id = $1
         RETURNING id`,
        [req.user.id, approverId, title, body]);
      await record(client, req, { action: 'request.create', resourceType: 'request', resourceId: rows[0].id, result: 'ok' });
      return rows[0].id;
    });
    if (id === null) return fail(BAD_APPROVER);
    res.redirect(`/requests/${id}`);
  });

  // 상세. 없는 요청과 볼 수 없는 요청은 같은 404 로 답한다 (볼 수 없는 경우만 거부로 기록).
  r.get('/requests/:id', requireLogin, async (req, res) => {
    const q = await loadRequest(req.params.id);
    if (!q) return notFound(req, res);
    if (!canReadRequest(req.user, q)) {
      await record(pool, req, { action: 'request.read', resourceType: 'request', resourceId: q.id, result: 'denied' });
      return notFound(req, res);
    }
    await record(pool, req, { action: 'request.read', resourceType: 'request', resourceId: q.id, result: 'ok' });
    res.send(detailPage(req, q));
  });

  // 승인·반려·취소
  for (const [name, spec] of Object.entries(ACTIONS)) {
    const action = `request.${name}`;
    r.post(`/requests/:id/${name}`, requireLogin, async (req, res) => {
      const q = await loadRequest(req.params.id);
      if (!q) return notFound(req, res);
      if (!canReadRequest(req.user, q)) {
        await record(pool, req, { action, resourceType: 'request', resourceId: q.id, result: 'denied' });
        return notFound(req, res);
      }
      if (!spec.can(req.user, q)) {
        await record(pool, req, { action, resourceType: 'request', resourceId: q.id, result: 'denied' });
        return message(req, res, 403, '할 수 없는 일입니다', spec.forbidden, `/requests/${q.id}`);
      }
      const done = () => message(req, res, 409, '이미 처리된 요청입니다', '이 요청은 이미 끝났습니다. 상태는 바뀌지 않았습니다.', `/requests/${q.id}`);
      if (q.status !== 'pending') return done();

      // 의견: 반려는 꼭 1~1000자, 승인은 비워도 된다(비우면 NULL), 취소는 받지 않는다.
      let note = null;
      if (spec.note !== 'none') {
        note = String(req.body?.note ?? '').replace(/\r\n/g, '\n').trim();
        if (len(note) > NOTE_MAX || (spec.note === 'required' && len(note) < 1)) {
          const error = spec.note === 'required' ? `반려 의견을 1~${NOTE_MAX}자로 적어 주세요.` : `의견은 ${NOTE_MAX}자까지 적을 수 있습니다.`;
          return res.status(400).send(detailPage(req, q, { error, note }));
        }
        if (note === '') note = null;
      }

      // 대기 중일 때만 바뀐다. 동시에 온 다른 처리가 먼저 끝났으면 바뀐 행이 없다 → 409.
      // 상태 변경과 ok 기록을 한 트랜잭션에 넣는다. 변경이 되돌려지면 기록도 남지 않는다.
      const changed = await withTransaction(pool, async (client) => {
        const { rowCount } = await client.query(
          `UPDATE requests SET status = $2, decision_note = $3, decided_at = now()
            WHERE id = $1 AND status = 'pending'`, [q.id, spec.status, note]);
        if (rowCount === 0) return false;
        await record(client, req, { action, resourceType: 'request', resourceId: q.id, result: 'ok' });
        return true;
      });
      if (!changed) return done();
      res.redirect(`/requests/${q.id}`);
    });
  }

  return r;
}

function newPage(req, approvers, { error = '', title = '', body = '', approverId = '' } = {}) {
  return layout(req, {
    title: '요청 올리기', active: 'requests',
    body: `<h1>요청 올리기</h1>
<p class="lead">올린 뒤에는 제목·본문을 고칠 수 없습니다. 고치려면 취소하고 새로 올립니다.</p>
<form class="card" method="post" action="/requests">
${csrfField(req)}
${error ? `<p class="error">${esc(error)}</p>` : ''}
<label>제목 <input name="title" value="${esc(title)}" maxlength="${TITLE_MAX}" required autofocus></label>
<label>본문 <textarea name="body" maxlength="${BODY_MAX}" required>${esc(body)}</textarea></label>
<label>승인자 <select name="approver_id" required>
<option value="">고르세요</option>
${approvers.map((a) => `<option value="${a.id}"${String(a.id) === String(approverId) ? ' selected' : ''}>${esc(a.display_name)} ${esc(a.title)} (${esc(a.department_name)})</option>`).join('\n')}
</select></label>
<div class="row"><button class="primary">올리기</button><a class="btn ghost" href="/requests">취소</a></div>
</form>`,
  });
}

function detailPage(req, q, { error = '', note = '' } = {}) {
  const pending = q.status === 'pending';
  const decideForm = pending && canDecideRequest(req.user, q) ? `<form class="card" method="post" action="/requests/${q.id}/approve">
<h2>처리</h2>
${csrfField(req)}
${error ? `<p class="error">${esc(error)}</p>` : ''}
<label>의견 <small>(반려할 때는 꼭 적어 주세요)</small> <textarea name="note" maxlength="${NOTE_MAX}">${esc(note)}</textarea></label>
<div class="row"><button class="primary">승인</button><button class="danger" formaction="/requests/${q.id}/reject">반려</button></div>
</form>` : '';
  const cancelForm = pending && canCancelRequest(req.user, q) ? `<form class="card" method="post" action="/requests/${q.id}/cancel">
${csrfField(req)}
${error && !decideForm ? `<p class="error">${esc(error)}</p>` : ''}
<p class="meta">대기 중인 요청은 취소할 수 있습니다. 내용을 고치려면 취소하고 새로 올립니다.</p>
<div class="row"><button class="danger">요청 취소</button></div>
</form>` : '';
  return layout(req, {
    title: q.title, active: 'requests',
    body: `<p class="meta"><a href="/requests">승인 요청</a></p>
<div class="bar"><h1>${esc(q.title)}</h1>${statusTag(q.status)}</div>
<div class="card"><dl>
<dt>올린 사람</dt><dd>${esc(q.requester_name)} ${esc(q.requester_title)}${leftTag(q.requester_status)} · <span class="tag">${esc(q.requester_department_name)}</span></dd>
<dt>올린 시각</dt><dd>${esc(fmtDate(q.created_at))}</dd>
<dt>승인자</dt><dd>${esc(q.approver_name)} ${esc(q.approver_title)}${leftTag(q.approver_status)}</dd>
<dt>상태</dt><dd>${statusTag(q.status)}</dd>
<dt>처리 시각</dt><dd>${q.decided_at ? esc(fmtDate(q.decided_at)) : '<span class="meta">-</span>'}</dd>
<dt>처리 의견</dt><dd>${q.decision_note ? esc(q.decision_note) : '<span class="meta">-</span>'}</dd>
</dl></div>
<div class="card post-body">${esc(q.body)}</div>
${decideForm}
${cancelForm}
<p><a class="btn ghost" href="/requests">목록으로</a></p>`,
  });
}
