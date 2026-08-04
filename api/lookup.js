// 방송국/네이버 블로그 검색 기반 자동 수집 API
const { extractTvChosunBroadcast, findUrlInText, findFirstNaverBlogPlaces, fetchNaverBlogPost } = require('../lib/lookup');
const { findRegionInText } = require('../lib/koreanRegions');
const { getSupabase } = require('../lib/supabase');

const NAVER_BLOG_URL_RE = /blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d+)/;

// 이미 다른 회차가 채택한 네이버 블로그 글(source)과 식당(place_id)을 DB 전체에서 조회한다.
// 같은 블로그 글이나 같은 식당이 서로 다른 회차에 중복 채택되는 걸 막기 위한 전역 가드.
// 실패해도(DB 연결 문제 등) 조회 자체를 막지 않도록 fail-open으로 빈 목록을 반환한다.
async function loadUsedNaverSources(excludeEpisode) {
  const sourceKeys = new Set();
  const placeIds = new Set();
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('episodes').select('episode,restaurants,restaurants_source_url');
    if (error || !data) return { sourceKeys, placeIds };
    for (const ep of data) {
      if (excludeEpisode != null && ep.episode === excludeEpisode) continue;
      const match = NAVER_BLOG_URL_RE.exec(ep.restaurants_source_url || '');
      if (match) sourceKeys.add(`${match[1]}/${match[2]}`);
      for (const r of ep.restaurants || []) {
        if (r.place_id) placeIds.add(r.place_id);
      }
    }
  } catch (err) {
    // Supabase 미설정 등으로 조회 실패 시 중복 검증 없이 진행(기존 동작 유지)
  }
  return { sourceKeys, placeIds };
}

const TVCHOSUN_BASE = 'https://broadcast.tvchosun.com';
const LIST_URL = `${TVCHOSUN_BASE}/broadcast/program/3/C201900033/bbs/8667/C201900033_10/list.cstv`;
const EP_TITLE_RE = /(\d{1,4})\s*회\s*(.*?)\s*$/;
const LINK_ITEM_RE = /<a[^>]+class=["'][^"']*vd-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
const TITLE_FIELD_RE = /<p[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/p>/i;
const DATE_FIELD_RE = /<p[^>]*class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/p>/i;

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, '').trim();
}

function buildAbsoluteUrl(href) {
  try {
    return new URL(href, TVCHOSUN_BASE).toString();
  } catch {
    return href;
  }
}

function parseTvChosunList(html) {
  const entries = [];
  let match;
  while ((match = LINK_ITEM_RE.exec(html))) {
    const fullTag = match[0];
    const content = match[1];
    const hrefMatch = fullTag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const detailHref = hrefMatch[1];

    const titleMatch = TITLE_FIELD_RE.exec(content);
    if (!titleMatch) continue;
    const rawTitle = stripTags(decodeHtmlEntities(titleMatch[1]));
    const metadata = EP_TITLE_RE.exec(rawTitle);
    const episode = metadata ? Number(metadata[1]) : null;
    const title = metadata ? metadata[2].trim() : rawTitle;
    const dateMatch = DATE_FIELD_RE.exec(content);
    const airDate = dateMatch ? stripTags(decodeHtmlEntities(dateMatch[1])) : null;
    entries.push({
      episode,
      title,
      raw_title: rawTitle,
      air_date: airDate,
      detail_url: buildAbsoluteUrl(detailHref),
    });
  }
  return entries;
}

function normalizeQuery(query) {
  return String(query || '').trim();
}

function numericEpisode(query) {
  const num = Number(String(query).trim().replace(/[^0-9]/g, ''));
  return Number.isInteger(num) && num > 0 ? num : null;
}

// 숫자 회차 검색이 아닌, 자유 텍스트 검색에서만 쓰는 느슨한 부분일치 폴백.
// (숫자 회차 검색은 searchTvChosun에서 정확한 회차번호 일치만 신뢰하고 이 함수를 타지 않는다.)
function matchesTvChosunItem(item, query) {
  if (!query) return false;
  const raw = String(query).trim().toLowerCase();
  const haystack = [item.title, item.raw_title, item.air_date].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(raw);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }
  return await response.text();
}

async function searchTvChosun(query, maxPages = 6) {
  const expectedEpisode = numericEpisode(query);
  const searchText = expectedEpisode ? `${expectedEpisode}회` : query;
  for (let page = 1; page <= maxPages; page += 1) {
    const html = await fetchText(`${LIST_URL}?search_text=${encodeURIComponent(searchText)}&pg=${page}`);
    const entries = parseTvChosunList(html);
    if (!entries.length) continue;
    if (expectedEpisode) {
      // 숫자 회차 검색은 정확히 일치하는 회차번호만 신뢰한다. 부분일치 폴백을 허용하면
      // 다른 회차의 제목·방송일 문자열에 그 숫자가 우연히 포함된 경우 오매칭될 수 있다
      // (예: "44" 검색이 "344회" 항목이나 날짜 문자열에 우연히 걸리는 경우).
      const exact = entries.find((entry) => entry.episode === expectedEpisode);
      if (exact) return exact;
      continue;
    }
    const fuzzy = entries.find((entry) => matchesTvChosunItem(entry, query));
    if (fuzzy) return fuzzy;
  }
  return null;
}

