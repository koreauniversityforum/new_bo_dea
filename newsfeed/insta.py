# -*- coding: utf-8 -*-
"""인스타그램 연동 — 크롬을 직접 몰아서 게시한다 (설치 0개).

## 왜 이 방식인가
공식 경로인 Instagram Graph API 는 ① 프로페셔널 계정 전환 ② Meta 앱 등록
③ 이미지가 **공개 HTTPS 주소**에 올라가 있어야 함(바이트 업로드 불가) 이 셋을 요구한다.
우리 도구는 노트북에서 도는 로컬 서버라 ③이 특히 걸린다. 그래서 우선 브라우저 경로로 만든다.

## 어떻게
`pip install` 없이 크롬만 있으면 된다. 크롬을 `--remote-debugging-port` 로 띄우고
**CDP(Chrome DevTools Protocol)** 로 명령한다. 웹소켓 클라이언트도 여기 직접 넣었다
(배포본의 임베디드 파이썬에는 `websocket-client` 가 없기 때문 — 있으면 그걸 쓰고
없으면 이 구현으로 돈다).

🔑 파일 업로드의 열쇠는 `DOM.setFileInputFiles` 다. 이걸 쓰면 **윈도우 파일 선택창이
아예 안 뜬다.** 창이 뜨면 그 순간부터 브라우저가 우리 명령을 못 받으니(모달), 클릭으로
파일을 고르는 방식은 애초에 자동화가 안 된다.

## 알고 쓸 것
- 인스타 웹 화면은 예고 없이 바뀐다. 그래서 요소를 **후보 여럿으로 찾고**, 못 찾으면
  조용히 넘어가지 않고 어디서 막혔는지 이름을 붙여 실패한다. 엉뚱한 걸 누르는 것보다 낫다.
- 로그인은 이 파일이 하지 않는다. 전용 크롬 프로필을 띄워 주고 **사람이 직접** 로그인한다.
  한 번 하면 프로필에 남아 다음부터는 그냥 열린다.
- 자동화는 인스타 약관 밖이고 새 계정은 제한이 걸릴 수 있다. `dry_run=True` 가 기본이며
  마지막 `공유하기` 는 명시적으로 켜야 눌린다.
"""
import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))

# 로그인이 남는 전용 크롬 프로필.
# 🔴 앱 폴더 안에 두면 안 된다 — 실측 70MB 이고, 배포본 ZIP 을 다시 만들 때
#    그대로 딸려 들어가 남의 로그인 흔적까지 퍼진다. 사용자 폴더에 둔다.
PROFILE = os.path.join(os.environ.get("LOCALAPPDATA")
                       or os.path.expanduser("~"), "뉴보대", "chrome_insta")
PORT = 9333                                      # 사용자의 평소 크롬과 안 겹치게
IG = "https://www.instagram.com/"

CHROMES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
]


class InstaError(Exception):
    """어디서 막혔는지 이름을 달고 올라오는 실패."""


