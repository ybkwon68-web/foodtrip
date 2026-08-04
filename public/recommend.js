// 자연어 조건을 입력하면 어울리는 식당 2~3곳을 추천받는 프롬프트 UI
const recommendForm = document.getElementById('recommendForm');
const recommendInput = document.getElementById('recommendInput');
const recommendSubmit = document.getElementById('recommendSubmit');
const recommendResult = document.getElementById('recommendResult');

let lastQuery = '';
let lastPicks = [];
let awaitingAnswer = false; // 되묻기 질문에 대한 답을 기다리는 중인지 (1회로 제한)

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
  awaitingAnswer = false;
}

function renderClarifyQuestion(question) {
  recommendResult.innerHTML = `${actionsHtml(false)}<p class="recommend-clarify">${escapeHtmlForRecommend(question)}</p>`;
  recommendInput.value = '';
  recommendInput.focus();
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

// 신규 요청, "다시 추천받기", 되묻기 답변을 공통 처리한다.
// - exclude: 이전에 보여준 (episode,name) 목록 — 서버가 같은 식당을 다시 추천하지 않도록 후보에서 제외
// - forcePicks: 되묻기에 대한 답변을 보낼 때 true — 이번엔 정보가 부족해 보여도 추천을 강제한다(되묻기 1회 제한)
async function runRecommend(query, exclude, forcePicks) {
  recommendSubmit.disabled = true;
  recommendSubmit.textContent = '찾는 중...';
  recommendResult.hidden = false;
  recommendResult.innerHTML = '<p class="recommend-loading">조건에 맞는 식당을 찾고 있습니다...</p>';

  try {
    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, exclude, forcePicks }),
    });
    const data = await res.json();
    if (!res.ok) {
      awaitingAnswer = false;
      recommendResult.innerHTML = `${actionsHtml(false)}<p class="recommend-empty">${escapeHtmlForRecommend(data.error || '추천을 가져오지 못했습니다.')}</p>`;
      return;
    }

    lastQuery = query;
    if (data.needsClarification) {
      if (forcePicks) {
        // 이미 한 번 답변을 받았는데도 모델이 다시 되물으면, 무한 루프를 막기 위해
        // 추가 질문 없이 안내만 보여주고 종료한다(되묻기는 항상 최대 1회).
        awaitingAnswer = false;
        recommendResult.innerHTML = `${actionsHtml(false)}<p class="recommend-empty">${escapeHtmlForRecommend(data.question)}</p>`;
        return;
      }
      awaitingAnswer = true;
      renderClarifyQuestion(data.question);
      return;
    }

    awaitingAnswer = false;
    renderRecommendResult(data);
  } catch (err) {
    awaitingAnswer = false;
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
    runRecommend(lastQuery, exclude, false);
  }
});

recommendForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const typed = recommendInput.value.trim();
  if (!typed) return;

  if (awaitingAnswer) {
    // 되묻기는 1회로 제한 — 답을 이어붙여 다시 요청하고, 이후엔 forcePicks로 반드시 추천하게 한다.
    const combined = `${lastQuery} ${typed}`.trim();
    awaitingAnswer = false;
    runRecommend(combined, [], true);
    return;
  }

  runRecommend(typed, [], false);
});
