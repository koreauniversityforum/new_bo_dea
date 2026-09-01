# -*- coding: utf-8 -*-
"""뉴보대 카드뉴스 메이커 - 로컬 서버 (표준 라이브러리 전용).

  python app.py                    # 전용 창으로 뜬다 (주소창·탭 없음)
  python app.py --browser          # 평소 쓰는 브라우저 탭으로 (되돌림용)
  python app.py --port 7871 --no-browser
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai  # noqa: E402
import appwindow  # noqa: E402
import daily  # noqa: E402
import extractor  # noqa: E402
import feed  # noqa: E402
import hub  # noqa: E402
import related  # noqa: E402
import summarizer  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))


def _find_base():
    """만든 것이 쌓이는 자리(`out\\` · 오류기록 · 첫게시물…)를 정한다.

    exe 로 묶으면 화면 파일은 exe 안(`_MEIPASS`)으로 들어가지만 **결과물은 밖에
    남아야 한다.** 그렇다고 exe 옆에 두면 다시 구울 때마다 `앱\\` 이 통째로 지워져
    저장한 카드가 날아간다. 그래서 위로 올라가며 이미 쓰던 `newsfeed` 를 찾고,
    없을 때(남에게 준 exe)만 exe 옆을 쓴다.
    """
    if not getattr(sys, "frozen", False):
        return ROOT                           # 소스로 돌 때는 지금까지와 똑같다
    here = os.path.dirname(os.path.abspath(sys.executable))
    d = here
    for _ in range(4):                        # 앱\<이름>\exe → 뉴보대\newsfeed
        cand = os.path.join(d, "newsfeed")
        if os.path.isdir(cand):
            return cand
        up = os.path.dirname(d)
        if up == d:
            break
        d = up
    return here


BUNDLE = getattr(sys, "_MEIPASS", ROOT)       # 화면·폰트·로고 (읽기만 한다)
BASE = _find_base()                           # 결과물 (쓴다)

STATIC = os.path.join(BUNDLE, "static")
ASSETS = os.path.join(BUNDLE, "assets")
FONTS = os.path.join(BUNDLE, "fonts")
OUT = os.path.join(BASE, "out")
# 저장하지 않고 올릴 때 쓰는 임시 자리. `out\` 바로 아래 폴더라 저장 목록에는 안 낀다
# (`_out_list` 는 파일만 센다).
STAGE = os.path.join(OUT, "_임시_인스타")
os.makedirs(OUT, exist_ok=True)
os.makedirs(ASSETS, exist_ok=True)

SAFE_NAME = re.compile(r'[\\/:*?"<>|\r\n\t]')


def _studio_exe():
    """동봉한 Shortform Studio 실행 파일을 찾는다. 없으면 None.

    찾는 순서: ① NB_SHORTFORM_EXE 환경변수 ② exe 옆 shortform\\ (배포본)
    ③ 뉴보대\\앱\\<판>\\shortform\\ (소스로 돌 때) ④ ~/shortform-studio/dist*/win-unpacked
    (개발 PC, 가장 최근 빌드). 🔴 PyInstaller 는 앱 폴더를 통째로 지우고 다시 만드니
    shortform\\ 은 **빌드 뒤에** 다시 복사해 넣어야 한다.
    """
    cands = []
    env = os.environ.get("NB_SHORTFORM_EXE")
    if env:
        cands.append(env)
    if getattr(sys, "frozen", False):
        here = os.path.dirname(os.path.abspath(sys.executable))
        cands.append(os.path.join(here, "shortform", "Shortform Studio.exe"))
    app_root = os.path.join(os.path.dirname(BASE), "앱")
    for name in ("뉴보대 카드뉴스 메이커", "뉴보대 카드뉴스 메이커 (pure)"):
        cands.append(os.path.join(app_root, name, "shortform", "Shortform Studio.exe"))
    dev = os.path.join(os.path.expanduser("~"), "shortform-studio")
    if os.path.isdir(dev):
        try:
            dists = [d for d in os.listdir(dev) if d.startswith("dist")]
            dists.sort(key=lambda d: os.path.getmtime(os.path.join(dev, d)), reverse=True)
            for d in dists:
                cands.append(os.path.join(dev, d, "win-unpacked", "Shortform Studio.exe"))
        except OSError:
            pass
    for c in cands:
        if os.path.isfile(c):
            return c
    return None

VERBOSE = False          # --verbose 로 켠다. 아래 log_message 주석 참고.

# ── pure 판 (스타일 모드 없는 기본 디자인 전용) ─────────────────────────────
# 소스를 가르지 않는다 — 같은 코드가 스위치 하나로 두 판이 된다.
#   · 소스 실행:  python app.py --pure   또는  NB_PURE=1
#   · exe:        exe 파일 이름에 pure 가 들어 있으면 그 판이다
#                 (pure 전용 exe 는 이름만 다르게 다시 구운 같은 빌드다)
# 화면은 /api/config.js 로 이 값을 받아 스타일 모드 UI 를 만들지 않는다.
# ── 열쇠 (공개 주소용 문) ────────────────────────────────────────────────
#   Cloudflare Tunnel 같은 **공개 주소** 뒤에 세울 때만 --key 로 켠다.
#   이 앱은 로그인이 없고 /api/proxy(임의 URL 대리 요청)·저장 API 가 있어서
#   아무나 닿는 곳에 열쇠 없이 내걸면 안 된다. 기본은 꺼짐 - PC·exe 는 그대로.
#   쓰는 법: 주소 뒤에 ?key=열쇠 를 붙여 한 번 들어오면 쿠키(1년)로 기억한다.
KEY = None

PURE = (os.environ.get("NB_PURE") == "1"
        or (getattr(sys, "frozen", False)
            and "pure" in os.path.basename(sys.executable).lower()))
ERRLOG = os.path.join(BASE, "오류기록.txt")
_ERRLOCK = threading.Lock()


def log_exc(where=""):
    """오류 자취를 **창이 아니라 파일에** 남긴다.

    🔴 요청을 처리하는 스레드는 창(콘솔)에 한 글자도 쓰면 안 된다. 이유는 아래
    Handler.log_message 주석 참고 — 창이 막히면 쓰던 스레드가 통째로 멈춘다.
    창에 찍고 싶으면 `--verbose`.
    """
    try:
        with _ERRLOCK:
            # 오래 쓰면 무한정 커지므로 1MB 넘으면 새로 시작한다
            try:
                if os.path.getsize(ERRLOG) > 1_000_000:
                    os.remove(ERRLOG)
            except OSError:
                pass
            with open(ERRLOG, "a", encoding="utf-8") as f:
                f.write("\n[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), where))
                traceback.print_exc(file=f)
    except Exception:
        pass                                  # 기록에 실패해도 요청은 계속돼야 한다
    if VERBOSE:
        try:
            traceback.print_exc()
        except Exception:
            pass


def disable_quickedit():
    """윈도우 콘솔의 **빠른 편집(QuickEdit)** 을 끈다.

    켜져 있으면 창 안을 무심코 클릭하는 것만으로 글자가 선택되고, 그동안 그 창으로
    나가는 출력이 전부 멈춘다. 앱이 멎어 보이는 진짜 뿌리다. 시작할 때 꺼 둔다.
    (그래도 창 글자를 복사하고 싶으면 창 제목 우클릭 → 편집 → 표시)
    """
    if os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        # 🔴 restype/argtypes 를 반드시 지정한다. 안 하면 실패를 성공처럼 읽는다.
        k.GetStdHandle.restype = wintypes.HANDLE
        k.GetStdHandle.argtypes = [wintypes.DWORD]
        k.GetConsoleMode.restype = wintypes.BOOL
        k.GetConsoleMode.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        k.SetConsoleMode.restype = wintypes.BOOL
        k.SetConsoleMode.argtypes = [wintypes.HANDLE, wintypes.DWORD]

        h = k.GetStdHandle(-10)               # STD_INPUT_HANDLE
        if not h or h == wintypes.HANDLE(-1).value:
            return False                      # 창 없이 띄운 경우(pythonw 등)
        mode = wintypes.DWORD()
        if not k.GetConsoleMode(h, ctypes.byref(mode)):
            return False                      # 콘솔이 아님(파이프로 넘긴 경우)
        QUICK_EDIT, EXTENDED = 0x0040, 0x0080
        new = (mode.value & ~QUICK_EDIT) | EXTENDED
        if new == mode.value:
            return True
        return bool(k.SetConsoleMode(h, new))
    except Exception:
        return False


for _ext, _mime in ((".otf", "font/otf"), (".ttf", "font/ttf"),
                    (".woff", "font/woff"), (".woff2", "font/woff2")):
    mimetypes.add_type(_mime, _ext)


class Handler(BaseHTTPRequestHandler):
    server_version = "NewsCardMaker/1.0"

    # ── 공통 ──────────────────────────────────────────────────────────
    def log_message(self, fmt, *args):
        """요청 기록은 **기본으로 찍지 않는다.**

        🔴 이유 — 윈도우 콘솔(검은 창)은 사용자가 창 안을 클릭해 글자가 선택된 상태가
        되면 출력이 **막힌다**. 그때 요청마다 콘솔에 쓰면 처리 스레드가 전부 거기서
        멈춰, 서버가 포트는 듣고 있는데 아무 응답도 못 하는 상태가 된다.
        실측으로 이 증상을 두 번 겪었다(바로가기로 띄웠을 때만, 출력을 파일로 돌리면 멀쩡).

        볼 일이 있으면 `--verbose` 로 켠다.
        """
        if VERBOSE:
            try:
                sys.stderr.write("  %s\n" % (fmt % args))
            except Exception:
                pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError):
            pass

    def _err(self, msg, code=400):
        self._send(code, {"ok": False, "error": str(msg)})

    def _json_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        # utf-8-sig: 일부 도구가 붙이는 BOM 까지 흡수한다 (브라우저는 안 붙임)
        return json.loads(self.rfile.read(n).decode("utf-8-sig"))

    # ── 열쇠 문 (공개 주소용, --key 를 줄 때만) ───────────────────────
    def _key_gate(self, u):
        """열쇠가 켜져 있으면 들여보낼지 정한다. True = 여기서 응답을 끝냈다.

        ?key=열쇠 가 맞으면 쿠키를 심고 key 를 뗀 같은 주소로 돌려보낸다
        (주소창에 열쇠가 남아 실수로 공유되는 것을 줄인다). 쿠키가 있으면 통과.
        """
        if not KEY:
            return False
        qk = (parse_qs(u.query).get("key") or [""])[0]
        if qk == KEY:
            self.send_response(303)
            self.send_header("Set-Cookie",
                             "nbkey=%s; Path=/; Max-Age=31536000; SameSite=Lax" % KEY)
            self.send_header("Location", u.path or "/")
            self.end_headers()
            return True
        if ("nbkey=" + KEY) in (self.headers.get("Cookie") or ""):
            return False
        self._send(401, {"ok": False,
                         "error": "열쇠가 필요합니다. 주소 뒤에 ?key=열쇠 를 붙여 "
                                  "한 번 들어오면 이 기기는 기억됩니다."})
        return True

    # ── GET ───────────────────────────────────────────────────────────
    def do_GET(self):
        u = urlparse(self.path)
        if self._key_gate(u):
            return
        q = parse_qs(u.query)
        # 파일 이름이 한글이면 브라우저가 %EB%89%B4… 로 바꿔 보낸다. 되돌려 놔야 찾는다.
        path = unquote(u.path)
        try:
            if path in ("/", "/index.html"):
                return self._file(os.path.join(STATIC, "index.html"))
            if path == "/favicon.ico":
                # 전용 창의 제목줄·작업표시줄 아이콘이 된다. 없으면 404 로 두면 되고
                # 그때는 엔진의 밋밋한 기본 아이콘이 붙는다(앱이 죽지는 않는다).
                ico = appwindow.icon_path(BUNDLE, BASE)
                return self._file(ico) if ico else self._err("not found", 404)
            if path.startswith("/static/"):
                return self._file(os.path.join(STATIC, os.path.basename(path)))
            if u.path == "/api/proxy":
                return self._proxy(q)
            if u.path == "/api/stock":
                return self._stock(q)
            if u.path == "/api/assets":
                return self._assets()
            if path.startswith("/assets/"):
                return self._file(os.path.join(ASSETS, os.path.basename(path)))
            if path.startswith("/fonts/"):
                return self._file(os.path.join(FONTS, os.path.basename(path)))
            if u.path == "/api/open-out":
                os.startfile(OUT)  # noqa: S606 (사용자 PC 로컬 전용)
                return self._send(200, {"ok": True})
            if u.path == "/api/out-list":
                return self._out_list()
            if u.path == "/api/insta-files":
                return self._insta_files()
            if u.path == "/api/insta-thumb":
                return self._insta_thumb(q)
            if u.path == "/api/insta-texts":
                return self._insta_texts()
            if u.path == "/api/insta-status":
                return self._insta_status()
            if u.path == "/api/config.js":
                # 화면이 <script src> 로 **동기** 로드한다 — app.js 가 스타일 모드
                # 단추를 만들기 전에 값이 있어야 해서 fetch(비동기)로는 안 된다.
                return self._send(200, "window.NB_CONFIG = %s;"
                                  % json.dumps({"pure": PURE}),
                                  "application/javascript; charset=utf-8")
            if u.path == "/api/topic-ideas":
                return self._topic_ideas(q)
            if u.path == "/api/shorts":
                return self._shorts(q)
            if u.path == "/api/shortform-status":
                return self._shortform_status()
            if u.path == "/api/publish-status":
                return self._publish_status()
            if u.path == "/api/daily":
                return self._daily(u)
            if u.path == "/api/hub-sources":
                return self._send(200, {"ok": True, "groups": hub.GROUP_ORDER,
                                        "sources": hub.listing(use="news")})
            return self._err("not found", 404)
        except Exception as e:
            log_exc("GET %s" % self.path)
            return self._err(e, 500)

    # ── POST ──────────────────────────────────────────────────────────
    def do_POST(self):
        u = urlparse(self.path)
        if self._key_gate(u):
            return
        try:
            if u.path == "/api/shortform-launch":
                return self._shortform_launch()
            if u.path == "/api/reel-save":
                # 🔴 다른 POST 와 달리 본문이 JSON 이 아니라 **영상 바이트 그대로**다.
                # base64 로 싸면 30MB 영상이 40MB 글자가 된다 — 이름·확장자만 쿼리로.
                return self._reel_save(parse_qs(u.query))
            if u.path == "/api/extract":
                return self._extract()
            if u.path == "/api/analyze":
                return self._analyze()
            if u.path == "/api/series":
                return self._series()
            if u.path == "/api/ai":
                return self._ai()
            if u.path == "/api/related":
                return self._related()
            if u.path == "/api/fetch-many":
                return self._fetch_many()
            if u.path == "/api/feed":
                return self._feed()
            if u.path == "/api/titles":
                return self._titles()
            if u.path == "/api/save-text":
                return self._save_text()
            if u.path == "/api/save":
                return self._save()
            if u.path == "/api/out-delete":
                return self._out_delete()
            if u.path == "/api/insta-captions":
                return self._insta_captions()
            if u.path == "/api/insta-stage":
                return self._insta_stage()
            if u.path == "/api/insta-launch":
                return self._insta_launch()
            if u.path == "/api/insta-post":
                return self._insta_post()
            if u.path == "/api/publish":
                return self._publish()
            if u.path == "/api/hub-fetch":
                return self._hub_fetch()
            if u.path == "/api/hub-search":
                return self._hub_search()
            return self._err("not found", 404)
        except Exception as e:
            log_exc("POST %s" % self.path)
            return self._err(e, 500)

    # ── 핸들러 ────────────────────────────────────────────────────────
    def _file(self, path):
        if not os.path.isfile(path):
            return self._err("not found", 404)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        with open(path, "rb") as f:
            self._send(200, f.read(), ctype)

    def _extract(self):
        d = self._json_body()
        url = (d.get("url") or "").strip()
        text = (d.get("text") or "").strip()
        title = (d.get("title") or "").strip()
        res = {"ok": True, "title": title, "body": text, "images": [],
               "press": "", "date": "", "url": url}
        if url:
            if not url.startswith(("http://", "https://")):
                url = "https://" + url
            got = extractor.extract(url)
            res.update(got)
            if text:                       # 본문을 직접 준 경우 그쪽을 우선
                res["body"] = text
            if title:
                res["title"] = title
        if not (res.get("body") or "").strip():
            return self._err("본문을 찾지 못했습니다. 기사 본문을 직접 붙여넣어 주세요.")
        res["analysis"] = summarizer.analyze(res["body"], res.get("title", ""))
        return self._send(200, res)

    def _analyze(self):
        d = self._json_body()
        body = (d.get("text") or "").strip()
        if not body:
            return self._err("본문이 비어 있습니다.")
        return self._send(200, {"ok": True,
                                "analysis": summarizer.analyze(body, d.get("title", ""))})

    def _series(self):
        """기사 → 표지 + 본문 장 N (시리즈 편집기의 「자동 구성」).
        AI 설정(`ai`)이 같이 오면 AI 로, 없으면 규칙기반(summarizer.series). 꼴은 같다."""
        d = self._json_body()
        body = (d.get("text") or "").strip()
        if not body:
            return self._err("본문이 비어 있습니다.")
        n = int(d.get("n") or 3)
        cfg = d.get("ai") or {}
        if cfg.get("on"):
            out = ai.run("series", body, d.get("title", ""), n, cfg)
            out["by"] = "ai"
        else:
            out = summarizer.series(body, d.get("title", ""), n)
            out["by"] = "rule"
        return self._send(200, {"ok": True, "series": out})

    def _ai(self):
        """AI 문구 - task: copy(앞장 후보) / caption(피드 글). 키는 요청에 실려 오고
        서버에는 남기지 않는다(로그에도 안 찍는다)."""
        d = self._json_body()
        task = (d.get("task") or "copy").strip()
        body = (d.get("text") or "").strip()
        if not body:
            return self._err("본문이 비어 있습니다.")
        cfg = d.get("ai") or {}
        out = ai.run(task, body, d.get("title", ""), int(d.get("n") or 3), cfg)
        return self._send(200, {"ok": True, "result": out, "task": task})

    def _related(self):
        """같은 시각대에 나온 유사 기사 찾기. 구글/빙 뉴스 RSS를 쓴다(키 불필요)."""
        d = self._json_body()
        title = (d.get("title") or "").strip()
        body = (d.get("body") or "").strip()
        if not (title or body):
            return self._err("기준이 될 제목이나 본문이 필요합니다.")
        try:
            hours = max(1, min(240, int(d.get("hours") or 48)))
        except (TypeError, ValueError):
            hours = 48
        res = related.find(title, body, d.get("date") or "", d.get("url") or "",
                           hours=hours, limit=int(d.get("limit") or 12),
                           deep=bool(d.get("deep")))
        res["ok"] = True
        return self._send(200, res)

    def _fetch_many(self):
        """직접 준 기사 주소들을 읽어 온다. 여기로 온 것은 본문까지 확보된다."""
        d = self._json_body()
        urls = d.get("urls") or []
        if isinstance(urls, str):
            urls = re.split(r"[\s,]+", urls)
        urls = [u for u in urls if u.strip()][:16]
        if not urls:
            return self._err("주소를 한 줄에 하나씩 넣어 주세요.")
        # 넣은 순서 그대로 돌아온다. 화면이 순서로 원래 항목과 짝을 맞춘다.
        items = related.from_urls(urls, d.get("date") or "")
        return self._send(200, {"ok": True, "items": items,
                                "body_ok": sum(1 for i in items if i.get("body_ok"))})

    # 갈래별 캐시. 구글 뉴스 섹션 RSS 는 몇 분 사이 안 바뀌고, 칩을 오갈 때마다
    # 다시 받으면 느리다(실측 1~2초). hub 와 같은 10분.
    _IDEA_CACHE: dict = {}
    _IDEA_LOCK = threading.Lock()

    def _topic_ideas(self, q):
        """오늘의 주제 후보 - 구글 뉴스 갈래(섹션) RSS. 키 불필요.

        🔴 링크가 구글 중계 주소라 본문은 못 긁는다(related.py 첫머리 주석 참고).
        제목·언론사·시각까지만 보장하고, 본문은 앞장에서 안 잡히면 직접 붙여넣는다.
        """
        # 한글 갈래 이름이 %EC%97... 로 오므로 parse_qs 가 이미 unquote 해 준다
        cat = (q.get("cat") or ["종합"])[0].strip() or "종합"
        limit = 20
        try:
            limit = max(1, min(50, int((q.get("limit") or ["20"])[0])))
        except ValueError:
            pass
        with self._IDEA_LOCK:
            hit = self._IDEA_CACHE.get(cat)
            if hit and time.time() - hit[0] < 600:
                return self._send(200, {"ok": True, "cached": True,
                                        "cats": related.IDEA_ORDER,
                                        **hit[1], "items": hit[1]["items"][:limit]})
        try:
            res = related.topic_ideas(cat, limit=50)
        except ValueError as e:
            return self._err(e)
        with self._IDEA_LOCK:
            self._IDEA_CACHE[cat] = (time.time(), res)
        return self._send(200, {"ok": True, "cached": False,
                                "cats": related.IDEA_ORDER,
                                **res, "items": res["items"][:limit]})

    # 검색어별 캐시. 유튜브 결과 페이지는 ~1MB 라 매번 받으면 느리다. 10분.
    _SHORTS_CACHE: dict = {}
    _SHORTS_LOCK = threading.Lock()

    def _shorts(self, q):
        """릴스 화면의 「관련 숏폼」 - 유튜브 검색에서 짧은 영상만 추린다.

        공식 API 는 키가 필요해 안 쓴다(키·설치 0개 규칙). 검색 결과 페이지에 박힌
        `ytInitialData` JSON 을 걸어 다니며 영상 항목만 줍는다. 유튜브가 틀을 바꾸면
        빈 목록이 나올 뿐 죽지는 않는다. 재생은 화면이 embed(iframe)로 한다 -
        **영상을 내려받지 않는다**(남의 영상을 릴스에 붙이면 저작권 문제).
        인스타그램은 검색을 로그인 밖에서 막아 두어 여기서 못 긁는다 - 화면이
        검색 링크만 새 탭으로 연다.
        """
        term = (q.get("q") or [""])[0].strip()
        url = (q.get("url") or [""])[0].strip()
        if not term and url:
            # 검색어가 없으면 실어 온 기사 제목으로 (extractor 는 이미 있는 길)
            try:
                term = (extractor.extract(url).get("title") or "").strip()
            except Exception:
                term = ""
        if not term:
            return self._send(200, {"ok": True, "term": "", "items": []})
        with self._SHORTS_LOCK:
            hit = self._SHORTS_CACHE.get(term)
            if hit and time.time() - hit[0] < 600:
                return self._send(200, {"ok": True, "term": term,
                                        "cached": True, "items": hit[1]})
        from urllib.request import Request, urlopen
        # sp=EgIYAQ%3D%3D = 길이 필터 「4분 미만」 (이미 인코딩된 값이라 그대로 붙인다)
        su = ("https://www.youtube.com/results?search_query=" + quote(term)
              + "&sp=EgIYAQ%3D%3D")
        req = Request(su, headers={"User-Agent": extractor.UA,
                                   "Accept-Language": "ko-KR,ko;q=0.9"})
        html = urlopen(req, timeout=15).read().decode("utf-8", "replace")
        items = []
        m = re.search(r"var ytInitialData\s*=\s*(\{.*?\});</script>", html, re.S)
        if m:
            try:
                found = []
                self._walk_shorts(json.loads(m.group(1)), found)
                seen = set()
                for it in found:                       # 같은 영상이 선반+목록에 겹친다
                    if it["id"] not in seen:
                        seen.add(it["id"])
                        items.append(it)
            except Exception:
                log_exc("shorts parse")
                items = []
        with self._SHORTS_LOCK:
            self._SHORTS_CACHE[term] = (time.time(), items)
        return self._send(200, {"ok": True, "term": term,
                                "cached": False, "items": items[:18]})

    def _walk_shorts(self, node, out):
        """ytInitialData 안에서 videoRenderer(일반 목록)·reelItemRenderer(쇼츠 선반)를
        줍는다. 구조가 깊고 이름이 자주 바뀌므로 **키 이름 두 개만 믿고** 걸어 다닌다."""
        if len(out) >= 30:
            return
        if isinstance(node, dict):
            vr = node.get("videoRenderer")
            if isinstance(vr, dict) and vr.get("videoId"):
                title = "".join(r.get("text", "")
                                for r in ((vr.get("title") or {}).get("runs") or []))
                secs = 0
                for p in ((vr.get("lengthText") or {}).get("simpleText", "")).split(":"):
                    if p.strip().isdigit():
                        secs = secs * 60 + int(p)
                if 0 < secs <= 240:                    # 검색 필터가 새는 것 보강
                    out.append({"id": vr["videoId"], "title": title, "secs": secs})
            rr = node.get("reelItemRenderer")
            if isinstance(rr, dict) and rr.get("videoId"):
                out.append({"id": rr["videoId"],
                            "title": (rr.get("headline") or {}).get("simpleText", ""),
                            "secs": 0})               # 쇼츠 선반은 길이를 안 준다
            for v in node.values():
                self._walk_shorts(v, out)
        elif isinstance(node, list):
            for v in node:
                self._walk_shorts(v, out)

    def _publish_status(self):
        """공식 API(메타) 로 발행할 준비가 됐는지 - 계정·창구·토큰 남은 날.

        토큰은 **돌려주지 않는다.** 화면은 "무엇이 이어져 있나"만 알면 된다.
        """
        try:
            import meta_api as M
        except Exception as e:
            return self._send(200, {"ok": False, "error": "메타 모듈을 못 읽었습니다: %s" % e,
                                    "accounts": []})
        try:
            cfg = M.설정읽기()
        except Exception as e:
            return self._send(200, {"ok": False, "error": str(e), "accounts": []})
        out = []
        for key, acc in (cfg.get("계정") or {}).items():
            ch = []
            for name in ("instagram", "facebook", "threads"):
                part = acc.get(name) or {}
                if not part:
                    continue
                ch.append({"name": name, "left": M.남은날(part)})
            out.append({"key": key, "channels": ch})
        return self._send(200, {"ok": True, "accounts": out,
                                "hosting": bool((cfg.get("호스팅") or {}).get("갈래")),
                                "app": bool((cfg.get("앱") or {}).get("id"))})

    def _publish(self):
        """[발행] - 고른 카드를 메타 공식 API 로 인스타·페이스북 페이지·스레드에.

        브라우저 CDP 경로(`/api/insta-post`)와 **나란히** 둔다. 이쪽이 약관 안이고
        세 곳에 한 번에 가지만, 앱 등록·토큰·공개 주소가 갖춰져 있어야 한다.
        `dry_run` 이면 앞단만 점검하고 실제로 보내지 않는다.
        """
        import meta_api as M
        d = self._json_body()
        picks = d.get("files") or []
        caption = (d.get("caption") or "").strip()
        th_caption = d.get("threads_caption")
        account = (d.get("account") or "").strip()
        channels = tuple(d.get("channels") or ("instagram", "facebook", "threads"))
        dry = bool(d.get("dry_run", True))
        if not picks:
            return self._err("올릴 그림을 고르지 않았습니다.")
        if not caption:
            return self._err("문구가 비어 있습니다.")
        try:
            files = self._insta_resolve(picks)
        except ValueError as e:
            return self._err(e)

        lines = []
        try:
            cfg = M.설정읽기()
            keys = list(cfg.get("계정") or {})
            if not keys:
                return self._err("이어진 계정이 없습니다. `메타_연결.py` 로 먼저 연결하세요.")
            if account and account not in keys:
                return self._err("`%s` 계정을 찾을 수 없습니다." % account)
            key = account or keys[0]
            res = M.올리기(key, files, caption, 창구=channels,
                          스레드문구=th_caption, 설정=cfg,
                          로그=lines.append, 시늉=dry)
            bad = [r for r in res if not r.get("ok")]
            return self._send(200, {"ok": not bad, "account": key,
                                    "results": res, "log": lines})
        except M.MetaError as e:
            log_exc("publish")
            return self._send(200, {"ok": False, "error": str(e), "log": lines})
        except Exception as e:                # 어떤 실패든 화면에 이유가 남아야 한다
            log_exc("publish")
            return self._send(200, {"ok": False, "error": "%s: %s" % (type(e).__name__, e),
                                    "log": lines})

    def _daily(self, u):
        """오늘의 뉴스 - 텔레그램 봇이 종합해 둔 기사 목록.

        `?day=2026-09-01` 로 지난 날짜도 본다. `?pull=0` 이면 git 으로 받아오지 않는다
        (화면을 여러 번 새로 고칠 때 매번 네트워크를 쓰지 않게).
        """
        q = parse_qs(u.query or "")
        day = (q.get("day") or [""])[0].strip()
        pull = (q.get("pull") or ["1"])[0] != "0"
        res = daily.load(day, pull=pull)
        return self._send(200 if res.get("ok") else 200, res)

    def _hub_fetch(self):
        """주제 허브 - 참고 계정·매체의 최신 글/영상 후보를 모아 준다."""
        d = self._json_body()
        keys = d.get("keys") or []
        per = max(3, min(15, int(d.get("per") or 8)))
        res = hub.fetch(keys=keys, use="news", per=per)
        res["ok"] = True
        return self._send(200, res)

    def _hub_search(self):
        """주제 후보(영상 제목 등)로 **국내 기사**를 찾는다.

        related.find() 는 기준 기사와의 유사도를 재는 물건이라 본문 없는 한 줄
        제목에는 안 맞다. 여기서는 제목에서 낱말을 뽑아 구글·빙 뉴스 검색을 그대로
        보여 주고, 고르는 일은 사람이 한다.
        """
        d = self._json_body()
        title = (d.get("title") or "").strip()
        if not title:
            return self._err("찾을 제목이 필요합니다.")
        days = max(1, min(30, int(d.get("days") or 7)))
        q = related.build_query(title, "", 3)
        rows = related.search_google(q, days=days) + related.search_bing(q)
        if len(rows) < 4:                    # 낱말 3개가 너무 좁으면 2개로 넓힌다
            q2 = related.build_query(title, "", 2)
            if q2 != q:
                q = q2
                rows = related.search_google(q, days=days) + related.search_bing(q)
        seen, items = set(), []
        for r in rows:
            k = re.sub(r"[^0-9A-Za-z가-힣]", "", r["title"])[:40]
            if not k or k in seen:
                continue
            seen.add(k)
            w = r.get("when")
            items.append({
                "title": r["title"],
                "press": r.get("press") or "(언론사 미상)",
                "link": r["link"], "direct": r.get("direct", False),
                "date": w.astimezone(related.KST).strftime("%m-%d %H:%M") if w else "",
                "ts": w.timestamp() if w else 0,
            })
        items.sort(key=lambda x: -x["ts"])
        return self._send(200, {"ok": True, "query": q, "items": items[:24]})

    def _feed(self):
        d = self._json_body()
        main = d.get("main") or {}
        if not (main.get("body") or "").strip():
            return self._err("기사 본문이 없습니다. 먼저 기사를 가져오세요.")
        out = feed.compose(main, d.get("related") or [], d.get("style") or "news")
        out["ok"] = True
        return self._send(200, out)

    def _titles(self):
        """글투에 맞는 제목 후보만 따로. 글을 만들기 전에도 볼 수 있게 떼어 뒀다."""
        d = self._json_body()
        main = d.get("main") or {}
        body = (main.get("body") or "").strip()
        title = (main.get("title") or "").strip()
        if not (body or title):
            return self._err("기사 본문이나 제목이 필요합니다.")
        style = d.get("style") or "news"
        return self._send(200, {"ok": True, "style": style,
                                "titles": feed.title_ideas(title, body, style),
                                "note": feed.STYLE_TITLE_NOTE.get(style, "")})

    def _save_text(self):
        d = self._json_body()
        text = d.get("text") or ""
        name = SAFE_NAME.sub("_", (d.get("name") or "피드글").strip()) or "피드글"
        if not text.strip():
            return self._err("저장할 글이 비어 있습니다.")
        path = os.path.join(OUT, f"{name}.txt")
        i = 2
        while os.path.exists(path):
            path = os.path.join(OUT, f"{name}_{i}.txt")
            i += 1
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return self._send(200, {"ok": True, "path": path})

    def _proxy(self, q):
        """CORS 회피용 이미지 프록시. 캔버스 오염(taint)을 막는다."""
        url = (q.get("url") or [""])[0]
        ref = (q.get("ref") or [""])[0]
        if not url.startswith(("http://", "https://")):
            return self._err("bad url")
        if not ref:
            p = urlparse(url)
            ref = f"{p.scheme}://{p.netloc}/"
        raw, ctype, _ = extractor.fetch(url, referer=ref, timeout=25)
        if not ctype.startswith("image"):
            ctype = mimetypes.guess_type(url)[0] or "image/jpeg"
        self._send(200, raw, ctype, {"Access-Control-Allow-Origin": "*"})

    # 키가 필요 없고 **상업적 재사용까지 허용**되는 출처.
    # 🔴 Getty·Pinterest 는 넣지 않는다 — Getty 는 유료 에이전시라 라이선스 없이 쓰면
    #    저작권 침해이고(실제로 추적·청구한다), Pinterest 는 대부분 제3자 저작물의
    #    재게시물이라 권리가 불분명하다. 공개 계정에 올릴 그림은 여기서 고른다.
    FREE_PROVIDERS = ("openverse", "wikimedia")

    def _stock_openverse(self, term):
        """Openverse — CC 라이선스 통합 검색(키 불필요).

        `license_type=commercial,modification` 으로 **상업적 이용·수정이 허용된 것만**
        받는다. 카드 위에 글씨를 얹는 것이 곧 '수정' 이므로 둘 다 필요하다.
        """
        url = ("https://api.openverse.org/v1/images/?page_size=30"
               "&license_type=commercial,modification&q=" + quote(term))
        from urllib.request import Request, urlopen
        req = Request(url, headers={"User-Agent": extractor.UA,
                                    "Accept": "application/json"})
        data = json.loads(urlopen(req, timeout=20).read().decode("utf-8"))
        items = []
        for p in data.get("results", []):
            full = p.get("url")
            if not full:
                continue
            items.append({
                "thumb": p.get("thumbnail") or full, "full": full,
                "credit": (p.get("creator") or "").strip() or "작자 미상",
                "license": (p.get("license") or "").upper()
                           + (" " + (p.get("license_version") or "")).rstrip(),
                "title": (p.get("title") or "").strip(),
                "link": p.get("foreign_landing_url") or "",
                "source": "Openverse",
            })
        return items

    def _stock_wikimedia(self, term):
        """위키미디어 공용 — 사전 있는 사진이 많고 역시 키가 필요 없다."""
        url = ("https://commons.wikimedia.org/w/api.php?action=query&format=json"
               "&generator=search&gsrnamespace=6&gsrlimit=30"
               "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=420"
               "&gsrsearch=" + quote(term))
        from urllib.request import Request, urlopen
        req = Request(url, headers={"User-Agent": extractor.UA})
        data = json.loads(urlopen(req, timeout=20).read().decode("utf-8"))
        pages = ((data.get("query") or {}).get("pages") or {}).values()
        items = []
        for p in pages:
            info = (p.get("imageinfo") or [{}])[0]
            full = info.get("url")
            # 🔴 위키미디어는 주소 뒤에 `?utm_source=…` 를 붙여 준다. 그대로 확장자를
            #    보면 **하나도 안 걸린다**(실측: 30건이 전부 걸러졌다). 경로만 본다.
            if not full or not urlparse(full).path.lower().endswith(
                    (".jpg", ".jpeg", ".png", ".webp")):
                continue
            meta = info.get("extmetadata") or {}
            grab = lambda k: re.sub(r"<[^>]+>", "", (meta.get(k) or {}).get("value") or "").strip()
            items.append({
                "thumb": info.get("thumburl") or full, "full": full,
                "credit": grab("Artist") or "작자 미상",
                "license": grab("LicenseShortName"),
                "title": (p.get("title") or "").replace("File:", ""),
                "link": info.get("descriptionurl") or "",
                "source": "Wikimedia Commons",
            })
        return items

    def _stock(self, q):
        prov = (q.get("provider") or ["openverse"])[0]
        key = (q.get("key") or [""])[0].strip()
        term = (q.get("q") or [""])[0].strip()
        if not term:
            return self._err("검색어가 비어 있습니다.")
        if prov in self.FREE_PROVIDERS:
            try:
                items = (self._stock_openverse(term) if prov == "openverse"
                         else self._stock_wikimedia(term))
            except Exception as e:
                log_exc("stock %s" % prov)
                # Openverse 는 키 없이 쓰면 시간당 몇 번으로 막는다(실측: 401 이 온다).
                # 막힌 것과 고장 난 것을 가르지 않으면 사용자는 '또 안 되네' 로 읽는다.
                if prov == "openverse" and ("401" in str(e) or "429" in str(e)):
                    return self._err("Openverse 가 잠시 막았습니다(키 없이 쓰면 시간당 "
                                     "횟수 제한이 있습니다). 잠시 뒤 다시 하거나 "
                                     "`위키미디어 공용` 으로 바꿔 보세요.")
                return self._err("%s 검색에 실패했습니다: %s" % (prov, e))
            return self._send(200, {"ok": True, "items": items, "provider": prov})
        if not key:
            return self._err("Pexels·Unsplash 는 무료지만 **가입해서 키를 받아야** 합니다. "
                             "키 없이 쓰려면 Openverse 나 위키미디어 공용을 고르세요.")
        if prov == "unsplash":
            url = ("https://api.unsplash.com/search/photos?per_page=24&query="
                   + quote(term))
            hdr = {"Authorization": "Client-ID " + key}
        else:
            url = ("https://api.pexels.com/v1/search?per_page=24&query="
                   + quote(term))
            hdr = {"Authorization": key}

        from urllib.request import Request, urlopen
        req = Request(url, headers={**hdr, "User-Agent": extractor.UA})
        data = json.loads(urlopen(req, timeout=20).read().decode("utf-8"))

        items = []
        if prov == "unsplash":
            for p in data.get("results", []):
                items.append({"thumb": p["urls"]["small"], "full": p["urls"]["regular"],
                              "credit": p["user"]["name"], "link": p["links"]["html"],
                              "license": "Unsplash License", "source": "Unsplash",
                              "title": (p.get("description") or "")[:80]})
        else:
            for p in data.get("photos", []):
                items.append({"thumb": p["src"]["medium"], "full": p["src"]["large2x"],
                              "credit": p.get("photographer", ""), "link": p.get("url", ""),
                              "license": "Pexels License", "source": "Pexels",
                              "title": (p.get("alt") or "")[:80]})
        return self._send(200, {"ok": True, "items": items, "provider": prov})

    # ── out 폴더 정리 ─────────────────────────────────────────────────
    def _out_list(self):
        """out 폴더에 쌓인 파일 목록. 새로 만든 것이 위로 온다."""
        rows, total = [], 0
        for n in os.listdir(OUT):
            p = os.path.join(OUT, n)
            if not os.path.isfile(p):
                continue
            st = os.stat(p)
            total += st.st_size
            rows.append({"name": n, "size": st.st_size, "mtime": int(st.st_mtime)})
        rows.sort(key=lambda r: -r["mtime"])
        return self._send(200, {"ok": True, "dir": OUT, "items": rows,
                                "count": len(rows), "total": total})

    def _out_delete(self):
        """화면에서 고른 파일만 지운다.

        지울 대상은 **화면이 이름으로 정확히 지정**한다(기간·개수 계산은 화면 몫).
        여기서는 그 이름들이 정말 out 폴더 바로 아래의 파일인지만 확인한다 —
        '..\\..' 같은 경로가 섞여 들어와도 폴더 밖으로 나가지 못하게.
        """
        d = self._json_body()
        names = d.get("names") or []
        if not isinstance(names, list) or not names:
            return self._err("지울 파일을 고르지 않았습니다.")
        root = os.path.abspath(OUT)
        done, failed, freed = [], [], 0
        for raw in names[:2000]:
            name = os.path.basename(str(raw))
            p = os.path.abspath(os.path.join(OUT, name))
            if os.path.dirname(p) != root or not os.path.isfile(p):
                failed.append({"name": str(raw), "error": "out 폴더의 파일이 아닙니다"})
                continue
            try:
                size = os.path.getsize(p)
                os.remove(p)
                freed += size
                done.append(name)
            except OSError as e:
                # 그림판·탐색기 미리보기가 물고 있으면 여기로 온다
                failed.append({"name": name, "error": e.strerror or str(e)})
        return self._send(200, {"ok": True, "deleted": len(done),
                                "freed": freed, "failed": failed})

    # ── 인스타 연동 ───────────────────────────────────────────────────
    def _insta_roots(self):
        """올릴 그림을 꺼내 올 수 있는 폴더 목록 (여기 밖은 못 건드린다).

        `out\\` 만으로는 부족하다 — 첫 게시물 카드와 프로필/커버는 상위 폴더에 있다.
        그래도 아무 경로나 받으면 안 되니 **허용 목록**으로 못 박는다.
        """
        up = os.path.dirname(BASE)
        cand = [("지금 화면(임시)", STAGE),
                ("out", OUT),
                ("첫게시물", os.path.join(up, "첫게시물")),
                ("프로필·커버", os.path.join(up, "프로필_하이라이트")),
                ("프로필·커버(유리예시)", os.path.join(up, "프로필_하이라이트_유리예시"))]
        return [(label, os.path.abspath(p)) for label, p in cand if os.path.isdir(p)]

    def _insta_stage(self):
        """**저장하지 않고** 올리기 — 지금 화면의 카드를 임시 자리에 둔다.

        인스타에 넣는 마지막 손잡이는 `DOM.setFileInputFiles` 라 **진짜 파일 경로**가
        있어야 한다(바이트를 바로 못 넣는다). 그래서 파일은 반드시 생기는데,
        그걸 `out\\` 에 두면 저장한 카드와 섞여 정리 화면이 지저분해진다 →
        `out\\_임시_인스타\\` 에 따로 두고 다음 번에 통째로 갈아 끼운다.

        🔴 **쌓는다(append).** 처음엔 갈아 끼웠는데, 그러면 앞장을 담고 뒷장을 담는 순간
        앞장이 사라져 **캐러셀을 아예 못 만든다**(실측). 인스타 게시물은 보통 여러 장이므로
        쌓는 쪽이 맞고, 지우는 것은 화면의 `임시 그림 지우기`(`clear`)로 따로 둔다.
        """
        d = self._json_body()
        items = d.get("items") or []
        if d.get("clear"):
            n = self._stage_clear()
            return self._send(200, {"ok": True, "dir": STAGE, "names": [], "cleared": n})
        if not items:
            return self._err("올릴 그림이 없습니다.")
        os.makedirs(STAGE, exist_ok=True)
        if d.get("replace"):
            self._stage_clear()
        have = sorted(x for x in os.listdir(STAGE)
                      if os.path.isfile(os.path.join(STAGE, x)))
        if len(have) + len(items) > 10:
            return self._err("캐러셀은 최대 10장입니다 (이미 %d장 담겨 있습니다). "
                             "`임시 그림 지우기` 로 비우고 다시 담으세요." % len(have))
        names = []
        for i, it in enumerate(items, start=len(have) + 1):
            m = re.match(r"^data:image/(png|jpeg);base64,(.+)$", it.get("dataUrl") or "", re.S)
            if not m:
                return self._err("이미지 데이터가 올바르지 않습니다.")
            base = SAFE_NAME.sub("_", (it.get("name") or "카드").strip()) or "카드"
            ext = "png" if m.group(1) == "png" else "jpg"
            # 번호는 **담긴 순서**다(캐러셀 순서). 빈 번호가 있어도 겹치지 않게 민다.
            while os.path.exists(os.path.join(STAGE, "%02d_%s.%s" % (i, base, ext))):
                i += 1
            name = "%02d_%s.%s" % (i, base, ext)
            with open(os.path.join(STAGE, name), "wb") as f:
                f.write(base64.b64decode(m.group(2)))
            names.append(name)
        return self._send(200, {"ok": True, "dir": os.path.abspath(STAGE), "names": names})

    @staticmethod
    def _stage_clear():
        if not os.path.isdir(STAGE):
            return 0
        n = 0
        for x in os.listdir(STAGE):
            p = os.path.join(STAGE, x)
            if os.path.isfile(p):
                try:
                    os.remove(p)
                    n += 1
                except OSError:
                    pass                      # 탐색기 미리보기가 물고 있으면 남는다
        return n

    @staticmethod
    def _img_size(path):
        """그림 파일 **머리표만 읽어** 가로·세로를 잰다 (Pillow 없이).

        비율이 섞였는지는 그림을 다 불러오기 전에 알아야 쓸모가 있다. 인스타는
        첫 장 비율로 나머지를 자르므로, 고르는 순간 알려 줘야 잘못 고르지 않는다.
        모르는 형식이면 조용히 (0,0) — 화면이 그림에서 직접 재도록 넘긴다.
        """
        try:
            with open(path, "rb") as f:
                head = f.read(32)
                if head[:8] == b"\x89PNG\r\n\x1a\n":          # IHDR 은 항상 첫 청크
                    w, h = struct.unpack(">II", head[16:24])
                    return int(w), int(h)
                if head[:2] == b"\xff\xd8":                   # JPEG: SOFn 을 찾아 간다
                    f.seek(2)
                    while True:
                        b = f.read(1)
                        if not b:
                            break
                        if b != b"\xff":
                            continue
                        while b == b"\xff":                   # 채움 바이트
                            b = f.read(1)
                        m = b[0]
                        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
                            continue
                        ln = struct.unpack(">H", f.read(2))[0]
                        # SOF0~SOF15 중 DHT(C4)·JPG(C8)·DAC(CC) 는 크기가 아니다
                        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                            body = f.read(7)
                            h, w = struct.unpack(">HH", body[1:5])
                            return int(w), int(h)
                        f.seek(ln - 2, 1)
                if head[:4] == b"RIFF" and head[8:12] == b"WEBP" and head[12:16] == b"VP8X":
                    # VP8X 는 (가로-1, 세로-1) 을 3바이트 리틀엔디언으로 적는다
                    w = int.from_bytes(head[24:27], "little") + 1
                    h = int.from_bytes(head[27:30], "little") + 1
                    return w, h
        except (OSError, struct.error, IndexError):
            pass
        return 0, 0

    def _insta_files(self):
        exts = (".png", ".jpg", ".jpeg", ".webp")
        groups = []
        for label, d in self._insta_roots():
            rows = []
            for n in sorted(os.listdir(d)):
                p = os.path.join(d, n)
                if os.path.isfile(p) and n.lower().endswith(exts):
                    st = os.stat(p)
                    w, h = self._img_size(p)
                    rows.append({"name": n, "size": st.st_size, "w": w, "h": h,
                                 "mtime": int(st.st_mtime)})
            if rows:
                groups.append({"label": label, "dir": d, "items": rows})
        return self._send(200, {"ok": True, "groups": groups})

    def _insta_thumb(self, q):
        """고르는 화면에 **그림 자체**를 보여 준다.

        전에는 파일명만 띄웠는데(그때 주석: '정적 경로로는 못 꺼내온다'), 이름만으로는
        `01_표지.png` 와 `02_시사.png` 를 구별할 수 없어 엉뚱한 장을 고르게 된다.
        `/static/` 은 화면 파일 전용이라 여기로 못 오므로 전용 경로를 연다 —
        대신 꺼내 오는 폴더는 게시용 허용 목록(`_insta_roots`) 안으로 못 박는다.

        줄여서 보내지는 않는다(축소하려면 Pillow 가 필요한데 이 도구는 설치 0개가 규칙).
        대신 화면이 보이는 것만 늦게 불러온다.
        """
        d = (q.get("dir") or [""])[0]
        n = (q.get("name") or [""])[0]
        try:
            path = self._insta_resolve([{"dir": d, "name": n}])[0]
        except (ValueError, IndexError):
            return self._err("허용된 폴더의 그림이 아닙니다.", 404)
        return self._file(path)

    def _insta_texts(self):
        """`피드 글` 화면에서 저장해 둔 글(out\\*.txt). 문구 후보로 그대로 쓴다."""
        rows = []
        for n in os.listdir(OUT):
            p = os.path.join(OUT, n)
            if not (os.path.isfile(p) and n.lower().endswith(".txt")):
                continue
            try:
                with open(p, encoding="utf-8") as f:
                    text = f.read(20000)
            except OSError:
                continue
            rows.append({"name": n, "mtime": int(os.path.getmtime(p)),
                         "chars": len(text), "text": text})
        rows.sort(key=lambda r: -r["mtime"])
        return self._send(200, {"ok": True, "items": rows[:40]})

    def _insta_captions(self):
        """문구 후보 5개. 기사를 주면 그 기사에서, 안 주면 채울 자리를 남긴 틀로."""
        d = self._json_body()
        url = (d.get("url") or "").strip()
        main = {"title": (d.get("title") or "").strip(),
                "body": (d.get("text") or "").strip(),
                "press": (d.get("press") or "").strip(),
                "date": (d.get("date") or "").strip(), "url": url}
        if url and not main["body"]:
            if not url.startswith(("http://", "https://")):
                url = main["url"] = "https://" + url
            got = extractor.extract(url)
            main["body"] = (got.get("body") or "").strip()
            main["title"] = main["title"] or (got.get("title") or "").strip()
            main["press"] = main["press"] or (got.get("press") or "").strip()
            main["date"] = main["date"] or (got.get("date") or "").strip()
            if not main["body"]:
                return self._err("본문을 찾지 못했습니다. 기사 본문을 직접 붙여넣어 주세요.")
        items = feed.caption_ideas(main, d.get("related") or [])
        return self._send(200, {"ok": True, "items": items, "main": main,
                                "blank": bool(items and items[0].get("blank"))})

    def _insta_resolve(self, picks):
        """화면이 준 (폴더, 파일이름) 을 실제 경로로. 허용 폴더 밖이면 거절."""
        allow = {d: label for label, d in self._insta_roots()}
        out = []
        for it in picks:
            d = os.path.abspath(str(it.get("dir") or ""))
            n = os.path.basename(str(it.get("name") or ""))
            p = os.path.abspath(os.path.join(d, n))
            if d not in allow or os.path.dirname(p) != d or not os.path.isfile(p):
                raise ValueError("허용된 폴더의 파일이 아닙니다: %s" % n)
            out.append(p)
        return out

    # ── 숏폼 만들기 = Shortform Studio 를 이 앱 안에서 띄운다 ────────────────
    # 뉴보대가 큰 틀이고 Shortform Studio(Electron, 레퍼런스 분해·타임라인 편집·
    # ffmpeg 내보내기)는 그 안의 한 기능이다. 화면은 붙일 수 없어(WebView2 안에
    # Electron 을 못 넣는다) **같은 앱 폴더에 동봉한 exe 를 자식으로 띄우고**, 지금
    # 고른 카드 그림·검색어를 맥락 파일로 넘긴다. 두 번 눌러도 창이 하나만 뜬다
    # (Studio 쪽 single instance 가 맥락만 갈아 끼운다).
    def _shortform_status(self):
        exe = _studio_exe()
        return self._send(200, {"ok": True, "found": bool(exe), "exe": exe or "",
                                "hint": "" if exe else
                                "Shortform Studio 실행 파일을 찾지 못했습니다. 앱 폴더의 "
                                "shortform\\Shortform Studio.exe 가 있어야 합니다."})

    def _shortform_launch(self):
        d = self._json_body()
        exe = _studio_exe()
        if not exe:
            return self._err("Shortform Studio 실행 파일을 찾지 못했습니다(앱 폴더의 "
                             "shortform\\Shortform Studio.exe).", 404)
        # 화면이 준 (폴더, 이름) 은 인스타 올리기와 같은 검사(_insta_resolve)를 거친다 -
        # 허용된 폴더(out·임시) 밖의 파일은 넘기지 않는다.
        files = [f for f in (d.get("files") or [])[:40] if isinstance(f, dict)]
        try:
            images = [p for p in self._insta_resolve(files)
                      if p.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
        except ValueError as e:
            return self._err(str(e))
        ctx_dir = os.path.join(OUT, "_shortform")   # 영문 경로: 넘겨 주는 쪽 부담을 줄인다
        os.makedirs(ctx_dir, exist_ok=True)
        ctx_path = os.path.join(ctx_dir, "context.json")
        ctx = {"source": "newbodae",
               "keyword": str(d.get("keyword") or "").strip()[:80],
               "title": str(d.get("title") or "").strip()[:120],
               "images": images,
               "at": time.strftime("%Y-%m-%d %H:%M:%S")}
        try:
            with open(ctx_path, "w", encoding="utf-8") as f:
                json.dump(ctx, f, ensure_ascii=False, indent=1)
            flags = 0
            if os.name == "nt":
                flags = (getattr(subprocess, "DETACHED_PROCESS", 0)
                         | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
            subprocess.Popen([exe, "--from-newbodae=" + ctx_path],
                             cwd=os.path.dirname(exe), close_fds=True,
                             creationflags=flags,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
        except OSError as e:
            log_exc("shortform-launch")
            return self._err("Shortform Studio 를 띄우지 못했습니다: %s" % e, 500)
        return self._send(200, {"ok": True, "exe": exe, "images": len(images),
                                "context": ctx_path})

    def _reel_save(self, q):
        """릴스 영상 저장 — 화면(MediaRecorder)이 녹화한 바이트를 그대로 받는다.

        영상을 **만드는 쪽은 화면**이다(canvas + MediaRecorder). 파이썬으로 만들려면
        ffmpeg 같은 것을 동봉해야 하는데 이 도구는 설치 0개가 규칙이고, 카드를 그리는
        코드도 전부 브라우저에 있다(appwindow.py 첫머리 주석). 여기는 받아서 out\\ 에
        놓는 일만 한다.
        """
        ext = (q.get("ext") or ["mp4"])[0].lower()
        if ext not in ("mp4", "webm"):
            return self._err("mp4/webm 만 받습니다.")
        n = 0
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            pass
        if n <= 0:
            return self._err("영상 데이터가 없습니다.")
        if n > 300_000_000:
            return self._err("영상이 너무 큽니다(300MB 초과).")
        base = SAFE_NAME.sub("_", (q.get("name") or ["릴스"])[0].strip()) or "릴스"
        name = "%s_%s.%s" % (base, time.strftime("%Y-%m-%d_%H%M"), ext)
        # 같은 분(分)에 두 번 만들면 겹친다 → 번호를 민다
        stem, k = name, 2
        while os.path.exists(os.path.join(OUT, name)):
            name = "%s_%d.%s" % (stem.rsplit(".", 1)[0], k, ext)
            k += 1
        path = os.path.join(OUT, name)
        remain = n
        try:
            with open(path, "wb") as f:
                while remain > 0:
                    chunk = self.rfile.read(min(65536, remain))
                    if not chunk:
                        break
                    f.write(chunk)
                    remain -= len(chunk)
        except OSError as e:
            return self._err("저장하지 못했습니다: %s" % e)
        if remain > 0:                        # 끊긴 채로 남기면 깨진 영상이 남는다
            try:
                os.remove(path)
            except OSError:
                pass
            return self._err("전송이 중간에 끊겼습니다. 다시 시도하세요.")
        return self._send(200, {"ok": True, "name": name, "dir": OUT, "size": n})

    def _insta_status(self):
        import insta
        try:
            return self._send(200, {"ok": True, **insta.status()})
        except insta.InstaError as e:
            return self._send(200, {"ok": False, "error": str(e)})

    def _insta_launch(self):
        """로그인용 크롬 창을 띄운다. 로그인은 사람이 직접 한다."""
        import insta
        ch = insta.Chrome()
        made = ch.launch()
        ch.close()
        return self._send(200, {"ok": True, "launched": made,
                                "profile": insta.PROFILE})

    def _insta_post(self):
        import insta
        d = self._json_body()
        caption = (d.get("caption") or "").strip()
        picks = d.get("files") or []
        dry = bool(d.get("dry_run", True))
        if not picks:
            return self._err("올릴 그림을 고르지 않았습니다.")
        if not caption:
            return self._err("문구가 비어 있습니다.")
        try:
            files = self._insta_resolve(picks)
        except ValueError as e:
            return self._err(e)
        # 첫 장의 비율을 같이 넘긴다 — 인스타 자르기 틀이 이것과 다르면 잘린다.
        w, h = self._img_size(files[0])
        lines = []
        try:
            res = insta.post_carousel(files, caption, dry_run=dry,
                                      log=lines.append,
                                      expect_ratio=(w / h) if w and h else None)
            return self._send(200, {"ok": True, "log": lines, **res})
        except insta.InstaError as e:
            # 어디서 막혔는지가 알맹이다. 지나온 단계를 같이 돌려준다.
            log_exc("insta-post")
            return self._send(200, {"ok": False, "error": str(e), "log": lines})

    def _assets(self):
        names = [f for f in sorted(os.listdir(ASSETS))
                 if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))]
        return self._send(200, {"ok": True, "items": ["/assets/" + n for n in names]})

    def _save(self):
        d = self._json_body()
        data = d.get("dataUrl") or ""
        name = SAFE_NAME.sub("_", (d.get("name") or "card").strip()) or "card"
        m = re.match(r"^data:image/(png|jpeg);base64,(.+)$", data, re.S)
        if not m:
            return self._err("이미지 데이터가 올바르지 않습니다.")
        ext = "png" if m.group(1) == "png" else "jpg"
        path = os.path.join(OUT, f"{name}.{ext}")
        i = 2
        while os.path.exists(path):
            path = os.path.join(OUT, f"{name}_{i}.{ext}")
            i += 1
        with open(path, "wb") as f:
            f.write(base64.b64decode(m.group(2)))
        return self._send(200, {"ok": True, "path": path})


class Server(ThreadingHTTPServer):
    """핸들러 **밖으로** 샌 예외까지 창이 아니라 파일로 보낸다.

    socketserver 는 기본 handle_error 에서 traceback 을 stderr 로 찍는다. do_GET /
    do_POST 의 try 로는 못 잡는 경우(응답을 쓰는 도중 연결이 끊기는 등)가 여기로 온다.
    남겨 두면 창이 막혔을 때 그 스레드가 그대로 멈춘다.
    """

    daemon_threads = True
    # 🔴 HTTPServer 기본값(SO_REUSEADDR)은 윈도우에서 **이미 쓰는 포트에도 그냥
    # 붙는다** — OSError 가 안 나서 "다음 포트로" 가지 못하고, 본판·pure 를 같이
    # 켜면 두 번째 창이 첫 번째 프로세스의 화면을 보여 준다(실제로 겪음).
    allow_reuse_address = False

    def handle_error(self, request, client_address):
        log_exc("연결 %s" % (client_address,))


def _reach_addrs():
    """폰이 칠 수 있는 이 PC 의 IPv4 주소들 (--host 0.0.0.0 일 때 안내용).

    127(자기 자신)과 169.254(케이블만 꽂히고 주소를 못 받은 회선)는 뺀다.
    100.64~100.127 대역은 Tailscale 이 주는 주소라 따로 표시한다.
    """
    try:
        ips = socket.gethostbyname_ex(socket.gethostname())[2]
    except Exception:
        return []
    return [ip for ip in ips if not ip.startswith(("127.", "169.254."))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7870)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true",
                    help="아무 창도 띄우지 않는다(주소를 직접 열 때)")
    ap.add_argument("--browser", action="store_true",
                    help="전용 창 대신 평소 쓰는 브라우저 탭으로 연다(되돌림용)")
    ap.add_argument("--hide-console", action="store_true",
                    help="검은 창을 숨긴다. 바로가기(.bat)가 준다 — 사람이 직접 띄운 "
                         "터미널까지 숨기지 않으려고 기본은 꺼 둔다")
    ap.add_argument("--verbose", action="store_true",
                    help="요청 기록을 창에 찍는다(창을 클릭하면 멈출 수 있으니 평소엔 끈다)")
    ap.add_argument("--pure", action="store_true",
                    help="스타일 모드 없는 기본 디자인 판으로 띄운다(pure 판)")
    ap.add_argument("--key", default="",
                    help="공개 주소(터널) 뒤에 세울 때의 열쇠(영문·숫자만 - 한글은 "
                         "URL·쿠키 헤더에서 탈난다). 주면 ?key=열쇠 로 한 번 들어온 "
                         "기기만 통과시킨다(쿠키 1년). 기본은 문 없음")
    a = ap.parse_args()

    global VERBOSE, PURE, KEY
    VERBOSE = a.verbose
    if a.pure:
        PURE = True
    if a.key.strip():
        KEY = a.key.strip()

    disable_quickedit()                       # 창을 클릭해도 앱이 멎지 않게

    for s in (sys.stdout, sys.stderr):        # 🔴 출력이 창이 아니라 파이프·파일로 가면
        try:                                  #    cp949 라서 '—' 한 글자에 시작하자마자 죽는다
            s.reconfigure(errors="replace")   #    (창일 때만 utf-8 이라 눈에 잘 안 띈다)
        except Exception:
            pass

    port = a.port
    for _ in range(20):                       # 포트 충돌 시 다음 번호로
        try:
            srv = Server((a.host, port), Handler)
            break
        except OSError:
            port += 1
    else:
        print("사용 가능한 포트를 찾지 못했습니다.")
        return

    # 0.0.0.0 은 "모든 회선에서 받겠다"는 바인딩 표기라 브라우저에 그대로 열면
    # 안 된다 — 이 PC 에서 여는 창은 127.0.0.1 로 간다.
    url = f"http://{'127.0.0.1' if a.host == '0.0.0.0' else a.host}:{port}/"

    print("=" * 58)
    print("  뉴보대 카드뉴스 메이커" + (" (pure)" if PURE else ""))
    print(f"  주소 : {url}")
    if a.host == "0.0.0.0":
        for ip in _reach_addrs():
            where = "Tailscale, 밖에서도 됨" if ip.startswith("100.") \
                else "같은 와이파이에서"
            print(f"  폰   : http://{ip}:{port}/   ({where})")
    print(f"  저장 : {OUT}")
    if KEY:
        print("  열쇠 : 켜짐 - 처음 한 번 주소 뒤에 ?key=열쇠 를 붙여 들어와야 합니다")
    print("  탈나면 : 오류기록.txt (창에는 안 찍는다 — 창이 막히면 앱이 멎으므로)")
    print("=" * 58)

    # 🔴 서버를 딴 스레드로 보낸다. WebView2 창은 **주 스레드**에서만 돌아가고,
    #    `webview.start()` 는 창이 닫힐 때까지 돌아오지 않기 때문이다.
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    if a.no_browser:
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            print("\n종료합니다.")
        return

    # ── 창 띄우기: 제 창 → 앱 모드 → 보통 브라우저 ────────────────────
    def _hide():
        # 창이 확실히 뜰 때만 숨긴다. 못 띄웠는데 숨기면 아무것도 없는 상태가 된다.
        if a.hide_console and not a.verbose:
            sys.stdout.flush()
            appwindow.hide_console()          # exe 는 콘솔이 없어 그냥 지나간다

    if not a.browser:
        if appwindow.has_webview():
            _hide()                           # 🔴 창이 닫힐 때까지 안 돌아오므로 먼저
            if appwindow.run_window(url, on_fail=log_exc):
                return                        # 창을 닫았다 = 프로그램 끝

        # 여기 왔다는 건 pywebview 나 WebView2 가 없다는 뜻(공유용 ZIP 이 이 길로 온다)
        proc = appwindow.open_app_window(url)
        if proc is not None:
            _hide()
            try:
                proc.wait()                   # 창이 닫힐 때까지 기다린다
            except KeyboardInterrupt:
                pass
            return

    # 마지막 자리 — 엔진이 하나도 없는 PC
    threading.Thread(target=lambda: (time.sleep(0.8), webbrowser.open(url)),
                     daemon=True).start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\n종료합니다.")


if __name__ == "__main__":
    main()
