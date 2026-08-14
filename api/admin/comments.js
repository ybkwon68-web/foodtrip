// 식당 제보(댓글) 관리 — 전체 목록 조회(GET), 삭제(DELETE). 전부 관리자 인증 필요.
// 제보는 작성 즉시 공개되므로 별도의 승인/거부 단계는 없다 — 부적절한 제보는 삭제로 정리한다.
const { getSupabase } = require('../../lib/supabase');
const { verifyToken } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!verifyToken(token)) {
    res.status(401).json({ error: '인증이 필요합니다. 편집 모드로 다시 로그인해주세요.' });
    return;
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('restaurant_comments')
      .select('id, episode, restaurant_name, content, created_at')
      .order('created_at', { ascending: false });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json(data);
    return;
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) {
      res.status(400).json({ error: 'id가 필요합니다.' });
      return;
    }
    const { error } = await supabase.from('restaurant_comments').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).end();
    return;
  }

  res.status(405).json({ error: 'GET/DELETE만 허용됩니다.' });
};
