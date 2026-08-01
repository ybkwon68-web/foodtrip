// 주소 문자열을 시도/시군구/상세주소로 분리하는 공용 로직 (table.js와 노드 테스트가 함께 사용)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AddressSplit = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // 실제 17개 광역단체 + 2024년 행정구역 개편 전후 신구 명칭. 이 목록에 없는
  // 시도명(해외 주소 등)은 앞 2토큰만 잘라내지 않고 원문 그대로 보존한다 —
  // 캐나다·홍콩·일본 특집 회차 주소가 잘못 잘리던 실제 버그의 재발 방지용.
  const KNOWN_SIDO = new Set([
    '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
    '대전광역시', '울산광역시', '세종특별자치시',
    '경기도', '강원도', '강원특별자치도',
    '충청북도', '충청남도', '전라북도', '전북특별자치도', '전라남도',
    '경상북도', '경상남도', '제주특별자치도', '제주도',
  ]);

  function splitN(str, sep, maxSplit) {
    const parts = [];
    let rest = str;
    for (let i = 0; i < maxSplit; i++) {
      const idx = rest.indexOf(sep);
      if (idx === -1) break;
      parts.push(rest.slice(0, idx));
      rest = rest.slice(idx + sep.length);
    }
    parts.push(rest);
    return parts;
  }

  function splitAddress(addr) {
    if (!addr) return { sido: '', sigungu: '', detail: '' };
    const [sido = '', sigungu = '', detail = ''] = splitN(addr, ' ', 2);
    if (!KNOWN_SIDO.has(sido)) return { sido: '', sigungu: '', detail: addr };
    return { sido, sigungu, detail };
  }

  function splitRegion(region) {
    if (!region) return { sido: '', sigungu: '' };
    const [sido = '', sigungu = ''] = splitN(region, ' ', 1);
    if (!KNOWN_SIDO.has(sido)) return { sido: '', sigungu: '' };
    return { sido, sigungu };
  }

  return { KNOWN_SIDO, splitAddress, splitRegion };
});
