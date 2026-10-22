# -*- coding: utf-8 -*-
"""발행 - 구워 둔 카드를 인스타 · 페이스북 페이지 · 스레드에 올린다 (Actions 안에서).

    python publish.py --images 카드폴더 --caption 문구.txt --urls 주소.json [--dry]

앱의 「6. 공식 API 로 발행」과 같은 `meta_api` 함수를 부른다. 다른 점은 둘.
  ① 노트북이 아니라 워크플로 안에서 돈다.
  ② **그림을 새로 호스팅하지 않는다.** 카드는 이미 `cards` 브랜치에 올라가 있어
     raw.githubusercontent.com 의 공개 주소를 가진다(인스타·스레드가 요구하는 것이 이것뿐).
     그래서 meta_api 의 호스팅 단계를 건너뛰고 창구 함수를 바로 부른다.
     페이스북만은 바이트를 직접 올리므로 내려받아 둔 파일을 쓴다.

## 설정
`META_CONFIG` 시크릿 = `메타_연결.py` 가 만든 설정 JSON 통째. 토큰이 들어 있으므로
로그에 절대 찍지 않는다.

## 남기는 것
`발행기록/YYYY-MM-DD.json` - 무엇을 언제 어디에 올렸는지와 게시물 링크.
그림은 안 남긴다(인스타에 올라갔고, 레포에 두면 저장소만 뚱뚱해진다).
"""
from __future__ import annotations

import argparse
import json
import os
import re
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


def 기록쓰기(날짜, 계정키, 결과, 문구, 장수):
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
        "계정": 계정키,
        "장수": 장수,
        "문구": 문구,
        "결과": [dict({"창구": r.get("창구"), "ok": r.get("ok"),
                      "링크": r.get("링크", ""), "왜": r.get("왜", "")},
                     **({"댓글": r["댓글"]} if r.get("댓글") else {})) for r in 결과],
    })
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"날짜": 날짜, "발행": 옛것}, f, ensure_ascii=False, indent=1)
    return p


def 태그뽑기(글):
    return re.findall(r"#[^\s#]+", 글 or "")


def 첫댓글(계정, 미디어, 인스타문구, 댓글, 로그):
    """첫 댓글은 덤이다 - 실패해도 게시는 이미 끝났으므로 발행 실패로 치지 않고 경고로 남긴다."""
    태그 = [t for t in (댓글.get("tags") or []) if isinstance(t, str) and t.startswith("#")]
    본문태그 = 태그뽑기(인스타문구)
    if len(set(태그) | set(본문태그)) > M.IG_최대태그:
        로그("  ⚠ 해시태그가 본문·답글 합쳐 %d개라 첫 댓글을 안 답니다(인스타는 게시물당 %d개)."
            % (len(set(태그) | set(본문태그)), M.IG_최대태그))
        return {"ok": False, "왜": "해시태그 %d개 초과" % M.IG_최대태그}
    try:
        M.인스타_첫댓글(계정, 미디어, (댓글.get("text") or "").strip(), 태그, 로그)
        return {"ok": True}
    except Exception as e:
        왜 = str(e)
        if "(#10)" in 왜 or "permission" in 왜.lower():
            왜 = "댓글 권한(instagram_manage_comments)이 없습니다 - 메타 앱에 권한을 더하고 다시 동의해야 합니다"
        로그("  ⚠ 첫 댓글 실패(게시는 올라감): %s" % 왜)
        return {"ok": False, "왜": 왜}


