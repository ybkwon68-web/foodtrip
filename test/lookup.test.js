const { test, summary, assert } = require('./helpers');
const {
  findUrlInText,
  extractNaverBlogPlaces,
  extractTvChosunBroadcast,
} = require('../lib/lookup');

test('findUrlInText returns the first URL from text', () => {
  assert.strictEqual(findUrlInText('방송 페이지 https://example.com/detail.html 참조'), 'https://example.com/detail.html');
  assert.strictEqual(findUrlInText('https://blog.naver.com/test/12345 추가 텍스트'), 'https://blog.naver.com/test/12345');
  assert.strictEqual(findUrlInText('URL이 없습니다.'), null);
});

test('extractNaverBlogPlaces returns places from v2_map module JSON', () => {
  const example = `<!doctype html><html><head><meta property="og:title" content="테스트 블로그"><meta property="og:description" content="한줄평"></head><body><div data-module='{"type":"v2_map","data":{"places":[{"name":"가게","address":"서울","tel":"010-1234-5678","latlng":{"latitude":37.5,"longitude":127.0},"placeId":"123"}]}}'></div></body></html>`;
  const result = extractNaverBlogPlaces(example);
  assert.strictEqual(result.title, '테스트 블로그');
  assert.strictEqual(result.places.length, 1);
  assert.strictEqual(result.places[0].name, '가게');
  assert.strictEqual(result.places[0].address, '서울');
  assert.strictEqual(result.places[0].place_id, '123');
});

test('extractTvChosunBroadcast returns metadata and body_html for broadcast detail HTML', () => {
  const html = `<!doctype html><html><head><meta property="og:title" content="123회 테스트"><meta property="og:description" content="방송 설명"><meta property="og:image" content="https://img.example.com/thumb.jpg"></head><body><div class="board-view"><div class="cont-box"><p>본문</p><img src="http://img.example.com/photo.jpg"></div></div></body></html>`;
  const result = extractTvChosunBroadcast(html, 'https://broadcast.tvchosun.com/detail');
  assert.strictEqual(result.title, '123회 테스트');
  assert.strictEqual(result.thumbnail, 'https://img.example.com/thumb.jpg');
  assert.ok(result.body_html.includes('https://img.example.com/photo.jpg'));
  assert.strictEqual(result.detail_url, 'https://broadcast.tvchosun.com/detail');
});

summary('lookup');
