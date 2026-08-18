# -*- coding: utf-8 -*-
"""주제 찾기 → 앞장 만들기 흐름을 **화면으로 끝에서 끝까지 걷는** 시험.

  참고 사이트(refs) 화면이 그려지는가 → 주제 찾기에서 오늘의 주제 후보를 받아
  고르는가 → `카드 만들기` 로 앞장에 도착해 **주소·제목이 반영**되는가.

서버만 두들기면 nav.js 슬롯·칩 클릭·?title= 이어가기 같은 화면 배선이 안 잡히므로
크롬을 헤드리스로 띄워 직접 걷는다 (시험_링크이어넣기.py 와 같은 배관).

    python 시험_주제흐름.py            (앱을 알아서 띄우고 끝나면 내린다)

🔴 CDP 포트는 9345/9346 계열만 쓴다. 9333 은 인스타 전용 크롬이라 절대 붙지 않는다.
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insta                                    # CDP 배관을 그대로 쓴다

CDP_PORT = 9345                                 # 링크이어넣기와 같은 번호(동시엔 안 돈다)
PROFILE = os.path.join(os.environ.get("TEMP", "."), "nb_시험_주제흐름_프로필")
APP_PORT = 7894

# 본문까지 반영되는 것을 재는 직접 링크 (구글 중계 주소는 제목까지만 보장이라 따로 잰다)
NAVER = "https://n.news.naver.com/mnews/article/001/0015000000"

FAIL = []
N = [0]


def ck(name, cond, extra=""):
    N[0] += 1
    print(("  ok  " if cond else "  X   ") + name + (" - " + str(extra) if extra else ""))
    if not cond:
        FAIL.append(name)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    srv = subprocess.Popen([sys.executable, "-u", "app.py", "--no-browser",
                            "--port", str(APP_PORT)], cwd=here,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    app = "http://127.0.0.1:%d/" % APP_PORT
    for _ in range(40):
        try:
            urllib.request.urlopen(app, timeout=2)
            break
        except Exception:
            time.sleep(0.4)

    ch = insta.Chrome(port=CDP_PORT, profile=PROFILE)
    if ch.alive():
        print("X %d 번 포트를 이미 누가 쓰고 있습니다. 그 창을 닫고 다시 돌리세요." % CDP_PORT)
        srv.terminate()
        sys.exit(2)
    os.makedirs(PROFILE, exist_ok=True)
    proc = subprocess.Popen(
        [insta.Chrome.find_chrome(), "--headless=new",
         "--remote-debugging-port=%d" % CDP_PORT, "--user-data-dir=%s" % PROFILE,
         "--no-first-run", "--no-default-browser-check",
         "--disable-features=Translate",
         # 헤드리스의 '가려진 창' 타이머 늦춤 방지 (저장 디바운스 거짓 실패)
         "--disable-background-timer-throttling",
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        if ch.alive():
            break
        time.sleep(0.4)
    ch.attach(match="about:blank", make=True, url=app)
    ch.send("Page.enable")
    ch.send("Page.bringToFront")    # 배경 탭이 되면 타이머가 얼어 거짓 실패 (스타일모드 시험 참고)

    try:
        print("\n[1] 참고 사이트 화면")
        ch.navigate(app + "static/refs.html", 2.5)
        ch.js("localStorage.clear(); sessionStorage.clear();")
        s = ch.js("({brands: document.querySelectorAll('.brandcard').length,"
                  "  links: document.querySelectorAll('.reflink').length,"
                  "  blank: [...document.querySelectorAll('.reflink')].every(a => a.target === '_blank'),"
                  "  navTopics: !![...document.querySelectorAll('header a')].find(a => a.textContent === '주제 찾기'),"
                  "  navSelf: [...document.querySelectorAll('header a')].filter(a => a.textContent === '참고 사이트').length})")
        ck("브랜드 묶음이 그려졌다", s["brands"] >= 15, s["brands"])
        ck("링크 수", s["links"] >= 45, s["links"])
        ck("전부 새 탭으로 연다", s["blank"])
        ck("머리글에 주제 찾기(nav.js)", s["navTopics"])
        ck("제 화면 링크는 안 만든다", s["navSelf"] == 0)
        # 용도 필터 — '글 작성' 만 남기면 커뮤니티 링크만 남는다
        ch.js("[...document.querySelectorAll('#useChips .chip')]"
              ".find(b => b.textContent === '글 작성').click()")
        s2 = ch.js("document.querySelectorAll('.reflink').length")
        ck("용도 필터가 줄인다", 0 < s2 < s["links"], "%d → %d" % (s["links"], s2))

        print("\n[2] 주제 찾기 - 오늘의 주제 후보")
        ch.navigate(app + "static/topics.html", 2.5)
        chips = ch.js("[...document.querySelectorAll('#catChips .chip')].map(b => b.textContent)")
        ck("갈래 칩 6개", len(chips or []) == 6, chips)
        ck("머리글에 참고 사이트(nav.js)",
           ch.js("!![...document.querySelectorAll('header a')]"
                 ".find(a => a.textContent === '참고 사이트')"))
        ch.js("[...document.querySelectorAll('#catChips .chip')]"
              ".find(b => b.textContent === '경제').click()")
        rows = 0
        for _ in range(60):                      # 구글 뉴스 RSS 응답 대기
            rows = ch.js("document.querySelectorAll('#ideaList .idea').length") or 0
            if rows:
                break
            time.sleep(0.5)
        ck("경제 후보가 온다", rows >= 3, rows)

        print("\n[3] 후보를 골라 담는다")
        ch.js("document.querySelector('#ideaList .idea').click()")
        picked = ch.js("({title: document.getElementById('selTitle').value,"
                       "  href: document.querySelector('#ideaList .idea a.mk2').href})")
        ck("고른 주제에 담겼다", bool(picked["title"].strip()), picked["title"][:30])
        ck("카드 만들기 링크에 주소+제목", "url=" in picked["href"] and "title=" in picked["href"])

        print("\n[4] 카드 만들기 링크로 앞장 도착 (구글 중계 주소 - 제목 반영을 잰다)")
        ch.navigate(picked["href"], 3.0)
        for _ in range(90):                      # 가져오기 시도 끝나기를 기다린다
            m = ch.js("(document.getElementById('fetchMsg')||{}).textContent") or ""
            if any(w in m for w in ("가져왔습니다", "못", "실패")):
                break
            time.sleep(0.5)
        s4 = ch.js("({url: document.getElementById('inUrl').value,"
                   "  title: document.getElementById('inTitle').value,"
                   "  msg: document.getElementById('fetchMsg').textContent})")
        ck("주소가 실려 왔다", "news.google.com" in s4["url"] or s4["url"].startswith("http"),
           s4["url"][:40])
        ck("🔑 제목이 실려 왔다(?title=)", s4["title"].strip() == picked["title"].strip(),
           s4["title"][:30])
        print("      (가져오기 결과: %s)" % s4["msg"][:60])

        print("\n[5] 직접 링크로도 끝까지 - 본문·문구 후보까지 반영")
        ch.navigate(app + "?url=%s&title=%s" % (
            urllib.parse.quote(NAVER, safe=""), urllib.parse.quote("실은 제목")), 3.0)
        for _ in range(120):
            m = ch.js("(document.getElementById('fetchMsg')||{}).textContent") or ""
            if any(w in m for w in ("가져왔습니다", "못", "실패")):
                break
            time.sleep(0.5)
        s5 = ch.js("({body: document.getElementById('inBody').value.length,"
                   "  title: document.getElementById('inTitle').value,"
                   "  chips: document.querySelectorAll('#chipsTitle .chip').length,"
                   "  card: document.getElementById('txtTitle').value.trim()})")
        ck("본문이 들어왔다", s5["body"] > 300, s5["body"])
        ck("실어 보낸 제목이 우선한다", s5["title"] == "실은 제목", s5["title"][:30])
        ck("문구 후보가 생겼다", s5["chips"] >= 3, s5["chips"])
        ck("카드 제목이 채워졌다", bool(s5["card"]), s5["card"][:24])

        print("\n[6] pure 판 - 스타일 모드가 아예 안 만들어진다")
        n_main = ch.js("document.querySelectorAll('#styles button').length")
        ck("본판엔 스타일 모드 6개", n_main == 6, n_main)
        srv2 = subprocess.Popen([sys.executable, "-u", "app.py", "--no-browser",
                                 "--port", str(APP_PORT + 1), "--pure"], cwd=here,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            app2 = "http://127.0.0.1:%d/" % (APP_PORT + 1)
            for _ in range(40):
                try:
                    urllib.request.urlopen(app2, timeout=2)
                    break
                except Exception:
                    time.sleep(0.4)
            ch.navigate(app2, 3.0)
            s6 = ch.js("({btns: document.querySelectorAll('#styles button').length,"
                       "  hidden: getComputedStyle(document.getElementById('styles')).display === 'none',"
                       "  headHidden: getComputedStyle(document.getElementById('styles').previousElementSibling).display === 'none'})")
            ck("pure 판엔 단추 0개", s6["btns"] == 0, s6["btns"])
            ck("스타일 모드 칸이 숨겨졌다", s6["hidden"] and s6["headHidden"])
            # 본판이 남긴 nb_state(모드 흔적)는 pure 판에 안 스며든다 - 열쇠가 다르다
            ch.js("localStorage.setItem('nb_state', JSON.stringify("
                  "{overlay:{color:'#123456'}, deco:'tag', paper:'#ff0000'}))")
            ch.navigate(app2, 3.0)
            s6b = ch.js("({ov: document.getElementById('ovColor').value,"
                        "  btns: document.querySelectorAll('#styles button').length})")
            ck("본판 상태가 pure 로 안 샌다", s6b["ov"] == "#000000", s6b["ov"])
            ck("다시 열어도 단추 0개", s6b["btns"] == 0)
        finally:
            srv2.terminate()
    finally:
        try:
            ch.close()
        except Exception:
            pass
        proc.terminate()
        srv.terminate()

    print("\n결과: 통과 %d / 실패 %d" % (N[0] - len(FAIL), len(FAIL)))
    if FAIL:
        print("실패 목록:", ", ".join(FAIL))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
