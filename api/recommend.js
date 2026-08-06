// 자연어 조건으로 회차별 식당을 추천하는 엔드포인트 (Gemini API 호출, IP당 rate limit 적용)
const { getSupabase } = require('../lib/supabase');
const { geocodeAddress } = require('../lib/geocode');
const { checkRecommendRateLimit } = require('../lib/rateLimit');
const {
  buildCandidateList,
  excludeCandidates,
  minutesToRadiusKm,
  resolveRadiusMinutes,
  extractIntentLocal,
  extractMeetupOrigins,
  computeCentroid,
  clampRadiusKm,
  haversineKm,
} = require('../lib/recommend');
const { pickRecommendations } = require('../lib/gemini');

const MAX_QUERY_LENGTH = 500;

function mapUrl(r) {
  if (r.place_id) return `https://map.naver.com/p/entry/place/${r.place_id}`;
  const q = [r.name, r.address].filter(Boolean).join(' ');
  return `https://map.naver.com/p/search/${encodeURIComponent(q)}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 허용됩니다.' });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다.' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const { allowed, retryAfterSeconds } = await checkRecommendRateLimit(ip);
  if (!allowed) {
    res.status(429).json({ error: `요청이 많습니다. ${retryAfterSeconds}초 후 다시 시도해주세요.` });
    return;
  }

  const query = typeof (req.body || {}).query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({ error: '원하는 조건을 입력해주세요.' });
    return;
  }
  if (query.length > MAX_QUERY_LENGTH) {
    res.status(400).json({ error: `입력이 너무 깁니다. ${MAX_QUERY_LENGTH}자 이내로 입력해주세요.` });
    return;
  }
  const exclude = Array.isArray((req.body || {}).exclude) ? req.body.exclude : [];
  const forcePicks = Boolean((req.body || {}).forcePicks);
  const coords = (req.body || {}).originCoords;
  const hasCoords = coords && typeof coords.lat === 'number' && typeof coords.lng === 'number';

  // forcePicks(되묻기에 이미 한 번 답한 재요청)면 "광주"처럼 동명이지역이어도 다시 묻지 않고
  // 기본 해석으로 확정한다 — 같은 질문을 무한 반복하지 않기 위함(clarify는 항상 최대 1회).
  // "중간지점" 등 여러 명이 만날 곳을 찾는 문장이면 그 문장에 언급된 서로 다른 지명을 전부 참가자
  // 위치로 보는 별도 흐름(meetup)을 우선 적용하고, 아니면 기존 단일 출발지 흐름(intent)을 쓴다.
  const meetup = extractMeetupOrigins(query, { allowAmbiguous: forcePicks });
  if (meetup && meetup.ambiguous) {
    const { name, options } = meetup.ambiguous;
    res.status(200).json({
      needsClarification: true,
      question: `"${name}"는 ${options.join(' 또는 ')}, 이렇게 여러 곳이 있어서 헷갈려요. 어느 지역을 말씀하시는 걸까요?`,
    });
    return;
  }

  const intent = extractIntentLocal(query, { allowAmbiguous: forcePicks });
  if (!meetup && intent.ambiguousOrigin) {
    const { name, options } = intent.ambiguousOrigin;
    res.status(200).json({
      needsClarification: true,
      question: `"${name}"는 ${options.join(' 또는 ')}, 이렇게 여러 곳이 있어서 헷갈려요. 어느 지역을 말씀하시는 걸까요?`,
    });
    return;
  }

  try {
    const supabase = getSupabase();
    const { data: episodes, error } = await supabase
      .from('episodes')
      .select('episode,title,region,restaurants,verified');
    if (error) throw error;

    // 출발지 우선순위: (0) "중간지점" 등 여러 명 만남 문장이면 언급된 지명들의 무게중심 (1) "지금
    // 나는 ~인데"처럼 1인칭으로 명시된 텍스트 위치 — 사용자가 GPS보다 방금 더 구체적으로 정정한
    // 것이므로 우선 (2) GPS "내 위치" (3) 그 외 텍스트에서 추정한 위치
    let originPoint = null;
    let originLabel = null;
    let notice = null;
    let meetupRadiusKm = null;

    if (meetup && meetup.origins) {
      const geocoded = await Promise.all(
        meetup.origins.map(async (o) => ({ ...o, point: await geocodeAddress(o.region) }))
      );
      const valid = geocoded.filter((g) => g.point);
      const allNames = meetup.origins.map((o) => o.name).join('·');
      if (valid.length >= 2) {
        originPoint = computeCentroid(valid.map((v) => v.point));
        originLabel = `${valid.map((v) => v.name).join('·')} 중간지점`;
        const maxDist = Math.max(...valid.map((v) => haversineKm(originPoint, v.point)));
        meetupRadiusKm = clampRadiusKm(maxDist);
        notice =
          valid.length < geocoded.length
            ? `${allNames} 중 일부 위치를 확인하지 못해 나머지 위치만으로 중간지점을 계산했습니다.`
            : `${originLabel} 기준으로 찾았습니다.`;
      } else if (valid.length === 1) {
        originPoint = valid[0].point;
        originLabel = valid[0].name;
        notice = `${allNames} 중 일부 위치를 확인하지 못해 "${valid[0].name}" 기준으로 찾았습니다.`;
      } else {
        notice = `${allNames} 위치를 확인하지 못해 지역 조건 없이 추천했습니다.`;
      }
    } else if (intent.origin && intent.originExplicit) {
      originPoint = await geocodeAddress(intent.origin);
      originLabel = intent.origin;
    } else if (hasCoords) {
      originPoint = { lat: coords.lat, lng: coords.lng };
      originLabel = '현재 위치';
    } else if (intent.origin) {
      originPoint = await geocodeAddress(intent.origin);
      originLabel = intent.origin;
    }
    if (originLabel && !originPoint) {
      notice = `"${originLabel}" 위치를 확인하지 못해 지역 조건 없이 추천했습니다.`;
    }

    const radiusKm =
      meetupRadiusKm != null
        ? meetupRadiusKm
        : originPoint
          ? minutesToRadiusKm(resolveRadiusMinutes(intent.radiusMinutes))
          : null;
    const allCandidates = buildCandidateList(episodes || [], { origin: originPoint, radiusKm, query });
    const candidates = excludeCandidates(allCandidates, exclude);

    if (!candidates.length) {
      const emptyNotice = exclude.length
        ? '조건에 맞는 다른 후보를 더 찾지 못했습니다.'
        : '조건에 맞는 후보를 찾지 못했습니다.';
      res.status(200).json({ picks: [], origin: originLabel, radius_km: radiusKm, notice: notice || emptyNotice });
      return;
    }

    const result = await pickRecommendations(query, candidates, { forcePicks });

    if (result.type === 'clarify') {
      res.status(200).json({ needsClarification: true, question: result.question });
      return;
    }

    const picks = result.items;

    const enriched = picks.map((p) => ({
      episode: p.episode,
      episodeTitle: p.title,
      name: p.name,
      address: p.address,
      menu: p.menu,
      distance_km: p.distance_km,
      reason: p.reason,
      mapUrl: mapUrl(p),
    }));

    res.status(200).json({
      picks: enriched,
      origin: originLabel,
      radius_km: radiusKm,
      notice,
    });
  } catch (err) {
    res.status(err.quotaExceeded ? 429 : 500).json({ error: err.message });
  }
};
