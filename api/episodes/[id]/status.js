// 식당 1곳의 폐업/이전 의심 배지에 대한 관리자 확정·원복을 처리하는 엔드포인트(관리자 인증 필요)
// 폐업/이전 점검 스크립트(crawler/check_status.py)는 "의심"만 남기고, 실제 확정은 이 엔드포인트로
// 관리자가 직접 한다. status_check 외 필드는 "확정" 시 이전(주소변경) 정보만 예외적으로 반영하고
// (아래 참고) 그 외에는 건드리지 않는다 — 편집 폼의 일반 저장 경로(../[id].js)와 달리 이 회차의
// 다른 식당들은 전혀 건드리지 않는다.
//
// 이미 status_check가 있는 식당(자동 점검이 먼저 의심을 남긴 경우)이면 admin_decision만 갱신한다.
// status_check가 아직 없는 식당(관리자가 자동 점검보다 먼저 폐업/이전을 알게 된 경우)이면
// closureSuspected/movedSuspected(+선택적 candidateAddress)로 새로 만든다 — source:"manual",
// confidence:"high"(본인이 직접 확인한 것이므로 자동 점검보다 신뢰도 높음으로 취급).
//
// "확정"(decision:"confirmed")이면서 이전 의심 + candidate_address가 있으면, 그 시점의
// status_check가 자동 탐지든 방금 수동 등록한 것이든 실제 address도 그 값으로 갱신하고
// 좌표를 다시 지오코딩한다 — 관리자가 명시적으로 "확정"했다는 것 자체가 이 정보를 신뢰한다는
// 뜻이므로, 이 경우만 기존 "자동으로 필드를 건드리지 않는다" 원칙의 예외로 둔다(사용자 요청).
const { getSupabase } = require('../../../lib/supabase');
const { verifyToken } = require('../../../lib/auth');
const { geocodeAddress } = require('../../../lib/geocode');

const ALLOWED_DECISIONS = new Set(['confirmed', 'dismissed']);

module.exports = async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.status(405).json({ error: 'PUT만 허용됩니다.' });
    return;
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!verifyToken(token)) {
    res.status(401).json({ error: '인증이 필요합니다. 편집 모드로 다시 로그인해주세요.' });
    return;
  }

  const episode = Number(req.query.id);
  if (!Number.isInteger(episode)) {
    res.status(400).json({ error: '올바르지 않은 회차 번호입니다.' });
    return;
  }

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const decision = body.decision;
  if (!name || !ALLOWED_DECISIONS.has(decision)) {
    res.status(400).json({ error: 'name과 decision("confirmed" 또는 "dismissed")이 필요합니다.' });
    return;
  }
  const closureSuspected = Boolean(body.closureSuspected);
  const movedSuspected = Boolean(body.movedSuspected);
  const candidateAddress = typeof body.candidateAddress === 'string' ? body.candidateAddress.trim() : '';

  const supabase = getSupabase();
  const { data: current, error: fetchError } = await supabase
    .from('episodes')
    .select('restaurants')
    .eq('episode', episode)
    .single();
  if (fetchError) {
    res.status(404).json({ error: '해당 회차를 찾을 수 없습니다.' });
    return;
  }

  const restaurants = current.restaurants || [];
  const target = restaurants.find((r) => r.name === name);
  if (!target) {
    res.status(404).json({ error: '해당 식당을 찾을 수 없습니다.' });
    return;
  }

  if (target.status_check && !closureSuspected && !movedSuspected) {
    // 확정/원복 버튼(자동 탐지 결과에 대한 단순 결정)만 눌렀을 때 — admin_decision만 갱신.
    target.status_check = { ...target.status_check, admin_decision: decision };
  } else if (target.status_check) {
    // 등록 폼을 다시 제출한 경우(재입력) — closureSuspected/movedSuspected/candidateAddress를
    // 새 값으로 덮어쓴다. 이 분기가 없으면 폼을 두 번째 제출할 때 이미 status_check가 있다는
    // 이유만으로 admin_decision만 바뀌고 새로 입력한 주소는 조용히 무시되는 버그가 있었음
    // (실측: 사용자가 주소를 재입력해도 "추정 새 주소"가 처음 입력값에 고정돼 안 바뀜).
    target.status_check = {
      ...target.status_check,
      closure_suspected: closureSuspected,
      moved_suspected: movedSuspected,
      admin_decision: decision,
    };
    if (movedSuspected && candidateAddress) {
      target.status_check.candidate_address = candidateAddress;
    } else {
      delete target.status_check.candidate_address;
    }
  } else {
    if (!closureSuspected && !movedSuspected) {
      res.status(400).json({ error: '폐업/휴업 또는 이전 중 최소 하나는 선택해야 합니다.' });
      return;
    }
    target.status_check = {
      checked_at: new Date().toISOString(),
      source: 'manual',
      confidence: 'high',
      closure_suspected: closureSuspected,
      moved_suspected: movedSuspected,
      note: '관리자가 직접 확인해 등록함',
      admin_decision: decision,
    };
    if (movedSuspected && candidateAddress) {
      target.status_check.candidate_address = candidateAddress;
    }
  }

  if (decision === 'confirmed' && target.status_check.moved_suspected && target.status_check.candidate_address) {
    target.address = target.status_check.candidate_address;
    target.place_id = null; // 예전 위치의 place_id는 새 주소와 무관해지므로 초기화
    target.tel = null;
    const coords = await geocodeAddress(target.address);
    if (coords) {
      target.lat = coords.lat;
      target.lng = coords.lng;
    }
  }

  const { error: updateError } = await supabase.from('episodes').update({ restaurants }).eq('episode', episode);
  if (updateError) {
    res.status(500).json({ error: updateError.message });
    return;
  }

  // status_check 확정 시 address/lat/lng/place_id/tel도 같이 바뀔 수 있어(위 로직), 클라이언트가
  // status_check만 받으면 화면이 예전 주소로 다시 그려지는 문제가 있었음 — 식당 객체 전체를 함께 보낸다.
  res.status(200).json({ status_check: target.status_check, restaurant: target });
};
