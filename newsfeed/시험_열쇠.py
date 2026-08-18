# -*- coding: utf-8 -*-
"""공개 주소용 열쇠 문(--key) 시험.

Cloudflare Tunnel 로 앱을 인터넷에 내걸 때만 쓰는 문이다. 재는 것:
① --key 를 안 주면 문이 아예 없다(기본 꺼짐 - PC·exe 회귀)
② 열쇠 없이 오면 401 / 틀린 열쇠도 401
③ 맞는 열쇠(?key=)면 쿠키를 심고 key 를 뗀 주소로 303
④ 쿠키가 있으면 GET·POST 다 통과, 없으면 POST 도 401
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NB = os.path.dirname(os.path.abspath(__file__))
PORT_OPEN = 7861          # 문 없는 판
PORT_KEY = 7862           # 문 있는 판 (다른 시험 포트 7885/7887/7894/7898 과 안 겹침)
# 🔴 열쇠는 영문·숫자만 - 한글이면 ① URL 은 quote 없이 ascii 인코딩으로 죽고
#    ② Set-Cookie 헤더도 한글 값은 브라우저마다 다르게 다룬다
KEY = "test-key-abc123"

ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    if cond: ok += 1; print(f"  o {name} {extra}")
    else: fail += 1; print(f"  X {name} {extra}")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None

OPEN = urllib.request.build_opener(NoRedirect)

def get(url, cookie=None):
    """(상태코드, 머리글, 몸통) - 301/401 도 값으로 돌려준다."""
    req = urllib.request.Request(url)
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        r = OPEN.open(req, timeout=10)
        return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

def spawn(port, key=None):
    args = [sys.executable, os.path.join(NB, "app.py"),
            "--port", str(port), "--no-browser"]
    if key:
        args += ["--key", key]
    return subprocess.Popen(args, cwd=NB, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def wait_up(port, path="/", cookie=None):
    for _ in range(40):
        try:
            code, _h, _b = get(f"http://127.0.0.1:{port}{path}", cookie)
            if code:
                return code
        except Exception:
            pass
        time.sleep(0.3)
    return 0

p1 = spawn(PORT_OPEN)
p2 = spawn(PORT_KEY, key=KEY)
try:
    # ① 기본은 문 없음
    check("문 없는 판 기동+통과", wait_up(PORT_OPEN) == 200)

    base = f"http://127.0.0.1:{PORT_KEY}"
    check("열쇠 판 기동(401)", wait_up(PORT_KEY) == 401)

    # ② 열쇠 없이 / 틀린 열쇠
    code, _h, body = get(base + "/")
    check("열쇠 없이 401", code == 401 and "열쇠".encode() in body or code == 401)
    code, _h, _b = get(base + "/?key=wrong-key")
    check("틀린 열쇠 401", code == 401)
    code, _h, _b = get(base + "/api/insta-status")
    check("API 도 401", code == 401)

    # ③ 맞는 열쇠 → 쿠키 + 303
    from urllib.parse import quote
    code, h, _b = get(base + "/?key=" + quote(KEY))
    setc = h.get("Set-Cookie", "")
    check("맞는 열쇠 303", code == 303, code)
    check("쿠키 심음", setc.startswith("nbkey="), setc[:40])
    check("key 뗀 주소로", h.get("Location") == "/")
    cookie = setc.split(";")[0]

    # ④ 쿠키로 GET·POST 통과, 쿠키 없이 POST 401
    code, _h, body = get(base + "/static/reel.html", cookie)
    check("쿠키로 화면 200", code == 200 and "릴스".encode() in body)
    req = urllib.request.Request(base + "/api/insta-stage",
                                 data=json.dumps({"items": []}).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Cookie": cookie}, method="POST")
    try:
        r = OPEN.open(req, timeout=10)
        code, body = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, body = e.code, e.read()
    check("쿠키로 POST 통과(401 아님)", code != 401, code)
    req = urllib.request.Request(base + "/api/insta-stage",
                                 data=b"{}", method="POST")
    try:
        r = OPEN.open(req, timeout=10)
        code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    check("쿠키 없이 POST 401", code == 401)
finally:
    p1.terminate()
    p2.terminate()

print(f"\n결과: 통과 {ok} / 실패 {fail}")
sys.exit(1 if fail else 0)
