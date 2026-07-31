// 카카오 로컬 API로 주소 문자열을 위도/경도로 변환하는 헬퍼
async function geocodeAddress(address) {
  const key = process.env.KAKAO_REST_API_KEY;
  // 키 미설정 시(발급 전, 또는 API 장애) 좌표 없이 저장을 계속 진행한다(fail-open).
  if (!key || !address) return null;

  try {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${key}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const first = data.documents && data.documents[0];
    if (!first) return null;

    const lat = Number(first.y);
    const lng = Number(first.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    return null;
  }
}

module.exports = { geocodeAddress };
