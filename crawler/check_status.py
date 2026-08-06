# 등록된 식당의 폐업/휴업/이전 의심 여부를 점검하는 스크립트 (수동 실행, --apply 없이는 dry-run)
#
# - place_id가 있는 식당(전체의 약 41%): 네이버 지도 모바일 place 페이지에서 도로명주소를 조회한다
#   (비공식 API, 스펙이 바뀌면 파싱이 깨질 수 있음). 페이지 안의 `businessStatusDescription.status`는
#   "영업 중"/"영업 종료"가 그날의 실시간 영업시간(예: "6시에 영업 시작")을 뜻할 뿐 폐업 여부와
#   무관함을 실측으로 확인함(새벽에 돌리면 대부분 "영업 종료"로 나와 오탐이 쏟아짐) — 그래서 폐업
#   판정에는 쓰지 않고 참고용 note에만 남긴다. 폐업 판정은 페이지 자체가 404거나(place_id 소멸)
#   핵심 데이터(도로명주소)를 아예 찾을 수 없을 때만 의심으로 본다.
# - place_id가 없는 식당(약 59%, 예: 169회 "모퉁이"): 카카오 로컬 키워드 검색(음식점 카테고리로
#   한정)으로 보조 확인한다. 이름+시군구가 정확히 일치하는 후보가 없으면 폐업 의심으로 본다(신뢰도
#   낮음 — 애초에 카카오에 없었을 수도 있음을 포함하는 약한 신호).
# - 좌표 기반 교차검증(check_kakao_nearby): place_id 유무와 무관하게, 저장된 위경도 근처(반경
#   50m)에 실제로 어떤 음식점이 있는지 카카오 카테고리 검색으로 역으로 확인한다. 이름 검색과 달리
#   "그 자리에 지금 뭐가 있는지"를 직접 보는 방식이라 훨씬 확실한 신호를 준다 — 169회 "모퉁이"
#   실측 사례에서 정확히 같은 좌표에 "그냥"이라는 다른 상호가 확인되어 폐업 후 업종이 바뀐 정황을
#   구체적으로 잡아낼 수 있었다.
# - 어떤 경우에도 기존 name/address/menu 등 필드는 건드리지 않는다. 판정은 항상 "의심"으로만
#   남기고, 최종 확정(실제 데이터 수정)은 관리자가 편집모드에서 직접 한다.
#
# 실행 전 환경변수 필요: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KAKAO_REST_API_KEY(선택, 없으면
# place_id 없는 식당은 건너뜀)
import argparse
import os
import re
import time
from datetime import datetime, timezone

import requests

NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
    ),
    "Referer": "https://m.place.naver.com/",
}
REQUEST_SLEEP_SEC = 0.8

STATUS_RE = re.compile(r'"businessStatusDescription":\{[^}]*?"status":"([^"]*)"')
ROAD_ADDRESS_RE = re.compile(r'"roadAddress":"([^"]*)"')

SIDO_ABBR = {
    "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
    "광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시",
    "경기": "경기도", "강원": "강원특별자치도",
    "충북": "충청북도", "충남": "충청남도",
    "전북": "전북특별자치도", "전남": "전라남도",
    "경북": "경상북도", "경남": "경상남도",
    "제주": "제주특별자치도",
}


def normalize_sido(addr):
    """네이버/카카오가 쓰는 시도 축약형("서울")을 저장된 정식 명칭("서울특별시")으로 맞춘다."""
    if not addr:
        return addr
    first, _, rest = addr.partition(" ")
    return SIDO_ABBR.get(first, first) + (" " + rest if rest else "")


def addresses_differ(stored, fetched):
    if not stored or not fetched:
        return False
    return normalize_sido(stored).replace(" ", "") != normalize_sido(fetched).replace(" ", "")


