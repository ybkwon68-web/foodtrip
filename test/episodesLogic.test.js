const { test, summary, assert } = require('./helpers');
const { matchesSearch, sortEpisodes } = require('../public/lib/episodesLogic');

test('검색어는 제목·지역·식당명에서 일치하는 회차만 남긴다', () => {
  const episodes = [
    { episode: 1, title: '서울 편', region: '서울특별시', restaurants: [{ name: '한우촌' }] },
    { episode: 2, title: '부산 편', region: '부산광역시', restaurants: [{ name: '해운대식당' }] },
  ];

  assert.strictEqual(matchesSearch(episodes[0], '한우'), true);
  assert.strictEqual(matchesSearch(episodes[0], '부산'), false);
  assert.strictEqual(matchesSearch(episodes[1], '해운대'), true);
  assert.strictEqual(matchesSearch(episodes[1], '서울'), false);
  assert.strictEqual(matchesSearch(episodes[0], ''), true);
});

test('정렬은 회차순/최신순 기준으로 올바르게 정렬된다', () => {
  const episodes = [
    { episode: 3, title: '세 번째' },
    { episode: 1, title: '첫 번째' },
    { episode: 2, title: '두 번째' },
    { episode: null, title: '회차 없음' },
  ];

  assert.deepStrictEqual(sortEpisodes(episodes, 'episode').map((ep) => ep.episode), [1, 2, 3, null]);
  assert.deepStrictEqual(sortEpisodes(episodes, 'latest').map((ep) => ep.episode), [3, 2, 1, null]);
});

summary('episodesLogic');
