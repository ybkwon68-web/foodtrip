# 백반기행 웹페이지 구축 체크리스트

## 0단계: 2026-07-30 추가 범위 (식당명/주소 + 지도 링크 + 편집 기능)
- [x] 지역 추정 스크립트: 제목 텍스트 → 사전 매칭으로 지역 후보 추출 (`crawler/regions.py`, 신뢰도 낮음을 "미검수" 배지로 표시)
- [x] 네이버 블로그 검색 기반 식당명/주소/좌표 수집 (`crawler/naver_place.py`, `enrich_naver.py`) — 352건 중 212건(456곳) 확보(오매칭 8건 발견·수정 후 수치), 상세는 context-notes.md 참고
- [x] `supabase/migrations/0001_init.sql` 스키마 작성 — **Supabase 프로젝트 자체는 사용자 계정 필요, 아직 생성 안 됨**
- [x] `api/episodes.js` (GET), `api/episodes/[id].js` (GET/PUT) 서버리스 함수 작성 + mock Supabase로 로직 검증
- [x] `api/auth.js` 관리자 비밀번호 인증 및 토큰 발급 (HMAC 서명, 세션 테이블 없이 상태 없는 검증) + 단위테스트 통과
- [x] `crawler/seed_supabase.py` 최초 데이터 적재 스크립트 작성 — **실행은 Supabase 프로젝트 생성 후**
- [x] 프론트 편집 모드 UI — 이제 실제 `/api/auth`·`/api/episodes/:id` PUT을 호출하도록 연결 (API 없는 로컬 환경에서는 정적 JSON 폴백 + 로그인 실패 메시지)
- [x] 네이버맵 링크 생성 로직 — placeId 있으면 정확한 장소 페이지로, 없으면 `식당명 + 주소` 검색으로 연결
- [x] 편집 API rate limit — Upstash Redis(REST API)로 IP당 10분에 5회 제한 구현(`lib/rateLimit.js`), 프로덕션에서 6회 연속 로그인 시도로 5회까지 정상·6회째 429 확인

## 1단계: 크롤러
- [x] `crawler/crawl.py`에 목록 페이지 파싱 로직 작성 (셀렉터: `ul.item-list.col-4.wrap > li > a.vd-link`)
- [x] 1페이지만 실행해 결과 검증 (20개 항목, 제목/날짜/링크/썸네일 정상 추출 확인)
- [x] 18페이지 전체 목록 수집 실행 및 항목 수 검증 → 352건, 결번/중복 없음
- [x] 상세페이지 파싱 로직 작성 (셀렉터: `.board-view .cont-box`)
- [x] 상세페이지 샘플 몇 건 실행해 본문 HTML 정상 추출 확인
- [x] 전체 상세페이지 크롤링 실행 (352건, 실패 0건)
- [x] 회차번호 정규식 추출 검증 (실패 0건)
- [x] `seed/episodes.json` 생성 및 데이터 정합성 확인 (1~352회 결번·중복 없음 확인)

## 2단계: 웹페이지
- [x] `public/index.html` 기본 레이아웃 작성
- [x] `script.js`: episodes.json fetch 및 목록 카드 렌더링
- [x] 검색 기능 (제목·지역 텍스트 필터)
- [x] 정렬 기능 (최신순/회차순)
- [x] 상세 뷰 렌더링 (URL 해시 라우팅, 본문 HTML 삽입 + DOMPurify sanitize)
- [x] `style.css` 반응형 카드 레이아웃 (모바일/데스크톱)
- [x] 이미지 로드 정상 여부 확인 → 핫링크 차단 없음 확인, 다만 http 이미지 URL을 https로 강제 변환 필요해 크롤러에 반영함(mixed content 방지)

## 3단계: 로컬 테스트 (Playwright로 실제 확인)
- [x] 목록 전체 렌더링/카드 클릭 → 상세 이동 골든패스 확인
- [x] 검색 결과 없음 케이스 확인
- [x] 검색 결과 있음(부산 7건) 케이스 확인
- [x] 편집 모드 토글, 상세 화면 인라인 편집 폼 열기/닫기 확인
- [x] 모바일 화면 크기(390px)에서 레이아웃 확인 — 카드 2열, 헤더 컨트롤 줄바꿈 정상

## 3-1단계: 회차별 요약표 페이지 (2026-07-30 추가)
- [x] `public/table.html` + `table.js`: 회차/식당명/소개된메뉴/한줄평/도·시군구/상세주소 표 (별도 페이지, 카드 화면과 상호 링크)
- [x] 소개된메뉴·한줄평은 4개 subagent가 방송 본문을 직접 읽어 작성 (220개 회차, 최종 456개 식당분)
- [x] 네이버 매칭 오류 발견 및 수정 — 8개 그룹 13개 회차가 다른 회차와 동일한 식당 세트를 공유하던 버그 확인, 8개 회차는 전체 초기화·2개 회차는 항목 일부만 제거. `naver_place.py`에 지역 교차검증 추가해 재발 방지
- [x] Playwright로 표 페이지, 오류 수정 반영 재검증