def check_naver_place(session, place_id):
    """place_id로 네이버 지도 모바일 place 페이지를 조회해 영업상태/도로명주소를 추출.
    반환: ok=False면 네트워크/파싱 실패로 이번엔 판정을 보류(다음 실행에 재시도)."""
    url = f"https://m.place.naver.com/restaurant/{place_id}/home"
    try:
        resp = session.get(url, headers=NAVER_HEADERS, timeout=15)
    except requests.RequestException:
        return {"ok": False}
    if resp.status_code == 404:
        return {"ok": True, "not_found": True, "status_text": None, "road_address": None}
    if not resp.ok:
        return {"ok": False}

    # 응답 헤더에 charset이 없으면 requests가 인코딩을 잘못 추측해(cp1252 등) 한글이 깨짐 —
    # 실측으로 확인된 문제라 명시적으로 utf-8을 지정한다.
    resp.encoding = "utf-8"
    status_matches = STATUS_RE.findall(resp.text)
    addr_matches = ROAD_ADDRESS_RE.findall(resp.text)
    # 페이지 구조가 예상과 다르게 여러 번(또는 0번) 매칭되면 어느 값이 진짜인지 확신할 수 없으니
    # 건너뛴다(잘못된 값을 판정에 쓰는 것보다 안전).
    status_text = status_matches[0] if len(status_matches) == 1 else None
    road_address = addr_matches[0] if len(addr_matches) == 1 else None
    return {"ok": True, "not_found": False, "status_text": status_text, "road_address": road_address}


def region_key(addr, tokens=2):
    """"강원특별자치도 화천군 ..." → "강원특별자치도 화천군"(시도+시군구까지만). 토큰이 부족하면 None."""
    if not addr:
        return None
    parts = normalize_sido(addr).split(" ")
    return " ".join(parts[:tokens]) if len(parts) >= tokens else None


def check_kakao(session, kakao_key, name, stored_region):
    """카카오 로컬 키워드 검색으로 이름+시군구가 일치하는 '음식점' 후보를 찾는다(보조, 신뢰도 낮음).

    category_group_code=FD6(음식점)로 서버 측 필터링을 반드시 걸어야 한다 — 필터 없이는 "모퉁이"
    같은 흔한 이름이 부동산 지명(마을 어귀 이름 등 완전히 무관한 카테고리)과 매칭되는 사고가
    실측으로 확인됨(169회 "모퉁이" 실제 폐업 케이스를 검증하다가 발견). 시도만으로는 "강원특별자치도
    화천군"과 "강원특별자치도 홍천군"처럼 같은 도의 다른 시군구를 구분 못해 시군구까지 비교한다.
    """
    try:
        resp = session.get(
            "https://dapi.kakao.com/v2/local/search/keyword.json",
            params={"query": name, "category_group_code": "FD6"},
            headers={"Authorization": f"KakaoAK {kakao_key}"},
            timeout=15,
        )
    except requests.RequestException:
        return {"ok": False}
    if not resp.ok:
        return {"ok": False}

    docs = resp.json().get("documents", [])
    exact = [d for d in docs if d.get("place_name") == name]
    if stored_region:
        exact = [d for d in exact if region_key(d.get("address_name", "")) == stored_region]
    # 후보가 정확히 1곳이어야 채택한다 — 0곳이면 못 찾은 것, 여러 곳이면 어느 쪽인지 애매해서
    # 둘 다 "확인 필요"로 넘긴다(임의로 하나를 고르지 않음).
    if len(exact) != 1:
        return {"ok": True, "matched": False, "road_address": None}
    cand = exact[0]
    return {"ok": True, "matched": True, "road_address": cand.get("road_address_name") or cand.get("address_name")}


NEARBY_RADIUS_M = 50


