# -*- coding: utf-8 -*-
"""제 창을 여는 부분 — 브라우저를 띄우지 않는다.

창을 띄우는 방법을 세 단으로 두고 위에서부터 내려간다.

  1) pywebview + WebView2   제 프로세스가 제 창을 연다. **브라우저가 안 뜬다.**
                            VS Code·슬랙과 같은 방식이고, WebView2 는 윈도우 11 에
                            이미 깔려 있다. exe 로 묶었을 때 이 길로 간다.
  2) 엣지·크롬 `--app=`      주소창·탭은 없지만 브라우저가 따로 뜬다. 파이썬만 동봉한
                            공유용 ZIP 에는 pywebview 가 없으므로 여기로 물러선다.
  3) 보통 브라우저 탭        엔진이 하나도 없는 PC 의 마지막 자리.

왜 화면은 그대로 두는가
-----------------------
카드는 전부 브라우저 canvas 로 그린다. `static/app.js`(ctx 호출 50) ·
`static/outro.js`(94) · `static/hiddenmark.js`(17), 파이썬 쪽 그리기 코드는 0줄이다.
이걸 파이썬으로 옮기면 글자 폭을 재는 방식이 `measureText` → `font.getlength` 로
바뀌어 카드 줄바꿈·자간이 전부 틀어지고, 뒷장 5종과 워터마크를 처음부터 다시
검증해야 한다. 그래서 **그리는 코드는 한 줄도 건드리지 않고 껍데기만 바꿨다.**

🔴 인스타 올리기(`insta.py`)가 모는 크롬과는 아무 상관이 없다. 그쪽은 인스타에
   로그인한 별도 프로필(`chrome_insta`)이고, 이 파일은 우리 화면을 담는 창이다.
"""

import os
import subprocess
import sys

# ── 1단: pywebview 창 ────────────────────────────────────────────────────

def close_splash():
    """켤 때 뜨는 그림을 닫는다. exe 로 묶였을 때만 있다."""
    try:
        import pyi_splash                      # PyInstaller 가 넣어 주는 것
        pyi_splash.close()
    except Exception:
        pass


def has_webview():
    """제 창을 띄울 수 있는 PC 인가. 창을 띄우기 **전에** 알아야 할 때가 있다
    (검은 창을 숨길지 말지는 창이 뜬 뒤엔 물어볼 수 없다 — 그때는 이미 창이
    닫힐 때까지 돌아오지 않는다)."""
    try:
        import webview  # noqa: F401
        return True
    except Exception:
        return False


def run_window(url, title="뉴보대 카드뉴스 메이커", store_dir=None, on_fail=None):
    """제 창으로 띄우고 **창이 닫힐 때까지 여기서 기다린다.**

    성공하면 True. pywebview 나 WebView2 가 없으면 False 를 돌려주고, 부르는 쪽이
    아래 `open_app_window` 로 물러선다.

    🔴 이 함수는 반드시 **주 스레드**에서 불러야 한다. WebView2 는 창을 만든
       스레드에서만 돌아간다. 그래서 서버 쪽이 딴 스레드로 가야 한다.
    """
    try:
        import webview
    except Exception:
        if on_fail:
            on_fail("pywebview 없음")
        return False
    try:
        webview.create_window(
            title, url,
            width=1480, height=940, min_size=(1100, 720),
            background_color="#14161a", text_select=True)
        # 🔴 기본값(private_mode=True)은 WebView2 프로필을 **매번 새로 만들고 지운다.**
        # 그러면 켤 때마다 엔진이 맨바닥에서 올라와 오래 걸린다. 자리를 정해 두면
        # 두 번째부터 훨씬 빠르다. (경제 카드뉴스 메이커 실측 11.6초 → 4.6초)
        store = store_dir or os.path.join(
            os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"),
            "뉴보대", "창데이터")
        try:
            os.makedirs(store, exist_ok=True)
        except OSError:
            pass
        close_splash()
        webview.start(private_mode=False, storage_path=store)
        return True
    except Exception:
        if on_fail:
            on_fail("창 띄우기 실패")
        return False


# ── 2단: 엣지·크롬 앱 모드 ───────────────────────────────────────────────

