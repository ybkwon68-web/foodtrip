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
            review: description || null,
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

async function findFirstNaverBlogPlaces(query, candidateLimit = 6) {
  const candidates = await searchNaverBlogCandidates(query, candidateLimit);
  for (const candidate of candidates) {
    try {
      const result = await fetchNaverBlogPost(candidate.blogId, candidate.logNo);
      if (result.places.length > 0) {
        return { ...result, candidate_urls: candidates.map((item) => item.url) };
      }
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
};
