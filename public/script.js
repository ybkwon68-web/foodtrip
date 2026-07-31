// 백반기행 아카이브 목록/상세 화면 렌더링과 검색·정렬·해시 라우팅을 담당하는 스크립트
const DATA_URL = './data/episodes.json';

const grid = document.getElementById('grid');
const resultCount = document.getElementById('resultCount');
const listView = document.getElementById('listView');
const detailView = document.getElementById('detailView');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const editToggle = document.getElementById('editToggle');

const pencilIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
const pinIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z"></path><circle cx="12" cy="9.5" r="2.3"></circle></svg>';
const forkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3v6a1.5 1.5 0 0 0 1.5 1.5h0A1.5 1.5 0 0 0 9 9V3M7.5 10.5V21M16 3c-1.66 0-3 1.79-3 5v3h3M16 11v10"></path></svg>';

let episodes = [];

function getAdminToken() {
  const token = localStorage.getItem('foodtrip_admin_token');
  const expiresAt = Number(localStorage.getItem('foodtrip_admin_expires') || 0);
  if (!token || Date.now() > expiresAt) return null;
  return token;
}

function clearAdminSession() {
  localStorage.removeItem('foodtrip_admin_token');
  localStorage.removeItem('foodtrip_admin_expires');
}

let editing = Boolean(getAdminToken());

function truncateAddress(addr) {
  if (!addr) return null;
  return addr.split(' ').slice(0, 2).join(' ');
}

function formatDate(iso) {
  if (!iso) return '';
  return iso.replaceAll('-', '.');
}

// 네이버 플레이스 ID가 있으면 정확한 장소 페이지로, 없으면 이름+주소 검색으로 연결
function mapUrl(restaurant) {
  if (restaurant && restaurant.place_id) {
    return `https://map.naver.com/p/entry/place/${restaurant.place_id}`;
  }
  const q = [restaurant && restaurant.name, restaurant && restaurant.address].filter(Boolean).join(' ');
  return `https://map.naver.com/p/search/${encodeURIComponent(q)}`;
}

