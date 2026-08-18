# -*- coding: utf-8 -*-
"""올리기 화면(insta.html)이 기대는 서버 경로를 인스타·크롬 없이 검증한다.

고친 것 두 가지가 진짜 고쳐졌는지만 본다.
 ① 사진이 안 보이던 것 → `/api/insta-thumb` 가 **그림 바이트**를 준다
    (그리고 허용 폴더 밖은 거절한다 — 여긴 로컬 서버라 경로를 그대로 받으면 안 된다)
 ② 다음 단계가 없던 것 → `/api/insta-captions` 가 문구 후보를 **5개** 준다
    (기사가 있으면 기사에서, 없으면 채울 자리를 남긴 틀로)
"""
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

NB = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, NB)
sys.stdout.reconfigure(encoding="utf-8")

PORT = 7899
HOST = "http://127.0.0.1:%d" % PORT
fails = []


def ck(name, cond, extra=""):
    print(("  통과  " if cond else "  실패  ") + name + (("  " + str(extra)) if extra else ""))
    if not cond:
        fails.append(name)


def get(path):
    with urllib.request.urlopen(HOST + path, timeout=30) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def post(path, obj):
    req = urllib.request.Request(HOST + path, method="POST",
                                 data=json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def _too_many(post, px):
    """이미 3장 담긴 상태에서 9장을 더 담으려 하면 거절해야 한다."""
    try:
        post("/api/insta-stage",
             {"items": [{"name": "넘침%d" % i, "dataUrl": "data:image/png;base64," + px}
                        for i in range(9)]})
        return False
    except urllib.error.HTTPError as e:
        return e.code == 400


def main():
    # 창 없이 서버만 띄운다(--browser --no-browser 면 아무것도 안 뜬다)
    proc = subprocess.Popen([sys.executable, "-u", os.path.join(NB, "app.py"),
                             "--port", str(PORT), "--browser", "--no-browser"],
                            cwd=NB, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                get("/api/insta-files")
                break
            except Exception:
                time.sleep(0.5)
        else:
            raise SystemExit("서버가 안 떴습니다.")

        print("① 그림 목록·미리보기")
        _, _, raw = get("/api/insta-files")
        d = json.loads(raw.decode("utf-8"))
        groups = d.get("groups") or []
        ck("고를 수 있는 폴더가 있다", bool(groups), [g["label"] for g in groups])
        ck("파일마다 만든 시각이 온다(새것 먼저 정렬용)",
           all("mtime" in it for g in groups for it in g["items"]))
        # 비율은 그림을 다 불러오기 **전에** 알아야 고르기 전에 경고할 수 있다
        sizes = [(it["w"], it["h"]) for g in groups for it in g["items"]]
        ck("크기를 머리표에서 읽어 같이 준다", all(w > 0 and h > 0 for w, h in sizes),
           sizes[:3])
        ck("아는 판형이 나온다(1080 세로형)",
           any(w == 1080 for w, h in sizes), sorted(set(sizes))[:4])

        g = groups[0]
        it = g["items"][0]
        qs = "?dir=" + urllib.parse.quote(g["dir"]) + "&name=" + urllib.parse.quote(it["name"])
        code, ctype, img = get("/api/insta-thumb" + qs)
        ck("미리보기가 200 으로 온다", code == 200, code)
        ck("그림 형식으로 온다", ctype.startswith("image/"), ctype)
        ck("PNG/JPEG 머리표가 맞다(진짜 그림)",
           img[:8] == b"\x89PNG\r\n\x1a\n" or img[:2] == b"\xff\xd8", img[:8])
        ck("파일 크기 그대로 온다", len(img) == it["size"], "%d vs %d" % (len(img), it["size"]))

        print("② 허용 폴더 밖은 거절")
        for bad, why in ((r"C:\Windows", "엉뚱한 폴더"),
                         (g["dir"] + r"\..", "상위로 빠져나가기")):
            q = "?dir=" + urllib.parse.quote(bad) + "&name=" + urllib.parse.quote("win.ini")
            try:
                code, _, _ = get("/api/insta-thumb" + q)
                ck("%s 는 막힌다" % why, False, "200 으로 열렸다")
            except urllib.error.HTTPError as e:
                ck("%s 는 막힌다" % why, e.code == 404, e.code)

        print("③ 문구 후보 — 기사 없이(틀)")
        d = post("/api/insta-captions", {})
        ck("5개가 온다", len(d.get("items") or []) == 5, len(d.get("items") or []))
        ck("틀이라고 표시된다", d.get("blank") is True)
        ck("채울 자리가 대괄호로 남는다",
           all("[" in c["text"] for c in d["items"]))
        ck("후보마다 이름·설명·글자수가 있다",
           all(c.get("name") and c.get("note") and c.get("chars") for c in d["items"]))
        ck("후보가 서로 다르다", len({c["text"] for c in d["items"]}) == 5)

        print("④ 문구 후보 — 기사 본문으로")
        body = ("서울시가 대학생 대상 청년 월세 지원을 내년부터 확대한다고 7일 밝혔다. "
                "지원 대상은 기존 5천 명에서 1만 명으로 늘어난다. "
                "월 20만 원씩 최대 12개월간 지급하며, 소득 기준은 중위소득 60% 이하다. "
                "서울시는 대학가 원룸 임대료가 최근 3년간 18% 올랐다고 설명했다. "
                "신청은 내년 3월부터 서울주거포털에서 받는다. "
                "시 관계자는 \"주거비 부담이 학업에 미치는 영향을 줄이겠다\"고 말했다.")
        d = post("/api/insta-captions", {"text": body, "title": "청년 월세 지원 2배로",
                                         "press": "가상일보", "date": "2026-08-09"})
        items = d.get("items") or []
        ck("5개가 온다", len(items) == 5, len(items))
        ck("틀이 아니다(기사에서 나왔다)", d.get("blank") is False)
        ck("본문 사실이 실제로 들어간다",
           any("월세" in c["text"] or "1만" in c["text"] for c in items))
        ck("후보가 서로 다르다", len({c["text"] for c in items}) == 5)
        ck("출처 줄이 모두 붙는다", all("출처" in c["text"] for c in items))
        short = min(items, key=lambda c: c["chars"])
        ck("짧은 후보도 하나 있다(전부 긴 초안이면 안 됨)", short["chars"] < 400, short["chars"])
        ck("2,200자 넘으면 표시된다",
           all(c["warn"] == (c["chars"] > 2200) for c in items))

        print("⑤ 저장해 둔 글 불러오기")
        post("/api/save-text", {"text": "시험용 저장 문구\n둘째 줄", "name": "_시험_인스타문구"})
        _, _, raw = get("/api/insta-texts")
        d = json.loads(raw.decode("utf-8"))
        got = [x for x in d.get("items", []) if x["name"].startswith("_시험_인스타문구")]
        ck("방금 저장한 글이 목록에 온다", bool(got), [x["name"] for x in d.get("items", [])][:3])
        ck("내용까지 같이 온다(그대로 문구로 쓴다)",
           bool(got) and "둘째 줄" in got[0]["text"])
        for x in got:                                   # 뒷정리
            try:
                os.remove(os.path.join(NB, "out", x["name"]))
            except OSError:
                pass

        print("⑥ 크기 읽기 — 폴더에 없는 형식까지")
        import app                                      # 서버는 따로 돌고 있다
        size = app.Handler._img_size
        tmp = os.path.join(NB, "out", "_시험_머리표")
        # JPEG: APP0 뒤에 SOF0 (세로 480 · 가로 640)
        jpg = (b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
               b"\xff\xc0\x00\x11\x08\x01\xe0\x02\x80\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01")
        with open(tmp, "wb") as f:
            f.write(jpg)
        ck("JPEG 크기를 읽는다", size(tmp) == (640, 480), size(tmp))
        # WEBP(VP8X): 가로·세로를 (값-1) 로 적는다 → 300×200
        webp = (b"RIFF\x2c\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00"
                + (299).to_bytes(3, "little") + (199).to_bytes(3, "little"))
        with open(tmp, "wb") as f:
            f.write(webp)
        ck("WEBP 크기를 읽는다", size(tmp) == (300, 200), size(tmp))
        with open(tmp, "wb") as f:
            f.write("이건 그림이 아니다".encode("utf-8"))
        ck("모르는 형식은 0 으로 둔다(터지지 않는다)", size(tmp) == (0, 0), size(tmp))
        os.remove(tmp)

        print("⑦ 저장하지 않고 올리기 (임시 자리)")
        # 임시 자리는 **앱과 같은 폴더**를 쓴다(둘 다 `out\_임시_인스타`). 지난 실행이
        # 남긴 것이 있으면 개수 셈이 어긋나므로 깨끗한 상태에서 시작한다.
        post("/api/insta-stage", {"clear": True})
        # 1×1 빨간 PNG (손으로 만든 최소 파일)
        px = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM"
              "IQAAAABJRU5ErkJggg==")
        d = post("/api/insta-stage", {"items": [{"name": "앞장", "dataUrl": "data:image/png;base64," + px},
                                                {"name": "뒷장", "dataUrl": "data:image/png;base64," + px}]})
        ck("담은 장 수만큼 이름이 온다", len(d.get("names") or []) == 2, d.get("names"))
        ck("순서가 이름 앞에 박힌다(캐러셀 순서)",
           d["names"][0].startswith("01_") and d["names"][1].startswith("02_"), d["names"])
        _, _, raw = get("/api/insta-files")
        gs = json.loads(raw.decode("utf-8"))["groups"]
        stage = [g for g in gs if "임시" in g["label"]]
        ck("고르는 목록에 '지금 화면(임시)' 로 뜬다", len(stage) == 1,
           [g["label"] for g in gs])
        ck("맨 위에 온다(방금 담은 것이니)", gs[0] is stage[0] if stage else False)
        ck("담은 것이 그대로 있다", len(stage[0]["items"]) == 2 if stage else False)
        # 🔴 다시 담으면 **쌓인다.** 갈아 끼우면 앞장을 담고 뒷장을 담는 순간 앞장이
        #    사라져 캐러셀을 아예 못 만든다(실측으로 이 길이 막혔었다).
        d2 = post("/api/insta-stage", {"items": [{"name": "셋째", "dataUrl": "data:image/png;base64," + px}]})
        _, _, raw = get("/api/insta-files")
        gs = json.loads(raw.decode("utf-8"))["groups"]
        stage = [g for g in gs if "임시" in g["label"]]
        names = [it["name"] for it in stage[0]["items"]] if stage else []
        ck("다시 담으면 **쌓인다**(캐러셀을 만들 수 있다)", len(names) == 3, names)
        ck("나중에 담은 것이 뒤 번호를 받는다(순서 유지)",
           names[-1].startswith("03_") and "셋째" in names[-1], names)
        ck("한 게시물 상한(10장)을 넘기면 막는다",
           _too_many(post, px), "")
        ck("임시 그림도 미리보기가 열린다",
           get("/api/insta-thumb?dir=" + urllib.parse.quote(stage[0]["dir"]) +
               "&name=" + urllib.parse.quote(stage[0]["items"][0]["name"]))[0] == 200)
        d3 = post("/api/insta-stage", {"clear": True})
        _, _, raw = get("/api/insta-files")
        gs = json.loads(raw.decode("utf-8"))["groups"]
        ck("지우면 목록에서도 빠진다", not [g for g in gs if "임시" in g["label"]],
           [g["label"] for g in gs])
        ck("몇 장 지웠는지 알려 준다", d3.get("cleared") == 3, d3.get("cleared"))
        try:
            d4 = post("/api/insta-stage",
                      {"items": [{"name": "x", "dataUrl": "data:text/plain;base64,AAA"}]})
            ck("그림이 아닌 것은 거절한다", d4.get("ok") is False, d4)
        except urllib.error.HTTPError as e:
            ck("그림이 아닌 것은 거절한다", e.code == 400, e.code)

        print("⑧ 머리글이 다섯 화면에서 같은 자리인가")
        st = os.path.join(NB, "static")
        for name in ("index.html", "outro.html", "feed.html", "out.html", "mark.html"):
            with io.open(os.path.join(st, name), encoding="utf-8") as f:
                head = f.read().split("</header>")[0]
            slot = head.find("data-insta-slot")
            ck("%s 에 인스타 자리가 있다" % name, slot > 0)
            ck("%s 에 옛 인스타 링크가 안 남았다" % name,
               'href="/static/insta.html"' not in head)
            png = head.find("PNG 내려받기")
            if png > 0:
                ck("%s: 인스타가 PNG 내려받기 **왼쪽**" % name, slot < png)
            for word in ("피드 글", "뒷장"):
                i = head.find(word)
                if i > 0:
                    ck("%s: 인스타가 '%s' **오른쪽**" % (name, word), slot > i)
    finally:
        proc.terminate()

    print()
    if fails:
        print("실패 %d개: %s" % (len(fails), fails))
        sys.exit(1)
    print("전부 통과")


if __name__ == "__main__":
    main()
