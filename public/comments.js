// 제보(댓글) 관리 페이지 전용 스크립트 — 전체 목록 조회, 삭제, 폐업·이전 즉시 확정.
// 제보는 작성 즉시 공개되므로(승인 단계 없음) 이 페이지는 부적절한 제보를 지우는 용도.
const editModeFlow = (typeof window !== 'undefined' && window.EditModeFlow)
  ? window.EditModeFlow
  : (typeof require === 'function' ? require('./lib/editModeFlow') : null);
const submitStatusCheckDecision = editModeFlow?.submitStatusCheckDecision || async function () {
  return { ok: false, error: '점검 처리 모듈을 불러오지 못했습니다.' };
};

function getAdminToken() {
  const token = localStorage.getItem('foodtrip_admin_token');
  const expiresAt = Number(localStorage.getItem('foodtrip_admin_expires') || 0);
  if (!token || Date.now() > expiresAt) return null;
  return token;
}

function clearAdminSession() {
  localStorage.removeItem('foodtrip_admin_token');
  localStorage.removeItem('foodtrip_admin_expires');
}

if (!getAdminToken()) {
  alert('제보 관리 기능은 편집 모드가 활성화된 상태에서만 사용할 수 있습니다. 메인 화면에서 로그인해 주세요.');
  location.href = './index.html';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR');
}

const commentList = document.getElementById('commentList');
const commentEmpty = document.getElementById('commentEmpty');

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

function itemTemplate(c) {
  return `
    <div class="comment-admin-item" data-id="${c.id}" data-episode="${c.episode}" data-name="${escapeHtml(c.restaurant_name)}">
      <div class="comment-admin-meta">
        <a href="./index.html#/episode/${c.episode}" target="_blank" rel="noopener">제${c.episode}회</a>
        <strong>${escapeHtml(c.restaurant_name) || '식당명 미확인'}</strong>
        <span class="comment-admin-date">${formatDateTime(c.created_at)}</span>
      </div>
      <p class="comment-admin-content">${escapeHtml(c.content)}</p>
      <div class="comment-admin-actions">
        <button type="button" class="comment-admin-delete">삭제</button>
        <button type="button" class="comment-admin-flag-toggle">폐업/이전 처리</button>
      </div>
      <div class="comment-admin-flag-form" hidden>
        <label><input type="checkbox" class="flag-closure"> 폐업/휴업</label>
        <label><input type="checkbox" class="flag-moved"> 이전</label>
        <input type="text" class="flag-address" placeholder="새 주소(선택, 이전 시)" hidden>
        <button type="button" class="flag-submit">확정</button>
      </div>
    </div>
  `;
}

async function loadComments() {
  const token = getAdminToken();
  if (!token) return;
  commentList.innerHTML = '<p class="spot-note">불러오는 중...</p>';
  try {
    const res = await fetch('/api/admin/comments', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      clearAdminSession();
      alert('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      location.href = './index.html';
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      showStatus(data.error || '제보 목록을 불러오지 못했습니다.', 'error', 3200);
      commentList.innerHTML = '';
      return;
    }
    renderList(data);
  } catch (err) {
    commentList.innerHTML = '';
    showStatus('서버에 연결할 수 없습니다.', 'error', 3200);
  }
}

function renderList(comments) {
  commentEmpty.hidden = comments.length > 0;
  commentList.innerHTML = comments.map(itemTemplate).join('');
}

async function deleteComment(id) {
  const token = getAdminToken();
  const res = await fetch(`/api/admin/comments?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    showStatus(data.error || '삭제에 실패했습니다.', 'error', 3200);
    return false;
  }
  return true;
}

commentList.addEventListener('change', (e) => {
  if (!e.target.classList.contains('flag-moved')) return;
  const form = e.target.closest('.comment-admin-flag-form');
  form.querySelector('.flag-address').hidden = !e.target.checked;
});

commentList.addEventListener('click', async (e) => {
  const item = e.target.closest('.comment-admin-item');
  if (!item) return;
  const id = item.dataset.id;

  if (e.target.classList.contains('comment-admin-delete')) {
    if (!confirm('이 제보를 완전히 삭제할까요?')) return;
    if (await deleteComment(id)) {
      showStatus('제보를 삭제했습니다.', 'success', 2200);
      loadComments();
    }
    return;
  }
  if (e.target.classList.contains('comment-admin-flag-toggle')) {
    const form = item.querySelector('.comment-admin-flag-form');
    form.hidden = !form.hidden;
    return;
  }
  if (e.target.classList.contains('flag-submit')) {
    const form = item.querySelector('.comment-admin-flag-form');
    const closureSuspected = form.querySelector('.flag-closure').checked;
    const movedSuspected = form.querySelector('.flag-moved').checked;
    const candidateAddress = form.querySelector('.flag-address').value.trim();
    if (!closureSuspected && !movedSuspected) {
      alert('폐업/휴업 또는 이전 중 최소 하나는 선택해주세요.');
      return;
    }
    const token = getAdminToken();
    const episodeId = Number(item.dataset.episode);
    const name = item.dataset.name;
    const submitBtn = e.target;
    submitBtn.disabled = true;
    const result = await submitStatusCheckDecision({
      episodeId,
      name,
      decision: 'confirmed',
      token,
      extra: { closureSuspected, movedSuspected, candidateAddress },
      decisionRequest: async ({ episodeId: epId, name: rName, decision, token: authToken, extra }) => {
        try {
          const res = await fetch(`/api/episodes/${epId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ name: rName, decision, ...extra }),
          });
          const data = await res.json();
          return { ok: res.ok, status: res.status, data, error: data && data.error };
        } catch (err) {
          return { ok: false, status: 0, error: '서버에 연결할 수 없습니다.' };
        }
      },
    });
    submitBtn.disabled = false;
    if (!result.ok) {
      if (result.expired) {
        clearAdminSession();
        alert('로그인이 만료되었습니다. 다시 로그인해 주세요.');
        location.href = './index.html';
        return;
      }
      showStatus(result.error || '처리에 실패했습니다.', 'error', 3200);
      return;
    }
    showStatus('폐업/이전 처리를 확정했습니다.', 'success', 2400);
  }
});

loadComments();
