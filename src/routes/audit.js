// 기록(감사 기록) 화면. auditor 만 볼 수 있고, 아니면 없는 주소와 같은 404 로 답한다.
// 기록을 본 것도, 보려다 거부된 것도 기록한다.
import express from 'express';
import { requireLogin } from '../auth.js';
import { canReadAudit } from '../policy.js';
import { record } from '../audit.js';
import { layout, esc, notFound } from '../views.js';

const LIMIT = 200;
const RESULT_LABELS = { ok: '<span class="tag">허용</span>', denied: '<span class="tag red">거부</span>' };

// 주소의 ?이름=값 에서 글자 하나만 받는다 (여러 번 적었거나 비었으면 없는 것으로 본다).
const one = (v) => (typeof v === 'string' && v !== '' ? v : null);

export function auditRoutes(pool) {
  const r = express.Router();

  // 최근 200건, 최신순. ?result=denied 로 거부만, ?action=post.read 처럼 한 종류만 볼 수 있다.
  r.get('/audit', requireLogin, async (req, res) => {
    if (!canReadAudit(req.user)) {
      await record(pool, req, { action: 'audit.read', result: 'denied' });
      return notFound(req, res);
    }
    await record(pool, req, { action: 'audit.read', result: 'ok' });

    const result = ['ok', 'denied'].includes(one(req.query.result)) ? req.query.result : null;
    const action = one(req.query.action)?.slice(0, 100) ?? null;
    // 시각은 DB 에서 한국 시간 글자로 받는다. 사람은 이름으로 보여 준다 (actor_id 가 NULL 이면 비어 있다).
    const { rows } = await pool.query(
      `SELECT to_char(e.at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS at,
              u.display_name, e.action, e.resource_type, e.resource_id, e.result
         FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE ($1::text IS NULL OR e.result = $1) AND ($2::text IS NULL OR e.action = $2)
        ORDER BY e.id DESC
        LIMIT ${LIMIT}`, [result, action]);

    // 걸러 보기 주소. 지금 걸린 조건에서 하나만 바꾼다.
    const href = (next) => {
      const q = new URLSearchParams();
      const merged = { result, action, ...next };
      if (merged.result) q.set('result', merged.result);
      if (merged.action) q.set('action', merged.action);
      const s = q.toString();
      return esc(s ? `/audit?${s}` : '/audit');
    };
    const target = (e) => (e.resource_type === null ? '<span class="meta">-</span>'
      : `${esc(e.resource_type)}${e.resource_id === null ? '' : ` #${esc(e.resource_id)}`}`);

    res.send(layout(req, {
      title: '기록', active: 'audit',
      body: `<div class="bar"><h1>기록</h1><div class="row">
<a class="btn${result === null ? '' : ' ghost'}" href="${href({ result: null })}">전체</a>
<a class="btn${result === 'denied' ? '' : ' ghost'}" href="${href({ result: 'denied' })}">거부만</a></div></div>
<p class="lead">누가 언제 무엇을 했는지, 최근 ${LIMIT}건을 최신순으로 보여 준다. 글 제목·본문과 파일 이름은 기록하지 않는다. 이 화면을 연 것도 기록된다.</p>
${action ? `<p class="notice">종류 <b>${esc(action)}</b> 만 보는 중 · <a href="${href({ action: null })}">모든 종류 보기</a></p>` : ''}
${rows.length ? `<table><thead><tr><th>시각</th><th>사람</th><th>종류</th><th>대상</th><th>결과</th></tr></thead><tbody>
${rows.map((e) => `<tr><td class="meta">${esc(e.at)}</td><td>${e.display_name === null ? '<span class="meta">-</span>' : esc(e.display_name)}</td>
<td><a href="${href({ action: e.action })}">${esc(e.action)}</a></td><td>${target(e)}</td><td>${RESULT_LABELS[e.result] || esc(e.result)}</td></tr>`).join('\n')}
</tbody></table>` : '<div class="card"><p class="meta">해당하는 기록이 없습니다.</p></div>'}`,
    }));
  });

  return r;
}
