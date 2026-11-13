// 부서 이동: node scripts/transfer.js <아이디> <부서 이름> [직급]
// 직급을 적지 않으면 그대로 둔다. (관리 화면은 뒤 편에서 만든다)
import { loadEnv, createPool } from '../src/db.js';
import { transferUser } from '../src/org.js';

const [username, deptName, title] = process.argv.slice(2);
if (!username || !deptName) {
  console.error('사용법: node scripts/transfer.js <아이디> <부서 이름> [직급]');
  process.exit(1);
}

loadEnv();
const pool = createPool();
try {
  const user = (await pool.query('SELECT id, display_name FROM users WHERE username = $1', [username])).rows[0];
  if (!user) throw new Error(`없는 아이디입니다: ${username}`);
  const dept = (await pool.query('SELECT id FROM departments WHERE name = $1', [deptName])).rows[0];
  if (!dept) throw new Error(`없는 부서입니다: ${deptName}`);
  const done = await transferUser(pool, { userId: user.id, departmentId: dept.id, title });
  console.log(`${user.display_name}(${username}) → ${done.departmentName} ${done.title} (${done.onDate} 부터)`);
} catch (e) {
  console.error(`옮기지 못했습니다: ${e.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
