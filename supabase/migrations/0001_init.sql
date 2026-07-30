-- 백반기행 아카이브 episodes 테이블: 크롤링 데이터 + 관리자가 편집하는 식당 정보를 함께 저장
create table if not exists episodes (
  episode integer primary key,
  title text,
  raw_title text,
  air_date date,
  thumbnail text,
  detail_url text,
  body_html text,
  region text,
  restaurants jsonb not null default '[]'::jsonb,
  restaurants_source_url text,
  verified boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists episodes_air_date_idx on episodes (air_date desc);

-- updated_at을 행이 바뀔 때마다 자동 갱신
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists episodes_set_updated_at on episodes;
create trigger episodes_set_updated_at
  before update on episodes
  for each row
  execute function set_updated_at();

-- RLS 활성화: 클라이언트는 Supabase에 직접 접근하지 않고 /api 서버리스 함수(서비스 키)를 통해서만
-- 접근하므로, 익명 anon 키로는 아무 것도 못 하도록 기본적으로 막아둔다.
alter table episodes enable row level security;
