// 백반기행에 소개된 식당들을 네이버 지도 위에 마커로 표시하는 스크립트
const DATA_URL = './data/episodes.json';

const mapCount = document.getElementById('mapCount');
const mapSearch = document.getElementById('mapSearch');

let episodes = [];
let markers = []; // { marker, haystack }
let activeInfoWindow = null;
let map;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// 네이버 플레이스 ID가 있으면 정확한 장소 페이지로, 없으면 이름+주소 검색으로 연결
function mapUrl(r) {
  if (r.place_id) return `https://map.naver.com/p/entry/place/${r.place_id}`;
  const q = [r.name, r.address].filter(Boolean).join(' ');
  return `https://map.naver.com/p/search/${encodeURIComponent(q)}`;
}

async function loadEpisodes() {
  try {
    const res = await fetch('/api/episodes');
    if (res.ok) {
      episodes = await res.json();
      return;
    }
  } catch (err) {
    // /api 서버리스 함수가 없는 환경(로컬 정적 서버 등) — 정적 스냅샷으로 폴백
  }
  const fallback = await fetch(DATA_URL);
  if (!fallback.ok) throw new Error(`데이터를 불러오지 못했습니다 (${fallback.status})`);
  episodes = await fallback.json();
}

function buildMarkers() {
  episodes.forEach((ep) => {
    (ep.restaurants || []).forEach((r) => {
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return;

      const position = new naver.maps.LatLng(r.lat, r.lng);
      const marker = new naver.maps.Marker({ position, map, title: r.name });
      const content = `
        <div class="map-info">
          <span class="map-info-ep">제${ep.episode}회</span>
          <p class="map-info-name">${escapeHtml(r.name)}</p>
          <p class="map-info-addr">${escapeHtml(r.address || '')}</p>
          <div class="map-info-links">
            <a href="./index.html#/episode/${ep.episode}">회차 상세보기</a>
            <a href="${mapUrl(r)}" target="_blank" rel="noopener">네이버맵 ↗</a>
          </div>
        </div>
      `;
      const infoWindow = new naver.maps.InfoWindow({ content, borderWidth: 0, backgroundColor: 'transparent', disableAnchor: true });

      naver.maps.Event.addListener(marker, 'click', () => {
        if (activeInfoWindow) activeInfoWindow.close();
        infoWindow.open(map, marker);
        activeInfoWindow = infoWindow;
      });

      const haystack = [ep.title, ep.raw_title, ep.region, r.name, r.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      markers.push({ marker, haystack });
    });
  });
}

// 캐나다·홍콩·일본 해외 특집 회차의 좌표까지 포함하면 초기 화면이 지나치게
// 축소되므로, 첫 화면 범위는 국내 좌표만으로 맞추고 해외 마커는 그대로 표시해둔다.
function isDomestic(latlng) {
  const lat = latlng.lat();
  const lng = latlng.lng();
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
}

function fitBounds() {
  const domestic = markers.filter((m) => isDomestic(m.marker.getPosition()));
  const target = domestic.length ? domestic : markers;
  if (!target.length) return;
  const start = target[0].marker.getPosition();
  const bounds = new naver.maps.LatLngBounds(start, start);
  target.forEach((m) => bounds.extend(m.marker.getPosition()));
  map.fitBounds(bounds);
}

function render() {
  const query = mapSearch.value.trim().toLowerCase();
  let visible = 0;
  markers.forEach((m) => {
    const match = !query || m.haystack.includes(query);
    m.marker.setMap(match ? map : null);
    if (match) visible += 1;
  });
  mapCount.textContent = `총 ${visible}개 식당 표시 중 (좌표 확인된 전체 ${markers.length}개)`;
}

function init() {
  map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(36.5, 127.8),
    zoom: 7,
    zoomControl: true,
    zoomControlOptions: { position: naver.maps.Position.TOP_RIGHT },
  });
  buildMarkers();
  fitBounds();
  render();
}

mapSearch.addEventListener('input', render);

loadEpisodes()
  .then(init)
  .catch((err) => {
    mapCount.textContent = err.message;
  });
