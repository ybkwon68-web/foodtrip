# 네이버 블로그 검색으로 회차별 방문 식당(상호명/주소/좌표) 후보를 찾는 스크립트
import html as ihtml
import json
import re
import time

import requests

CANDIDATE_SLEEP_SEC = 0.5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}

BLOG_LINK_RE = re.compile(r"blog\.naver\.com/([a-zA-Z0-9_\-]+)/(\d+)")
MAP_MODULE_RE = re.compile(r"data-module='(\{\"type\":\"v2_map\".*?\})'")


def search_blog_candidates(query: str, session: requests.Session, limit: int = 6) -> list[tuple[str, str]]:
    """네이버 블로그 검색 결과 페이지에서 (blogId, logNo) 후보 목록을 순서대로, 중복 없이 반환."""
    resp = session.get(
        "https://search.naver.com/search.naver",
        params={"where": "blog", "query": query},
        headers=HEADERS,
        timeout=15,
    )
    resp.raise_for_status()

    seen = set()
    candidates = []
    for m in BLOG_LINK_RE.finditer(resp.text):
        key = (m.group(1), m.group(2))
        if key in seen:
            continue
        seen.add(key)
        candidates.append(key)
        if len(candidates) >= limit:
            break
    return candidates


def fetch_post(blog_id: str, log_no: str, session: requests.Session) -> tuple[str, list[dict]]:
    """PostView.naver에서 og:title과 장소(v2_map) 위젯 목록을 추출."""
    resp = session.get(
        "https://blog.naver.com/PostView.naver",
        params={"blogId": blog_id, "logNo": log_no},
        headers=HEADERS,
        timeout=15,
    )
    resp.raise_for_status()
    content = resp.text

    title_m = re.search(r'<meta property="og:title" content="([^"]*)"', content)
    title = ihtml.unescape(title_m.group(1)) if title_m else ""

    places = []
    seen_ids = set()
    for m in MAP_MODULE_RE.finditer(content):
        raw = ihtml.unescape(m.group(1))
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        for pl in obj.get("data", {}).get("places", []):
            place_id = pl.get("placeId")
            if place_id in seen_ids:
                continue
            seen_ids.add(place_id)
            latlng = pl.get("latlng") or {}
            places.append(
                {
                    "name": pl.get("name"),
                    "address": pl.get("address"),
                    "tel": pl.get("tel") or None,
                    "lat": latlng.get("latitude"),
                    "lng": latlng.get("longitude"),
                    "place_id": place_id,
                }
            )
    return title, places


# 오래된 회차는 블로그 제목에 "OOO회"가 다시 언급되지 않는 경우가 많아, 방송 제목에 나온
# 지역/게스트 등 키워드가 겹치는지도 함께 확인한다 (실측: "200회 여의도 소풍 밥상" 사례에서
# "200회" 문자열은 없지만 "여의도"는 블로그 제목에 그대로 있었음).
STOPWORDS = {"백반기행", "허영만", "식객", "밥상", "나들이", "특집", "맛집", "기행", "여행"}


def extract_keywords(episode_title: str) -> list[str]:
    tokens = re.findall(r"[가-힣]{2,}", episode_title or "")
    return [t for t in tokens if t not in STOPWORDS]


EPISODE_NUM_RE = re.compile(r"(\d{1,4})회")


def title_matches_episode(post_title: str, episode: int, keywords: list[str]) -> bool:
    if "백반기행" not in post_title:
        return False
    mentioned = [int(n) for n in EPISODE_NUM_RE.findall(post_title)]
    if mentioned:
        # 제목에 회차 번호가 명시돼 있으면 그 번호로만 판단한다.
        # (예전엔 "44회" in "344회 ..." 처럼 부분 문자열로 오매칭되는 버그가 있었음 —
        # 정규식으로 전체 숫자를 추출해 비교하면 이 문제가 사라지고, 제목에 다른
        # 회차 번호가 명시된 경우 키워드가 겹치더라도 오매칭을 막을 수 있다.)
        if episode not in mentioned:
            return False
        # 번호가 맞아도 블로거가 회차 번호를 잘못 적었을 가능성이 있다(실측: 261회
        # 사례 — 실제로는 262회 내용인데 제목에 "261회"라고 적어놓음). 방송 공식
        # 제목의 키워드가 하나도 안 겹치면 이 매칭은 버린다.
        if keywords and not any(kw in post_title for kw in keywords):
            return False
        return True
    return any(kw in post_title for kw in keywords)


