# review_chunk_*.json(서브에이전트가 작성한 메뉴/한줄평)을 Supabase restaurants에 채워 넣는 1회성 백필 스크립트
# 실행 전 환경변수 필요: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# 안전장치: DB의 현재 값을 먼저 읽어와서, menu/review가 이미 채워진 항목은 건드리지 않는다.
import json
import os
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
REVIEW_CHUNKS = sorted((ROOT / "crawler").glob("review_chunk_*.json"))


def load_reviews() -> dict[tuple[int, str], dict]:
    lookup = {}
    for path in REVIEW_CHUNKS:
        with path.open("r", encoding="utf-8") as f:
            items = json.load(f)
        for item in items:
            lookup[(item["episode"], item["restaurant_name"])] = item
    return lookup


def main():
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise SystemExit("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수를 먼저 설정하세요.")

    reviews = load_reviews()
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/episodes"

    resp = requests.get(f"{endpoint}?select=episode,restaurants", headers=headers, timeout=30)
    resp.raise_for_status()
    episodes = resp.json()

    updated_episodes = 0
    updated_restaurants = 0

    for ep in episodes:
        restaurants = ep.get("restaurants") or []
        if not restaurants:
            continue
        changed = False
        for r in restaurants:
            rv = reviews.get((ep["episode"], r.get("name")))
            if not rv:
                continue
            if not r.get("menu") and rv.get("menu"):
                r["menu"] = rv["menu"]
                changed = True
                updated_restaurants += 1
            if not r.get("review") and rv.get("review"):
                r["review"] = rv["review"]
                changed = True

        if changed:
            patch_resp = requests.patch(
                f"{endpoint}?episode=eq.{ep['episode']}",
                headers=headers,
                json={"restaurants": restaurants},
                timeout=30,
            )
            patch_resp.raise_for_status()
            updated_episodes += 1
            print(f"{ep['episode']}회 갱신 완료")

    print(f"\n완료: {updated_episodes}개 회차, {updated_restaurants}개 식당에 메뉴/한줄평 채워넣음.")


if __name__ == "__main__":
    main()
