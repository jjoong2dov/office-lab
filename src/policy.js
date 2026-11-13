// 권한 판단은 이 파일에만 둔다. 경로(routes)는 직접 비교하지 않고 여기 함수를 부른다.

// 게시판을 볼 수 있는가 (읽기·쓰기 공통).
// 게시판의 department_id 가 NULL(전 직원 게시판)이거나 사용자의 부서와 같을 때만 true.
export function canReadBoard(user, board) {
  if (!user || !board) return false;
  if (board.department_id === null || board.department_id === undefined) return true;
  // pg 는 bigint 를 문자열로 돌려주므로 숫자로 맞춰 비교한다.
  return Number(board.department_id) === Number(user.departmentId);
}

// 글에 파일을 붙일 수 있는가. 글쓴이만 true.
// 글을 볼 수 있는지는 따로 canReadBoard 로 먼저 본다 (부서를 옮긴 글쓴이는 거기서 막힌다).
export function canAttachToPost(user, post) {
  if (!user || !post) return false;
  return Number(post.author_id) === Number(user.id);
}

// 계정·조직을 관리할 수 있는가 (관리 화면: 부서 이동, 퇴사 처리).
// roles 에 system_admin 이 있을 때만 true. 이 역할이 주는 것은 이것 하나뿐이다 — 게시판 열람은 위의 canReadBoard 가 따로 정한다.
export function canManageUsers(user) {
  return Boolean(user && Array.isArray(user.roles) && user.roles.includes('system_admin'));
}

// 기록(감사 기록) 화면을 볼 수 있는가. roles 에 auditor 가 있을 때만 true.
// system_admin 과는 따로다 — 시스템 관리자라고 기록을 볼 수 없다.
export function canReadAudit(user) {
  return Boolean(user && Array.isArray(user.roles) && user.roles.includes('auditor'));
}

// 승인 요청을 볼 수 있는가. 올린 사람과 승인자 두 사람만 true.
// 같은 부서도, 시스템 관리자도, 감사 담당도 볼 수 없다 (역할을 보지 않는다).
export function canReadRequest(user, request) {
  if (!user || !request) return false;
  const me = Number(user.id);
  return me === Number(request.requester_id) || me === Number(request.approver_id);
}

// 승인·반려할 수 있는가. 승인자만 true. 요청의 상태(대기 중인지)는 여기서 보지 않는다 — 경로가 DB 의 조건으로 막는다.
// requester_id <> approver_id 는 DB 가 막지만, 자기 요청을 자기가 처리하는 길은 여기서도 한 번 더 막는다.
export function canDecideRequest(user, request) {
  if (!user || !request) return false;
  return Number(user.id) === Number(request.approver_id) && Number(user.id) !== Number(request.requester_id);
}

// 취소할 수 있는가. 올린 사람만 true. 승인자가 퇴사했어도 올린 사람은 취소할 수 있다.
export function canCancelRequest(user, request) {
  if (!user || !request) return false;
  return Number(user.id) === Number(request.requester_id);
}
