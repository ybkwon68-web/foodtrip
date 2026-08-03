// 추가 등록 페이지에서 자동 발견 결과 확인 및 검토 흐름을 관리하는 헬퍼
function setHidden(element, hidden) {
  if (!element) return;
  if (hidden) {
    element.setAttribute('hidden', '');
  } else {
    element.removeAttribute('hidden');
  }
}

function renderReviewSummary(data) {
  const rows = [];
  if (data.source) rows.push(`소스: ${data.source}`);
  if (data.source_url) rows.push(`찾은 URL: ${data.source_url}`);
  if (data.broadcast?.title) rows.push(`방송 제목: ${data.broadcast.title}`);
  if (data.broadcast?.raw_title) rows.push(`부제: ${data.broadcast.raw_title}`);
  if (data.broadcast?.air_date) rows.push(`방송일: ${data.broadcast.air_date}`);
  if (data.broadcast?.region) rows.push(`지역: ${data.broadcast.region}`);
  if (data.restaurants?.length) rows.push(`대표 식당: ${data.restaurants[0].name || '미확인'}`);
  if (data.restaurants?.[0]?.address) rows.push(`주소: ${data.restaurants[0].address}`);
  if (data.restaurants?.[0]?.menu) rows.push(`메뉴: ${data.restaurants[0].menu}`);
  if (data.restaurants?.[0]?.review) rows.push(`한줄평: ${data.restaurants[0].review}`);
  return `
    <div class="spot-panel-head"><span class="spot-panel-title">자동 수집 결과 미리보기</span></div>
    ${rows.map((line) => `<div class="spot-field">${line}</div>`).join('')}
  `;
}

module.exports = { setHidden, renderReviewSummary };
