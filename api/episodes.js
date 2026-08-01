// 회차 목록 전체를 반환하는 엔드포인트
const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET만 허용됩니다.' });
    return;
  }

  try {
    const supabase = getSupabase();
    // body_html(방송 본문 원문)은 상세보기를 연 회차 1건만 /api/episodes/:id로 따로 불러오므로
    // 목록 응답에서는 제외한다 — 352건 전체에 포함시키면 응답이 8MB를 넘어감(93%가 body_html).
    const { data, error } = await supabase
      .from('episodes')
      .select('episode,title,raw_title,air_date,thumbnail,detail_url,region,restaurants,restaurants_source_url,verified,updated_at')
      .order('episode', { ascending: false });
    if (error) throw error;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
