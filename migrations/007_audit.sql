-- 6편: 기록(감사 기록). 누가, 무엇을, 어떤 대상에, 결과가 어땠는지, 언제, 어느 요청에서.
-- 글 제목·본문, 파일 이름·내용, 비밀번호, 로그인에 실패한 아이디는 넣지 않는다 (이 표가 또 하나의 유출 경로가 되지 않게).
-- actor_id 가 NULL 이면 로그인하지 않은 쪽의 일이다 (로그인 실패, 스크립트로 한 변경).
-- resource_type 이 NULL 이면 대상이 없는 일이다 (로그인 실패, 기록 화면 열람).
-- resource_id 에는 외래 키를 걸지 않는다 (대상의 종류가 여러 가지다).
CREATE TABLE audit_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_id      bigint NULL REFERENCES users(id),
  action        text NOT NULL,
  resource_type text NULL,
  resource_id   bigint NULL,
  result        text NOT NULL CHECK (result IN ('ok','denied')),
  request_id    uuid NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT audit_events_resource_check CHECK (resource_type IS NOT NULL OR resource_id IS NULL)
);
CREATE INDEX audit_events_action_idx ON audit_events(action, id DESC);

-- 기록은 추가만 한다. 고치기·지우기·비우기는 DB 가 막는다 (줄이 하나도 걸리지 않는 문장도 막히게 문장 단위로 건다).
CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '기록(audit_events)은 추가만 할 수 있습니다 (% 불가).', TG_OP;
END;
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();

-- 역할에 auditor(기록 열람)를 더한다. system_admin 과는 따로다.
ALTER TABLE user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN ('system_admin','auditor'));
