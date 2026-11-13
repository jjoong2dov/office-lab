// 퇴사 처리: node scripts/offboard.js <아이디>
// 계정은 지우지 않는다. 로그인을 막고, 열린 로그인을 끊고, 열린 소속을 오늘로 닫는다. (관리 화면은 뒤 편에서 만든다)
import { loadEnv, createPool } from '../src/db.js';
import { offboardUser } from '../src/org.js';

const [username] = process.argv.slice(2);
if (!username) {
  console.error('사용법: node scripts/offboard.js <아이디>');
  process.exit(1);
}

loadEnv();
const pool = createPool();
try {
  const user = (await pool.query('SELECT id, display_name FROM users WHERE username = $1', [username])).rows[0];
  if (!user) throw new Error(`없는 아이디입니다: ${username}`);
  const done = await offboardUser(pool, { userId: user.id });
  console.log(`${user.display_name}(${username}) 퇴사 처리 (${done.onDate} 부터 직원이 아님, 끊은 로그인 ${done.sessions}개)`);
} catch (e) {
  console.error(`퇴사 처리하지 못했습니다: ${e.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
