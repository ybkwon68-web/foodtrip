// 로그인 시도 횟수를 IP별로 세어 무차별 대입을 막는 헬퍼 (Upstash Redis 사용)
const { Redis } = require('@upstash/redis');

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 10 * 60; // 10분

let client;

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Upstash 설정 전까지는 rate limit을 비활성 상태로 두어 기존 로그인 동작을 막지 않는다.
  if (!url || !token) return null;
  if (!client) client = new Redis({ url, token });
  return client;
}

async function checkLoginRateLimit(ip) {
  const redis = getRedis();
  if (!redis) return { allowed: true };

  const key = `login-attempts:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }
  if (count > MAX_ATTEMPTS) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
  }
  return { allowed: true };
}

module.exports = { checkLoginRateLimit };
