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
