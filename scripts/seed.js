// 가상 회사 '예제상사'의 가상 데이터. 실제 회사·인물과 관계없다.
import { fileURLToPath } from 'node:url';
import { loadEnv, createPool } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

export const PASSWORD = 'pass1234';   // 예제 전용. 모든 가상 계정이 같은 비밀번호를 쓴다.

export const DEPARTMENTS = ['영업팀', '개발팀', '경영지원팀'];
export const USERS = [
  // username, 이름, 직급, 부서
  ['kim', '김하늘', '대리', '영업팀'],
  ['lee', '이도윤', '사원', '영업팀'],
  ['park', '박서준', '팀장', '개발팀'],
  ['jung', '정유나', '사원', '개발팀'],
  ['choi', '최지우', '과장', '경영지원팀'],
];

export async function seed(pool) {
  const hash = await hashPassword(PASSWORD);
  for (const name of DEPARTMENTS) {
    await pool.query('INSERT INTO departments(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  }
  for (const [username, displayName, title, dept] of USERS) {
    await pool.query(
      `INSERT INTO users(username, display_name, title, password_hash, department_id)
       VALUES ($1, $2, $3, $4, (SELECT id FROM departments WHERE name = $5))
       ON CONFLICT (username) DO NOTHING`,
      [username, displayName, title, hash, dept],
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv();
  const pool = createPool();
  await seed(pool);
  console.log(`가상 데이터를 넣었습니다. 계정: ${USERS.map((u) => u[0]).join(', ')} / 비밀번호: ${PASSWORD}`);
  await pool.end();
}
