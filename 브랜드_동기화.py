# -*- coding: utf-8 -*-
r"""브랜드 디자인 토큰 동기화 - design.md §9 → newsfeed\static\brands.js

바탕화면 `ai_활용\<브랜드> style\design.md` 마다 §9(앱 적용 토큰)에 JSON 한 덩어리가 있다.
그 가운데 뉴보대 몫(`newbodae`)만 뽑아 정적 파일 `static/brands.js` 로 굽는다.

    python 브랜드_동기화.py            (뉴보대\ 에서)
    python 브랜드_동기화.py --dry      (파일은 안 쓰고 결과만)

- 앱은 실행 중에 바탕화면을 읽지 않는다. exe·젯슨·폰에서도 돌아야 하므로 **이 파일이
  만든 정적 파일만** 본다. design.md 를 고쳤으면 이 스크립트를 다시 돌리면 된다.
- 파싱 실패·필수 키 누락은 브랜드 이름과 이유를 찍고 건너뛴다(전체 실패 없음).
- apple style 은 뉴보대 토큰이 없으니 건너뛴다.
- 같은 brand 키가 여러 폴더에 있으면 나중 것이 이긴다(경고 출력).
"""
import argparse
import glob
import json
import os
import re
import sys
import datetime

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_GLOB = os.path.join(os.path.expanduser("~"), "Desktop", "ai_활용", "* style", "design.md")
OUT = os.path.join(HERE, "newsfeed", "static", "brands.js")
SKIP_DIRS = {"apple style"}
REQUIRED = ("paper", "L")          # newbodae 안 필수 키


def json_blocks(md):
    """```json ... ``` 블록들을 (시작 위치, 본문) 으로 돌려준다."""
    return [(m.start(), m.group(1)) for m in re.finditer(r"```json\s*\n(.*?)```", md, re.S)]


def pick_token(md):
    """§9 이후의 첫 유효 JSON 블록. §9 표제를 못 찾으면 파일 전체에서 newbodae 가 든 첫 블록."""
    m = re.search(r"^##\s*9\.", md, re.M)
    start = m.start() if m else 0
    blocks = [b for pos, b in json_blocks(md) if pos >= start]
    if not m:
        blocks = [b for pos, b in json_blocks(md)]
    last_err = None
    for b in blocks:
        try:
            d = json.loads(b)
        except Exception as e:           # 다음 블록을 본다(설명용 조각이 앞에 올 수 있다)
            last_err = e
            continue
        if isinstance(d, dict) and ("newbodae" in d or "finance" in d):
            return d, None
    return None, ("§9 JSON 블록 없음" if not blocks else "JSON 파싱 실패: %s" % last_err)


def check(d):
    nb = d.get("newbodae")
    if not isinstance(nb, dict):
        return "newbodae 키 없음"
    if not d.get("brand"):
        return "brand 키 없음"
    missing = [k for k in REQUIRED if k not in nb]
    if missing:
        return "newbodae 필수 키 누락: " + ", ".join(missing)
    if not isinstance(nb.get("L"), dict) or "title" not in nb["L"]:
        return "newbodae.L.title 없음"
    return None


def collect(verbose=True):
    ok, skipped = [], []
    seen = {}
    for path in sorted(glob.glob(SRC_GLOB)):
        folder = os.path.basename(os.path.dirname(path))
        if folder in SKIP_DIRS:
            skipped.append((folder, "건너뜀(뉴보대 토큰 없음)"))
            continue
        try:
            md = open(path, encoding="utf-8", errors="replace").read()
        except Exception as e:
            skipped.append((folder, "읽기 실패: %s" % e))
            continue
        d, err = pick_token(md)
        if err:
            skipped.append((folder, err))
            continue
        err = check(d)
        if err:
            skipped.append((folder, err))
            continue
        item = {"brand": str(d["brand"]).strip(), "label": d.get("label") or folder.replace(" style", ""),
                "group": d.get("group") or d.get("newbodae", {}).get("group") or "",
                "source": folder, "newbodae": d["newbodae"]}
        if item["brand"] in seen:
            if verbose:
                print("  ⚠ brand 키 겹침: %s (%s ← %s) - 나중 것을 씁니다" % (item["brand"], folder, seen[item["brand"]]))
            ok = [x for x in ok if x["brand"] != item["brand"]]
        seen[item["brand"]] = folder
        ok.append(item)
    return ok, skipped


def render(items):
    head = ("/* 이 파일은 브랜드_동기화.py 가 만든다 - 손으로 고치지 말 것.\n"
            "   원본: 바탕화면 ai_활용\\<브랜드> style\\design.md §9 (뉴보대 몫만)\n"
            "   생성 %s · %d개 */\n" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), len(items)))
    body = json.dumps(items, ensure_ascii=False, indent=1)
    return head + "window.BRAND_STYLES = " + body + ";\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    items, skipped = collect()
    print("훑은 곳:", SRC_GLOB)
    for it in items:
        print("  ok  %-14s %s  (%s)" % (it["brand"], it["label"], it["source"]))
    for name, why in skipped:
        print("  --  %s: %s" % (name, why))
    print("담김 %d · 건너뜀 %d" % (len(items), len(skipped)))
    if a.dry:
        return
    js = render(items)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(js)
    print("썼습니다 →", OUT, "(%d바이트)" % len(js.encode("utf-8")))


if __name__ == "__main__":
    main()
