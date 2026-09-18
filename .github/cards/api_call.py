# -*- coding: utf-8 -*-
"""홈페이지(폰판) 대신 서버 일을 하는 자리 - `api-call` 워크플로가 부른다 (2026-09-18).

폰판은 정적 파일뿐이라, 남의 사이트를 읽어야 하는 기능(유사 기사 검색·주제 찾기·
유튜브 숏폼 찾기)은 브라우저가 못 한다(CORS·구글 차단). 그래서 깃허브 Actions 가
**앱과 똑같은 파이썬 코드**(app.py 의 Handler)를 소켓 없이 불러 대신 답하고,
답을 `api` 브랜치 `res/<id>.json` 에 둔다. 폰은 그 파일이 생길 때까지 기다렸다 읽는다.

🔴 저장소가 공개라 **Actions 로그도 공개**다. 요청 내용(payload)은 env 로 넘기면
   로그 머리에 찍히므로 `GITHUB_EVENT_PATH` 파일에서 직접 읽고, 아무것도 출력하지 않는다.
🔴 들어줄 수 있는 길은 아래 ALLOW 뿐이다. 아무 경로나 받으면 out 폴더 지우기 같은
   앱 내부 기능까지 원격으로 열린다.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "newsfeed"))

ALLOW = {
    ("POST", "/api/related"), ("GET", "/api/topic-ideas"), ("POST", "/api/hub-fetch"),
    ("POST", "/api/hub-search"), ("GET", "/api/hub-sources"), ("GET", "/api/shorts"),
}
REPO = os.environ.get("GITHUB_REPOSITORY", "koreauniversityforum/new_bo_dea")
BRANCH = "api"


def handle(method, path, query, body):
    import app  # 무거운 일은 전부 app.Handler 가 한다 - 두 벌로 만들지 않는다

    class 가짜(app.Handler):
        def __init__(self):                           # 소켓 없이
            raw = json.dumps(body or {}, ensure_ascii=False).encode("utf-8")
            self.command = method
            self.path = path + (("?" + query) if query else "")
            self.headers = {"Content-Length": str(len(raw))}
            self.rfile = io.BytesIO(raw)
            self.out = None

        def _send(self, code, body, ctype=None, extra=None):
            if isinstance(body, (bytes, bytearray)):
                body = body.decode("utf-8")
            if isinstance(body, str):
                try:
                    body = json.loads(body)
                except ValueError:
                    body = {"ok": False, "error": "JSON 이 아닌 응답"}
            self.out = body

    h = 가짜()
    (h.do_GET if method == "GET" else h.do_POST)()
    return h.out or {"ok": False, "error": "응답이 비었습니다."}


def put_result(rid, obj):
    token = os.environ["GITHUB_TOKEN"]
    data = json.dumps({"message": "api res %s" % rid,
                       "content": base64.b64encode(
                           json.dumps(obj, ensure_ascii=False).encode("utf-8")).decode("ascii"),
                       "branch": BRANCH}).encode("utf-8")
    url = "https://api.github.com/repos/%s/contents/res/%s.json" % (REPO, rid)
    for 번 in range(6):                               # 동시에 여럿이 쓰면 409 가 난다 - 다시
        req = urllib.request.Request(url, data=data, method="PUT", headers={
            "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
            "Content-Type": "application/json", "User-Agent": "newbodae-api"})
        try:
            with urllib.request.urlopen(req, timeout=30):
                return True
        except urllib.error.HTTPError as e:
            if e.code in (409, 422, 502, 503) and 번 < 5:
                time.sleep(1 + 번)
                continue
            raise
    return False


def main():
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
        p = (json.load(f).get("client_payload") or {})
    rid = str(p.get("id") or "")
    if not re.fullmatch(r"[a-z0-9]{8,40}", rid):
        print("id 가 올바르지 않아 건너뜁니다.")
        return 1
    method = str(p.get("method") or "GET").upper()
    path = str(p.get("path") or "")
    t0 = time.time()
    if (method, path) not in ALLOW:
        out = {"ok": False, "error": "홈페이지에서 대신할 수 없는 기능입니다: %s %s" % (method, path)}
    else:
        try:
            out = handle(method, path, str(p.get("query") or ""), p.get("body") or {})
        except Exception as e:                        # 무엇이든 답은 남긴다(폰이 기다리니까)
            out = {"ok": False, "error": "깃허브에서 처리하다 멈췄습니다: %s" % e}
    if isinstance(out, dict):
        out.setdefault("via", "github")
        out["took_s"] = round(time.time() - t0, 1)
    put_result(rid, out)
    # 결과 내용은 찍지 않는다(공개 로그). 무엇을 처리했는지만.
    print("처리: %s %s -> ok=%s (%.1f초)" % (method, path, (out or {}).get("ok"), time.time() - t0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
