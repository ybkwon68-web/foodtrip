// 추가 방송분 등록 페이지 전용 스크립트
const episodesLogic = (typeof window !== 'undefined' && window.EpisodesLogic)
  ? window.EpisodesLogic
  : (typeof require === 'function' ? require('./lib/episodesLogic') : null);
const editModeFlow = (typeof window !== 'undefined' && window.EditModeFlow)
  ? window.EditModeFlow
  : (typeof require === 'function' ? require('./lib/editModeFlow') : null);

const queryInput = document.getElementById('addSearch');
const matchResults = document.getElementById('matchResults');
const referenceUrlInput = document.getElementById('referenceUrl');
const supplementFileInput = document.getElementById('supplementFile');
const lookupBtn = document.getElementById('lookupBtn');
const lookupResult = document.getElementById('lookupResult');
const lookupError = document.getElementById('lookupError');
const reviewPanel = document.getElementById('reviewPanel');
const reviewSummary = document.getElementById('reviewSummary');
const confirmLookupBtn = document.getElementById('confirmLookupBtn');
const editManualBtn = document.getElementById('editManualBtn');
const addForm = document.getElementById('addForm');
const cancelAddBtn = document.getElementById('cancelAddBtn');
const episodeInput = document.getElementById('episodeInput');
const titleInput = document.getElementById('titleInput');
const rawTitleInput = document.getElementById('rawTitleInput');
const airDateInput = document.getElementById('airDateInput');
const regionInput = document.getElementById('regionInput');
const detailUrlInput = document.getElementById('detailUrlInput');
const restNameInput = document.getElementById('restNameInput');
const restAddrInput = document.getElementById('restAddrInput');
const restMenuInput = document.getElementById('restMenuInput');
const restReviewInput = document.getElementById('restReviewInput');

const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:';
let allEpisodes = [];

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
  if (window.statusTimer) clearTimeout(window.statusTimer);
  if (duration > 0) {
    window.statusTimer = setTimeout(() => banner.classList.remove('show'), duration);
  }
}

async function loadEpisodes() {
  try {
    const res = await fetch('/api/episodes');
    if (!res.ok) throw new Error('API에서 회차 목록을 가져오지 못했습니다.');
    allEpisodes = await res.json();
  } catch (err) {
    showStatus('로컬 정적 서버를 사용 중입니다. 중복 검색은 제한될 수 있습니다.', 'warning', 4200);
    const resp = await fetch('./data/episodes.json');
    allEpisodes = await resp.json();
  }
}

function parseSupplementFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const extracted = {};

      if (file.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.episode) extracted.episode = parsed.episode;
          if (parsed.title) extracted.title = parsed.title;
          if (parsed.raw_title) extracted.raw_title = parsed.raw_title;
          if (parsed.air_date) extracted.air_date = parsed.air_date;
          if (parsed.region) extracted.region = parsed.region;
          if (parsed.detail_url) extracted.detail_url = parsed.detail_url;
          if (parsed.restaurant_name) extracted.restaurant_name = parsed.restaurant_name;
          if (parsed.restaurants) extracted.restaurants = parsed.restaurants;
          if (parsed.menu) extracted.menu = parsed.menu;
          if (parsed.review) extracted.review = parsed.review;
        } catch (err) {
          reject(err);
          return;
        }
      } else {
        const episodeMatch = text.match(/(\d{1,4})회/);
        if (episodeMatch) extracted.episode = Number(episodeMatch[1]);
        const urlMatch = text.match(/https?:\/\/[^")\s'<>]+/);
        if (urlMatch) extracted.detail_url = urlMatch[0];
        const titleMatch = text.match(/제?\s*\d{1,4}회\s*([^\n]+)/);
        if (titleMatch) extracted.title = titleMatch[1].trim();
        const restaurantMatch = text.match(/식당(?:명)?[:：\s]*([^\n]+)/);
        if (restaurantMatch) extracted.restaurant_name = restaurantMatch[1].trim();
        const menuMatch = text.match(/메뉴[:：\s]*([^\n]+)/);
        if (menuMatch) extracted.menu = menuMatch[1].trim();
        const reviewMatch = text.match(/한줄평[:：\s]*([^\n]+)/);
        if (reviewMatch) extracted.review = reviewMatch[1].trim();
      }

      resolve(extracted);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

function renderSupplementSummary(extracted) {
  const lines = [];
  if (extracted.episode) lines.push(`회차: ${extracted.episode}`);
  if (extracted.title) lines.push(`제목: ${extracted.title}`);
  if (extracted.detail_url) lines.push(`URL: ${extracted.detail_url}`);
  if (extracted.restaurant_name) lines.push(`식당명: ${extracted.restaurant_name}`);
  if (extracted.menu) lines.push(`메뉴: ${extracted.menu}`);
  if (extracted.review) lines.push(`한줄평: ${extracted.review}`);
  lookupResult.style.display = 'block';
  lookupResult.innerHTML = `
    <div class="spot-panel-head"><span class="spot-panel-title">보조 파일에서 추출된 정보</span></div>
    ${lines.map((line) => `<div class="spot-field">${line}</div>`).join('')}
  `;
}

function renderLookupResult(data) {
  const pieces = [];
  if (data.source) pieces.push(`소스: ${data.source}`);
  if (data.source_url) pieces.push(`찾은 URL: <a href="${data.source_url}" target="_blank" rel="noopener">${data.source_url}</a>`);
  if (data.broadcast && data.broadcast.title) pieces.push(`방송 제목: ${data.broadcast.title}`);
  if (data.restaurants?.length) pieces.push(`발견된 식당: ${data.restaurants.length}개`);
  lookupResult.style.display = 'block';
  lookupResult.innerHTML = `
    <div class="spot-panel-head"><span class="spot-panel-title">자동 검색 결과</span></div>
    ${pieces.map((item) => `<div class="spot-field">${item}</div>`).join('')}
  `;
}

function renderReviewSummary(data) {
  const lines = [];
  if (data.source) lines.push(`소스: ${data.source}`);
  if (data.source_url) lines.push(`찾은 URL: ${data.source_url}`);
  if (data.broadcast?.title) lines.push(`방송 제목: ${data.broadcast.title}`);
  if (data.broadcast?.raw_title) lines.push(`부제: ${data.broadcast.raw_title}`);
  if (data.broadcast?.air_date) lines.push(`방송일: ${data.broadcast.air_date}`);
  if (data.broadcast?.region) lines.push(`지역: ${data.broadcast.region}`);
  if (data.restaurants?.length) lines.push(`대표 식당: ${data.restaurants[0].name || '미확인'}`);
  if (data.restaurants?.[0]?.address) lines.push(`주소: ${data.restaurants[0].address}`);
  if (data.restaurants?.[0]?.menu) lines.push(`메뉴: ${data.restaurants[0].menu}`);
  if (data.restaurants?.[0]?.review) lines.push(`한줄평: ${data.restaurants[0].review}`);
  reviewSummary.innerHTML = `
    <div class="spot-panel-head"><span class="spot-panel-title">자동 수집 결과 미리보기</span></div>
    ${lines.map((line) => `<div class="spot-field">${line}</div>`).join('')}
  `;
  reviewPanel.hidden = false;
}

function fillFormFromLookup(data) {
  if (data.broadcast) {
    if (data.broadcast.episode) episodeInput.value = data.broadcast.episode;
    if (data.broadcast.title) titleInput.value = data.broadcast.title;
    if (data.broadcast.raw_title) rawTitleInput.value = data.broadcast.raw_title;
    if (data.broadcast.detail_url) detailUrlInput.value = data.broadcast.detail_url;
    if (data.broadcast.air_date) airDateInput.value = data.broadcast.air_date;
    if (data.broadcast.region) regionInput.value = data.broadcast.region;
  }
  if (data.restaurants?.length) {
    const first = data.restaurants[0];
    if (first.name) restNameInput.value = first.name;
    if (first.address) restAddrInput.value = first.address;
    if (first.menu) restMenuInput.value = first.menu;
    if (first.review) restReviewInput.value = first.review;
  }
}

confirmLookupBtn.addEventListener('click', () => {
  reviewPanel.hidden = true;
  addForm.hidden = false;
  addForm.scrollIntoView({ behavior: 'smooth' });
});

editManualBtn.addEventListener('click', () => {
  reviewPanel.hidden = true;
  addForm.hidden = false;
  addForm.scrollIntoView({ behavior: 'smooth' });
});

function renderMatches(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    matchResults.innerHTML = '<p class="spot-note">검색어를 입력하면 기존 회차 중 중복 여부를 확인할 수 있습니다.</p>';
    return;
  }

  const matches = allEpisodes.filter((ep) => {
    const q = trimmed.toLowerCase();
    if (String(ep.episode) === q) return true;
    const haystack = [ep.title, ep.raw_title, ep.region, (ep.restaurants || []).map((r) => r.name).join(' ')].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  });

  if (!matches.length) {
    matchResults.innerHTML = '<p class="spot-note">중복 회차가 없습니다. 등록 가능성을 확인하세요.</p>';
    return;
  }

  matchResults.innerHTML = `
    <div class="spot-panel">
      <div class="spot-panel-head"><span class="spot-panel-title">중복 가능성 확인</span></div>
      ${matches.slice(0, 5).map((ep) => `
        <div class="spot-field">
          <strong>제${ep.episode}회</strong> ${ep.title || ep.raw_title || ''} · ${ep.region || '지역 없음'}
        </div>
      `).join('')}
      ${matches.length > 5 ? `<p class="spot-note">${matches.length - 5}개 더 검색되었습니다.</p>` : ''}
    </div>
  `;
}

queryInput.addEventListener('input', (e) => renderMatches(e.target.value));
lookupBtn.addEventListener('click', async () => {
  lookupError.textContent = '';
  lookupResult.style.display = 'none';
  lookupResult.innerHTML = '';
  const query = queryInput.value.trim();
  const referenceUrl = referenceUrlInput.value.trim();
  const file = supplementFileInput.files[0];

  if (!query && !referenceUrl && !file) {
    lookupError.textContent = '검색어, 참고 URL 또는 보조 파일 중 하나를 입력해주세요.';
    return;
  }

  const payload = { query, reference_url: referenceUrl };

  if (file) {
    try {
      const extracted = await parseSupplementFile(file);
      if (Object.keys(extracted).length) {
        renderSupplementSummary(extracted);
        payload.supplement = extracted;
      }
    } catch (err) {
      lookupError.textContent = '보조 파일을 읽는 중 오류가 발생했습니다.';
      return;
    }
  }

  lookupBtn.disabled = true;
  lookupBtn.textContent = '검색 중...';
  try {
    const res = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      lookupError.textContent = data.error || '검색에 실패했습니다.';
      if (data.candidate_urls && data.candidate_urls.length) {
        lookupResult.style.display = 'block';
        lookupResult.innerHTML = `
          <div class="spot-panel-head"><span class="spot-panel-title">후보 URL</span></div>
          ${data.candidate_urls.map((url) => `<p class="spot-field"><a href="${url}" target="_blank" rel="noopener">${url}</a></p>`).join('')}
        `;
      }
      return;
    }
    renderLookupResult(data);
    renderReviewSummary(data);
    fillFormFromLookup(data);
    reviewPanel.hidden = false;
    addForm.hidden = true;
    const message = data.broadcast ? '방송 정보 및 자동 수집 결과를 채웠습니다.' : '자동 수집 결과를 일부 채웠습니다.';
    showStatus(message, 'success', 3200);
  } catch (err) {
    if (isLocalDev) {
      const fallback = lookupLocalEpisode(query);
      if (fallback) {
        renderLookupResult({ source: 'local_snapshot', broadcast: fallback, restaurants: fallback.restaurants || [] });
        renderReviewSummary(fallback);
        fillFormFromLookup(fallback);
        reviewPanel.hidden = false;
        lookupError.textContent = '로컬 스냅샷에서 정보 일부를 채웠습니다.';
      } else {
        lookupError.textContent = '로컬 환경에서는 API가 없으므로 등록 후 수동으로 정보를 수정하세요.';
      }
    } else {
      lookupError.textContent = '서버에 연결할 수 없습니다. 로컬 환경에서는 수동 입력을 사용하세요.';
    }
  } finally {
    lookupBtn.disabled = false;
    lookupBtn.textContent = '검색/자동 채우기';
  }
});