def 방금올린것(날짜, 문구, 장수, 분=30):
    """같은 글·같은 장수가 `분` 안에 이미 올라갔으면 그 기록을 준다.

    🔴 2026-10-21: 화면이 결과를 못 따라가 실패처럼 보였고, 다시 눌러 인스타·페이스북에 같은 글이
       두 번 올라갔다. 화면만 고치면 다른 길(이슈 댓글·다른 기기)로는 또 생기므로 여기서 막는다.
    """
    p = os.path.join(ROOT, "발행기록", "%s.json" % 날짜)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, encoding="utf-8") as f:
            옛것 = json.load(f).get("발행", [])
    except Exception:
        return None
    지금 = datetime.now(KST)
    for x in reversed(옛것):
        try:
            때 = datetime.fromisoformat(x.get("때", ""))
        except ValueError:
            continue
        if (x.get("문구") == 문구 and x.get("장수") == 장수 and 지금 - 때 < timedelta(minutes=분)
                and any(r.get("ok") for r in x.get("결과") or [])):
            return x
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description="카드 발행 (Actions)")
    ap.add_argument("--images", required=True, help="내려받아 둔 카드 폴더")
    ap.add_argument("--caption", required=True, help="문구가 든 텍스트 파일")
    ap.add_argument("--urls", default="", help="카드의 공개 주소 목록 JSON(없으면 meta_api 가 직접 호스팅)")
    ap.add_argument("--account", default="")
    ap.add_argument("--channels", default="instagram,facebook,threads")
    ap.add_argument("--date", default="")
    ap.add_argument("--dry", action="store_true", help="앞단만 점검하고 실제로 안 보냄")
    ap.add_argument("--comment", default="", help="인스타 첫 댓글 JSON {ig_caption, text, tags} (없으면 안 단다)")
    a = ap.parse_args(argv)

    with open(a.caption, encoding="utf-8") as f:
        문구 = f.read().strip()
    # 🆕 첫 댓글: 인스타 본문은 해시태그 줄을 뺀 것(ig_caption), 문장은 첫 댓글, 태그는 그 답글로.
    #    페이스북·스레드는 쓴 글 그대로 간다. 기록·중복 막기는 원래 글(문구) 기준.
    댓글 = {}
    if a.comment and os.path.isfile(a.comment):
        with open(a.comment, encoding="utf-8") as f:
            댓글 = json.load(f) or {}
    인스타문구 = (댓글.get("ig_caption") or 문구).strip()
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
    계정 = M.계정가져오기(키, cfg)

    파일들 = 그림모으기(a.images)
    주소들 = []
    if a.urls:
        with open(a.urls, encoding="utf-8") as f:
            주소들 = [c["url"] for c in (json.load(f).get("cards") or [])]
    창구 = [x.strip() for x in a.channels.split(",") if x.strip()]
    창구 = [c for c in 창구 if (계정.get(c) or {})]
    if not 창구:
        print("‼ `%s` 에 연결된 창구가 없습니다." % 키)
        return 1
    날짜 = a.date or datetime.now(KST).strftime("%Y-%m-%d")
    if not a.dry:
        옛 = 방금올린것(날짜, 문구, len(파일들))
        if 옛:
            print("‼ 같은 글(%d장)이 %s 에 이미 올라갔습니다 - 두 번 올리지 않습니다." % (len(파일들), 옛["때"]))
            for r in 옛.get("결과") or []:
                print("  %s %s %s" % ("✔" if r.get("ok") else "✘", r.get("창구"), r.get("링크") or r.get("왜", "")))
            print("정말 또 올리려면 글을 조금 바꾸거나 30분 뒤에 보내세요.")
            return 0

    print("올릴 것: %d장 / 창구 %s / 계정 %s%s"
          % (len(파일들), ", ".join(창구), 키, "  [점검만]" if a.dry else ""), flush=True)

    # 스레드는 500자까지다. 넘으면 스레드 몫만 잘라 보낸다(나머지 창구는 원문 그대로).
    스레드문구 = 문구 if len(문구) <= M.TH_최대글자 else 문구[:M.TH_최대글자 - 1] + "…"
    로그 = lambda s: print(s, flush=True)                              # noqa: E731

    if 주소들 and len(주소들) != len(파일들):
        print("‼ 주소 %d개와 그림 %d장이 안 맞습니다." % (len(주소들), len(파일들)))
        return 1
    if not 주소들 and any(c in 창구 for c in ("instagram", "threads")):
        # 공개 주소가 없으면 meta_api 의 호스팅에 맡긴다(설정의 방식대로).
        print("공개 주소를 안 받아 meta_api 호스팅으로 갑니다.")
        결과 = M.올리기(키, 파일들, 문구, 창구=tuple(창구), 스레드문구=스레드문구,
                      설정=cfg, 로그=로그, 시늉=a.dry)
    else:
        for u in 주소들:
            M._주소확인(u, 기다림=60, 로그=로그)
        결과 = []
        일감 = [("instagram", lambda: M.인스타_올리기(계정, 주소들, 인스타문구, 로그)),
                ("facebook", lambda: M.페이스북_올리기(계정, 파일들, 문구, 로그)),
                ("threads", lambda: M.스레드_올리기(계정, 주소들, 스레드문구, 로그))]
        for 이름, 하기 in 일감:
            if 이름 not in 창구:
                continue
            if a.dry:
                결과.append({"창구": 이름, "ok": True, "시늉": True})
                로그("  [점검만] %s - 실제로는 안 보냅니다" % 이름)
                continue
            try:
                r = 하기()
                r["ok"] = True
                결과.append(r)
                로그("  ✔ %s 올림 %s" % (r.get("창구", 이름), r.get("링크", "")))
                if 이름 == "instagram" and (댓글.get("text") or 댓글.get("tags")):
                    r["댓글"] = 첫댓글(계정, r.get("id"), 인스타문구, 댓글, 로그)
            except Exception as e:            # 한 창구가 막혀도 나머지는 간다
                결과.append({"창구": 이름, "ok": False, "왜": str(e)})
                로그("  ✘ %s 실패: %s" % (이름, e))

    실패 = [r for r in 결과 if not r.get("ok")]
    if not a.dry:
        p = 기록쓰기(날짜, 키, 결과, 문구, len(파일들))
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
