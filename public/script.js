// 백반기행 아카이브 목록/상세 화면 렌더링과 검색·정렬·해시 라우팅을 담당하는 스크립트
const DATA_URL = './data/episodes.json';

const episodesLogic = (typeof window !== 'undefined' && window.EpisodesLogic)
  ? window.EpisodesLogic
  : (typeof require === 'function' ? require('./lib/episodesLogic') : null);
const editModeFlow = (typeof window !== 'undefined' && window.EditModeFlow)
  ? window.EditModeFlow
  : (typeof require === 'function' ? require('./lib/editModeFlow') : null);
const matchesSearch = episodesLogic?.matchesSearch || function (ep, query) {
  if (!query) return true;
  const restaurantNames = (ep.restaurants || []).map((r) => r.name).join(' ');
  const haystack = [ep.title, ep.raw_title, ep.region, restaurantNames]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
};
const sortEpisodes = episodesLogic?.sortEpisodes || function (list, mode) {
  const withEp = list.filter((e) => e.episode != null);
  const withoutEp = list.filter((e) => e.episode == null);
  withEp.sort((a, b) => (mode === 'episode' ? a.episode - b.episode : b.episode - a.episode));
  return [...withEp, ...withoutEp];
};
const authenticateAdmin = editModeFlow?.authenticateAdmin || async function () {
  return { ok: false, error: '편집 모드 인증 모듈을 불러오지 못했습니다.' };
};
const saveRestaurantEdit = editModeFlow?.saveRestaurantEdit || async function () {
  return { ok: false, error: '편집 저장 모듈을 불러오지 못했습니다.' };
};
const submitStatusCheckDecision = editModeFlow?.submitStatusCheckDecision || async function () {
  return { ok: false, error: '점검 처리 모듈을 불러오지 못했습니다.' };
};

const grid = document.getElementById('grid');
const resultCount = document.getElementById('resultCount');
const listView = document.getElementById('listView');
const detailView = document.getElementById('detailView');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const editToggle = document.getElementById('editToggle');
const addEntryLink = document.getElementById('addEntryLink');
const adminCheckPanel = document.getElementById('adminCheckPanel');

const pencilIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';

let statusTimer = null;

function showStatus(message, type = 'info', duration = 2400) {
  let banner = document.getElementById('statusBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'statusBanner';
    banner.className = 'status-banner';
    document.body.appendChild(banner);
  }
  banner.textContent = message;
  banner.className = `status-banner show ${type}`;
  if (statusTimer) clearTimeout(statusTimer);
  if (duration > 0) {
    statusTimer = setTimeout(() => {
      banner.classList.remove('show');
    }, duration);
  }
}

function setEditing(value) {
  editing = value;
  editToggle.classList.toggle('active', editing);
  editToggle.innerHTML = editing
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>편집 모드 끄기'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>편집 모드';
  grid.classList.toggle('editing', editing);
  if (addEntryLink) addEntryLink.hidden = !editing;
  if (adminCheckPanel) adminCheckPanel.hidden = !editing;
  if (editing) {
    showStatus('편집 모드가 켜졌습니다. 회차를 선택해 식당 정보를 수정해보세요.', 'success', 2200);
  }
}
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

  const summaryHint = query
    ? `“${query}”로 찾은 회차 ${sorted.length}개`
    : `총 ${sorted.length}개 회차`; 
  const countText = query
    ? `${summaryHint} · 제목, 지역, 식당명으로 검색됩니다`
    : `${summaryHint} · 원하는 회차를 탭해 상세를 확인하세요`;
  resultCount.textContent = countText;

  const prevEmpty = document.getElementById('emptyState');
  if (prevEmpty) prevEmpty.remove();

  if (sorted.length === 0) {
    grid.innerHTML = '';
    grid.insertAdjacentHTML('afterend', `
      <div class="empty-state" id="emptyState">
        <p>검색 결과가 없습니다.</p>
        <span>다른 키워드로 다시 검색해 보세요.</span>
      </div>
    `);
    return;
  }

  grid.innerHTML = sorted.map(cardTemplate).join('');
  grid.classList.toggle('editing', editing);
}

