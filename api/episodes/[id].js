// 회차 상세 조회(GET) 및 식당 정보 수정(PUT, 관리자 인증 필요)
const { getSupabase } = require('../../lib/supabase');
const { verifyToken } = require('../../lib/auth');
const { geocodeAddress } = require('../../lib/geocode');

async function cleanRestaurants(input) {
  if (!Array.isArray(input)) return null;
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
      // 폐업/이전 점검 스크립트(crawler/check_status.py)가 남긴 점검 기록. 이 필드는 편집 폼에
      // 입력칸이 없어 그냥 두면 유실되므로(프론트가 name/address/menu/review/tel/lat/lng/place_id만
      // 다시 보내옴) 그대로 통과시켜 보존한다 — 안 그러면 이 회차의 아무 식당이나 한 번만 저장해도
      // 전체 status_check가 조용히 사라지는 문제가 있었음.
      status_check: r.status_check && typeof r.status_check === 'object' ? r.status_check : null,
    }));

  // 좌표가 없는(신규 등록·주소 변경) 식당은 저장 전에 자동으로 지오코딩을 시도한다.
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
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(data);
    return;
  }

  if (req.method === 'PUT') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!verifyToken(token)) {
      res.status(401).json({ error: '인증이 필요합니다. 편집 모드로 다시 로그인해주세요.' });
      return;
    }

    const restaurants = await cleanRestaurants((req.body || {}).restaurants);
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
