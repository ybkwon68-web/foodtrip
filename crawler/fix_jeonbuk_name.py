# 2024년 행정구역 개편으로 "전라북도"가 "전북특별자치도"로 바뀐 것을 반영하는 1회성 스크립트
# seed/episodes.json과 Supabase 양쪽의 식당 주소 필드만 교체(본문 텍스트는 원문 그대로 둠)
import json
import os
from pathlib import Path

import requests

SEED_PATH = Path(__file__).resolve().parent.parent / "seed" / "episodes.json"
OLD = "전라북도"
NEW = "전북특별자치도"


def fix_seed():
    with SEED_PATH.open("r", encoding="utf-8") as f:
        episodes = json.load(f)

    changed = 0
    for ep in episodes:
        for r in ep.get("restaurants") or []:
            addr = r.get("address") or ""
            if addr.startswith(OLD):
                r["address"] = NEW + addr[len(OLD):]
                changed += 1

    with SEED_PATH.open("w", encoding="utf-8") as f:
        json.dump(episodes, f, ensure_ascii=False, indent=2)

    print(f"seed/episodes.json: {changed}개 식당 주소 수정")


def fix_supabase():
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise SystemExit("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수를 먼저 설정하세요.")

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/episodes"

    resp = requests.get(f"{endpoint}?select=episode,restaurants", headers=headers, timeout=30)
    resp.raise_for_status()
    episodes = resp.json()

    changed_episodes = 0
    changed_restaurants = 0

    for ep in episodes:
        restaurants = ep.get("restaurants") or []
        changed = False
        for r in restaurants:
            addr = r.get("address") or ""
            if addr.startswith(OLD):
                r["address"] = NEW + addr[len(OLD):]
                changed = True
                changed_restaurants += 1

        if changed:
            patch_resp = requests.patch(
                f"{endpoint}?episode=eq.{ep['episode']}",
                headers=headers,
                json={"restaurants": restaurants},
                timeout=30,
            )
            patch_resp.raise_for_status()
            changed_episodes += 1
            print(f"{ep['episode']}회 Supabase 갱신 완료")

    print(f"Supabase: {changed_episodes}개 회차, {changed_restaurants}개 식당 주소 수정")


if __name__ == "__main__":
    fix_seed()
    fix_supabase()
