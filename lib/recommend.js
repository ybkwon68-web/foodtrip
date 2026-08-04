// 자연어 추천 기능의 순수 로직: 거리 계산, 후보 목록 구성, 조건 추출/LLM 응답 파싱
const { findRegionInText } = require('./koreanRegions');

const EARTH_RADIUS_KM = 6371;
const KM_PER_MINUTE = 0.8; // 시내+고속 혼합 평균(약 48km/h)을 가정한 근사치, 실제 도로 이동시간과 다를 수 있음
const MIN_RADIUS_KM = 5;
const MAX_RADIUS_KM = 250;
const MAX_CANDIDATES = 80;
const MAX_PICKS = 3;
const MAX_REVIEW_LEN = 80;

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

// episodes(각 회차의 restaurants 배열 포함)를 식당 단위로 펼쳐서 후보 목록을 만든다.
// origin+radiusKm이 있으면 좌표 있는 식당만 반경 내로 거리순 정렬, 없으면 검증된(verified) 회차를 우선한다.
function buildCandidateList(episodes, { origin = null, radiusKm = null, limit = MAX_CANDIDATES } = {}) {
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
    candidates.sort((a, b) => Number(b.verified) - Number(a.verified));
  }

  return candidates.slice(0, limit);
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

// 2차 LLM 응답(추천 목록)을 파싱하고, 실제 후보 목록에 존재하는 (episode,name) 조합만 채택해
// 모델이 지어낸 식당이 그대로 노출되는 것을 막는다.
function parsePicksResponse(text, candidates) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch (err) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const results = [];
  for (const item of parsed) {
    if (!item || typeof item.name !== 'string') continue;
    const episodeNum = Number(item.episode);
    const match = candidates.find((c) => c.episode === episodeNum && c.name === item.name);
    if (!match) continue;
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    results.push({ ...match, reason });
    if (results.length >= MAX_PICKS) break;
  }
  return results;
}

module.exports = {
  haversineKm,
  minutesToRadiusKm,
  buildCandidateList,
  toPromptCandidates,
  extractRadiusMinutes,
  extractIntentLocal,
  parsePicksResponse,
};