# ────────────────────────────────────────────────── 최소 웹소켓
class _WS:
    """CDP 한 채널만 쓰는 최소 웹소켓 클라이언트 (RFC 6455).

        - 클라이언트 프레임은 **반드시 마스킹**해야 한다(안 하면 크롬이 끊는다).
        - CDP 응답은 쉽게 64KB 를 넘으므로 길이 126/127 확장과 조각(continuation)을
          둘 다 처리해야 한다. 여기서 자르면 큰 DOM 을 읽을 때만 터진다.
    """

    def __init__(self, url, timeout=30):
        if not url.startswith("ws://"):
            raise InstaError("웹소켓 주소가 아님: %s" % url)
        rest = url[5:]
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            "GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n"
            "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n" % (path, hostport, key)
        )
        self.sock.sendall(req.encode())
        head = self._read_until(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise InstaError("웹소켓 업그레이드 거절: %r" % head[:120])
        want = base64.b64encode(hashlib.sha1(
            (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        if want.lower().encode() not in head.lower():
            raise InstaError("Sec-WebSocket-Accept 불일치")
        self._buf = b""

    def _read_until(self, marker):
        buf = b""
        while marker not in buf:
            b = self.sock.recv(4096)
            if not b:
                raise InstaError("연결이 끊김(핸드셰이크)")
            buf += b
        return buf

    def _recv_exact(self, n):
        while len(self._buf) < n:
            b = self.sock.recv(65536)
            if not b:
                raise InstaError("연결이 끊김(수신)")
            self._buf += b
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def send(self, text):
        payload = text.encode("utf-8")
        n = len(payload)
        head = bytearray([0x81])                      # FIN + text
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        head += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(head) + masked)

    def recv(self):
        """텍스트 한 통을 문자열로. 조각나 있으면 이어 붙인다."""
        chunks = []
        while True:
            b0, b1 = self._recv_exact(2)
            fin = b0 & 0x80
            op = b0 & 0x0F
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recv_exact(8))[0]
            data = self._recv_exact(n) if n else b""
            if op == 0x8:
                raise InstaError("크롬이 웹소켓을 닫음")
            if op == 0x9:                             # ping → pong
                self.sock.sendall(b"\x8a\x80" + os.urandom(4))
                continue
            if op == 0xA:
                continue
            chunks.append(data)
            if fin:
                return b"".join(chunks).decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


# ────────────────────────────────────────────────── 크롬 몰기
class Chrome:
    def __init__(self, port=PORT, profile=PROFILE):
        self.port = port
        self.profile = profile
        self.ws = None
        self._id = 0
        self.proc = None

    # -- 띄우기 --------------------------------------------------------
    @staticmethod
    def find_chrome():
        for p in CHROMES:
            if os.path.isfile(p):
                return p
        raise InstaError("크롬을 못 찾았습니다. 설치 경로를 확인해 주세요.")

    def alive(self):
        try:
            self._http("/json/version")
            return True
        except Exception:
            return False

    def launch(self, url=IG, wait=25):
        """이미 떠 있으면 그대로 쓴다. 없으면 전용 프로필로 새로 띄운다."""
        if self.alive():
            return False
        os.makedirs(self.profile, exist_ok=True)
        args = [
            self.find_chrome(),
            "--remote-debugging-port=%d" % self.port,
            "--user-data-dir=%s" % self.profile,
            "--no-first-run", "--no-default-browser-check",
            # 자동화 배너와 기본 프로필 간섭을 줄인다
            "--disable-features=Translate,OptimizationHints",
            url,
        ]
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
        t0 = time.time()
        while time.time() - t0 < wait:
            if self.alive():
                return True
            time.sleep(0.4)
        raise InstaError("크롬이 디버깅 포트(%d)를 안 열었습니다." % self.port)

    # -- CDP -----------------------------------------------------------
    def _http(self, path, timeout=4, method="GET"):
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (self.port, path),
                                     method=method)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8")
        return json.loads(body) if body.strip().startswith(("{", "[")) else {}

    def targets(self):
        return [t for t in self._http("/json/list") if t.get("type") == "page"]

    def attach(self, match="instagram.com", make=True, url=None):
        """찾는 주소의 탭에 붙는다. 없으면 아무 탭에 붙어 그 주소로 옮긴다.

        🔴 `/json/new?url=` 로 새 탭을 만들면 최신 크롬은 **405 Method Not Allowed**
        를 준다(GET 을 막고 PUT 만 받는다). 굳이 새 탭을 만들 필요도 없으니
        **있는 탭에 붙어 Page.navigate** 하는 쪽이 판 바뀜에 강하다.
        """
        for t in self.targets():
            if match in (t.get("url") or ""):
                self.ws = _WS(t["webSocketDebuggerUrl"])
                self.target = t
                return t
        if not make:
            raise InstaError("'%s' 탭이 없습니다." % match)
        pages = self.targets()
        if not pages:                        # 탭이 하나도 없을 때만 새로 만든다
            try:
                self._http("/json/new?" + urllib.parse.quote(url or IG, safe=":/"),
                           method="PUT")
            except Exception as e:
                raise InstaError("새 탭을 못 만들었습니다: %s" % e)
            time.sleep(2.0)
            return self.attach(match, make=False)
        self.ws = _WS(pages[0]["webSocketDebuggerUrl"])
        self.target = pages[0]
        self.send("Page.enable")
        self.navigate(url or IG, 3.0)
        return self.target

    def send(self, method, params=None, timeout=30):
        if not self.ws:
            raise InstaError("탭에 붙지 않았습니다 (attach 먼저).")
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method,
                                 "params": params or {}}, ensure_ascii=False))
        t0 = time.time()
        while time.time() - t0 < timeout:
            msg = json.loads(self.ws.recv())
            if msg.get("id") != mid:        # 이벤트는 흘려보낸다
                continue
            if "error" in msg:
                raise InstaError("%s: %s" % (method, msg["error"].get("message")))
            return msg.get("result", {})
        raise InstaError("%s 응답이 없습니다(%ds)." % (method, timeout))

    def js(self, expr, timeout=30):
        """페이지에서 자바스크립트를 돌리고 값을 받아온다."""
        r = self.send("Runtime.evaluate", {
            "expression": expr, "awaitPromise": True, "returnByValue": True,
            "userGesture": True,
        }, timeout=timeout)
        if r.get("exceptionDetails"):
            raise InstaError("JS 실패: %s" % json.dumps(
                r["exceptionDetails"].get("exception", {}).get("description", ""),
                ensure_ascii=False)[:300])
        return r.get("result", {}).get("value")

    def navigate(self, url, wait=3.0):
        self.send("Page.navigate", {"url": url})
        time.sleep(wait)

    def set_files(self, css, paths):
        """숨은 file input 에 파일을 직접 꽂는다 — 윈도우 선택창을 띄우지 않는다.

        🔴 `DOM.getDocument(depth=0)` + `DOM.querySelector` 는 nodeId 0 을 돌려준다.
        얕게 받으면 자식이 DOM 에이전트에 매핑되지 않기 때문(실측). 그래서
        **JS 로 요소를 잡아 objectId 를 받고 `DOM.requestNode` 로 nodeId 로 바꾼다.**
        이 길은 늦게 붙는 요소·shadow DOM 에도 통한다.
        """
        r = self.send("Runtime.evaluate", {
            "expression": "document.querySelector(%s)" % json.dumps(css)})
        obj = (r.get("result") or {}).get("objectId")
        if not obj:
            raise InstaError("파일 입력칸을 못 찾음: %s" % css)
        # requestNode 는 노드 맵이 서 있어야 답한다. getDocument 를 한 번 불러
        # 뿌리를 잡아 주지 않으면 nodeId 0 이 온다(실측).
        self.send("DOM.getDocument", {"depth": 1})
        nid = self.send("DOM.requestNode", {"objectId": obj}).get("nodeId")
        if not nid:
            raise InstaError("파일 입력칸을 노드로 못 바꿈: %s" % css)
        self.send("DOM.setFileInputFiles", {
            "nodeId": nid, "files": [os.path.abspath(p) for p in paths]})

    def close(self):
        if self.ws:
            self.ws.close()
            self.ws = None