function findEpisode(epNum) {
  return episodes.find((e) => String(e.episode) === String(epNum));
}

// 폐업/이전 점검 스크립트(crawler/check_status.py)가 남긴 status_check가 의심 상태면 배지를 붙인다.
// 배지를 누르면 사유(폐업/이전 등)·근거·신뢰도·확인 시각을 보여주는 말풍선이 뜬다.
// admin_decision이 "dismissed"면 배지 자체를 표시하지 않고(정상으로 원복됨), "confirmed"면
// 색을 바꿔 확정됐음을 표시한다. 편집모드일 때만 "확정"/"정상으로 되돌리기" 버튼을 보여주고,
// 실제 서버 반영은 이 버튼을 통해서만 이뤄진다(그 외에는 표시만 함).
function statusCheckBadge(sc, episodeNum, restaurantName) {
  if (!sc || (!sc.closure_suspected && !sc.moved_suspected)) return '';
  if (sc.admin_decision === 'dismissed') return '';
  const confirmed = sc.admin_decision === 'confirmed';
  const reasons = [];
  if (sc.closure_suspected) reasons.push(confirmed ? '폐업' : '폐업/휴업 의심');
  if (sc.moved_suspected) reasons.push(confirmed ? '이전' : '이전 의심');
  const badgeLabel = confirmed ? `🔴 ${reasons.join('·')}` : '⚠️ 확인 필요';
  const badgeClass = confirmed ? 'badge-status-check badge-status-confirmed' : 'badge-status-check';
  const nameAttr = escapeHtml(restaurantName || '');

  if (confirmed) {
    // 이미 확정·반영이 끝난 뒤라 자동탐지 당시의 의심 근거(note/추정 주소/신뢰도)는 더 이상 의미가
    // 없고, "정상으로 되돌리기"도 이미 바뀐 실제 주소를 되돌리진 못해 오히려 오해만 준다(사용자 피드백:
    // 이전 확정 후에도 예전 의심 메시지·되돌리기 버튼이 그대로 남아있는 게 혼란스러움) — 확정 후에는
    // 참고용으로 "이전 전 주소"만(있으면) 보여주고 그 외 근거·조작 버튼은 전부 뺀다.
    const prevAddrRow = sc.moved_suspected && sc.previous_address
      ? `<span class="status-check-popup-addr">이전 전 주소: ${escapeHtml(sc.previous_address)}</span>`
      : '';
    return `
      <span class="status-check-wrap">
        <button type="button" class="${badgeClass}">${badgeLabel}</button>
        <span class="status-check-popup" hidden>
          <span class="status-check-popup-title">${escapeHtml(reasons.join(' · '))}</span>
          ${prevAddrRow}
        </span>
      </span>
    `;
  }

  const confidenceLabel = sc.confidence === 'high' ? '높음' : '낮음';
  const checkedAt = sc.checked_at ? new Date(sc.checked_at).toLocaleString('ko-KR') : '';
  const addrRow = sc.moved_suspected && sc.candidate_address
    ? `<span class="status-check-popup-addr">추정 새 주소: ${escapeHtml(sc.candidate_address)}</span>`
    : '';
  const confirmBtn = `<button type="button" class="status-check-action" data-episode="${episodeNum}" data-name="${nameAttr}" data-decision="confirmed">확정</button>`;
  // 자동 탐지가 "폐업"으로 의심했지만 실제로는 "이전"으로 확인되는 경우가 있어(예: 위치는 그대로인데
  // 다른 업체가 들어온 게 아니라 상호만 바뀐 걸 폐업으로 오탐), 확정/원복 외에 이 자리에서 바로
  // 새 주소를 입력해 "이전"으로 전환·확정할 수 있게 한다.
  const moveAddrValue = sc.candidate_address ? escapeHtml(sc.candidate_address) : '';
  const moveRow = `<button type="button" class="status-check-move-toggle" data-episode="${episodeNum}" data-name="${nameAttr}">이전(새 주소)</button>
      <span class="status-check-move-form" hidden>
        <input type="text" class="sc-move-address" placeholder="새 주소" value="${moveAddrValue}">
        <button type="button" class="sc-move-submit" data-episode="${episodeNum}" data-name="${nameAttr}">이전 확정</button>
        <button type="button" class="sc-move-cancel">취소</button>
      </span>`;
  const actionsRow = editing
    ? `<span class="status-check-popup-actions">
        ${confirmBtn}
        <button type="button" class="status-check-action" data-episode="${episodeNum}" data-name="${nameAttr}" data-decision="dismissed">정상으로 되돌리기</button>
        ${moveRow}
      </span>`
    : '';
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
        ${actionsRow}
      </span>
    </span>
  `;
}

// 자동 점검이 아직 배지를 안 남긴 식당(정상으로 확인됐거나, 아예 점검 전이거나, 원복된 경우)에
// 관리자가 직접 폐업/이전을 알게 됐을 때 스스로 등록할 수 있는 작은 링크. 누르면 바로 "확정"
// 상태로 등록된다(본인이 직접 확인한 것이므로 "의심" 단계를 거칠 필요가 없다는 사용자 요청).
function manualFlagLink(episodeNum, restaurantName) {
  if (!editing) return '';
  const nameAttr = escapeHtml(restaurantName || '');
  return `
    <span class="status-check-manual-wrap">
      <button type="button" class="status-check-manual-link" data-episode="${episodeNum}" data-name="${nameAttr}">폐업/이전 등록</button>
      <span class="status-check-manual-form" hidden>
        <label><input type="checkbox" class="sc-manual-closure"> 폐업/휴업</label>
        <label><input type="checkbox" class="sc-manual-moved"> 이전</label>
        <input type="text" class="sc-manual-address" placeholder="새 주소(선택)" hidden>
        <button type="button" class="sc-manual-submit" data-episode="${episodeNum}" data-name="${nameAttr}">등록</button>
        <button type="button" class="sc-manual-cancel">취소</button>
      </span>
    </span>
  `;
}

// 배지/말풍선 클릭 시 해당 말풍선만 토글하고, 그 외 클릭은 열려있는 말풍선을 전부 닫는다.
// "확정"/"정상으로 되돌리기"/"등록" 버튼 클릭은 서버에 반영한 뒤 상세보기를 다시 그린다.
document.addEventListener('click', (e) => {
  const actionBtn = e.target.closest('.status-check-action');
  if (actionBtn) {
    e.stopPropagation();
    handleStatusCheckDecision(actionBtn);
    return;
  }
  const manualSubmitBtn = e.target.closest('.sc-manual-submit');
  if (manualSubmitBtn) {
    e.stopPropagation();
    handleManualFlagSubmit(manualSubmitBtn);
    return;
  }
  if (e.target.closest('.sc-manual-cancel')) {
    e.stopPropagation();
    e.target.closest('.status-check-manual-form').hidden = true;
    return;
  }
  const moveToggleBtn = e.target.closest('.status-check-move-toggle');
  if (moveToggleBtn) {
    e.stopPropagation();
    const form = moveToggleBtn.nextElementSibling;
    form.hidden = !form.hidden;
    return;
  }
  const moveSubmitBtn = e.target.closest('.sc-move-submit');
  if (moveSubmitBtn) {
    e.stopPropagation();
    handleMoveSubmit(moveSubmitBtn);
    return;
  }
  if (e.target.closest('.sc-move-cancel')) {
    e.stopPropagation();
    e.target.closest('.status-check-move-form').hidden = true;
    return;
  }
  // 이전 등록 폼 안(주소 입력칸 등)을 클릭한 거면 팝업을 닫지 않는다 — 아래 "그 외 클릭은
  // 전부 닫기" 로직에 걸려 입력 중 팝업이 닫혀버리는 걸 막기 위함.
  if (e.target.closest('.status-check-move-form')) return;
  const manualLink = e.target.closest('.status-check-manual-link');
  if (manualLink) {
    e.stopPropagation();
    const form = manualLink.nextElementSibling;
    const wasHidden = form.hidden;
    document.querySelectorAll('.status-check-popup:not([hidden]), .status-check-manual-form:not([hidden])').forEach((p) => { p.hidden = true; });
    form.hidden = !wasHidden;
    return;
  }
  // 열려있는 등록 폼 안(체크박스·주소 입력칸 등)을 클릭한 거면 폼을 닫지 않는다 — 이 분기가
  // 없으면 체크박스를 누르는 순간 아래 "그 외 클릭은 전부 닫기" 로직에 걸려 폼이 바로 닫혀버림.
  if (e.target.closest('.status-check-manual-form')) return;
  const btn = e.target.closest('.badge-status-check');
  const openPopups = document.querySelectorAll('.status-check-popup:not([hidden]), .status-check-manual-form:not([hidden])');
  if (!btn) {
    openPopups.forEach((p) => { p.hidden = true; });
    return;
  }
  e.stopPropagation();
  const popup = btn.nextElementSibling;
  const wasHidden = popup.hidden;
  openPopups.forEach((p) => { p.hidden = true; });
  popup.hidden = !wasHidden;
});

// "이전" 체크박스를 켜면 새 주소 입력칸을 보여준다.
document.addEventListener('change', (e) => {
  if (!e.target.classList.contains('sc-manual-moved')) return;
  const form = e.target.closest('.status-check-manual-form');
  const addrInput = form.querySelector('.sc-manual-address');
  addrInput.hidden = !e.target.checked;
});

async function handleManualFlagSubmit(btn) {
  const form = btn.closest('.status-check-manual-form');
  const closureSuspected = form.querySelector('.sc-manual-closure').checked;
  const movedSuspected = form.querySelector('.sc-manual-moved').checked;
  const candidateAddress = form.querySelector('.sc-manual-address').value.trim();
  if (!closureSuspected && !movedSuspected) {
    alert('폐업/휴업 또는 이전 중 최소 하나는 선택해주세요.');
    return;
  }

  const episodeNum = Number(btn.dataset.episode);
  const name = btn.dataset.name;
  const token = getAdminToken();
  if (!token) return;

  btn.disabled = true;
  const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const result = await submitStatusCheckDecision({
    episodeId: episodeNum,
    name,
    decision: 'confirmed',
    token,
    extra: { closureSuspected, movedSuspected, candidateAddress },
    localDevOverride: isLocalDev,
    decisionRequest: async ({ episodeId, name: rName, decision: rDecision, token: authToken, extra }) => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ name: rName, decision: rDecision, ...extra }),
        });
        const data = await res.json();
        return { ok: res.ok, status: res.status, data, error: data && data.error };
      } catch (err) {
        return { ok: false, status: 0, error: '서버에 연결할 수 없습니다.' };
      }
    },
  });

  if (!result.ok) {
    btn.disabled = false;
    if (result.expired) {
      clearAdminSession();
      editing = false;
    }
    alert(result.error || '처리에 실패했습니다.');
    return;
  }

  const ep = findEpisode(episodeNum);
  const target = ep && (ep.restaurants || []).find((r) => r.name === name);
  // "확정" 시 서버가 address/lat/lng/place_id/tel도 같이 갱신했을 수 있어(이전 등록 확정 시
  // 실제 위치 반영), status_check만 반영하면 화면이 예전 주소로 다시 그려지는 문제가 있었음 —
  // 서버가 함께 보내주는 최신 식당 객체 전체를 그대로 덮어쓴다.
  if (target && result.data?.restaurant) Object.assign(target, result.data.restaurant);
  else if (target) target.status_check = result.data?.status_check;
  renderDetail(episodeNum);
}

// 자동 탐지된 "확인 필요" 배지를 확정/원복 대신 "이전"으로 전환·확정할 때 쓴다.
// closureSuspected는 false로 보내 폐업 오탐 사유를 지우고, moved_suspected+candidate_address로
// 덮어써 서버가 실제 address/좌표까지 새 주소로 갱신하게 한다(api/episodes/[id]/status.js 참고).
async function handleMoveSubmit(btn) {
  const form = btn.closest('.status-check-move-form');
  const candidateAddress = form.querySelector('.sc-move-address').value.trim();
  if (!candidateAddress) {
    alert('새 주소를 입력해주세요.');
    return;
  }

  const episodeNum = Number(btn.dataset.episode);
  const name = btn.dataset.name;
  const token = getAdminToken();
  if (!token) return;

  btn.disabled = true;
  const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const result = await submitStatusCheckDecision({
    episodeId: episodeNum,
    name,
    decision: 'confirmed',
    token,
    extra: { closureSuspected: false, movedSuspected: true, candidateAddress },
    localDevOverride: isLocalDev,
    decisionRequest: async ({ episodeId, name: rName, decision: rDecision, token: authToken, extra }) => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ name: rName, decision: rDecision, ...extra }),
        });
        const data = await res.json();
        return { ok: res.ok, status: res.status, data, error: data && data.error };
      } catch (err) {
        return { ok: false, status: 0, error: '서버에 연결할 수 없습니다.' };
      }
    },
  });

  if (!result.ok) {
    btn.disabled = false;
    if (result.expired) {
      clearAdminSession();
      editing = false;
    }
    alert(result.error || '처리에 실패했습니다.');
    return;
  }

  const ep = findEpisode(episodeNum);
  const target = ep && (ep.restaurants || []).find((r) => r.name === name);
  if (target && result.data?.restaurant) Object.assign(target, result.data.restaurant);
  else if (target) target.status_check = result.data?.status_check;
  renderDetail(episodeNum);
}

async function handleStatusCheckDecision(btn) {
  const episodeNum = Number(btn.dataset.episode);
  const name = btn.dataset.name;
  const decision = btn.dataset.decision;
  const token = getAdminToken();
  if (!token) return;

  btn.disabled = true;
  const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const result = await submitStatusCheckDecision({
    episodeId: episodeNum,
    name,
    decision,
    token,
    localDevOverride: isLocalDev,
    decisionRequest: async ({ episodeId, name: rName, decision: rDecision, token: authToken }) => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ name: rName, decision: rDecision }),
        });
        const data = await res.json();
        return { ok: res.ok, status: res.status, data, error: data && data.error };
      } catch (err) {
        return { ok: false, status: 0, error: '서버에 연결할 수 없습니다.' };
      }
    },
  });

  if (!result.ok) {
    btn.disabled = false;
    if (result.expired) {
      clearAdminSession();
      editing = false;
    }
    alert(result.error || '처리에 실패했습니다.');
    return;
  }

  const ep = findEpisode(episodeNum);
  const target = ep && (ep.restaurants || []).find((r) => r.name === name);
  if (target && result.data?.restaurant) {
    Object.assign(target, result.data.restaurant);
  } else if (target) {
    target.status_check = result.data?.status_check
      ? result.data.status_check
      : { ...target.status_check, admin_decision: decision };
  }
  renderDetail(episodeNum);
}

function restaurantViewRow(r, episodeNum, fallbackSourceUrl) {
  const addr = r.address;
  const menuRow = r.menu ? `<p class="spot-field"><strong>소개된 메뉴</strong>${escapeHtml(r.menu)}</p>` : '';
  const reviewRow = r.review ? `<p class="spot-field"><strong>한줄평</strong>${escapeHtml(r.review)}</p>` : '';
  // 식당마다 출처가 다를 수 있어 개별 source_url을 우선 쓰고, 없으면(옛날에 등록된 식당)
  // 회차 단위 기존 링크로 폴백한다 — 정확도는 떨어지지만 링크 자체가 사라지진 않는다.
  const sourceUrl = r.source_url || fallbackSourceUrl;
  const sourceRow = sourceUrl
    ? `<p class="spot-field"><a class="spot-link spot-source" href="${sourceUrl}" target="_blank" rel="noopener">참고한 블로그 글 보기 ↗</a></p>`
    : '';
  const sc = r.status_check;
  const hasVisibleBadge = Boolean(sc && (sc.closure_suspected || sc.moved_suspected) && sc.admin_decision !== 'dismissed');
  const statusMarkup = hasVisibleBadge
    ? statusCheckBadge(sc, episodeNum, r.name)
    : manualFlagLink(episodeNum, r.name);
  return `
    <div class="restaurant-row">
      <p class="spot-field"><strong>식당명</strong>${escapeHtml(r.name) || '미확인'}${statusMarkup}</p>
      <p class="spot-field spot-field-address">
        <strong>위치</strong>
        <span class="spot-field-value">${addr ? escapeHtml(addr) : '미확인'}</span>
        <a class="spot-link" href="${mapUrl(r)}" target="_blank" rel="noopener">네이버맵 ↗</a>
      </p>
      ${menuRow}
      ${reviewRow}
      ${sourceRow}
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
        // 편집 폼에 입력칸이 없는 폐업/이전 점검 기록은 주소 변경 여부와 무관하게 항상 보존한다
        // (안 그러면 이 회차의 아무 식당이나 한 번만 저장해도 전체 status_check가 사라짐).
        status_check: orig.status_check || null,
        // 식당별 출처(source_url)도 같은 이유로, 편집 폼에 입력칸이 없으니 항상 그대로 보존한다.
        source_url: orig.source_url || null,
      };
    })
    .filter((r) => r.name);
}

