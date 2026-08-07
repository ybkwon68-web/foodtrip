const { test, summary, assert } = require('./helpers');
const {
  haversineKm,
  minutesToRadiusKm,
  resolveRadiusMinutes,
  buildCandidateList,
  excludeCandidates,
  toPromptCandidates,
  extractRadiusMinutes,
  extractRelevanceKeywords,
  extractOwnOrigin,
  extractIntentLocal,
  computeCentroid,
  extractMeetupOrigins,
  parseRecommendResponse,
  stripBodyHtml,
} = require('../lib/recommend');

test('haversineKm은 같은 지점이면 0, 서울-부산은 약 300km대를 반환한다', () => {
  assert.strictEqual(haversineKm({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 }), 0);
  const seoulBusan = haversineKm({ lat: 37.5665, lng: 126.978 }, { lat: 35.1796, lng: 129.0756 });
  assert.ok(seoulBusan > 300 && seoulBusan < 340, `실제값: ${seoulBusan}`);
});

test('minutesToRadiusKm은 분을 km로 환산하고 최소·최대 범위로 자른다', () => {
  assert.strictEqual(minutesToRadiusKm(60), 48);
  assert.strictEqual(minutesToRadiusKm(1), 5); // 최소값 미만은 5km로 보정
  assert.strictEqual(minutesToRadiusKm(1000), 250); // 최대값 초과는 250km로 보정
  assert.strictEqual(minutesToRadiusKm(null), null);
  assert.strictEqual(minutesToRadiusKm(0), null);
  assert.strictEqual(minutesToRadiusKm(-10), null);
});

test('resolveRadiusMinutes는 명시된 이동시간이 없으면 기본값(60분)을 쓴다', () => {
  assert.strictEqual(resolveRadiusMinutes(30), 30);
  assert.strictEqual(resolveRadiusMinutes(null), 60);
  assert.strictEqual(resolveRadiusMinutes(undefined), 60);
  assert.strictEqual(resolveRadiusMinutes(0), 60);
});

const sampleEpisodes = [
  {
    episode: 1,
    title: '과천 밥상',
    region: '경기도 과천시',
    verified: true,
    restaurants: [
      { name: '가까운집', address: '경기도 과천시', lat: 37.43, lng: 126.99, menu: '백반', review: '조용한 곳' },
    ],
  },
  {
    episode: 2,
    title: '부산 밥상',
    region: '부산광역시',
    verified: false,
    restaurants: [
      { name: '먼집', address: '부산광역시', lat: 35.1796, lng: 129.0756, menu: '해산물', review: '' },
    ],
  },
  {
    episode: 3,
    title: '좌표없음 밥상',
    region: '충청남도',
    verified: true,
    restaurants: [{ name: '좌표없는집', address: '충청남도', lat: null, lng: null, menu: '', review: '' }],
  },
];

test('buildCandidateList는 origin+radiusKm이 있으면 반경 밖 식당과 좌표 없는 식당을 제외하고 거리순 정렬한다', () => {
  const origin = { lat: 37.43, lng: 126.99 }; // 과천 부근
  const candidates = buildCandidateList(sampleEpisodes, { origin, radiusKm: 50 });
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].name, '가까운집');
  assert.strictEqual(typeof candidates[0].distance_km, 'number');
});

test('buildCandidateList는 origin이 없으면 좌표 없는 식당도 포함하고 verified를 우선한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  assert.strictEqual(candidates.length, 3);
  assert.strictEqual(candidates[0].verified, true);
});

test('buildCandidateList는 origin이 없어도 질의 키워드와 관련도가 높은 후보를 verified보다 우선한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, { query: '해산물 먹고 싶어' });
  assert.strictEqual(candidates[0].name, '먼집'); // verified: false지만 menu가 "해산물"과 일치
});

test('buildCandidateList는 질의에 관련 키워드가 없으면 기존처럼 verified를 우선한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, { query: '아무거나 알려줘' });
  assert.strictEqual(candidates[0].verified, true);
});

test('extractRelevanceKeywords는 조사/필러 단어와 짧은 토큰을 제외하고 핵심 키워드만 남긴다', () => {
  assert.deepStrictEqual(
    extractRelevanceKeywords('지금 나는 해산물이 먹고 싶어, 조용한 곳으로 알려줘'),
    ['해산물이', '조용한', '곳으로']
  );
  assert.deepStrictEqual(extractRelevanceKeywords(''), []);
  assert.deepStrictEqual(extractRelevanceKeywords(null), []);
});

