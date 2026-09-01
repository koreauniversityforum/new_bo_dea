# -*- coding: utf-8 -*-
"""오늘의 뉴스 - 텔레그램 봇(`korea_news_bot`)이 종합한 기사 목록을 받아 온다.

## 왜 봇이 모은 것을 다시 쓰나
매일 08:58 에 도는 봇이 이미 네이버 랭킹·정부정책·오피니언·팩트체크·화제 를 훑어
카테고리별로 추려 놓는다. 카드뉴스를 만들 때 그 목록을 다시 손으로 찾는 것은
같은 일을 두 번 하는 것이다. 그래서 **봇이 남긴 JSON 한 장**을 접점으로 삼는다.

봇 쪽: `telegram_news_bot_v3.py` 의 `save_digest()` 가 발송 직후
`data/latest.json` 과 `data/YYYY-MM-DD.json` 을 쓰고, 워크플로가 레포에 커밋한다.

## 어디서 읽나 (순서대로 찾는다)
1. 환경변수 `NBD_NEWS_DATA` 가 가리키는 폴더/파일
2. `설정.json` 의 `news_data`
3. 사람들이 보통 두는 자리들 (`~/korea_news_bot/data` 등)

찾은 폴더가 git 저장소이면 **읽기 전에 조용히 `git pull`** 한다(5초 제한).
실패해도 있는 파일로 계속 간다 - 인터넷이 없다고 화면이 죽으면 안 된다.

🔴 이 파일은 표준 라이브러리만 쓴다(뉴보대 전체 규칙). 봇 쪽은 aiohttp/bs4 를
   쓰지만 우리는 그 코드를 부르지 않고 **결과 파일만** 읽는다.
"""
from __future__ import annotations

import json
import os
import subprocess
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
SCHEMA = 1                      # 봇 쪽 DATA_SCHEMA 와 짝. 올릴 땐 양쪽 같이.
_PULL_EVERY = 600               # 같은 폴더를 이 초 안에 또 당기지 않는다
_last_pull: dict[str, float] = {}

# 봇 클론이 있을 만한 자리. 맨 앞이 실제 이 컴퓨터의 위치다.
CANDIDATES = [
    os.path.join(os.path.expanduser("~"), "korea_news_bot", "data"),
    os.path.join(os.path.expanduser("~"), "Desktop", "korea_news_bot", "data"),
    os.path.join(os.path.dirname(ROOT), "korea_news_bot", "data"),
]


def _settings_path() -> str:
    return os.path.join(ROOT, "설정.json")


def _from_settings() -> str:
    try:
        with open(_settings_path(), encoding="utf-8") as f:
            return (json.load(f) or {}).get("news_data") or ""
    except Exception:
        return ""


def data_dir() -> str:
    """봇이 남긴 JSON 이 있는 폴더. 못 찾으면 빈 문자열."""
    for cand in [os.environ.get("NBD_NEWS_DATA") or "", _from_settings()] + CANDIDATES:
        if not cand:
            continue
        p = os.path.abspath(os.path.expanduser(cand))
        if os.path.isfile(p):                 # 파일을 직접 가리켜도 받아 준다
            p = os.path.dirname(p)
        if os.path.isdir(p):
            return p
    return ""


def _pull(d: str, log=None) -> str:
    """봇 레포를 최신으로. 실패는 말만 남기고 넘어간다."""
    repo = os.path.dirname(d)
    if not os.path.isdir(os.path.join(repo, ".git")):
        return ""
    now = time.time()
    if now - _last_pull.get(repo, 0) < _PULL_EVERY:
        return "방금 받아왔습니다"
    _last_pull[repo] = now
    try:
        r = subprocess.run(["git", "-C", repo, "pull", "--quiet", "--ff-only"],
                           capture_output=True, text=True, timeout=15,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if r.returncode != 0:
            msg = (r.stderr or r.stdout or "").strip().splitlines()
            return "최신으로 받아오지 못했습니다: " + (msg[-1] if msg else "원인 불명")
        return "최신으로 받아왔습니다"
    except FileNotFoundError:
        return "git 이 없어 있는 파일로 봅니다"
    except subprocess.TimeoutExpired:
        return "받아오기가 느려 있는 파일로 봅니다"
    except Exception as e:                    # 어떤 이유든 화면은 떠야 한다
        if log:
            log(str(e))
        return "있는 파일로 봅니다"


def days(d: str = "") -> list[str]:
    """가진 날짜 목록, 최신 먼저."""
    d = d or data_dir()
    if not d:
        return []
    out = []
    for x in os.listdir(d):
        if len(x) == 15 and x.endswith(".json") and x[:4].isdigit():
            out.append(x[:-5])
    return sorted(out, reverse=True)


def load(day: str = "", pull: bool = True) -> dict:
    """하루치를 읽어 화면이 쓰기 좋은 꼴로 돌려준다.

    돌려주는 것:
      ok, date, generated_at, count, note(안내문), dir,
      groups[{name, items[{title, url, source, rank, comments, published}]}],
      days[] (고를 수 있는 날짜)
    """
    d = data_dir()
    if not d:
        return {"ok": False, "error":
                "봇이 남긴 뉴스 파일을 찾지 못했습니다. korea_news_bot 을 내려받은 폴더를 "
                "환경변수 NBD_NEWS_DATA 로 알려 주거나 설정.json 의 news_data 에 적어 주세요.",
                "groups": [], "days": []}

    note = _pull(d, None) if pull else ""
    name = (day or "latest") + ".json"
    path = os.path.join(d, name)
    if not os.path.isfile(path):
        have = days(d)
        if not have:
            return {"ok": False, "error": "뉴스 파일이 아직 없습니다. 봇이 한 번 돌면 생깁니다.",
                    "dir": d, "note": note, "groups": [], "days": []}
        path = os.path.join(d, have[0] + ".json")

    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as e:
        return {"ok": False, "error": "뉴스 파일을 읽지 못했습니다: %s" % e,
                "dir": d, "groups": [], "days": []}

    if int(raw.get("schema") or 0) > SCHEMA:
        note = (note + " / " if note else "") + \
               "뉴스 파일이 이 앱보다 새 형식입니다. 앱을 갱신하는 게 좋습니다."

    groups = []
    for gname, items in (raw.get("categories") or {}).items():
        rows = [_row(x) for x in items or []]
        if rows:
            groups.append({"name": gname, "items": rows})
    ov = [_row(x, overseas=True) for x in (raw.get("overlapping") or [])]
    if ov:
        groups.append({"name": "해외 겹친 보도", "items": ov})

    return {"ok": True, "date": raw.get("date") or "", "note": note, "dir": d,
            "generated_at": raw.get("generated_at") or "",
            "count": raw.get("count") or sum(len(g["items"]) for g in groups),
            "groups": groups, "days": days(d)}


def _row(x: dict, overseas: bool = False) -> dict:
    """봇의 기사 한 줄 → 화면이 그리는 한 줄."""
    title = (x.get("translated_title") or x.get("title") or "").strip()
    row = {
        "title": title,
        "origin": (x.get("title") or "").strip() if x.get("translated_title") else "",
        "url": (x.get("url") or "").strip(),
        "source": (x.get("source") or "").strip(),
        "published": (x.get("published") or "").strip(),
        "rank": x.get("view_rank") or 0,
        "comments": x.get("comment_count") or 0,
    }
    if overseas:
        row["sources"] = x.get("sources") or []
    return row
