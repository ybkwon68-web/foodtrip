// 네이버 Geocoding API로 주소 문자열을 위도/경도로 변환하는 헬퍼
async function geocodeAddress(address) {
  const keyId = process.env.NAVER_GEOCODE_CLIENT_ID;
  const key = process.env.NAVER_GEOCODE_CLIENT_SECRET;
  // 키 미설정 시(발급 전, 또는 API 장애) 좌표 없이 저장을 계속 진행한다(fail-open).
  if (!keyId || !key || !address) return null;

  try {
    const url = `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: {
        'x-ncp-apigw-api-key-id': keyId,
        'x-ncp-apigw-api-key': key,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const first = data.addresses && data.addresses[0];
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
