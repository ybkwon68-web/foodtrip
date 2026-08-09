// 회차별 요약표(식당명/메뉴/한줄평/주소) 렌더링과 검색을 담당하는 스크립트
const TABLE_DATA_URL = './data/table.json';
const API_URL = '/api/episodes';

// public/data/table.json은 crawler/build_table.py가 seed/episodes.json으로부터
// 오프라인으로 미리 만들어두는 스냅샷이라, 편집 화면에서 저장한 최신 식당명/주소가
// 반영되지 않는다. 소개된메뉴·한줄평은 DB에 없는 정보라 이 스냅샷에서만 가져오고,
// 식당명/주소/지역은 라이브 API 데이터를 우선 사용해 최신 상태를 보여준다.
const { splitAddress, splitRegion } = window.AddressSplit;

function buildRowsFromEpisodes(episodes, reviewLookup) {
  const rows = [];
  episodes.forEach((ep) => {
    const restaurants = ep.restaurants || [];
    if (restaurants.length) {
      restaurants.forEach((r) => {
        const { sido, sigungu, detail } = splitAddress(r.address || '');
        const rv = reviewLookup.get(`${ep.episode}::${r.name || ''}`) || {};
        rows.push({
          episode: ep.episode,
          restaurant_name: r.name || '',
          menu: r.menu || rv.menu || '',
          review: r.review || rv.review || '',
          sido,
          sigungu,
          detail_addr: detail,
          address: r.address || '',
          place_id: r.place_id || null,
          status_check: r.status_check || null,
        });
      });
    } else {
      const { sido, sigungu } = splitRegion(ep.region || '');
      rows.push({
        episode: ep.episode,
        restaurant_name: '',
        menu: '',
        review: '',
        sido,
        sigungu,
        detail_addr: '',
        address: '',
        place_id: null,
      });
    }
  });
  rows.sort((a, b) => b.episode - a.episode);
  return rows;
}

const tableBody = document.getElementById('tableBody');
const tableCount = document.getElementById('tableCount');
const tableSearch = document.getElementById('tableSearch');

let rows = [];
// null이면 필터 비활성(전체 표시), Set이면 그 값들만 표시. 빈 값은 '' 로 표현.
const filterState = { sido: null, sigungu: null };

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// data-label은 화면 폭이 좁을 때(표 대신 카드 목록으로 바뀌는 모바일 레이아웃)
// 각 칸 앞에 붙는 항목명으로 쓰인다 — CSS의 td::before { content: attr(data-label) }.
// 내용은 .cell-clamp로 감싸 모바일에서 칸이 2줄을 넘기지 않도록 자른다(데스크톱에서는
// 그냥 투명한 span이라 영향 없음).
function cell(value, extraClass, label) {
  const cls = extraClass ? ` class="${extraClass}"` : '';
  const labelAttr = label ? ` data-label="${label}"` : '';
  return value
    ? `<td${cls}${labelAttr}><span class="cell-clamp">${escapeHtml(value)}</span></td>`
    : `<td${cls ? cls.slice(0, -1) + ' empty-cell"' : ' class="empty-cell"'}${labelAttr}>-</td>`;
}

// 폐업/이전 점검 스크립트(crawler/check_status.py)가 남긴 status_check가 의심 상태면 배지를 붙인다.
// 배지를 누르면 사유(폐업/이전 등)·근거·신뢰도·확인 시각을 보여주는 말풍선이 뜬다.
// 표로 보기는 편집모드가 없는 읽기 전용 화면이라 확정/원복 버튼은 없음 — 관리자가 회차 상세보기에서
// 내린 결정(admin_decision)만 그대로 반영해서 보여준다.
function statusCheckBadge(sc) {
  if (!sc || (!sc.closure_suspected && !sc.moved_suspected)) return '';
  if (sc.admin_decision === 'dismissed') return '';
  const confirmed = sc.admin_decision === 'confirmed';
  const reasons = [];
  if (sc.closure_suspected) reasons.push(confirmed ? '폐업' : '폐업/휴업 의심');
  if (sc.moved_suspected) reasons.push(confirmed ? '이전' : '이전 의심');
  const badgeLabel = confirmed ? `🔴 ${reasons.join('·')}` : '⚠️ 확인 필요';
  const badgeClass = confirmed ? 'badge-status-check badge-status-confirmed' : 'badge-status-check';

  if (confirmed) {
    // 확정 후에는 자동탐지 당시의 의심 근거(note/추정 주소/신뢰도)가 더 이상 의미 없으므로
    // 참고용 "이전 전 주소"만(있으면) 보여준다 — public/script.js의 동일 분기 참고.
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
});