# ────────────────────────────────────────────────── 화면에서 요소 찾기
# 인스타 화면은 자주 바뀐다. 한 가지 선택자에 걸지 않고 **글자·역할·후보 여럿**으로
# 찾는다. 못 찾으면 어떤 후보를 봤는지 같이 돌려줘서 다음에 고칠 수 있게 한다.
_FIND = r"""
(function(){
  window.__nb = {
    vis(el){ if(!el) return false; const r=el.getBoundingClientRect();
      const s=getComputedStyle(el);
      return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; },
    // 🔴 찾는 범위를 **열린 대화상자 안으로 한정**한다.
    // 문서 전체에서 '다음'을 찾으면 피드·추천계정 쪽 버튼까지 집어서
    // 만들기 창을 벗어난다(실측: 5번 누르고 탐색 화면으로 튀었다).
    root(){
      const dl = Array.from(document.querySelectorAll('div[role="dialog"]')).filter(d=>this.vis(d));
      return dl.length ? dl[dl.length-1] : document;
    },
    all(){ return Array.from(this.root().querySelectorAll('button,div[role="button"],a[role="link"],a,span')); },
    byText(words){
      const w = words.map(s=>s.toLowerCase());
      return this.all().filter(el=>{
        if(!this.vis(el)) return false;
        const t=(el.innerText||el.textContent||'').trim().toLowerCase();
        if(!t || t.length>24) return false;
        return w.some(x=>t===x || t.startsWith(x));
      });
    },
    byAria(words){
      const w = words.map(s=>s.toLowerCase());
      return Array.from(this.root().querySelectorAll('[aria-label]')).filter(el=>{
        if(!this.vis(el)) return false;
        const t=(el.getAttribute('aria-label')||'').toLowerCase();
        return w.some(x=>t.includes(x));
      });
    },
    click(el){
      if(!el) return false;
      el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect();
      const o={bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2};
      for(const k of ['pointerdown','mousedown','pointerup','mouseup','click'])
        el.dispatchEvent(new (k.startsWith('pointer')?PointerEvent:MouseEvent)(k,o));
      return true;
    },
    hit(words){
      let c = this.byAria(words); if(!c.length) c = this.byText(words);
      // 가장 안쪽에 있는 것을 누른다 — 겉의 큰 div 를 누르면 아무 일도 안 나는 경우가 있다
      c.sort((a,b)=>b.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_CONTAINED_BY?-1:1);
      return c[0]||null;
    },
    seen(){ return this.all().filter(e=>this.vis(e))
      .map(e=>(e.getAttribute('aria-label')||e.innerText||'').trim())
      .filter(t=>t&&t.length<24).slice(0,60); }
  };
  return true;
})()
"""


