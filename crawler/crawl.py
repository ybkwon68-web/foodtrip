# TV조선 "식객 허영만의 백반기행" 백반일기 게시판을 크롤링해 seed/episodes.json으로 저장하는 스크립트
import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://broadcast.tvchosun.com"
LIST_URL = f"{BASE}/broadcast/program/3/C201900033/bbs/8667/C201900033_10/list.cstv"
LAST_PAGE = 18
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}
SLEEP_SEC = 1
OUT_PATH = Path(__file__).resolve().parent.parent / "seed" / "episodes.json"

EP_TITLE_RE = re.compile(r"^\s*(\d+)\s*회\s*(.*?)\s*$")
DATE_RE = re.compile(r"(\d{4})[.\-](\d{2})[.\-](\d{2})")


def normalize_url(src: str) -> str:
    if src.startswith("//"):
        return "https:" + src
    return urljoin(BASE, src)


def normalize_date(text: str) -> str | None:
    m = DATE_RE.search(text or "")
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"


def fetch_list_page(session: requests.Session, page: int) -> list[dict]:
    resp = session.get(LIST_URL, params={"search_text": "", "pg": page}, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    items = []
    for a in soup.select("ul.item-list.col-4.wrap > li > a.vd-link"):
        href = a.get("href", "").strip()
        if not href:
            continue
        raw_title = (a.select_one(".info-box p.title") or {}).get_text(strip=True) if a.select_one(".info-box p.title") else ""
        date_text = a.select_one(".info-box p.date")
        date_text = date_text.get_text(strip=True) if date_text else ""
        thumb = a.select_one(".thumb-box img")
        thumb_src = normalize_url(thumb["src"]) if thumb and thumb.get("src") else None

        m = EP_TITLE_RE.match(raw_title)
        episode = int(m.group(1)) if m else None
        title = m.group(2) if m else raw_title

        items.append(
            {
                "episode": episode,
                "title": title,
                "raw_title": raw_title,
                "air_date": normalize_date(date_text),
                "thumbnail": thumb_src,
                "detail_url": urljoin(BASE, href),
            }
        )
    return items


def fetch_detail(session: requests.Session, detail_url: str) -> str | None:
    resp = session.get(detail_url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    cont = soup.select_one(".board-view .cont-box")
    if not cont:
        return None
    # 배포 사이트가 https이므로 본문 내 http 이미지 URL은 mixed content로 차단됨 -> https로 통일
    for img in cont.select("img[src^='http://']"):
        img["src"] = "https://" + img["src"][len("http://"):]
    return str(cont)


def crawl() -> list[dict]:
    session = requests.Session()
    all_items: dict[int, dict] = {}

    for page in range(1, LAST_PAGE + 1):
        try:
            items = fetch_list_page(session, page)
        except requests.RequestException as e:
            print(f"[목록 {page}페이지] 요청 실패: {e}")
            continue

        if not items:
            print(f"[목록 {page}페이지] 항목 없음 (구조 변경 가능성) - 건너뜀")
            continue

        for item in items:
            key = item["episode"] if item["episode"] is not None else item["detail_url"]
            all_items[key] = item

        print(f"[목록 {page}페이지] {len(items)}건 수집")
        time.sleep(SLEEP_SEC)

    total = len(all_items)
    for i, (key, item) in enumerate(all_items.items(), 1):
        try:
            item["body_html"] = fetch_detail(session, item["detail_url"])
        except requests.RequestException as e:
            print(f"[상세 {item.get('episode')}회] 요청 실패: {e}")
            item["body_html"] = None

        if item["body_html"] is None:
            print(f"[상세 {item.get('episode')}회] 본문 추출 실패: {item['detail_url']}")

        if i % 20 == 0 or i == total:
            print(f"상세페이지 진행: {i}/{total}")
        time.sleep(SLEEP_SEC)

    return sorted(all_items.values(), key=lambda x: (x["episode"] is None, x["episode"]), reverse=True)


def main():
    episodes = crawl()

    missing_episode = [e for e in episodes if e["episode"] is None]
    missing_body = [e for e in episodes if not e.get("body_html")]
    print(f"\n총 {len(episodes)}건 수집 완료")
    print(f"회차번호 추출 실패: {len(missing_episode)}건")
    print(f"본문 추출 실패: {len(missing_body)}건")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(episodes, f, ensure_ascii=False, indent=2)
    print(f"저장 완료: {OUT_PATH}")


if __name__ == "__main__":
    main()
