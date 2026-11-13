# office-lab — 가상 회사 '예제상사'의 사내 시스템

영상 시리즈 **AI로 사내 시스템 만들기**의 실습 코드다. 매 편 이 시스템으로 할 수 있는 업무가 하나씩 늘어난다.
회사 이름·직원·글은 모두 지어낸 것이고, 코드는 이 시리즈를 위해 새로 썼다.

## 준비

- Node.js 20 이상, PostgreSQL 13 이상
- 예제 전용 DB 를 하나 만든다. `npm run db:reset` 은 그 DB 의 내용을 모두 지우고 다시 만든다.

```sh
createdb office_lab
cp .env.example .env        # DATABASE_URL 을 내 환경에 맞게 고친다
npm install
npm run db:reset            # 표를 만들고 가상 데이터를 넣는다
npm start                   # http://127.0.0.1:3000
```

가상 계정: `kim` `lee` (영업팀) · `park` `jung` (개발팀) · `choi` `han` (경영지원팀). 비밀번호는 모두 `pass1234`.
`choi` 는 시스템 관리자(`system_admin`), `han` 은 감사 담당(`auditor`)이다.

## 편마다 따라 하기

편마다 태그가 둘 있다. `epNN-start` 에서 시작해 직접 만들고, 막히면 `epNN-done` 과 비교한다.
앞 편을 하지 않았어도 그 편의 `start` 태그에서 바로 시작할 수 있다.

```sh
git checkout ep01-start
npm install && npm run db:reset
# prompts/ep01.md 를 AI 코딩 도구에 그대로 준다
npm run check               # 확인 스크립트. 전부 통과하면 맞게 만든 것이다
```

| 편 | 만드는 것 | 지시문 | 확인 |
|---|---|---|---|
| 1 | 부서 게시판: 다른 부서 글은 목록에도, 직접 주소로도 안 보인다 | `prompts/ep01.md` | `checks/ep01-board.test.js` |
| 2 | 부서 이동: 지난 글에는 쓴 당시의 소속이 남는다 | `prompts/ep02.md` | `checks/ep02-transfer.test.js` |
| 3 | 퇴사 처리: 열린 로그인까지 끊고, 작성 기록은 남긴다 | `prompts/ep03.md` | `checks/ep03-offboard.test.js` |
| 4 | 관리 화면: 시스템 관리자와 문서 열람 권한을 나눈다 | `prompts/ep04.md` | `checks/ep04-admin.test.js` |
| 5 | 첨부와 내보내기: 글을 볼 수 없으면 파일도 받을 수 없다 | `prompts/ep05.md` | `checks/ep05-files.test.js` |
| 6 | 열람·변경 기록: 거부된 시도까지 남기고, 내용은 남기지 않는다 | `prompts/ep06.md` | `checks/ep06-audit.test.js` |

## 구조

```
migrations/   번호 붙은 SQL. 한 번씩만 적용된다
scripts/      migrate, seed(가상 데이터), reset, transfer(부서 이동), offboard(퇴사 처리)
src/          app.js, auth.js(로그인·세션), policy.js(권한 판단), org.js(소속 이력·부서 이동·퇴사 처리), audit.js(기록), views.js(화면 틀), routes/
checks/       확인 스크립트 (node:test)
prompts/      편마다 AI 에게 주는 지시문
```

## 기록(감사 기록)과 그 한계

누가 언제 무엇을 했는지 `audit_events` 표에 남긴다. 허용된 일뿐 아니라 거부된 시도도 남긴다. 기록 화면(`/audit`)은 `auditor` 역할만 볼 수 있다.

- 남기는 것: 누가, 무엇을(`action`), 어떤 대상에(종류와 번호), 결과(`ok`/`denied`), 언제, 어느 요청에서.
- 남기지 않는 것: 글 제목·본문, 파일 이름·내용, 비밀번호, 로그인에 실패한 아이디.
- 변경(글 저장, 첨부 올리기, 부서 이동, 퇴사 처리)의 `ok` 기록은 그 변경과 같은 트랜잭션에 넣는다. 변경이 되돌려지면 기록도 남지 않는다.
- `scripts/transfer.js`, `scripts/offboard.js` 로 한 변경도 기록된다. 로그인한 사람이 없으므로 `actor_id` 는 비어 있다.

기록은 추가만 한다. `UPDATE`, `DELETE`, `TRUNCATE` 는 DB 의 트리거가 막는다. 다만 알아 둘 한계가 있다.

- **DB 관리자 계정까지 막는 것은 아니다.** 표의 주인이나 슈퍼유저는 트리거를 끄거나 지울 수 있고, 표를 통째로 지울 수도 있다 (`npm run db:reset` 이 바로 그렇게 한다).
  그것까지 막으려면 기록을 다른 곳(별도 서버나 한 번만 쓸 수 있는 저장소)에 따로 보관해야 하고, 그건 이 예제의 범위 밖이다.
- 이 예제는 migration 을 돌리는 계정과 앱이 쓰는 계정이 같다. 그래서 앱 계정이 곧 표의 주인이다.
  실제로 쓸 때는 앱 계정을 따로 만들어 `audit_events` 에 `INSERT`, `SELECT` 만 주어야 "앱 계정으로는 고칠 수 없다"가 성립한다.
- 기록하는 일은 지시문의 표에 있는 것뿐이다. 로그아웃, 관리 화면·글쓰기 화면을 여는 것, CSRF 토큰이 틀린 요청, 로그인하지 않은 사람의 요청은 기록하지 않는다.
- 없는 대상(없는 글·게시판·첨부·직원)을 향한 요청은 거부로 기록하지 않는다. 응답은 볼 수 없는 것과 똑같은 404 다.

MIT License.
