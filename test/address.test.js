// public/lib/address.js(표로 보기 주소 분리 로직) 회귀 테스트
const { test, summary, assert } = require('./helpers');
const { splitAddress, splitRegion } = require('../public/lib/address');

test('정식 시도명이 포함된 국내 주소는 시도/시군구/상세로 분리된다', () => {
  const result = splitAddress('강원특별자치도 양구군 양구읍 양록길23번길 12-6');
  assert.deepStrictEqual(result, { sido: '강원특별자치도', sigungu: '양구군', detail: '양구읍 양록길23번길 12-6' });
});

test('전북특별자치도처럼 개편 후 명칭도 인식한다', () => {
  const result = splitAddress('전북특별자치도 순창군 순창읍 순창7길 30');
  assert.strictEqual(result.sido, '전북특별자치도');
  assert.strictEqual(result.sigungu, '순창군');
});

test('약칭 시도명("서울", "경북" 등)은 정식 명칭이 아니므로 분리되지 않는다', () => {
  // 실제로 이 프로젝트에서 약칭 주소를 저장했다가 표로 보기의 시도 필터가
  // 비어버리는 버그가 발생한 적이 있음(2026-08-01) — 저장 시 반드시 정식
  // 명칭("서울특별시", "경상북도" 등)을 써야 한다는 걸 코드로 남겨둠.
  const result = splitAddress('서울 종로구 자하문로5길 19');
  assert.deepStrictEqual(result, { sido: '', sigungu: '', detail: '서울 종로구 자하문로5길 19' });
});

test('KNOWN_SIDO에 없는 해외 주소는 잘리지 않고 원문 그대로 보존된다', () => {
  const result = splitAddress('100 Rue Saint-Paul, Québec, Canada');
  assert.deepStrictEqual(result, { sido: '', sigungu: '', detail: '100 Rue Saint-Paul, Québec, Canada' });
});

test('주소가 없으면 빈 값을 안전하게 반환한다', () => {
  assert.deepStrictEqual(splitAddress(''), { sido: '', sigungu: '', detail: '' });
  assert.deepStrictEqual(splitAddress(null), { sido: '', sigungu: '', detail: '' });
  assert.deepStrictEqual(splitAddress(undefined), { sido: '', sigungu: '', detail: '' });
});

test('region(제목 기반 지역 추정) 문자열도 같은 규칙으로 분리된다', () => {
  assert.deepStrictEqual(splitRegion('경기도 남양주시'), { sido: '경기도', sigungu: '남양주시' });
  assert.deepStrictEqual(splitRegion('서울특별시'), { sido: '서울특별시', sigungu: '' });
  assert.deepStrictEqual(splitRegion(''), { sido: '', sigungu: '' });
});

summary('public/lib/address.js');
