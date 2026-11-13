-- 3편: 퇴사 처리. 계정 행은 지우지 않고 상태만 바꾼다.
-- status 가 'left' 이면 퇴사한 사람이다. left_on 은 '그날부터 직원이 아닌 날'이다 (ends_on 과 같은 뜻).
ALTER TABLE users
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  ADD COLUMN left_on date NULL;
