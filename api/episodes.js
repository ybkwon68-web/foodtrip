// 회차 목록 전체를 반환하는 엔드포인트
const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET만 허용됩니다.' });
    return;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('episodes')
      .select('*')
      .order('episode', { ascending: false });
    if (error) throw error;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
