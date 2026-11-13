// 기록(감사 기록). audit_events 에 줄을 넣는 일은 이 파일에만 둔다.
// 남기는 것: 누가(actor_id), 무엇을(action), 어떤 대상에(resource_type, resource_id), 결과(ok/denied), 어느 요청에서(request_id).
// 남기지 않는 것: 글 제목·본문, 파일 이름·내용, 비밀번호, 로그인에 실패한 아이디.
// detail 에는 꼭 필요한 값만 넣는다 (예: 부서 이동의 이전·이후 부서 번호). 사용자가 적은 글자를 그대로 넣지 않는다.
import crypto from 'node:crypto';

// 요청마다 번호(UUID)를 붙인다. 한 요청에서 나온 기록은 같은 request_id 를 갖는다.
export function requestId(req, res, next) {
  req.requestId = crypto.randomUUID();
  next();
}

// 기록 한 줄을 넣는다. db 는 pool 이나 트랜잭션 client 둘 다 받는다.
//   - 변경의 ok 기록은 그 변경과 같은 트랜잭션의 client 로 부른다 (변경이 되돌려지면 기록도 남지 않는다).
//   - denied 기록은 pool 로 따로 넣는다 (거부됐다는 사실은 남아야 한다).
// 누가: 기본은 로그인한 사람(req.user). 로그인 성공·실패처럼 req.user 로 알 수 없을 때만 actorId 를 직접 준다 (null 이면 비운다).
// req 가 없으면(스크립트로 한 변경) actor_id 는 NULL, request_id 는 새로 만든다.
// 넣지 못하면 오류를 던진다 — 기록 없이 일이 진행되게 두지 않는다.
export async function record(db, req, { action, resourceType = null, resourceId = null, result = 'ok', detail = {}, actorId } = {}) {
  const actor = actorId !== undefined ? actorId : (req?.user?.id ?? null);
  await db.query(
    `INSERT INTO audit_events(actor_id, action, resource_type, resource_id, result, request_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [actor, action, resourceType, resourceId, result, req?.requestId ?? crypto.randomUUID(), JSON.stringify(detail ?? {})],
  );
}
