# -*- coding: utf-8 -*-
"""문구 초안 만들기 - 고른 기사 제목으로 인스타 캡션 뼈대를 쓴다.

    python caption.py --data 기사.json > 문구.txt

앱의 `feed.py` 는 **기사 본문**에서 문장을 뽑아 쓰지만, 새벽 자동 굽기는 본문을 긁지
않는다(느리고 언론사에 무리다). 그래서 여기서는 제목만으로 뼈대를 만든다.
사람이 검토 화면에서 고쳐 쓰는 것을 전제로 한 초안이다.

🔴 제목은 언론사 문장이다. 그대로 올리면 남의 문장을 옮기는 셈이므로 검토 화면에서
   본인 말로 바꾸도록 안내 문구를 함께 남긴다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys

TAGS = ["뉴스", "뉴스요약", "시사", "대학생", "오늘의뉴스", "뉴보대", "한국대학생포럼"]
# 제목에서 자주 나오는 분야말 → 해시태그. 없으면 기본 태그만 쓴다.
분야 = [("예산", "예산안"), ("부동산", "부동산"), ("금리", "금리"), ("환율", "환율"),
        ("반도체", "반도체"), ("AI", "AI"), ("인공지능", "AI"), ("고용", "고용"),
        ("北", "북한"), ("북한", "북한"), ("대통령", "대통령실"), ("국회", "국회"),
        ("검찰", "검찰"), ("법원", "법원"), ("추석", "추석"), ("의료", "의료")]


def 날짜말(s: str) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s or "")
    return "%d월 %d일" % (int(m.group(2)), int(m.group(3))) if m else "오늘"


def 인용줄(items) -> list:
    """같은 발언을 실은 보도가 가장 많이 붙은 기사 하나를 골라 그 묶음을 적는다.

    붙여 주는 쪽은 `prep.py`(→ prepare.인용찾기) 다. 없으면 이 절은 통째로 빠진다.
    """
    후보 = [it for it in items if (it.get("quoted") or {}).get("items")]
    if not 후보:
        return []
    it = max(후보, key=lambda x: x["quoted"]["n"])
    q = it["quoted"]
    매체 = []
    for r in q["items"]:
        p = (r.get("press") or "").strip()
        if p and p not in 매체:
            매체.append(p)
    줄 = ["", "🗣 “%s”" % q["quote"],
          "이 발언을 그대로 실은 보도 %d건%s"
          % (q["n"], (" · " + " · ".join(매체[:4])) if 매체 else "")]
    if q["n"] < 3:
        줄.append("(3건을 채우지 못했습니다 — 같은 발언을 실은 기사가 이만큼만 잡혔습니다)")
    for r in q["items"][:5]:
        줄.append("· %s — %s" % ((r.get("press") or "(언론사 미상)"), (r.get("title") or "").strip()))
    return 줄


def 만들기(d: dict) -> str:
    items = d.get("items") or []
    날 = 날짜말(d.get("date") or "")
    줄 = ["📰 %s 오늘의 뉴스" % 날, ""]
    for i, it in enumerate(items, 1):
        줄.append("%d. %s" % (i, (it.get("title") or "").strip()))
        # 14차부터 기사마다 두 문장 요약이 붙는다. 제목만 늘어놓으면 읽을 것이 없다.
        요약 = (it.get("summary") or "").strip()
        if 요약:
            줄.append("   " + 요약)
    줄 += 인용줄(items)
    줄 += ["", "자세한 내용은 각 카드에서 확인하세요.", ""]

    태그 = list(TAGS)
    붙은 = " ".join((it.get("title") or "") for it in items)
    for 말, 태 in 분야:
        if 말 in 붙은 and 태 not in 태그:
            태그.append(태)
    줄.append(" ".join("#" + t for t in 태그))
    출처 = sorted({(it.get("source") or "").strip() for it in items if it.get("source")})
    if 출처:
        줄 += ["", "출처: " + ", ".join(출처)]
    return "\n".join(줄).strip()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="", help="파일로 쓰기(없으면 표준출력)")
    a = ap.parse_args()
    with open(a.data, encoding="utf-8") as f:
        글 = 만들기(json.load(f))
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(글)
    else:
        # 윈도우 콘솔은 기본이 cp949 라 이모지에서 죽는다 - 내보낼 때만 UTF-8 로 바꾼다
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
        print(글)
