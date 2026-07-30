// 회차 상세 조회(GET) 및 식당 정보 수정(PUT, 관리자 인증 필요)
const { getSupabase } = require('../../lib/supabase');
const { verifyToken } = require('../../lib/auth');

function cleanRestaurants(input) {
  if (!Array.isArray(input)) return null;
  return input
    .filter((r) => r && typeof r.name === 'string' && r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      address: typeof r.address === 'string' ? r.address.trim() : '',
      tel: r.tel || null,
      lat: typeof r.lat === 'number' ? r.lat : null,
      lng: typeof r.lng === 'number' ? r.lng : null,
      place_id: r.place_id || null,
    }));
}

module.exports = async function handler(req, res) {
  const episode = Number(req.query.id);
  if (!Number.isInteger(episode)) {
    res.status(400).json({ error: '올바르지 않은 회차 번호입니다.' });
    return;
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('episodes').select('*').eq('episode', episode).single();
    if (error) {
      res.status(404).json({ error: '해당 회차를 찾을 수 없습니다.' });
      return;
    }
    res.status(200).json(data);
    return;
  }

  if (req.method === 'PUT') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!verifyToken(token)) {
      res.status(401).json({ error: '인증이 필요합니다. 편집 모드로 다시 로그인해주세요.' });
      return;
    }

    const restaurants = cleanRestaurants((req.body || {}).restaurants);
    if (restaurants === null) {
      res.status(400).json({ error: 'restaurants는 배열이어야 합니다.' });
      return;
    }

    const { data, error } = await supabase
      .from('episodes')
      .update({ restaurants, verified: Boolean((req.body || {}).verified) })
      .eq('episode', episode)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json(data);
    return;
  }

  res.status(405).json({ error: 'GET/PUT만 허용됩니다.' });
};