test('toPromptCandidates는 좌표·전화번호 등 불필요한 필드를 제거한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  const prompt = toPromptCandidates(candidates);
  assert.ok(!('lat' in prompt[0]));
  assert.ok(!('place_id' in prompt[0]));
  assert.ok('name' in prompt[0] && 'region' in prompt[0]);
});

test('toPromptCandidates는 broadcast_excerpt가 있는 후보만 그 필드를 포함한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  candidates[0].broadcast_excerpt = '조용하고 아늑한 분위기의 밥집이었다.';
  const prompt = toPromptCandidates(candidates);
  assert.strictEqual(prompt[0].broadcast_excerpt, '조용하고 아늑한 분위기의 밥집이었다.');
  assert.ok(!('broadcast_excerpt' in prompt[1]));
});

test('stripBodyHtml은 태그·엔티티를 제거하고 공백을 정리한다', () => {
  const html = '<p style="font-size: 11pt;">이 집은 <b>정겨운&nbsp;분위기였다.</b></p>\n<p>&quot;맛있다&quot;</p>';
  assert.strictEqual(stripBodyHtml(html), '이 집은 정겨운 분위기였다. "맛있다"');
});

test('stripBodyHtml은 maxLen을 넘으면 자르고 말줄임표를 붙인다', () => {
  const html = `<p>${'가'.repeat(600)}</p>`;
  const result = stripBodyHtml(html, 500);
  assert.strictEqual(result.length, 503); // 500자 + '...'
  assert.ok(result.endsWith('...'));
});

test('stripBodyHtml은 빈 값이면 빈 문자열을 반환한다', () => {
  assert.strictEqual(stripBodyHtml(''), '');
  assert.strictEqual(stripBodyHtml(null), '');
  assert.strictEqual(stripBodyHtml(undefined), '');
});

test('excludeCandidates는 이전에 보여준 (episode,name)만 후보에서 제외한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  const filtered = excludeCandidates(candidates, [{ episode: 1, name: '가까운집' }]);
  assert.strictEqual(filtered.length, 2);
  assert.ok(!filtered.some((c) => c.name === '가까운집'));
});

test('excludeCandidates는 제외 목록이 비어있으면 후보를 그대로 반환한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  assert.strictEqual(excludeCandidates(candidates, []), candidates);
  assert.strictEqual(excludeCandidates(candidates, undefined), candidates);
});

test('extractRadiusMinutes는 "N시간"/"N분"/"N시간 M분" 표현에서 분 단위 숫자를 뽑는다', () => {
  assert.strictEqual(extractRadiusMinutes('과천에서 이동거리 1시간 이내로'), 60);
  assert.strictEqual(extractRadiusMinutes('30분 이내 식당'), 30);
  assert.strictEqual(extractRadiusMinutes('1시간 30분 정도면 좋겠어'), 90);
  assert.strictEqual(extractRadiusMinutes('가까운 곳으로 추천해줘'), null);
  assert.strictEqual(extractRadiusMinutes(''), null);
});

test('extractIntentLocal은 Gemini 호출 없이 출발지·이동시간을 함께 추출한다', () => {
  assert.deepStrictEqual(extractIntentLocal('지금 나는 과천인데, 이동거리 1시간 이내로 알려줘'), {
    origin: '경기도 과천시',
    originExplicit: true,
    ambiguousOrigin: null,
    radiusMinutes: 60,
  });
  assert.deepStrictEqual(extractIntentLocal('그냥 아무 데나 알려줘'), {
    origin: null,
    originExplicit: false,
    ambiguousOrigin: null,
    radiusMinutes: null,
  });
});

test('extractOwnOrigin은 1인칭 문맥("지금 나는 ~")으로 명시된 지명을 explicit:true로 최우선 채택한다', () => {
  assert.deepStrictEqual(extractOwnOrigin('지금 전주인데 맛있는집 추천해줘'), {
    origin: '전북특별자치도 전주시',
    explicit: true,
    ambiguous: null,
  });
  assert.deepStrictEqual(extractOwnOrigin('저는 과천에 사는데 조용한 곳 알려줘'), {
    origin: '경기도 과천시',
    explicit: true,
    ambiguous: null,
  });
});

test('extractOwnOrigin은 3인칭 문맥("친구는 ~")으로만 언급된 지명은 후보에서 제외한다(강남 오인식 사고 재현)', () => {
  const q = '친구들과 저녁식사와 술한잔을 같이 할 장소를 추천해줘. 친구들은 위례, 서울 강남이 집이라 셋이 모이기 편한곳으로';
  assert.deepStrictEqual(extractOwnOrigin(q), { origin: null, explicit: false, ambiguous: null });
});

