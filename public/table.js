// 회차별 요약표(식당명/메뉴/한줄평/주소) 렌더링과 검색을 담당하는 스크립트
const TABLE_DATA_URL = './data/table.json';

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

function cell(value, extraClass) {
  const cls = extraClass ? ` class="${extraClass}"` : '';
  return value ? `<td${cls}>${escapeHtml(value)}</td>` : `<td${cls ? cls.slice(0, -1) + ' empty-cell"' : ' class="empty-cell"'}>-</td>`;
}

// 네이버 플레이스 ID가 있으면 정확한 장소 페이지로, 없으면 이름+주소 검색으로 연결
function mapUrl(r) {
  if (r.place_id) {
    return `https://map.naver.com/p/entry/place/${r.place_id}`;
  }
  const q = [r.restaurant_name, r.address].filter(Boolean).join(' ');
  return `https://map.naver.com/p/search/${encodeURIComponent(q)}`;
}

function rowTemplate(r) {
  const mapCell = r.address
    ? `<td><a class="spot-link" href="${mapUrl(r)}" target="_blank" rel="noopener">네이버맵에서 보기 ↗</a></td>`
    : `<td class="empty-cell">-</td>`;
  return `
    <tr>
      <td class="col-ep"><a href="./index.html#/episode/${r.episode}">제${r.episode}회</a></td>
      ${cell(r.restaurant_name, 'col-name')}
      ${cell(r.menu, 'col-menu')}
      ${cell(r.review, 'col-review')}
      ${cell(r.sido)}
      ${cell(r.sigungu)}
      ${cell(r.detail_addr, 'col-addr')}
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
  const res = await fetch(TABLE_DATA_URL);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
  rows = await res.json();
  render();
}

tableSearch.addEventListener('input', render);

load().catch((err) => {
  tableBody.innerHTML = `<tr><td colspan="8">${escapeHtml(err.message)}</td></tr>`;
});