# 앱 창 전용 프로필. insta.py 의 chrome_insta 와 형제 폴더이지 같은 폴더가 아니다.
PROFILE = os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"),
    "뉴보대", "app_window")

# 엣지 먼저(윈도우 11 기본 내장) → 크롬 → 크롬 사용자 설치본
BROWSERS = [
    (r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe", "엣지"),
    (r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe", "엣지"),
    (r"%ProgramFiles%\Google\Chrome\Application\chrome.exe", "크롬"),
    (r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe", "크롬"),
    (r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe", "크롬"),
]


def find_browser():
    """앱 모드로 띄울 수 있는 브라우저를 찾는다. (경로, 이름) 또는 (None, None)."""
    for raw, name in BROWSERS:
        path = os.path.expandvars(raw)
        if path and os.path.isfile(path):
            return path, name
    return None, None


def open_app_window(url):
    """`--app=` 창을 띄운다. 성공하면 Popen, 못 띄우면 None."""
    exe, _ = find_browser()
    if not exe:
        return None
    try:
        os.makedirs(PROFILE, exist_ok=True)
    except OSError:
        pass
    args = [
        exe,
        "--app=" + url,                     # ← 이 한 줄이 주소창·탭·북마크를 없앤다
        "--user-data-dir=" + PROFILE,
        "--window-size=1480,940",
        "--no-first-run",                   # 처음 띄울 때 환영 화면 안 뜨게
        "--no-default-browser-check",       # "기본 브라우저로 하시겠습니까" 안 뜨게
        "--disable-background-networking",
        "--disable-sync",                   # 개인 계정과 섞이지 않게
        "--no-service-autorun",
        "--disable-features=Translate,TranslateUI,msEdgeTranslate",
    ]
    # 창을 띄우는 것 말고 이 프로세스와 주고받을 것이 없다. 출력을 파이프로 받으면
    # 아무도 읽지 않아 버퍼가 차고, 그 다음은 앱이 멎던 그 상황과 똑같아진다.
    kw = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kw["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        return subprocess.Popen(args, **kw)
    except OSError:
        return None


# ── 딸린 것들 ────────────────────────────────────────────────────────────

def hide_console():
    """검은 콘솔 창을 숨긴다. `.bat` 이 `--hide-console` 을 줄 때만 부른다.

    사람이 자기 터미널에서 `python app.py` 로 띄웠을 때 그 터미널까지 숨기면 안 되니
    기본은 꺼 둔다. exe 는 `--windowed` 라 콘솔이 아예 없어 이 길로 오지 않는다.

    🔴 없애는 게 아니라 **숨기는** 것이다. stdout 이 그대로 살아 있어 기존 `print`
       가 터지지 않는다. pythonw 로 바꾸면 stdout 이 None 이 되어 전부 예외가 난다.
    """
    if os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        u = ctypes.WinDLL("user32", use_last_error=True)
        # 🔴 restype/argtypes 를 반드시 지정한다. 안 하면 실패를 성공처럼 읽는다.
        k.GetConsoleWindow.restype = wintypes.HWND
        k.GetConsoleWindow.argtypes = []
        u.ShowWindow.restype = wintypes.BOOL
        u.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        h = k.GetConsoleWindow()
        if not h:
            return False                      # 콘솔이 없는 경우(exe·pythonw 등)
        u.ShowWindow(h, 0)                    # SW_HIDE
        return True
    except Exception:
        return False


def icon_path(*roots):
    """창·작업표시줄에 쓸 아이콘. 놓이는 자리가 셋이라 다 뒤진다.

    exe   : `_내부\\뉴보대.ico` (묶여 들어간 것)
    배포본: `뉴보대 카드뉴스 메이커\\뉴보대.ico` (앱과 같은 폴더)
    소스  : `뉴보대\\뉴보대.ico` (newsfeed 의 한 단계 위)
    """
    seen = []
    for r in roots:
        if not r:
            continue
        seen += [os.path.join(r, "뉴보대.ico"),
                 os.path.join(os.path.dirname(r), "뉴보대.ico")]
    for p in seen:
        if os.path.exists(p):
            return p
    return None


def frozen():
    """exe 로 묶여 도는 중인가."""
    return getattr(sys, "frozen", False)