def check_kakao_nearby(session, kakao_key, lat, lng, name):
    """저장된 좌표 근처(반경 50m)의 음식점(FD6)을 카카오 카테고리 검색으로 역으로 조회한다.

    이름으로 찾는 방식과 달리 "그 자리에 지금 실제로 뭐가 있는지"를 직접 확인하는 방식이라 훨씬
    확실한 신호를 준다 — 169회 "모퉁이" 실측 사례에서, 정확히 같은 좌표(거리 0m)에 "그냥"이라는
    다른 상호가 확인되어 폐업 후 업종이 바뀐 정황을 place_id 없이도 구체적으로 잡아낼 수 있었다.
    place_id 유무와 무관하게 위경도만 있으면 항상 시도할 수 있는 별도의 교차검증 경로다.
    """
    try:
        resp = session.get(
            "https://dapi.kakao.com/v2/local/search/category.json",
            params={"category_group_code": "FD6", "x": lng, "y": lat, "radius": NEARBY_RADIUS_M, "sort": "distance"},
            headers={"Authorization": f"KakaoAK {kakao_key}"},
            timeout=15,
        )
    except requests.RequestException:
        return {"ok": False}
    if not resp.ok:
        return {"ok": False}

    docs = resp.json().get("documents", [])
    same_name = next((d for d in docs if d.get("place_name") == name), None)
    closest_other = next((d for d in docs if d.get("place_name") != name), None)
    return {"ok": True, "same_name_found": bool(same_name), "closest_other": closest_other}


def names_similar(a, b):
    """이름이 완전히 무관하지 않고 앞부분이 겹치면(예: "철뚝소머리집"↔"철뚝소머리국밥",
    "물레야소주방"↔"물레야다찌") 같은 업체의 표기 차이/리브랜딩으로 보고 "다른 업체로 바뀜"
    의심에서 제외한다 — 실측 표본(20곳)에서 이런 경우가 실제로 나와, 의심 배지를 최소화하라는
    사용자 요청에 따라 기준을 완화함. 완전히 다른 이름("모퉁이"↔"그냥")은 그대로 의심 처리된다.
    """
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    common_prefix_len = 0
    for ca, cb in zip(a, b):
        if ca != cb:
            break
        common_prefix_len += 1
    shorter_len = min(len(a), len(b))
    return shorter_len > 0 and common_prefix_len / shorter_len >= 0.5


# 좌표 교차검증(check_kakao_nearby) 결과를 1차 판정(status_check)에 반영한다.
# - 같은 이름(또는 표기만 다른 유사한 이름)이 좌표상으로도 확인되면, 1차 판정이 폐업 의심이었더라도
#   취소한다(이름 검색의 사각지대를 좌표로 보완 — "낙타민박"처럼 카테고리가 달라 이름 검색에 안
#   걸리는 경우, 또는 상호 표기만 살짝 다른 경우 등).
# - 완전히 다른 상호가 정확히 그 좌표에 있으면, place_id 유무와 상관없이 신뢰도 high로 격상하고
#   그 상호명을 근거로 명시한다 — 이름 검색 결과("찾지 못함")보다 훨씬 구체적이고 확실한 증거다.
def refine_with_nearby(status_check, nearby, name):
    if not nearby.get("ok"):
        return status_check
    other = nearby.get("closest_other")
    similar_other = other and names_similar(name, other.get("place_name") or "")
    if nearby["same_name_found"] or similar_other:
        if status_check["closure_suspected"]:
            status_check["closure_suspected"] = False
            reason = (
                "같은 이름의 업체가 확인되어"
                if nearby["same_name_found"]
                else f'비슷한 이름의 업체("{other.get("place_name")}")가 확인되어'
            )
            status_check["note"] += f" (좌표 기준 교차검증에서 {reason} 폐업 의심을 취소함)"
        return status_check
    if other:
        other_name = other.get("place_name")
        status_check["closure_suspected"] = True
        status_check["confidence"] = "high"
        status_check["source"] = f"{status_check['source']}+kakao_coordinate"
        status_check["note"] = f'해당 위치(좌표)에서 다른 업체("{other_name}")가 영업 중으로 확인됨 — 폐업 후 업종/상호가 바뀐 것으로 보입니다.'
    return status_check


