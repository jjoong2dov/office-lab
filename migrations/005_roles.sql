-- 4편: 역할. 역할은 "무엇을 할 수 있나"를 준다. 지금은 system_admin(계정·조직 관리) 하나뿐이다.
-- 게시판을 볼 수 있는지는 이 표와 관계없다 (소속 부서로만 정한다).
-- 표에 없는 역할 이름은 CHECK 가 막는다. 역할을 늘릴 때는 새 migration 으로 CHECK 를 고친다.
CREATE TABLE user_roles (
  user_id bigint NOT NULL REFERENCES users(id),
  role    text NOT NULL CHECK (role IN ('system_admin')),
  PRIMARY KEY (user_id, role)
);