// 목록 응답(/api/episodes)에는 용량 절감을 위해 body_html이 빠져 있으므로,
// 상세보기를 열 때 해당 회차 1건만 /api/episodes/:id로 따로 채워 넣는다.
// 정적 스냅샷 폴백(로컬 정적 서버 등)은 처음부터 body_html을 포함하므로 재요청하지 않는다.
async function ensureBodyHtml(ep) {
  if (ep.body_html !== undefined) return;
  try {
    const res = await fetch(`/api/episodes/${ep.episode}`);
    if (res.ok) {
      const full = await res.json();
      Object.assign(ep, full);
    }
  } catch (err) {
    // API 없는 환경 — 아래에서 "본문을 불러오지 못했습니다"로 표시됨
  }
}

async function renderDetail(epNum) {
  const ep = findEpisode(epNum);
  if (!ep) {
    detailView.innerHTML = `<div class="detail-wrap"><p>존재하지 않는 회차입니다.</p><a class="back-link" href="#/">← 목록으로</a></div>`;
    return;
  }
  await ensureBodyHtml(ep);
  if (String(location.hash) !== `#/episode/${epNum}`) return; // 그 사이 다른 화면으로 이동했으면 중단

  const restaurants = ep.restaurants || [];
  const badge = ep.verified
    ? '<span class="badge-verified">확인됨</span>'
    : '<span class="badge-unverified">미검수 · 정보 확인 필요</span>';
  const bodyHtml = ep.body_html ? DOMPurify.sanitize(ep.body_html) : '<p>본문을 불러오지 못했습니다.</p>';

  const viewRows = restaurants.length
    ? `<div class="restaurant-rows-grid">${restaurants.map((r) => restaurantViewRow(r, ep.episode, ep.restaurants_source_url)).join('')}</div>`
    : `<p class="spot-field"><strong>식당명</strong>미확인</p><p class="spot-field"><strong>위치</strong>${
        truncateAddress(ep.region) ? escapeHtml(truncateAddress(ep.region)) : '미확인'
      }</p>`;
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
          <div class="spot-panel-actions">
            ${badge}
            ${editing ? '<span class="edit-state-pill">편집 가능</span>' : ''}
            ${editing ? '<button class="spot-edit-btn" id="spotEditBtn" type="button">식당 정보 직접 수정</button>' : ''}
          </div>
        </div>
        <div id="spotView">
          ${viewRows}
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
      showStatus('수정 중인 내용을 입력한 뒤 저장하세요.', 'info', 2400);
    });
  }
  spotCancelBtn.addEventListener('click', () => {
    spotView.hidden = false;
    spotEditForm.hidden = true;
    showStatus('편집이 취소되었습니다.', 'info', 2200);
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
      showStatus('로그인이 만료되었습니다. 편집 모드를 다시 켜주세요.', 'error', 3200);
      setEditing(false);
      return;
    }

    const restaurants = collectRestaurantRows(restaurantRows);
    const saveBtn = spotEditForm.querySelector('.btn-save');
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';
    showStatus('저장 중입니다. 잠시만 기다려 주세요.', 'loading', 0);

    try {
      const result = await saveRestaurantEdit({
        episodeId: ep.episode,
        token,
        restaurants,
        verified: true,
        localDevOverride: location.hostname === 'localhost' || location.hostname === '127.0.0.1',
        saveRequest: async ({ episodeId, token: authToken, restaurants: nextRestaurants, verified: nextVerified }) => {
          try {
            const res = await fetch(`/api/episodes/${episodeId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
              body: JSON.stringify({ restaurants: nextRestaurants, verified: nextVerified }),
            });
            const data = await res.json();
            return { ok: res.ok, status: res.status, data, error: data.error };
          } catch (err) {
            return { ok: false, status: 404, error: '로컬 저장 API에 연결할 수 없습니다.' };
          }
        },
      });

      if (!result.ok && result.expired) {
        clearAdminSession();
        setEditing(false);
        showStatus(result.error, 'error', 3200);
        renderDetail(ep.episode);
        return;
      }
      if (!result.ok) {
        showStatus(result.error, 'error', 3200);
        return;
      }
      Object.assign(ep, result.data);
      renderDetail(ep.episode);
      showStatus('식당 정보가 저장되었습니다.', 'success', 2400);
    } catch (err) {
      showStatus('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', 'error', 3200);
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

window.addEventListener('hashchange', route);
searchInput.addEventListener('input', () => { if (!listView.hidden) renderList(); });
sortSelect.addEventListener('change', () => { if (!listView.hidden) renderList(); });
editToggle.addEventListener('click', async () => {
  if (editing) {
    clearAdminSession();
    setEditing(false);
    showStatus('편집 모드가 종료되었습니다.', 'info', 2200);
    return;
  }

  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:';
  const panel = document.createElement('div');
  panel.className = 'login-panel';
  panel.innerHTML = `
    <h2>편집 모드 로그인</h2>
    <p>${isLocalDev ? '로컬 개발 환경입니다. 입력값에 관계없이 편집 모드로 진입할 수 있습니다.' : '관리자 비밀번호를 입력하면 식당 정보를 수정할 수 있습니다.'}</p>
    <input type="password" id="adminPasswordInput" placeholder="비밀번호 입력" ${isLocalDev ? '' : 'required'} />
    <button type="button" id="adminLoginBtn">로그인</button>
    <p class="login-hint">비밀번호는 저장되지 않고 세션만 유지됩니다.</p>
  `;

  const existing = document.querySelector('.login-panel');
  if (existing) existing.remove();
  editToggle.insertAdjacentElement('afterend', panel);

  const passwordInput = panel.querySelector('#adminPasswordInput');
  const loginBtn = panel.querySelector('#adminLoginBtn');
  passwordInput.focus();

  const submitLogin = async () => {
    const input = passwordInput.value;
    if (!input && !isLocalDev) {
      showStatus('비밀번호를 입력해 주세요.', 'error', 2400);
      return;
    }
    loginBtn.disabled = true;
    loginBtn.textContent = '로그인 중...';
    panel.classList.add('loading');
    showStatus('로그인 중입니다. 잠시만 기다려 주세요.', 'loading', 0);

    try {
      const result = await authenticateAdmin({
        password: input,
        authRequest: async ({ password }) => {
          try {
            const res = await fetch('/api/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password }),
            });
            const data = await res.json();
            return { ok: res.ok, token: data.token, expiresAt: data.expiresAt, error: data.error };
          } catch (err) {
            return { ok: false, error: '로컬 서버에서 인증 API에 연결할 수 없습니다.' };
          }
        },
        storage: localStorage,
        localDevOverride: isLocalDev,
      });

      if (!result.ok) {
        showStatus(result.error, 'error', 3200);
        return;
      }
      panel.remove();
      setEditing(true);
      showStatus('로그인되었습니다. 편집할 회차를 확인해 주세요.', 'success', 2400);
    } catch (err) {
      showStatus('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', 'error', 3200);
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = '로그인';
      panel.classList.remove('loading');
    }
  };

  loginBtn.addEventListener('click', submitLogin);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitLogin();
  });
});

// 폐업·이전 자동 점검 패널 — crawler/check_status.py를 터미널 없이 웹에서 돌리는 UI.
// 회차 범위를 순회하며 /api/admin/checkStatus를 하나씩(=회차 1개씩) 호출한다 — 서버리스 함수
// 실행시간 제한 때문에 전체 범위를 한 요청으로 처리할 수 없어, 브라우저가 순차 호출을 주도하고
// 진행 상황/결과를 그때그때 화면에 반영하는 방식으로 만들었다.
const checkFromEpisodeInput = document.getElementById('checkFromEpisode');
const checkToEpisodeInput = document.getElementById('checkToEpisode');
const checkApplyModeInput = document.getElementById('checkApplyMode');
const checkStartBtn = document.getElementById('checkStartBtn');
const checkStopBtn = document.getElementById('checkStopBtn');
const checkProgress = document.getElementById('checkProgress');
const checkResults = document.getElementById('checkResults');

let checkStopRequested = false;

function appendCheckResultRow(episodeNum, item) {
  const reasons = [];
  if (item.closure_suspected) reasons.push('폐업/휴업 의심');
  if (item.moved_suspected) reasons.push('이전 의심');
  const row = document.createElement('p');
  row.className = 'admin-check-result-row';
  const label = reasons.length ? reasons.join('·') : '오류';
  row.innerHTML = `<a href="#/episode/${episodeNum}">${episodeNum}회</a> ${escapeHtml(item.name)} — ${escapeHtml(label)} (${escapeHtml(item.note || '')})`;
  checkResults.appendChild(row);
}

async function runAdminCheck() {
  const from = Number(checkFromEpisodeInput.value);
  const to = Number(checkToEpisodeInput.value);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    alert('시작/끝 회차를 올바르게 입력해주세요.');
    return;
  }
  const apply = checkApplyModeInput.checked;
  const token = getAdminToken();
  if (!token) {
    alert('편집 모드로 로그인해주세요.');
    return;
  }

  checkStopRequested = false;
  checkStartBtn.disabled = true;
  checkStopBtn.hidden = false;
  checkResults.innerHTML = '';
  let totalChecked = 0;
  let totalSkipped = 0;
  let totalFlagged = 0;
  let stoppedAt = null;

  for (let ep = from; ep <= to; ep++) {
    if (checkStopRequested) {
      stoppedAt = ep;
      break;
    }
    checkProgress.textContent = `${ep}회 확인 중... (${ep - from + 1}/${to - from + 1}회차, 지금까지 확인 ${totalChecked}곳 · 의심 ${totalFlagged}곳)`;
    try {
      const res = await fetch('/api/admin/checkStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ episode: ep, apply }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          clearAdminSession();
          setEditing(false);
          alert('로그인이 만료되었습니다. 다시 로그인해주세요.');
          stoppedAt = ep;
          break;
        }
        appendCheckResultRow(ep, { name: '(오류)', note: data.error || '점검 실패' });
        continue;
      }
      if (data.notFound) continue;
      totalChecked += data.checked;
      totalSkipped += data.skipped;
      totalFlagged += data.flagged.length;
      data.flagged.forEach((item) => appendCheckResultRow(ep, item));
    } catch (err) {
      appendCheckResultRow(ep, { name: '(오류)', note: '서버에 연결할 수 없습니다.' });
    }
  }

  const modeLabel = apply ? '실제 반영됨' : 'dry-run(결과만 확인, 반영 안 됨)';
  checkProgress.textContent = stoppedAt
    ? `중지됨 (${from}~${stoppedAt - 1}회차까지 진행) · 확인 ${totalChecked}곳 · 건너뜀(이미 검토됨) ${totalSkipped}곳 · 의심 ${totalFlagged}곳 · ${modeLabel}`
    : `완료 (${from}~${to}회차) · 확인 ${totalChecked}곳 · 건너뜀(이미 검토됨) ${totalSkipped}곳 · 의심 ${totalFlagged}곳 · ${modeLabel}`;
  checkStartBtn.disabled = false;
  checkStopBtn.hidden = true;
}

checkStartBtn.addEventListener('click', runAdminCheck);
checkStopBtn.addEventListener('click', () => {
  checkStopRequested = true;
});

setEditing(editing);

loadEpisodes()
  .then(route)
  .catch((err) => {
    grid.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
  });
