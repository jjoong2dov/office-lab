# office-lab — 가상 회사 '예제상사'의 사내 시스템

영상 시리즈 **AI로 사내 시스템 만들기**의 실습 코드다. 매 편 이 시스템으로 할 수 있는 업무가 하나씩 늘어난다.

> ▶ **영상으로 보기: [YouTube 재생목록 「AI로 사내 시스템 만들기」](https://www.youtube.com/playlist?list=PLXDapDlSOTC8)** — 편마다 무엇을 정해야 하는지, AI에게 준 지시문, 확인 과정을 4~5분에 보여 준다. 2026-11-23부터 공개 중.

회사 이름·직원·글은 모두 지어낸 것이고, 코드는 이 시리즈를 위해 새로 썼다.

## 이 저장소로 할 수 있는 것

- 편마다 **시작 코드**에서 출발해, **지시문**을 AI 코딩 도구에 주고, **확인 스크립트**로 맞게 만들었는지 본다.
- 확인 스크립트는 되는 것만이 아니라 **안 되어야 하는 것**(다른 부서 직원이 주소를 직접 칠 때, 권한 없는 저장 요청 등)을 본다. 내 시스템의 시험을 짤 때 참고할 수 있다.
- [`docs/ai-runs.md`](docs/ai-runs.md): AI 가 지시문에 없어서 스스로 정한 것과, 스스로 밝힌 남은 약점. 예제를 그대로 운영에 쓰면 안 되는 이유도 여기에 있다.

이 코드는 설계를 보여 주는 **예제**다. 운영에 쓰려면 HTTPS, 비밀번호 정책, 속도 제한, 백업 보관, 기록 표의 계정 분리 같은 것이 더 필요하다.

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

| 편 | 만드는 것 | 지시문 | 확인 | 영상 |
|---|---|---|---|---|
| 1 | 부서 게시판: 다른 부서 글은 목록에도, 직접 주소로도 안 보인다 | `prompts/ep01.md` | `checks/ep01-board.test.js` | [보기](https://youtu.be/3ZjtOAxnpKI) (11/23) |
| 2 | 부서 이동: 지난 글에는 쓴 당시의 소속이 남는다 | `prompts/ep02.md` | `checks/ep02-transfer.test.js` | [보기](https://youtu.be/zNabsI4rkmY) (11/27) |
| 3 | 퇴사 처리: 열린 로그인까지 끊고, 작성 기록은 남긴다 | `prompts/ep03.md` | `checks/ep03-offboard.test.js` | [보기](https://youtu.be/UtDUzJLFAmw) (12/03) |
| 4 | 관리 화면: 시스템 관리자와 문서 열람 권한을 나눈다 | `prompts/ep04.md` | `checks/ep04-admin.test.js` | [보기](https://youtu.be/PeOUA8QGLjw) (12/09) |
| 5 | 첨부와 내보내기: 글을 볼 수 없으면 파일도 받을 수 없다 | `prompts/ep05.md` | `checks/ep05-files.test.js` | 12/15 공개 |
| 6 | 열람·변경 기록: 거부된 시도까지 남기고, 내용은 남기지 않는다 | `prompts/ep06.md` | `checks/ep06-audit.test.js` | [보기](https://youtu.be/BvPBZ5By-vw) (12/21) |
| 7 | 백업과 복원: 다른 DB 에 복원하고 원본과 대조한다 | `prompts/ep07.md` | `checks/ep07-backup.test.js` | [보기](https://youtu.be/z_oJB6PgvfQ) (12/25) |
| 8 | 승인 요청: 요청부터 승인·반려까지, 동시에 와도 하나만 | `prompts/ep08.md` | `checks/ep08-requests.test.js` | 12/31 공개 |

## 구조

```
migrations/   번호 붙은 SQL. 한 번씩만 적용된다
scripts/      migrate, seed(가상 데이터), reset, transfer(부서 이동), offboard(퇴사 처리),
              backup, restore, verify-restore(백업·복원·대조)
src/          app.js, auth.js(로그인·세션), policy.js(권한 판단), org.js(소속 이력·부서 이동·퇴사 처리), audit.js(기록), views.js(화면 틀),
              routes/(home, boards, files, admin, audit, requests)
checks/       확인 스크립트 (node:test)
prompts/      편마다 AI 에게 주는 지시문
```

## 승인 요청

직원이 요청을 올리고, 지정한 승인자 한 명이 승인하거나 반려한다 (`/requests`). 결재선·양식은 아직 없다.

- 요청은 올린 사람과 승인자 두 사람만 본다. 같은 부서도, 시스템 관리자도, 감사 담당도 못 본다. 볼 수 없는 요청은 없는 요청과 같은 404 다.
- 올린 뒤에는 제목·본문을 고칠 수 없다. 고치려면 취소하고 새로 올린다. 올린 사람의 소속·직급은 올린 당시 값이 남는다.
- 상태는 `pending` → `approved` / `rejected` / `cancelled` 로 한 번만 바뀐다. 승인·반려는 승인자만(반려는 의견 필수), 취소는 올린 사람만 한다.
  볼 수는 있지만 그 행동을 할 사람이 아니면 403, 이미 끝난 요청이면 409.
- 상태 변경은 `UPDATE ... WHERE id = $1 AND status = 'pending'` 한 문장이다. 동시에 두 처리가 와도 하나만 바뀌고 나머지는 409 다.
  DB 의 트리거도 끝난 요청의 변경과 제목·본문·당사자의 변경을 막는다.
- 승인자가 퇴사하면 상세에 `퇴사` 딱지가 붙고, 올린 사람은 그 대기 요청을 취소할 수 있다. 다른 승인자로 넘기는 기능은 없다.
- 기록: `request.create`, `request.read`, `request.approve`, `request.reject`, `request.cancel`. 404·403 은 `denied`, 409 와 없는 요청은 기록하지 않는다. 제목·본문·의견은 넣지 않는다.

## 기록(감사 기록)과 그 한계

누가 언제 무엇을 했는지 `audit_events` 표에 남긴다. 허용된 일뿐 아니라 거부된 시도도 남긴다. 기록 화면(`/audit`)은 `auditor` 역할만 볼 수 있다.

- 남기는 것: 누가, 무엇을(`action`), 어떤 대상에(종류와 번호), 결과(`ok`/`denied`), 언제, 어느 요청에서.
- 남기지 않는 것: 글 제목·본문, 파일 이름·내용, 비밀번호, 로그인에 실패한 아이디.
- 변경(글 저장, 첨부 올리기, 부서 이동, 퇴사 처리, 승인 요청 올리기·처리)의 `ok` 기록은 그 변경과 같은 트랜잭션에 넣는다. 변경이 되돌려지면 기록도 남지 않는다.
- `scripts/transfer.js`, `scripts/offboard.js` 로 한 변경도 기록된다. 로그인한 사람이 없으므로 `actor_id` 는 비어 있다.

기록은 추가만 한다. `UPDATE`, `DELETE`, `TRUNCATE` 는 DB 의 트리거가 막는다. 다만 알아 둘 한계가 있다.

- **DB 관리자 계정까지 막는 것은 아니다.** 표의 주인이나 슈퍼유저는 트리거를 끄거나 지울 수 있고, 표를 통째로 지울 수도 있다 (`npm run db:reset` 이 바로 그렇게 한다).
  그것까지 막으려면 기록을 다른 곳(별도 서버나 한 번만 쓸 수 있는 저장소)에 따로 보관해야 하고, 그건 이 예제의 범위 밖이다.
- 이 예제는 migration 을 돌리는 계정과 앱이 쓰는 계정이 같다. 그래서 앱 계정이 곧 표의 주인이다.
  실제로 쓸 때는 앱 계정을 따로 만들어 `audit_events` 에 `INSERT`, `SELECT` 만 주어야 "앱 계정으로는 고칠 수 없다"가 성립한다.
- 기록하는 일은 지시문의 표에 있는 것뿐이다. 로그아웃, 관리 화면·글쓰기 화면을 여는 것, CSRF 토큰이 틀린 요청, 로그인하지 않은 사람의 요청은 기록하지 않는다.
- 없는 대상(없는 글·게시판·첨부·직원·요청)을 향한 요청은 거부로 기록하지 않는다. 응답은 볼 수 없는 것과 똑같은 404 다.

## 백업과 복원

백업 파일이 있다는 것과 복원이 된다는 것은 다르다. 그래서 복원하면 곧바로 원본(백업 당시)과 대조하고, 하나라도 다르면 실패로 끝난다.

```sh
npm run backup                                   # .data/backups/<시각>/ 에 한 벌을 만들고 그 경로를 찍는다
npm run backup -- /mnt/backup/office-lab         # 다른 폴더에 둘 때
createdb office_lab_restore                      # 복원할 빈 DB 를 새로 만든다
npm run restore -- <백업 폴더> postgres://.../office_lab_restore /srv/office-lab/files-restore
npm run verify-restore -- <백업 폴더> postgres://.../office_lab_restore /srv/office-lab/files-restore   # 대조만 다시
```

백업 한 벌은 폴더 하나다.

- `db.dump` — `pg_dump -Fc`. 로그인 세션(`sessions`)은 표 구조만 있고 내용은 넣지 않는다.
- `files.tar.gz` — 첨부 파일 묶음. 그 시점의 `attachments` 행이 가리키는 파일만 넣는다.
- `manifest.json` — 만든 시각, 원본 DB, 적용된 migration 목록, 표마다 행 수와 내용 지문(md5), 첨부 파일마다 저장 이름·크기·sha256, 두 묶음의 sha256.

DB 와 파일은 같은 시점의 것을 한 벌로 다룬다. DB 스냅숏 하나를 열어 두고 `pg_dump --snapshot` 과 목록표의 숫자를 모두 그 스냅숏에서 읽으며,
파일은 그 스냅숏에 있는 첨부 행의 것만 묶는다. 원본에서 이미 첨부 행과 파일이 어긋나 있으면(파일이 없거나 크기가 다르면) 백업하지 않고 오류를 낸다.
도중에 실패하면 `<시각>.partial` 폴더를 지우므로, `<시각>` 폴더가 있으면 다 만들어진 백업이다.

**복원은 빈 DB 와 빈 폴더에만 한다.** 아래 중 하나라도 걸리면 아무것도 쓰지 않고 종료 코드 1 로 끝난다.

- 대상 DB 가 백업한 원본 DB 다 (서버 고유 번호·DB 이름·oid 로 알아본다).
- 대상 DB 에 표·뷰·시퀀스가 하나라도 있다. 운영 DB 위에 덮어쓰는 복원은 하지 않는다. 늘 새 DB 를 만들어 복원하고, 대조가 통과한 뒤에 앱이 그쪽을 보게 바꾼다.
- 대상 파일 폴더가 비어 있지 않다 (없으면 만든다).
- 백업이 온전하지 않다 (목록표가 없거나, 묶음의 sha256 이 목록표와 다르거나, 묶음 안 파일이 목록표와 다르다).

확인이 끝나면 `pg_restore --single-transaction --no-owner --no-acl` 로 DB 를 넣고(실패하면 대상 DB 는 빈 채로 남는다), 세션 표를 비우고, 파일 묶음을 푼 뒤 대조한다.
복원한 시스템에서는 **모두 다시 로그인한다.** 기록(`audit_events`)은 복원한 DB 에서도 그대로 추가만 할 수 있다.

대조(`verify-restore`)가 보는 것: migration 목록, 표마다 행 수와 내용 지문, 빠지거나 더 생긴 표, 남은 세션, 목록표의 파일마다 있는지·크기·sha256,
그리고 `attachments` 행과 폴더의 파일이 서로 빠짐없이 짝이 맞는지(행만 있거나 파일만 있으면 실패). 다른 곳을 한 줄씩 찍고, 하나라도 있으면 종료 코드 1.

알아 둘 한계:

- 백업 폴더에는 비밀번호 해시와 글·첨부가 그대로 들어 있다. 운영 DB 만큼 조심해서 보관한다 (이 예제는 백업을 암호화하지 않는다).
- 백업은 같은 서버 안의 폴더에 만든다. 서버가 통째로 없어져도 남게 하려면 백업 폴더를 다른 곳으로 옮겨 두어야 한다 (이 예제의 범위 밖).
- 원본 폴더에 있지만 DB 에 행이 없는 파일(고아 파일)은 백업에 넣지 않는다.
- 파일을 푸는 단계에서 실패하면 DB 는 이미 들어가 있다. 그 대상 DB 를 지우고 새로 만들어 다시 복원한다.
- 내용 지문은 같은 PostgreSQL 판끼리 비교하는 것을 전제로 한다. 판이 다른 서버로 옮기면 값 표기가 달라 "내용이 다릅니다" 가 나올 수 있다.

MIT License.
