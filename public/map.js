// 백반기행에 소개된 식당들을 네이버 지도 위에 마커로 표시하는 스크립트
const DATA_URL = './data/episodes.json';

const mapCount = document.getElementById('mapCount');
const mapSearch = document.getElementById('mapSearch');
const mapLocateBtn = document.getElementById('mapLocateBtn');
const mapLocateStatus = document.getElementById('mapLocateStatus');

let episodes = [];
let markers = []; // { marker, haystack }
let activeInfoWindow = null;
let map;
let clustering;
let myLocationMarker = null; // 클러스터링 대상이 아닌, "내 위치"를 표시하는 별도 마커

// 마커 개수 구간별로 커지는 원형 클러스터 뱃지 (2~9 / 10~49 / 50+)
function clusterIconDef(size, sizeClass) {
  return {
    content: `<div class="map-cluster ${sizeClass}"><span class="map-cluster-count"></span></div>`,
    size: new naver.maps.Size(size, size),
    anchor: new naver.maps.Point(size / 2, size / 2),
  };
}
const CLUSTER_ICONS = [
  clusterIconDef(40, 'map-cluster-sm'),
  clusterIconDef(50, 'map-cluster-md'),
  clusterIconDef(62, 'map-cluster-lg'),
];

// 네이버 기본 마커는 파란색이라 바탕지도의 파란 요소(도로 번호, 하천, 건물 아이콘)와
// 섞여 잘 안 보인다는 사용자 지적에 따라, 클러스터 배지와 같은 계열(accent) 원형 마커로 교체.
const RESTAURANT_ICON = {
  content: '<div class="map-pin"></div>',
  size: new naver.maps.Size(20, 20),
  anchor: new naver.maps.Point(10, 10),
};

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

// 폐업/이전 점검 스크립트(crawler/check_status.py)가 남긴 status_check가 의심 상태면 배지를 붙인다.
// 배지를 누르면 사유(폐업/이전 등)·근거·신뢰도·확인 시각을 보여주는 말풍선이 뜬다.
// 지도로 보기는 편집모드가 없는 읽기 전용 화면이라 확정/원복 버튼은 없음 — 관리자가 회차
// 상세보기에서 내린 결정(admin_decision)만 그대로 반영해서 보여준다.
function statusCheckBadge(sc) {
  if (!sc || (!sc.closure_suspected && !sc.moved_suspected)) return '';
  if (sc.admin_decision === 'dismissed') return '';
  const confirmed = sc.admin_decision === 'confirmed';
  const reasons = [];
  if (sc.closure_suspected) reasons.push(confirmed ? '폐업' : '폐업/휴업 의심');
  if (sc.moved_suspected) reasons.push(confirmed ? '이전' : '이전 의심');
  const confidenceLabel = sc.confidence === 'high' ? '높음' : '낮음';
  const checkedAt = sc.checked_at ? new Date(sc.checked_at).toLocaleString('ko-KR') : '';
  const addrRow = sc.moved_suspected && sc.candidate_address
    ? `<span class="status-check-popup-addr">추정 새 주소: ${escapeHtml(sc.candidate_address)}</span>`
    : '';
  const badgeLabel = confirmed ? `🔴 ${reasons.join('·')}` : '⚠️ 확인 필요';
  const badgeClass = confirmed ? 'badge-status-check badge-status-confirmed' : 'badge-status-check';
  // 배지가 <p> 안에 놓이는 화면(회차 상세보기·지도 인포윈도우)이 있어, 말풍선도 전부 인라인
  // 태그(span)로만 구성한다 — <p> 안에 <div>/<p>를 넣으면 브라우저가 파싱 중 자동으로 태그를
  // 잘라버려 말풍선 자체가 DOM에서 사라지는 문제가 실측으로 확인됨(세로 배치는 CSS display:block으로 처리).
  return `
    <span class="status-check-wrap">
      <button type="button" class="${badgeClass}">${badgeLabel}</button>
      <span class="status-check-popup" hidden>
        <span class="status-check-popup-title">${escapeHtml(reasons.join(' · '))}</span>
        <span class="status-check-popup-note">${escapeHtml(sc.note || '')}</span>
        ${addrRow}
        <span class="status-check-popup-meta">신뢰도: ${confidenceLabel}${checkedAt ? ` · ${checkedAt} 확인` : ''}</span>
      </span>
    </span>
  `;
}

