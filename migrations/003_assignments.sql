-- 2편: 소속 이력, 그리고 글에 남기는 "쓴 당시의 소속"
-- users.department_id, users.title 은 "지금 소속"으로 그대로 둔다. 이 표는 그 이력이다.
-- ends_on 이 NULL 이면 지금 소속이다.
CREATE TABLE org_assignments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id),
  department_id bigint NOT NULL REFERENCES departments(id),
  title         text NOT NULL DEFAULT '',
  starts_on     date NOT NULL,
  ends_on       date NULL,
  CONSTRAINT org_assignments_period_check CHECK (ends_on >= starts_on)
);
-- 한 사람에게 열린 소속은 하나뿐 (겸직 없음). DB 가 막는다.
CREATE UNIQUE INDEX org_assignments_one_open_idx ON org_assignments(user_id) WHERE ends_on IS NULL;
CREATE INDEX org_assignments_user_id_idx ON org_assignments(user_id, starts_on);

-- 기존 사용자는 지금 소속으로 한 줄씩 채운다 (시작일 = 계정 생성일)
INSERT INTO org_assignments(user_id, department_id, title, starts_on)
SELECT id, department_id, title, created_at::date FROM users;

-- 글에 쓴 당시의 소속·직급을 남긴다. 기존 글은 작성자의 지금 소속·직급으로 채운 뒤 NOT NULL 을 건다.
ALTER TABLE posts ADD COLUMN author_department_name text, ADD COLUMN author_title text;

UPDATE posts p
   SET author_department_name = d.name, author_title = u.title
  FROM users u JOIN departments d ON d.id = u.department_id
 WHERE u.id = p.author_id;

ALTER TABLE posts
  ALTER COLUMN author_department_name SET NOT NULL,
  ALTER COLUMN author_title SET NOT NULL;
