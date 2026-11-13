// 화면은 서버가 문자열로 만든다. 사용자 입력은 반드시 esc() 를 거친다.
import { MENU } from './menu.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtDate = (d) => new Date(d).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

// 파일 크기를 읽기 쉽게 (B, KB, MB)
export function fmtSize(bytes) {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function layout(req, { title, active = '', body }) {
  const u = req.user;
  const menu = MENU.filter((m) => !m.visible || m.visible(u))
    .map((m) => `<a class="${m.key === active ? 'on' : ''}" href="${m.href}">${esc(m.label)}</a>`).join('');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 예제상사</title><link rel="stylesheet" href="/style.css"></head>
<body>
<header class="top">
  <a class="brand" href="/">예제상사 <small>사내 시스템</small></a>
  ${u ? `<div class="who"><b>${esc(u.displayName)} ${esc(u.title)}</b><span>${esc(u.departmentName)}</span>
    <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${esc(req.csrf)}"><button class="link">로그아웃</button></form></div>` : ''}
</header>
<div class="shell">
  ${u ? `<nav class="side">${menu}</nav>` : ''}
  <main>${body}</main>
</div>
</body></html>`;
}

export const csrfField = (req) => `<input type="hidden" name="_csrf" value="${esc(req.csrf)}">`;

// 없는 것과 볼 수 없는 것을 같은 화면으로 답한다 (있는지 없는지도 알려 주지 않는다).
export function notFound(req, res) {
  res.status(404).send(layout(req, {
    title: '찾을 수 없음',
    body: `<div class="empty"><h1>찾을 수 없습니다</h1><p>문서가 없거나 볼 권한이 없습니다.</p><p><a href="/">홈으로</a></p></div>`,
  }));
}
