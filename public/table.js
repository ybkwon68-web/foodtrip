// 회차별 요약표(식당명/메뉴/한줄평/주소) 렌더링과 검색을 담당하는 스크립트
const TABLE_DATA_URL = './data/table.json';

const tableBody = document.getElementById('tableBody');
const tableCount = document.getElementById('tableCount');
const tableSearch = document.getElementById('tableSearch');

let rows = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function cell(value, extraClass) {
  const cls = extraClass ? ` class="${extraClass}"` : '';
  return value ? `<td${cls}>${escapeHtml(value)}</td>` : `<td${cls ? cls.slice(0, -1) + ' empty-cell"' : ' class="empty-cell"'}>-</td>`;
}

function rowTemplate(r) {
  return `
    <tr>
      <td class="col-ep">제${r.episode}회</td>
      ${cell(r.restaurant_name, 'col-name')}
      ${cell(r.menu, 'col-menu')}
      ${cell(r.review, 'col-review')}
      ${cell(r.sido)}
      ${cell(r.sigungu)}
      ${cell(r.detail_addr, 'col-addr')}
    </tr>
  `;
}

function matches(r, query) {
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
  tableCount.textContent = `총 ${filtered.length}개 행 (회차 ${rows.length ? new Set(rows.map(r => r.episode)).size : 0}개)`;
  tableBody.innerHTML = filtered.map(rowTemplate).join('');
}

async function load() {
  const res = await fetch(TABLE_DATA_URL);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
  rows = await res.json();
  render();
}

tableSearch.addEventListener('input', render);

load().catch((err) => {
  tableBody.innerHTML = `<tr><td colspan="7">${escapeHtml(err.message)}</td></tr>`;
});
