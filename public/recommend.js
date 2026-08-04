// 자연어 조건을 입력하면 어울리는 식당 2~3곳을 추천받는 프롬프트 UI
const recommendForm = document.getElementById('recommendForm');
const recommendInput = document.getElementById('recommendInput');
const recommendSubmit = document.getElementById('recommendSubmit');
const recommendResult = document.getElementById('recommendResult');

function escapeHtmlForRecommend(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function recommendCardTemplate(p) {
  const distance = p.distance_km != null ? ` · 약 ${p.distance_km}km` : '';
  const menuRow = p.menu ? `<p class="recommend-card-menu">${escapeHtmlForRecommend(p.menu)}</p>` : '';
  return `
    <div class="recommend-card">
      <p class="recommend-card-title">${escapeHtmlForRecommend(p.name)}<span class="recommend-card-ep">제${p.episode}회 · ${escapeHtmlForRecommend(p.episodeTitle || '')}</span></p>
      <p class="recommend-card-addr"><a href="${p.mapUrl}" target="_blank" rel="noopener">${escapeHtmlForRecommend(p.address || '주소 미확인')}</a>${distance}</p>
      ${menuRow}
      <p class="recommend-card-reason">${escapeHtmlForRecommend(p.reason)}</p>
      <a class="recommend-card-link" href="#/episode/${p.episode}">회차 상세보기 →</a>
    </div>
  `;
}

const closeButtonHtml = '<button type="button" class="recommend-close" id="recommendClose">✕ 결과 닫기</button>';

function closeRecommendResult() {
  recommendResult.hidden = true;
  recommendResult.innerHTML = '';
  recommendInput.value = '';
}

function renderRecommendResult(data) {
  if (!data.picks || !data.picks.length) {
    recommendResult.innerHTML = `${closeButtonHtml}<p class="recommend-empty">${escapeHtmlForRecommend(data.notice || '조건에 맞는 식당을 찾지 못했습니다. 다른 표현으로 다시 시도해 보세요.')}</p>`;
    return;
  }
  const noticeHtml = data.notice ? `<p class="recommend-notice">${escapeHtmlForRecommend(data.notice)}</p>` : '';
  const cardsHtml = data.picks.map(recommendCardTemplate).join('');
  recommendResult.innerHTML = `${closeButtonHtml}${noticeHtml}<div class="recommend-cards">${cardsHtml}</div>`;
}

// textarea 스크롤바(위아래 화살표)가 보이지 않도록, 입력한 만큼 높이를 자동으로 늘린다.
function autoGrowRecommendInput() {
  recommendInput.style.height = 'auto';
  recommendInput.style.height = `${recommendInput.scrollHeight}px`;
}
recommendInput.addEventListener('input', autoGrowRecommendInput);

recommendResult.addEventListener('click', (e) => {
  if (e.target.closest('#recommendClose')) closeRecommendResult();
});

recommendForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = recommendInput.value.trim();
  if (!query) return;

  recommendSubmit.disabled = true;
  recommendSubmit.textContent = '찾는 중...';
  recommendResult.hidden = false;
  recommendResult.innerHTML = '<p class="recommend-loading">조건에 맞는 식당을 찾고 있습니다...</p>';

  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) {
      recommendResult.innerHTML = `${closeButtonHtml}<p class="recommend-empty">${escapeHtmlForRecommend(data.error || '추천을 가져오지 못했습니다.')}</p>`;
      return;
    }
    renderRecommendResult(data);
  } catch (err) {
    recommendResult.innerHTML = `${closeButtonHtml}<p class="recommend-empty">서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.</p>`;
  } finally {
    recommendSubmit.disabled = false;
    recommendSubmit.textContent = '추천받기';
  }
});
