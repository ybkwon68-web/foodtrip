// 식당 폐업/이전 등 정보 제보(댓글) — 공개: 제보 조회(GET, 작성 즉시 공개), 신규 제보 등록(POST, 레이트리밋)
const { getSupabase } = require('../../../lib/supabase');
const { checkCommentRateLimit } = require('../../../lib/rateLimit');

const MAX_CONTENT_LENGTH = 500;

module.exports = async function handler(req, res) {
  const episode = Number(req.query.id);
  if (!Number.isInteger(episode)) {
    res.status(400).json({ error: '올바르지 않은 회차 번호입니다.' });
    return;
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('restaurant_comments')
      .select('id, restaurant_name, content, created_at')
      .eq('episode', episode)
      .order('created_at', { ascending: true });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(data);
    return;
  }

  if (req.method === 'POST') {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    const { allowed, retryAfterSeconds } = await checkCommentRateLimit(ip);
    if (!allowed) {
      res.status(429).json({ error: `제보 횟수를 초과했습니다. ${retryAfterSeconds}초 후 다시 시도해주세요.` });
      return;
    }

    const body = req.body || {};
    const restaurantName = typeof body.restaurant_name === 'string' ? body.restaurant_name.trim() : '';
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!restaurantName || !content) {
      res.status(400).json({ error: '식당명과 제보 내용을 입력해주세요.' });
      return;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      res.status(400).json({ error: `제보 내용은 ${MAX_CONTENT_LENGTH}자 이내로 입력해주세요.` });
      return;
    }

    const { data, error } = await supabase
      .from('restaurant_comments')
      .insert({ episode, restaurant_name: restaurantName, content })
      .select()
      .single();
    if (error) {
      if (error.code === '23503') {
        res.status(404).json({ error: '해당 회차를 찾을 수 없습니다.' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json(data);
    return;
  }

  res.status(405).json({ error: 'GET/POST만 허용됩니다.' });
};
