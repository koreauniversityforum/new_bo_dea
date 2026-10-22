# -*- coding: utf-8 -*-
"""예약 발행 - 홈페이지 「인스타 올리기」에서 잡아 둔 게시물을 그 시각에 올린다 (Actions 안에서).

    python reserve.py register --id r2610231200ab    # 예약 접수: cron-job.org 에 1회 작업 등록
    python reserve.py cancel   --id r2610231200ab    # 예약 취소: 작업 지우고 그림 치움
    python reserve.py fire                            # 시각이 된 예약을 전부 발행

## 왜 이렇게 도나
인스타·스레드 API 에는 예약 기능이 없다(페이스북 페이지만 있다). 그래서 **그 시각에 발행을
불러 줄 장치**가 따로 필요하다. 깃허브 자체 schedule 은 실측으로 몇 시간씩 늦어서(뉴스 봇
2026-08) 정확한 시각은 cron-job.org 가 맡는다 - 예약마다 그 분에 한 번만 도는 작업을 만들고,
그 작업이 이 레포에 `reserve-fire` 를 쏜다. 워크플로의 매시 schedule 은 cron-job.org 가
못 쏜 경우를 늦게라도 줍는 그물이다.

## 자리
그림과 예약 내용은 `reserved` 브랜치의 `rsv/<id>/` 에 둔다(`01.jpg`… + `post.json`).
🔴 `cards` 브랜치는 daily-cards 가 **날마다 통째로 갈아 끼우므로** 거기 두면 다음 날 아침
   예약 그림이 사라진다.
워크플로가 이 브랜치를 `.reserved` 에 따로 꺼내 둔다(RSV_DIR).

## 상태 (post.json 의 state)
접수 → 대기(시각 장치 등록됨) / 장치없음(등록 실패 - 매시 그물로만 감) → 발행중 → 완료 / 실패
🔴 **발행중·실패는 다시 시도하지 않는다.** 한 창구만 실패했어도 나머지는 이미 올라갔으므로
   다시 돌리면 같은 글이 두 번 올라간다. 고르기 전에 `발행중` 을 먼저 밀어 넣는 것도 그래서다.

## 시크릿
CRONJOB_KEY  cron-job.org API 키
RESERVE_PAT  cron-job.org 가 이 레포에 dispatch 를 쏠 때 쓰는 열쇠(new_bo_dea 의 Contents 쓰기)
둘 다 로그에 찍지 않는다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

KST = timezone(timedelta(hours=9))
RSV = os.environ.get("RSV_DIR") or os.path.join(ROOT, ".reserved")
REPO = os.environ.get("GITHUB_REPOSITORY") or "koreauniversityforum/new_bo_dea"
CRON_API = "https://api.cron-job.org"
ID_꼴 = re.compile(r"^r[0-9]{10,14}[a-z0-9]{0,6}$")
일찍 = timedelta(seconds=120)      # cron-job.org 가 그 분 0초에 쏘고 러너가 뜨는 데 수십 초 - 조금 일러도 그 분으로 본다
다시안함 = {"발행중", "완료", "실패"}


def 로그(s):
    print(s, flush=True)


# ── post.json ──────────────────────────────────────────
def 폴더(i):
    if not ID_꼴.match(i or ""):
        raise SystemExit("‼ 예약 번호 꼴이 아닙니다: %r" % i)
    return os.path.join(RSV, "rsv", i)


def 읽기(i):
    p = os.path.join(폴더(i), "post.json")
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def 쓰기(i, d):
    with open(os.path.join(폴더(i), "post.json"), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def 전부():
    d = os.path.join(RSV, "rsv")
    if not os.path.isdir(d):
        return []
    return [x for x in sorted(os.listdir(d)) if ID_꼴.match(x) and 읽기(x)]


def 시각(d):
    t = datetime.fromisoformat(d["when"])
    return t if t.tzinfo else t.replace(tzinfo=KST)


# ── reserved 브랜치에 밀어 넣기 ───────────────────────────
def 깃(*a):
    return subprocess.run(["git", *a], cwd=RSV, check=True, capture_output=True, text=True).stdout


def 밀기(말):
    깃("add", "-A")
    if not 깃("status", "--porcelain").strip():
        return
    깃("commit", "-qm", 말)
    # 홈페이지가 그 사이 새 예약을 넣었으면 밀기가 거절된다 - 받아 얹고 다시
    for _ in range(4):
        try:
            깃("push", "-q", "origin", "HEAD:reserved")
            return
        except subprocess.CalledProcessError:
            깃("pull", "-q", "--rebase", "origin", "reserved")
    raise SystemExit("‼ reserved 브랜치에 밀어 넣지 못했습니다.")


# ── cron-job.org ──────────────────────────────────────
def 크론(method, path, body=None):
    key = os.environ.get("CRONJOB_KEY") or ""
    if not key:
        raise RuntimeError("CRONJOB_KEY 시크릿이 없습니다")
    req = urllib.request.Request(CRON_API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + key,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        why = {401: "API 키가 틀렸습니다", 403: "API 키가 이 주소(IP)를 막았습니다",
               429: "cron-job.org 하루 요청 한도(100회)를 넘었습니다"}.get(e.code, "HTTP %d" % e.code)
        raise RuntimeError("cron-job.org: " + why) from None


def 작업만들기(i, t):
    pat = os.environ.get("RESERVE_PAT") or ""
    if not pat:
        raise RuntimeError("RESERVE_PAT 시크릿이 없습니다")
    k = t.astimezone(KST)
    끝 = k + timedelta(minutes=10)      # 같은 날짜·시각은 1년 뒤에 또 오므로 지나면 스스로 꺼지게
    job = {
        "url": "https://api.github.com/repos/%s/dispatches" % REPO,
        "enabled": True,
        "title": "뉴보대 예약 %s" % i,
        "saveResponses": True,
        "requestMethod": 1,                                     # POST
        "schedule": {"timezone": "Asia/Seoul", "expiresAt": int(끝.strftime("%Y%m%d%H%M%S")),
                     "minutes": [k.minute], "hours": [k.hour], "mdays": [k.day],
                     "months": [k.month], "wdays": [-1]},
        "extendedData": {
            "headers": {"Authorization": "Bearer " + pat, "Accept": "application/vnd.github+json",
                        "Content-Type": "application/json", "User-Agent": "nbd-reserve"},
            "body": json.dumps({"event_type": "reserve-fire", "client_payload": {"id": i}}),
        },
    }
    return 크론("PUT", "/jobs", {"job": job}).get("jobId")


def 작업지우기(d):
    j = d.get("jobId")
    if not j:
        return
    try:
        크론("DELETE", "/jobs/%d" % int(j))
        로그("  cron-job.org 작업 %s 지움" % j)
    except Exception as e:            # 지우기 실패는 발행 결과를 바꾸지 않는다(expiresAt 으로 스스로 꺼진다)
        로그("  cron-job.org 작업을 못 지웠습니다(10분 뒤 스스로 꺼짐): %s" % e)


def 그림치우기(i):
    for x in os.listdir(폴더(i)):
        if x != "post.json":
            os.remove(os.path.join(폴더(i), x))


# ── 명령 ──────────────────────────────────────────────
def 접수(i):
    d = 읽기(i)
    if not d:
        로그("‼ 예약 %s 를 못 찾았습니다(홈페이지가 post.json 을 다 올리기 전일 수 있음)." % i)
        return 1
    if d.get("state") not in ("접수", "장치없음"):
        로그("이미 처리된 예약입니다(%s)." % d.get("state"))
        return 0
    t = 시각(d)
    지금 = datetime.now(KST)
    if t < 지금 + timedelta(minutes=2):
        d.update(state="실패", why="예약 시각이 이미 지났거나 너무 가깝습니다")
        쓰기(i, d); 밀기("예약 %s 거절" % i)
        로그("‼ " + d["why"])
        return 1
    # 🆕 예약 고치기: 홈페이지가 시각·글을 바꾸고 state 를 「접수」로 되돌린 뒤 다시 부른다.
    #    옛 작업을 먼저 지운다(안 지우면 옛 시각에도 쏜다 - 쏴도 시각이 안 맞아 건너뛰지만 남겨 둘 까닭이 없다).
    if d.get("jobId"):
        작업지우기(d)
        d["jobId"] = None
    try:
        d["jobId"] = 작업만들기(i, t)
        d.update(state="대기", why="")
        로그("✔ %s 에 발행하도록 cron-job.org 작업 %s 를 만들었습니다." % (t.astimezone(KST).strftime("%m-%d %H:%M"), d["jobId"]))
        code = 0
    except Exception as e:
        # 그래도 예약은 살려 둔다 - 매시 그물이 늦게라도 올린다. 늦을 수 있다는 걸 화면에 알린다.
        d.update(state="장치없음", why="정확한 시각 장치를 못 만들었습니다(%s). 매시 확인으로 늦게 올라갈 수 있습니다." % e)
        로그("⚠ " + d["why"])
        code = 1
    쓰기(i, d); 밀기("예약 %s %s" % (i, d["state"]))
    return code


def 취소(i):
    d = 읽기(i)
    if not d:
        로그("이미 없는 예약입니다.")
        return 0
    if d.get("state") == "발행중":
        로그("‼ 지금 발행 중이라 취소할 수 없습니다.")
        return 1
    작업지우기(d)
    shutil.rmtree(폴더(i))
    밀기("예약 %s 취소" % i)
    로그("✔ 예약 %s 를 취소했습니다." % i)
    return 0


def 내려받기(urls, 곳):
    os.makedirs(곳, exist_ok=True)
    for n, u in enumerate(urls, 1):
        urllib.request.urlretrieve(u, os.path.join(곳, "%02d.jpg" % n))


def 발사():
    import publish                     # meta_api 는 publish 가 부른다

    지금 = datetime.now(KST)
    차례 = [i for i in 전부() if 읽기(i).get("state") not in 다시안함 and 시각(읽기(i)) <= 지금 + 일찍]
    if not 차례:
        로그("시각이 된 예약이 없습니다.")
        return 0
    로그("발행할 예약 %d건: %s" % (len(차례), ", ".join(차례)))
    # 고르자마자 「발행중」을 먼저 밀어 둔다 - 이 실행이 도중에 죽어도 다음 실행이 같은 글을 또 올리지 않게
    for i in 차례:
        d = 읽기(i); d["state"] = "발행중"; d["started"] = 지금.isoformat(timespec="seconds"); 쓰기(i, d)
    밀기("예약 발행 시작 " + " ".join(차례))

    나쁨 = 0
    for i in 차례:
        d = 읽기(i)
        로그("──────── 예약 %s (%s) ────────" % (i, d["when"]))
        일 = os.path.join(ROOT, ".cards", i)
        try:
            urls = [u for u in d.get("urls") or [] if isinstance(u, str) and u.startswith("https://")][:10]
            if not urls:
                raise RuntimeError("그림 주소가 없습니다")
            내려받기(urls, os.path.join(일, "그림"))
            with open(os.path.join(일, "주소.json"), "w", encoding="utf-8") as f:
                json.dump({"cards": [{"url": u} for u in urls]}, f)
            with open(os.path.join(일, "문구.txt"), "w", encoding="utf-8") as f:
                f.write(d.get("caption") or "")
            댓글 = []
            if d.get("comment"):
                with open(os.path.join(일, "댓글.json"), "w", encoding="utf-8") as f:
                    json.dump(d["comment"], f, ensure_ascii=False)
                댓글 = ["--comment", os.path.join(일, "댓글.json")]
            code = publish.main(["--images", os.path.join(일, "그림"), "--urls", os.path.join(일, "주소.json"),
                                 "--caption", os.path.join(일, "문구.txt"), *댓글,
                                 "--channels", ",".join(d.get("channels") or []) or "instagram,facebook",
                                 "--date", datetime.now(KST).strftime("%Y-%m-%d")])
            d.update(state="완료" if code == 0 else "실패",
                     why="" if code == 0 else "일부 창구가 실패했습니다. 실행 요약을 보세요")
        except SystemExit as e:
            d.update(state="실패", why=str(e))
        except Exception as e:
            d.update(state="실패", why=str(e))
        d["done"] = datetime.now(KST).isoformat(timespec="seconds")
        if os.environ.get("GITHUB_RUN_ID"):
            d["run"] = "https://github.com/%s/actions/runs/%s" % (REPO, os.environ["GITHUB_RUN_ID"])
        if d["state"] != "완료":
            나쁨 += 1
        작업지우기(d)
        if d["state"] == "완료":
            그림치우기(i)              # 인스타에 올라갔으니 공개 자리에서 치운다(post.json 은 목록용으로 남김)
        쓰기(i, d)
        로그("%s 예약 %s %s %s" % ("✔" if d["state"] == "완료" else "✘", i, d["state"], d.get("why", "")))
    밀기("예약 발행 끝 " + " ".join(차례))
    os.makedirs(os.path.join(ROOT, ".cards"), exist_ok=True)
    open(os.path.join(ROOT, ".cards", "알림"), "w").close()   # 발행을 시도했으면 워크플로가 메일을 보낸다
    if 나쁨 < len(차례):                 # 하나라도 올라갔으면 워크플로가 홈페이지 수집을 깨운다
        os.makedirs(os.path.join(ROOT, ".cards"), exist_ok=True)
        open(os.path.join(ROOT, ".cards", "올림"), "w").close()
    return 1 if 나쁨 else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="예약 발행 (Actions)")
    ap.add_argument("cmd", choices=["register", "cancel", "fire"])
    ap.add_argument("--id", default="")
    a = ap.parse_args(argv)
    if a.cmd == "register":
        return 접수(a.id)
    if a.cmd == "cancel":
        return 취소(a.id)
    return 발사()


if __name__ == "__main__":
    sys.exit(main())
