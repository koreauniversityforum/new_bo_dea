# -*- coding: utf-8 -*-
"""메타(Meta) 공식 API — 인스타그램 · 페이스북 페이지 · 스레드에 한 번에 올린다.

## 왜 또 만드는가 (insta.py 가 이미 있는데)
`insta.py` 는 크롬을 조종해 사람인 척 올린다. 설치가 0개라는 장점이 크지만
① 인스타 웹 화면이 바뀌면 그날로 멈추고 ② 자동화가 약관 밖이라 새 계정은 제한이 걸리며
③ 페이스북·스레드까지 늘리려면 화면 조종을 세 벌 만들어야 한다.
계정이 둘(`news_univ`, `universityforum_korea`)이고 창구가 셋(IG·FB·Threads)으로
늘어난 지금은 **공식 API 가 싸다.** 그래서 이 파일을 따로 둔다. 둘은 공존한다 —
급할 때 크롬 경로, 평소엔 API 경로.

## 창구별 경로 (2026-08 기준)
- 인스타그램 : `graph.facebook.com` · **Facebook Login for Business** 로 받은 토큰
- 페이스북    : `graph.facebook.com` · 같은 로그인에서 나오는 **페이지 토큰**
- 스레드      : `graph.threads.net` · **스레드 로그인은 따로** (앱 ID·비밀도 별개)

인스타를 「Instagram Login」이 아니라 페이스북 로그인 쪽으로 붙인 이유는 하나다.
**페이스북 페이지도 같이 올려야 해서**, 한 번의 동의로 IG 사용자 ID 와 페이지 토큰을
한꺼번에 받는 쪽이 계정마다 로그인 횟수를 하나 줄인다.

## 알고 쓸 것 (실측·문서로 확인한 함정)
- 🔴 **인스타는 그림을 바이트로 못 받는다.** `image_url` 로 **공개 HTTPS 주소**를 줘야 하고
  메타 서버가 그 주소를 직접 긁어 간다. 스레드도 같다. 페이스북만 파일 업로드가 된다.
  그래서 `공개호스팅` 이 이 파일의 절반을 차지한다.
- 🔴 **인스타는 JPEG 만 받는다.** 우리 카드는 캔버스에서 나온 PNG 라 반드시 변환해야 한다
  (Pillow 없이 — 윈도우 .NET 을 빌려 쓴다. `_jpeg_로`).
- 올리기는 **2단(컨테이너 → 발행)** 이다. 만들자마자 발행하면 아직 안 읽어 간 상태라
  실패하므로 `status_code == FINISHED` 를 기다린다.
- 한도: 인스타 24시간 25건 · 스레드 24시간 250건 · 캐러셀 10장.
- 글자 수: 인스타 2,200 · 스레드 500. 스레드는 조용히 자르지 않고 **막고 알린다**.
"""
from __future__ import annotations

import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))

# 그래프 API 판. 메타는 약 2년간 각 판을 살려 두므로 급히 올릴 일은 없다.
GRAPH = "v21.0"
FB = "https://graph.facebook.com/" + GRAPH
FB_OAUTH = "https://www.facebook.com/" + GRAPH + "/dialog/oauth"
TH = "https://graph.threads.net/v1.0"
TH_OAUTH = "https://threads.net/oauth/authorize"

FB_SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list",
             "pages_read_engagement", "pages_manage_posts", "business_management"]
TH_SCOPES = ["threads_basic", "threads_content_publish"]

IG_최대글자 = 2200
TH_최대글자 = 500
최대장수 = 10

# 🔴 설정 파일은 **앱 폴더 밖**에 둔다. 안에 두면 배포본 ZIP 을 다시 구울 때
#    토큰이 통째로 딸려 나간다(같은 이유로 insta.py 의 크롬 프로필도 밖에 있다).
설정폴더 = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "뉴보대")
설정경로 = os.path.join(설정폴더, "메타_계정.json")


class MetaError(Exception):
    """어디서 왜 막혔는지 이름을 달고 올라오는 실패."""


# ────────────────────────────────────────────────── 밑바닥 (요청)
def _열기(req):
    """실제 그물망을 타는 유일한 자리. 시험은 이 함수만 갈아 끼운다."""
    return urllib.request.urlopen(req, timeout=120)


def _응답풀기(r):
    raw = r.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {"_원문": raw[:400].decode("utf-8", "replace")}


def _오류로(e):
    """메타의 오류 본문은 쓸 만하다 — 상태코드만 던지지 말고 그 말을 꺼내 온다."""
    try:
        body = json.loads(e.read().decode("utf-8"))
    except Exception:
        return MetaError("HTTP %s (본문을 읽지 못했습니다)" % getattr(e, "code", "?"))
    err = body.get("error") or {}
    말 = err.get("error_user_msg") or err.get("message") or json.dumps(body, ensure_ascii=False)
    코드 = err.get("code")
    덧 = ""
    if 코드 == 190:
        덧 = "  → 토큰이 만료됐거나 취소됐습니다. `python 메타_연결.py 연결 <계정>` 으로 다시 이으세요."
    elif 코드 == 200:
        덧 = "  → 권한이 모자랍니다. 앱 설정에서 해당 권한을 켜고 다시 동의받아야 합니다."
    elif 코드 == 4 or 코드 == 17 or 코드 == 32:
        덧 = "  → 호출 한도입니다. 잠시 뒤에 다시 하세요."
    return MetaError("메타 오류 %s: %s%s" % (코드, 말, 덧))


