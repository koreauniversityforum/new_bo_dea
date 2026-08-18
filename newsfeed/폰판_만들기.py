# -*- coding: utf-8 -*-
"""폰판(서버 0개) 만들기 — static/ 을 그대로 재료로 쓴다.

젯슨·터널·열쇠 없이, 정적 파일만으로 폰에서 도는 배포판을 `폰판/` 에 굽는다.
화면 코드를 복사해 두 벌로 나누면 반드시 갈라지므로(이 프로젝트에서 이미 겪었다)
**원본을 고치지 않고** 여기서 옮겨 담으면서 세 가지만 손본다.

  1) 절대경로   `/static/…` `/fonts/…` `/assets/…`  → 같은 폴더 기준 상대경로
     (깃허브 페이지처럼 하위 폴더에 올려도 깨지지 않는다)
  2) 사진 대리요청  `proxy()` 는 서버가 없으니 주소를 그대로 돌려주고,
     캔버스 오염(=저장 실패)을 막으려 `loadImage()` 에 crossOrigin 을 붙인다
  3) 머리에 `summarizer.js` + `폰shim.js` 를 끼워 `/api/*` 를 브라우저가 처리하게 한다

담기는 화면: 만들기(index) · 뒷장(outro) · 워터마크(mark) · 릴스(reel) · 참고 사이트(refs)
빼는 화면  : 피드 글(캡션 생성기가 서버에 있다) · 주제 찾기(RSS 수집) ·
             폴더 정리 · 인스타 올리기
             (기사 수집·크롬 조종처럼 서버가 있어야만 되는 것들)

실행: python 폰판_만들기.py
"""
from __future__ import annotations

import os
import re
import shutil
import sys
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")
SRC = os.path.join(BASE, "폰판_소스")
# 구운 결과가 그대로 깃허브 페이지가 된다. 그래서 프로젝트 위의 `docs/` 로 굽는다
# (Pages 설정에서 main 브랜치의 /docs 를 가리키면 끝).
OUT = os.path.join(os.path.dirname(BASE), "docs")

PAGES = ["index.html", "outro.html", "mark.html", "reel.html", "refs.html"]
SCRIPTS = ["app.js", "brands.js", "nav.js", "prog.js", "hiddenmark.js",
           "outro.js", "outrostate.js", "refs.js", "save.js", "style.css"]
EXTRA = ["summarizer.js", "폰shim.js", "README.md"]


def fail(msg):
    print("‼ " + msg)
    sys.exit(1)


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


def relativize(s: str) -> str:
    """절대경로를 같은 폴더 기준으로 바꾼다."""
    s = s.replace('"/static/', '"').replace("'/static/", "'")
    s = s.replace('"/fonts/', '"fonts/').replace("'/fonts/", "'fonts/")
    s = s.replace('"/assets/', '"assets/').replace("'/assets/", "'assets/")
    s = s.replace('"/api/config.js"', '"config.js"')
    s = s.replace('href="/favicon.ico"', 'href="assets/뉴보대_로고.png"')
    # 🔴 「← 앞장 만들기」 는 서버판에선 루트(/)가 맞지만, 하위 폴더에 올린 폰판에선
    #    호스팅 루트(=남의 첫 화면)로 튀어 404 가 된다. 같은 폴더 기준으로 바꾼다.
    s = s.replace('href="/"', 'href="./"').replace("data-carry=\"/\"", 'data-carry="./"')
    return s


def patch_app_js(s: str) -> str:
    """서버가 하던 사진 대리요청을 걷어낸다.

    🔴 문구가 바뀌어 못 찾으면 **조용히 넘기지 않고 멈춘다**. 그냥 두면 폰판만
       사진이 안 나오는데, 그건 화면을 봐야 알 수 있어 늦게 발견된다.
    """
    old_proxy = ("const proxy = (url, ref) =>\n"
                 "  '/api/proxy?url=' + encodeURIComponent(url) + "
                 "(ref ? '&ref=' + encodeURIComponent(ref) : '');")
    if old_proxy not in s:
        fail("app.js 의 proxy() 를 못 찾았습니다 — 원본이 바뀌었는지 확인하세요.")
    s = s.replace(old_proxy, "/* 폰판: 서버가 없으므로 주소를 그대로 쓴다 */\n"
                             "const proxy = (url) => url;")

    old_load = ("    const im = new Image();\n"
                "    im.onload = () => res(im);")
    if old_load not in s:
        fail("app.js 의 loadImage() 를 못 찾았습니다 — 원본이 바뀌었는지 확인하세요.")
    s = s.replace(old_load,
                  "    const im = new Image();\n"
                  "    /* 폰판: 남의 사진을 캔버스에 올리려면 CORS 표시가 있어야 한다.\n"
                  "       없으면 그려지긴 해도 저장(toDataURL)에서 통째로 막힌다. */\n"
                  "    if (!/^(data:|blob:)/.test(src)) im.crossOrigin = 'anonymous';\n"
                  "    im.onload = () => res(im);")
    return s