def build_status_check(closure_suspected, moved_suspected, source, confidence, note, candidate_address=None):
    sc = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "confidence": confidence,
        "closure_suspected": closure_suspected,
        "moved_suspected": moved_suspected,
        "note": note,
    }
    if moved_suspected and candidate_address:
        sc["candidate_address"] = candidate_address
    return sc


def fetch_episodes(supabase_url, service_key, episode=None, from_episode=None, to_episode=None):
    params = {"select": "episode,restaurants", "order": "episode.asc"}
    if episode:
        params["episode"] = f"eq.{episode}"
    else:
        # PostgREST는 같은 컬럼에 조건을 여러 개 걸 때 배열 파라미터(and=(...))로 묶어야 한다.
        conds = []
        if from_episode is not None:
            conds.append(f"episode.gte.{from_episode}")
        if to_episode is not None:
            conds.append(f"episode.lte.{to_episode}")
        if conds:
            params["and"] = f"({','.join(conds)})"
    resp = requests.get(
        f"{supabase_url.rstrip('/')}/rest/v1/episodes",
        params=params,
        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def update_episode_restaurants(supabase_url, service_key, episode, restaurants):
    resp = requests.patch(
        f"{supabase_url.rstrip('/')}/rest/v1/episodes",
        params={"episode": f"eq.{episode}"},
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json={"restaurants": restaurants},
        timeout=30,
    )
    resp.raise_for_status()


def check_one(session, kakao_key, restaurant):
    """식당 1곳을 점검해 status_check 딕셔너리를 반환. 판정을 보류해야 하면 None."""
    name = restaurant.get("name")
    address = restaurant.get("address") or ""
    stored_region = region_key(address)
    lat, lng = restaurant.get("lat"), restaurant.get("lng")
    has_coords = isinstance(lat, (int, float)) and isinstance(lng, (int, float))

    if restaurant.get("place_id"):
        result = check_naver_place(session, restaurant["place_id"])
        if not result["ok"]:
            print(f"  [스킵] {name}: 네이버 조회 실패(네트워크/오류), 다음 실행에 재시도")
            return None
        if result["not_found"]:
            status_check = build_status_check(True, False, "naver_place_id", "high", "place_id 페이지를 찾을 수 없음(404)")
        else:
            # businessStatusDescription.status(영업 중/영업 종료)는 그날의 실시간 영업시간일 뿐 폐업
            # 여부와 무관함이 실측으로 확인돼(예: "6시에 영업 시작" 문구 동반) 폐업 판정에 쓰지 않는다.
            # 도로명주소를 아예 찾을 수 없는 경우만 페이지 자체가 정상이 아니라고 보고 의심 처리한다.
            if result["road_address"] is None:
                print(f"  [스킵] {name}: 도로명주소 파싱 실패, 다음 실행에 재시도")
                return None
            moved = addresses_differ(address, result["road_address"])
            note = f"영업상태 문구(참고용, 폐업 판정에 미사용): {result['status_text']}" if result["status_text"] else "정상 조회됨"
            status_check = build_status_check(False, moved, "naver_place_id", "high", note, candidate_address=result["road_address"])
    else:
        if not kakao_key:
            return None
        result = check_kakao(session, kakao_key, name, stored_region)
        if not result["ok"]:
            print(f"  [스킵] {name}: 카카오 조회 실패, 다음 실행에 재시도")
            return None
        moved = result["matched"] and addresses_differ(address, result["road_address"])
        # 169회 "낙타민박" 실측 사례: 카카오에 이름만으로 검색해도 0건이었지만 실제로는 네이버지도에
        # 정상 등록돼 있는 곳이었음 — "카카오 미등록"은 폐업보다 "원래 카카오 커버리지 밖"인 경우가
        # 더 흔한 약한 신호이므로, 그 사실을 문구에서 분명히 하고 다른 지도에서 직접 확인하도록 안내한다.
        note = (
            "카카오 검색으로 확인됨"
            if result["matched"]
            else "카카오 지도에서 검색되지 않음 — 폐업했을 수도 있지만, 원래 카카오에 등록돼 있지 않았을 가능성이 더 높습니다. 네이버지도 등에서 직접 확인해주세요."
        )
        status_check = build_status_check(
            not result["matched"], moved, "kakao_keyword_search", "low", note,
            candidate_address=result["road_address"],
        )

    # place_id 유무와 무관하게, 좌표가 있으면 좌표 기준 교차검증(check_kakao_nearby)을 항상
    # 시도해 1차 판정을 보완한다 — 이름 검색만으로는 못 잡는 사각지대(카테고리가 달라 검색에
    # 안 걸리는 경우 등)를 보완하고, 폐업이 의심될 때는 훨씬 구체적인 근거(다른 업체명)를 준다.
    if kakao_key and has_coords:
        nearby = check_kakao_nearby(session, kakao_key, lat, lng, name)
        status_check = refine_with_nearby(status_check, nearby, name)

    return status_check


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="실제로 Supabase에 반영(기본은 dry-run)")
    parser.add_argument("--episode", type=int, help="특정 회차만 검사(테스트용)")
    parser.add_argument("--from-episode", type=int, help="이 회차부터(포함) 검사 — 여러 번에 나눠 돌릴 때 사용")
    parser.add_argument("--to-episode", type=int, help="이 회차까지(포함) 검사 — 여러 번에 나눠 돌릴 때 사용")
    parser.add_argument("--limit", type=int, help="검사할 식당 수 제한(테스트용)")
    args = parser.parse_args()

    supabase_url = os.environ["SUPABASE_URL"]
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    kakao_key = os.environ.get("KAKAO_REST_API_KEY")
    if not kakao_key:
        print("[안내] KAKAO_REST_API_KEY가 없어 place_id 없는 식당은 전부 건너뜁니다.")

    episodes = fetch_episodes(supabase_url, service_key, args.episode, args.from_episode, args.to_episode)
    if episodes:
        print(f"[안내] {episodes[0]['episode']}회 ~ {episodes[-1]['episode']}회, 총 {len(episodes)}개 회차 검사 시작")
    session = requests.Session()

    checked = 0
    flagged = []
    for ep in episodes:
        restaurants = ep.get("restaurants") or []
        changed = False
        for r in restaurants:
            if not r.get("name"):
                continue
            if args.limit and checked >= args.limit:
                break

            existing = r.get("status_check") or {}
            if existing.get("admin_decision") == "confirmed" and existing.get("closure_suspected"):
                # "폐업"으로 확정된 곳만 더 볼 필요가 없어 건너뛴다. "이전"으로 확정된 곳은 그
                # 식당이 여전히 영업 중(새 주소로)이라는 뜻이므로 나중에 또 폐업/이전할 수 있어
                # 계속 자동 점검 대상에 남긴다 — 원복(오탐 판정)된 곳도 마찬가지로 계속 지켜본다.
                continue

            print(f"[검사중] {ep['episode']}회 {r['name']}")
            status_check = check_one(session, kakao_key, r)
            time.sleep(REQUEST_SLEEP_SEC)
            if status_check is None:
                continue

            r["status_check"] = status_check
            checked += 1
            changed = True
            if status_check["closure_suspected"] or status_check["moved_suspected"]:
                flagged.append((ep["episode"], r["name"], status_check))

        if changed and args.apply:
            update_episode_restaurants(supabase_url, service_key, ep["episode"], restaurants)

    print(f"\n총 {checked}곳 확인, {len(flagged)}곳 의심 발견")
    for ep_num, name, sc in flagged:
        reason = []
        if sc["closure_suspected"]:
            reason.append("폐업/휴업 의심")
        if sc["moved_suspected"]:
            reason.append(f"이전 의심(→ {sc.get('candidate_address')})")
        print(f"  - {ep_num}회 {name}: {' + '.join(reason)} | {sc['note']} (신뢰도: {sc['confidence']})")

    if not args.apply:
        print("\n[dry-run] 실제 반영하려면 --apply 옵션을 추가하세요.")


if __name__ == "__main__":
    main()
