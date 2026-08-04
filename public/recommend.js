// 자연어 조건을 입력하면 어울리는 식당 2~3곳을 추천받는 프롬프트 UI
const recommendForm = document.getElementById('recommendForm');
const recommendInput = document.getElementById('recommendInput');
const recommendSubmit = document.getElementById('recommendSubmit');
const recommendResult = document.getElementById('recommendResult');

let lastQuery = '';
let lastPicks = [];

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
const retryButtonHtml = '<button type="button" class="recommend-retry" id="recommendRetry">다른 곳으로 다시 추천받기</button>';

function actionsHtml(withRetry) {
  return `<div class="recommend-actions">${withRetry ? retryButtonHtml : ''}${closeButtonHtml}</div>`;
}

function closeRecommendResult() {
  recommendResult.hidden = true;
  recommendResult.innerHTML = '';
  recommendInput.value = '';
  lastQuery = '';
  lastPicks = [];
}

function renderRecommendResult(data) {
  lastPicks = data.picks || [];
  if (!data.picks || !data.picks.length) {
    recommendResult.innerHTML = `${actionsHtml(false)}<p class="recommend-empty">${escapeHtmlForRecommend(data.notice || '조건에 맞는 식당을 찾지 못했습니다. 다른 표현으로 다시 시도해 보세요.')}</p>`;
    return;
  }
  const noticeHtml = data.notice ? `<p class="recommend-notice">${escapeHtmlForRecommend(data.notice)}</p>` : '';
  const cardsHtml = data.picks.map(recommendCardTemplate).join('');
  recommendResult.innerHTML = `${actionsHtml(true)}${noticeHtml}<div class="recommend-cards">${cardsHtml}</div>`;
}

// textarea 스크롤바(위아래 화살표)가 보이지 않도록, 입력한 만큼 높이를 자동으로 늘린다.
function autoGrowRecommendInput() {
  recommendInput.style.height = 'auto';
  recommendInput.style.height = `${recommendInput.scrollHeight}px`;
}
recommendInput.addEventListener('input', autoGrowRecommendInput);

// 신규 요청과 "다시 추천받기" 요청을 공통 처리한다. exclude는 이전에 보여준 (episode,name) 목록으로,
// 서버가 같은 식당을 다시 추천하지 않도록 후보에서 제외하는 데 쓰인다.
async function runRecommend(query, exclude) {
  recommendSubmit.disabled = true;
  recommendSubmit.textContent = '찾는 중...';
  recommendResult.hidden = false;
  recommendResult.innerHTML = '<p class="recommend-loading">조건에 맞는 식당을 찾고 있습니다...</p>';

  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, exclude }),
    });
    const data = await res.json();
    if (!res.ok) {
      recommendResult.innerHTML = `${actionsHtml(false)}<p class="recommend-empty">${escapeHtmlForRecommend(data.error || '추천을 가져오지 못했습니다.')}</p>`;
      return;
    }
    lastQuery = query;
    renderRecommendResult(data);
  } catch (err) {
    recommendResult.innerHTML = `${actionsHtml(false)}<p class="recommend-empty">서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.</p>`;
  } finally {
    recommendSubmit.disabled = false;
    recommendSubmit.textContent = '추천받기';
  }
}

recommendResult.addEventListener('click', (e) => {
  if (e.target.closest('#recommendClose')) {
    closeRecommendResult();
    return;
  }
  if (e.target.closest('#recommendRetry')) {
    const exclude = lastPicks.map((p) => ({ episode: p.episode, name: p.name }));
    runRecommend(lastQuery, exclude);
  }
});

recommendForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = recommendInput.value.trim();
  if (!query) return;
  runRecommend(query, []);
});