HEAD_TAG = "<head>"
INJECT = ('\n<script src="config.js"></script>'
          '\n<script src="summarizer.js"></script>'
          '\n<script src="폰shim.js"></script>')


def build():
    if not os.path.isdir(STATIC):
        fail("static 폴더가 없습니다: " + STATIC)
    # 🔴 폴더를 통째로 지우면 안 된다. 이 폴더가 곧 깃 저장소(=올리는 곳)라
    #    `.git` 까지 날아가 버린다. 안에 든 것만 비우고 `.git` 은 남긴다.
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name == ".git":
            continue
        p = os.path.join(OUT, name)
        shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)

    for name in PAGES:
        src = os.path.join(STATIC, name)
        if not os.path.isfile(src):
            fail("화면 파일이 없습니다: " + name)
        s = relativize(read(src))
        if HEAD_TAG not in s:
            fail(name + " 에 <head> 가 없습니다.")
        # 다른 스크립트보다 먼저 들어가야 fetch/XHR 을 가로챌 수 있다
        s = s.replace(HEAD_TAG, HEAD_TAG + INJECT, 1)
        write(os.path.join(OUT, name), s)

    for name in SCRIPTS:
        src = os.path.join(STATIC, name)
        if not os.path.isfile(src):
            fail("스크립트가 없습니다: " + name)
        s = relativize(read(src))
        if name == "app.js":
            s = patch_app_js(s)
        write(os.path.join(OUT, name), s)

    for name in EXTRA:
        src = os.path.join(SRC, name)
        if not os.path.isfile(src):
            fail("폰판 소스가 없습니다: " + name)
        write(os.path.join(OUT, name), read(src))

    # 스타일 모드를 쓰는 본판 설정 (pure 판이 아니다)
    write(os.path.join(OUT, "config.js"),
          "window.NB_CONFIG = {\"pure\": false};\n"
          "window.NBD_BUILT = \"%s\";\n" % datetime.now().strftime("%Y-%m-%d %H:%M"))

    for folder in ("fonts", "assets"):
        shutil.copytree(os.path.join(BASE, folder), os.path.join(OUT, folder))

    # 깃허브 페이지는 Jekyll 을 거치며 일부 파일을 건너뛴다. 정적 그대로 내보낸다.
    write(os.path.join(OUT, ".nojekyll"), "")

    write(os.path.join(OUT, "읽어보세요.txt"),
          "뉴보대 카드뉴스 메이커 — 폰판(서버 0개)\n"
          "\n"
          "이 폴더는 정적 파일뿐입니다. 아무 웹 호스팅에 그대로 올리면\n"
          "젯슨·터널·열쇠 없이 폰에서 바로 열립니다.\n"
          "\n"
          "  · 되는 것 : 본문 붙여넣기 → 문구 후보 자동 생성, 사진 검색(Openverse·\n"
          "              위키미디어), 내 사진 넣기, 카드 디자인 전부, 뒷장, 워터마크,\n"
          "              사진으로 저장(내려받기)\n"
          "  · 안 되는 것 : 기사 URL 자동 가져오기(브라우저가 남의 사이트를 못 읽음),\n"
          "              인스타 자동 올리기, out 폴더 정리, 릴스(서버 폴더 필요)\n"
          "\n"
          "고칠 때는 이 폴더를 고치지 말고 static/ 을 고친 뒤\n"
          "`python 폰판_만들기.py` 를 다시 돌리세요. 이 폴더는 매번 새로 굽습니다.\n")

    total = sum(os.path.getsize(os.path.join(r, f))
                for r, _, fs in os.walk(OUT) for f in fs)
    print("폰판을 구웠습니다 → %s" % OUT)
    print("  화면 %d개 · 파일 %d개 · %.1f MB"
          % (len(PAGES),
             sum(len(fs) for _, _, fs in os.walk(OUT)),
             total / 1024 / 1024))


if __name__ == "__main__":
    build()