# 문구칸 찾기. 판마다 `textarea` 이거나 `contenteditable div` 라서 둘 다 본다.
# 찾은 요소를 `window.__capEl` 에 남겨 두면 뒤에서 다시 찾지 않아도 된다.
_CAP_FIND = r"""
(function(){
  const cands = [
    'textarea[aria-label*="문구"]',
    'div[contenteditable="true"][aria-label*="문구"]',
    'textarea[placeholder*="문구"]',
    'div[role="textbox"][contenteditable="true"]',
    'textarea',
  ];
  const root = (window.__nb && window.__nb.root) ? window.__nb.root() : document;
  for(const s of cands){
    for(const el of root.querySelectorAll(s)){
      if(window.__nb && !window.__nb.vis(el)) continue;
      window.__capEl = el;
      return {found:true, how:s, tag:el.tagName};
    }
  }
  window.__capEl = null;
  return {found:false};
})()
"""


def _prep(ch):
    ch.js(_FIND)


def crop_ratio(ch):
    """자르기 화면에서 **실제로 잘려 나갈 틀**의 가로/세로. 못 재면 None.

    이것이 결과물의 비율이다(공유 화면의 미리보기 칸이 아니다 — 그쪽은 좁게
    보여 주기만 한다). 1080×1350 카드는 0.800 이 나와야 안 잘린다.
    """
    v = ch.js("""(function(){
      for(const el of window.__nb.root().querySelectorAll('div')){
        const r = el.getBoundingClientRect();
        if(r.width < 180 || r.height < 180) continue;
        if(getComputedStyle(el).backgroundImage === 'none') continue;
        return Math.round(r.width / r.height * 1000) / 1000;
      }
      return null;
    })()""")
    return v


