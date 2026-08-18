# -*- coding: utf-8 -*-
"""한 번 띄워 놓고 링크를 몇 개든 이어서 넣을 수 있는가 — 화면을 직접 걷는 시험.

왜 이 시험이 필요했나: `/api/extract` 는 본문을 같이 주면 그쪽을 우선한다(URL 이
막힌 언론사를 위한 길). 화면이 칸에 남은 **지난 기사 본문**을 새 주소와 함께
보내고 있어서, 두 번째 링크는 사진·출처만 바뀌고 글은 첫 기사 그대로였다.
서버만 두들기면 절대 안 잡히는 결함이라 **브라우저로 걷는다.**

    python 시험_링크이어넣기.py            (앱을 알아서 띄우고 끝나면 내린다)
    python 시험_링크이어넣기.py --port 7881 (이미 떠 있는 앱에 붙는다)

크롬은 전용 포트·전용 프로필로 **헤드리스**로 띄운다 — 평소 쓰는 크롬과 인스타
로그인 창을 건드리지 않는다.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insta                                    # CDP 배관을 그대로 쓴다

# 🔴 `insta.py` 가 9333 을 쓴다. 같은 번호를 쓰면 인스타 로그인 창에 그대로 붙어
#    남의 탭을 딴 데로 보내고 끝에 닫아 버린다(한 번 그랬다). 번호를 갈라 두고,
#    그래도 누가 먼저 잡고 있으면 **붙지 않고 그만둔다**.
CDP_PORT = 9345
PROFILE = os.path.join(os.environ.get("TEMP", "."), "nb_시험_프로필")

# 서로 다른 기사 넷. 본문 길이가 확연히 달라 "안 바뀌었다"를 바로 알아본다.
A = "https://n.news.naver.com/mnews/article/001/0015000000"   # 681자
B = "https://n.news.naver.com/mnews/article/003/0012000000"   # 4910자
C = "https://n.news.naver.com/mnews/article/052/0002000000"   # 312자

FAIL = []
N = [0]


def ck(name, cond, extra=""):
    N[0] += 1
    print(("  ok  " if cond else "  🔴  ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAIL.append(name)


# ── 화면 조작 ────────────────────────────────────────────────────────────
SNAP = """(() => {
  const g = id => document.getElementById(id);
  const chips = id => [...document.querySelectorAll('#' + id + ' .chip')].map(c => c.textContent);
  return {
    url: g('inUrl').value.trim(),
    bodyLen: g('inBody').value.trim().length,
    body80: g('inBody').value.trim().slice(0, 80),
    title: g('inTitle').value.trim(),
    cardTitle: g('txtTitle').value.trim(),
    kicker: g('txtKicker').value.trim(),
    summary: g('txtBody').value.trim(),
    credit: g('txtCredit').value.trim(),
    chipsTitle: chips('chipsTitle'),
    chipsHook: chips('chipsHook'),
    save: g('saveName').value.trim(),
    imgs: document.querySelectorAll('#gridArticle img').length,
    msg: g('fetchMsg').textContent,
    feed: localStorage.getItem('nb_feed_text') || '',
    navUrl: localStorage.getItem('nb_url') || '',
    ovColor: S.overlay.color,
    ovStrength: S.overlay.strength,
    titleSize: S.layers.title.size,
    bgSrc: S.bg.src,
  };
})()"""


def put(ch, el, value):
    ch.js("(() => { const e = document.getElementById(%s); e.value = %s; "
          "e.dispatchEvent(new Event('input', {bubbles:true})); })()"
          % (json.dumps(el), json.dumps(value)))


def fetch_url(ch, url, wait=90):
    put(ch, "inUrl", url)
    ch.js("document.getElementById('fetchMsg').textContent = '';"
          "document.getElementById('btnFetch').click();")
    t0 = time.time()
    while time.time() - t0 < wait:
        m = ch.js("document.getElementById('fetchMsg').textContent") or ""
        if "가져왔습니다" in m or "못" in m or "실패" in m or "입력" in m:
            return m
        time.sleep(0.4)
    return "(응답 없음)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0, help="이미 떠 있는 앱 포트")
    ap.add_argument("--show", action="store_true", help="크롬 창을 보이게")
    a = ap.parse_args()

    srv = None
    port = a.port
    if not port:
        port = 7899
        here = os.path.dirname(os.path.abspath(__file__))
        srv = subprocess.Popen([sys.executable, "-u", "app.py", "--no-browser",
                                "--port", str(port)], cwd=here,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(40):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/" % port, timeout=2)
                break
            except Exception:
                time.sleep(0.4)
    app = "http://127.0.0.1:%d/" % port
    print("앱 :", app)

    ch = insta.Chrome(port=CDP_PORT, profile=PROFILE)
    proc = None
    if ch.alive():
        print("🔴 %d 번을 이미 누가 쓰고 있습니다. 남의 크롬에 붙으면 그 사람 탭을\n"
              "   딴 데로 보내게 되니 그만둡니다(그 창을 닫고 다시 돌리세요)." % CDP_PORT)
        if srv:
            srv.terminate()
        sys.exit(2)
    os.makedirs(PROFILE, exist_ok=True)
    args = [insta.Chrome.find_chrome(), "--remote-debugging-port=%d" % CDP_PORT,
            "--user-data-dir=%s" % PROFILE, "--no-first-run",
            "--no-default-browser-check", "--disable-features=Translate",
            # 헤드리스의 '가려진 창' 타이머 늦춤이 저장 디바운스를 막는다 (거짓 실패 방지)
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding", "about:blank"]
    if not a.show:
        args.insert(1, "--headless=new")
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        if ch.alive():
            break
        time.sleep(0.4)
    ch.attach(match="about:blank", make=True, url=app)
    ch.send("Page.enable")
    ch.send("Page.bringToFront")    # 배경 탭이 되면 타이머가 얼어 거짓 실패 (스타일모드 시험 참고)
    ch.navigate(app, 3.0)
    # 앞선 시험이 남긴 것부터 턴다(지난 기사 흔적을 재는 시험이므로 출발선이 중요하다)
    ch.js("localStorage.clear(); sessionStorage.clear();")
    ch.navigate(app, 3.0)
    ch.js("window.confirm = () => true;")       # 창을 띄우면 CDP 가 막힌다

    try:
        print("\n[1] 첫 링크")
        fetch_url(ch, A)
        s1 = ch.js(SNAP)
        ck("첫 기사 본문이 들어왔다", s1["bodyLen"] > 300, s1["bodyLen"])
        ck("문구 후보가 생겼다", len(s1["chipsTitle"]) >= 3, len(s1["chipsTitle"]))
        ck("카드 제목이 채워졌다", bool(s1["cardTitle"]), s1["cardTitle"][:24])
        ck("저장 이름이 생겼다", s1["save"].startswith("뉴보대_"), s1["save"])

        print("\n[2] 두 번째 링크 — 여기가 막혀 있던 자리")
        fetch_url(ch, B)
        s2 = ch.js(SNAP)
        ck("본문이 새 기사로 바뀌었다", s2["body80"] != s1["body80"],
           "%d자 → %d자" % (s1["bodyLen"], s2["bodyLen"]))
        ck("원문 제목이 새 기사다", s2["title"] and s2["title"] != s1["title"], s2["title"][:24])
        ck("문구 후보가 새로 뽑혔다", s2["chipsTitle"] != s1["chipsTitle"])
        ck("카드 제목이 바뀌었다", s2["cardTitle"] != s1["cardTitle"], s2["cardTitle"][:24])
        ck("요약문이 바뀌었다", s2["summary"] != s1["summary"])
        ck("저장 이름이 새 기사로", s2["save"] != s1["save"], s2["save"])
        ck("직접 넣은 글 경고는 안 뜬다", "🔴" not in s2["msg"])

        print("\n[3] 세 번째 링크")
        fetch_url(ch, C)
        s3 = ch.js(SNAP)
        ck("또 바뀐다", s3["body80"] not in (s1["body80"], s2["body80"]), s3["bodyLen"])
        ck("문구 후보도 또 바뀐다", s3["chipsTitle"] not in (s1["chipsTitle"], s2["chipsTitle"]))

        print("\n[4] 첫 기사로 되돌아가기")
        fetch_url(ch, A)
        s4 = ch.js(SNAP)
        ck("첫 기사 본문이 그대로 돌아온다", s4["body80"] == s1["body80"])

        print("\n[5] 같은 링크를 두 번 눌러도 탈나지 않는다")
        fetch_url(ch, A)
        s5 = ch.js(SNAP)
        ck("본문 그대로", s5["body80"] == s1["body80"])
        ck("경고 없음", "🔴" not in s5["msg"])

        print("\n[6] 손으로 붙여 넣은 본문은 안 지운다(URL 막힌 언론사 길)")
        put(ch, "inBody", "사람이 손으로 붙여 넣은 본문입니다. " * 12)
        fetch_url(ch, B)
        s6 = ch.js(SNAP)
        ck("직접 넣은 글이 살아 있다", "손으로 붙여 넣은" in s6["body80"], s6["body80"][:30])
        ck("그 사실을 화면이 말한다", "🔴" in s6["msg"], s6["msg"][-60:])

        print("\n[7] 피드 글은 기사가 바뀌면 따라 바뀌지 않는다(다음 게시물 문구가 되면 안 된다)")
        ch.js("NAV.setFeedText('지난 기사로 쓴 피드 글');")
        fetch_url(ch, C)
        s7 = ch.js(SNAP)
        ck("지난 기사 피드 글이 비워졌다", s7["feed"] == "", repr(s7["feed"])[:40])

        print("\n[8] `새 기사` — 글·사진은 비우고 디자인은 남긴다")
        ch.js("document.querySelectorAll('#themes button')[1].click();")   # 네이비
        ch.js("document.getElementById('tSize').value = 120;"
              "document.getElementById('tSize').dispatchEvent(new Event('input',{bubbles:true}));")
        before = ch.js(SNAP)
        ch.js("document.getElementById('btnNew').click();")
        time.sleep(0.6)
        s8 = ch.js(SNAP)
        ck("링크 칸이 비었다", s8["url"] == "", s8["url"])
        ck("본문 칸이 비었다", s8["bodyLen"] == 0, s8["bodyLen"])
        ck("카드 글이 비었다", not (s8["cardTitle"] or s8["kicker"] or s8["summary"] or s8["credit"]))
        ck("문구 후보가 사라졌다", not s8["chipsTitle"] and not s8["chipsHook"])
        ck("기사 사진 목록이 비었다", s8["imgs"] == 0, s8["imgs"])
        ck("저장 이름이 비었다", s8["save"] == "", s8["save"])
        ck("배경 사진이 빠졌다", s8["bgSrc"] == "", s8["bgSrc"][:40])
        ck("이어가기 링크도 비었다", s8["navUrl"] == "")
        ck("🔑 색 테마는 그대로", s8["ovColor"] == before["ovColor"], s8["ovColor"])
        ck("🔑 어둡게 세기도 그대로", s8["ovStrength"] == before["ovStrength"])
        ck("🔑 글자 크기도 그대로", s8["titleSize"] == before["titleSize"], s8["titleSize"])

        print("\n[9] 비운 뒤에도 링크를 계속 넣을 수 있다")
        fetch_url(ch, B)
        s9 = ch.js(SNAP)
        ck("다시 기사가 들어온다", s9["bodyLen"] > 300, s9["bodyLen"])
        ck("그 기사 글이 맞다", s9["body80"] == s2["body80"])

        print("\n[10] `초기화` 는 여전히 디자인까지 되돌린다")
        ch.js("document.getElementById('btnReset').click();")
        time.sleep(0.6)
        s10 = ch.js(SNAP)
        # 기본 제목 크기는 11차(2026-08-12) 지마켓 산스 교체 때 86 → 84 가 됐다.
        # (이 줄이 86 인 채로 남아 있던 것 — 시험이 낡았던 것이지 앱 결함이 아니다)
        ck("디자인이 기본값으로", s10["ovColor"] == "#000000" and s10["titleSize"] == 84,
           "%s / %s" % (s10["ovColor"], s10["titleSize"]))
        ck("글도 비었다", s10["bodyLen"] == 0 and s10["url"] == "")

        print("\n[11] 피드 글 화면도 링크를 이어서 받는다")
        ch.navigate(app + "static/feed.html", 2.5)
        put(ch, "inUrl", A)
        ch.js("document.getElementById('btnFetch').click();")
        for _ in range(150):
            if "가져왔습니다" in (ch.js("document.getElementById('msg').textContent") or ""):
                break
            time.sleep(0.4)
        f1 = ch.js("({b:document.getElementById('inBody').value.trim(),"
                   "t:document.getElementById('inTitle').value.trim()})")
        ch.js("document.getElementById('out').value = '지난 기사로 만든 피드 글';"
              "document.getElementById('out').dispatchEvent(new Event('input',{bubbles:true}));")
        put(ch, "inUrl", B)
        ch.js("document.getElementById('btnFetch').click();")
        for _ in range(150):
            if "가져왔습니다" in (ch.js("document.getElementById('msg').textContent") or ""):
                break
            time.sleep(0.4)
        f2 = ch.js("({b:document.getElementById('inBody').value.trim(),"
                   "t:document.getElementById('inTitle').value.trim(),"
                   "out:document.getElementById('out').value,"
                   "feed:localStorage.getItem('nb_feed_text')||''})")
        ck("피드 글 화면 — 본문이 새 기사로", f2["b"][:80] != f1["b"][:80],
           "%d자 → %d자" % (len(f1["b"]), len(f2["b"])))
        ck("피드 글 화면 — 제목도 새 기사로", f2["t"] and f2["t"] != f1["t"], f2["t"][:24])
        ck("만들어 둔 글이 남아 다음 기사에 붙지 않는다", f2["out"] == "" and f2["feed"] == "")

    finally:
        print("\n%d개 중 %d개 통과" % (N[0], N[0] - len(FAIL)))
        for f in FAIL:
            print("  🔴 실패:", f)
        try:
            ch.js("window.close()")
        except Exception:
            pass
        if proc:
            proc.terminate()
        if srv:
            srv.terminate()
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