// 배지 클릭 시 해당 말풍선만 토글하고, 그 외 클릭은 열려있는 말풍선을 전부 닫는다.
// 네이버 지도 InfoWindow 내부 구현이 버블링 단계에서 클릭 전파를 막는 것으로 보여(지도 패닝
// 방지 목적으로 추정), 캡처 단계(useCapture:true)로 등록해 그보다 먼저 잡아낸다.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.badge-status-check');
  const openPopups = document.querySelectorAll('.status-check-popup:not([hidden])');
  if (!btn) {
    openPopups.forEach((p) => { p.hidden = true; });
    return;
  }
  e.stopPropagation();
  const popup = btn.nextElementSibling;
  const wasHidden = popup.hidden;
  openPopups.forEach((p) => { p.hidden = true; });
  popup.hidden = !wasHidden;
}, true);

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
      const marker = new naver.maps.Marker({ position, title: r.name, icon: RESTAURANT_ICON });
      const content = `
        <div class="map-info">
          <span class="map-info-ep">제${ep.episode}회</span>
          <p class="map-info-name">${escapeHtml(r.name)}${statusCheckBadge(r.status_check)}</p>
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
      // Ensure activeInfoWindow is cleared when this infoWindow is closed
      try {
        naver.maps.Event.addListener(infoWindow, 'close', () => {
          if (activeInfoWindow === infoWindow) activeInfoWindow = null;
        });
      } catch (e) {
        // Some environments may not emit 'close' for InfoWindow; fall back to map/key handlers
      }

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

// "내 위치로 보기" 버튼: 브라우저 위치 권한을 요청해 지도를 그 위치로 이동시키고
// 별도 마커(파란 점)로 표시한다. 클러스터링 대상(식당 마커)과는 분리된 마커.
function locateMe() {
  if (!navigator.geolocation) {
    mapLocateStatus.textContent = '이 브라우저는 위치 사용을 지원하지 않습니다.';
    mapLocateStatus.hidden = false;
    return;
  }

  mapLocateBtn.disabled = true;
  mapLocateStatus.textContent = '내 위치를 확인하는 중입니다...';
  mapLocateStatus.hidden = false;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latlng = new naver.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
      if (myLocationMarker) {
        myLocationMarker.setPosition(latlng);
      } else {
        myLocationMarker = new naver.maps.Marker({
          position: latlng,
          map,
          zIndex: 200,
          icon: {
            content: '<div class="map-my-location-dot"></div>',
            size: new naver.maps.Size(16, 16),
            anchor: new naver.maps.Point(8, 8),
          },
        });
      }
      map.setCenter(latlng);
      map.setZoom(15);
      mapLocateBtn.disabled = false;
      mapLocateStatus.hidden = true;
    },
    (err) => {
      mapLocateStatus.textContent =
        err.code === err.PERMISSION_DENIED
          ? '위치 권한이 거부되어 사용할 수 없습니다. 브라우저 설정에서 허용해주세요.'
          : '위치를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.';
      mapLocateStatus.hidden = false;
      mapLocateBtn.disabled = false;
    },
    { timeout: 8000, maximumAge: 60000 }
  );
}
mapLocateBtn.addEventListener('click', locateMe);

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

  // Close any open info window when clicking on the map background
  naver.maps.Event.addListener(map, 'click', () => {
    if (activeInfoWindow) {
      activeInfoWindow.close();
      activeInfoWindow = null;
    }
  });

  // Close info window with ESC key for keyboard accessibility
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      if (activeInfoWindow) {
        activeInfoWindow.close();
        activeInfoWindow = null;
      }
    }
  });
}

mapSearch.addEventListener('input', render);

loadEpisodes()
  .then(init)
  .catch((err) => {
    mapCount.textContent = err.message;
  });
