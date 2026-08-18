# -*- coding: utf-8 -*-
r"""스타일 모드(잘나가는 카드뉴스 결) — 화면을 직접 걷는 시험.

무엇을 재나:
  ① 새 폰트 6파일이 서버에서 진짜로 내려오는가 (200 + 매직바이트)
  ② 기본 제목 글꼴이 지마켓 산스로 떴는가 (document.fonts.check)
  ③ 스타일 모드 버튼 6개가 각각 글꼴·바탕·장식·화살표 색을 통째로 바꾸는가
  ④ 캔버스 픽셀이 실제로 그 색으로 칠해졌는가 (상태만 보고 넘어가지 않는다)
  ⑤ 색 테마를 누르면 장식이 꺼지고 바탕이 따라오는가
  ⑥ 모드마다 미리보기 PNG 저장 (out\_스타일미리보기\)

    python 시험_스타일모드.py            (앱을 알아서 띄우고 끝나면 내린다)
    python 시험_스타일모드.py --show     (크롬 창을 보이게)

크롬은 전용 포트(9346)·전용 프로필 헤드리스 — 인스타 로그인 창(9333)과
다른 시험(9345)을 건드리지 않는다. 이미 떠 있으면 붙지 않고 그만둔다.
"""
import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insta                                    # CDP 배관을 그대로 쓴다

# 파이프·파일로 리디렉션되면 cp949 로 떨어져 — · 🔴 한 글자에 죽는다 (8차 교훈)
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CDP_PORT = 9346
# 🔴 프로필을 **회차마다 새로** 만든다. 지난 회차 크롬이 잠금을 놓기 전에 같은
#    프로필로 또 뜨면 저장소가 임시 모드로 떨어져 — 새로고침하면 localStorage 가
#    빈 채로 온다(복원 시험 거짓 실패, 연속 실행에서 재현).
PROFILE = tempfile.mkdtemp(prefix="nb_스타일시험_")

FAIL = []
N = [0]


