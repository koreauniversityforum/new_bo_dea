# -*- coding: utf-8 -*-
r"""폰판의 「기사 URL 가져오기」 — 대리인(r.jina.ai)을 거쳐 실제 기사를 읽어 오는지 건다.

왜 따로 두나:
  이 길은 **우리 코드가 아니라 남의 서비스**(r.jina.ai)에 기댄다. 그쪽이 형식을 바꾸거나
  막으면 화면은 멀쩡한데 「가져오기」만 조용히 죽는다. 사람이 눈치채는 것은 한참 뒤다.
  그래서 언론사 4곳을 실제로 걸어 보고, 깨지면 여기서 먼저 운다.

무엇을 재나:
  ① 대리인이 CORS 로 우리를 허락하는가 — 헤더를 붙이면 프리플라이트(OPTIONS)가 뜬다
  ② 네이버·연합·한겨레·경향에서 제목·본문·사진이 나오는가
  ③ 출처(언론사)가 비지 않는가 — `og:site_name` 이 없어 대체 경로로 찾는 자리다
  ④ 요약기가 그 본문으로 제목·요약 후보를 만드는가
  ⑤ 본문 붙여넣기(대리인 없이 되는 길)는 여전히 되는가 — 대리인이 죽어도 이건 살아야 한다
  ⑥ 사진 — `proxy()` 가 감쌀 곳만 감싸는가, 기사 사진이 캔버스에 올라가고 **저장까지** 되는가
     (그려지는 것만 봐서는 모른다. 캔버스가 오염되면 `toDataURL` 에서야 터진다)

    python 시험_폰_기사가져오기.py

크롬은 전용 포트(9354)·회차별 새 프로필 헤드리스. 폰판은 7894 로 띄운다.
🔴 기사 주소는 시간이 지나면 사라진다. 그래서 **목록에서 그때그때 하나 집어** 쓴다.
"""
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insta

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
PORT_HTTP, PORT_CDP = 7894, 9354
UA = ("Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Mobile Safari/537.36")

FAIL, N = [], [0]


def ck(name, cond, extra=""):
    N[0] += 1
    print(("  ok  " if cond else "  \U0001f534  ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAIL.append(name)


def pick(list_url, pattern):
    """목록 화면에서 살아 있는 기사 주소를 하나 집는다(고정 주소는 언젠가 죽는다)."""
    try:
        req = urllib.request.Request(list_url, headers={"User-Agent": "Mozilla/5.0"})
        h = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "replace")
        m = re.findall(pattern, h)
        return m[0] if m else None
    except Exception:
        return None


def extract_js(url):
    """폰판 안에서 /api/extract 를 부른다 — 폰shim 이 가로채 대리인을 거친다."""
    return """(async () => {
      try {
        const r = await fetch('/api/extract', {method:'POST',
          headers:{'Content-Type':'application/json'}, body: JSON.stringify({url:%s})});
        const j = await r.json();
        return JSON.stringify({ok:!!j.ok, title:(j.title||'').slice(0,50),
          body:(j.body||'').length, images:(j.images||[]).length, press:j.press||'',
          titles:((j.analysis||{}).titles||[]).length,
          summaries:((j.analysis||{}).summaries||[]).length, err:(j.error||'').slice(0,140)});
      } catch(e) { return JSON.stringify({ok:false, err:'THROW '+e.message}); }
    })()""" % json.dumps(url)


class _H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DOCS, **k)

    def log_message(self, *a):
        pass


class _S(socketserver.TCPServer):
    # 🔴 True 로 두면 이미 떠 있는 다른 판이 이 포트를 쥐고 있어도 조용히 붙어,
    #    엉뚱한 화면을 시험하게 된다(본판/pure 포트 겹침 때 겪은 그 함정). 겹치면 터뜨린다.
    allow_reuse_address = False


