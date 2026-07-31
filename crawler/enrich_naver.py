# 네이버 블로그에서 회차별 방문 식당(상호명/주소/좌표) 정보를 찾아 seed/episodes.json에 채워 넣는 스크립트
import json
import re
import time
from pathlib import Path

import requests

from naver_place import find_restaurants_for_episode

SEED_PATH = Path(__file__).resolve().parent.parent / "seed" / "episodes.json"
EPISODE_SLEEP_SEC = 1.5
BLOG_URL_RE = re.compile(r"blog\.naver\.com/([\w\-]+)/(\d+)")


def main():
    with SEED_PATH.open("r", encoding="utf-8") as f:
        episodes = json.load(f)

    episodes.sort(key=lambda e: -(e["episode"] or 0))
    session = requests.Session()
    found = 0

    # 이미 다른 회차가 채택한 블로그 글/식당은 재사용하지 못하게 미리 등록해둔다.
    used_sources: set[tuple[str, str]] = set()
    used_place_ids: set[str] = set()
    for ep in episodes:
        m = BLOG_URL_RE.search(ep.get("restaurants_source_url") or "")
        if m:
            used_sources.add(m.groups())
        for r in ep.get("restaurants") or []:
            if r.get("place_id"):
                used_place_ids.add(r["place_id"])

    for i, ep in enumerate(episodes, 1):
        if ep.get("restaurants"):
            # 이미 식당 정보가 있는 회차는 건드리지 않는다 (관리자가 직접 수정했을 수도 있음).
            found += 1
            continue
        places, source_url = find_restaurants_for_episode(
            ep["episode"],
            ep.get("title") or "",
            session,
            expected_region=ep.get("region"),
            candidate_limit=10,
            used_sources=used_sources,
            used_place_ids=used_place_ids,
        )
        ep["restaurants"] = places
        ep["restaurants_source_url"] = source_url
        ep["verified"] = False
        ep.pop("restaurant_name", None)  # restaurants 배열로 대체된 예전 단일 필드 정리
        if places:
            found += 1

        if i % 20 == 0 or i == len(episodes):
            print(f"진행: {i}/{len(episodes)} (식당 정보 확보 {found}건)")
            with SEED_PATH.open("w", encoding="utf-8") as f:
                json.dump(episodes, f, ensure_ascii=False, indent=2)

        time.sleep(EPISODE_SLEEP_SEC)

    with SEED_PATH.open("w", encoding="utf-8") as f:
        json.dump(episodes, f, ensure_ascii=False, indent=2)

    print(f"\n총 {len(episodes)}건 중 식당 정보 확보 {found}건 ({found * 100 // len(episodes)}%)")


if __name__ == "__main__":
    main()