async function lookupReferenceUrl(referenceUrl) {
  const normalized = normalizeQuery(referenceUrl);
  if (!normalized) return null;
  if (/blog\.naver\.com\//i.test(normalized)) {
    const match = normalized.match(/blog\.naver\.com\/([a-zA-Z0-9_\-]+)\/(\d+)/i);
    if (!match) return null;
    const blogId = match[1];
    const logNo = match[2];
    const result = await fetchNaverBlogPost(blogId, logNo);
    return {
      source: 'naver_blog',
      source_url: result.source_url,
      title: result.title,
      restaurants: result.places,
    };
  }

  if (/broadcast\.tvchosun\.com\//i.test(normalized)) {
    const html = await fetchText(normalized);
    const broadcast = extractTvChosunBroadcast(html, normalized);
    return { source: 'tvchosun_detail', broadcast };
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 허용됩니다.' });
    return;
  }

  const body = req.body || {};
  const query = normalizeQuery(body.query || '');
  const referenceUrl = normalizeQuery(body.reference_url || '');
  if (!query && !referenceUrl) {
    res.status(400).json({ error: '검색어 또는 참고 URL을 입력해주세요.' });
    return;
  }

  try {
    let broadcast = null;
    let restaurants = [];
    let source_url = null;
    let source = null;
    let candidateUrls = [];

    if (referenceUrl) {
      const refResult = await lookupReferenceUrl(referenceUrl);
      if (refResult) {
        source = refResult.source;
        source_url = refResult.source_url || referenceUrl;
        if (refResult.broadcast) {
          broadcast = refResult.broadcast;
        }
        if (Array.isArray(refResult.restaurants)) {
          restaurants = refResult.restaurants;
        }
      }
    }

    if (!broadcast && query) {
      const foundItem = await searchTvChosun(query, 6);
      if (foundItem) {
        source = source || 'tvchosun_search';
        source_url = source_url || foundItem.detail_url;
        const html = await fetchText(foundItem.detail_url);
        const detailBroadcast = extractTvChosunBroadcast(html, foundItem.detail_url);
        broadcast = {
          episode: foundItem.episode || detailBroadcast.episode,
          title: foundItem.title || detailBroadcast.title,
          raw_title: foundItem.raw_title || detailBroadcast.raw_title,
          air_date: foundItem.air_date ? foundItem.air_date.replace(/\./g, '-') : detailBroadcast.air_date,
          region: foundItem.region || detailBroadcast.region,
          thumbnail: detailBroadcast.thumbnail || null,
          detail_url: foundItem.detail_url,
          body_html: detailBroadcast.body_html,
        };
      }
    }

    if ((!restaurants || !restaurants.length) && query) {
      const lookupQuery = numericEpisode(query)
        ? `허영만의 백반기행 ${numericEpisode(query)}회`
        : `${query} 백반기행`;

      const targetEpisode = broadcast?.episode ?? numericEpisode(query);
      const episodeTitleText = [broadcast?.raw_title, broadcast?.title, broadcast?.region].filter(Boolean).join(' ');
      const expectedRegion = episodeTitleText ? findRegionInText(episodeTitleText) : null;
      const expectedSido = expectedRegion ? expectedRegion.split(' ')[0] : null;
      const { sourceKeys, placeIds } = await loadUsedNaverSources(targetEpisode);

      const naverResult = await findFirstNaverBlogPlaces(lookupQuery, {
        candidateLimit: 6,
        episode: targetEpisode,
        episodeTitle: episodeTitleText || broadcast?.title || null,
        expectedSido,
        excludeSourceKeys: sourceKeys,
        excludePlaceIds: placeIds,
      });
      if (naverResult && Array.isArray(naverResult.places) && naverResult.places.length) {
        restaurants = naverResult.places;
        candidateUrls = naverResult.candidate_urls || [];
        if (!source_url) {
          source = 'naver_search';
          source_url = naverResult.source_url;
        }
      }
    }

    if (!broadcast && !restaurants) {
      res.status(404).json({ error: '관련 정보를 찾을 수 없습니다.', source, candidateUrls });
      return;
    }

    res.status(200).json({
      found: true,
      source,
      source_url,
      broadcast,
      restaurants,
      candidate_urls: candidateUrls,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
