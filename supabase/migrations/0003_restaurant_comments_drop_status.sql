-- 제보(댓글) 승인/거부 단계를 없애고 작성 즉시 공개하는 방식으로 단순화 — status 컬럼과
-- 관련 인덱스를 제거한다. 관리자는 이제 부적절한 제보를 "삭제"로만 정리한다.
drop index if exists restaurant_comments_episode_status_idx;
drop index if exists restaurant_comments_status_created_idx;

alter table restaurant_comments drop column if exists status;

create index if not exists restaurant_comments_episode_idx on restaurant_comments (episode);
create index if not exists restaurant_comments_created_idx on restaurant_comments (created_at desc);