def region_conflicts(places: list[dict], expected_sido: str | None) -> bool:
    """식당 주소의 시/도가 전부 예상 지역과 다르면 오매칭으로 간주.

    실측 결과, 키워드 폴백 매칭이 "고향", "중심"처럼 흔한 단어로 완전히 무관한
    지역의 블로그(다른 회차와 동일한 글)를 잘못 채택하는 사례가 다수 발견됨
    (예: "대전 밥상" 129회가 "강원도 고성" 블로그와 매칭). 식당 주소 중 하나라도
    예상 시/도와 일치하면 통과시키고, 전부 다르면 이 매칭은 버린다.
    """
    if not expected_sido or not places:
        return False
    addrs_sido = [p["address"].split(" ")[0] for p in places if p.get("address")]
    if not addrs_sido:
        return False
    return expected_sido not in addrs_sido


def find_restaurants_for_episode(
    episode: int,
    episode_title: str,
    session: requests.Session,
    expected_region: str | None = None,
    candidate_limit: int = 6,
    used_sources: set[tuple[str, str]] | None = None,
    used_place_ids: set[str] | None = None,
) -> tuple[list[dict], str | None]:
    """회차 번호+제목으로 네이버 블로그를 검색해 장소 위젯이 있는 첫 후보를 채택.

    expected_region: regions.py로 추정한 "시도 시군구" 문자열(있으면). 식당 주소의
    시/도가 이와 전부 어긋나면 오매칭으로 보고 건너뛴다.
    used_sources: 이미 다른 회차가 채택한 (blogId, logNo) 집합. 같은 글이 서로 다른
    회차에 중복 채택되는 걸 막기 위한 전역 가드(과거 실측에서 발견된 재발 사례).
    used_place_ids: 이미 다른 회차가 채택한 식당 place_id 집합. 서로 다른 블로그 글이
    같은 식당을 언급해도(예: 유명 맛집이 여러 "지역 맛집 총정리" 글에 반복 등장) 그
    식당이 이미 다른 회차에 채택돼 있으면 이 매칭은 건너뛴다 — 회차 번호가 겹치는
    작은 지역명(예: "양평")에서 다른 회차의 식당을 잘못 채택하는 사례가 실측됨.

    반환값: (식당 목록, 근거 블로그 URL). 못 찾으면 ([], None).
    """
    keywords = extract_keywords(episode_title)
    expected_sido = expected_region.split(" ")[0] if expected_region else None
    query = f"허영만의 백반기행 {episode}회"
    try:
        candidates = search_blog_candidates(query, session, limit=candidate_limit)
    except requests.RequestException:
        return [], None

    for blog_id, log_no in candidates:
        if used_sources is not None and (blog_id, log_no) in used_sources:
            continue
        time.sleep(CANDIDATE_SLEEP_SEC)
        try:
            post_title, places = fetch_post(blog_id, log_no, session)
        except requests.RequestException:
            continue
        if not title_matches_episode(post_title, episode, keywords):
            continue
        if not places or region_conflicts(places, expected_sido):
            continue
        candidate_ids = {p["place_id"] for p in places if p.get("place_id")}
        if used_place_ids is not None and candidate_ids & used_place_ids:
            continue
        if used_sources is not None:
            used_sources.add((blog_id, log_no))
        if used_place_ids is not None:
            used_place_ids.update(candidate_ids)
        return places, f"https://blog.naver.com/{blog_id}/{log_no}"

    return [], None
