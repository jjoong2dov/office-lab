// 조직: 소속 이력(org_assignments)을 바꾸는 일은 이 파일에만 둔다.
// 기간은 starts_on 부터 ends_on 전날까지다 (ends_on 당일은 포함하지 않는다). ends_on 이 NULL 이면 지금 소속이다.

// 날짜는 'YYYY-MM-DD' 글자로 맞춘다. Date 를 받으면 그 날짜(로컬 기준)로 바꾼다.
function toDay(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw new Error('날짜는 YYYY-MM-DD 로 적어 주세요.');
}

// 부서(또는 직급)를 옮긴다. 한 트랜잭션에서
//   1) 열린 소속을 ends_on = onDate 로 닫고  2) 새 소속을 onDate 부터 열고  3) users 의 지금 소속·직급을 바꾼다.
// ends_on 당일은 옛 소속에 포함되지 않으므로 두 기간은 겹치지 않는다.
// title 을 주지 않으면 직급은 그대로, onDate 를 주지 않으면 오늘이다.
// 중간에 실패하면 전부 되돌리고 오류를 던진다.
export async function transferUser(pool, { userId, departmentId, title, onDate } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 같은 사람을 동시에 옮기지 못하게 사용자 줄을 잠근다.
    const user = (await client.query(
      'SELECT id, department_id, title FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!user) throw new Error('없는 사용자입니다.');
    const dept = (await client.query('SELECT id, name FROM departments WHERE id = $1', [departmentId])).rows[0];
    if (!dept) throw new Error('없는 부서입니다.');

    const newTitle = title === undefined || title === null ? user.title : String(title);
    // pg 는 bigint 를 문자열로 돌려주므로 글자로 맞춰 비교한다.
    if (String(user.department_id) === String(dept.id) && user.title === newTitle) {
      throw new Error('이미 그 부서·직급입니다. 바뀌는 것이 없습니다.');
    }

    const day = (await client.query(
      `SELECT to_char(COALESCE($1::date, current_date), 'YYYY-MM-DD') AS day`,
      [onDate === undefined || onDate === null ? null : toDay(onDate)])).rows[0].day;

    const open = (await client.query(
      `SELECT id, starts_on > $2::date AS starts_later FROM org_assignments
        WHERE user_id = $1 AND ends_on IS NULL FOR UPDATE`, [user.id, day])).rows[0];
    if (!open) throw new Error('열린 소속이 없습니다. 소속 이력을 먼저 확인하세요.');
    if (open.starts_later) throw new Error('지금 소속의 시작일보다 앞선 날짜로는 옮길 수 없습니다.');

    // 옮기는 날로 닫는다. 시작한 바로 그날 옮기면 ends_on = starts_on 인 길이 0 의 줄이 남는다.
    await client.query('UPDATE org_assignments SET ends_on = $2::date WHERE id = $1', [open.id, day]);
    await client.query(
      `INSERT INTO org_assignments(user_id, department_id, title, starts_on) VALUES ($1, $2, $3, $4::date)`,
      [user.id, dept.id, newTitle, day]);
    await client.query('UPDATE users SET department_id = $2, title = $3 WHERE id = $1', [user.id, dept.id, newTitle]);

    await client.query('COMMIT');
    return { userId: user.id, departmentId: dept.id, departmentName: dept.name, title: newTitle, onDate: day };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