## 4단계: 배포
- [x] `git init` 및 최초 커밋
- [x] GitHub 원격 저장소 push (`ybkwon68-web/foodtrip`, main 브랜치)
- [x] Vercel 프로젝트 연결 (`ybkwon68-5258s-projects/foodtrip`, `vercel link`)
- [x] 배포된 URL에서 최종 동작 확인 — 프로덕션(`https://foodtrip-six.vercel.app`)에서 목록/episodes API/로그인/인증거부/PUT저장/원상복구 curl로 전부 확인

## 5단계: Supabase 연동 (사용자 계정 필요, 다음 단계)
- [x] Supabase 프로젝트 생성 (`acshmogxwmoluuvjcytn`)
- [x] `supabase/migrations/0001_init.sql` 실행 (SQL 에디터에 붙여넣기)
- [x] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 확인 → `.env.local`에 저장(gitignore 대상, 커밋 안 됨)
- [x] `ADMIN_PASSWORD`(원하는 편집 비밀번호), `SESSION_SECRET`(임의의 긴 문자열) 정하기
- [x] `crawler/seed_supabase.py` 실행해 초기 데이터 적재 — 352/352건 성공, REST API로 건수 재확인 완료
- [x] 로컬에서 `/api/auth`·`/api/episodes`·`/api/episodes/[id]` 핸들러를 실제 프로덕션 Supabase에 직접 호출해 로그인/인증거부/목록조회/PUT수정/원상복구 종단 간 검증 (7단계 전부 통과)
- [x] Vercel 프로젝트에 위 4개 환경변수 등록 (Production/Preview/Development 3개 환경 모두)
- [x] 배포된 실제 URL(curl)에서 로그인 → 식당 정보 수정 → 저장 반영 최종 확인

## 6단계: 2026-07-31 데이터 보강 + 지도 페이지 추가
- [x] 서브에이전트 오작동(임의 커밋/푸시/파일 오염) 수습 및 데이터 정합성 복구
- [x] 네이버 블로그 자동 재검색 + 오매칭 방지 로직 3종 추가(부분 문자열 오매칭, 키워드 교차검증, 식당 place_id 전역 중복 방지)
- [x] 남은 미확보 회차 직접 조사(웹검색) — 240→270/352(77%) 확보, 근거 부족한 건 비워둠
- [x] 미확보 82개 회차 목록 CSV 생성(`미확보_회차_목록.csv`, 수작업 조사용)
- [x] 헤더 UI 정리(제작자 표시, 네이버맵 링크 문구 축소), 상세화면 상세주소 노출
- [x] 요약표에 도/시군구 다중선택 필터(엑셀 자동필터 스타일, 상호 종속) 추가
- [x] **지도로 보기 페이지 추가** — 네이버 지도 API(Client ID 발급받음)로 좌표 있는 식당 전부 마커 표시, 확대/축소, 검색 필터, 마커 클릭 시 인포윈도우(회차·주소·링크). 해외 특집 회차 좌표 때문에 초기 화면이 과도하게 축소되는 문제 수정(국내 좌표 기준으로 fitBounds)
- [x] 사용자가 라이브 사이트에서 직접 편집한 260·352회 데이터를 재적재 전 로컬과 동기화(데이터 유실 방지) → Supabase 재적재 완료, 프로덕션 270/352 확인

## 7단계: 2026-07-31 PC 이전 + 라이브 편집 반영 버그 수정
- [x] PC 이전 후 로컬 개발 환경 복구 (`.env.local` Vercel에서 pull, `npm install`, `vercel link`)
- [x] 표로 보기가 편집 화면 저장 내용을 반영하지 않던 버그 수정 (`table.js`가 정적 스냅샷 대신 `/api/episodes` 우선 조회하도록 변경)
- [x] 지도로 보기에 신규/주소변경 식당 마커가 안 뜨는 문제 해결 — NCP Geocoding 대신 Kakao Local API로 전환하여 좌표 자동조회 연동 완료
- [x] 표로 보기 수정사항 및 지오코딩 API 변경본 프로덕션 배포 완료 (Vercel GitHub 자동 배포 연동 확인)
- [x] 지도로 보기 마커 클러스터링 도입 (네이버 공식 `MarkerClustering.js` 자체 호스팅, 밀집 지역 가독성·성능 개선)

