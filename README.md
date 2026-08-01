# 백반기행 아카이브

TV조선 「식객 허영만의 백반기행」 전체 352개 회차를 회차별로 정리한 개인 아카이브 사이트입니다.

🔗 https://foodtrip-six.vercel.app

## 화면 구성

- **카드로 보기** (`/`) — 회차 목록 + 검색/정렬 + 상세보기(방송 본문, 방문 식당)
- **표로 보기** (`/table.html`) — 회차·식당명·소개된 메뉴·한줄평·주소를 표로, 도/시군구 다중선택 필터 지원
- **지도로 보기** (`/map.html`) — 좌표가 확인된 식당을 네이버 지도에 마커로 표시(마커 클러스터링)
- **편집 모드** — 관리자 비밀번호로 로그인 후 회차별 방문 식당 정보(이름/주소/메뉴/한줄평)를 직접 추가·수정 가능

## 기술 스택

- 프론트엔드: 정적 HTML/CSS/바닐라 JS (프레임워크·빌드 도구 없음)
- 백엔드: Vercel Serverless Functions (`api/`)
- DB: Supabase(Postgres)
- 인증: 관리자 비밀번호 + HMAC 서명 토큰(별도 세션 저장소 없음)
- 로그인 rate limit: Upstash Redis
- 주소 → 좌표 자동 변환: 카카오 로컬 API
- 지도: 네이버 지도 API

## 로컬 개발

```bash
npm install
npx vercel link      # 최초 1회, 기존 Vercel 프로젝트에 연결
npx vercel env pull .env.local   # Vercel에 등록된 환경변수 받아오기
npx vercel dev --listen 8000     # 반드시 8000번 포트 (지도 페이지의 네이버맵 API 도메인 화이트리스트가 localhost:8000만 등록되어 있음)
```

`.env.local`을 직접 구성하려면 `.env.local.example`을 참고하세요(Supabase, 관리자 비밀번호, Upstash, 카카오 키).

`vercel dev` 없이 정적 파일만 띄워도(`python -m http.server` 등) 카드/표/지도 조회는 정상 동작합니다 — API가 없으면 `public/data/*.json` 정적 스냅샷으로 자동 폴백하고, 로그인·저장 기능만 비활성됩니다.

## 데이터 파이프라인 (`crawler/`)

최초 데이터 수집·보강용 1회성 스크립트 모음입니다. 이미 실행이 끝나 결과가 Supabase/`seed/episodes.json`에 반영되어 있으므로, 평소 개발 시에는 실행할 필요가 없습니다.

- `crawl.py` — 방송 목록·상세 페이지 크롤링
- `regions.py` / `enrich.py` — 제목 기반 지역(시도) 추정
- `naver_place.py` / `enrich_naver.py` — 네이버 블로그의 장소 첨부 위젯에서 식당명·주소·좌표 추출
- `build_table.py` — `seed/episodes.json` → `public/data/table.json` 생성(표로 보기 정적 스냅샷)
- `seed_supabase.py` — `seed/episodes.json`을 Supabase에 적재

## 더 알아보기

- [`구축계획.md`](./구축계획.md) — 아키텍처와 설계 결정
- [`context-notes.md`](./context-notes.md) — 세션별 작업 이력과 트러블슈팅 기록
- [`checklist.md`](./checklist.md) — 구축 단계별 체크리스트

## 출처

TV조선 「식객 허영만의 백반기행」 방송 콘텐츠를 개인 아카이빙 목적으로 정리했습니다. 상업적 목적이 없으며, 원본 저작권은 TV조선에 있습니다.
