// 권한 판단은 이 파일에만 둔다. 경로(routes)는 직접 비교하지 않고 여기 함수를 부른다.

// 게시판을 볼 수 있는가 (읽기·쓰기 공통).
// 게시판의 department_id 가 NULL(전 직원 게시판)이거나 사용자의 부서와 같을 때만 true.
export function canReadBoard(user, board) {
  if (!user || !board) return false;
  if (board.department_id === null || board.department_id === undefined) return true;
  // pg 는 bigint 를 문자열로 돌려주므로 숫자로 맞춰 비교한다.
  return Number(board.department_id) === Number(user.departmentId);
}
