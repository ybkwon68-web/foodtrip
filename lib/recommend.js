// 자연어 추천 기능의 순수 로직: 거리 계산, 후보 목록 구성, 조건 추출/LLM 응답 파싱
const { findAllRegionMatches, ambiguousRegionsFor } = require('./koreanRegions');

// "중간지점", "모이기 좋은", "다같이 만나서" 등 여러 사람이 만날 곳을 찾는 문장에서 흔히 쓰이는 표현.
// "모이/만나" 어간은 넓게 잡되, 실제 오작동 방지는 이 키워드 하나가 아니라 아래에서 서로 다른
// 지명이 2곳 이상 함께 언급됐는지까지 같이 확인하는 이중 조건으로 한다.
const MEETUP_KEYWORD_RE = /모이|만나|중간\s*지점|중간에서|중간쯤|중간\s*지역|가운데(에서|로)?/;

const EARTH_RADIUS_KM = 6371;
const KM_PER_MINUTE = 0.8; // 시내+고속 혼합 평균(약 48km/h)을 가정한 근사치, 실제 도로 이동시간과 다를 수 있음
const MIN_RADIUS_KM = 5;
const MAX_RADIUS_KM = 250;
const DEFAULT_RADIUS_MINUTES = 60; // 출발지는 있지만 이동시간 표현이 없을 때 쓰는 기본값(약 48km 반경) — 없으면 위치조건이 있어도 거리 필터가 전혀 적용되지 않았음
const MAX_CANDIDATES = 80;
const MAX_PICKS = 3;
const MAX_REVIEW_LEN = 80;
const MIN_KEYWORD_LEN = 2;
const MAX_BODY_EXCERPT_CANDIDATES = 20; // 거리순 상위 몇 곳까지 방송 본문 요약을 붙여 Gemini에 넘길지(프롬프트 크기 통제)
const BODY_EXCERPT_MAX_LEN = 500; // 회차별 본문 요약 최대 길이

// 위치·이동거리 표현을 뺀 나머지 문장에서 흔히 섞이는 조사/필러 단어. 이 목록에 없는 2글자 이상
// 토큰만 음식종류/분위기 키워드로 간주해 후보 관련도 점수 계산에 쓴다(형태소 분석기 없이 근사).
const QUERY_STOPWORDS = new Set([
  '지금', '나는', '저는', '오늘', '점심', '저녁', '식사', '먹고', '싶어', '싶은', '싶다', '알려줘',
  '알려주세요', '추천', '추천해줘', '해줘', '해주세요', '부탁해', '곳', '식당', '맛집', '조건', '근처',
  '정도', '이내', '으로', '에서', '한테', '에게', '그리고', '그냥', '아무', '데나', '좀', '조금',
  '합니다', '해요', '이에요', '예요', '있는', '있을', '하는', '이동', '거리', '이동거리', '시간', '분',
]);

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

function clampRadiusKm(km) {
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, km));
}

function minutesToRadiusKm(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  return clampRadiusKm(minutes * KM_PER_MINUTE);
}

// 출발지는 정해졌는데 "N분/N시간" 표현이 문장에 없을 때 기본 이동시간을 채워준다.
function resolveRadiusMinutes(explicitMinutes) {
  return typeof explicitMinutes === 'number' && explicitMinutes > 0 ? explicitMinutes : DEFAULT_RADIUS_MINUTES;
}

