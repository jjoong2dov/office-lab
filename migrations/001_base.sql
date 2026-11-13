-- 기반: 부서, 사용자, 로그인 세션
CREATE TABLE departments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE
);

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  title         text NOT NULL DEFAULT '',          -- 직급 (사원, 대리, 과장, 팀장)
  password_hash text NOT NULL,
  department_id bigint NOT NULL REFERENCES departments(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 세션: 쿠키에는 무작위 값, DB 에는 그 해시만 둔다
CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id),
  csrf_token  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
