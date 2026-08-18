# -*- coding: utf-8 -*-
r"""릴스 만들기 — 화면을 직접 걸어 **실제 녹화까지** 하는 시험.

시험_릴스.py 는 서버 쪽(저장 API·포트)만 잰다. 여기는 헤드리스 크롬으로
reel.html 을 열어 카드를 담고 [릴스 만들기] 를 눌러 MediaRecorder 가 진짜
영상 blob 을 만드는지, 저장을 누르면 out\ 에 파일이 놓이는지까지 걷는다.

    python 시험_릴스화면.py           (앱을 알아서 띄우고 끝나면 내린다)
    python 시험_릴스화면.py --show    (크롬 창을 보이게)

크롬은 전용 CDP 포트(9347)·전용 프로필 — 인스타 로그인(9333)·다른 시험
(9345/9346)과 분리. 이미 떠 있으면 붙지 않고 그만둔다(9차 교훈).
녹화 mime 은 엔진마다 다르다(mp4 또는 webm) — 어느 쪽이든 통과, 로그로 남긴다.
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insta                                    # CDP 배관을 그대로 쓴다

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CDP_PORT = 9347
PROFILE = os.path.join(os.environ.get("TEMP", "."), "nb_릴스시험_프로필")
APP_PORT = 7887          # 시험_릴스.py 와 같은 앱 번호(둘을 동시에 돌리지 않는다)

FAIL = []


def ck(name, cond, extra=""):
    print(("  ok  " if cond else "  🔴  ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAIL.append(name)


# 2x2 빨간 PNG — 담을 카드 흉내(릴스는 어차피 늘려 그린다)
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGP8z8Dwn4EBAAf8"
    "Av6nS0GWAAAAAElFTkSuQmCC")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true")
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    stage = os.path.join(here, "out", "_임시_인스타")
    app = "http://127.0.0.1:%d/" % APP_PORT

    srv = subprocess.Popen([sys.executable, "-u", "app.py", "--no-browser",
                            "--port", str(APP_PORT)], cwd=here,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc = None
    staged_name = None
    made_reel = None
    made_reel2 = None
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(app, timeout=2)
                break
            except Exception:
                time.sleep(0.4)

        # 1. 시험 카드를 임시 자리에 담는다 (화면과 같은 길 - /api/insta-stage)
        body = json.dumps({"items": [{
            "name": "릴스시험카드",
            "dataUrl": "data:image/png;base64," + base64.b64encode(TINY_PNG).decode(),
        }]}).encode()
        j = json.loads(urllib.request.urlopen(urllib.request.Request(
            app + "api/insta-stage", data=body,
            headers={"Content-Type": "application/json"}), timeout=10).read())
        ck("시험 카드 담김", j.get("ok") and j.get("names"), j.get("names"))
        staged_name = (j.get("names") or [None])[-1]

        # 2. 헤드리스 크롬으로 reel.html 을 연다
        ch = insta.Chrome(port=CDP_PORT, profile=PROFILE)
        if ch.alive():
            print("🔴 %d 번을 이미 누가 쓰고 있습니다. 그만둡니다." % CDP_PORT)
            sys.exit(2)
        os.makedirs(PROFILE, exist_ok=True)
        args = [insta.Chrome.find_chrome(), "--remote-debugging-port=%d" % CDP_PORT,
                "--user-data-dir=%s" % PROFILE, "--no-first-run",
                "--no-default-browser-check", "--disable-features=Translate",
                # 헤드리스의 '가려진 창' 타이머 늦춤 방지 (녹화 타이머 거짓 실패)
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--window-size=1500,1000", "about:blank"]
        if not a.show:
            args.insert(1, "--headless=new")
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL)
        for _ in range(50):
            if ch.alive():
                break
            time.sleep(0.4)
        reel = app + "static/reel.html"
        ch.attach(match="about:blank", make=True, url=reel)
        ch.send("Page.enable")
        ch.send("Page.bringToFront")   # 배경 탭이 되면 타이머가 얼어 거짓 실패 (스타일모드 시험 참고)
        ch.navigate(reel, 3.0)

        # 3. 담은 카드를 골라 목록에 넣는다
        for _ in range(20):
            n = ch.js("document.querySelectorAll('#src img').length")
            if n:
                break
            time.sleep(0.5)
        ck("고르기 화면에 그림이 뜸", n >= 1, n)

        # 3-0. 자동 담기 — 임시 카드가 있으니 그것부터 담아야 한다 (3차 기능)
        ch.js("document.getElementById('btnAuto').click()")
        auto_n = 0
        for _ in range(20):
            auto_n = ch.js("picked.length")
            if auto_n:
                break
            time.sleep(0.4)
        ck("자동 담기(임시 세트)", auto_n >= 1, auto_n)
        ch.js("picked = []; drawPicked(); preview();")   # 수동 담기 시험을 위해 비운다

        ch.js("document.querySelector(\"#src img[title='%s']\").click()" % staged_name)
        for _ in range(20):
            ready = ch.js("picked.length === 1 && !!picked[0].bg")
            if ready:
                break
            time.sleep(0.4)
        ck("담기 + 흐린 바탕 준비", bool(ready))
        ck("만들기 단추 살아남", ch.js("!document.getElementById('btnMake').disabled"))

        # 4. 짧게 잡고 녹화한다 (한 장 1.5초 + 끝 0.4초)
        ch.js("document.getElementById('firstS').value = 1.5")
        ch.js("document.getElementById('btnMake').click()")
        done = False
        for _ in range(40):                     # 녹화는 실제 시간 + 여유
            done = ch.js("document.getElementById('btnSave').style.display !== 'none'")
            if done:
                break
            time.sleep(0.5)
        ck("녹화가 끝남", done, ch.js("document.getElementById('msg').textContent"))
        size = ch.js("blob ? blob.size : 0")
        ext = ch.js("blobExt")
        ck("영상 blob 생김", size and size > 5000, "%s · %sB" % (ext, size))

        # 5. 저장을 눌러 out\ 에 놓이는지
        before = set(os.listdir(os.path.join(here, "out")))
        ch.js("document.getElementById('btnSave').click()")
        saved = False
        for _ in range(20):
            msg = ch.js("document.getElementById('msg').textContent")
            if "저장했습니다" in (msg or ""):
                saved = True
                break
            time.sleep(0.5)
        ck("저장 완료 안내", saved, msg)
        new = [n for n in os.listdir(os.path.join(here, "out"))
               if n not in before and n.startswith("릴스")]
        ck("out 에 릴스 파일", len(new) == 1, new)
        if new:
            made_reel = os.path.join(here, "out", new[0])
            ck("파일 크기 = blob 크기", os.path.getsize(made_reel) == size,
               os.path.getsize(made_reel))

        # 6. 자동 제작(3차) — 편집으로 돌아가 단추 하나로 녹화→자동 저장까지
        before2 = set(os.listdir(os.path.join(here, "out")))
        ch.js("document.getElementById('btnEdit').click()")
        ch.js("document.getElementById('btnAutoAll').click()")
        saved2 = False
        for _ in range(40):
            msg2 = ch.js("document.getElementById('msg').textContent")
            if "저장했습니다" in (msg2 or ""):
                saved2 = True
                break
            time.sleep(0.5)
        ck("자동 제작 = 녹화 뒤 자동 저장", saved2, msg2)
        new2 = [n for n in os.listdir(os.path.join(here, "out"))
                if n not in before2 and n.startswith("릴스")]
        ck("자동 제작 파일이 out 에", len(new2) == 1, new2)
        if new2:
            made_reel2 = os.path.join(here, "out", new2[0])
    finally:
        if proc:
            proc.terminate()
        srv.terminate()
        # 시험이 만든 것만 치운다 (사용자가 담아 둔 카드는 안 건드린다)
        if staged_name:
            try:
                os.remove(os.path.join(stage, staged_name))
            except OSError:
                pass
        for f in (made_reel, made_reel2):
            if f:
                try:
                    os.remove(f)
                except OSError:
                    pass

    print("\n" + ("전부 통과" if not FAIL else "실패 %d: %s" % (len(FAIL), FAIL)))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
