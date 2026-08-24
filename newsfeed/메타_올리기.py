# -*- coding: utf-8 -*-
"""카드를 인스타 · 페이스북 페이지 · 스레드에 한 번에 올린다 (공식 API).

    python 메타_올리기.py --계정 news_univ
    python 메타_올리기.py --계정 모두 --창구 instagram,threads
    python 메타_올리기.py --계정 news_univ --폴더 "out/_임시_인스타" --문구파일 글.txt
    python 메타_올리기.py --계정 news_univ --시늉      ← 실제로 안 보내고 앞단만 점검

기본 폴더는 앱의 「담기」가 카드를 쌓아 두는 `out\\_임시_인스타\\` 다. 앱 화면에서 담고
여기서 올리면 손으로 파일을 고를 일이 없다.

## 알고 쓸 것
- 파일 이름 앞 번호가 **캐러셀 순서**다 (`01_…`, `02_…`).
- 인스타는 JPEG 만 받으므로 PNG 는 자동으로 JPEG 사본을 만든다(원본은 그대로 둔다).
- 스레드는 500자까지다. 인스타 문구가 길면 `--스레드문구` 로 짧은 것을 따로 준다.
- 창구 하나가 실패해도 나머지는 계속 간다. 끝에 창구별 성패를 모아 보여 준다.
"""
from __future__ import annotations

import argparse
import os
import sys

import meta_api as M

BASE = os.path.dirname(os.path.abspath(__file__))
기본폴더 = os.path.join(BASE, "out", "_임시_인스타")
그림확장 = (".png", ".jpg", ".jpeg", ".webp")


def 그림모으기(폴더):
    if not os.path.isdir(폴더):
        raise M.MetaError("폴더가 없습니다: %s" % 폴더)
    파일들 = [os.path.join(폴더, x) for x in sorted(os.listdir(폴더))
             if x.lower().endswith(그림확장)]
    if not 파일들:
        raise M.MetaError("`%s` 에 그림이 없습니다. 앱 화면에서 카드를 먼저 담으세요." % 폴더)
    return 파일들


def 문구읽기(인자, 폴더):
    if 인자.문구파일:
        with open(인자.문구파일, encoding="utf-8") as f:
            return f.read().strip()
    if 인자.문구:
        return 인자.문구
    딸린것 = os.path.join(폴더, "문구.txt")
    if os.path.isfile(딸린것):
        with open(딸린것, encoding="utf-8") as f:
            return f.read().strip()
    print("올릴 글을 붙여넣고 마지막 줄에 `.` 만 찍고 엔터를 치세요.")
    줄들 = []
    while True:
        try:
            줄 = input()
        except EOFError:
            break
        if 줄.strip() == ".":
            break
        줄들.append(줄)
    return "\n".join(줄들).strip()


def main(argv=None):
    p = argparse.ArgumentParser(add_help=True, description="메타 3창구 한 번에 올리기")
    p.add_argument("--계정", required=True, help="설정에 넣은 계정 이름, 또는 `모두`")
    p.add_argument("--폴더", default=기본폴더, help="올릴 그림이 든 폴더")
    p.add_argument("--문구", default=None)
    p.add_argument("--문구파일", default=None)
    p.add_argument("--스레드문구", default=None, help="스레드에만 쓸 짧은 글 (500자)")
    p.add_argument("--창구", default="instagram,facebook,threads",
                   help="쉼표로. 예: instagram,threads")
    p.add_argument("--시늉", action="store_true", help="실제로 안 보내고 앞단만 점검")
    인자 = p.parse_args(argv)

    설정 = M.설정읽기()
    if not 설정["계정"]:
        print("‼ 이어진 계정이 없습니다. 먼저 `python 메타_연결.py 연결 <이름>` 을 하세요.")
        return 1
    계정들 = list(설정["계정"]) if 인자.계정 in ("모두", "all") else [인자.계정]
    창구 = tuple(x.strip() for x in 인자.창구.split(",") if x.strip())

    try:
        그림 = 그림모으기(인자.폴더)
        문구 = 문구읽기(인자, 인자.폴더)
    except M.MetaError as e:
        print("‼ %s" % e)
        return 1
    if not 문구:
        print("‼ 올릴 글이 비었습니다.")
        return 1

    print("\n올릴 것: %d장 (%s)" % (len(그림), os.path.basename(인자.폴더)))
    for g in 그림:
        print("   - %s" % os.path.basename(g))
    print("글 %d자 / 창구: %s / 계정: %s%s"
          % (len(문구), ", ".join(창구), ", ".join(계정들), "  [시늉]" if 인자.시늉 else ""))
    if len(문구) > M.TH_최대글자 and "threads" in 창구 and 인자.스레드문구 is None:
        print("🔴 글이 %d자라 스레드(최대 %d자)에서는 막힙니다. `--스레드문구` 를 주세요."
              % (len(문구), M.TH_최대글자))

    if not 인자.시늉 and input("\n이대로 올릴까요? (y/n) ").strip().lower() not in ("y", "yes"):
        print("그만둡니다.")
        return 0

    전체 = {}
    for 키 in 계정들:
        print("\n=== %s ===" % 키)
        try:
            전체[키] = M.올리기(키, 그림, 문구, 창구=창구, 스레드문구=인자.스레드문구,
                              설정=설정, 시늉=인자.시늉)
        except M.MetaError as e:
            print("  ‼ %s" % e)
            전체[키] = [{"창구": "-", "ok": False, "왜": str(e)}]

    print("\n──────── 마무리 ────────")
    실패 = 0
    for 키, rs in 전체.items():
        for r in rs:
            표 = "✔" if r.get("ok") else "✘"
            실패 += 0 if r.get("ok") else 1
            print("%s %-22s %-12s %s" % (표, 키, r.get("창구", ""),
                                         r.get("링크") or r.get("왜", "")))
    return 1 if 실패 else 0


if __name__ == "__main__":
    sys.exit(main())
