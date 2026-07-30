# seed/episodes.json을 Supabase episodes 테이블에 최초 적재(upsert)하는 스크립트
# 실행 전 환경변수 필요: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import json
import os
from pathlib import Path

import requests

SEED_PATH = Path(__file__).resolve().parent.parent / "seed" / "episodes.json"
BATCH_SIZE = 50


def main():
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise SystemExit(
            "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수를 먼저 설정하세요.\n"
            "예) SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxxx python seed_supabase.py"
        )

    with SEED_PATH.open("r", encoding="utf-8") as f:
        episodes = json.load(f)

    rows = [
        {
            "episode": e["episode"],
            "title": e.get("title"),
            "raw_title": e.get("raw_title"),
            "air_date": e.get("air_date"),
            "thumbnail": e.get("thumbnail"),
            "detail_url": e.get("detail_url"),
            "body_html": e.get("body_html"),
            "region": e.get("region"),
            "restaurants": e.get("restaurants") or [],
            "restaurants_source_url": e.get("restaurants_source_url"),
            "verified": e.get("verified", False),
        }
        for e in episodes
    ]

    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/episodes"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    total = len(rows)
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        resp = requests.post(endpoint, headers=headers, json=batch, timeout=30)
        if resp.status_code >= 300:
            raise SystemExit(f"업로드 실패 ({i}~{i+len(batch)}): {resp.status_code} {resp.text[:500]}")
        print(f"업로드 진행: {min(i+BATCH_SIZE, total)}/{total}")

    print(f"완료: 총 {total}개 회차를 Supabase에 적재했습니다.")


if __name__ == "__main__":
    main()