def _호출(method, url, params=None, token=None, files=None):
    """그래프 API 한 번. GET 은 질의문자열, POST 는 폼(또는 멀티파트)."""
    params = dict(params or {})
    if token:
        params["access_token"] = token
    params = {k: v for k, v in params.items() if v is not None}

    if method == "GET":
        req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), method="GET")
    elif files:
        body, ctype = _멀티파트(params, files)
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", ctype)
    else:
        req = urllib.request.Request(url, data=urllib.parse.urlencode(params).encode("utf-8"),
                                     method="POST")
    try:
        with _열기(req) as r:
            return _응답풀기(r)
    except urllib.error.HTTPError as e:
        raise _오류로(e) from None
    except urllib.error.URLError as e:
        raise MetaError("그물망에 못 닿았습니다: %s" % e.reason) from None


def _멀티파트(fields, files):
    """파일 업로드용 몸통을 손으로 만든다 (requests 없이)."""
    경계 = "----뉴보대%s" % os.urandom(8).hex()
    조각 = []
    for k, v in fields.items():
        조각.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n"
                     % (경계, k, v)).encode("utf-8"))
    for k, path in files.items():
        이름 = os.path.basename(path)
        형 = mimetypes.guess_type(이름)[0] or "application/octet-stream"
        조각.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
                     "Content-Type: %s\r\n\r\n" % (경계, k, 이름, 형)).encode("utf-8"))
        with open(path, "rb") as f:
            조각.append(f.read())
        조각.append(b"\r\n")
    조각.append(("--%s--\r\n" % 경계).encode("utf-8"))
    return b"".join(조각), "multipart/form-data; boundary=" + 경계


# ────────────────────────────────────────────────── 설정 파일
def 설정읽기():
    if not os.path.isfile(설정경로):
        return {"앱": {}, "호스팅": {}, "계정": {}}
    with open(설정경로, encoding="utf-8") as f:
        d = json.load(f)
    d.setdefault("앱", {})
    d.setdefault("호스팅", {})
    d.setdefault("계정", {})
    return d


