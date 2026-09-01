# -*- coding: utf-8 -*-
"""발행 — 구워 둔 카드를 인스타 · 페이스북 페이지 · 스레드에 올린다 (Actions 안에서).

    python publish.py --images 카드폴더 --caption 문구.txt [--창구 instagram,threads] [--시늉]

앱의 「6. 공식 API 로 발행」과 **같은 길**(`meta_api.올리기`)을 탄다. 다른 점은 하나,
노트북이 아니라 워크플로 안에서 돈다는 것뿐이다.

## 설정은 어디서 오나
`META_CONFIG` 시크릿(=`메타_연결.py` 가 만든 설정 JSON 통째)을 환경변수로 받는다.
시크릿에 호스팅 칸이 없으면 **이 레포의 깃허브 페이지**를 쓴다 - 인스타·스레드는 그림을
공개 HTTPS 주소로만 받기 때문이다. 올린 그림은 게시가 끝나면 meta_api 가 도로 지운다.

## 남기는 것
`발행기록/YYYY-MM-DD.json` - 무엇을 언제 어디에 올렸는지와 게시물 링크. 그림은 안 남긴다
(인스타에 올라갔고, 레포에 계속 두면 저장소만 뚱뚱해진다).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "newsfeed"))
import meta_api as M  # noqa: E402

KST = timezone(timedelta(hours=9))
그림확장 = (".jpg", ".jpeg", ".png")


def 설정가져오기():
    raw = os.environ.get("META_CONFIG") or ""
    if not raw.strip():
        raise M.MetaError("META_CONFIG 시크릿이 비었습니다. `메타_연결.py` 로 만든 설정을 넣으세요.")
    try:
        cfg = json.loads(raw)
    except json.JSONDecodeError as e:
        raise M.MetaError("META_CONFIG 를 JSON 으로 못 읽었습니다: %s" % e)
    cfg.setdefault("앱", {})
    cfg.setdefault("계정", {})
    호스팅 = dict(cfg.get("호스팅") or {})
    # 워크플로 안에서는 항상 이 체크아웃을 저장소로 쓴다(시크릿에 적힌 남의 경로는 없다)
    if (호스팅.get("방식") or "깃허브페이지") == "깃허브페이지":
        호스팅["방식"] = "깃허브페이지"
        호스팅["저장소"] = ROOT
        호스팅.setdefault("공개주소", "https://koreauniversityforum.github.io/new_bo_dea/")
        호스팅.setdefault("하위", "docs/올림")
    cfg["호스팅"] = 호스팅
    return cfg


def 그림모으기(폴더):
    if not os.path.isdir(폴더):
        raise M.MetaError("카드 폴더가 없습니다: %s" % 폴더)
    파일들 = [os.path.join(폴더, x) for x in sorted(os.listdir(폴더))
             if x.lower().endswith(그림확장)]
    if not 파일들:
        raise M.MetaError("`%s` 에 그림이 없습니다." % 폴더)
    if len(파일들) > 10:
        raise M.MetaError("캐러셀은 최대 10장인데 %d장입니다." % len(파일들))
    return 파일들


def 기록쓰기(날짜, 계정, 결과, 문구, 파일들):
    d = os.path.join(ROOT, "발행기록")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, "%s.json" % 날짜)
    옛것 = []
    if os.path.isfile(p):
        try:
            with open(p, encoding="utf-8") as f:
                옛것 = json.load(f).get("발행", [])
        except Exception:
            옛것 = []
    옛것.append({
        "때": datetime.now(KST).isoformat(timespec="seconds"),
        "계정": 계정,
        "장수": len(파일들),
        "문구": 문구,
        "결과": [{"창구": r.get("창구"), "ok": r.get("ok"),
                 "링크": r.get("링크", ""), "왜": r.get("왜", "")} for r in 결과],
    })
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"날짜": 날짜, "발행": 옛것}, f, ensure_ascii=False, indent=1)
    return p


def main(argv=None):
    ap = argparse.ArgumentParser(description="카드 발행 (Actions)")
    ap.add_argument("--images", required=True)
    ap.add_argument("--caption", required=True, help="문구가 든 텍스트 파일")
    ap.add_argument("--account", default="")
    ap.add_argument("--channels", default="instagram,facebook,threads")
    ap.add_argument("--date", default="")
    ap.add_argument("--dry", action="store_true", help="앞단만 점검하고 실제로 안 보냄")
    a = ap.parse_args(argv)

    with open(a.caption, encoding="utf-8") as f:
        문구 = f.read().strip()
    if not 문구:
        print("‼ 문구가 비었습니다.")
        return 1

    cfg = 설정가져오기()
    계정들 = list(cfg.get("계정") or {})
    if not 계정들:
        print("‼ META_CONFIG 에 이어진 계정이 없습니다.")
        return 1
    키 = a.account or 계정들[0]
    if 키 not in 계정들:
        print("‼ `%s` 계정이 설정에 없습니다. 있는 것: %s" % (키, ", ".join(계정들)))
        return 1

    파일들 = 그림모으기(a.images)
    창구 = tuple(x.strip() for x in a.channels.split(",") if x.strip())
    날짜 = a.date or datetime.now(KST).strftime("%Y-%m-%d")

    print("올릴 것: %d장 / 창구 %s / 계정 %s%s"
          % (len(파일들), ", ".join(창구), 키, "  [시늉]" if a.dry else ""))
    # 스레드는 500자까지다. 넘으면 스레드 몫만 잘라 보낸다(나머지 창구는 원문 그대로).
    스레드문구 = 문구 if len(문구) <= M.TH_최대글자 else 문구[:M.TH_최대글자 - 1] + "…"

    결과 = M.올리기(키, 파일들, 문구, 창구=창구, 스레드문구=스레드문구,
                  설정=cfg, 로그=lambda s: print(s, flush=True), 시늉=a.dry)

    실패 = [r for r in 결과 if not r.get("ok")]
    if not a.dry:
        p = 기록쓰기(날짜, 키, 결과, 문구, 파일들)
        print("기록: %s" % os.path.relpath(p, ROOT))

    print("──────── 마무리 ────────")
    for r in 결과:
        print("%s %-12s %s" % ("✔" if r.get("ok") else "✘", r.get("창구", ""),
                               r.get("링크") or r.get("왜", "")))
    return 1 if 실패 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except M.MetaError as e:
        print("‼ %s" % e)
        sys.exit(1)
