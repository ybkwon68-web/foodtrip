// 백반기행에 소개된 식당들을 네이버 지도 위에 마커로 표시하는 스크립트
const DATA_URL = './data/episodes.json';

const mapCount = document.getElementById('mapCount');
const mapSearch = document.getElementById('mapSearch');

let episodes = [];
let markers = []; // { marker, haystack }
let activeInfoWindow = null;
let map;
let clustering;

// 마커 개수 구간별로 커지는 원형 클러스터 뱃지 (2~9 / 10~49 / 50+)
function clusterIconDef(size, sizeClass) {
  return {
    content: `<div class="map-cluster ${sizeClass}"><span class="map-cluster-count"></span></div>`,
    size: new naver.maps.Size(size, size),
    anchor: new naver.maps.Point(size / 2, size / 2),
  };
}
const CLUSTER_ICONS = [
  clusterIconDef(34, 'map-cluster-sm'),
  clusterIconDef(42, 'map-cluster-md'),
  clusterIconDef(52, 'map-cluster-lg'),
];

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
      // map은 지정하지 않는다 — 클러스터링 인스턴스가 표시 여부를 관리한다.
      const marker = new naver.maps.Marker({ position, title: r.name });
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

// 검색 필터가 바뀔 때마다 클러스터링 인스턴스를 새로 만든다 —
// setMarkers()로 마커 목록만 갱신하면 라이브러리 내부 KVO 키 이름 불일치로
// 재클러스터링이 일어나지 않는 알려진 문제가 있어, destroy 후 재생성이 더 안전하다.
function applyClustering(activeMarkers) {
  if (clustering) clustering.setMap(null);
  clustering = new MarkerClustering({
    map,
    markers: activeMarkers,
    gridSize: 100,
    maxZoom: 15,
    minClusterSize: 3,
    disableClickZoom: false,
    icons: CLUSTER_ICONS,
    indexGenerator: [10, 50],
    stylingFunction: (clusterMarker, count) => {
      const el = clusterMarker.getElement();
      const countEl = el && el.querySelector('.map-cluster-count');
      if (countEl) countEl.textContent = count;
    },
  });
}

function render() {
  const query = mapSearch.value.trim().toLowerCase();
  const active = [];
  markers.forEach((m) => {
    if (!query || m.haystack.includes(query)) active.push(m.marker);
  });
  applyClustering(active);
  mapCount.textContent = `총 ${active.length}개 식당 표시 중 (좌표 확인된 전체 ${markers.length}개)`;
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
