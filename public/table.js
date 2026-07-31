// 회차별 요약표(식당명/메뉴/한줄평/주소) 렌더링과 검색을 담당하는 스크립트
const TABLE_DATA_URL = './data/table.json';

const tableBody = document.getElementById('tableBody');
const tableCount = document.getElementById('tableCount');
const tableSearch = document.getElementById('tableSearch');

let rows = [];
const selectedSido = new Set();
const selectedSigungu = new Set();

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
  if (selectedSido.size && !selectedSido.has(r.sido)) return false;
  if (selectedSigungu.size && !selectedSigungu.has(r.sigungu)) return false;
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

function buildFilterOptions(containerId, countId, field, selectedSet) {
  const container = document.getElementById(containerId);
  const countEl = document.getElementById(countId);
  const values = [...new Set(rows.map((r) => r[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));

  container.innerHTML = values
    .map((v) => `<label><input type="checkbox" value="${escapeHtml(v)}"> ${escapeHtml(v)}</label>`)
    .join('');

  container.addEventListener('change', (e) => {
    if (e.target.tagName !== 'INPUT') return;
    if (e.target.checked) selectedSet.add(e.target.value);
    else selectedSet.delete(e.target.value);
    countEl.textContent = selectedSet.size ? ` (${selectedSet.size})` : '';
    render();
  });
}

function setupFilterClear(buttonSelector, containerId, countId, selectedSet) {
  document.querySelector(buttonSelector).addEventListener('click', () => {
    selectedSet.clear();
    document.querySelectorAll(`#${containerId} input:checked`).forEach((el) => { el.checked = false; });
    document.getElementById(countId).textContent = '';
    render();
  });
}

// details 드롭다운 바깥을 클릭하면 닫히도록 처리 (details 기본 동작에는 없음)
document.addEventListener('click', (e) => {
  document.querySelectorAll('.filter-dropdown[open]').forEach((el) => {
    if (!el.contains(e.target)) el.removeAttribute('open');
  });
});

async function load() {
  const res = await fetch(TABLE_DATA_URL);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
  rows = await res.json();
  buildFilterOptions('sidoFilterOptions', 'sidoFilterCount', 'sido', selectedSido);
  buildFilterOptions('sigunguFilterOptions', 'sigunguFilterCount', 'sigungu', selectedSigungu);
  render();
}

tableSearch.addEventListener('input', render);
setupFilterClear('[data-filter-clear="sido"]', 'sidoFilterOptions', 'sidoFilterCount', selectedSido);
setupFilterClear('[data-filter-clear="sigungu"]', 'sigunguFilterOptions', 'sigunguFilterCount', selectedSigungu);

load().catch((err) => {
  tableBody.innerHTML = `<tr><td colspan="8">${escapeHtml(err.message)}</td></tr>`;
});
