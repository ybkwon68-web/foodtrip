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
  extractIntentLocal,
  parseRecommendResponse,
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
    radiusMinutes: 60,
  });
  assert.deepStrictEqual(extractIntentLocal('그냥 아무 데나 알려줘'), { origin: null, radiusMinutes: null });
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
