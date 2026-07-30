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
  tableBody.innerHTML = `<tr><td colspan="8">${escapeHtml(err.message)}</td></tr>`;
});