// 질의 문장에서 음식종류/분위기 등 후보 관련도 판단에 쓸 키워드를 뽑는다(불용어·1글자 토큰 제외).
function extractRelevanceKeywords(query) {
  if (!query) return [];
  const tokens = String(query).split(/[^가-힣a-zA-Z0-9]+/).filter(Boolean);
  const seen = new Set();
  const keywords = [];
  for (const t of tokens) {
    if (t.length < MIN_KEYWORD_LEN || QUERY_STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    keywords.push(t.toLowerCase());
  }
  return keywords;
}

// 후보의 이름/메뉴/한줄평/지역/회차제목에 질의 키워드가 몇 개나 포함되는지 센다.
function relevanceScore(candidate, keywords) {
  if (!keywords.length) return 0;
  const haystack = `${candidate.name} ${candidate.menu} ${candidate.review} ${candidate.region} ${candidate.title}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score += 1;
  }
  return score;
}

// episodes(각 회차의 restaurants 배열 포함)를 식당 단위로 펼쳐서 후보 목록을 만든다.
// origin+radiusKm이 있으면 좌표 있는 식당만 반경 내로 거리순 정렬한다.
// 없으면 질의 키워드와의 관련도 점수(높은 순, 동점이면 verified 우선)로 정렬한다 — 키워드가 없으면
// 기존처럼 verified 우선 정렬로 동작한다. 이렇게 해야 위치조건 없는 음식종류/분위기 질의에서도
// 전체 후보(verified 99곳 등 일부가 아니라) 중 실제로 관련 있는 곳이 상위 limit개 안에 들어온다.
function buildCandidateList(episodes, { origin = null, radiusKm = null, limit = MAX_CANDIDATES, query = '' } = {}) {
  const candidates = [];
  for (const ep of episodes || []) {
    for (const r of ep.restaurants || []) {
      if (!r || !r.name) continue;
      let distance_km = null;
      if (origin && radiusKm != null) {
        if (typeof r.lat !== 'number' || typeof r.lng !== 'number') continue;
        distance_km = haversineKm(origin, { lat: r.lat, lng: r.lng });
        if (distance_km > radiusKm) continue;
      }
      candidates.push({
        episode: ep.episode,
        title: ep.title || ep.raw_title || '',
        region: ep.region || '',
        name: r.name,
        address: r.address || '',
        menu: r.menu || '',
        review: (r.review || '').slice(0, MAX_REVIEW_LEN),
        tel: r.tel || null,
        lat: typeof r.lat === 'number' ? r.lat : null,
        lng: typeof r.lng === 'number' ? r.lng : null,
        place_id: r.place_id || null,
        verified: Boolean(ep.verified),
        distance_km: distance_km != null ? Math.round(distance_km * 10) / 10 : null,
      });
    }
  }

  if (origin && radiusKm != null) {
    candidates.sort((a, b) => a.distance_km - b.distance_km);
  } else {
    const keywords = extractRelevanceKeywords(query);
    if (keywords.length) {
      const scored = candidates.map((c) => ({ c, score: relevanceScore(c, keywords) }));
      scored.sort((a, b) => b.score - a.score || Number(b.c.verified) - Number(a.c.verified));
      candidates.splice(0, candidates.length, ...scored.map((s) => s.c));
    } else {
      candidates.sort((a, b) => Number(b.verified) - Number(a.verified));
    }
  }

  return candidates.slice(0, limit);
}

// "다른 곳으로 다시 추천" 요청 시, 이미 보여준 (episode,name)은 후보에서 제외해 같은 곳이 또 나오지 않게 한다.
function excludeCandidates(candidates, exclude) {
  if (!Array.isArray(exclude) || !exclude.length) return candidates;
  const excludedKeys = new Set(
    exclude
      .filter((e) => e && typeof e.name === 'string')
      .map((e) => `${Number(e.episode)}|${e.name}`)
  );
  return candidates.filter((c) => !excludedKeys.has(`${c.episode}|${c.name}`));
}

// LLM 프롬프트에 넣을 후보 목록은 좌표/전화번호 등 판단에 불필요한 필드를 빼서 토큰을 아낀다.
// 방송 본문(body_html, 워드/한글 내보내기 스타일의 인라인 스타일 태그가 섞여 있음)에서 태그·엔티티를
// 제거해 순수 텍스트만 남기고 maxLen 길이로 자른다. 분위기 판단용으로 Gemini에 넘길 짧은 요약을 만들 때 쓴다.
function stripBodyHtml(html, maxLen = BODY_EXCERPT_MAX_LEN) {
  if (!html) return '';
  const text = String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function toPromptCandidates(candidates) {
  return candidates.map((c) => {
    const item = {
      episode: c.episode,
      name: c.name,
      region: c.region,
      address: c.address,
      menu: c.menu,
      review: c.review,
      distance_km: c.distance_km,
    };
    if (c.broadcast_excerpt) item.broadcast_excerpt = c.broadcast_excerpt;
    return item;
  });
}

function extractJsonText(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

// "1시간 이내", "30분", "1시간 30분" 같은 표현에서 분 단위 숫자를 추출한다. 없으면 null.
function extractRadiusMinutes(text) {
  if (!text) return null;
  const haystack = String(text);
  const hourMatch = haystack.match(/(\d+(?:\.\d+)?)\s*시간(?:\s*(\d+)\s*분)?/);
  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]);
    const mins = hourMatch[2] ? parseInt(hourMatch[2], 10) : 0;
    const total = Math.round(hours * 60 + mins);
    return total > 0 ? total : null;
  }
  const minMatch = haystack.match(/(\d+)\s*분/);
  if (minMatch) {
    const total = parseInt(minMatch[1], 10);
    return total > 0 ? total : null;
  }
  return null;
}

// "나는/저는/난/내가/제가/지금"처럼 화자 자신의 위치임을 명시하는 표현. 지명 바로 앞 절(문장부호 이전)에서
// 이 표현이 3인칭 표현보다 뒤(=지명에 더 가깝게)에 나오면 그 지명을 "내 위치"로 확정한다.
const FIRST_PERSON_MARKER_RE = /(?:^|\s)(나는|저는|난|내가|제가|지금)/g;
// "친구는/가족은/애들은"처럼 화자가 아닌 제3자의 위치임을 명시하는 표현. 이 표현이 지명에 더 가까우면
// 그 지명은 "내 위치" 후보에서 제외한다(강남/위례 오인식 사고의 원인).
const THIRD_PERSON_MARKER_RE =
  /(친구들?|가족|동생|형|누나|언니|오빠|엄마|아빠|부모님|와이프|아내|남편|일행|애들|아이들|사람들|지인|동료)(은|는|이|가)/g;

// matchIndex 지명 바로 앞 절(가장 가까운 문장부호 이후)에서 화자 표현이 더 가까운지 제3자 표현이 더
// 가까운지로 문맥을 판단한다. 둘 다 없으면 null(불명확).
function classifySpeaker(haystack, matchIndex) {
  const boundary = Math.max(
    haystack.lastIndexOf('.', matchIndex),
    haystack.lastIndexOf('!', matchIndex),
    haystack.lastIndexOf('?', matchIndex),
    haystack.lastIndexOf('\n', matchIndex)
  );
  const clause = haystack.slice(boundary + 1, matchIndex);

  let lastPos = -1;
  let speaker = null;
  let m;
  FIRST_PERSON_MARKER_RE.lastIndex = 0;
  while ((m = FIRST_PERSON_MARKER_RE.exec(clause))) {
    if (m.index > lastPos) {
      lastPos = m.index;
      speaker = 'first';
    }
  }
  THIRD_PERSON_MARKER_RE.lastIndex = 0;
  while ((m = THIRD_PERSON_MARKER_RE.exec(clause))) {
    if (m.index > lastPos) {
      lastPos = m.index;
      speaker = 'third';
    }
  }
  return speaker;
}

// 문장에서 "내 위치"로 볼 수 있는 지명을 찾는다.
// - 1인칭 문맥("지금 나는 ~인데")으로 명시된 지명이 있으면 explicit:true로 최우선 반환(GPS보다도 우선순위 높음).
// - 없으면 3인칭 문맥("친구는 ~에 살아")으로 언급된 지명은 후보에서 빼고, 나머지 중 기존 규칙(긴 이름
//   우선, 같으면 뒤쪽에 나온 것)으로 하나를 골라 explicit:false로 반환.
// - 3인칭 언급만 있고 남는 후보가 없으면 origin:null(모름)을 반환한다 — 틀린 확신보다 낫다는 판단.
// - 채택된 지명이 "광주"(광주광역시/경기도 광주시)처럼 동명이지역이면, allowAmbiguous가 아닌 한
//   origin을 확정하지 않고 ambiguous에 후보 지역 목록을 담아 되묻기를 유도한다.
function extractOwnOrigin(query, { allowAmbiguous = false } = {}) {
  const haystack = String(query || '');
  const matches = findAllRegionMatches(haystack);
  if (!matches.length) return { origin: null, explicit: false, ambiguous: null };

  const tagged = matches.map((m) => ({ ...m, speaker: classifySpeaker(haystack, m.index) }));
  const pick = (list) => {
    if (!list.length) return null;
    const sorted = [...list].sort(
      (a, b) => a.endIndex - a.index - (b.endIndex - b.index) || a.endIndex - b.endIndex
    );
    return sorted[sorted.length - 1];
  };

  const finalize = (winner, explicit) => {
    if (!winner) return { origin: null, explicit: false, ambiguous: null };
    const options = allowAmbiguous ? null : ambiguousRegionsFor(winner.name);
    if (options) return { origin: null, explicit: false, ambiguous: { name: winner.name, options } };
    return { origin: winner.region, explicit, ambiguous: null };
  };

  const firstPerson = tagged.filter((m) => m.speaker === 'first');
  if (firstPerson.length) return finalize(pick(firstPerson), true);

  const notThirdPerson = tagged.filter((m) => m.speaker !== 'third');
  return finalize(pick(notThirdPerson), false);
}

// Gemini 호출 없이 문장에서 출발지·이동시간을 사전 매칭/정규식으로 추출한다(무료 등급 일일 호출 한도 절약용).
// allowAmbiguous:true면 "광주"처럼 동명이지역인 지명도 되묻지 않고 기존 방식대로 하나를 확정한다
// (되묻기에 이미 한 번 답한 forcePicks 요청에서 같은 질문을 무한 반복하지 않기 위해 사용).
function extractIntentLocal(query, { allowAmbiguous = false } = {}) {
  const { origin, explicit, ambiguous } = extractOwnOrigin(query, { allowAmbiguous });
  return {
    origin,
    originExplicit: explicit,
    ambiguousOrigin: ambiguous,
    radiusMinutes: extractRadiusMinutes(query),
  };
}

// 위경도 평균(무게중심). 한국 내 지역 간 거리 범위에서는 실용적으로 충분한 근사치.
function computeCentroid(points) {
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return { lat, lng };
}

// "중간지점", "모이기 좋은" 등 여러 사람이 만날 곳을 찾는 문장에서, 문장에 언급된 서로 다른 지명을
// (1인칭/3인칭 구분 없이) 전부 참가자 위치 후보로 모은다. 이 기능은 명시적인 만남 표현이 있을 때만
// 동작한다 — 단순히 지명이 여러 개 나온다고 자동으로 여러 명으로 해석하면 기존 단일 출발지 문장에서도
// 오작동할 위험이 있어서다(예: "강남에서 홍대까지 가는 길에 있는 맛집"은 만남이 아니라 경로 설명).
// 키워드는 있지만 서로 다른 지명이 2곳 미만이면 판단 근거가 부족하다고 보고 null을 반환해 기존
// 단일 출발지 흐름(extractOwnOrigin)에 맡긴다.
function extractMeetupOrigins(query, { allowAmbiguous = false } = {}) {
  const haystack = String(query || '');
  if (!MEETUP_KEYWORD_RE.test(haystack)) return null;

  // "경기도 광주"처럼 더 긴(구체적인) 지명이 이미 채택되면, 그 안에 포함되는 짧은 지명(예: "광주")은
  // 같은 지명을 다르게 표기한 것으로 보고 별도 참가자로 세지 않는다 — 되묻기 답변("경기도 광주요")을
  // 원문 뒤에 이어붙이면 원문의 애매한 "광주"와 답변의 "경기도 광주"가 한 문장에 같이 남는데, 이걸
  // 그대로 두면 같은 사람의 위치가 서로 다른 두 지역(광주광역시/경기도 광주시)으로 중복 채택된다.
  const byLength = [...findAllRegionMatches(haystack)].sort((a, b) => b.name.length - a.name.length);
  const accepted = [];
  for (const m of byLength) {
    if (accepted.some((a) => a.name.includes(m.name))) continue;
    accepted.push(m);
  }
  accepted.sort((a, b) => a.index - b.index);

  const seen = new Map(); // region -> 그 지역의 첫 언급 표기
  for (const m of accepted) {
    if (!seen.has(m.region)) seen.set(m.region, m.name);
  }
  if (seen.size < 2) return null;

  const origins = [...seen.entries()].map(([region, name]) => ({ name, region }));
  if (!allowAmbiguous) {
    for (const o of origins) {
      const options = ambiguousRegionsFor(o.name);
      if (options) return { ambiguous: { name: o.name, options }, origins: null };
    }
  }
  return { origins, ambiguous: null };
}

// LLM 응답을 파싱한다. 두 가지 형태를 지원한다:
// - {"type":"clarify","question":"..."} : 요청이 너무 막연해서 추천 대신 되묻는 경우
// - {"type":"picks","items":[...]} (또는 하위호환으로 배열만 오는 경우): 추천 목록
// picks의 경우 실제 후보 목록에 존재하는 (episode,name) 조합만 채택해 모델이 지어낸 식당이
// 그대로 노출되는 것을 막는다. 형식이 이상하면 항상 안전한 기본값(picks, 빈 배열)으로 처리한다.
function parseRecommendResponse(text, candidates) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch (err) {
    return { type: 'picks', items: [] };
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.type === 'clarify') {
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
    if (question) return { type: 'clarify', question };
    return { type: 'picks', items: [] };
  }

  const rawItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null;
  if (!rawItems) return { type: 'picks', items: [] };

  const results = [];
  for (const item of rawItems) {
    if (!item || typeof item.name !== 'string') continue;
    const episodeNum = Number(item.episode);
    const match = candidates.find((c) => c.episode === episodeNum && c.name === item.name);
    if (!match) continue;
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    results.push({ ...match, reason });
    if (results.length >= MAX_PICKS) break;
  }
  return { type: 'picks', items: results };
}

module.exports = {
  haversineKm,
  clampRadiusKm,
  minutesToRadiusKm,
  resolveRadiusMinutes,
  buildCandidateList,
  excludeCandidates,
  toPromptCandidates,
  stripBodyHtml,
  MAX_BODY_EXCERPT_CANDIDATES,
  extractRadiusMinutes,
  extractRelevanceKeywords,
  extractOwnOrigin,
  extractIntentLocal,
  computeCentroid,
  extractMeetupOrigins,
  parseRecommendResponse,
};
