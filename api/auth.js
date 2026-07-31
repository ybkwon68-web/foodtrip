// 관리자 비밀번호를 확인하고 세션 토큰을 발급하는 엔드포인트
const { issueToken } = require('../lib/auth');
const { checkLoginRateLimit } = require('../lib/rateLimit');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 허용됩니다.' });
    return;
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(500).json({ error: '서버에 ADMIN_PASSWORD가 설정되지 않았습니다.' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const { allowed, retryAfterSeconds } = await checkLoginRateLimit(ip);
  if (!allowed) {
    res.status(429).json({ error: `시도 횟수를 초과했습니다. ${retryAfterSeconds}초 후 다시 시도해주세요.` });
    return;
  }

  const { password } = req.body || {};
  if (password !== adminPassword) {
    res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    return;
  }

  const { token, expiresAt } = issueToken();
  res.status(200).json({ token, expiresAt });
};