test('extractOwnOrigin은 1인칭·3인칭 지명이 함께 나오면 1인칭 쪽만 채택한다', () => {
  const q = '친구는 강남에 살고, 나는 지금 과천이야';
  assert.deepStrictEqual(extractOwnOrigin(q), { origin: '경기도 과천시', explicit: true, ambiguous: null });
});

test('extractOwnOrigin은 화자 표현이 전혀 없으면 기존 규칙(긴 이름/뒤쪽 우선)으로 explicit:false 채택한다', () => {
  assert.deepStrictEqual(extractOwnOrigin('과천에서 이동거리 1시간 이내로'), {
    origin: '경기도 과천시',
    explicit: false,
    ambiguous: null,
  });
});

test('extractOwnOrigin은 "광주"처럼 동명이지역인 지명은 확정하지 않고 후보 목록과 함께 되묻기 신호를 준다', () => {
  const result = extractOwnOrigin('지금 광주인데 맛있는집 추천해줘');
  assert.strictEqual(result.origin, null);
  assert.strictEqual(result.explicit, false);
  assert.deepStrictEqual(new Set(result.ambiguous.options), new Set(['광주광역시', '경기도 광주시']));
  assert.strictEqual(result.ambiguous.name, '광주');
});

test('extractOwnOrigin은 "경기도 광주"처럼 구체적으로 쓰면 동명이지역이어도 바로 확정한다', () => {
  assert.deepStrictEqual(extractOwnOrigin('지금 경기도 광주인데 맛있는집 추천해줘'), {
    origin: '경기도 광주시',
    explicit: true,
    ambiguous: null,
  });
});

test('extractOwnOrigin은 allowAmbiguous:true면 동명이지역이어도 되묻지 않고 기본 해석으로 확정한다', () => {
  assert.deepStrictEqual(extractOwnOrigin('지금 광주인데 맛있는집 추천해줘', { allowAmbiguous: true }), {
    origin: '광주광역시',
    explicit: true,
    ambiguous: null,
  });
});

test('extractOwnOrigin은 마침표로 절이 끊겨 있으면 뒤 절의 지명을 앞 절의 3인칭 문맥과 섞지 않는다(되묻기 답변 이어붙이기 사고 재현)', () => {
  // "친구들은 ~" 문장 뒤에 마침표 없이 바로 답변("경기도 광주야")을 이어붙이면, 그 답변의 지명까지
  // 앞 문장의 "친구들은"에 걸려 3인칭으로 오인되던 사고가 있었음(public/recommend.js가 이제
  // "${lastQuery}. ${typed}"처럼 마침표를 넣어 이어붙이도록 수정됨). 마침표로 절이 분리되면
  // 뒤 절의 "경기도 광주"는 앞 절 문맥과 무관하게 그 자체로 채택돼야 한다.
  const q =
    '친구들과 저녁식사와 술한잔을 같이 할 장소를 추천해줘. 나는 광주고, 친구들은 위례와 서울 강남이 집이라 셋이 모이기 편한곳으로. 경기도 광주야';
  assert.deepStrictEqual(extractOwnOrigin(q, { allowAmbiguous: true }), {
    origin: '경기도 광주시',
    explicit: false,
    ambiguous: null,
  });
});

test('computeCentroid는 여러 좌표의 위경도 평균을 반환한다', () => {
  const result = computeCentroid([
    { lat: 37.4, lng: 127.0 },
    { lat: 37.6, lng: 127.2 },
  ]);
  assert.strictEqual(result.lat, 37.5);
  assert.ok(Math.abs(result.lng - 127.1) < 1e-9);
});

test('extractMeetupOrigins는 "중간지점" 키워드+서로 다른 지명 2곳 이상이 있어야 동작한다', () => {
  assert.strictEqual(extractMeetupOrigins('과천 맛집 추천해줘'), null); // 키워드 없음
  assert.strictEqual(extractMeetupOrigins('중간지점에서 만나고 싶어'), null); // 지명 없음
  assert.strictEqual(extractMeetupOrigins('과천 맛집 중간지점 추천'), null); // 지명 1곳뿐
});

