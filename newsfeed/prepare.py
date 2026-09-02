# -*- coding: utf-8 -*-
"""기사 손질 - 카드에 넣을 **사진**과 **요약**을 챙긴다.

브리핑(여러 기사를 한 게시물로)은 원래 제목만으로 카드를 세웠다. 그래서 사진이 없는
카드가 '검은 화면'처럼 보였고 카드마다 할 말도 없었다(2026-09-02 지적). 여기서
기사마다 한 번씩 본문을 읽어
  - `og:image` → **사진 파일로 내려받아** 둔다 (카드 배경)
  - 본문 두 문장 → **요약** (카드 본문 + 피드 글 재료)
  - 언론사 이름
을 채운다.

## 쓰는 곳이 둘이다
  - 새벽 자동 굽기 : `.github/cards/prep.py` (Actions, 기사.json 을 통째로)
  - 앱 「오늘의 뉴스」: `app.py` 의 `/api/daily-prep` (사람이 고른 기사만, 한 건씩)
같은 일을 두 벌 두면 한쪽만 고쳐지므로 알맹이는 여기 하나뿐이다.

🔴 사진을 **주소 그대로** 캔버스에 얹으면 다른 출처라 캔버스가 오염돼 `toDataURL()` 이
   막힌다. 그래서 파일로 받아 두고, 굽는 쪽이 **같은 출처** 주소로 얹는다.
🔴 기사 하나에 요청 하나뿐이다(사람이 앱에서 하는 것과 같은 양). 실패해도 그 기사만
   사진·요약 없이 간다 - 카드는 어떻게든 나와야 한다.
"""
from __future__ import annotations

import os
import time
import urllib.request

import extractor
import summarizer

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")


def 사진받기(url: str, 낼자리: str, 보낸곳: str = "") -> str:
    """그림 하나를 파일로 받는다. 낼자리는 **확장자 없는** 경로. 실패하면 예외."""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Referer": 보낸곳 or "https://n.news.naver.com/",
        "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        ctype = (r.headers.get("Content-Type") or "").lower()
        if "image" not in ctype:
            raise ValueError("그림이 아닙니다(%s)" % ctype[:40])
        blob = r.read()
    if len(blob) < 4000:                       # 1x1 추적용 그림·오류 그림 거르기
        raise ValueError("너무 작습니다(%d바이트)" % len(blob))
    ext = ".png" if "png" in ctype else (".webp" if "webp" in ctype else ".jpg")
    p = 낼자리 + ext
    with open(p, "wb") as f:
        f.write(blob)
    return p


def 한건(it: dict, 사진폴더: str, 이름: str) -> dict:
    """기사 한 줄을 손질해 **그 자리에서** 채운다. 어떤 실패도 밖으로 내보내지 않는다.

    `이름` 은 사진 파일의 이름(확장자 없이). 돌려주는 것은 넣어 준 dict 그대로다.
    """
    url = (it.get("url") or "").strip()
    if not url:
        return it
    try:
        got = extractor.extract(url)
    except Exception as e:
        it["prep_error"] = str(e)
        return it

    본문 = (got.get("body") or "").strip()
    if 본문:
        try:
            # summarize() 는 **후보 목록**을 준다(첫째가 핵심 문장 묶음). 한 줄만 쓴다.
            후보 = summarizer.summarize(본문, it.get("title", ""), limit=95, n=2) or []
            it["summary"] = (후보[0] if 후보 else "").strip()
        except Exception:
            pass
        try:
            # 쌍따옴표 발언. 여기서 뽑아 두면 나중에 **같은 발언을 실은 보도**를 찾을 수
            # 있다(2026-09-02 요구). 본문 자체는 안 남긴다 - 오늘.json 이 매일 커진다.
            import related
            말 = related.quotes(본문, 3)
            if 말:
                it["quotes"] = 말
        except Exception:
            pass
    if got.get("press"):
        it["press"] = got["press"]

    os.makedirs(사진폴더, exist_ok=True)
    for 후보 in (got.get("images") or [])[:4]:
        try:
            p = 사진받기(후보, os.path.join(사진폴더, 이름), url)
            it["photo"] = os.path.basename(p)
            break
        except Exception:
            continue
    return it


def 손질(items, 사진폴더: str, 이름짓기=None, 알림=None):
    """기사 여럿을 차례로. `이름짓기(i, it)` 가 사진 이름을 정한다(기본 01, 02…)."""
    os.makedirs(사진폴더, exist_ok=True)
    이름짓기 = 이름짓기 or (lambda i, it: "%02d" % i)
    for i, it in enumerate(items, 1):
        한건(it, 사진폴더, 이름짓기(i, it))
        if 알림:
            알림("  · %d/%d %s - 사진 %s / 요약 %d자"
                 % (i, len(items), (it.get("title") or "")[:28],
                    it.get("photo", "없음"), len(it.get("summary", ""))))
    return items


def 인용찾기(items, need: int = 3, 알림=None):
    """기사마다 **같은 발언을 실은 다른 보도**를 찾아 붙인다.

    카드 화면(정기 뉴스 메이커)은 서버가 없어 검색을 못 한다 - 구글 뉴스는 대리인
    (r.jina.ai)이 403 으로 막고, 네이버 검색 화면은 짜임이 자주 바뀐다(실측). 그래서
    **굽는 쪽에서 미리 찾아** `quoted` 로 붙여 두고, 화면은 그것을 보여 주기만 한다.

    붙는 것(작게): {"quote", "n", "verified", "items":[{press,title,link}]}
    """
    try:
        import related
    except Exception:
        return items
    for i, it in enumerate(items, 1):
        말 = it.get("quotes") or []
        if not 말:
            continue
        try:
            r = related.find_quoted(말, need=need, deep=False)
        except Exception as e:
            if 알림:
                알림("  · %d 인용 검색 실패(%s)" % (i, e))
            continue
        if not r.get("items"):
            continue
        it["quoted"] = {
            "quote": r.get("quote") or 말[0],
            "n": len(r["items"]), "verified": r.get("verified", 0),
            "items": [{"press": x.get("press", ""), "title": x.get("title", ""),
                       "link": x.get("link", "")} for x in r["items"][:6]],
        }
        if 알림:
            알림("  · %d/%d 같은 발언 보도 %d건 — %s"
                 % (i, len(items), it["quoted"]["n"], it["quoted"]["quote"][:26]))
    return items


def 묵은사진지우기(사진폴더: str, 날수: int = 3) -> int:
    """며칠 지난 사진 파일을 치운다(앱이 계속 쓰는 폴더라 쌓이면 안 된다)."""
    지운수 = 0
    한계 = time.time() - 날수 * 86400
    for x in os.listdir(사진폴더) if os.path.isdir(사진폴더) else []:
        p = os.path.join(사진폴더, x)
        try:
            if os.path.isfile(p) and os.path.getmtime(p) < 한계:
                os.remove(p)
                지운수 += 1
        except OSError:
            pass
    return 지운수
