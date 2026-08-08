// 회차 목록 조회와 새 방송분 등록을 처리하는 엔드포인트
const { getSupabase } = require('../lib/supabase');
const { verifyToken } = require('../lib/auth');
const { geocodeAddress } = require('../lib/geocode');

async function cleanRestaurants(input) {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .filter((r) => r && typeof r.name === 'string' && r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      address: typeof r.address === 'string' ? r.address.trim() : '',
      menu: typeof r.menu === 'string' ? r.menu.trim() : '',
      review: typeof r.review === 'string' ? r.review.trim() : '',
      tel: r.tel || null,
      lat: typeof r.lat === 'number' ? r.lat : null,
      lng: typeof r.lng === 'number' ? r.lng : null,
      place_id: r.place_id || null,
      source_url: typeof r.source_url === 'string' ? r.source_url : null,
    }));

  await Promise.all(
    cleaned.map(async (r) => {
      if (r.lat !== null || r.lng !== null || !r.address) return;
      const coords = await geocodeAddress(r.address);
      if (coords) {
        r.lat = coords.lat;
        r.lng = coords.lng;
      }
    })
  );

  return cleaned;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('episodes')
        .select('episode,title,raw_title,air_date,thumbnail,detail_url,region,restaurants,restaurants_source_url,verified,updated_at')
        .order('episode', { ascending: false });
      if (error) throw error;

      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.status(200).json(data);
      return;
    } catch (err) {
      res.status(500).json({ error: err.message });
      return;
    }
  }

  if (req.method === 'POST') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!verifyToken(token)) {
      res.status(401).json({ error: '인증이 필요합니다. 편집 모드로 다시 로그인해주세요.' });
      return;
    }

    const body = req.body || {};
    const episode = Number(body.episode);
    if (!Number.isInteger(episode) || episode < 1) {
      res.status(400).json({ error: '올바른 회차 번호를 입력해주세요.' });
      return;
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const raw_title = typeof body.raw_title === 'string' ? body.raw_title.trim() : '';
    if (!title && !raw_title) {
      res.status(400).json({ error: '제목 또는 원제를 입력해주세요.' });
      return;
    }

    const restaurants = await cleanRestaurants(body.restaurants);
    const episodeData = {
      episode,
      title: title || null,
      raw_title: raw_title || null,
      air_date: typeof body.air_date === 'string' && body.air_date.trim() ? body.air_date.trim() : null,
      region: typeof body.region === 'string' ? body.region.trim() : null,
      detail_url: typeof body.detail_url === 'string' ? body.detail_url.trim() : null,
      restaurants,
      restaurants_source_url: null,
      verified: false,
    };

    try {
      const supabase = getSupabase();
      const { data: existing, error: fetchError } = await supabase
        .from('episodes')
        .select('episode')
        .eq('episode', episode)
        .maybeSingle();
      if (fetchError) {
        throw fetchError;
      }
      if (existing) {
        res.status(409).json({ error: '이미 존재하는 회차입니다.' });
        return;
      }

      const { data, error } = await supabase.from('episodes').insert(episodeData).select().single();
      if (error) {
        throw error;
      }
      res.status(201).json(data);
      return;
    } catch (err) {
      res.status(500).json({ error: err.message });
      return;
    }
  }

  res.status(405).json({ error: 'GET/POST만 허용됩니다.' });
};