def main():
    if not os.path.isdir(DOCS):
        print("\U0001f534 docs/ 가 없습니다. `python 폰판_만들기.py` 를 먼저 돌리세요.")
        return 2

    print("[1] 대리인이 우리를 허락하는가 (CORS)")
    art = pick("https://news.naver.com/section/102",
               r"https://n\.news\.naver\.com/mnews/article/\d+/\d+")
    ck("네이버 목록에서 기사 주소를 집었다", bool(art), art)
    if not art:
        return 2
    try:
        req = urllib.request.Request("https://r.jina.ai/" + art, method="OPTIONS", headers={
            "Origin": "https://koreauniversityforum.github.io",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-return-format"})
        r = urllib.request.urlopen(req, timeout=30)
        allow_o = r.headers.get("access-control-allow-origin") or ""
        allow_h = (r.headers.get("access-control-allow-headers") or "").lower()
        ck("프리플라이트(OPTIONS) 200", r.status == 200, r.status)
        ck("우리 주소를 허락한다",
           "koreauniversityforum.github.io" in allow_o or allow_o == "*", allow_o)
        ck("x-return-format 헤더를 허락한다", "x-return-format" in allow_h, allow_h)
    except Exception as e:
        ck("프리플라이트", False, e)

    srv = _S(("127.0.0.1", PORT_HTTP), _H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    app = "http://127.0.0.1:%d/index.html" % PORT_HTTP

    profile = tempfile.mkdtemp(prefix="nb_폰기사시험_")
    ch = insta.Chrome(port=PORT_CDP, profile=profile)
    if ch.alive():
        print("\U0001f534 %d 번을 이미 누가 쓰고 있습니다. 그만둡니다." % PORT_CDP)
        srv.shutdown()
        return 2
    proc = subprocess.Popen(
        [insta.Chrome.find_chrome(), "--headless=new",
         "--remote-debugging-port=%d" % PORT_CDP, "--user-data-dir=%s" % profile,
         "--no-first-run", "--no-default-browser-check", "--window-size=412,915", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        if ch.alive():
            break
        time.sleep(0.4)

    try:
        ch.attach(match="about:blank", make=True, url="about:blank")
        ch.send("Page.enable")
        # 폰인 척한다 — 폰shim 이 UA 로 갈라지지는 않지만 폰 폭에서 걸어야 한다
        ch.send("Emulation.setUserAgentOverride", {"userAgent": UA, "platform": "Android"})
        ch.send("Emulation.setDeviceMetricsOverride",
                {"width": 412, "height": 915, "deviceScaleFactor": 2.6, "mobile": True})
        ch.navigate(app, wait=5.0)

        print("\n[2] 껍데기")
        ck("폰shim 이 fetch 를 가로챘다", ch.js("typeof window.__nbdFetch") == "function")
        ck("요약기가 실렸다", ch.js("typeof window.SUMMARIZER") == "object")
        ck("가져오기 단추가 폰에도 있다", ch.js(
            "(()=>{const b=document.querySelector('#btnFetch'); return !!b && b.offsetParent!==null;})()"))

        print("\n[3] 언론사별로 실제 기사를 읽어 온다")
        sites = [
            ("네이버", art),
            ("연합뉴스", pick("https://www.yna.co.kr/news", r"https://www\.yna\.co\.kr/view/AKR\d+")),
            ("한겨레", pick("https://www.hani.co.kr/arti/society/",
                            r"https://www\.hani\.co\.kr/arti/[a-z_/]+/\d+\.html")),
            ("경향신문", pick("https://www.khan.co.kr/national/",
                              r"https://www\.khan\.co\.kr/article/\d+")),
        ]
        for name, url in sites:
            if not url:
                ck("%s 기사 주소 집기" % name, False, "목록에서 못 찾음(사이트 개편?)")
                continue
            got = ch.js(extract_js(url), timeout=120)
            try:
                j = json.loads(got)
            except Exception:
                ck("%s 가져오기" % name, False, got)
                continue
            ck("%s — 가져왔다" % name, j.get("ok"), j.get("err") or "")
            ck("%s — 본문 300자 이상" % name, j.get("body", 0) >= 300, str(j.get("body")) + "자")
            ck("%s — 제목이 있다" % name, len(j.get("title") or "") >= 5, j.get("title"))
            ck("%s — 출처(언론사)가 비지 않았다" % name, bool(j.get("press")), j.get("press"))
            ck("%s — 문구 후보가 나왔다" % name,
               j.get("titles", 0) >= 3 and j.get("summaries", 0) >= 1,
               "제목 %s · 요약 %s" % (j.get("titles"), j.get("summaries")))

        print("\n[4] 대리인이 죽어도 살아야 하는 길 — 본문 붙여넣기")
        paste = ch.js("""(async () => {
          const r = await fetch('/api/analyze', {method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({text:'대학생 절반이 학자금 대출을 받고 있다는 조사가 나왔다. '.repeat(8),
                                  title:'학자금'})});
          const j = await r.json();
          return JSON.stringify({ok:!!j.ok, t:((j.analysis||{}).titles||[]).length});
        })()""", timeout=40)
        pj = json.loads(paste)
        ck("붙여넣기는 대리인 없이도 된다", pj.get("ok") and pj.get("t", 0) >= 3, paste)

        print("\n[5] 사진 — 감쌀 곳만 감싸는가")
        # 이미 CORS 를 주는 곳까지 감싸면, 지금 잘 되는 사진 검색이 남의 서비스와 함께 죽는다
        for label, url, want_wrap in [
            ("언론사 사진(CORS 없음)", "https://imgnews.pstatic.net/image/a.png?type=w800", True),
            ("위키미디어(CORS 줌)", "https://upload.wikimedia.org/wikipedia/commons/thumb/x.jpg", False),
            ("Openverse(CORS 줌)", "https://api.openverse.org/v1/images/abc/thumb/", False),
            ("내 사진(data:)", "data:image/png;base64,AAA", False),
            ("내 사진(blob:)", "blob:http://x/y", False),
            ("이미 감싼 주소", "https://wsrv.nl/?url=https%3A%2F%2Fa.com%2Fb.png", False),
        ]:
            out = ch.js("proxy(%s)" % json.dumps(url))
            wrapped = str(out).startswith("https://wsrv.nl/?url=") and out != url
            ck("%s — %s" % (label, "감싼다" if want_wrap else "그대로 둔다"),
               wrapped == want_wrap, str(out)[:70])

        print("\n[6] 기사 사진을 캔버스에 얹고 저장까지 (오염되면 여기서 터진다)")
        shot = ch.js("""(async () => {
          try {
            const r = await fetch('/api/extract', {method:'POST',
              headers:{'Content-Type':'application/json'}, body: JSON.stringify({url:%s})});
            const j = await r.json();
            if (!j.ok || !(j.images||[]).length)
              return JSON.stringify({ok:false, err:'기사에 사진이 없다: ' + (j.error||'')});
            const im = await loadImage(proxy(j.images[0]));
            const c = document.createElement('canvas'); c.width = 200; c.height = 200;
            c.getContext('2d').drawImage(im, 0, 0, 200, 200);
            try { c.toDataURL('image/png'); }
            catch (e) { return JSON.stringify({ok:false, err:'캔버스 오염 — ' + e.message}); }
            return JSON.stringify({ok:true, size: im.naturalWidth + 'x' + im.naturalHeight});
          } catch (e) { return JSON.stringify({ok:false, err:String(e.message||e)}); }
        })()""" % json.dumps(art), timeout=120)
        sj = json.loads(shot)
        ck("기사 사진이 캔버스에 올라가고 저장된다", sj.get("ok"), sj.get("err") or sj.get("size"))

        print("\n[7] 사진 검색 결과도 캔버스에 올라가는가 (대리인 없이)")
        found = ch.js("""(async () => {
          const r = await fetch('/api/stock?provider=wikimedia&q=university');
          const j = await r.json();
          if (!j.ok || !(j.items||[]).length) return JSON.stringify({ok:false, err:j.error||'결과 없음'});
          const src = proxy(j.items[0].full || j.items[0].thumb);
          try {
            const im = await loadImage(src);
            const c = document.createElement('canvas'); c.width = 100; c.height = 100;
            c.getContext('2d').drawImage(im, 0, 0, 100, 100);
            c.toDataURL('image/png');
            return JSON.stringify({ok:true, n:j.items.length, viaProxy: src.indexOf('wsrv') >= 0});
          } catch (e) { return JSON.stringify({ok:false, err:String(e.message||e)}); }
        })()""", timeout=90)
        fj = json.loads(found)
        ck("위키미디어 사진이 캔버스에 올라가고 저장된다", fj.get("ok"), fj.get("err") or ("%s장" % fj.get("n")))
        ck("위키미디어는 대리인을 거치지 않는다", fj.get("ok") and not fj.get("viaProxy"), fj.get("viaProxy"))
    finally:
        try:
            ch.close()
        except Exception:
            pass
        proc.terminate()
        srv.shutdown()

    print("\n총 %d항목 · 실패 %d항목" % (N[0], len(FAIL)))
    for f in FAIL:
        print("  \U0001f534 " + f)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
