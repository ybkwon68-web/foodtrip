// 자연어 조건으로 회차별 식당을 추천하는 엔드포인트 (Gemini API 호출, IP당 rate limit 적용)
const { getSupabase } = require('../lib/supabase');
const { geocodeAddress } = require('../lib/geocode');
const { checkRecommendRateLimit } = require('../lib/rateLimit');
const { buildCandidateList, excludeCandidates, minutesToRadiusKm, extractIntentLocal } = require('../lib/recommend');
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

  try {
    const supabase = getSupabase();
    const { data: episodes, error } = await supabase
      .from('episodes')
      .select('episode,title,region,restaurants,verified');
    if (error) throw error;

    const intent = extractIntentLocal(query);

    let originPoint = null;
    let notice = null;
    if (intent.origin) {
      originPoint = await geocodeAddress(intent.origin);
      if (!originPoint) notice = `"${intent.origin}" 위치를 확인하지 못해 지역 조건 없이 추천했습니다.`;
    }

    const radiusKm = originPoint ? minutesToRadiusKm(intent.radiusMinutes) : null;
    const allCandidates = buildCandidateList(episodes || [], { origin: originPoint, radiusKm });
    const candidates = excludeCandidates(allCandidates, exclude);

    if (!candidates.length) {
      const emptyNotice = exclude.length
        ? '조건에 맞는 다른 후보를 더 찾지 못했습니다.'
        : '조건에 맞는 후보를 찾지 못했습니다.';
      res.status(200).json({ picks: [], origin: intent.origin, radius_km: radiusKm, notice: notice || emptyNotice });
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
      origin: intent.origin,
      radius_km: radiusKm,
      notice,
    });
  } catch (err) {
    res.status(err.quotaExceeded ? 429 : 500).json({ error: err.message });
  }
};
