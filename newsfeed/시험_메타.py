# -*- coding: utf-8 -*-
"""메타 3창구(인스타·페이스북·스레드) 올리기 시험 - 그물망을 타지 않는다.

`meta_api._열기` 하나만 가짜로 바꾸면 모든 호출이 여기로 모인다. 그래서 **실제 계정 없이**
① 어느 주소에 ② 무슨 값을 ③ 어떤 차례로 보내는지를 다 잴 수 있다.

재는 것
  1) 코드 뽑기 - 주소창 통째로 / 코드만 / 스레드가 붙이는 `#_` 꼬리
  2) 동의 주소 - 앱 ID·돌아올 주소·권한이 다 들어가는가
  3) 토큰 - 코드→단기→장기 2단이 도는가, 스레드는 제 주소로 가는가
  4) 대상찾기 - 페이지와 딸린 인스타를 골라내는가
  5) 갱신 - 넉넉하면 안 건드리고, 임박하면 새로 받는가
  6) 그림 - 번호 순서, 10장 넘김 막기, PNG→JPEG 실제 변환(윈도우)
  7) 인스타 - 한 장 / 캐러셀(is_carousel_item · children) / 2,200자 막기 / 익기 기다리기
  8) 페이스북 - 한 장은 바로, 여러 장은 published=false 뒤 attached_media 로 묶기
  9) 스레드 - 글만 / 한 장 / 캐러셀 / 500자 막기
 10) 한 번에 - 창구 하나가 죽어도 나머지는 간다
 11) 오류 말 - 190(만료)·200(권한)에 다음에 할 일이 붙는가
"""
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import urllib.error

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import meta_api as M

ok = fail = 0


