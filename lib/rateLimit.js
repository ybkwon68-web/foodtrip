// 로그인 시도/추천 요청 횟수를 IP별로 세어 남용을 막는 헬퍼 (Upstash Redis 사용)
const { Redis } = require('@upstash/redis');

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 10 * 60; // 10분
const RECOMMEND_MAX_ATTEMPTS = 8;
const RECOMMEND_WINDOW_SECONDS = 10 * 60; // 10분, LLM 호출 비용이 있어 로그인보다 빡빡하지 않되 무제한은 아니게

let client;

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Upstash 설정 전까지는 rate limit을 비활성 상태로 두어 기존 동작을 막지 않는다.
  if (!url || !token) return null;
  if (!client) client = new Redis({ url, token });
  return client;
}

async function checkRateLimit(key, maxAttempts, windowSeconds) {
  const redis = getRedis();
  if (!redis) return { allowed: true };

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (count > maxAttempts) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  }
  return { allowed: true };
}

async function checkLoginRateLimit(ip) {
  return checkRateLimit(`login-attempts:${ip}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS);
}

async function checkRecommendRateLimit(ip) {
  return checkRateLimit(`recommend-attempts:${ip}`, RECOMMEND_MAX_ATTEMPTS, RECOMMEND_WINDOW_SECONDS);
}

module.exports = { checkLoginRateLimit, checkRecommendRateLimit };
