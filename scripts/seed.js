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

export const ALL_BOARD = '전사 공지';   // department_id 가 NULL 인, 전 직원이 보는 게시판
export const POSTS = [
  // 게시판, 작성자 username, 제목, 본문
  [ALL_BOARD, 'choi', '사내 시스템을 새로 엽니다', '이번 달부터 공지와 부서 소식은 이 게시판에 올립니다.\n쓰다가 불편한 점은 경영지원팀으로 알려 주세요.'],
  [ALL_BOARD, 'choi', '11월 전사 회의 안내', '11월 마지막 금요일 오후 2시, 대회의실에서 합니다.'],
  ['영업팀 게시판', 'kim', '이번 주 거래처 방문 계획', '화요일과 목요일에 외근이 있습니다. 급한 일은 전화로 부탁합니다.'],
  ['영업팀 게시판', 'lee', '견적서 양식이 바뀌었습니다', '새 양식은 공유 폴더에 있습니다. 다음 주부터 새 양식만 씁니다.'],
  ['개발팀 게시판', 'park', '코드 리뷰 규칙', '모든 변경은 한 사람 이상이 본 뒤에 합칩니다.'],
  ['개발팀 게시판', 'jung', '개발 서버 점검 일정', '수요일 저녁 7시부터 한 시간 동안 개발 서버를 멈춥니다.'],
  ['경영지원팀 게시판', 'choi', '경비 정산 마감일', '매달 25일까지 영수증을 올려 주세요.'],
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
  // 게시판: 전사 공지 하나, 부서마다 하나
  await pool.query('INSERT INTO boards(name, department_id) VALUES ($1, NULL) ON CONFLICT (name) DO NOTHING', [ALL_BOARD]);
  for (const name of DEPARTMENTS) {
    await pool.query(
      `INSERT INTO boards(name, department_id) VALUES ($1, (SELECT id FROM departments WHERE name = $2))
       ON CONFLICT (name) DO NOTHING`,
      [`${name} 게시판`, name],
    );
  }
  // 글: 다시 돌려도 겹치지 않게, 글이 하나도 없을 때만 넣는다
  const { rows } = await pool.query('SELECT count(*) AS n FROM posts');
  if (Number(rows[0].n) === 0) {
    for (const [board, username, title, body] of POSTS) {
      await pool.query(
        `INSERT INTO posts(board_id, author_id, title, body)
         VALUES ((SELECT id FROM boards WHERE name = $1), (SELECT id FROM users WHERE username = $2), $3, $4)`,
        [board, username, title, body],
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv();
  const pool = createPool();
  await seed(pool);
  console.log(`가상 데이터를 넣었습니다. 계정: ${USERS.map((u) => u[0]).join(', ')} / 비밀번호: ${PASSWORD}`);
  await pool.end();
}
