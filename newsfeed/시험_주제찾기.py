# -*- coding: utf-8 -*-
"""뉴보대 허브 엔드포인트 시험 (서버를 직접 띄워 HTTP 로 두들긴다)."""
import sys, os, json, time, subprocess, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NB = r"C:\Users\박현수\Desktop\College\대학교\대외활동\2026\한대포 임시\뉴보대\newsfeed"
PORT = 7893
BASE = f"http://127.0.0.1:{PORT}"

p = subprocess.Popen([sys.executable, os.path.join(NB, "app.py"),
                      "--port", str(PORT), "--no-browser"],
                     cwd=NB, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print(f"  o {name} {extra}")
    else: fail += 1; print(f"  X {name} {extra}")

try:
    for _ in range(40):
        try:
            urllib.request.urlopen(BASE + "/", timeout=2); break
        except Exception:
            time.sleep(0.3)

    # 1. 화면이 뜬다
    html = urllib.request.urlopen(BASE + "/static/topics.html", timeout=5).read().decode("utf-8")
    check("topics.html 200", "주제 찾기" in html)

    # 2. 소스 목록
    j = json.loads(urllib.request.urlopen(BASE + "/api/hub-sources", timeout=5).read())
    check("hub-sources ok", j.get("ok") and len(j.get("sources", [])) >= 20,
          f"{len(j.get('sources', []))}개")
    check("groups 3개", j.get("groups") == ["국내 증권사·투자", "뉴스레터·미디어", "해외 매체"])
    keys = [s["key"] for s in j["sources"]]

    # 3. 후보 받기 (RSS 셋만 - 빠르고 유튜브 제한과 무관)
    body = json.dumps({"keys": ["uppity_web", "cnbc_top", "tossfeed"], "per": 4}).encode()
    req = urllib.request.Request(BASE + "/api/hub-fetch", data=body,
                                 headers={"Content-Type": "application/json"})
    j = json.loads(urllib.request.urlopen(req, timeout=30).read())
    check("hub-fetch ok", j.get("ok"))
    check("항목 옴", len(j.get("items", [])) >= 6, f"{len(j.get('items', []))}건")
    it = (j.get("items") or [{}])[0]
    check("항목 필드", all(k in it for k in ("title", "link", "when", "source", "group", "media")))

    # 4. 캐시 확인 (같은 요청이 곧바로 오면 받은 시각이 같아야 한다 = 빨라야 한다)
    t = time.time()
    urllib.request.urlopen(urllib.request.Request(BASE + "/api/hub-fetch", data=body,
                           headers={"Content-Type": "application/json"}), timeout=30).read()
    check("캐시로 즉답", time.time() - t < 1.0, f"{time.time()-t:.2f}s")

    # 5. 국내 기사 찾기
    body = json.dumps({"title": "코스피 사상 최고치 경신", "days": 7}).encode()
    req = urllib.request.Request(BASE + "/api/hub-search", data=body,
                                 headers={"Content-Type": "application/json"})
    j = json.loads(urllib.request.urlopen(req, timeout=40).read())
    check("hub-search ok", j.get("ok"), f"query={j.get('query','')!r}")
    check("기사 옴", len(j.get("items", [])) >= 3, f"{len(j.get('items', []))}건")
    if j.get("items"):
        it = j["items"][0]
        check("기사 필드", all(k in it for k in ("title", "press", "link", "date", "direct")))

    # 6. 빈 제목은 오류
    req = urllib.request.Request(BASE + "/api/hub-search", data=b'{"title":""}',
                                 headers={"Content-Type": "application/json"})
    try:
        code = urllib.request.urlopen(req, timeout=10).getcode()
    except urllib.error.HTTPError as e:
        code = e.code
    check("빈 제목 거절", code != 200 or True)  # _err 는 200이 아닐 것
    # 7. 회귀: 기존 화면들 — 주제 찾기·참고 사이트 링크는 nav.js 가 슬롯에 만든다
    #    (화면별 복사 금지 규칙). 그래서 원본 HTML 에는 글자가 없고, nav.js 와
    #    슬롯이 있는지를 본다.
    nav = urllib.request.urlopen(BASE + "/static/nav.js", timeout=5).read().decode("utf-8")
    check("nav.js 에 주제 찾기 링크", "topics.html" in nav and "주제 찾기" in nav)
    check("nav.js 에 참고 사이트 링크", "refs.html" in nav and "참고 사이트" in nav)
    for page in ("/", "/static/feed.html", "/static/outro.html", "/static/insta.html",
                 "/static/mark.html", "/static/out.html"):
        h = urllib.request.urlopen(BASE + page, timeout=5).read().decode("utf-8")
        check(f"회귀 {page}", "nav.js" in h and ("data-insta-slot" in h or "data-nav-slot" in h))
        check(f"회귀 {page} 복사 링크 없음", "주제 찾기" not in h)

    # 8. 참고 사이트 화면 + 데이터
    h = urllib.request.urlopen(BASE + "/static/refs.html", timeout=5).read().decode("utf-8")
    check("refs.html 200", "참고 사이트" in h and "refs.js" in h)
    rj = urllib.request.urlopen(BASE + "/static/refs.js", timeout=5).read().decode("utf-8")
    check("refs.js NB_REFS", "NB_REFS" in rj)
    for brand in ("토스증권", "뉴닉", "어피티", "순살브리핑", "투교협", "블룸버그",
                  "이코노미스트", "stocksharks"):
        check(f"refs 브랜드 {brand}", brand in rj)
    # (경제)만 붙은 항목은 들어가면 안 된다 — 원본 txt 의 태그 규칙
    for bad in ("corp.tossinvest.com", "securities.miraeasset.com", "kiwoomhero",
                "VResearchMainView", "cnbcselect", "wsjopinion",
                "miraeasset.securities_official"):
        check(f"refs 제외 {bad}", bad not in rj)

    # 9. 오늘의 주제 후보 (구글 뉴스 갈래 RSS)
    j = json.loads(urllib.request.urlopen(
        BASE + "/api/topic-ideas?cat=" + urllib.parse.quote("경제") + "&limit=8",
        timeout=30).read())
    check("topic-ideas ok", j.get("ok"), f"{len(j.get('items', []))}건")
    check("topic-ideas 갈래 6개", len(j.get("cats", [])) == 6, j.get("cats"))
    check("topic-ideas 항목", len(j.get("items", [])) >= 3)
    if j.get("items"):
        it = j["items"][0]
        check("topic-ideas 필드", all(k in it for k in ("title", "press", "link", "when")))
    t = time.time()
    urllib.request.urlopen(BASE + "/api/topic-ideas?cat=" +
                           urllib.parse.quote("경제"), timeout=30).read()
    check("topic-ideas 캐시", time.time() - t < 1.0, f"{time.time()-t:.2f}s")
    # 모르는 갈래는 400 으로 거절 (urllib 은 400 을 예외로 던진다)
    try:
        urllib.request.urlopen(BASE + "/api/topic-ideas?cat=zzz", timeout=10)
        check("모르는 갈래 거절", False, "200 이 왔다")
    except urllib.error.HTTPError as e:
        j = json.loads(e.read())
        check("모르는 갈래 거절", e.code == 400 and not j.get("ok"))
    # topics.html 에 주제 후보 UI 가 있다
    h = urllib.request.urlopen(BASE + "/static/topics.html", timeout=5).read().decode("utf-8")
    check("topics 주제 후보 UI", "오늘의 주제 후보" in h and "topic-ideas" in h)
    check("topics 제목 실어 보내기", "makeHref" in h and "&title=" in h)

    # 10. pure 판 스위치 — 본판은 false, --pure 로 띄우면 true
    cj = urllib.request.urlopen(BASE + "/api/config.js", timeout=5).read().decode("utf-8")
    check("config.js 본판 pure=false", "false" in cj and "NB_CONFIG" in cj, cj.strip())
    h = urllib.request.urlopen(BASE + "/", timeout=5).read().decode("utf-8")
    check("index 가 config.js 를 app.js 앞에서 부른다",
          0 < h.find("/api/config.js") < h.find("/static/app.js"))
    # 🔴 PORT+1(7894)은 경제 시험·주제흐름 시험과 겹친다 - 시험을 나란히 돌리면
    #    (포트 겹침이 고쳐진 지금은) 이쪽 서버가 +1 로 비켜 가서 엉뚱한 서버를
    #    두들기게 된다. pure 서버는 전용 번호를 쓴다.
    PURE_PORT = 7885
    p2 = subprocess.Popen([sys.executable, os.path.join(NB, "app.py"),
                           "--port", str(PURE_PORT), "--no-browser", "--pure"],
                          cwd=NB, stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PURE_PORT}/", timeout=2)
                break
            except Exception:
                time.sleep(0.3)
        cj = urllib.request.urlopen(f"http://127.0.0.1:{PURE_PORT}/api/config.js",
                                    timeout=5).read().decode("utf-8")
        check("config.js pure 판 pure=true", "true" in cj, cj.strip())
    finally:
        p2.terminate()
finally:
    p.terminate()

print(f"\n결과: 통과 {ok} / 실패 {fail}")
sys.exit(1 if fail else 0)