// 네이버 플레이스 ID가 있으면 정확한 장소 페이지로, 없으면 이름+주소 검색으로 연결
function mapUrl(r) {
  if (r.place_id) {
    return `https://map.naver.com/p/entry/place/${r.place_id}`;
  }
  const q = [r.restaurant_name, r.address].filter(Boolean).join(' ');
  return `https://map.naver.com/p/search/${encodeURIComponent(q)}`;
}

// 폭이 좁은 화면(표 4칸 축소)에서 회차·식당명 칸을 합쳐 보여주기 위한 조각 —
// 데스크톱에서는 CSS로 숨겨지고, 모바일에서만 식당명 앞에 붙어 보인다.
const mapPinIcon = '<svg class="map-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z"></path><circle cx="12" cy="9.5" r="2.3"></circle></svg>';

function rowTemplate(r) {
  const mobileEp = `<span class="mobile-ep">제${r.episode}회 · </span>`;
  const mapCell = r.address
    ? `<td class="col-map" data-label="지도"><a class="spot-link map-link" href="${mapUrl(r)}" target="_blank" rel="noopener">${mapPinIcon}<span class="map-link-text">네이버맵 ↗</span></a></td>`
    : `<td class="col-map empty-cell" data-label="지도">-</td>`;
  // 식당명 칸(모바일에서는 회차까지 합쳐서 보임) 전체를 그 회차 상세보기로 가는 링크로
  // 감싼다 — 상태 배지(확인 필요/폐업/이전)는 링크 밖에 둬서 배지를 눌러도 페이지 이동 없이
  // 말풍선만 뜨게 한다(사용자 요청: 회차·식당 칸을 누르면 방송 상세로 이동).
  const detailHref = `./index.html#/episode/${r.episode}`;
  const nameCell = r.restaurant_name
    ? `<td class="col-name" data-label="식당명"><a class="mobile-row-link" href="${detailHref}"><span class="cell-clamp">${mobileEp}${escapeHtml(r.restaurant_name)}</span></a>${statusCheckBadge(r.status_check)}</td>`
    : `<td class="col-name empty-cell" data-label="식당명"><a class="mobile-row-link" href="${detailHref}"><span class="cell-clamp">${mobileEp}-</span></a></td>`;
  return `
    <tr>
      <td class="col-ep" data-label="회차"><a href="./index.html#/episode/${r.episode}">제${r.episode}회</a></td>
      ${nameCell}
      ${cell(r.menu, 'col-menu', '소개된 메뉴')}
      ${cell(r.review, 'col-review', '한줄평')}
      ${cell(r.sido, 'col-sido', '도/광역시')}
      ${cell(r.sigungu, 'col-sigungu', '시/군/구')}
      ${cell(r.detail_addr, 'col-addr', '상세주소')}
      ${cell(r.address, 'col-addr-mobile', '주소')}
      ${mapCell}
    </tr>
  `;
}

