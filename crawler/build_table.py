# seed/episodes.json + review_chunk_*.json(메뉴/한줄평)을 합쳐 public/data/table.json 생성
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "seed" / "episodes.json"
OUT_PATH = ROOT / "public" / "data" / "table.json"
REVIEW_CHUNKS = sorted((ROOT / "crawler").glob("review_chunk_*.json"))

# 해외 특집(캐나다/홍콩/일본 등) 주소는 "시도 시군구 상세주소" 형식이 아니라서
# 앞 2토큰을 그대로 시도/시군구로 잘라내면 깨진 값이 나온다. 알려진 국내 시도명만 허용.
KNOWN_SIDO = {
    "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
    "대전광역시", "울산광역시", "세종특별자치시",
    "경기도", "강원도", "강원특별자치도",
    "충청북도", "충청남도", "전라북도", "전북특별자치도", "전라남도",
    "경상북도", "경상남도", "제주특별자치도", "제주도",
}


def split_address(addr: str) -> tuple[str, str, str]:
    """'서울특별시 강동구 성내로 52 성원빌딩' -> (시도, 시군구, 상세주소)
    국내 시도명이 아니면(해외 주소 등) 분리하지 않고 원문 전체를 상세주소로 둔다."""
    if not addr:
        return "", "", ""
    parts = addr.split(" ", 2)
    sido = parts[0] if len(parts) > 0 else ""
    if sido not in KNOWN_SIDO:
        return "", "", addr
    sigungu = parts[1] if len(parts) > 1 else ""
    detail = parts[2] if len(parts) > 2 else ""
    return sido, sigungu, detail


def split_region(region: str) -> tuple[str, str]:
    """'서울특별시 강동구' -> (시도, 시군구)"""
    if not region:
        return "", ""
    parts = region.split(" ", 1)
    sido = parts[0]
    if sido not in KNOWN_SIDO:
        return "", ""
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
                        "address": r.get("address") or "",
                        "place_id": r.get("place_id"),
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
                    "address": "",
                    "place_id": None,
                }
            )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    matched = sum(1 for r in rows if r["menu"] or r["review"])
    print(f"총 {len(rows)}행 생성 ({len(episodes)}개 회차). 메뉴/한줄평 채워진 행: {matched}")


if __name__ == "__main__":
    main()
