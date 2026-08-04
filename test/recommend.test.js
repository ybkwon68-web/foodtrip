const { test, summary, assert } = require('./helpers');
const {
  haversineKm,
  minutesToRadiusKm,
  buildCandidateList,
  toPromptCandidates,
  extractRadiusMinutes,
  extractIntentLocal,
  parsePicksResponse,
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

test('toPromptCandidates는 좌표·전화번호 등 불필요한 필드를 제거한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  const prompt = toPromptCandidates(candidates);
  assert.ok(!('lat' in prompt[0]));
  assert.ok(!('place_id' in prompt[0]));
  assert.ok('name' in prompt[0] && 'region' in prompt[0]);
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

test('parsePicksResponse는 후보 목록에 실제로 있는 (episode,name)만 채택하고 최대 3개로 제한한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  const text = JSON.stringify([
    { episode: 1, name: '가까운집', reason: '조용해서 좋아요' },
    { episode: 999, name: '지어낸식당', reason: '없는 식당' },
    { episode: 2, name: '먼집', reason: '해산물이 좋아요' },
    { episode: 3, name: '좌표없는집', reason: '3번째' },
  ]);
  const picks = parsePicksResponse(text, candidates);
  assert.strictEqual(picks.length, 3);
  assert.strictEqual(picks[0].name, '가까운집');
  assert.strictEqual(picks[0].reason, '조용해서 좋아요');
  assert.ok(!picks.some((p) => p.name === '지어낸식당'));
});

test('parsePicksResponse는 배열이 아니거나 JSON이 아니면 빈 배열을 반환한다', () => {
  const candidates = buildCandidateList(sampleEpisodes, {});
  assert.deepStrictEqual(parsePicksResponse('{"not":"array"}', candidates), []);
  assert.deepStrictEqual(parsePicksResponse('이상한 텍스트', candidates), []);
});

summary('lib/recommend.js');