def pick_crop(ch, want=("원본", "original")):
    """자르기 화면에서 비율을 **또박또박 골라 둔다.** 고른 이름을 돌려준다.

    인스타는 대개 원본 비율로 열어 주지만(실측: 1080×1350 을 넣으면 처음부터 0.800),
    **지난번에 1:1 을 골랐으면 그 선택을 기억한다.** 그때 `다음` 만 누르고 지나가면
    화면은 멀쩡히 넘어가고 **결과만 잘린다** — 조용히 틀리는 쪽이라 명시적으로 고른다.

    손잡이는 `aria-label="자르기 선택"` 이 붙은 **svg** 이고, 누를 수 있는 것은 그
    조상 버튼이다(svg 를 그대로 누르면 아무 일도 안 난다). 누르면 원본·1:1·4:5·16:9
    가 열린다(실측).
    """
    opened = ch.js("""(function(){
      const s=[...window.__nb.root().querySelectorAll('[aria-label*="자르기"]')]
              .filter(e=>window.__nb.vis(e))[0];
      if(!s) return false;
      const t=s.closest('button,[role="button"],div[tabindex]') || s.parentElement;
      return window.__nb.click(t);
    })()""")
    if not opened:
        raise InstaError("자르기 손잡이를 못 찾았습니다.")
    time.sleep(1.0)
    _prep(ch)
    got = ch.js("""(function(words){
      for(const w of words){
        const el = window.__nb.hit([w]);
        if(el){ window.__nb.click(el); return w; }
      }
      return null;
    })(%s)""" % json.dumps(list(want), ensure_ascii=False))
    if not got:
        seen = ch.js("JSON.stringify(window.__nb.seen())")
        raise InstaError("자르기 목록에서 %s 을(를) 못 찾았습니다. 보이던 것: %s"
                         % ("/".join(want), seen))
    time.sleep(1.0)
    # 🔴 고른 뒤에도 목록이 떠 있으면 그 다음 `다음` 한 번을 목록 닫는 데 써 버린다.
    #    실측으로 `다음` 이 2번에서 3번으로 늘었다. 열었던 손잡이를 다시 눌러 닫는다.
    _prep(ch)
    still = ch.js("""(function(){ return window.__nb.byText(['1:1']).length > 0; })()""")
    if still:
        ch.js("""(function(){
          const s=[...window.__nb.root().querySelectorAll('[aria-label*="자르기"]')]
                  .filter(e=>window.__nb.vis(e))[0];
          if(!s) return false;
          const t=s.closest('button,[role="button"],div[tabindex]') || s.parentElement;
          return window.__nb.click(t);
        })()""")
        time.sleep(0.8)
    return got


def _click(ch, words, what, wait=1.2):
    ok = ch.js("window.__nb.click(window.__nb.hit(%s))" % json.dumps(words, ensure_ascii=False))
    if not ok:
        seen = ch.js("JSON.stringify(window.__nb.seen())")
        raise InstaError("'%s' 를 못 찾았습니다. 화면에 보이던 것: %s" % (what, seen))
    time.sleep(wait)
    return True


# ────────────────────────────────────────────────── 상태 / 게시
def status(ch=None):
    """로그인 됐는지, 누구로 됐는지."""
    own = ch is None
    ch = ch or Chrome()
    try:
        if not ch.alive():
            return {"chrome": False, "logged_in": False,
                    "hint": "크롬을 먼저 띄워야 합니다 (launch)."}
        ch.attach()
        ch.send("Page.enable")
        ch.send("Runtime.enable")
        # 🔴 갓 띄운 크롬은 about:blank / 새 탭에 있고, 그 문서에서는 document.cookie 를
        #    읽으면 SecurityError 가 난다. 인스타 위에 올라가 있는지 먼저 확인한다.
        if "instagram.com" not in (ch.js("location.href") or ""):
            ch.navigate(IG, 4.0)
        _prep(ch)
        info = ch.js("""(function(){
          let ds = false;
          try { ds = /ds_user_id=\\d+/.test(document.cookie); } catch(e) { ds = false; }
          const login = !!document.querySelector('input[name="username"]');
          let who = null;
          // 왼쪽 메뉴의 내 프로필 링크. 화면 판에 따라 자리가 달라 후보를 넓게 본다.
          for (const im of document.querySelectorAll('img[alt*="프로필 사진"]')) {
            const a = im.closest('a[href^="/"]');
            if (a && /^\\/[A-Za-z0-9._]+\\/$/.test(a.getAttribute('href'))) {
              who = a.getAttribute('href').replace(/\\//g, ''); break;
            }
          }
          return {ds:ds, loginForm:login, who:who, url:location.href};
        })()""")
        return {"chrome": True, "logged_in": bool(info["ds"]) and not info["loginForm"],
                "user": info.get("who"), "url": info.get("url")}
    finally:
        if own:
            ch.close()


