const { test, summary, assert } = require('./helpers');
const {
  findUrlInText,
  extractNaverBlogPlaces,
  extractTvChosunBroadcast,
  extractKeywords,
  titleMatchesEpisode,
  regionConflicts,
} = require('../lib/lookup');

test('findUrlInText returns the first URL from text', () => {
  assert.strictEqual(findUrlInText('방송 페이지 https://example.com/detail.html 참조'), 'https://example.com/detail.html');
  assert.strictEqual(findUrlInText('https://blog.naver.com/test/12345 추가 텍스트'), 'https://blog.naver.com/test/12345');
  assert.strictEqual(findUrlInText('URL이 없습니다.'), null);
});

test('extractNaverBlogPlaces returns places from v2_map module JSON', () => {
  const example = `<!doctype html><html><head><meta property="og:title" content="테스트 블로그"><meta property="og:description" content="한줄평"></head><body><div data-module='{"type":"v2_map","data":{"places":[{"name":"가게","address":"서울","tel":"010-1234-5678","latlng":{"latitude":37.5,"longitude":127.0},"placeId":"123"}]}}'></div></body></html>`;
  const result = extractNaverBlogPlaces(example);
  assert.strictEqual(result.title, '테스트 블로그');
  assert.strictEqual(result.description, '한줄평');
  assert.strictEqual(result.places.length, 1);
  assert.strictEqual(result.places[0].name, '가게');
  assert.strictEqual(result.places[0].address, '서울');
  assert.strictEqual(result.places[0].place_id, '123');
});

test('extractNaverBlogPlaces는 페이지 og:description을 식당별 review에 자동으로 넣지 않는다(139/157회 사고 재현)', () => {
  // 실측 사고: 블로그 하나의 페이지 요약이 "오늘 방송된 백반기행의 제목입니다..." 같은
  // 식당과 무관한 문구였는데, 그 글에서 찾은 모든 식당의 review에 그대로 복사돼 들어갔음.
  // review는 사람이 방송 본문을 보고 직접 채워야 하므로 여기서는 항상 null이어야 한다.
  const example = `<!doctype html><html><head><meta property="og:title" content="블로그"><meta property="og:description" content="오늘 방송된 백반기행의 제목입니다"></head><body><div data-module='{"type":"v2_map","data":{"places":[{"name":"가게1","address":"서울"},{"name":"가게2","address":"부산"}]}}'></div></body></html>`;
  const result = extractNaverBlogPlaces(example);
  assert.strictEqual(result.places.length, 2);
  assert.strictEqual(result.places[0].review, null);
  assert.strictEqual(result.places[1].review, null);
  assert.strictEqual(result.description, '오늘 방송된 백반기행의 제목입니다'); // 페이지 요약 자체는 별도로 계속 반환
});

test('extractTvChosunBroadcast returns metadata and body_html for broadcast detail HTML', () => {
  const html = `<!doctype html><html><head><meta property="og:title" content="123회 테스트"><meta property="og:description" content="방송 설명"><meta property="og:image" content="https://img.example.com/thumb.jpg"></head><body><div class="board-view"><div class="cont-box"><p>본문</p><img src="http://img.example.com/photo.jpg"></div></div></body></html>`;
  const result = extractTvChosunBroadcast(html, 'https://broadcast.tvchosun.com/detail');
  assert.strictEqual(result.raw_title, '123회 테스트');
  assert.strictEqual(result.title, '테스트');
  assert.strictEqual(result.episode, 123);
  assert.strictEqual(result.thumbnail, 'https://img.example.com/thumb.jpg');
  assert.ok(result.body_html.includes('https://img.example.com/photo.jpg'));
  assert.strictEqual(result.detail_url, 'https://broadcast.tvchosun.com/detail');
});

test('extractKeywords는 흔한 단어(백반기행/밥상/나들이 등)를 제외한 지명·핵심어만 남긴다', () => {
  const keywords = extractKeywords('맛있는 아지트! 송추 장흥 밥상');
  assert.ok(keywords.includes('송추'));
  assert.ok(keywords.includes('장흥'));
  assert.ok(!keywords.includes('밥상'));
});

test('titleMatchesEpisode는 "백반기행" 언급이 없는 글은 무조건 거절한다(168회 사고 재현)', () => {
  // 실제 사고: 168회를 검색했는데 회차번호와 우연히 겹치는 인스타 계정("168_7cm")이 언급된
  // 무관한 블로그가 채택됐음 — 그 글 제목엔 "백반기행"이 없었으므로 이 검증으로 막힌다.
  assert.strictEqual(titleMatchesEpisode('춘천 서면, 풀장횟집 🔎인스타 168_7cm', 168, []), false);
});

test('titleMatchesEpisode는 "44회"가 "344회"에 부분 문자열로 오매칭되지 않게 전체 숫자로 비교한다', () => {
  assert.strictEqual(titleMatchesEpisode('백반기행 344회 완도 밥상', 44, ['완도']), false);
  assert.strictEqual(titleMatchesEpisode('백반기행 344회 완도 밥상', 344, ['완도']), true);
});

test('titleMatchesEpisode는 회차번호가 맞아도 방송 키워드가 하나도 안 겹치면 거절한다(블로거 오기 대비)', () => {
  assert.strictEqual(titleMatchesEpisode('백반기행 139회 부산 완전정복', 139, ['여주', '추어탕']), false);
  assert.strictEqual(titleMatchesEpisode('백반기행 139회 여주 나들이 밥상', 139, ['여주', '추어탕']), true);
});

test('titleMatchesEpisode는 회차번호 언급이 없으면 키워드 겹침만으로 판단한다', () => {
  assert.strictEqual(titleMatchesEpisode('백반기행 여주 추어탕 맛집', null, ['여주', '추어탕']), true);
  assert.strictEqual(titleMatchesEpisode('백반기행 부산 맛집', null, ['여주', '추어탕']), false);
});

test('regionConflicts는 식당 주소가 전부 예상 지역과 다르면 오매칭으로 판단한다(139/157회 사고 재현)', () => {
  // 실제 사고: "여주" 회차인데 전남 강진·서울 영등포 등 무관한 지역 식당이 채택됐음
  const wrongPlaces = [{ address: '전라남도 강진군 도암면 ...' }, { address: '서울특별시 영등포구 ...' }];
  assert.strictEqual(regionConflicts(wrongPlaces, '경기도'), true);
  const rightPlaces = [{ address: '경기도 여주시 강천면 ...' }];
  assert.strictEqual(regionConflicts(rightPlaces, '경기도'), false);
});

test('regionConflicts는 예상 지역이나 주소 정보가 없으면 판단을 보류한다', () => {
  assert.strictEqual(regionConflicts([{ address: '경기도 여주시' }], null), false);
  assert.strictEqual(regionConflicts([], '경기도'), false);
});

summary('lookup');
