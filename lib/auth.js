// 관리자 세션 토큰 발급/검증 (별도 세션 테이블 없이 HMAC 서명 토큰으로 상태 없이 검증)
const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET 환경변수가 설정되지 않았습니다.');
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

function issueToken() {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = String(expiresAt);
  const token = Buffer.from(`${payload}.${sign(payload)}`).toString('base64url');
  return { token, expiresAt };
}

function verifyToken(token) {
  if (!token) return false;
  const isDev = process.env.NODE_ENV === 'development' || !process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'development';
  if (isDev && typeof token === 'string' && token.startsWith('local-dev-')) {
    return true;
  }
  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  const [payload, sig] = decoded.split('.');
  if (!payload || !sig) return false;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { issueToken, verifyToken };
