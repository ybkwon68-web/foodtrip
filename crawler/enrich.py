# seed/episodes.json에 지역 추정치(사전 매칭)와 편집용 빈 필드를 채워 넣는 스크립트
import json
from pathlib import Path

from regions import guess_region

SEED_PATH = Path(__file__).resolve().parent.parent / "seed" / "episodes.json"


def main():
    with SEED_PATH.open("r", encoding="utf-8") as f:
        episodes = json.load(f)

    # 제목만으로 매칭한다. 본문 전체를 함께 검색하면 "보여주는"처럼 지명과 무관한
    # 단어에 지명 글자가 우연히 포함되는 오탐(false positive)이 많아 정확도가 크게 떨어짐 확인됨.
    guessed = 0
    for ep in episodes:
        region = guess_region(ep.get("title"))
        ep["region"] = region
        ep["restaurant_name"] = None
        ep["verified"] = False
        if region:
            guessed += 1

    with SEED_PATH.open("w", encoding="utf-8") as f:
        json.dump(episodes, f, ensure_ascii=False, indent=2)

    print(f"총 {len(episodes)}건 중 지역 추정 성공 {guessed}건, 실패(미확인) {len(episodes) - guessed}건")


if __name__ == "__main__":
    main()
