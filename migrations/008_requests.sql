-- 8편: 승인 요청. 올린 사람(requester)과 승인자(approver) 한 명, 두 사람만 보는 요청이다.
-- 올린 뒤에는 제목·본문을 고치지 않는다 (고치는 경로가 없다). 고치려면 취소하고 새로 올린다.
-- 상태는 pending → approved / rejected / cancelled 로 한 번만 바뀐다. 끝난 요청은 다시 바뀌지 않는다
--   (앱은 UPDATE ... WHERE status = 'pending' 한 문장으로 바꾸고, 아래 트리거가 DB 에서도 한 번 더 막는다).
-- 올린 사람의 소속·직급은 올린 당시 값을 남긴다 (2편의 글과 같은 이유).
CREATE TABLE requests (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id              bigint NOT NULL REFERENCES users(id),
  approver_id               bigint NOT NULL REFERENCES users(id),
  title                     text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body                      text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  requester_department_name text NOT NULL,
  requester_title           text NOT NULL,
  status                    text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decision_note             text NULL CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 1000),
  decided_at                timestamptz NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requests_not_self_check CHECK (requester_id <> approver_id),
  -- 대기 중이면 처리 시각이 없고, 끝났으면 있다.
  CONSTRAINT requests_decided_check CHECK ((status = 'pending') = (decided_at IS NULL)),
  -- 반려에는 의견이 꼭 있다.
  CONSTRAINT requests_reject_note_check CHECK (status <> 'rejected' OR decision_note IS NOT NULL)
);
CREATE INDEX requests_requester_idx ON requests(requester_id, created_at DESC);
CREATE INDEX requests_approver_idx ON requests(approver_id, created_at DESC);

-- 끝난 요청은 다시 바뀌지 않고, 제목·본문·당사자·당시 소속은 올린 뒤 바뀌지 않는다. 앱 밖에서 고쳐도 DB 가 막는다.
CREATE FUNCTION requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION '끝난 요청(%)은 바꿀 수 없습니다.', OLD.id;
  END IF;
  IF NEW.requester_id IS DISTINCT FROM OLD.requester_id OR NEW.approver_id IS DISTINCT FROM OLD.approver_id
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.requester_department_name IS DISTINCT FROM OLD.requester_department_name
     OR NEW.requester_title IS DISTINCT FROM OLD.requester_title
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '요청(%)의 내용은 올린 뒤 바꿀 수 없습니다.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER requests_guard BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION requests_guard();
