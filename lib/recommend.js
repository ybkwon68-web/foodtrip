// 자연어 추천 기능의 순수 로직: 거리 계산, 후보 목록 구성, 조건 추출/LLM 응답 파싱
const { findRegionInText } = require('./koreanRegions');

const EARTH_RADIUS_KM = 6371;
const KM_PER_MINUTE = 0.8; // 시내+고속 혼합 평균(약 48km/h)을 가정한 근사치, 실제 도로 이동시간과 다를 수 있음
const MIN_RADIUS_KM = 5;
const MAX_RADIUS_KM = 250;
const DEFAULT_RADIUS_MINUTES = 60; // 출발지는 있지만 이동시간 표현이 없을 때 쓰는 기본값(약 48km 반경) — 없으면 위치조건이 있어도 거리 필터가 전혀 적용되지 않았음
const MAX_CANDIDATES = 80;
const MAX_PICKS = 3;
const MAX_REVIEW_LEN = 80;
const MIN_KEYWORD_LEN = 2;

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

function minutesToRadiusKm(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  const km = minutes * KM_PER_MINUTE;
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, km));
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
function toPromptCandidates(candidates) {
  return candidates.map((c) => ({
    episode: c.episode,
    name: c.name,
    region: c.region,
    address: c.address,
    menu: c.menu,
    review: c.review,
    distance_km: c.distance_km,
  }));
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

// Gemini 호출 없이 문장에서 출발지·이동시간을 사전 매칭/정규식으로 추출한다(무료 등급 일일 호출 한도 절약용).
function extractIntentLocal(query) {
  return {
    origin: findRegionInText(query),
    radiusMinutes: extractRadiusMinutes(query),
  };
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
  minutesToRadiusKm,
  resolveRadiusMinutes,
  buildCandidateList,
  excludeCandidates,
  toPromptCandidates,
  extractRadiusMinutes,
  extractRelevanceKeywords,
  extractIntentLocal,
  parseRecommendResponse,
};
