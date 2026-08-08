// 등록된 식당의 폐업/이전 의심 여부를 점검하는 순수 로직 (crawler/check_status.py의 Node 이식판)
// 웹 UI(편집모드의 "폐업·이전 자동 점검" 패널)에서 회차 단위로 호출해 쓴다. 세부 판정 원리와
// 안전장치(businessStatusDescription을 폐업 판정에 안 쓰는 이유, FD6 카테고리 필터 등)는
// crawler/check_status.py 상단 주석 참고 — 두 구현은 로직을 동일하게 유지해야 한다.
const NAVER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  Referer: 'https://m.place.naver.com/',
};

const STATUS_RE = /"businessStatusDescription":\{[^}]*?"status":"([^"]*)"/;
const ROAD_ADDRESS_RE = /"roadAddress":"([^"]*)"/g;

const NEARBY_RADIUS_M = 50;

const SIDO_ABBR = {
  서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시',
  대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시',
  경기: '경기도', 강원: '강원특별자치도',
  충북: '충청북도', 충남: '충청남도',
  전북: '전북특별자치도',
  경북: '경상북도', 경남: '경상남도',
  제주: '제주특별자치도',
  // 전라남도·광주광역시가 "전남광주통합특별시"로 통합됨 — 우리 데이터는 당분간 기존 표기
  // (전라남도/광주광역시)를 그대로 유지하지만, 네이버 등 외부 조회 결과는 통합 명칭(축약형
  // "전남광주" 포함, 317회 복성식당 실측)으로 나오므로 주소 비교에서만 같은 지역으로 취급한다.
  광주: '전남광주', 광주광역시: '전남광주',
  전남: '전남광주', 전라남도: '전남광주',
  전남광주: '전남광주', 전남광주통합특별시: '전남광주',
};

function normalizeSido(addr) {
  if (!addr) return addr;
  const idx = addr.indexOf(' ');
  const first = idx < 0 ? addr : addr.slice(0, idx);
  const rest = idx < 0 ? '' : addr.slice(idx + 1);
  return (SIDO_ABBR[first] || first) + (rest ? ' ' + rest : '');
}

function addressesDiffer(stored, fetched) {
  if (!stored || !fetched) return false;
  return normalizeSido(stored).replace(/ /g, '') !== normalizeSido(fetched).replace(/ /g, '');
}

function regionKey(addr, tokens = 2) {
  if (!addr) return null;
  const parts = normalizeSido(addr).split(' ');
  return parts.length >= tokens ? parts.slice(0, tokens).join(' ') : null;
}

// place_id로 네이버 지도 모바일 place 페이지를 조회해 도로명주소를 추출한다.
// 반환: ok:false면 네트워크/파싱 실패로 판정을 보류(다음 실행에 재시도).
async function checkNaverPlace(placeId) {
  const url = `https://m.place.naver.com/restaurant/${placeId}/home`;
  let resp;
  try {
    resp = await fetch(url, { headers: NAVER_HEADERS });
  } catch (err) {
    return { ok: false };
  }
  if (resp.status === 404) {
    return { ok: true, notFound: true, statusText: null, roadAddress: null };
  }
  if (!resp.ok) return { ok: false };

  const text = await resp.text();
  const statusMatches = [...text.matchAll(new RegExp(STATUS_RE, 'g'))];
  const addrMatches = [...text.matchAll(ROAD_ADDRESS_RE)];
  // 페이지 구조가 예상과 다르게 여러 번(또는 0번) 매칭되면 어느 값이 진짜인지 확신할 수 없으니
  // 건너뛴다(잘못된 값을 판정에 쓰는 것보다 안전).
  const statusText = statusMatches.length === 1 ? statusMatches[0][1] : null;
  const roadAddress = addrMatches.length === 1 ? addrMatches[0][1] : null;
  return { ok: true, notFound: false, statusText, roadAddress };
}

// 카카오 로컬 키워드 검색으로 이름+시군구가 일치하는 '음식점' 후보를 찾는다(보조, 신뢰도 낮음).
async function checkKakao(kakaoKey, name, storedRegion) {
  const params = new URLSearchParams({ query: name, category_group_code: 'FD6' });
  let resp;
  try {
    resp = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
    });
  } catch (err) {
    return { ok: false };
  }
  if (!resp.ok) return { ok: false };

  const data = await resp.json();
  const docs = data.documents || [];
  let exact = docs.filter((d) => d.place_name === name);
  if (storedRegion) {
    exact = exact.filter((d) => regionKey(d.address_name || '') === storedRegion);
  }
  if (exact.length !== 1) return { ok: true, matched: false, roadAddress: null };
  const cand = exact[0];
  return { ok: true, matched: true, roadAddress: cand.road_address_name || cand.address_name };
}

