// lib/auth.js(관리자 세션 토큰 발급/검증) 회귀 테스트
process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
const crypto = require('crypto');
const { test, summary, assert } = require('./helpers');
const { issueToken, verifyToken } = require('../lib/auth');

test('정상 발급한 토큰은 검증을 통과한다', () => {
  const { token } = issueToken();
  assert.strictEqual(verifyToken(token), true);
});

test('한 글자라도 변조된 토큰은 거부된다', () => {
  const { token } = issueToken();
  const tampered = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
  assert.strictEqual(verifyToken(tampered), false);
});

test('만료 시각이 지난 토큰은 거부된다', () => {
  const expiresAt = Date.now() - 1000; // 이미 만료됨
  const payload = String(expiresAt);
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
  const expiredToken = Buffer.from(`${payload}.${sig}`).toString('base64url');
  assert.strictEqual(verifyToken(expiredToken), false);
});

test('발급 당시와 다른 SESSION_SECRET으로는 검증에 실패한다', () => {
  const { token } = issueToken();
  process.env.SESSION_SECRET = 'a-different-secret';
  assert.strictEqual(verifyToken(token), false);
  process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
});

test('빈 값·형식이 깨진 토큰은 거부된다', () => {
  assert.strictEqual(verifyToken(''), false);
  assert.strictEqual(verifyToken(null), false);
  assert.strictEqual(verifyToken(undefined), false);
  assert.strictEqual(verifyToken('not-a-valid-token'), false);
});

summary('lib/auth.js');
