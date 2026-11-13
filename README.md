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

가상 계정: `kim` `lee` (영업팀) · `park` `jung` (개발팀) · `choi` (경영지원팀). 비밀번호는 모두 `pass1234`.

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

## 구조

```
migrations/   번호 붙은 SQL. 한 번씩만 적용된다
scripts/      migrate, seed(가상 데이터), reset
src/          app.js, auth.js(로그인·세션), policy.js(권한 판단), views.js(화면 틀), routes/
checks/       확인 스크립트 (node:test)
prompts/      편마다 AI 에게 주는 지시문
```

MIT License.