function matches(r, query) {
  if (filterState.sido && !filterState.sido.has(r.sido || '')) return false;
  if (filterState.sigungu && !filterState.sigungu.has(r.sigungu || '')) return false;
  if (!query) return true;
  const haystack = [r.episode, r.restaurant_name, r.menu, r.review, r.sido, r.sigungu, r.detail_addr]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function render() {
  const query = tableSearch.value.trim();
  const filtered = rows.filter((r) => matches(r, query));
  tableCount.textContent = `총 ${filtered.length}개 행 (회차 ${filtered.length ? new Set(filtered.map(r => r.episode)).size : 0}개)`;
  tableBody.innerHTML = filtered.map(rowTemplate).join('');
}

// 엑셀 자동필터 스타일 컬럼 헤더 드롭다운 (검색 + 모두 선택 + 확인/취소)
const colFilterMenu = document.getElementById('colFilterMenu');
const colFilterSearch = document.getElementById('colFilterSearch');
const colFilterAll = document.getElementById('colFilterAll');
const colFilterList = document.getElementById('colFilterList');
const colFilterOk = document.getElementById('colFilterOk');
const colFilterCancel = document.getElementById('colFilterCancel');

let activeField = null;
let activeValues = [];
let pendingChecked = null; // 확인을 누르기 전까지는 filterState에 반영하지 않는다.

// 도/특별시/광역시와 시/군/구는 상호 종속 관계 — 한쪽이 선택되어 있으면
// 다른 쪽 드롭다운에는 그 선택에 해당하는 값만 나오게 한다.
function fieldValues(field) {
  const otherField = field === 'sido' ? 'sigungu' : 'sido';
  const otherFilter = filterState[otherField];
  const base = otherFilter ? rows.filter((r) => otherFilter.has(r[otherField] || '')) : rows;
  const set = new Set(base.map((r) => r[field] || ''));
  return [...set].sort((a, b) => {
    if (a === '' || b === '') return a === b ? 0 : a === '' ? -1 : 1;
    return a.localeCompare(b, 'ko');
  });
}

function renderColFilterList(query) {
  const q = query.trim().toLowerCase();
  const visible = activeValues.filter((v) => !q || (v === '' ? '(비어 있음)' : v).toLowerCase().includes(q));
  colFilterList.innerHTML = visible
    .map((v) => {
      const label = v === '' ? '(비어 있음)' : escapeHtml(v);
      const checked = pendingChecked.has(v) ? 'checked' : '';
      return `<label><input type="checkbox" value="${escapeHtml(v)}" ${checked}> ${label}</label>`;
    })
    .join('');
  colFilterAll.checked = pendingChecked.size === activeValues.length;
}

function positionColFilterMenu(btn) {
  const rect = btn.getBoundingClientRect();
  const menuWidth = 220;
  let left = rect.left;
  if (left + menuWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuWidth - 8);
  colFilterMenu.style.top = `${rect.bottom + 4}px`;
  colFilterMenu.style.left = `${left}px`;
}

function closeColFilterMenu() {
  colFilterMenu.hidden = true;
  activeField = null;
  pendingChecked = null;
}

function openColFilterMenu(field, btn) {
  activeField = field;
  activeValues = fieldValues(field);
  const current = filterState[field];
  // 다른 필터 변경으로 더 이상 존재하지 않게 된 선택값은 화면 표시에서만 제외한다.
  pendingChecked = new Set(current ? [...current].filter((v) => activeValues.includes(v)) : activeValues);
  colFilterSearch.value = '';
  renderColFilterList('');
  positionColFilterMenu(btn);
  colFilterMenu.hidden = false;
  colFilterSearch.focus();
}

document.querySelectorAll('.col-filter-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const field = btn.dataset.field;
    if (activeField === field && !colFilterMenu.hidden) {
      closeColFilterMenu();
      return;
    }
    openColFilterMenu(field, btn);
  });
});

colFilterSearch.addEventListener('input', () => renderColFilterList(colFilterSearch.value));

colFilterList.addEventListener('change', (e) => {
  if (e.target.tagName !== 'INPUT') return;
  if (e.target.checked) pendingChecked.add(e.target.value);
  else pendingChecked.delete(e.target.value);
  colFilterAll.checked = pendingChecked.size === activeValues.length;
});

colFilterAll.addEventListener('change', () => {
  pendingChecked = colFilterAll.checked ? new Set(activeValues) : new Set();
  renderColFilterList(colFilterSearch.value);
});

colFilterOk.addEventListener('click', () => {
  const field = activeField;
  const allSelected = pendingChecked.size === activeValues.length;
  filterState[field] = allSelected ? null : new Set(pendingChecked);
  document.querySelector(`.col-filter-btn[data-field="${field}"]`).classList.toggle('active', !allSelected);
  closeColFilterMenu();
  render();
});

colFilterCancel.addEventListener('click', closeColFilterMenu);

document.addEventListener('click', (e) => {
  if (colFilterMenu.hidden) return;
  if (colFilterMenu.contains(e.target) || e.target.classList.contains('col-filter-btn')) return;
  closeColFilterMenu();
});
document.addEventListener('scroll', (e) => {
  if (colFilterMenu.hidden) return;
  if (colFilterMenu.contains(e.target)) return; // 필터 목록 내부 스크롤은 닫지 않는다
  closeColFilterMenu();
}, true);

async function load() {
  const snapshotRes = await fetch(TABLE_DATA_URL);
  if (!snapshotRes.ok) throw new Error(`데이터를 불러오지 못했습니다 (${snapshotRes.status})`);
  const snapshotRows = await snapshotRes.json();

  let episodes = null;
  try {
    const res = await fetch(API_URL);
    if (res.ok) episodes = await res.json();
  } catch (err) {
    // /api 서버리스 함수가 없는 환경(로컬 정적 서버 등) — 정적 스냅샷으로 폴백
  }

  if (episodes) {
    const reviewLookup = new Map(
      snapshotRows.map((r) => [`${r.episode}::${r.restaurant_name}`, { menu: r.menu, review: r.review }])
    );
    rows = buildRowsFromEpisodes(episodes, reviewLookup);
  } else {
    rows = snapshotRows;
  }
  render();
}

tableSearch.addEventListener('input', render);

load().catch((err) => {
  tableBody.innerHTML = `<tr><td colspan="9">${escapeHtml(err.message)}</td></tr>`;
});
