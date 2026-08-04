// 방송국/네이버 블로그 자동 수집용 HTML 파싱 및 검색 헬퍼
const BLOG_LINK_RE = /blog\.naver\.com\/([a-zA-Z0-9_\-]+)\/(\d+)/g;
const MAP_MODULE_RE = /data-module='(\{.*?\})'/gs;
const OG_META_RE = /<meta[^>]*property=["']og:([^"']+)["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

function decodeHtmlEntities(text) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function extractMeta(html, key) {
  let match;
  const regex = new RegExp(`<meta[^>]*property=["']og:${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  match = regex.exec(html);
  if (match) return decodeHtmlEntities(match[1]);
  return null;
}

function findUrlInText(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^")\s'<>]+/i);
  return match ? match[0] : null;
}

function extractNaverBlogPlaces(html) {
  const title = extractMeta(html, 'title') || '';
  const description = extractMeta(html, 'description') || '';
  const places = [];
  for (const match of html.matchAll(MAP_MODULE_RE)) {
    const raw = decodeHtmlEntities(match[1]);
    try {
      const obj = JSON.parse(raw);
      const dataPlaces = obj?.data?.places || [];
      if (Array.isArray(dataPlaces)) {
        for (const place of dataPlaces) {
          if (!place?.name) continue;
          places.push({
            name: place.name,
            address: place.address || '',
            tel: place.tel || null,
            lat: typeof place?.latlng?.latitude === 'number' ? place.latlng.latitude : null,
            lng: typeof place?.latlng?.longitude === 'number' ? place.latlng.longitude : null,
            place_id: place.placeId || null,
            menu: null,
            // review는 사람이 직접 방송 본문을 읽고 채우는 필드다. 블로그 글 하나의
            // og:description(페이지 전체 요약)을 그 글에서 찾은 모든 식당에 똑같이
            // 넣으면 식당별 한줄평이 아니라 무관한 페이지 요약이 그대로 노출되므로
            // (실측: "오늘 방송된 백반기행의 제목입니다..." 같은 문구가 리뷰로 저장된 사고)
            // 여기서는 자동으로 채우지 않는다. 페이지 요약 자체는 description으로 반환한다.
            review: null,
          });
        }
      }
    } catch (error) {
      continue;
    }
  }
  return { title, description, places };
}

function extractTvChosunBroadcast(html, detailUrl) {
  const metaTitle = extractMeta(html, 'title') || '';
  const titMatch = html.match(/<h3[^>]*class=["']tit["'][^>]*>([\s\S]*?)<\/h3>/i);
  const rawTitle = titMatch ? titMatch[1].replace(/<[^>]+>/g, '').trim() : metaTitle;
  
  const description = extractMeta(html, 'description') || '';
  const thumbnail = extractMeta(html, 'image') || null;
  const bodyMatch = html.match(/<div[^>]*class=["']cont-box["'][\s\S]*?<\/div>/i);
  const bodyHtml = bodyMatch ? bodyMatch[0].replace(/src=["']http:\/\//g, 'src="https://') : null;
  
  // 날짜 추출
  const dateMatch = html.match(/<div[^>]*class=["']info["'][^>]*>[\s\S]*?<span>(\d{4}\.\d{2}\.\d{2})<\/span>/i);
  let airDate = dateMatch ? dateMatch[1].trim() : null;
  if (airDate) {
    airDate = airDate.replace(/\./g, '-');
  }
  
  // 회차 번호 추출
  const epMatch = rawTitle.match(/^(\d{1,4})\s*회\s*(.*?)\s*$/);
  const episode = epMatch ? Number(epMatch[1]) : null;
  const title = epMatch ? epMatch[2].trim() : rawTitle;

  // 지역 추정
  let region = null;
  if (title) {
    const regMatch = title.match(/!\s*(.+?)\s*밥상/);
    if (regMatch) region = regMatch[1].trim();
    else {
      const regMatch2 = title.match(/(.+?)\s*밥상/);
      if (regMatch2) region = regMatch2[1].trim();
    }
  }

  return {
    episode,
    title,
    raw_title: rawTitle,
    air_date: airDate,
    region,
    thumbnail,
    detail_url: detailUrl,
    body_html: bodyHtml,
    description,
  };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return await response.text();
}

async function searchNaverBlogCandidates(query, limit = 6) {
  if (!query) return [];
  const url = `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  const seen = new Set();
  const candidates = [];
  for (const match of html.matchAll(BLOG_LINK_RE)) {
    const key = `${match[1]}/${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ blogId: match[1], logNo: match[2], url: `https://blog.naver.com/${match[1]}/${match[2]}` });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

async function fetchNaverBlogPost(blogId, logNo) {
  const url = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(logNo)}`;
  const html = await fetchText(url);
  const { title, places } = extractNaverBlogPlaces(html);
  return { title, places, source_url: url };
}

// crawler/naver_place.py와 동일한 불용어 — 회차 제목에서 키워드를 뽑을 때 이 흔한 단어들은 제외한다.
const STOPWORDS = new Set(['백반기행', '허영만', '식객', '밥상', '나들이', '특집', '맛집', '기행', '여행']);
const EPISODE_NUM_RE = /(\d{1,4})\s*회/g;

function extractKeywords(episodeTitle) {
  const tokens = String(episodeTitle || '').match(/[가-힣]{2,}/g) || [];
  return tokens.filter((t) => !STOPWORDS.has(t));
}

// 블로그 글 제목이 실제로 이 회차를 다루는지 확인한다(crawler/naver_place.py의 title_matches_episode 이식).
// 제목에 회차번호가 있으면 "44회"가 "344회"에 부분 문자열로 오매칭되지 않도록 정규식으로 전체 숫자를 비교하고,
// 번호가 맞아도 방송 제목 키워드가 하나도 안 겹치면(블로거가 번호를 잘못 적은 경우) 버린다.
// 번호 언급이 없으면 키워드 겹침만으로 판단한다.
function titleMatchesEpisode(postTitle, episode, keywords) {
  if (!postTitle || !postTitle.includes('백반기행')) return false;
  const mentioned = [...postTitle.matchAll(EPISODE_NUM_RE)].map((m) => Number(m[1]));
  if (mentioned.length) {
    if (episode != null && !mentioned.includes(episode)) return false;
    if (keywords.length && !keywords.some((kw) => postTitle.includes(kw))) return false;
    return true;
  }
  return keywords.length ? keywords.some((kw) => postTitle.includes(kw)) : false;
}

// 찾아낸 식당 주소의 시/도가 전부 예상 지역과 다르면 오매칭으로 간주한다(region_conflicts 이식).
// 주소가 하나라도 예상 시/도와 일치하면 통과, 주소 정보가 아예 없으면 판단 보류(false).
function regionConflicts(places, expectedSido) {
  if (!expectedSido || !places || !places.length) return false;
  const addrSidos = places.map((p) => (p.address || '').split(' ')[0]).filter(Boolean);
  if (!addrSidos.length) return false;
  return !addrSidos.includes(expectedSido);
}

// query로 검색한 블로그 후보 중, (있다면) 회차/제목/지역 조건을 만족하고 이미 다른 회차가 채택하지 않은
// 첫 후보를 채택한다. episode/episodeTitle/expectedSido가 없으면 해당 검증은 건너뛴다(하위 호환).
async function findFirstNaverBlogPlaces(query, options = {}) {
  const {
    candidateLimit = 6,
    episode = null,
    episodeTitle = null,
    expectedSido = null,
    excludeSourceKeys = new Set(),
    excludePlaceIds = new Set(),
  } = options;
  const keywords = episodeTitle ? extractKeywords(episodeTitle) : [];

  const candidates = await searchNaverBlogCandidates(query, candidateLimit);
  for (const candidate of candidates) {
    const sourceKey = `${candidate.blogId}/${candidate.logNo}`;
    if (excludeSourceKeys.has(sourceKey)) continue;
    try {
      const result = await fetchNaverBlogPost(candidate.blogId, candidate.logNo);
      if (!result.places.length) continue;
      if ((episode != null || keywords.length) && !titleMatchesEpisode(result.title, episode, keywords)) continue;
      if (regionConflicts(result.places, expectedSido)) continue;
      const candidatePlaceIds = result.places.map((p) => p.place_id).filter(Boolean);
      if (candidatePlaceIds.some((id) => excludePlaceIds.has(id))) continue;
      return { ...result, candidate_urls: candidates.map((item) => item.url) };
    } catch (error) {
      continue;
    }
  }
  return { title: '', places: [], source_url: null, candidate_urls: candidates.map((item) => item.url) };
}

module.exports = {
  findUrlInText,
  extractNaverBlogPlaces,
  extractTvChosunBroadcast,
  fetchText,
  searchNaverBlogCandidates,
  fetchNaverBlogPost,
  findFirstNaverBlogPlaces,
  extractKeywords,
  titleMatchesEpisode,
  regionConflicts,
};
