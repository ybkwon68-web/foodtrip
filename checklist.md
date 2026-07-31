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
- [ ] 편집 API rate limit — 외부 상태 저장소 없이는 구현이 번거로워 보류 (알려진 한계)

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
- [ ] Vercel 프로젝트 연결 (정적 사이트, output=`public/`) — 사용자 준비되면 진행
- [ ] 배포된 URL에서 최종 동작 확인

## 5단계: Supabase 연동 (사용자 계정 필요, 다음 단계)
- [x] Supabase 프로젝트 생성 (`acshmogxwmoluuvjcytn`)
- [x] `supabase/migrations/0001_init.sql` 실행 (SQL 에디터에 붙여넣기)
- [x] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 확인 → `.env.local`에 저장(gitignore 대상, 커밋 안 됨)
- [x] `ADMIN_PASSWORD`(원하는 편집 비밀번호), `SESSION_SECRET`(임의의 긴 문자열) 정하기
- [x] `crawler/seed_supabase.py` 실행해 초기 데이터 적재 — 352/352건 성공, REST API로 건수 재확인 완료
- [x] 로컬에서 `/api/auth`·`/api/episodes`·`/api/episodes/[id]` 핸들러를 실제 프로덕션 Supabase에 직접 호출해 로그인/인증거부/목록조회/PUT수정/원상복구 종단 간 검증 (7단계 전부 통과)
- [ ] Vercel 프로젝트에 위 4개 환경변수 등록 (사용자 Vercel 계정 필요)
- [ ] 배포된 실제 URL(브라우저)에서 로그인 → 식당 정보 수정 → 저장 반영 최종 확인