def post_carousel(files, caption, dry_run=True, ch=None, log=None, expect_ratio=None):
    """캐러셀 게시. dry_run 이면 `공유하기` 바로 앞에서 멈춘다.

    files 는 1~10 장, **전부 같은 비율**이어야 한다(인스타가 첫 장 기준으로 자른다).
    `expect_ratio` 를 주면(첫 장의 가로/세로) 자르기 틀이 그것과 같은지 대조해
    다르면 로그로 알린다 — 잘리는 것은 눈으로 놓치기 쉽다.
    """
    say = log or (lambda *a: None)
    files = [os.path.abspath(f) for f in files]
    if not files:
        raise InstaError("올릴 그림이 없습니다.")
    if len(files) > 10:
        raise InstaError("캐러셀은 최대 10장입니다 (%d장 주셨습니다)." % len(files))
    for f in files:
        if not os.path.isfile(f):
            raise InstaError("파일이 없습니다: %s" % f)

    own = ch is None
    ch = ch or Chrome()
    steps = []

    def step(name):
        steps.append(name)
        say(name)

    try:
        ch.launch()
        ch.attach()
        ch.send("Page.enable")
        ch.send("Runtime.enable")
        ch.send("DOM.enable")
        _prep(ch)

        st = status(ch)
        if not st.get("logged_in"):
            raise InstaError("로그인이 안 돼 있습니다. 열린 크롬 창에서 "
                             "@news_univ 로 직접 로그인한 뒤 다시 눌러 주세요.")
        step("로그인 확인 (%s)" % (st.get("user") or "계정 확인됨"))

        # 지난 실행이 중간에 멈췄으면 만들기 창이 열린 채 남는다. 그 상태에서
        # 다시 시작하면 '만들기'를 못 찾거나 엉뚱한 화면에서 진행된다 → 항상 새로 연다.
        ch.navigate(IG, 3.5)
        _prep(ch)
        step("피드로 되돌려 깨끗한 상태에서 시작")

        _click(ch, ["만들기", "새로운 게시물", "create", "new post"], "만들기 버튼")
        step("만들기 열기")

        # 파일 선택창을 띄우지 않고 숨은 input 에 바로 꽂는다
        ch.set_files('input[type="file"][accept*="image"], input[type="file"]', files)
        step("그림 %d장 넣기" % len(files))
        time.sleep(2.5)
        _prep(ch)

        # 자르기 — **재 보고, 틀릴 때만 고친다.**
        # 눈으로 보면 공유 화면의 좁은 미리보기에 속는다(실제로 한 번 속아서 멀쩡한 것을
        # 잘렸다고 판단했다). 결과를 정하는 것은 자르기 화면의 틀이므로 그것을 잰다.
        # 맞는데도 손대면 목록을 여닫느라 `다음` 한 번을 더 쓰게 된다(실측 2→3).
        off = lambda a, b: (b and abs(a - b) / b > 0.02)
        ratio, crop = crop_ratio(ch), None
        if ratio is None:
            step("자르기 틀을 못 쟀습니다 — 창에서 눈으로 확인해 주세요.")
        elif not off(ratio, expect_ratio):
            crop = "그대로"
            step("자르기 틀 %s — 원본과 같아 손대지 않음" % ratio)
        else:
            step("자르기 틀 %s 이 원본 %.3f 과 다릅니다 — 원본으로 고칩니다."
                 % (ratio, expect_ratio))
            try:
                crop = pick_crop(ch)
                ratio = crop_ratio(ch)
            except InstaError as e:
                step("🔴 자르기 손잡이를 못 다뤘습니다: %s" % e)
            if off(ratio or 0, expect_ratio):
                crop = None                     # 화면이 이걸 보고 경고한다
                step("🔴 아직 틀이 %s 입니다(원본 %.3f) — 이대로 올리면 잘립니다. "
                     "크롬 창에서 자르기 아이콘을 눌러 직접 고르세요." % (ratio, expect_ratio))
            else:
                step("자르기: %s 으로 맞춤 (틀 %s)" % (crop, ratio))
        _prep(ch)

        # 자르기 → 편집 → 문구. 화면 수가 판마다 다르다.
        # 🔴 '다음'을 정해진 횟수만큼 눌러 버리면 안 된다 — 실측으로 4번을 눌러
        #    문구 화면을 지나쳐 버렸다. **문구칸이 나타났는지 매번 확인**하고 멈춘다.
        for i in range(5):
            if ch.js(_CAP_FIND + ".found"):
                break
            try:
                _click(ch, ["다음", "next"], "다음 버튼", wait=1.8)
                step("다음 (%d)" % (i + 1))
            except InstaError:
                break
        if not ch.js(_CAP_FIND + ".found"):
            seen = ch.js("JSON.stringify(window.__nb.seen())")
            raise InstaError("문구 입력칸이 안 나왔습니다. 화면에 보이던 것: %s" % seen)

        # 🔴 문구칸에 값을 **자바스크립트로 밀어 넣으면 안 된다.**
        #    `value` 를 직접 세팅하거나 `execCommand('insertText')` 를 쓰면 실측으로
        #    1자만 들어갔다(인스타 문구칸은 리액트가 상태를 들고 있어서, 화면의 글자와
        #    리액트가 아는 값이 갈린다). **CDP `Input.insertText`** 는 브라우저 층에서
        #    실제 입력으로 넣어 주므로 리액트가 그대로 받아들인다.
        ch.js("window.__capEl.focus(); window.__capEl.click(); true")
        ch.send("Input.insertText", {"text": caption})
        time.sleep(1.0)
        wrote = ch.js("""(function(){
          const t = window.__capEl;
          if(!t) return 0;
          const v = (t.tagName === 'TEXTAREA') ? t.value : t.innerText;
          return (v || '').replace(/\\u200b/g, '').length;
        })()""")
        if not wrote or wrote < len(caption) * 0.9:
            raise InstaError("문구가 제대로 안 들어갔습니다 (%s자만 들어감 / %d자 넣으려 함)."
                             % (wrote, len(caption)))
        step("문구 %d자 입력 (칸에 %s자 확인)" % (len(caption), wrote))

        if dry_run:
            step("여기서 멈춤 — `공유하기` 는 누르지 않았습니다 (시험 실행)")
            return {"ok": True, "dry_run": True, "steps": steps, "crop": crop}

        _click(ch, ["공유하기", "share"], "공유하기 버튼", wait=4.0)
        step("공유하기 눌렀음")
        time.sleep(4.0)
        done = ch.js("""(function(){
          return /게시물이 공유되었습니다|shared/i.test(document.body.innerText);
        })()""")
        step("게시 확인: %s" % ("확인됨" if done else "화면에서 확인 문구를 못 봤음"))
        return {"ok": True, "dry_run": False, "confirmed": bool(done),
                "steps": steps, "crop": crop}
    finally:
        if own:
            ch.close()


if __name__ == "__main__":
    import sys

    ch = Chrome()
    if "--자기시험" in sys.argv or "--selftest" in sys.argv:
        # 인스타 없이 배관만 확인한다: 띄우기 → 붙기 → JS 왕복
        made = ch.launch("https://example.com")
        ch.attach("example.com")
        ch.send("Runtime.enable")
        print("크롬 새로 띄움:", made)
        print("제목:", ch.js("document.title"))
        print("긴 값 왕복:", len(ch.js("'가'.repeat(200000)")))
        ch.close()
    else:
        ch.launch()
        print(json.dumps(status(ch), ensure_ascii=False, indent=2))
        ch.close()
