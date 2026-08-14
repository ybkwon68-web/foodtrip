-- 식당별 폐업/이전 등 정보 제보(댓글)를 담는 테이블. 누구나 작성할 수 있지만 pending 상태로만
-- 저장되고, 관리자가 편집 모드의 "제보 관리" 페이지에서 승인(approved)해야 해당 식당 카드에
-- 다른 방문자에게도 공개된다.
create table if not exists restaurant_comments (
  id uuid primary key default gen_random_uuid(),
  episode integer not null references episodes(episode) on delete cascade,
  restaurant_name text not null,
  content text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- 공개 화면: 회차+승인 상태로 조회. 관리자 화면: 상태별 최신순 조회.
create index if not exists restaurant_comments_episode_status_idx on restaurant_comments (episode, status);
create index if not exists restaurant_comments_status_created_idx on restaurant_comments (status, created_at desc);

-- RLS 활성화: episodes 테이블과 동일하게, 클라이언트는 /api 서버리스 함수(서비스 키)를 통해서만 접근한다.
alter table restaurant_comments enable row level security;
