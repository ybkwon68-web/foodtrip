// lib/rateLimit.js(로그인 rate limit) fail-open 동작 회귀 테스트
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
const { test, summary, assert } = require('./helpers');
const { checkLoginRateLimit } = require('../lib/rateLimit');

async function main() {
  await test('Upstash 환경변수가 없으면 제한 없이 통과한다(fail-open)', async () => {
    const result = await checkLoginRateLimit('127.0.0.1');
    assert.deepStrictEqual(result, { allowed: true });
  });

  summary('lib/rateLimit.js');
}

main();