test('extractMeetupOrigins는 "나는/친구는" 구분 없이 문장에 언급된 서로 다른 지명을 전부 참가자 위치로 모은다', () => {
  const q = '나는 과천이고 친구들은 성남이랑 강남에 살아서 셋이 모이기 편한곳으로';
  assert.deepStrictEqual(extractMeetupOrigins(q), {
    origins: [
      { name: '과천', region: '경기도 과천시' },
      { name: '성남', region: '경기도 성남시' },
      { name: '강남', region: '서울특별시 강남구' },
    ],
    ambiguous: null,
  });
});

test('extractMeetupOrigins는 언급된 지명 중 동명이지역이 있으면 확정하지 않고 되묻기 신호를 준다', () => {
  const q = '친구는 성남, 나는 광주인데 모이기 편한곳 추천해줘';
  const result = extractMeetupOrigins(q);
  assert.strictEqual(result.origins, null);
  assert.strictEqual(result.ambiguous.name, '광주');
  assert.deepStrictEqual(new Set(result.ambiguous.options), new Set(['광주광역시', '경기도 광주시']));
});

test('extractMeetupOrigins는 allowAmbiguous:true면 동명이지역이어도 되묻지 않고 기본 해석으로 확정한다', () => {
  const q = '친구는 성남, 나는 광주인데 모이기 편한곳 추천해줘';
  const result = extractMeetupOrigins(q, { allowAmbiguous: true });
  assert.strictEqual(result.ambiguous, null);
  assert.deepStrictEqual(
    result.origins.map((o) => o.name).sort(),
    ['광주', '성남']
  );
});

test('extractMeetupOrigins는 되묻기 답변을 원문 뒤에 이어붙였을 때 남아있는 짧은 지명("광주")을 답변의 구체적인 지명("경기도 광주")과 같은 사람으로 취급해 중복 채택하지 않는다', () => {
  const q = '나는 성남이고 친구는 광주에 살아서 모이기 편한곳 추천해줘. 경기도 광주요';
  const result = extractMeetupOrigins(q, { allowAmbiguous: true });
  assert.strictEqual(result.ambiguous, null);
  assert.deepStrictEqual(result.origins, [
    { name: '성남', region: '경기도 성남시' },
    { name: '경기도 광주', region: '경기도 광주시' },
  ]);
});

test('parseRecommendResponse는 picks 형식 응답에서 후보 목록에 실제로 있는 (episode,name)만 채택하고 최대 3개로 제한한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  const text = JSON.stringify({
    type: 'picks',
    items: [
      { episode: 1, name: '가까운집', reason: '조용해서 좋아요' },
      { episode: 999, name: '지어낸식당', reason: '없는 식당' },
      { episode: 2, name: '먼집', reason: '해산물이 좋아요' },
      { episode: 3, name: '좌표없는집', reason: '3번째' },
    ],
  });
  const result = parseRecommendResponse(text, candidates);
  assert.strictEqual(result.type, 'picks');
  assert.strictEqual(result.items.length, 3);
  assert.strictEqual(result.items[0].name, '가까운집');
  assert.strictEqual(result.items[0].reason, '조용해서 좋아요');
  assert.ok(!result.items.some((p) => p.name === '지어낸식당'));
});

test('parseRecommendResponse는 하위호환으로 배열만 온 응답도 picks로 처리한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  const text = JSON.stringify([{ episode: 1, name: '가까운집', reason: '조용해서 좋아요' }]);
  const result = parseRecommendResponse(text, candidates);
  assert.strictEqual(result.type, 'picks');
  assert.strictEqual(result.items.length, 1);
});

test('parseRecommendResponse는 clarify 형식 응답을 그대로 반환한다(막연한 요청 되묻기)', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  const text = JSON.stringify({ type: 'clarify', question: '어느 지역에서 어떤 분위기를 원하세요?' });
  const result = parseRecommendResponse(text, candidates);
  assert.deepStrictEqual(result, { type: 'clarify', question: '어느 지역에서 어떤 분위기를 원하세요?' });
});

test('parseRecommendResponse는 clarify인데 question이 비어있으면 빈 picks로 처리한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  const text = JSON.stringify({ type: 'clarify', question: '' });
  assert.deepStrictEqual(parseRecommendResponse(text, candidates), { type: 'picks', items: [] });
});

test('parseRecommendResponse는 형식이 이상하거나 JSON이 아니면 빈 picks를 반환한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  assert.deepStrictEqual(parseRecommendResponse('{"not":"valid"}', candidates), { type: 'picks', items: [] });
  assert.deepStrictEqual(parseRecommendResponse('이상한 텍스트', candidates), { type: 'picks', items: [] });
});

summary('lib/recommend.js');