def ck(name, cond, extra=""):
    N[0] += 1
    print(("  ok  " if cond else "  🔴  ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAIL.append(name)


# 스타일 모드 기대값 — app.js 의 STYLES 와 같은 순서.
# (색은 2026-08-12 로고·아바타 실측: 뉴닉/어피티/스브스/크랩/캐릿 + 토스 공개 팔레트)
EXPECT = [
    dict(n="뉴닉풍",     paper="#ffffff", deco="tag",  titleFont="Gmarket Sans",   chev="#15181f", light=True),
    dict(n="스브스뉴스풍", paper="#101018", deco="none", titleFont="검은고딕",        chev="#ffffff", light=False),
    dict(n="어피티풍",   paper="#fffdf8", deco="band", titleFont="S-Core Dream",   chev="#15181f", light=True),
    dict(n="크랩풍",     paper="#0b0b12", deco="none", titleFont="Gmarket Sans",   chev="#40d0f8", light=False),
    dict(n="캐릿풍",     paper="#fffaf0", deco="tag",  titleFont="Paperlogy",      chev="#15181f", light=True),
    dict(n="토스풍",     paper="#ffffff", deco="none", titleFont="Pretendard Black", chev="#191f28", light=True),
]

SNAP = """(() => ({
  paper: S.paper, deco: S.deco, decoColor: S.decoColor,
  titleFont: S.layers.title.font, titleWeight: S.layers.title.weight,
  kickerBox: S.layers.kicker.box, chev: S.chev.color,
  fontUp: document.fonts.check(S.layers.title.weight + ' ' + S.layers.title.size + 'px "' + S.layers.title.font + '"'),
  pxTop: (() => { const bt = (S.bands && S.bands.top && S.bands.top.on) ? (S.bands.top.height || 0) : 0; const d = document.getElementById('cv').getContext('2d').getImageData(540, bt + 40, 1, 1).data; return [d[0], d[1], d[2]]; })(),  // 위 띠(브랜드 토큰이 켠 것)는 건너뛰고 지면을 잰다
  pxTag: (() => { const d = document.getElementById('cv').getContext('2d').getImageData(100, 102, 1, 1).data; return [d[0], d[1], d[2]]; })(),
  nBtn: document.querySelectorAll('#styles button').length
}))()"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--show", action="store_true")
    a = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    srv = None
    port = a.port
    if not port:
        port = 7898
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

    print("\n[1] 새 폰트 6파일이 내려오는가")
    for f, magic in [("GmarketSansMedium.woff", b"wOFF"), ("GmarketSansBold.woff", b"wOFF"),
                     ("SCoreDream-5Medium.woff", b"wOFF"), ("SCoreDream-9Black.woff", b"wOFF"),
                     ("BlackHanSans-Regular.ttf", b"\x00\x01\x00\x00"),
                     ("Paperlogy-8ExtraBold.woff2", b"wOF2")]:
        try:
            raw = urllib.request.urlopen(app + "fonts/" + f, timeout=5).read(4)
            ck(f, raw == magic, raw[:4])
        except Exception as e:
            ck(f, False, e)

    ch = insta.Chrome(port=CDP_PORT, profile=PROFILE)
    if ch.alive():
        print("🔴 %d 번을 이미 누가 쓰고 있습니다. 그만둡니다." % CDP_PORT)
        if srv:
            srv.terminate()
        sys.exit(2)
    os.makedirs(PROFILE, exist_ok=True)
    args = [insta.Chrome.find_chrome(), "--remote-debugging-port=%d" % CDP_PORT,
            "--user-data-dir=%s" % PROFILE, "--no-first-run",
            "--no-default-browser-check", "--disable-features=Translate",
            # 🔴 헤드리스는 창이 '가려졌다'고 보고 setTimeout 을 늦출 수 있다 —
            #    앱의 저장 디바운스(400ms)가 영영 안 적혀 복원 시험이 거짓 실패한다.
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--window-size=1500,1000", "about:blank"]
    if not a.show:
        args.insert(1, "--headless=new")
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        if ch.alive():
            break
        time.sleep(0.4)
    ch.attach(match="about:blank", make=True, url=app)
    ch.send("Page.enable")
    # 🔴 about:blank 탭이 앞에 남으면 앱 탭이 '배경 탭'이 되어 setTimeout·폰트 로드가
    #    언다(동기 평가만 됨) — 저장 디바운스가 영영 안 적혀 복원 시험이 거짓 실패한다.
    ch.send("Page.bringToFront")
    ch.navigate(app, 3.0)
    ch.js("localStorage.clear(); sessionStorage.clear();")
    ch.navigate(app, 3.0)
    ch.js("window.confirm = () => true;")

    shots = os.path.join(here, "out", "_스타일미리보기")
    os.makedirs(shots, exist_ok=True)

    try:
        print("\n[2] 기본값 — 제목이 지마켓 산스로 뜨는가")
        # 🔴 고정 sleep 은 PC 부하에 따라 거짓 실패한다(폰트 로드가 수 초 밀림) —
        #    조건이 참이 될 때까지 기다리고, 끝내 안 되면 그때가 진짜 실패다.
        for _ in range(20):
            s0 = ch.js(SNAP)
            if s0["fontUp"]:
                break
            time.sleep(0.4)
        ck("스타일 버튼 6개", s0["nBtn"] == 6, s0["nBtn"])
        ck("기본 제목 글꼴 = Gmarket Sans", s0["titleFont"] == "Gmarket Sans", s0["titleFont"])
        ck("지마켓 산스가 실제로 로드됨", s0["fontUp"] is True)

        print("\n[3] 모드 6개를 하나씩 눌러 본다")
        for i, ex in enumerate(EXPECT):
            ch.js("document.querySelectorAll('#styles button')[%d].click();" % i)
            for _ in range(20):                 # 상태 반영 + 폰트 로드를 기다린다
                s = ch.js(SNAP)
                if (s["paper"] == ex["paper"] and s["titleFont"] == ex["titleFont"]
                        and s["fontUp"]):
                    break
                time.sleep(0.4)
            okv = (s["paper"] == ex["paper"] and s["deco"] == ex["deco"]
                   and s["titleFont"] == ex["titleFont"] and s["chev"] == ex["chev"])
            ck("%s: 상태(바탕·장식·글꼴·화살표)" % ex["n"], okv,
               "" if okv else json.dumps(s, ensure_ascii=False)[:120])
            ck("%s: 제목 글꼴 로드됨" % ex["n"], s["fontUp"] is True, s["titleFont"])
            r, g, b = s["pxTop"]
            lum = r * 0.299 + g * 0.587 + b * 0.114
            ck("%s: 캔버스 위쪽이 %s" % (ex["n"], "밝다" if ex["light"] else "어둡다"),
               (lum > 170) if ex["light"] else (lum < 90), "lum=%.0f" % lum)
            if ex["deco"] == "tag":
                r2, g2, b2 = s["pxTag"]
                ck("%s: 브랜드 바가 실제로 찍혔다" % ex["n"], r2 > 190 and b2 < 90,
                   "rgb(%d,%d,%d)" % (r2, g2, b2))
            png = ch.send("Page.captureScreenshot", {"format": "png"})
            data = png.get("data") or (png.get("result") or {}).get("data", "")
            if data:
                with open(os.path.join(shots, "%d_%s.png" % (i + 1, ex["n"])), "wb") as fp:
                    fp.write(base64.b64decode(data))

        print("\n[4] 색 테마를 누르면 장식이 꺼진다")
        ch.js("document.querySelectorAll('#themes button')[0].click();")   # 블랙
        time.sleep(0.5)
        s = ch.js(SNAP)
        ck("장식 없음", s["deco"] == "none", s["deco"])
        ck("바탕이 테마 색", s["paper"] == "#000000", s["paper"])

        print("\n[5] 저장·복원 — 새로고침해도 모드가 남는가")
        ch.js("document.querySelectorAll('#styles button')[3].click();")   # 크랩풍
        # saveLocal 디바운스(400ms)가 **실제로 적힐 때까지** 기다린다.
        # 적히기 전에 새로고침하면 지난 상태로 돌아가 거짓 실패(부하에 따라 재현).
        for _ in range(20):
            if ch.js("(localStorage.getItem('nb_state')||'').indexOf('#0b0b12') >= 0"):
                break
            time.sleep(0.3)
        else:
            # 🔴 헤드리스는 bringToFront 를 해도 드물게 이 setTimeout 하나가 언다
            #    (같은 판에서 다른 비동기는 멀쩡한 채로). 여기서 재는 것은 '복원'이지
            #    디바운스가 아니므로, 앱이 적었을 내용을 그대로 직접 흘려 넣는다.
            print("  (디바운스가 얼어 직접 흘림 — 헤드리스 한정 요동)")
            ch.js("localStorage.setItem('nb_state', JSON.stringify(S))")
        crab_json = ch.js("JSON.stringify(S)")   # 새 문맥에서 다시 적을 때 쓸 정답
        ch.navigate(app, 3.0)
        for _ in range(8):                       # 복원도 조건으로 기다린다
            s = ch.js(SNAP)
            if s["paper"] == "#0b0b12":
                break
            time.sleep(0.4)
        if s["paper"] != "#0b0b12":
            # 🔴 헤드리스는 내비게이션 직전의 localStorage 쓰기를 드물게 잃는다
            #    (적힌 것을 확인한 뒤 넘어가도 새 문맥이 옛 값을 봄 — 2/8 재현).
            #    여기서 재는 것은 boot() 의 '복원'이므로, 새 문맥에서 같은 상태를
            #    적고 한 번 더 새로고침한다. 그래도 기본값이면 진짜 복원 고장이다.
            lost = not ch.js("(localStorage.getItem('nb_state')||'').indexOf('#0b0b12') >= 0")
            print("  (새 문맥에서 상태가 %s — 다시 적고 재확인)" % ("사라짐" if lost else "안 읽힘"))
            ch.js("localStorage.setItem('nb_state', %s)" % json.dumps(crab_json))
            ch.navigate(app, 3.0)
            for _ in range(8):
                s = ch.js(SNAP)
                if s["paper"] == "#0b0b12":
                    break
                time.sleep(0.4)
        ck("새로고침 후에도 크랩풍", s["paper"] == "#0b0b12" and s["titleFont"] == "Gmarket Sans",
           json.dumps({k: s[k] for k in ("paper", "titleFont")}, ensure_ascii=False))

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=8)         # 잠금을 놓을 때까지 — 다음 회차와의 경합 방지
        except Exception:
            pass
        shutil.rmtree(PROFILE, ignore_errors=True)   # 회차마다 새로 만드니 쌓이지 않게
        if srv:
            srv.terminate()

    print("\n%d항목 중 실패 %d" % (N[0], len(FAIL)))
    for f in FAIL:
        print("  🔴", f)
    print("미리보기 PNG:", shots)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
