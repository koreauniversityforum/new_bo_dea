# -*- coding: utf-8 -*-
"""기사 손질(자동 굽기용 창구) - 알맹이는 `newsfeed/prepare.py` 에 있다.

    python prep.py --data 기사.json --photos 사진폴더

새벽 브리핑은 원래 제목만으로 카드를 세웠다. 그래서 사진이 없는 카드가 '검은 화면'처럼
보였고 카드마다 할 말도 없었다(2026-09-02 지적). 기사마다 한 번씩 본문을 읽어 사진·요약·
언론사를 채운 기사.json 을 다시 쓴다.

🔴 같은 일을 앱의 「오늘의 뉴스」도 한다(`/api/daily-prep`). 두 벌을 두면 한쪽만
   고쳐지므로 알맹이는 `prepare.py` 하나뿐이고 여기는 파일을 읽고 쓰기만 한다.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "newsfeed"))
import prepare  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description="기사 사진·요약 챙기기")
    ap.add_argument("--data", required=True)
    ap.add_argument("--photos", required=True)
    ap.add_argument("--no-quotes", action="store_true",
                    help="같은 발언을 실은 보도 찾기를 건너뛴다(검색을 아낄 때)")
    a = ap.parse_args(argv)

    말하기 = lambda s: print(s, flush=True)          # noqa: E731
    with open(a.data, encoding="utf-8") as f:
        d = json.load(f)
    d["items"] = prepare.손질(d.get("items") or [], a.photos, 알림=말하기)
    if not a.no_quotes:
        # 화면(정기 뉴스 메이커)은 서버가 없어 검색을 못 한다. 여기서 찾아 붙여 둔다.
        print("같은 발언을 실은 보도 찾는 중…", flush=True)
        prepare.인용찾기(d["items"], 알림=말하기)
    with open(a.data, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)

    사진 = sum(1 for x in d["items"] if x.get("photo"))
    요약 = sum(1 for x in d["items"] if x.get("summary"))
    인용 = sum(1 for x in d["items"] if (x.get("quoted") or {}).get("n"))
    print("사진 %d/%d · 요약 %d/%d · 인용 묶음 %d건"
          % (사진, len(d["items"]), 요약, len(d["items"]), 인용))
    return 0


if __name__ == "__main__":
    sys.exit(main())
