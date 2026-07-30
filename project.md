import time
import requests
from bs4 import BeautifulSoup
import pandas as pd

def crawl_baekban_data():
    base_url = "https://broadcast.tvchosun.com/broadcast/program/3/C201900033/bbs/8667/C201900033_10/list.cstv"
    all_data = []

    # 1페이지부터 18페이지까지 순회
    for page in range(1, 19):
        params = {
            "search_text": "",
            "pg": page
        }
        
        response = requests.get(base_url, params=params)
        if response.status_code != 200:
            print(f"{page}페이지 접속 실패")
            continue
            
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # TODO: 실제 사이트의 HTML 구조에 맞는 CSS Selector로 수정 필요
        posts = soup.select("목록을 담고 있는 태그 셀렉터")
        
        for post in posts:
            # 예시 데이터 추출
            # title = post.select_one("제목 셀렉터").text.strip()
            # link = post.select_one("링크 셀렉터")['href']
            
            # 상세 페이지 접속 및 식당 정보 크롤링 로직 추가 가능
            
            all_data.append({
                "page": page,
                # "title": title,
                # "link": link
            })
            
        print(f"{page}페이지 수집 완료")
        time.sleep(1) # 서버 부하 방지
        
    # 데이터프레임 변환 및 저장
    df = pd.DataFrame(all_data)
    df.to_csv("baekban_episodes.csv", index=False, encoding="utf-8-sig")
    print("모든 데이터 저장 완료!")

if __name__ == "__main__":
    crawl_baekban_data()