def 설정쓰기(d):
    os.makedirs(설정폴더, exist_ok=True)
    임시 = 설정경로 + ".tmp"
    with open(임시, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    os.replace(임시, 설정경로)          # 쓰다 죽어도 옛 파일은 남는다
    try:
        os.chmod(설정경로, 0o600)
    except OSError:
        pass
    return 설정경로


def 앱정보(d=None):
    d = d if d is not None else 설정읽기()
    앱 = d.get("앱") or {}
    if not 앱.get("app_id") or not 앱.get("app_secret"):
        raise MetaError("앱 정보가 없습니다. 먼저 `python 메타_연결.py 앱` 을 하세요.")
    앱.setdefault("redirect_uri", "https://koreauniversityforum.github.io/new_bo_dea/connect.html")
    # 스레드 앱 ID·비밀은 메타 대시보드에서 **따로** 나온다. 안 적었으면 페이스북 것을
    # 그대로 써 보지만, 대개 다르므로 실패하면 이 안내가 먼저 뜬다.
    앱.setdefault("threads_app_id", 앱["app_id"])
    앱.setdefault("threads_app_secret", 앱["app_secret"])
    return 앱


def 계정가져오기(키, d=None):
    d = d if d is not None else 설정읽기()
    if 키 not in d["계정"]:
        있는것 = ", ".join(d["계정"]) or "(없음)"
        raise MetaError("`%s` 계정이 설정에 없습니다. 있는 것: %s" % (키, 있는것))
    return d["계정"][키]


# ────────────────────────────────────────────────── 로그인 (토큰 받기)
def 페이스북_동의주소(앱):
    """사람이 브라우저에서 열 주소. 여기서 인스타 + 페이지 권한을 한 번에 받는다."""
    return FB_OAUTH + "?" + urllib.parse.urlencode({
        "client_id": 앱["app_id"],
        "redirect_uri": 앱["redirect_uri"],
        "scope": ",".join(FB_SCOPES),
        "response_type": "code",
    })


def 스레드_동의주소(앱):
    return TH_OAUTH + "?" + urllib.parse.urlencode({
        "client_id": 앱["threads_app_id"],
        "redirect_uri": 앱["redirect_uri"],
        "scope": ",".join(TH_SCOPES),
        "response_type": "code",
    })


def 코드뽑기(붙여넣은것):
    """주소창을 통째로 붙여넣어도, 코드만 붙여넣어도 받는다.

    스레드는 코드 끝에 `#_` 를 달아 돌려준다 — 그대로 쓰면 조용히 400 이 나므로 떼어낸다.
    """
    s = (붙여넣은것 or "").strip().strip('"').strip("'")
    if s.startswith("http") and "code=" not in s:
        # 동의를 취소하면 `?error_reason=user_denied&error=access_denied…` 로 돌아온다.
        # 그대로 코드로 써 보내면 메타가 뭉뚱그린 400 을 주므로 여기서 먼저 막는다.
        q = urllib.parse.parse_qs(urllib.parse.urlparse(s).query)
        왜 = (q.get("error_description") or q.get("error_reason") or q.get("error") or [""])[0]
        raise MetaError("주소에 code 가 없습니다%s. 동의를 끝까지 눌렀는지 확인하세요."
                        % (" (%s)" % 왜 if 왜 else ""))
    if "code=" in s:
        q = urllib.parse.urlparse(s).query or s.split("?", 1)[-1]
        값 = urllib.parse.parse_qs(q).get("code")
        if not 값:
            raise MetaError("주소에 code 가 없습니다. 사용자가 동의를 취소했을 수 있습니다.")
        s = 값[0]
    s = s.split("#")[0].strip()
    if not s:
        raise MetaError("코드가 비었습니다.")
    return s


def 페이스북_토큰(앱, code):
    """코드 → 단기 토큰 → **장기 토큰(60일)** 까지 한 번에."""
    단기 = _호출("GET", FB + "/oauth/access_token", {
        "client_id": 앱["app_id"], "client_secret": 앱["app_secret"],
        "redirect_uri": 앱["redirect_uri"], "code": code})["access_token"]
    긴것 = _호출("GET", FB + "/oauth/access_token", {
        "grant_type": "fb_exchange_token", "client_id": 앱["app_id"],
        "client_secret": 앱["app_secret"], "fb_exchange_token": 단기})
    return 긴것["access_token"], 긴것.get("expires_in", 60 * 24 * 3600)


def 스레드_토큰(앱, code):
    단기 = _호출("POST", "https://graph.threads.net/oauth/access_token", {
        "client_id": 앱["threads_app_id"], "client_secret": 앱["threads_app_secret"],
        "grant_type": "authorization_code", "redirect_uri": 앱["redirect_uri"],
        "code": code})["access_token"]
    긴것 = _호출("GET", "https://graph.threads.net/access_token", {
        "grant_type": "th_exchange_token", "client_secret": 앱["threads_app_secret"],
        "access_token": 단기})
    return 긴것["access_token"], 긴것.get("expires_in", 60 * 24 * 3600)


def 대상찾기(사용자토큰):
    """이 토큰으로 올릴 수 있는 **페이지와 인스타 계정**을 죄다 훑어 온다.

    페이지마다 토큰이 따로 나오고, 인스타는 페이지에 딸려 나온다. 사용자 토큰이
    장기(60일)면 여기서 나온 **페이지 토큰은 만료가 없다** — 이게 이 경로의 큰 이점이다.
    """
    r = _호출("GET", FB + "/me/accounts", {
        "fields": "id,name,access_token,instagram_business_account{id,username}",
        "limit": 100}, token=사용자토큰)
    나온것 = []
    for p in r.get("data", []):
        ig = p.get("instagram_business_account") or {}
        나온것.append({"page_id": p["id"], "page_name": p.get("name", ""),
                       "page_token": p.get("access_token", ""),
                       "ig_id": ig.get("id", ""), "ig_username": ig.get("username", "")})
    return 나온것


def 스레드_나(토큰):
    r = _호출("GET", TH + "/me", {"fields": "id,username"}, token=토큰)
    return r.get("id", ""), r.get("username", "")


def 만료일(초):
    return (datetime.now() + timedelta(seconds=int(초 or 0))).strftime("%Y-%m-%d")


def 남은날(계정갈래):
    s = (계정갈래 or {}).get("만료")
    if not s:
        return None
    try:
        return (datetime.strptime(s, "%Y-%m-%d") - datetime.now()).days
    except ValueError:
        return None


def 토큰갱신(계정, 앱, 로그=print):
    """만료가 가까운 것만 새로 받는다. 주 1회 돌리면 60일짜리를 영원히 이어 갈 수 있다.

    - 페이스북 **사용자** 토큰은 살아 있는 동안 다시 교환하면 60일이 새로 붙는다.
      페이지 토큰은 만료가 없으므로 사용자 토큰만 챙기면 된다.
    - 스레드는 전용 `th_refresh_token` 을 쓴다(발급 후 24시간 지나야 받아 준다).
    """
    바뀜 = False
    fb = 계정.get("facebook") or {}
    if fb.get("user_token") and (남은날(fb) is None or 남은날(fb) < 20):
        새것 = _호출("GET", FB + "/oauth/access_token", {
            "grant_type": "fb_exchange_token", "client_id": 앱["app_id"],
            "client_secret": 앱["app_secret"], "fb_exchange_token": fb["user_token"]})
        fb["user_token"] = 새것["access_token"]
        fb["만료"] = 만료일(새것.get("expires_in", 60 * 24 * 3600))
        로그("  페이스북 사용자 토큰 갱신 → %s" % fb["만료"])
        바뀜 = True
    th = 계정.get("threads") or {}
    if th.get("token") and (남은날(th) is None or 남은날(th) < 20):
        새것 = _호출("GET", "https://graph.threads.net/refresh_access_token", {
            "grant_type": "th_refresh_token", "access_token": th["token"]})
        th["token"] = 새것["access_token"]
        th["만료"] = 만료일(새것.get("expires_in", 60 * 24 * 3600))
        로그("  스레드 토큰 갱신 → %s" % th["만료"])
        바뀜 = True
    return 바뀜


# ────────────────────────────────────────────────── 그림 다듬기
def _jpeg_로(png경로, 낼곳, 품질=92):
    """PNG → JPEG. **Pillow 없이** 윈도우의 .NET 을 빌려 쓴다.

    🔴 인스타는 JPEG 만 받는다(PNG 를 주면 컨테이너 만들 때부터 막힌다). 그런데 우리 카드는
    캔버스에서 나온 PNG 다. 이 프로젝트는 「설치 0개」가 규칙이라 Pillow 를 못 깐다 →
    윈도우에 늘 있는 `System.Drawing` 을 파워셸로 한 번 부른다.
    윈도우가 아니면 여기서 솔직하게 실패한다(조용히 PNG 를 올려 실패하는 것보다 낫다).
    """
    if os.name != "nt":
        raise MetaError("PNG 를 JPEG 로 바꿀 방법이 없습니다(윈도우가 아닙니다). "
                        "카드를 JPG 로 저장해 두고 다시 하세요: %s" % png경로)
    ps = "\n".join([
        "Add-Type -AssemblyName System.Drawing",
        "$i=[System.Drawing.Image]::FromFile('@SRC@')",
        "$b=New-Object System.Drawing.Bitmap($i.Width,$i.Height)",
        "$g=[System.Drawing.Graphics]::FromImage($b)",
        # 투명한 곳을 흰색으로 깔아 둔다. 안 깔면 JPEG 에서 검게 나온다.
        "$g.Clear([System.Drawing.Color]::White)",
        "$g.DrawImage($i,0,0,$i.Width,$i.Height)",
        "$c=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | "
        "Where-Object { $_.MimeType -eq 'image/jpeg' }",
        "$p=New-Object System.Drawing.Imaging.EncoderParameters(1)",
        "$p.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter("
        "[System.Drawing.Imaging.Encoder]::Quality,[long]@Q@)",
        "$b.Save('@DST@',$c,$p)",
        "$g.Dispose(); $b.Dispose(); $i.Dispose()",
    ])
    ps = (ps.replace("@SRC@", png경로.replace("'", "''"))
            .replace("@DST@", 낼곳.replace("'", "''"))
            .replace("@Q@", str(int(품질))))
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0 or not os.path.isfile(낼곳):
        raise MetaError("JPEG 변환 실패(%s): %s" % (os.path.basename(png경로),
                                                   (r.stderr or "").strip()[:300]))
    return 낼곳


def 올릴그림_고르기(파일들, 임시폴더, jpeg필요=True):
    """올릴 순서대로 정리하고, 필요하면 JPEG 사본을 만든다.

    원본은 건드리지 않는다 - 사본만 임시폴더에 만든다. 이름 앞 번호가 곧 캐러셀 순서라
    파일 이름으로 정렬한다(`01_…`, `02_…` - `_insta_stage` 가 붙여 주는 규칙).
    """
    파일들 = sorted(파일들, key=lambda p: os.path.basename(p).lower())
    if not 파일들:
        raise MetaError("올릴 그림이 없습니다.")
    if len(파일들) > 최대장수:
        raise MetaError("한 게시물에 %d장까지입니다 (지금 %d장)." % (최대장수, len(파일들)))
    os.makedirs(임시폴더, exist_ok=True)
    낸것 = []
    for i, p in enumerate(파일들, 1):
        if not os.path.isfile(p):
            raise MetaError("파일이 없습니다: %s" % p)
        확장 = os.path.splitext(p)[1].lower()
        if 확장 in (".jpg", ".jpeg") or not jpeg필요:
            낼곳 = os.path.join(임시폴더, "%02d%s" % (i, 확장 or ".jpg"))
            shutil.copy2(p, 낼곳)
        else:
            낼곳 = os.path.join(임시폴더, "%02d.jpg" % i)
            _jpeg_로(p, 낼곳)
        크기 = os.path.getsize(낼곳)
        if 크기 > 8 * 1024 * 1024:
            raise MetaError("%s 이 8MB 를 넘습니다(%.1fMB). 인스타가 받지 않습니다."
                            % (os.path.basename(p), 크기 / 1024 / 1024))
        낸것.append(낼곳)
    return 낸것


# ────────────────────────────────────────────────── 공개 주소 (호스팅)
def _주소붙이기(밑, 조각):
    return 밑.rstrip("/") + "/" + urllib.parse.quote(조각)


def _주소확인(url, 기다림=20, 로그=None):
    """메타가 긁어 갈 주소가 **정말 열리는지** 우리가 먼저 받아 본다.

    여기서 확인하지 않으면 메타 쪽에서 "미디어를 가져올 수 없습니다" 라는 뭉뚱그린 오류만
    돌아와, 그림 문제인지 주소 문제인지 토큰 문제인지 구분이 안 된다.
    """
    끝 = time.time() + 기다림
    마지막 = ""
    while True:
        try:
            with _열기(urllib.request.Request(url, method="GET")) as r:
                if 200 <= getattr(r, "status", 200) < 300:
                    return True
                마지막 = "HTTP %s" % r.status
        except Exception as e:                       # 배포 전이면 404 도 여기로 온다
            마지막 = str(getattr(e, "code", None) or e)
        if time.time() >= 끝:
            break
        if 로그:
            로그("    아직 안 열림 (%s) - 기다립니다" % 마지막)
        time.sleep(5)
    raise MetaError("공개 주소가 열리지 않습니다: %s (%s)\n"
                    "  → 메타 서버가 이 주소를 직접 읽어야 게시가 됩니다." % (url, 마지막))


class 직접호스팅:
    """이미 공개된 자리(젯슨·터널·아무 웹호스팅)에 그림을 두고 주소만 알려 준다.

    설정: {"방식":"직접", "폴더":"C:/…/공개폴더", "공개주소":"https://…/"}
    """

    def __init__(self, 폴더, 공개주소):
        self.폴더 = 폴더
        self.공개주소 = 공개주소
        self.둔것 = []

    def 올리기(self, 파일들, 로그=print):
        하위 = "nb" + datetime.now().strftime("%y%m%d%H%M%S")
        낼곳 = os.path.join(self.폴더, 하위)
        os.makedirs(낼곳, exist_ok=True)
        주소들 = []
        for p in 파일들:
            shutil.copy2(p, os.path.join(낼곳, os.path.basename(p)))
            주소들.append(_주소붙이기(self.공개주소, 하위 + "/" + os.path.basename(p)))
        self.둔것.append(낼곳)
        for u in 주소들:
            _주소확인(u, 로그=로그)
        로그("  공개 주소 확인됨 (%d장)" % len(주소들))
        return 주소들

    def 치우기(self, 로그=print):
        for d in self.둔것:
            shutil.rmtree(d, ignore_errors=True)
        self.둔것 = []


class 깃허브페이지호스팅:
    """깃허브 페이지(`docs/`)에 잠깐 올려 두고, 게시가 끝나면 지운다.

    이 팀은 이미 `koreauniversityforum/new_bo_dea` 의 `docs/` 를 페이지로 쓰고 있으므로
    **새로 살 것도 켜 둘 것도 없다**는 게 장점이다.
    🔴 대신 둘을 감수해야 한다. ① 페이지 배포에 30초~2분이 걸린다(그래서 200 이 뜰 때까지
    기다린다) ② 지워도 **깃 이력에는 그림이 남는다**(저장소가 조금씩 뚱뚱해진다).
    매일 올릴 거라면 젯슨 쪽 `직접` 호스팅이 낫다.
    🔴 `폰판_만들기.py` 는 `docs/` 를 통째로 비우므로, 그 스크립트가 `올림/` 만은 남기도록
       손봐 두었다. 안 그러면 폰판을 다시 굽는 순간 올리던 그림이 사라진다.
    """

    def __init__(self, 저장소, 공개주소, 하위="docs/올림"):
        self.저장소 = 저장소
        self.공개주소 = 공개주소
        self.하위 = 하위.replace("\\", "/").strip("/")
        self.둔것 = []

    def _깃(self, *인자, 확인=True):
        r = subprocess.run(["git"] + list(인자), cwd=self.저장소, capture_output=True,
                           text=True, encoding="utf-8", errors="replace")
        if 확인 and r.returncode != 0:
            raise MetaError("git %s 실패: %s" % (인자[0], (r.stderr or r.stdout).strip()[:300]))
        return r

    def 올리기(self, 파일들, 로그=print):
        이름 = "nb" + datetime.now().strftime("%y%m%d%H%M%S")
        rel = self.하위 + "/" + 이름
        낼곳 = os.path.join(self.저장소, rel.replace("/", os.sep))
        os.makedirs(낼곳, exist_ok=True)
        # 공개 주소는 `docs/` 아래를 뿌리로 삼는다 (Pages 설정이 main/docs 이므로)
        웹뿌리 = rel[len("docs/"):] if rel.startswith("docs/") else rel
        주소들 = []
        for p in 파일들:
            shutil.copy2(p, os.path.join(낼곳, os.path.basename(p)))
            주소들.append(_주소붙이기(self.공개주소, 웹뿌리 + "/" + os.path.basename(p)))
        self.둔것.append(rel)
        self._깃("add", "--", rel)
        self._깃("commit", "-m", "올림: 게시용 그림 %d장 (%s)" % (len(파일들), 이름))
        self._깃("push")
        로그("  깃허브에 올림 - 페이지 배포를 기다립니다 (최대 3분)")
        for u in 주소들:
            _주소확인(u, 기다림=180, 로그=로그)
        로그("  공개 주소 확인됨 (%d장)" % len(주소들))
        return 주소들

    def 치우기(self, 로그=print):
        if not self.둔것:
            return
        for rel in self.둔것:
            self._깃("rm", "-r", "--quiet", "--", rel, 확인=False)
        self._깃("commit", "-m", "올림: 게시 끝난 그림 치움", 확인=False)
        self._깃("push", 확인=False)
        로그("  올려 뒀던 그림 치움")
        self.둔것 = []


class 터널호스팅:
    """cloudflared 로 임시 주소를 열어 그 순간만 공개한다 (아무 것도 안 남는다).

    설정: {"방식":"터널"} - `cloudflared` 가 PATH 에 있어야 한다.
    """

    def __init__(self, 임시폴더):
        self.임시폴더 = 임시폴더
        self.서버 = None
        self.프로세스 = None
        self.주소 = ""

    def 올리기(self, 파일들, 로그=print):
        import http.server
        import socketserver
        import threading
        폴더 = os.path.abspath(self.임시폴더)
        for p in 파일들:
            if os.path.dirname(os.path.abspath(p)) != 폴더:
                shutil.copy2(p, 폴더)

        class 손(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw):
                super().__init__(*a, directory=폴더, **kw)

            def log_message(self, *a):
                pass

        # 🔴 allow_reuse_address 를 켜 두면 이미 쓰는 포트에 조용히 겹쳐 붙는다
        #    (뉴보대·경제 앱을 같이 켰을 때 이미 한 번 당했다).
        socketserver.TCPServer.allow_reuse_address = False
        self.서버 = socketserver.TCPServer(("127.0.0.1", 0), 손)
        포트 = self.서버.server_address[1]
        threading.Thread(target=self.서버.serve_forever, daemon=True).start()
        if not shutil.which("cloudflared"):
            self.치우기()
            raise MetaError("cloudflared 가 없습니다. 호스팅 방식을 `직접`이나 `깃허브페이지`로 "
                            "바꾸거나 cloudflared 를 PATH 에 두세요.")
        self.프로세스 = subprocess.Popen(
            # 🔴 젯슨 망에서 QUIC 이 막혀 있었다. http2 로 못 박는다.
            ["cloudflared", "tunnel", "--url", "http://127.0.0.1:%d" % 포트,
             "--protocol", "http2"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace")
        끝 = time.time() + 60
        while time.time() < 끝 and not self.주소:
            줄 = self.프로세스.stdout.readline()
            if not 줄:
                break
            for 조각 in 줄.split():
                if 조각.startswith("https://") and "trycloudflare.com" in 조각:
                    self.주소 = 조각.strip().rstrip(".")
                    break
        if not self.주소:
            self.치우기()
            raise MetaError("터널 주소를 못 받았습니다.")
        로그("  임시 주소: %s" % self.주소)
        주소들 = [_주소붙이기(self.주소, os.path.basename(p)) for p in 파일들]
        for u in 주소들:
            _주소확인(u, 기다림=60)
        return 주소들

    def 치우기(self, 로그=print):
        if self.프로세스:
            self.프로세스.terminate()
            self.프로세스 = None
        if self.서버:
            self.서버.shutdown()
            self.서버.server_close()
            self.서버 = None


def 호스팅만들기(설정, 임시폴더):
    h = dict(설정.get("호스팅") or {})
    방식 = h.get("방식") or "깃허브페이지"
    if 방식 == "직접":
        if not h.get("폴더") or not h.get("공개주소"):
            raise MetaError("직접 호스팅에는 `폴더`와 `공개주소`가 필요합니다.")
        return 직접호스팅(h["폴더"], h["공개주소"])
    if 방식 == "터널":
        return 터널호스팅(임시폴더)
    저장소 = h.get("저장소") or os.path.dirname(BASE)
    주소 = h.get("공개주소") or "https://koreauniversityforum.github.io/new_bo_dea/"
    return 깃허브페이지호스팅(저장소, 주소, h.get("하위") or "docs/올림")


# ────────────────────────────────────────────────── 인스타그램
def _컨테이너_기다리기(컨테이너, 토큰, 로그=print, 최대=180):
    """컨테이너가 다 익을 때까지 기다린다.

    만들자마자 발행하면 메타가 아직 그림을 안 읽어 와 실패한다. 상태가 `FINISHED` 가
    되기를 기다리되, `ERROR` 면 그 자리에서 이유를 달고 멈춘다.
    """
    끝 = time.time() + 최대
    while time.time() < 끝:
        r = _호출("GET", FB + "/" + 컨테이너, {"fields": "status_code,status"}, token=토큰)
        상태 = r.get("status_code") or ""
        if 상태 == "FINISHED":
            return True
        if 상태 in ("ERROR", "EXPIRED"):
            raise MetaError("인스타가 그림을 못 받았습니다 (%s): %s"
                            % (상태, r.get("status", "")))
        로그("    익는 중… (%s)" % (상태 or "?"))
        time.sleep(5)
    raise MetaError("컨테이너가 %d초 안에 준비되지 않았습니다." % 최대)


def 인스타_올리기(계정, 주소들, 문구, 로그=print):
    """캐러셀이면 장마다 만들고 묶어서, 한 장이면 곧장 발행한다."""
    ig = 계정.get("instagram") or {}
    if not ig.get("id") or not ig.get("token"):
        raise MetaError("인스타 연결이 없습니다.")
    if len(문구 or "") > IG_최대글자:
        raise MetaError("인스타 글이 %d자입니다 (최대 %d자)." % (len(문구), IG_최대글자))
    id_, 토큰 = ig["id"], ig["token"]

    if len(주소들) == 1:
        c = _호출("POST", "%s/%s/media" % (FB, id_),
                  {"image_url": 주소들[0], "caption": 문구}, token=토큰)["id"]
        _컨테이너_기다리기(c, 토큰, 로그)
    else:
        아이들 = []
        for i, u in enumerate(주소들, 1):
            로그("  인스타 %d/%d장 담는 중" % (i, len(주소들)))
            아이 = _호출("POST", "%s/%s/media" % (FB, id_),
                        {"image_url": u, "is_carousel_item": "true"}, token=토큰)["id"]
            _컨테이너_기다리기(아이, 토큰, 로그)
            아이들.append(아이)
        c = _호출("POST", "%s/%s/media" % (FB, id_),
                  {"media_type": "CAROUSEL", "children": ",".join(아이들),
                   "caption": 문구}, token=토큰)["id"]
        _컨테이너_기다리기(c, 토큰, 로그)

    r = _호출("POST", "%s/%s/media_publish" % (FB, id_), {"creation_id": c}, token=토큰)
    미디어 = r.get("id", "")
    링크 = ""
    try:
        링크 = _호출("GET", FB + "/" + 미디어, {"fields": "permalink"},
                    token=토큰).get("permalink", "")
    except MetaError:
        pass                                  # 링크는 덤이다. 못 받아도 게시는 끝났다.
    return {"창구": "인스타그램", "id": 미디어, "링크": 링크}


# ────────────────────────────────────────────────── 페이스북 페이지
def 페이스북_올리기(계정, 파일들, 문구, 로그=print):
    """페이스북만은 **파일 바이트를 그대로** 받는다 - 공개 주소가 필요 없다.

    여러 장이면 `published=false` 로 하나씩 올려 사진 ID 를 모은 뒤,
    글 하나에 `attached_media` 로 묶는다(이게 페이스북의 캐러셀이다).
    """
    fb = 계정.get("facebook") or {}
    if not fb.get("page_id") or not fb.get("page_token"):
        raise MetaError("페이스북 페이지 연결이 없습니다.")
    페이지, 토큰 = fb["page_id"], fb["page_token"]

    if len(파일들) == 1:
        r = _호출("POST", "%s/%s/photos" % (FB, 페이지),
                  {"caption": 문구, "published": "true"}, token=토큰,
                  files={"source": 파일들[0]})
        게시 = r.get("post_id") or r.get("id", "")
    else:
        아이들 = []
        for i, p in enumerate(파일들, 1):
            로그("  페이스북 %d/%d장 올리는 중" % (i, len(파일들)))
            r = _호출("POST", "%s/%s/photos" % (FB, 페이지),
                      {"published": "false"}, token=토큰, files={"source": p})
            아이들.append(r["id"])
        묶음 = {"message": 문구}
        for i, 아이 in enumerate(아이들):
            묶음["attached_media[%d]" % i] = json.dumps({"media_fbid": 아이})
        게시 = _호출("POST", "%s/%s/feed" % (FB, 페이지), 묶음, token=토큰).get("id", "")
    번호 = 게시.split("_")[-1] if "_" in 게시 else 게시
    return {"창구": "페이스북", "id": 게시,
            "링크": "https://www.facebook.com/%s/posts/%s" % (페이지, 번호) if 번호 else ""}


# ────────────────────────────────────────────────── 스레드
def _스레드_기다리기(컨테이너, 토큰, 로그=print, 최대=120):
    끝 = time.time() + 최대
    while time.time() < 끝:
        r = _호출("GET", TH + "/" + 컨테이너, {"fields": "status,error_message"}, token=토큰)
        상태 = r.get("status") or ""
        if 상태 in ("FINISHED", "PUBLISHED"):
            return True
        if 상태 == "ERROR":
            raise MetaError("스레드가 그림을 못 받았습니다: %s" % r.get("error_message", ""))
        로그("    익는 중… (%s)" % (상태 or "?"))
        time.sleep(5)
    raise MetaError("스레드 컨테이너가 %d초 안에 준비되지 않았습니다." % 최대)


def 스레드_올리기(계정, 주소들, 문구, 로그=print):
    """글만·한 장·여러 장 셋을 다 받는다.

    🔴 스레드는 500자다. 인스타 문구를 그대로 넘기면 대개 넘치므로 **자르지 않고 막는다** -
    조용히 잘라 올리면 문장이 잘린 게시물이 남는다.
    """
    th = 계정.get("threads") or {}
    if not th.get("id") or not th.get("token"):
        raise MetaError("스레드 연결이 없습니다.")
    if len(문구 or "") > TH_최대글자:
        raise MetaError("스레드 글이 %d자입니다 (최대 %d자). `--스레드문구` 로 짧은 글을 따로 "
                        "주거나 문구를 줄이세요." % (len(문구), TH_최대글자))
    id_, 토큰 = th["id"], th["token"]

    if not 주소들:
        c = _호출("POST", "%s/%s/threads" % (TH, id_),
                  {"media_type": "TEXT", "text": 문구}, token=토큰)["id"]
    elif len(주소들) == 1:
        c = _호출("POST", "%s/%s/threads" % (TH, id_),
                  {"media_type": "IMAGE", "image_url": 주소들[0], "text": 문구},
                  token=토큰)["id"]
        _스레드_기다리기(c, 토큰, 로그)
    else:
        아이들 = []
        for i, u in enumerate(주소들, 1):
            로그("  스레드 %d/%d장 담는 중" % (i, len(주소들)))
            아이 = _호출("POST", "%s/%s/threads" % (TH, id_),
                        {"media_type": "IMAGE", "image_url": u, "is_carousel_item": "true"},
                        token=토큰)["id"]
            _스레드_기다리기(아이, 토큰, 로그)
            아이들.append(아이)
        c = _호출("POST", "%s/%s/threads" % (TH, id_),
                  {"media_type": "CAROUSEL", "children": ",".join(아이들), "text": 문구},
                  token=토큰)["id"]
        _스레드_기다리기(c, 토큰, 로그)

    # 메타 문서가 컨테이너를 만든 뒤 **30초쯤 두라**고 권한다. 사진이 있을 때만 지킨다.
    if 주소들:
        time.sleep(3)
    r = _호출("POST", "%s/%s/threads_publish" % (TH, id_), {"creation_id": c}, token=토큰)
    쓰레드 = r.get("id", "")
    링크 = ""
    try:
        링크 = _호출("GET", TH + "/" + 쓰레드, {"fields": "permalink"},
                    token=토큰).get("permalink", "")
    except MetaError:
        pass
    return {"창구": "스레드", "id": 쓰레드, "링크": 링크}


# ────────────────────────────────────────────────── 한 번에
def 올리기(계정키, 파일들, 문구, 창구=("instagram", "facebook", "threads"),
          스레드문구=None, 설정=None, 로그=print, 시늉=False):
    """계정 하나에 대해 고른 창구로 같은 카드를 올린다.

    창구 하나가 실패해도 **나머지는 계속 간다.** 셋 다 성공해야만 의미가 있는 일이 아니고,
    하나 때문에 전부 되돌리면 이미 올라간 것을 손으로 지워야 해서 더 나쁘다.
    결과는 창구별로 성공/실패를 따로 담아 돌려준다.
    """
    설정 = 설정 if 설정 is not None else 설정읽기()
    계정 = 계정가져오기(계정키, 설정)
    창구 = [c for c in 창구 if (계정.get(c) or {})]
    if not 창구:
        raise MetaError("`%s` 에 연결된 창구가 없습니다." % 계정키)

    임시 = os.path.join(설정폴더, "임시", datetime.now().strftime("%y%m%d%H%M%S"))
    호스팅 = None
    결과 = []
    try:
        # 인스타는 JPEG 만 받으므로, 인스타가 끼면 통째로 JPEG 로 맞춘다
        # (창구마다 다른 파일을 쓰면 페이스북과 인스타에 다른 그림이 올라간다).
        그림 = 올릴그림_고르기(파일들, 임시, jpeg필요=("instagram" in 창구))
        주소들 = []
        if any(c in 창구 for c in ("instagram", "threads")):
            호스팅 = 호스팅만들기(설정, 임시)
            if 시늉:
                로그("  [시늉] 공개 주소 올리기 건너뜀")
            else:
                주소들 = 호스팅.올리기(그림, 로그)

        일감 = [("instagram", lambda: 인스타_올리기(계정, 주소들, 문구, 로그)),
                ("facebook", lambda: 페이스북_올리기(계정, 그림, 문구, 로그)),
                ("threads", lambda: 스레드_올리기(계정, 주소들,
                                                 스레드문구 if 스레드문구 is not None else 문구,
                                                 로그))]
        for 이름, 하기 in 일감:
            if 이름 not in 창구:
                continue
            if 시늉:
                결과.append({"창구": 이름, "ok": True, "시늉": True})
                로그("  [시늉] %s 올리기 - 실제로는 안 보냅니다" % 이름)
                continue
            try:
                r = 하기()
                r["ok"] = True
                결과.append(r)
                로그("  ✔ %s 올림 %s" % (r.get("창구", 이름), r.get("링크", "")))
            except MetaError as e:
                결과.append({"창구": 이름, "ok": False, "왜": str(e)})
                로그("  ✘ %s 실패: %s" % (이름, e))
        return 결과
    finally:
        if 호스팅:
            try:
                호스팅.치우기(로그)
            except Exception as e:              # 치우다 실패해도 게시는 이미 끝났다
                로그("  (치우기 실패: %s)" % e)
        shutil.rmtree(임시, ignore_errors=True)
