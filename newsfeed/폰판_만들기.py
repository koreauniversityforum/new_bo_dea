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
           "outro.js", "outrostate.js", "refs.js", "save.js", "style.css",
           "deck.js",                      # 시리즈(캐러셀) 편집기 - 2026-08-23
           "bgm.js"]                        # 추천 노래(무드+검색어) - 2026-08-24
EXTRA = ["summarizer.js", "폰shim.js", "README.md",
         # 메타 로그인이 끝나고 돌아올 자리. 화면 코드가 아니라 **주소창의 code 를
         # 보여 주기만 하는** 한 장이라 폰shim 을 끼우지 않는다(PAGES 가 아닌 이유).
         "connect.html"]

# 🔴 docs/ 를 비울 때 남겨 둘 것. `오늘.html`·`오늘.json` 은 새벽에 자동으로 구운 카드를
#    검토·발행하는 화면이라 폰판을 다시 구워도 남아야 한다. `올림/` 은 메타 API 가 게시하는 동안 그림을 잠깐
#    올려 두는 자리다 - 여기서 지워 버리면 올리던 중에 그림이 사라진다.
KEEP = {".git", "올림", "오늘.html", "오늘.json"}


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
    # 🔴 「오늘의 뉴스」(서버가 봇 JSON 을 읽는 화면)는 폰판에 없다. 대신 같은 일을 하는
    #    「정기 뉴스 메이커」(오늘.html)로 보낸다. nav.js 도 실행 중에 같은 일을 하지만,
    #    nav.js 가 캐시로 늦게 오면 링크가 404 로 새므로 **구울 때 주소를 박아 둔다.**
    s = s.replace('href="daily.html"', 'href="오늘.html"')
    return s


PHONE_PROXY = r"""/* 폰판: 서버가 없으니 사진도 대리인을 하나 거친다.

   🔴 언론사 사진 서버(imgnews.pstatic.net 등)는 CORS 헤더를 주지 않는다. 아래
      loadImage() 가 crossOrigin='anonymous' 를 붙이므로 브라우저가 **아예 거부**한다
      — 폰에서 기사 사진이 안 뜨던 정체가 이것이다. crossOrigin 을 떼면 보이기는
      하나 캔버스가 오염돼 저장이 통째로 막히므로, 떼는 대신 CORS 를 붙여 주는
      곳(wsrv.nl)을 거친다. 실측: 200 · CORS=* · 원본 그대로의 PNG.

   🔴 이미 CORS 를 주는 곳(위키미디어·Openverse)은 **그냥 둔다.** 전부 대리인에게
      맡기면, 지금 잘 되는 사진 검색까지 남의 서비스와 함께 죽는다.

   🔴 두 번 감싸면 안 된다 — app.js 안에서 proxy() 가 겹쳐 불릴 수 있고(1090줄 주석),
      저장된 상태를 다시 읽을 때도 겹친다. 이미 감싼 주소는 그대로 돌려준다. */
const IMG_DIRECT = /(^|\.)(wikimedia\.org|wikipedia\.org|openverse\.org)$/i;
const IMG_PROXY = 'https://wsrv.nl/?url=';
const proxy = (url) => {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return u;          // data: · blob: · 같은 폴더 파일
  if (u.startsWith(IMG_PROXY)) return u;           // 이미 감쌌다
  try { if (IMG_DIRECT.test(new URL(u).hostname)) return u; } catch (e) { return u; }
  return IMG_PROXY + encodeURIComponent(u);
};"""


def patch_app_js(s: str) -> str:
    """서버가 하던 사진 대리요청을 폰에서도 되게 갈아 끼운다.

    🔴 문구가 바뀌어 못 찾으면 **조용히 넘기지 않고 멈춘다**. 그냥 두면 폰판만
       사진이 안 나오는데, 그건 화면을 봐야 알 수 있어 늦게 발견된다.
    """
    old_proxy = ("const proxy = (url, ref) =>\n"
                 "  '/api/proxy?url=' + encodeURIComponent(url) + "
                 "(ref ? '&ref=' + encodeURIComponent(ref) : '');")
    if old_proxy not in s:
        fail("app.js 의 proxy() 를 못 찾았습니다 — 원본이 바뀌었는지 확인하세요.")
    s = s.replace(old_proxy, PHONE_PROXY)

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
    #    `.git` 까지 날아가 버린다. 안에 든 것만 비우고 KEEP 은 남긴다.
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name in KEEP:
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
          "  · 되는 것 : 기사 URL 붙여넣기(대신 읽어 주는 r.jina.ai 를 거친다),\n"
          "              본문 붙여넣기 → 문구 후보 자동 생성, 사진 검색(Openverse·\n"
          "              위키미디어), 내 사진 넣기, 카드 디자인 전부, 뒷장, 워터마크,\n"
          "              시리즈(캐러셀) 편집기 - 장 추가·자동 구성(규칙기반)·PNG 전부 내려받기,\n"
          "              내 프리셋, 릴스(손으로 녹화 - 사진을 골라 만든다), 사진으로 저장(내려받기)\n"
          "  · 안 되는 것 : 인스타 자동 올리기, out 폴더 정리·시리즈 out 저장, 피드 글, 주제 찾기,\n"
          "              AI 문구(PC 앱에서만), 릴스 「최근 세트 자동 담기」(서버 out 폴더가 있어야 한다)\n"
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