// 저장된 좌표 근처(반경 50m)의 음식점(FD6)을 카카오 카테고리 검색으로 역으로 조회한다.
async function checkKakaoNearby(kakaoKey, lat, lng, name) {
  const params = new URLSearchParams({
    category_group_code: 'FD6',
    x: String(lng),
    y: String(lat),
    radius: String(NEARBY_RADIUS_M),
    sort: 'distance',
  });
  let resp;
  try {
    resp = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${params}`, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
    });
  } catch (err) {
    return { ok: false };
  }
  if (!resp.ok) return { ok: false };

  const data = await resp.json();
  const docs = data.documents || [];
  const sameName = docs.find((d) => d.place_name === name) || null;
  const closestOther = docs.find((d) => d.place_name !== name) || null;
  return { ok: true, sameNameFound: Boolean(sameName), closestOther };
}

// 두 문자열 사이의 편집거리(Levenshtein distance)를 계산한다.
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// 이름이 완전히 무관하지 않고 앞부분이 겹치면(예: "철뚝소머리집"↔"철뚝소머리국밥") 같은 업체의
// 표기 차이/리브랜딩으로 보고 "다른 업체로 바뀜" 의심에서 제외한다.
function namesSimilar(a, b) {
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  let commonPrefixLen = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) break;
    commonPrefixLen++;
  }
  const shorterLen = Math.min(a.length, b.length);
  if (shorterLen > 0 && commonPrefixLen / shorterLen >= 0.5) return true;
  // 접두어 비교는 이름 앞부분에서 글자가 갈리면 못 잡아낸다 — "부잣집보쌈"↔"부자집보쌈"(사이시옷
  // 표기 차이), "착한칼국수"↔"착한손칼국수"(글자 하나 삽입)처럼 실사용에서 오탐으로 보고된 사례가
  // 모두 편집거리 1짜리 표기 차이였다. 오탈자/표기 차이 수준(편집거리 1)까지는 같은 업체로 본다.
  return editDistance(a, b) <= 1;
}

function refineWithNearby(statusCheck, nearby, name) {
  if (!nearby.ok) return statusCheck;
  const other = nearby.closestOther;
  const similarOther = other && namesSimilar(name, other.place_name || '');
  if (nearby.sameNameFound || similarOther) {
    if (statusCheck.closure_suspected) {
      statusCheck.closure_suspected = false;
      const reason = nearby.sameNameFound
        ? '같은 이름의 업체가 확인되어'
        : `비슷한 이름의 업체("${other.place_name}")가 확인되어`;
      statusCheck.note += ` (좌표 기준 교차검증에서 ${reason} 폐업 의심을 취소함)`;
    }
    return statusCheck;
  }
  if (other) {
    statusCheck.closure_suspected = true;
    statusCheck.confidence = 'high';
    statusCheck.source = `${statusCheck.source}+kakao_coordinate`;
    statusCheck.note = `해당 위치(좌표)에서 다른 업체("${other.place_name}")가 영업 중으로 확인됨 — 폐업 후 업종/상호가 바뀐 것으로 보입니다.`;
  }
  return statusCheck;
}

function buildStatusCheck(closureSuspected, movedSuspected, source, confidence, note, candidateAddress) {
  const sc = {
    checked_at: new Date().toISOString(),
    source,
    confidence,
    closure_suspected: closureSuspected,
    moved_suspected: movedSuspected,
    note,
  };
  if (movedSuspected && candidateAddress) sc.candidate_address = candidateAddress;
  return sc;
}

// 식당 1곳을 점검해 status_check를 반환한다. 판정을 보류해야 하면 null.
async function checkOne(kakaoKey, restaurant) {
  const name = restaurant.name;
  const address = restaurant.address || '';
  const storedRegion = regionKey(address);
  const { lat, lng } = restaurant;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';

  let statusCheck;
  if (restaurant.place_id) {
    const result = await checkNaverPlace(restaurant.place_id);
    if (!result.ok) return null;
    if (result.notFound) {
      statusCheck = buildStatusCheck(true, false, 'naver_place_id', 'high', 'place_id 페이지를 찾을 수 없음(404)');
    } else {
      if (result.roadAddress === null) return null;
      const moved = addressesDiffer(address, result.roadAddress);
      const note = result.statusText
        ? `영업상태 문구(참고용, 폐업 판정에 미사용): ${result.statusText}`
        : '정상 조회됨';
      statusCheck = buildStatusCheck(false, moved, 'naver_place_id', 'high', note, result.roadAddress);
    }
  } else {
    if (!kakaoKey) return null;
    const result = await checkKakao(kakaoKey, name, storedRegion);
    if (!result.ok) return null;
    const moved = result.matched && addressesDiffer(address, result.roadAddress);
    const note = result.matched
      ? '카카오 검색으로 확인됨'
      : '카카오 지도에서 검색되지 않음 — 폐업했을 수도 있지만, 원래 카카오에 등록돼 있지 않았을 가능성이 더 높습니다. 네이버지도 등에서 직접 확인해주세요.';
    statusCheck = buildStatusCheck(!result.matched, moved, 'kakao_keyword_search', 'low', note, result.roadAddress);
  }

  if (kakaoKey && hasCoords) {
    const nearby = await checkKakaoNearby(kakaoKey, lat, lng, name);
    statusCheck = refineWithNearby(statusCheck, nearby, name);
  }

  return statusCheck;
}

module.exports = {
  normalizeSido,
  addressesDiffer,
  regionKey,
  namesSimilar,
  checkOne,
};