function lookupLocalEpisode(query) {
  const trimmed = String(query || '').trim().toLowerCase();
  if (!trimmed) return null;
  const episodeNum = Number(trimmed.replace(/[^0-9]/g, ''));
  let match = null;
  if (Number.isInteger(episodeNum) && episodeNum > 0) {
    match = allEpisodes.find((ep) => ep.episode === episodeNum);
  }
  if (!match) {
    match = allEpisodes.find((ep) => {
      const haystack = [ep.title, ep.raw_title, ep.region, (ep.restaurants || []).map((r) => r.name).join(' ')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(trimmed);
    });
  }
  return match || null;
}
addForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const episode = Number(episodeInput.value);
  if (!Number.isInteger(episode) || episode < 1) {
    showStatus('유효한 회차 번호를 입력해주세요.', 'error', 2800);
    return;
  }

  const payload = {
    episode,
    title: titleInput.value.trim(),
    raw_title: rawTitleInput.value.trim(),
    air_date: airDateInput.value || null,
    region: regionInput.value.trim(),
    detail_url: detailUrlInput.value.trim() || null,
    restaurants: [],
    verified: false,
  };

  const restaurant = {
    name: restNameInput.value.trim(),
    address: restAddrInput.value.trim(),
    menu: restMenuInput.value.trim(),
    review: restReviewInput.value.trim(),
  };

  if (restaurant.name) {
    payload.restaurants.push(restaurant);
  }

  const token = localStorage.getItem('foodtrip_admin_token');
  if (!token && !isLocalDev) {
    showStatus('편집 모드 로그인이 필요합니다.', 'error', 3200);
    return;
  }

  const saveBtn = addForm.querySelector('.btn-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '등록 중...';

  try {
    const res = await fetch('/api/episodes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      showStatus('새 방송분이 등록되었습니다.', 'success', 3200);
      addForm.reset();
      renderMatches('');
      return;
    }

    const errorData = await res.json();
    showStatus(errorData.error || '등록에 실패했습니다.', 'error', 3200);
  } catch (err) {
    if (isLocalDev) {
      showStatus('로컬 개발 환경으로 등록을 완료했습니다.', 'success', 3200);
      addForm.reset();
      renderMatches('');
    } else {
      showStatus('서버에 연결할 수 없습니다.', 'error', 3200);
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '등록하기';
  }
});

cancelAddBtn.addEventListener('click', () => {
  location.href = './index.html';
});

loadEpisodes().then(() => renderMatches('')).catch(() => renderMatches(''));