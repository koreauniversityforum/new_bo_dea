# -*- coding: utf-8 -*-
"""릴스 화면·저장 API 와 포트 겹침 회귀 시험.

MediaRecorder 녹화 자체는 창(브라우저)에서만 돌아가므로 여기서는
① 화면이 제대로 서고 ② 저장 API 가 바이트를 온전히 받고 ③ 이상한 것을
거절하는지, 그리고 ④ 포트가 이미 쓰일 때 다음 번호로 비켜 가는지를 잰다.

④ 가 왜 시험거리인가: HTTPServer 기본값(SO_REUSEADDR)은 윈도우에서 **이미
쓰는 포트에도 그냥 붙는다.** 그래서 본판·pure 를 같이 켜면 두 번째 창이
첫 번째 프로세스의 화면을 보여 줬다(2026-08-14 실측). app.py 의
`allow_reuse_address = False` 가 이 병의 약이고, 여기가 재발 감시다.
"""
import sys, os, json, time, subprocess, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NB = r"C:\Users\박현수\Desktop\College\대학교\대외활동\2026\한대포 임시\뉴보대\newsfeed"
PORT = 7887          # 🔴 7897 이었는데 +1(7898)이 스타일모드 시험과 겹쳐 옮김
BASE = f"http://127.0.0.1:{PORT}"
OUT = os.path.join(NB, "out")

ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print(f"  o {name} {extra}")
    else: fail += 1; print(f"  X {name} {extra}")

def spawn(port):
    return subprocess.Popen([sys.executable, os.path.join(NB, "app.py"),
                             "--port", str(port), "--no-browser"],
                            cwd=NB, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def wait_up(base, tries=40):
    for _ in range(tries):
        try:
            urllib.request.urlopen(base + "/", timeout=2); return True
        except Exception:
            time.sleep(0.3)
    return False

p = spawn(PORT)
p2 = None
made = []                                   # 시험이 만든 파일(끝나면 지운다)
try:
    check("서버 기동", wait_up(BASE))

    # 1. 화면
    html = urllib.request.urlopen(BASE + "/static/reel.html", timeout=5).read().decode("utf-8")
    check("reel.html 200", "릴스 만들기" in html)
    for marker in ("MediaRecorder", "captureStream", "/api/reel-save",
                   "/api/insta-thumb", "1080", "1920",
                   # 자동 제작·편집 (2026-08-14 3차)
                   "btnAuto", "btnAutoAll", "autoPick", "scrub", "btnEdit",
                   # 관련 숏폼 연동 (2026-08-14 4차)
                   "/api/shorts", "관련 숏폼", "playWrap", "youtube-nocookie",
                   "instagram.com/explore/search", "btnDl"):
        check(f"reel.html 에 {marker}", marker in html)

    # 1-1. 관련 숏폼 API - 유튜브에서 4분 미만 영상을 실제로 추려 오는가
    j = json.loads(urllib.request.urlopen(
        BASE + "/api/shorts?q=" + urllib.parse.quote("반도체 수출"), timeout=30).read())
    check("shorts ok", j.get("ok") is True)
    items = j.get("items") or []
    check("shorts 결과 있음", len(items) >= 1, f"{len(items)}건")
    check("shorts 항목 꼴", all(i.get("id") and "secs" in i for i in items))
    check("shorts 숏폼만", all(i["secs"] <= 240 for i in items))
    check("shorts 빈 검색어는 빈 목록",
          json.loads(urllib.request.urlopen(BASE + "/api/shorts", timeout=10).read())
          .get("items") == [])
    nav = urllib.request.urlopen(BASE + "/static/nav.js", timeout=5).read().decode("utf-8")
    check("nav.js 에 릴스 링크", "/static/reel.html" in nav and "릴스 만들기" in nav)

    # 2. 저장 API - 진짜 바이트가 온전히 놓이는가
    payload = os.urandom(300_000)           # mp4 흉내(내용은 안 본다)
    save_url = BASE + "/api/reel-save?name=%s&ext=mp4" % urllib.parse.quote("시험릴스")
    req = urllib.request.Request(save_url, data=payload, method="POST")
    j = json.loads(urllib.request.urlopen(req, timeout=15).read())
    check("reel-save ok", j.get("ok"), str(j)[:80])
    name = j.get("name", "")
    made.append(name)
    check("이름 규칙", name.startswith("시험릴스_") and name.endswith(".mp4"), name)
    path = os.path.join(OUT, name)
    with open(path, "rb") as f:
        check("바이트 온전", f.read() == payload, f"{os.path.getsize(path)}B")

    # 같은 분(分)에 한 번 더 - 이름이 밀려야 한다
    j = json.loads(urllib.request.urlopen(urllib.request.Request(
        save_url, data=b"x" * 1000, method="POST"), timeout=15).read())
    made.append(j.get("name", ""))
    check("겹치면 번호 밀기", j.get("ok") and j["name"] not in ("", name), j.get("name", ""))

    # 3. 거절 - 이상한 확장자 / 빈 몸통
    def expect_err(url, data):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(
                url, data=data, method="POST"), timeout=10).read())
            return bool(r.get("error"))
        except urllib.error.HTTPError:
            return True
    check("exe 확장자 거절", expect_err(BASE + "/api/reel-save?name=x&ext=exe", b"abc"))
    check("빈 몸통 거절", expect_err(BASE + "/api/reel-save?name=x&ext=mp4", b""))

    # 4. 포트 겹침 회귀 - 같은 포트로 하나 더 띄우면 +1 로 비켜 가야 한다
    p2 = spawn(PORT)
    BASE2 = f"http://127.0.0.1:{PORT + 1}"
    check("둘째 서버가 다음 포트로", wait_up(BASE2, tries=40))
    # 첫 서버도 여전히 제 몫을 해야 한다(포트를 뺏기면 안 된다)
    j = json.loads(urllib.request.urlopen(BASE + "/api/config.js", timeout=5)
                   .read().decode("utf-8").split("=", 1)[1].rstrip(";"))
    check("첫 서버 살아 있음", j.get("pure") is False)
finally:
    for n in made:
        try:
            if n: os.remove(os.path.join(OUT, n))
        except OSError:
            pass
    p.terminate()
    if p2: p2.terminate()

print(f"\n결과: 통과 {ok} / 실패 {fail}")
sys.exit(1 if fail else 0)
