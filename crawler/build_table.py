# seed/episodes.json + review_chunk_*.json(메뉴/한줄평)을 합쳐 public/data/table.json 생성
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "seed" / "episodes.json"
OUT_PATH = ROOT / "public" / "data" / "table.json"
REVIEW_CHUNKS = [ROOT / "crawler" / f"review_chunk_{i}.json" for i in range(1, 5)]


def split_address(addr: str) -> tuple[str, str, str]:
    """'서울특별시 강동구 성내로 52 성원빌딩' -> (시도, 시군구, 상세주소)"""
    if not addr:
        return "", "", ""
    parts = addr.split(" ", 2)
    sido = parts[0] if len(parts) > 0 else ""
    sigungu = parts[1] if len(parts) > 1 else ""
    detail = parts[2] if len(parts) > 2 else ""
    return sido, sigungu, detail


def split_region(region: str) -> tuple[str, str]:
    """'서울특별시 강동구' -> (시도, 시군구)"""
    if not region:
        return "", ""
    parts = region.split(" ", 1)
    sido = parts[0]
    sigungu = parts[1] if len(parts) > 1 else ""
    return sido, sigungu


def load_reviews() -> dict[tuple[int, str], dict]:
    lookup = {}
    for path in REVIEW_CHUNKS:
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8") as f:
            items = json.load(f)
        for item in items:
            lookup[(item["episode"], item["restaurant_name"])] = item
    return lookup


def main():
    with SEED_PATH.open("r", encoding="utf-8") as f:
        episodes = json.load(f)
    episodes.sort(key=lambda e: -(e["episode"] or 0))

    reviews = load_reviews()
    rows = []

    for ep in episodes:
        restaurants = ep.get("restaurants") or []
        if restaurants:
            for r in restaurants:
                sido, sigungu, detail = split_address(r.get("address") or "")
                rv = reviews.get((ep["episode"], r.get("name")), {})
                rows.append(
                    {
                        "episode": ep["episode"],
                        "restaurant_name": r.get("name") or "",
                        "menu": rv.get("menu") or "",
                        "review": rv.get("review") or "",
                        "sido": sido,
                        "sigungu": sigungu,
                        "detail_addr": detail,
                    }
                )
        else:
            sido, sigungu = split_region(ep.get("region") or "")
            rows.append(
                {
                    "episode": ep["episode"],
                    "restaurant_name": "",
                    "menu": "",
                    "review": "",
                    "sido": sido,
                    "sigungu": sigungu,
                    "detail_addr": "",
                }
            )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    matched = sum(1 for r in rows if r["menu"] or r["review"])
    print(f"총 {len(rows)}행 생성 ({len(episodes)}개 회차). 메뉴/한줄평 채워진 행: {matched}")


if __name__ == "__main__":
    main()
