# -*- coding: utf-8 -*-
"""토큰 갱신 - 주 1회 돌리면 60일짜리를 영원히 이어 갈 수 있다.

    python 메타_갱신.py            만료가 20일 안쪽인 것만 새로 받는다
    python 메타_갱신.py --전부     남은 날과 상관없이 다 새로 받는다

## 왜 이걸 자동으로 돌려야 하나
🔴 페이스북 사용자 토큰과 스레드 토큰은 **60일**이다. 한 번이라도 넘기면 죽고, 그때는
사람이 브라우저를 열어 처음부터 다시 동의해야 한다(`메타_연결.py 연결`). 반대로 살아
있는 동안 다시 교환하면 60일이 새로 붙으므로, 주 1회만 돌면 손댈 일이 없다.
(페이스북 **페이지** 토큰은 장기 사용자 토큰에서 나온 것이라 만료가 없다.)

## 윈도우 작업 스케줄러에 걸기 (매주 월요일 새벽 4시)
    schtasks /create /tn "뉴보대 메타토큰" /tr "python \"<이 파일 경로>\"" /sc weekly /d MON /st 04:00
"""
from __future__ import annotations

import sys
from datetime import datetime

import meta_api as M


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    전부 = "--전부" in argv
    설정 = M.설정읽기()
    if not 설정["계정"]:
        print("이어진 계정이 없습니다.")
        return 1
    앱 = M.앱정보(설정)
    바뀜 = False
    문제 = 0
    print("[%s] 토큰 점검" % datetime.now().strftime("%Y-%m-%d %H:%M"))
    for 키, 계정 in 설정["계정"].items():
        print("- %s" % 키)
        if 전부:
            # 만료를 지워 두면 `토큰갱신` 이 무조건 새로 받는다
            for 갈래 in ("facebook", "threads"):
                if 계정.get(갈래):
                    계정[갈래].pop("만료", None)
        try:
            if M.토큰갱신(계정, 앱, 로그=print):
                바뀜 = True
            else:
                print("  아직 넉넉합니다 (건드리지 않음)")
        except M.MetaError as e:
            문제 += 1
            print("  ‼ %s" % e)
    if 바뀜:
        print("저장:", M.설정쓰기(설정))
    return 1 if 문제 else 0


if __name__ == "__main__":
    sys.exit(main())
