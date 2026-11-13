-- 1편: 부서 게시판
-- department_id 가 NULL 이면 전 직원이 보는 게시판이다.
CREATE TABLE boards (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL UNIQUE,
  department_id bigint NULL REFERENCES departments(id)
);

CREATE TABLE posts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id    bigint NOT NULL REFERENCES boards(id),
  author_id   bigint NOT NULL REFERENCES users(id),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_board_id_idx ON posts(board_id, created_at DESC);
