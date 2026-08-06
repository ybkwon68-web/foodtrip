// 회차 1개의 식당들을 폐업/이전 자동 점검하는 엔드포인트(관리자 인증 필요)
// crawler/check_status.py를 터미널 없이 웹에서 돌릴 수 있도록 회차 단위로 쪼갠 버전 — 전체
// 352회를 한 번의 요청으로 처리하면 서버리스 함수 실행시간 제한을 넘기므로, 프론트(public/script.js)가
// 회차 범위를 순회하며 이 엔드포인트를 하나씩 호출한다.
const { getSupabase } = require('../../lib/supabase');
const { verifyToken } = require('../../lib/auth');
const { checkOne } = require('../../lib/statusCheck');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 허용됩니다.' });
    return;
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!verifyToken(token)) {
    res.status(401).json({ error: '인증이 필요합니다. 편집 모드로 다시 로그인해주세요.' });
    return;
  }

  const episode = Number((req.body || {}).episode);
  if (!Number.isInteger(episode)) {
    res.status(400).json({ error: '올바르지 않은 회차 번호입니다.' });
    return;
  }
  const apply = Boolean((req.body || {}).apply);
  const kakaoKey = process.env.KAKAO_REST_API_KEY;

  const supabase = getSupabase();
  const { data, error } = await supabase.from('episodes').select('restaurants').eq('episode', episode).maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(200).json({ episode, notFound: true, checked: 0, skipped: 0, flagged: [] });
    return;
  }

  const restaurants = data.restaurants || [];
  let checked = 0;
  let skipped = 0;
  let changed = false;
  const flagged = [];

  for (const r of restaurants) {
    if (!r.name) continue;
    const existing = r.status_check || {};
    if (existing.admin_decision === 'confirmed' && existing.closure_suspected) {
      // "폐업"으로 확정된 곳만 더 볼 필요가 없어 건너뛴다. "이전" 확정·원복된 곳은 여전히
      // 영업 중일 가능성이 있어 계속 점검 대상에 남긴다(check_status.py와 동일한 규칙).
      skipped++;
      continue;
    }
    const statusCheck = await checkOne(kakaoKey, r);
    if (!statusCheck) continue; // 네트워크/파싱 실패 — 판정 보류, 다음 실행에 재시도
    r.status_check = statusCheck;
    checked++;
    changed = true;
    if (statusCheck.closure_suspected || statusCheck.moved_suspected) {
      flagged.push({ name: r.name, ...statusCheck });
    }
  }

  if (changed && apply) {
    const { error: updateError } = await supabase.from('episodes').update({ restaurants }).eq('episode', episode);
    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }
  }

  res.status(200).json({ episode, checked, skipped, flagged, applied: apply });
};
