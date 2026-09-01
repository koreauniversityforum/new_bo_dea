# -*- coding: utf-8 -*-
"""기사 손질 - 카드에 넣을 **사진**과 **요약**을 미리 챙긴다.

    python prep.py --data 기사.json --photos 사진폴더

새벽 브리핑은 원래 제목만으로 카드를 세웠다. 그래서 사진이 없는 카드가
'검은 화면'처럼 보였고, 카드마다 할 말도 없었다(2026-09-02 지적).
여기서 기사마다 한 번씩 본문을 읽어
  - `og:image` → **사진 파일로 내려받아** 둔다(카드 배경)
  - 본문 두 문장 → **요약**(카드 본문 + 피드 글 재료)
  - 언론사 이름
을 채워 넣은 기사.json 을 다시 쓴다.

🔴 사진을 주소 그대로 캔버스에 얹으면 다른 출처라 캔버스가 오염돼 `toDataURL()` 이
   막힌다. 그래서 **파일로 받아 두고** 굽는 쪽에서 같은 출처로 얹는다.
🔴 기사 5건이면 요청도 5번뿐이다(사람이 앱에서 하는 것과 같은 양). 실패해도
   그 기사만 사진·요약 없이 간다 - 카드는 어떻게든 나와야 한다.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "newsfeed"))
import extractor  # noqa: E402
import summarizer  # noqa: E402

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")


def 사진받기(url: str, 낼곳: str, 보낸곳: str = "") -> str:
    """그림 하나를 파일로. 실패하면 빈 문자열."""
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
    p = 낼곳 + ext
    with open(p, "wb") as f:
        f.write(blob)
    return p


def 손질(items, 사진폴더):
    os.makedirs(사진폴더, exist_ok=True)
    for i, it in enumerate(items, 1):
        url = (it.get("url") or "").strip()
        머리 = "%d/%d %s" % (i, len(items), (it.get("title") or "")[:28])
        if not url:
            continue
        try:
            got = extractor.extract(url)
        except Exception as e:
            print("  · %s - 본문 실패(%s)" % (머리, e), flush=True)
            continue

        본문 = (got.get("body") or "").strip()
        if 본문:
            try:
                # summarize() 는 **후보 목록**을 준다(첫째가 핵심 문장 묶음). 한 줄만 쓴다.
                후보 = summarizer.summarize(본문, it.get("title", ""), limit=95, n=2) or []
                it["summary"] = (후보[0] if 후보 else "").strip()
            except Exception:
                pass
        if got.get("press"):
            it["press"] = got["press"]

        for 후보 in (got.get("images") or [])[:4]:
            try:
                p = 사진받기(후보, os.path.join(사진폴더, "%02d" % i), url)
                it["photo"] = os.path.basename(p)
                break
            except Exception:
                continue
        print("  · %s - 사진 %s / 요약 %d자"
              % (머리, it.get("photo", "없음"), len(it.get("summary", ""))), flush=True)
    return items


def main(argv=None):
    ap = argparse.ArgumentParser(description="기사 사진·요약 챙기기")
    ap.add_argument("--data", required=True)
    ap.add_argument("--photos", required=True)
    a = ap.parse_args(argv)

    with open(a.data, encoding="utf-8") as f:
        d = json.load(f)
    d["items"] = 손질(d.get("items") or [], a.photos)
    with open(a.data, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)

    사진 = sum(1 for x in d["items"] if x.get("photo"))
    요약 = sum(1 for x in d["items"] if x.get("summary"))
    print("사진 %d/%d · 요약 %d/%d" % (사진, len(d["items"]), 요약, len(d["items"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
