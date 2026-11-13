// 조직: 소속 이력(org_assignments)을 바꾸는 일과 퇴사 처리는 이 파일에만 둔다.
// 두 변경 모두 기록(audit_events)을 같은 트랜잭션에서 남긴다. 변경이 되돌려지면 기록도 남지 않는다.
// req 는 그 변경을 시킨 요청이다 (누가·어느 요청인지 기록에 쓴다). 스크립트처럼 요청이 없으면 주지 않는다 — 그때 기록의 actor_id 는 NULL 이다.
// 기간은 starts_on 부터 ends_on 전날까지다 (ends_on 당일은 포함하지 않는다). ends_on 이 NULL 이면 지금 소속이다.

import { record } from './audit.js';

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
export async function transferUser(pool, { userId, departmentId, title, onDate, req } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 같은 사람을 동시에 옮기지 못하게 사용자 줄을 잠근다.
    const user = (await client.query(
      'SELECT id, department_id, title, status FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!user) throw new Error('없는 사용자입니다.');
    if (user.status !== 'active') throw new Error('퇴사한 사람은 옮길 수 없습니다.');
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
    // 기록에는 이전·이후 부서 번호만 남긴다.
    await record(client, req, {
      action: 'user.transfer', resourceType: 'user', resourceId: user.id, result: 'ok',
      detail: { from_department_id: Number(user.department_id), to_department_id: Number(dept.id) },
    });

    await client.query('COMMIT');
    return { userId: user.id, departmentId: dept.id, departmentName: dept.name, title: newTitle, onDate: day };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// 퇴사 처리. 계정 행은 지우지 않는다 (글의 작성자는 계속 users.id 로 이어진다). 한 트랜잭션에서
//   1) users.status = 'left', left_on = onDate  2) 열린 소속을 ends_on = onDate 로 닫고  3) 그 사람의 세션을 모두 지운다.
// left_on 과 ends_on 은 모두 '그날부터 직원이 아닌 날'이다 (당일은 기간에 포함하지 않는다).
// onDate 를 주지 않으면 오늘이다. 이미 퇴사한 사람, 없는 사용자는 오류를 던지고 아무것도 바꾸지 않는다.
export async function offboardUser(pool, { userId, onDate, req } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 부서 이동과 동시에 일어나지 않게 사용자 줄을 잠근다.
    const user = (await client.query('SELECT id, status FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!user) throw new Error('없는 사용자입니다.');
    if (user.status !== 'active') throw new Error('이미 퇴사한 사람입니다.');

    const day = (await client.query(
      `SELECT to_char(COALESCE($1::date, current_date), 'YYYY-MM-DD') AS day`,
      [onDate === undefined || onDate === null ? null : toDay(onDate)])).rows[0].day;

    const open = (await client.query(
      `SELECT id, starts_on > $2::date AS starts_later FROM org_assignments
        WHERE user_id = $1 AND ends_on IS NULL FOR UPDATE`, [user.id, day])).rows[0];
    if (open?.starts_later) throw new Error('지금 소속의 시작일보다 앞선 날짜로는 퇴사 처리할 수 없습니다.');

    await client.query(`UPDATE users SET status = 'left', left_on = $2::date WHERE id = $1`, [user.id, day]);
    // 열린 소속을 퇴사일로 닫는다. 퇴사한 사람에게는 열린 소속이 없다.
    if (open) await client.query('UPDATE org_assignments SET ends_on = $2::date WHERE id = $1', [open.id, day]);
    // 이미 열려 있던 로그인도 끊는다.
    const gone = await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    await record(client, req, { action: 'user.offboard', resourceType: 'user', resourceId: user.id, result: 'ok' });

    await client.query('COMMIT');
    return { userId: user.id, onDate: day, sessions: gone.rowCount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
