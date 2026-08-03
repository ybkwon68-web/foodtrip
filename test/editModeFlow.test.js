const { test, summary, assert } = require('./helpers');
const { authenticateAdmin, saveRestaurantEdit } = require('../public/lib/editModeFlow');

test('로그인 성공 시 토큰과 만료 시각을 저장하고 성공 상태를 반환한다', async () => {
  const storage = { values: {}, setItem(key, value) { this.values[key] = value; } };
  const authRequest = async () => ({ ok: true, token: 'abc', expiresAt: 123456 });

  const result = await authenticateAdmin({ password: 'secret', authRequest, storage });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(storage.values.foodtrip_admin_token, 'abc');
  assert.strictEqual(storage.values.foodtrip_admin_expires, '123456');
});

test('로그인 실패 시 에러 메시지를 반환하고 저장하지 않는다', async () => {
  const storage = { values: {}, setItem(key, value) { this.values[key] = value; } };
  const authRequest = async () => ({ ok: false, error: '비밀번호가 올바르지 않습니다.' });

  const result = await authenticateAdmin({ password: 'wrong', authRequest, storage });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, '비밀번호가 올바르지 않습니다.');
  assert.deepStrictEqual(storage.values, {});
});

test('저장 요청이 401이면 세션 만료 상태를 반환한다', async () => {
  const saveRequest = async () => ({ ok: false, status: 401, error: '토큰이 만료되었습니다.' });

  const result = await saveRestaurantEdit({ episodeId: 10, token: 'expired', restaurants: [], verified: true, saveRequest });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.expired, true);
  assert.strictEqual(result.error, '로그인이 만료되었습니다. 다시 로그인해주세요.');
});

test('저장 요청이 성공하면 저장된 데이터를 반환한다', async () => {
  const saveRequest = async () => ({ ok: true, data: { restaurants: [{ name: '새 식당' }] } });

  const result = await saveRestaurantEdit({ episodeId: 10, token: 'ok', restaurants: [{ name: '새 식당' }], verified: true, saveRequest });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.data, { restaurants: [{ name: '새 식당' }] });
});

test('로컬 개발 모드에서는 저장 API가 없어도 로컬 저장 성공으로 처리한다', async () => {
  const saveRequest = async () => ({ ok: false, status: 404, error: 'not found' });

  const result = await saveRestaurantEdit({
    episodeId: 10,
    token: 'local',
    restaurants: [{ name: '로컬 식당' }],
    verified: true,
    saveRequest,
    localDevOverride: true,
  });

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.data.restaurants, [{ name: '로컬 식당' }]);
  assert.strictEqual(result.data.verified, true);
});

test('로컬 개발 모드에서는 비밀번호 없이도 편집 로그인에 성공한다', async () => {
  const storage = { values: {}, setItem(key, value) { this.values[key] = value; } };
  const authRequest = async () => ({ ok: false, error: '비밀번호가 올바르지 않습니다.' });

  const result = await authenticateAdmin({ password: 'anything', authRequest, storage, localDevOverride: true });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(storage.values.foodtrip_admin_token.startsWith('local-dev-'), true);
  assert.strictEqual(Number(storage.values.foodtrip_admin_expires) > Date.now(), true);
});

summary('editModeFlow');
