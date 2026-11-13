-- 5편: 첨부 파일
-- 파일 내용은 DB 에 넣지 않는다. 디스크의 파일 폴더에 두고, 여기에는 이름·크기·종류와 저장 이름만 둔다.
-- storage_key 는 서버가 만든 무작위 값(UUID)이고, 디스크의 파일 이름이다. 올린 사람이 붙인 이름(original_name)은 경로에 쓰지 않는다.
CREATE TABLE attachments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id       bigint NOT NULL REFERENCES posts(id),
  storage_key   uuid NOT NULL UNIQUE,
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  content_type  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_post_id_idx ON attachments(post_id, id);
