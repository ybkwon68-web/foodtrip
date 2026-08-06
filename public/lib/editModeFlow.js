(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.EditModeFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  async function authenticateAdmin({ password, authRequest, storage, localDevOverride = false }) {
    if (localDevOverride) {
      const token = `local-dev-${Date.now()}`;
      const expiresAt = Date.now() + 1000 * 60 * 60 * 8;
      storage.setItem('foodtrip_admin_token', token);
      storage.setItem('foodtrip_admin_expires', String(expiresAt));
      return { ok: true, token, expiresAt };
    }

    const response = await authRequest({ password });
    if (!response.ok) {
      return { ok: false, error: response.error || '로그인에 실패했습니다.' };
    }

    storage.setItem('foodtrip_admin_token', response.token);
    storage.setItem('foodtrip_admin_expires', String(response.expiresAt));
    return { ok: true, token: response.token, expiresAt: response.expiresAt };
  }

  async function saveRestaurantEdit({ episodeId, token, restaurants, verified, saveRequest, localDevOverride = false }) {
    const response = await saveRequest({ episodeId, token, restaurants, verified });
    if (!response.ok && response.status === 401) {
      return { ok: false, expired: true, error: '로그인이 만료되었습니다. 다시 로그인해주세요.' };
    }
    if (!response.ok && localDevOverride) {
      return {
        ok: true,
        data: { episodeId, restaurants, verified, source: 'local-dev' },
      };
    }
    if (!response.ok) {
      return { ok: false, error: response.error || '저장에 실패했습니다.' };
    }
    return { ok: true, data: response.data };
  }

  // 폐업/이전 의심 배지를 관리자가 "확정" 또는 "정상으로 원복"하는 요청을 처리한다.
  // decision: "confirmed" | "dismissed". extra: 기존 배지가 없는 식당을 관리자가 직접 새로
  // 등록할 때 필요한 {closureSuspected, movedSuspected, candidateAddress} (있으면 통과시킴).
  async function submitStatusCheckDecision({ episodeId, name, decision, token, extra = {}, decisionRequest, localDevOverride = false }) {
    const response = await decisionRequest({ episodeId, name, decision, token, extra });
    if (!response.ok && response.status === 401) {
      return { ok: false, expired: true, error: '로그인이 만료되었습니다. 다시 로그인해주세요.' };
    }
    if (!response.ok && localDevOverride) {
      return { ok: true, data: { status_check: { ...extra, admin_decision: decision } } };
    }
    if (!response.ok) {
      return { ok: false, error: response.error || '처리에 실패했습니다.' };
    }
    return { ok: true, data: response.data };
  }

  return { authenticateAdmin, saveRestaurantEdit, submitStatusCheckDecision };
});