def check(name, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  o {name} {extra}")
    else:
        fail += 1
        print(f"  X {name} {extra}")


# ────────────────────────────────────────────── 가짜 그물망
기록 = []
규칙 = []          # (method, 주소조각, 값 또는 함수) - 먼저 넣은 것이 먼저 맞는다


class 가짜응답:
    def __init__(self, data, status=200):
        self._d = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.status = status

    def read(self):
        return self._d

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def 가짜열기(req):
    url = req.full_url
    method = req.get_method()
    몸통 = ""
    if req.data:
        몸통 = req.data.decode("utf-8", "replace")
    기록.append((method, url, 몸통))
    for m, 조각, 값 in 규칙:
        if m == method and 조각 in url:
            if callable(값):
                값 = 값(url, 몸통)
            if isinstance(값, Exception):
                raise 값
            return 가짜응답(값)
    raise AssertionError("시험이 모르는 호출: %s %s" % (method, url))


def 판깔기(*새규칙):
    기록.clear()
    규칙.clear()
    규칙.extend(새규칙)


M._열기 = 가짜열기
M.time.sleep = lambda *a: None            # 기다림은 시험에서 의미가 없다

앱 = {"app_id": "APPID", "app_secret": "APPSEC", "threads_app_id": "THID",
      "threads_app_secret": "THSEC",
      "redirect_uri": "https://example.github.io/nb/connect.html"}

계정 = {"instagram": {"id": "IG1", "username": "news_univ", "token": "PT"},
        "facebook": {"page_id": "PG1", "name": "뉴보대", "page_token": "PT",
                     "user_token": "UT", "만료": "2099-01-01"},
        "threads": {"id": "TH1", "username": "news_univ", "token": "TT",
                    "만료": "2099-01-01"}}


# ────────────────────────────────────────────── 1) 코드 뽑기
print("\n[1] 코드 뽑기")
check("주소창 통째로", M.코드뽑기(
    "https://example.github.io/nb/connect.html?code=ABC123&state=x") == "ABC123")
check("코드만", M.코드뽑기("  ABC123  ") == "ABC123")
check("스레드 꼬리 #_ 떼기", M.코드뽑기("https://a/b?code=XYZ#_") == "XYZ")
try:
    M.코드뽑기("https://example.github.io/nb/connect.html?error_reason=user_denied")
    check("동의 취소는 실패로", False)
except M.MetaError as e:
    check("동의 취소는 실패로", "code 가 없습니다" in str(e) and "user_denied" in str(e))

# ────────────────────────────────────────────── 2) 동의 주소
print("\n[2] 동의 주소")
fu = M.페이스북_동의주소(앱)
check("페이스북: 앱 ID", "client_id=APPID" in fu)
check("페이스북: 인스타 게시 권한", "instagram_content_publish" in fu)
check("페이스북: 페이지 게시 권한", "pages_manage_posts" in fu)
check("페이스북: 돌아올 주소", "connect.html" in fu)
tu = M.스레드_동의주소(앱)
check("스레드: 전용 앱 ID", "client_id=THID" in tu)
check("스레드: 게시 권한", "threads_content_publish" in tu)
check("스레드: 제 로그인 주소", tu.startswith("https://threads.net/oauth/authorize"))

# ────────────────────────────────────────────── 3) 토큰
print("\n[3] 토큰 받기")
판깔기(("GET", "fb_exchange_token", {"access_token": "LONG", "expires_in": 5184000}),
      ("GET", "/oauth/access_token", {"access_token": "SHORT"}))
t, s = M.페이스북_토큰(앱, "CODE")
check("페이스북 장기 토큰", t == "LONG", t)
check("페이스북 2단(단기→장기)", len(기록) == 2, len(기록))
check("페이스북 비밀이 실려 감", "client_secret=APPSEC" in 기록[0][1])

판깔기(("GET", "th_exchange_token", {"access_token": "THLONG", "expires_in": 5184000}),
      ("POST", "graph.threads.net/oauth/access_token", {"access_token": "THSHORT"}))
t2, _ = M.스레드_토큰(앱, "CODE")
check("스레드 장기 토큰", t2 == "THLONG", t2)
check("스레드는 graph.threads.net 으로", "graph.threads.net" in 기록[0][1])

# ────────────────────────────────────────────── 4) 대상찾기
print("\n[4] 페이지·인스타 찾기")
판깔기(("GET", "/me/accounts", {"data": [
    {"id": "PG1", "name": "뉴보대", "access_token": "PT1",
     "instagram_business_account": {"id": "IG1", "username": "news_univ"}},
    {"id": "PG2", "name": "한대포", "access_token": "PT2"}]}))
대상 = M.대상찾기("UT")
check("페이지 2개", len(대상) == 2)
check("인스타 딸린 것 집어냄", 대상[0]["ig_username"] == "news_univ")
check("인스타 없는 페이지도 담김", 대상[1]["ig_id"] == "")
check("페이지 토큰 따로", 대상[1]["page_token"] == "PT2")

# ────────────────────────────────────────────── 5) 갱신
print("\n[5] 토큰 갱신")
넉넉 = json.loads(json.dumps(계정))
판깔기()
check("만료가 멀면 안 건드린다", M.토큰갱신(넉넉, 앱) is False and not 기록)

임박 = json.loads(json.dumps(계정))
from datetime import datetime, timedelta
임박["facebook"]["만료"] = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")
임박["threads"]["만료"] = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")
판깔기(("GET", "fb_exchange_token", {"access_token": "NEWFB", "expires_in": 5184000}),
      ("GET", "refresh_access_token", {"access_token": "NEWTH", "expires_in": 5184000}))
바뀜 = M.토큰갱신(임박, 앱, 로그=lambda *a: None)
check("임박하면 새로 받는다", 바뀜 is True)
check("페이스북 사용자 토큰 교체", 임박["facebook"]["user_token"] == "NEWFB")
check("스레드 토큰 교체", 임박["threads"]["token"] == "NEWTH")
check("페이지 토큰은 그대로(만료 없음)", 임박["facebook"]["page_token"] == "PT")
check("만료일이 60일 뒤로", M.남은날(임박["threads"]) > 50, M.남은날(임박["threads"]))

# ────────────────────────────────────────────── 6) 그림
print("\n[6] 그림 다듬기")
작업 = tempfile.mkdtemp(prefix="시험_메타_")


def png만들기(path, w=8, h=10):
    """가장 작은 진짜 PNG 한 장 (라이브러리 없이)."""
    import zlib
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))

    def 청크(형, 몸):
        return (struct.pack(">I", len(몸)) + 형 + 몸
                + struct.pack(">I", zlib.crc32(형 + 몸) & 0xFFFFFFFF))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(청크(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(청크(b"IDAT", zlib.compress(raw)))
        f.write(청크(b"IEND", b""))
    return path


원본 = os.path.join(작업, "원본")
os.makedirs(원본, exist_ok=True)
for 이름 in ("03_뒷장.png", "01_표지.png", "02_본문.png"):
    png만들기(os.path.join(원본, 이름))
낼곳 = os.path.join(작업, "낸것")
그림 = M.올릴그림_고르기([os.path.join(원본, x) for x in os.listdir(원본)], 낼곳)
check("이름 번호 순서대로", [os.path.basename(x) for x in 그림] == ["01.jpg", "02.jpg", "03.jpg"],
      [os.path.basename(x) for x in 그림])
check("PNG→JPEG 실제 변환", all(open(p, "rb").read(2) == b"\xff\xd8" for p in 그림))
check("원본은 그대로 PNG", open(os.path.join(원본, "01_표지.png"), "rb").read(8)
      == b"\x89PNG\r\n\x1a\n")

j = os.path.join(원본, "05_이미jpg.jpg")
shutil.copy2(그림[0], j)
그림2 = M.올릴그림_고르기([j], os.path.join(작업, "낸것2"))
check("이미 JPG 면 그대로 복사", os.path.basename(그림2[0]) == "01.jpg")

try:
    M.올릴그림_고르기([그림[0]] * 11, os.path.join(작업, "낸것3"))
    check("11장은 막는다", False)
except M.MetaError as e:
    check("11장은 막는다", "10장" in str(e))
try:
    M.올릴그림_고르기([os.path.join(원본, "없는것.png")], os.path.join(작업, "낸것4"))
    check("없는 파일은 막는다", False)
except M.MetaError as e:
    check("없는 파일은 막는다", "파일이 없습니다" in str(e))

# ────────────────────────────────────────────── 7) 인스타
print("\n[7] 인스타그램")
컨테이너 = {"n": 0}


def 새컨테이너(url, 몸통):
    컨테이너["n"] += 1
    return {"id": "C%d" % 컨테이너["n"]}


인스타판 = [("POST", "/media_publish", {"id": "M1"}),
            ("POST", "/media", 새컨테이너),
            ("GET", "fields=status_code", {"status_code": "FINISHED"}),
            ("GET", "fields=permalink", {"permalink": "https://instagram.com/p/AAA"})]

판깔기(*인스타판)
r = M.인스타_올리기(계정, ["https://x/1.jpg"], "안녕", 로그=lambda *a: None)
check("한 장: 발행됨", r["id"] == "M1" and r["링크"].endswith("/p/AAA"))
check("한 장: 컨테이너 1개만", sum(1 for m, u, b in 기록 if "/media" in u and "publish" not in u) == 1)
check("한 장: 캐러셀 표시 없음", not any("is_carousel_item" in b for m, u, b in 기록))

컨테이너["n"] = 0
판깔기(*인스타판)
r = M.인스타_올리기(계정, ["https://x/1.jpg", "https://x/2.jpg", "https://x/3.jpg"],
                  "안녕", 로그=lambda *a: None)
check("캐러셀: 장마다 is_carousel_item",
      sum(1 for m, u, b in 기록 if "is_carousel_item=true" in b) == 3)
check("캐러셀: children 으로 묶음",
      any("children=C1%2CC2%2CC3" in b for m, u, b in 기록))
check("캐러셀: 문구는 묶음에만",
      sum(1 for m, u, b in 기록 if "caption=" in b) == 1)
check("캐러셀: 발행은 마지막 컨테이너로",
      any("creation_id=C4" in b for m, u, b in 기록))

판깔기(("GET", "fields=status_code", {"status_code": "ERROR", "status": "다운로드 실패"}),
      ("POST", "/media", 새컨테이너))
try:
    M.인스타_올리기(계정, ["https://x/1.jpg"], "안녕", 로그=lambda *a: None)
    check("그림을 못 읽으면 멈춘다", False)
except M.MetaError as e:
    check("그림을 못 읽으면 멈춘다", "못 받았습니다" in str(e), str(e)[:40])

try:
    M.인스타_올리기(계정, ["https://x/1.jpg"], "가" * 2201, 로그=lambda *a: None)
    check("2,200자 넘으면 막는다", False)
except M.MetaError as e:
    check("2,200자 넘으면 막는다", "2200" in str(e).replace(",", ""))

# ────────────────────────────────────────────── 8) 페이스북
print("\n[8] 페이스북 페이지")
사진 = {"n": 0}


def 새사진(url, 몸통):
    사진["n"] += 1
    return {"id": "PH%d" % 사진["n"], "post_id": "PG1_9"}


판깔기(("POST", "/photos", 새사진), ("POST", "/feed", {"id": "PG1_77"}))
r = M.페이스북_올리기(계정, [그림[0]], "안녕", 로그=lambda *a: None)
check("한 장: /photos 로 바로 게시", r["id"] == "PG1_9")
check("한 장: 파일을 바이트로 올린다", 'name="source"' in 기록[0][2])
check("한 장: 공개 주소가 필요 없다", not any("image_url" in b for m, u, b in 기록))

사진["n"] = 0
판깔기(("POST", "/photos", 새사진), ("POST", "/feed", {"id": "PG1_77"}))
r = M.페이스북_올리기(계정, 그림, "안녕", 로그=lambda *a: None)
check("여러 장: 사진 수만큼 올림", sum(1 for m, u, b in 기록 if "/photos" in u) == 3)
check("여러 장: 먼저 숨겨 올린다",          # 멀티파트라 값이 폼 조각으로 들어간다
      all('name="published"' in b and "false" in b for m, u, b in 기록 if "/photos" in u))
묶음 = [b for m, u, b in 기록 if "/feed" in u][0]
check("여러 장: attached_media 로 묶음", "attached_media%5B0%5D" in 묶음)
check("여러 장: 사진 3개가 다 붙음", 묶음.count("media_fbid") == 3)
check("여러 장: 글 링크를 돌려줌", "/posts/77" in r["링크"], r["링크"])

# ────────────────────────────────────────────── 9) 스레드
print("\n[9] 스레드")
스레드판 = [("POST", "/threads_publish", {"id": "T1"}),
            ("POST", "/threads", 새컨테이너),
            ("GET", "fields=status", {"status": "FINISHED"}),
            ("GET", "fields=permalink", {"permalink": "https://threads.net/@a/post/1"})]
컨테이너["n"] = 0
판깔기(*스레드판)
r = M.스레드_올리기(계정, [], "글만 올림", 로그=lambda *a: None)
check("글만: TEXT 로 간다", any("media_type=TEXT" in b for m, u, b in 기록))
check("글만: 익기를 안 기다린다", not any(m == "GET" and "status" in u for m, u, b in 기록))
check("글만: 발행됨", r["id"] == "T1")

컨테이너["n"] = 0
판깔기(*스레드판)
M.스레드_올리기(계정, ["https://x/1.jpg", "https://x/2.jpg"], "둘", 로그=lambda *a: None)
check("캐러셀: 장마다 담고", sum(1 for m, u, b in 기록 if "is_carousel_item=true" in b) == 2)
check("캐러셀: CAROUSEL 로 묶고", any("media_type=CAROUSEL" in b for m, u, b in 기록))
check("스레드는 graph.threads.net 으로만",
      all("graph.threads.net" in u for m, u, b in 기록))
try:
    M.스레드_올리기(계정, [], "가" * 501, 로그=lambda *a: None)
    check("500자 넘으면 막는다(자르지 않는다)", False)
except M.MetaError as e:
    check("500자 넘으면 막는다(자르지 않는다)", "500자" in str(e))

# ────────────────────────────────────────────── 10) 한 번에
print("\n[10] 세 창구 한 번에")


class 가짜호스팅:
    def __init__(self, *a):
        self.치웠나 = False

    def 올리기(self, 파일들, 로그=print):
        return ["https://공개/%s" % os.path.basename(p) for p in 파일들]

    def 치우기(self, 로그=print):
        self.치웠나 = True


가짜집 = 가짜호스팅()
M.호스팅만들기 = lambda 설정, 임시: 가짜집
설정 = {"앱": 앱, "호스팅": {}, "계정": {"news_univ": 계정}}
컨테이너["n"] = 사진["n"] = 0
판깔기(("POST", "/media_publish", {"id": "M1"}),
      ("POST", "/media", 새컨테이너),
      ("POST", "/threads_publish", {"id": "T1"}),
      ("POST", "/threads", 새컨테이너),
      ("POST", "/photos", 새사진),
      ("POST", "/feed", {"id": "PG1_77"}),
      ("GET", "fields=status_code", {"status_code": "FINISHED"}),
      ("GET", "fields=status", {"status": "FINISHED"}),
      ("GET", "fields=permalink", {"permalink": "https://링크"}))
결과 = M.올리기("news_univ", [os.path.join(원본, x) for x in os.listdir(원본)],
              "한 번에", 설정=설정, 로그=lambda *a: None)
check("창구 3개 모두 성공", len(결과) == 3 and all(r["ok"] for r in 결과),
      [(r["창구"], r["ok"]) for r in 결과])
check("공개 주소는 인스타·스레드에만 쓰인다",
      sum(1 for m, u, b in 기록 if "image_url" in b) >= 1)
check("끝나면 올려 뒀던 그림을 치운다", 가짜집.치웠나)

가짜집2 = 가짜호스팅()
M.호스팅만들기 = lambda 설정, 임시: 가짜집2
컨테이너["n"] = 사진["n"] = 0
판깔기(("POST", "/media_publish", urllib.error.HTTPError(
           "u", 400, "bad", {}, io.BytesIO(json.dumps(
               {"error": {"message": "권한 없음", "code": 200}}).encode()))),
      ("POST", "/media", 새컨테이너),
      ("POST", "/threads_publish", {"id": "T1"}),
      ("POST", "/threads", 새컨테이너),
      ("POST", "/photos", 새사진),
      ("POST", "/feed", {"id": "PG1_77"}),
      ("GET", "fields=status_code", {"status_code": "FINISHED"}),
      ("GET", "fields=status", {"status": "FINISHED"}),
      ("GET", "fields=permalink", {"permalink": "https://링크"}))
결과 = M.올리기("news_univ", [os.path.join(원본, x) for x in os.listdir(원본)],
              "한 번에", 설정=설정, 로그=lambda *a: None)
탈락 = [r for r in 결과 if not r["ok"]]
check("인스타가 죽어도 나머지는 간다", len(탈락) == 1 and len(결과) == 3,
      [(r["창구"], r["ok"]) for r in 결과])
check("실패한 창구는 이유를 남긴다", "권한" in 탈락[0]["왜"])

try:
    M.올리기("없는계정", [그림[0]], "x", 설정=설정, 로그=lambda *a: None)
    check("모르는 계정은 막는다", False)
except M.MetaError as e:
    check("모르는 계정은 막는다", "설정에 없습니다" in str(e))

# ────────────────────────────────────────────── 11) 오류 말
print("\n[11] 오류 말")


def 오류만들기(코드, 말):
    return M._오류로(urllib.error.HTTPError(
        "u", 400, "bad", {}, io.BytesIO(json.dumps(
            {"error": {"message": 말, "code": 코드}}).encode())))


check("190(만료)에 다시 잇는 법이 붙는다", "메타_연결" in str(오류만들기(190, "expired")))
check("200(권한)에 할 일이 붙는다", "권한이 모자랍니다" in str(오류만들기(200, "no perm")))
check("4(한도)는 기다리라 한다", "한도" in str(오류만들기(4, "limit")))
check("메타가 준 말을 그대로 싣는다", "expired" in str(오류만들기(190, "expired")))

# ────────────────────────────────────────────── 12) 설정 파일
print("\n[12] 설정 파일")
M.설정폴더 = os.path.join(작업, "설정")
M.설정경로 = os.path.join(M.설정폴더, "메타_계정.json")
M.설정쓰기({"앱": 앱, "호스팅": {"방식": "터널"}, "계정": {"a": {"이름": "가"}}})
다시 = M.설정읽기()
check("쓰고 읽기", 다시["앱"]["app_id"] == "APPID" and 다시["계정"]["a"]["이름"] == "가")
check("앱 폴더 밖에 둔다(배포본에 안 딸려 감)",
      "newsfeed" not in M.설정경로.replace("\\", "/").split("/"))
check("설정이 없으면 빈 뼈대", M.설정읽기() and "계정" in M.설정읽기())
try:
    M.앱정보({"앱": {}})
    check("앱 정보 없으면 안내한다", False)
except M.MetaError as e:
    check("앱 정보 없으면 안내한다", "메타_연결.py 앱" in str(e))

# 호스팅 고르기 - 10)에서 가짜로 바꿔 놨으니 원래 것을 되살려 재본다
import importlib
importlib.reload(M)
M._열기 = 가짜열기
check("방식 `직접` → 직접호스팅",
      isinstance(M.호스팅만들기({"호스팅": {"방식": "직접", "폴더": 작업, "공개주소": "https://x/"}},
                              작업), M.직접호스팅))
check("방식 `터널` → 터널호스팅",
      isinstance(M.호스팅만들기({"호스팅": {"방식": "터널"}}, 작업), M.터널호스팅))
check("기본은 깃허브페이지",
      isinstance(M.호스팅만들기({}, 작업), M.깃허브페이지호스팅))

shutil.rmtree(작업, ignore_errors=True)
print(f"\n결과: 통과 {ok} / 실패 {fail}")
sys.exit(1 if fail else 0)
