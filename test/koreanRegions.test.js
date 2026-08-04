const { test, summary, assert } = require('./helpers');
const { findRegionInText } = require('../lib/koreanRegions');

test('findRegionInText는 시군구 사전에 있는 지명을 "시도 시군구" 형태로 반환한다', () => {
  assert.strictEqual(findRegionInText('지금 나는 과천인데 근처 식당 알려줘'), '경기도 과천시');
  assert.strictEqual(findRegionInText('산성역인데 근처에서 밥 먹을 곳'), null); // 사전에 없는 역/랜드마크명은 못 찾음
});

test('여러 지명이 언급되면 더 긴 이름을 우선하고, 길이가 같으면 뒤에 나온 지명을 선택한다', () => {
  // "성남"(시군구, 2자)과 "서울"(시도, 2자)이 같이 있으면 텍스트 뒤쪽에 나온 쪽이 선택됨
  assert.strictEqual(findRegionInText('서울에서 출발해서 성남 쪽으로 갈래'), '경기도 성남시');
  assert.strictEqual(findRegionInText('경기도 광주 맛집 알려줘'), '경기도 광주시'); // 광주광역시와 동명이인 구분
});

test('사전에 없는 지명이면 null을 반환한다', () => {
  assert.strictEqual(findRegionInText('아무 지역명도 없는 문장입니다'), null);
  assert.strictEqual(findRegionInText(''), null);
  assert.strictEqual(findRegionInText(null), null);
});

summary('lib/koreanRegions.js');