function mapSearchUrl(query) {
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
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

function matchesSearch(ep, query) {
  if (!query) return true;
  const restaurantNames = (ep.restaurants || []).map((r) => r.name).join(' ');
  const haystack = [ep.title, ep.raw_title, ep.region, restaurantNames]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function sortEpisodes(list, mode) {
  const withEp = list.filter((e) => e.episode != null);
  const withoutEp = list.filter((e) => e.episode == null);
  withEp.sort((a, b) => (mode === 'episode' ? a.episode - b.episode : b.episode - a.episode));
  return [...withEp, ...withoutEp];
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function cardTemplate(ep) {
  const restaurants = ep.restaurants || [];
  const primary = restaurants[0];
  const extra = restaurants.length - 1;
  const badge = ep.verified
    ? '<span class="badge-verified">확인됨</span>'
    : '<span class="badge-unverified">미검수</span>';

  let nameRow = '';
  let addrRow;
  if (primary) {
    const extraLabel = extra > 0 ? ` 외 ${extra}곳` : '';
    nameRow = `<p class="spot-name">${forkIcon}<span class="spot-name-text">${escapeHtml(primary.name)}${extraLabel}</span></p>`;
    const addr = truncateAddress(primary.address);
    addrRow = addr
      ? `<p class="spot-row">${pinIcon}<a href="${mapUrl(primary)}" target="_blank" rel="noopener">${escapeHtml(addr)}</a>${badge}</p>`
      : `<p class="spot-row muted">주소 미확인${badge}</p>`;
  } else {
    const addr = truncateAddress(ep.region);
    addrRow = addr
      ? `<p class="spot-row">${pinIcon}<a href="${mapSearchUrl(addr)}" target="_blank" rel="noopener">${escapeHtml(addr)}</a>${badge}</p>`
      : `<p class="spot-row muted">주소 미확인${badge}</p>`;
  }

  return `
    <article class="card" data-episode="${ep.episode}" tabindex="0" role="link">
      <span class="card-edit-mark">${pencilIcon}</span>
      <div class="card-body">
        <span class="ep-badge">제${ep.episode}회</span>
        <p class="card-title">${escapeHtml(ep.title || ep.raw_title || '')}</p>
        ${nameRow}
        ${addrRow}
        <p class="card-date">${formatDate(ep.air_date)}</p>
      </div>
    </article>
  `;
}

function renderList() {
  const query = searchInput.value.trim();
  const filtered = episodes.filter((ep) => matchesSearch(ep, query));
  const sorted = sortEpisodes(filtered, sortSelect.value);

  resultCount.textContent = `총 ${sorted.length}개 회차`;

  if (sorted.length === 0) {
    grid.innerHTML = '';
    grid.insertAdjacentHTML('afterend', '<p class="empty-state" id="emptyState">검색 결과가 없습니다.</p>');
    return;
  }
  const prevEmpty = document.getElementById('emptyState');
  if (prevEmpty) prevEmpty.remove();

  grid.innerHTML = sorted.map(cardTemplate).join('');
  grid.classList.toggle('editing', editing);
}

function findEpisode(epNum) {
  return episodes.find((e) => String(e.episode) === String(epNum));
}

function restaurantViewRow(r) {
  const addr = r.address;
  const menuRow = r.menu ? `<p class="spot-field"><strong>소개된 메뉴</strong>${escapeHtml(r.menu)}</p>` : '';
  const reviewRow = r.review ? `<p class="spot-field"><strong>한줄평</strong>${escapeHtml(r.review)}</p>` : '';
  return `
    <div class="restaurant-row">
      <p class="spot-field"><strong>식당명</strong>${escapeHtml(r.name) || '미확인'}</p>
      <p class="spot-field"><strong>위치</strong>${addr ? escapeHtml(addr) : '미확인'}</p>
      ${menuRow}
      ${reviewRow}
      <a class="spot-link" href="${mapUrl(r)}" target="_blank" rel="noopener">네이버맵 ↗</a>
    </div>
  `;
}

// 전화/좌표/placeId는 편집 폼에 입력칸이 없으므로, 주소를 안 건드리면 기존 값을 그대로
// 보존하기 위해 원본 데이터를 행에 함께 담아둔다 (저장 시 restoreGeoIfUnchanged에서 사용).
function restaurantEditRow(r, idx) {
  const origB64 = btoa(unescape(encodeURIComponent(JSON.stringify(r || {}))));
  return `
    <div class="restaurant-edit-row" data-idx="${idx}" data-orig="${origB64}">
      <div class="r-field-row">
        <label>식당명 <input type="text" class="r-name" value="${escapeHtml(r.name)}"></label>
        <label>주소 <input type="text" class="r-addr" value="${escapeHtml(r.address)}"></label>
        <button type="button" class="spot-remove-btn">삭제</button>
      </div>
      <div class="r-field-row">
        <label>소개된 메뉴 <input type="text" class="r-menu" value="${escapeHtml(r.menu || '')}"></label>
        <label>한줄평 <input type="text" class="r-review" value="${escapeHtml(r.review || '')}"></label>
      </div>
    </div>
  `;
}

function collectRestaurantRows(container) {
  return Array.from(container.querySelectorAll('.restaurant-edit-row'))
    .map((row) => {
      const name = row.querySelector('.r-name').value.trim();
      const address = row.querySelector('.r-addr').value.trim();
      const menu = row.querySelector('.r-menu').value.trim();
      const review = row.querySelector('.r-review').value.trim();
      let orig = {};
      try {
        orig = JSON.parse(decodeURIComponent(escape(atob(row.dataset.orig || ''))));
      } catch (err) {
        orig = {};
      }
      const addressUnchanged = Boolean(orig.address) && orig.address === address;
      return {
        name,
        address,
        menu,
        review,
        tel: addressUnchanged ? orig.tel ?? null : null,
        lat: addressUnchanged ? orig.lat ?? null : null,
        lng: addressUnchanged ? orig.lng ?? null : null,
        place_id: addressUnchanged ? orig.place_id ?? null : null,
      };
    })
    .filter((r) => r.name);
}

function renderDetail(epNum) {
  const ep = findEpisode(epNum);
  if (!ep) {
    detailView.innerHTML = `<div class="detail-wrap"><p>존재하지 않는 회차입니다.</p><a class="back-link" href="#/">← 목록으로</a></div>`;
    return;
  }

  const restaurants = ep.restaurants || [];
  const badge = ep.verified
    ? '<span class="badge-verified">확인됨</span>'
    : '<span class="badge-unverified">미검수 · 정보 확인 필요</span>';
  const bodyHtml = ep.body_html ? DOMPurify.sanitize(ep.body_html) : '<p>본문을 불러오지 못했습니다.</p>';

  const viewRows = restaurants.length
    ? restaurants.map(restaurantViewRow).join('')
    : `<p class="spot-field"><strong>식당명</strong>미확인</p><p class="spot-field"><strong>위치</strong>${
        truncateAddress(ep.region) ? escapeHtml(truncateAddress(ep.region)) : '미확인'
      }</p>`;
  const sourceLink = ep.restaurants_source_url
    ? `<a class="spot-link spot-source" href="${ep.restaurants_source_url}" target="_blank" rel="noopener">참고한 블로그 글 보기 ↗</a>`
    : '';
  const editRows = restaurants.length
    ? restaurants.map(restaurantEditRow).join('')
    : restaurantEditRow({}, 0);

  detailView.innerHTML = `
    <div class="detail-wrap">
      <a class="back-link" href="#/">← 목록으로</a>
      <span class="detail-badge">제${ep.episode}회</span>
      <h1 class="detail-title">${escapeHtml(ep.title || ep.raw_title || '')}</h1>
      <div class="detail-meta">방송일 ${formatDate(ep.air_date)}</div>

      <div class="spot-panel">
        <div class="spot-panel-head">
          <span class="spot-panel-title">방문 식당</span>
          ${badge}
        </div>
        <div id="spotView">
          ${viewRows}
          ${sourceLink}
          ${editing ? '<div><button class="spot-edit-btn" id="spotEditBtn" type="button">식당 정보 직접 수정</button></div>' : ''}
        </div>
        <form class="spot-edit-form" id="spotEditForm" hidden>
          <div id="restaurantRows">${editRows}</div>
          <button type="button" class="spot-edit-btn" id="addRestaurantBtn">+ 식당 추가</button>
          <div class="spot-edit-actions">
            <button type="submit" class="btn-save">저장</button>
            <button type="button" class="btn-cancel" id="spotCancelBtn">취소</button>
          </div>
          <p class="spot-note">※ 전화번호·좌표는 이 화면에서 직접 수정할 수 없습니다. 주소를 바꾸면 기존 좌표 정보는 초기화됩니다.</p>
        </form>
      </div>

      <div class="detail-body">${bodyHtml}</div>

      <div class="detail-footer">
        <span>출처: TV조선 식객 허영만의 백반기행</span>
        <a href="${ep.detail_url}" target="_blank" rel="noopener">원본 페이지에서 보기 ↗</a>
      </div>
    </div>
  `;

  const spotEditBtn = document.getElementById('spotEditBtn');
  const spotEditForm = document.getElementById('spotEditForm');
  const spotView = document.getElementById('spotView');
  const spotCancelBtn = document.getElementById('spotCancelBtn');
  const restaurantRows = document.getElementById('restaurantRows');
  const addRestaurantBtn = document.getElementById('addRestaurantBtn');

  if (spotEditBtn) {
    spotEditBtn.addEventListener('click', () => {
      spotView.hidden = true;
      spotEditForm.hidden = false;
    });
  }
  spotCancelBtn.addEventListener('click', () => {
    spotView.hidden = false;
    spotEditForm.hidden = true;
  });
  addRestaurantBtn.addEventListener('click', () => {
    const idx = restaurantRows.children.length;
    restaurantRows.insertAdjacentHTML('beforeend', restaurantEditRow({}, idx));
  });
  restaurantRows.addEventListener('click', (e) => {
    if (!e.target.classList.contains('spot-remove-btn')) return;
    e.target.closest('.restaurant-edit-row').remove();
  });
  spotEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = getAdminToken();
    if (!token) {
      alert('로그인이 만료되었습니다. 편집 모드를 다시 켜주세요.');
      setEditing(false);
      return;
    }

    const restaurants = collectRestaurantRows(restaurantRows);
    const saveBtn = spotEditForm.querySelector('.btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    try {
      const res = await fetch(`/api/episodes/${ep.episode}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ restaurants, verified: true }),
      });
      const data = await res.json();
      if (res.status === 401) {
        clearAdminSession();
        setEditing(false);
        alert('로그인이 만료되었습니다. 다시 로그인해주세요.');
        renderDetail(ep.episode);
        return;
      }
      if (!res.ok) {
        alert(data.error || '저장에 실패했습니다.');
        return;
      }
      Object.assign(ep, data);
      renderDetail(ep.episode);
    } catch (err) {
      alert('서버에 연결할 수 없습니다. 배포된 사이트에서만 저장할 수 있습니다.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });
}

function route() {
  const hash = location.hash || '#/';
  const match = hash.match(/^#\/episode\/(.+)$/);
  if (match) {
    listView.hidden = true;
    detailView.hidden = false;
    renderDetail(match[1]);
    window.scrollTo(0, 0);
  } else {
    listView.hidden = false;
    detailView.hidden = true;
    renderList();
  }
}

function goToCard(card) {
  if (!card) return;
  location.hash = `#/episode/${card.dataset.episode}`;
}
grid.addEventListener('click', (e) => {
  if (e.target.closest('a')) return; // 카드 내부 네이버맵 링크는 그대로 동작
  goToCard(e.target.closest('.card'));
});
grid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('a')) return;
  e.preventDefault();
  goToCard(e.target.closest('.card'));
});

function setEditing(value) {
  editing = value;
  editToggle.classList.toggle('active', editing);
  grid.classList.toggle('editing', editing);
}

window.addEventListener('hashchange', route);
searchInput.addEventListener('input', () => { if (!listView.hidden) renderList(); });
sortSelect.addEventListener('change', () => { if (!listView.hidden) renderList(); });
editToggle.addEventListener('click', async () => {
  if (editing) {
    clearAdminSession();
    setEditing(false);
    return;
  }
  const input = prompt('관리자 비밀번호를 입력하세요');
  if (input === null) return;

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '로그인에 실패했습니다.');
      return;
    }
    localStorage.setItem('foodtrip_admin_token', data.token);
    localStorage.setItem('foodtrip_admin_expires', String(data.expiresAt));
    setEditing(true);
  } catch (err) {
    alert('서버에 연결할 수 없습니다. 배포된 사이트에서만 로그인할 수 있습니다.');
  }
});

setEditing(editing);

loadEpisodes()
  .then(route)
  .catch((err) => {
    grid.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
  });
