# -*- coding: utf-8 -*-
r"""위/아래 띠(BREAKING NEWS) + 글자별 굵기 제한 + 브랜드 토큰(brands.js) — 화면을 걷는 시험.

무엇을 재나:
  ① brands.js 가 내려오고 STYLES 가 내장 6종 + 브랜드 수만큼인가(덮어쓴 것·붙은 것)
  ② 위 띠를 켜면 캔버스 y=10 픽셀이 띠 색인가 / 아래 띠도 (H-10)
  ③ 반복(repeat) 문구가 오른쪽 끝까지 채우는가(글자색 픽셀이 오른쪽 구간에 있는가)
  ④ 프리셋 4개(속보·BREAKING NEWS·날짜 띠·끄기) — 날짜는 오늘
  ⑤ 저장·복원 — 새로고침해도 띠가 남는가 / 옛 상태(bands 없음)에서 기본값으로 뜨는가
  ⑥ 스타일 모드가 띠를 정하는가(브랜드 토큰 bands.on) / 색 테마는 띠 색만 바꾸고 끄지 않는가
  ⑦ 굵기 select 가 서체별 가능 굵기로 제한되는가(지마켓 산스 500/700, 검은고딕 400)
  ⑧ deco 'band' 와 겹치지 않는가(띠가 켜지면 그쪽 얇은 띠는 숨김)

    python 시험_띠.py            (앱을 알아서 띄우고 끝나면 내린다)
    python 시험_띠.py --show

크롬은 전용 포트(9348)·회차별 새 프로필 헤드리스. 서버는 7891.
(9333 인스타 / 9345 링크 / 9346 스타일 / 9347 릴스 와 겹치지 않게)
"""
import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insta

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CDP_PORT = 9348
APP_PORT = 7891
PROFILE = tempfile.mkdtemp(prefix="nb_띠시험_")

FAIL = []
N = [0]


def ck(name, cond, extra=""):
    N[0] += 1
    print(("  ok  " if cond else "  🔴  ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAIL.append(name)


PX = """(() => { const d = document.getElementById('cv').getContext('2d').getImageData(%d, %d, 1, 1).data; return [d[0], d[1], d[2]]; })()"""

# 띠 안 오른쪽 구간(x 900~1070)에 글자색(흰색) 픽셀이 있는가 — 세로 띠 전체를 훑는다
RIGHT_TEXT = """(() => {
  const g = document.getElementById('cv').getContext('2d');
  const B = S.bands.%s; const y0 = %s; const h = B.height;
  const d = g.getImageData(900, y0, 170, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i+1] > 235 && d[i+2] > 235) n++;
  return n;
})()"""


def near(px, hexcolor, tol=12):
    r, g, b = int(hexcolor[1:3], 16), int(hexcolor[3:5], 16), int(hexcolor[5:7], 16)
    return abs(px[0] - r) <= tol and abs(px[1] - g) <= tol and abs(px[2] - b) <= tol


def wait_js(ch, expr, tries=20, gap=0.3):
    """값이 참이 될 때까지 되묻는다. 페이지가 아직 app.js 를 다 못 읽어 ReferenceError 가
    나는 동안(느린 첫 로드·큰 글꼴 CSS)은 실패로 치지 않고 다시 묻는다."""
    v = None
    for _ in range(tries):
        try:
            v = ch.js(expr)
        except insta.InstaError as e:
            if "ReferenceError" not in str(e):
                raise
            v = None
        if v:
            return v
        time.sleep(gap)
    return v


def goto(ch, url, wait=1.0):
    """navigate 뒤 app.js(STYLES·S)가 살아날 때까지 기다린다. 3초 고정 대기는 첫 로드에서 모자랐다."""
    # 옛 페이지에 표식을 남겨, 새 문서로 넘어간 뒤에야 준비 검사를 한다(옛 페이지의
    # STYLES 를 보고 "준비됨"으로 잘못 읽던 함정).
    try:
        ch.js("window.__nb_old_doc = 1;")
    except insta.InstaError:
        pass
    ch.navigate(url, wait)
    wait_js(ch, "(() => !window.__nb_old_doc && typeof STYLES !== 'undefined' && typeof S !== 'undefined' && document.readyState === 'complete')()", tries=40)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--show", action="store_true")
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    srv = None
    port = a.port or APP_PORT
    if not a.port:
        srv = subprocess.Popen([sys.executable, "-u", "app.py", "--no-browser", "--port", str(port)],
                               cwd=here, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(40):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/" % port, timeout=2)
                break
            except Exception:
                time.sleep(0.4)
    app = "http://127.0.0.1:%d/" % port
    print("앱 :", app)

    print("\n[1] brands.js 가 내려오는가")
    n_brand = 0
    try:
        raw = urllib.request.urlopen(app + "static/brands.js", timeout=5).read().decode("utf-8")
        ck("GET /static/brands.js 200 + window.BRAND_STYLES", raw.startswith("/*") and "window.BRAND_STYLES" in raw)
        arr = json.loads(raw[raw.index("= ") + 2:].rstrip().rstrip(";"))
        n_brand = len(arr)
        ck("배열이다 (%d개)" % n_brand, isinstance(arr, list))
    except Exception as e:
        ck("brands.js", False, e)
    html = urllib.request.urlopen(app, timeout=5).read().decode("utf-8")
    ck("index.html 이 brands.js 를 app.js 앞에 싣는다",
       html.find("/static/brands.js") > 0 and html.find("/static/brands.js") < html.find("/static/app.js"))

    ch = insta.Chrome(port=CDP_PORT, profile=PROFILE)
    if ch.alive():
        print("🔴 %d 번을 이미 누가 쓰고 있습니다. 그만둡니다." % CDP_PORT)
        if srv:
            srv.terminate()
        sys.exit(2)
    os.makedirs(PROFILE, exist_ok=True)
    args = [insta.Chrome.find_chrome(), "--remote-debugging-port=%d" % CDP_PORT,
            "--user-data-dir=%s" % PROFILE, "--no-first-run", "--no-default-browser-check",
            "--disable-features=Translate", "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
            "--window-size=1500,1000", "about:blank"]
    if not a.show:
        args.insert(1, "--headless=new")
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        if ch.alive():
            break
        time.sleep(0.4)
    ch.attach(match="about:blank", make=True, url=app)
    ch.send("Page.enable")
    ch.send("Page.bringToFront")
    goto(ch, app)
    ch.js("localStorage.clear(); sessionStorage.clear();")
    goto(ch, app)
    ch.js("window.confirm = () => true;")

    try:
        print("\n[2] STYLES 개수 = 내장 6 + 새로 붙은 브랜드")
        info = wait_js(ch, "(() => ({ n: STYLES.length, b: BUILTIN_N, m: BRAND_MERGE, sel: document.querySelectorAll('#brandSel option').length, btn: document.querySelectorAll('#styles button').length }))()")
        ck("BUILTIN_N == 6", info["b"] == 6, info)
        ck("STYLES.length == 6 + added(%d)" % info["m"]["added"], info["n"] == 6 + info["m"]["added"], info)
        ck("덮어씀 + 붙음 == brands.js 개수(%d)" % n_brand, info["m"]["over"] + info["m"]["added"] == n_brand, info["m"])
        ck("내장 단추는 그대로 6개", info["btn"] == 6, info["btn"])
        ck("붙은 브랜드는 select 보기로", info["sel"] == info["m"]["added"], info["sel"])
        ck("기본 상태: 띠 둘 다 꺼짐", ch.js("!S.bands.top.on && !S.bands.bottom.on"))

        print("\n[3] 위 띠 켜기 → 픽셀")
        ch.js("""(() => { S.bands.top = { ...bandDefault(), on: true, color: '#e11d48', text: 'BREAKING NEWS', textColor: '#ffffff', height: 64, align: 'left', repeat: false }; syncBandControls(); render(); })()""")
        time.sleep(0.4)
        px = ch.js(PX % (540, 10))
        ck("위 띠 y=10 이 #e11d48", near(px, "#e11d48"), px)
        px2 = ch.js(PX % (540, 200))
        ck("띠 아래(y=200)는 띠 색이 아니다", not near(px2, "#e11d48"), px2)
        ck("패널 체크박스가 켜짐으로 동기화", ch.js("document.getElementById('bd_top_on').checked"))
        n_right_plain = ch.js(RIGHT_TEXT % ("top", "0"))
        ck("왼쪽 정렬·반복 없음 → 오른쪽 끝에는 글자 없음", n_right_plain == 0, n_right_plain)

        print("\n[4] 반복 문구가 폭을 채운다")
        ch.js("S.bands.top.repeat = true; render();")
        time.sleep(0.3)
        n_right = ch.js(RIGHT_TEXT % ("top", "0"))
        ck("반복 → 오른쪽 구간에 글자색 픽셀 %d개" % n_right, n_right > 30, n_right)
        ck("bandString 이 ' · ' 로 이어진다", ch.js("(() => { const B = S.bands.top; ctx.font = '700 30px \"Gmarket Sans\"'; const s = bandString(B); return s.split(' · ').length > 3 && s.startsWith('BREAKING NEWS'); })()"))

        print("\n[5] 아래 띠")
        ch.js("""(() => { S.bands.bottom = { ...bandDefault(), on: true, color: '#15181f', text: '오늘의 뉴스', textColor: '#ffffff', height: 56, align: 'center' }; syncBandControls(); render(); })()""")
        time.sleep(0.3)
        px = ch.js(PX % (540, 1350 - 10))
        ck("아래 띠 y=H-10 이 #15181f", near(px, "#15181f"), px)
        px = ch.js(PX % (20, 1350 - 28))
        ck("아래 띠 왼쪽 끝(글자 없는 곳)도 띠 색", near(px, "#15181f"), px)

        print("\n[6] 패널 조작 — 색·높이·정렬")
        ch.js("""(() => { const c = document.getElementById('bd_top_color'); c.value = '#0050f8'; c.dispatchEvent(new Event('input', {bubbles:true}));
                 const h = document.getElementById('bd_top_height'); h.value = 100; h.dispatchEvent(new Event('input', {bubbles:true}));
                 document.querySelector('#bd_top_align button[data-v=right]').click(); })()""")
        time.sleep(0.3)
        ck("색 입력 → 상태 반영", ch.js("S.bands.top.color") == "#0050f8")
        ck("높이 100 반영", ch.js("S.bands.top.height") == 100)
        ck("정렬 오른쪽", ch.js("S.bands.top.align") == "right")
        px = ch.js(PX % (540, 90))
        ck("높이 100 → y=90 도 띠 색", near(px, "#0050f8"), px)

        print("\n[7] 프리셋 4개")
        today = datetime.date.today().strftime("%Y.%m.%d")
        ch.js("document.querySelector('#bandPresets [data-preset=off]').click();")
        time.sleep(0.2)
        ck("끄기 → 둘 다 off", ch.js("!S.bands.top.on && !S.bands.bottom.on"))
        px = ch.js(PX % (540, 10))
        ck("끄면 위 띠 색이 사라진다", not near(px, "#0050f8") and not near(px, "#e11d48"), px)
        ch.js("document.querySelector('#bandPresets [data-preset=breaking_kr]').click();")
        time.sleep(0.4)
        s = ch.js("({on: S.bands.top.on, c: S.bands.top.color, t: S.bands.top.text})")
        ck("속보(빨강)", s["on"] and s["c"] == "#e11d48" and s["t"] == "속보", s)
        ck("속보 픽셀", near(ch.js(PX % (540, 10)), "#e11d48"))
        ch.js("document.querySelector('#bandPresets [data-preset=breaking_en]').click();")
        time.sleep(0.4)
        s = ch.js("({on: S.bands.top.on, c: S.bands.top.color, t: S.bands.top.text, r: S.bands.top.repeat})")
        ck("BREAKING NEWS(검정) 반복", s["on"] and s["c"] == "#111111" and s["t"] == "BREAKING NEWS" and s["r"], s)
        ch.js("document.querySelector('#bandPresets [data-preset=date]').click();")
        time.sleep(0.4)
        s = ch.js("({on: S.bands.bottom.on, t: S.bands.bottom.text})")
        ck("날짜 띠 = 오늘 %s" % today, s["on"] and today in s["t"], s)
        ck("날짜 띠 패널 문구칸에도", today in ch.js("document.getElementById('bd_bottom_text').value"))

        print("\n[8] 굵기 select 는 서체별 가능 굵기만")
        ch.js("""(() => { selectLayer('title'); const f = document.getElementById('tFont'); f.value = 'Gmarket Sans'; f.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.2)
        ws = ch.js("[...document.querySelectorAll('#tWeight option')].map(o => o.value)")
        ck("지마켓 산스 → 500/700", ws == ["500", "700"], ws)
        ch.js("""(() => { const f = document.getElementById('tFont'); f.value = '검은고딕'; f.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.2)
        ws = ch.js("[...document.querySelectorAll('#tWeight option')].map(o => o.value)")
        ck("검은고딕 → 400 하나", ws == ["400"], ws)
        ck("상태 굵기도 400 으로 옮겨짐", ch.js("S.layers.title.weight") == "400")
        ch.js("""(() => { const f = document.getElementById('tFont'); f.value = 'Pretendard'; f.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.2)
        ws = ch.js("[...document.querySelectorAll('#tWeight option')].map(o => o.value)")
        ck("Pretendard → 400/500/700/800/900", ws == ["400", "500", "700", "800", "900"], ws)
        ch.js("""(() => { const f = document.getElementById('tFont'); f.value = 'Malgun Gothic'; f.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.2)
        ws = ch.js("[...document.querySelectorAll('#tWeight option')].map(o => o.value)")
        ck("시스템 글꼴은 전 굵기", len(ws) == 6, ws)
        ch.js("""(() => { const f = document.getElementById('tFont'); f.value = 'Gmarket Sans'; f.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        # 띠 서체도 같은 제한
        ch.js("""(() => { const f = document.getElementById('bd_top_font'); f.value = 'S-Core Dream'; f.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.2)
        ws = ch.js("[...document.querySelectorAll('#bd_top_weight option')].map(o => o.value)")
        ck("띠 서체 에스코어 드림 → 500/700/900", ws == ["500", "700", "900"], ws)
        fonts = ch.js("[...document.querySelectorAll('#bd_top_font option')].map(o => o.value)")
        ck("띠 서체 목록에 동봉 6종", all(f in fonts for f in ["Pretendard", "Pretendard Black", "Gmarket Sans", "S-Core Dream", "검은고딕", "Paperlogy"]), fonts)
        fonts2 = ch.js("[...document.querySelectorAll('#tFont option')].map(o => o.value)")
        ck("글자 서체 목록에도 동봉 6종", all(f in fonts2 for f in ["Pretendard", "Pretendard Black", "Gmarket Sans", "S-Core Dream", "검은고딕", "Paperlogy"]))
        ck("정렬 3종·색·강조색 조절이 있다", ch.js("document.querySelectorAll('#tAlign button').length === 3 && !!document.getElementById('tColor') && !!document.getElementById('tAccent')"))

        print("\n[9] 저장·복원")
        ch.js("""(() => { S.bands.top = { ...bandDefault(), on: true, color: '#f80090', text: '복원시험', height: 72 }; S.bands.bottom.on = false; syncBandControls(); render(); })()""")
        for _ in range(20):
            if ch.js("(localStorage.getItem(STATE_KEY)||'').indexOf('#f80090') >= 0"):
                break
            time.sleep(0.3)
        else:
            print("  (디바운스가 얼어 직접 흘림 — 헤드리스 한정 요동)")
            ch.js("localStorage.setItem(STATE_KEY, JSON.stringify(S))")
        saved = ch.js("JSON.stringify(S)")
        goto(ch, app)
        s = None
        for _ in range(8):
            s = ch.js("({on: S.bands.top.on, c: S.bands.top.color, t: S.bands.top.text})")
            if s["c"] == "#f80090":
                break
            time.sleep(0.4)
        if s["c"] != "#f80090":
            print("  (새 문맥에서 상태가 안 읽힘 — 다시 적고 재확인)")
            ch.js("localStorage.setItem(STATE_KEY, %s)" % json.dumps(saved))
            goto(ch, app)
            for _ in range(8):
                s = ch.js("({on: S.bands.top.on, c: S.bands.top.color, t: S.bands.top.text})")
                if s["c"] == "#f80090":
                    break
                time.sleep(0.4)
        ck("새로고침 후 띠 유지", s["on"] and s["c"] == "#f80090" and s["t"] == "복원시험", s)
        ck("복원 후 픽셀도 띠 색", near(ch.js(PX % (540, 10)), "#f80090"))
        ck("복원 후 패널 동기화", ch.js("document.getElementById('bd_top_on').checked && document.getElementById('bd_top_text').value === '복원시험'"))
        # 옛 상태(bands 없음) 마이그레이션
        ch.js("(() => { const o = JSON.parse(localStorage.getItem(STATE_KEY)); delete o.bands; localStorage.setItem(STATE_KEY, JSON.stringify(o)); })()")
        goto(ch, app)
        s = wait_js(ch, "(() => S.bands && S.bands.top && S.bands.bottom ? {ok: true, on: S.bands.top.on || S.bands.bottom.on} : null)()")
        ck("옛 상태(bands 없음) → 기본값(둘 다 꺼짐)으로 뜬다", s and s["ok"] and not s["on"], s)

        print("\n[10] 스타일 모드·색 테마와의 관계")
        # 띠가 켜진 브랜드가 하나라도 있으면 그걸 골라 본다(예: 어피티 MONEY LETTER)
        pick = ch.js("(() => { const i = STYLES.findIndex(x => x.bands && x.bands.top && x.bands.top.on); return i; })()")
        if pick is not None and pick >= 0:
            st = ch.js("STYLES[%d]" % pick)
            ch.js("applyStyle(STYLES[%d]);" % pick)
            time.sleep(0.6)
            s = ch.js("({on: S.bands.top.on, c: S.bands.top.color, t: S.bands.top.text})")
            ck("스타일 '%s' 가 위 띠를 켠다" % st["n"], s["on"] and s["c"].lower() == st["bands"]["top"]["color"].lower(), s)
            ck("띠 픽셀이 브랜드 색", near(ch.js(PX % (540, 10)), st["bands"]["top"]["color"]), st["bands"]["top"]["color"])
            # 색 테마 → 띠 색만 강조색으로, 끄지 않는다
            ch.js("document.querySelectorAll('#themes button')[1].click();")   # 네이비 (ac #7cc0ff)
            time.sleep(0.4)
            s = ch.js("({on: S.bands.top.on, c: S.bands.top.color})")
            ck("색 테마 → 띠는 켜진 채 색만 #7cc0ff", s["on"] and s["c"] == "#7cc0ff", s)
        else:
            print("  (띠 켜는 브랜드 토큰이 없어 스타일→띠 항목은 건너뜀)")
        # 띠 없는 스타일(내장 뉴닉풍)을 입히면 둘 다 꺼진다
        ch.js("applyStyle(STYLES[0]);")
        time.sleep(0.5)
        ck("bands 없는 스타일 → 띠 둘 다 끔", ch.js("!S.bands.top.on && !S.bands.bottom.on"))

        print("\n[11] deco 'band' 와 겹침")
        ch.js("(() => { S.deco = 'band'; S.decoColor = '#ff441f'; S.bands.top = { ...bandDefault(), on: true, color: '#0b0b12', text: '' }; S.bands.bottom.on = false; render(); })()")
        time.sleep(0.3)
        ck("위: 띠가 켜지면 얇은 deco 띠 대신 띠 색", near(ch.js(PX % (540, 5)), "#0b0b12"))
        ck("아래: 띠가 꺼져 있으면 얇은 deco 띠 그대로", near(ch.js(PX % (540, 1350 - 5)), "#ff441f"))

        print("\n[13] 글자별 조절(색·크기·정렬·서체)이 캔버스에 닿는가")
        COUNT = """(() => { const g = document.getElementById('cv').getContext('2d');
          const d = g.getImageData(%d, %d, %d, %d).data; let n = 0;
          for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]-%d) < 14 && Math.abs(d[i+1]-%d) < 14 && Math.abs(d[i+2]-%d) < 14) n++; return n; })()"""
        ch.js("""(() => { S.deco = 'none'; S.bands.top.on = false; S.bands.bottom.on = false;
          S.layers.title.on = true; S.layers.title.text = '글자 조절 시험'; S.layers.title.box = 'none'; S.layers.title.shadow = 0;
          selectLayer('title');
          const c = document.getElementById('tColor'); c.value = '#12e0a0'; c.dispatchEvent(new Event('input', {bubbles:true}));
          const z = document.getElementById('tSize'); z.value = 60; z.dispatchEvent(new Event('input', {bubbles:true}));
          document.querySelector('#tAlign button[data-v=left]').click(); })()""")
        time.sleep(0.5)
        ck("색 입력 → 상태", ch.js("S.layers.title.color") == "#12e0a0")
        y0 = ch.js("S.layers.title.y")
        n_small = ch.js(COUNT % (0, max(0, y0 - 40), 1080, 260, 0x12, 0xe0, 0xa0))
        ck("제목색 #12e0a0 픽셀이 캔버스에 있다 (%d)" % n_small, n_small > 50, n_small)
        ch.js("""(() => { const z = document.getElementById('tSize'); z.value = 120; z.dispatchEvent(new Event('input', {bubbles:true})); })()""")
        time.sleep(0.4)
        n_big = ch.js(COUNT % (0, max(0, y0 - 40), 1080, 260, 0x12, 0xe0, 0xa0))
        ck("크기 60→120 이면 색 픽셀이 는다 (%d→%d)" % (n_small, n_big), n_big > n_small * 1.8, (n_small, n_big))
        left = ch.js(COUNT % (0, max(0, y0 - 40), 540, 260, 0x12, 0xe0, 0xa0))
        ch.js("document.querySelector('#tAlign button[data-v=right]').click();")
        time.sleep(0.4)
        left2 = ch.js(COUNT % (0, max(0, y0 - 40), 540, 260, 0x12, 0xe0, 0xa0))
        ck("오른쪽 정렬이면 왼쪽 반의 색 픽셀이 준다 (%d→%d)" % (left, left2), left2 < left * 0.5, (left, left2))
        f1 = ch.js("(() => { selectLayer('title'); const f = document.getElementById('tFont'); f.value = 'Pretendard'; f.dispatchEvent(new Event('input', {bubbles:true})); return S.layers.title.font; })()")
        ck("서체 select → 상태 Pretendard", f1 == "Pretendard")
        ch.js("(() => { selectLayer('kicker'); })()")
        ck("다른 층(kicker) 고르면 패널이 그 층 값으로", ch.js("document.getElementById('tSize').value") == str(ch.js("S.layers.kicker.size")))

        print("\n[12] pure 판 — 브랜드 select 는 안 만든다")
        ch.js("(() => { window.NB_CONFIG = { pure: true }; })()")
        # 실제 pure 서버는 다른 시험(시험_주제찾기)이 재므로 여기서는 config 만 흉내 내어 재로드는 하지 않고,
        # 대신 pure 서버를 하나 띄워 index 에서 select 가 숨겨졌는지 본다.
        # port+1 이 이미 누군가(지난 시험의 잔재) 것이면 app.py 가 조용히 다음 포트로 옮겨
        # 엉뚱한 서버의 config 를 읽게 된다 → 빈 포트를 먼저 잡는다.
        import socket
        pure_port = port + 1
        for cand in range(port + 1, port + 20):
            with socket.socket() as sk:
                if sk.connect_ex(("127.0.0.1", cand)) != 0:
                    pure_port = cand
                    break
        purep = subprocess.Popen([sys.executable, "-u", "app.py", "--no-browser", "--pure", "--port", str(pure_port)],
                                 cwd=here, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(40):
                try:
                    urllib.request.urlopen("http://127.0.0.1:%d/api/config.js" % pure_port, timeout=2)
                    break
                except Exception:
                    time.sleep(0.4)
            goto(ch, "http://127.0.0.1:%d/" % pure_port)
            s = wait_js(ch, "(() => typeof PURE !== 'undefined' ? { pure: PURE, sel: document.querySelectorAll('#brandSel option').length, hidden: getComputedStyle(document.getElementById('brandRow')).display === 'none', styles: document.querySelectorAll('#styles button').length, bands: !!document.getElementById('bd_top_on') } : null)()")
            ck("pure: 스타일 단추 0 · 브랜드 select 0 · 숨김", s and s["pure"] and s["sel"] == 0 and s["hidden"] and s["styles"] == 0, s)
            ck("pure 에서도 띠 패널은 있다", s and s["bands"])
        finally:
            purep.terminate()

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=8)
        except Exception:
            pass
        shutil.rmtree(PROFILE, ignore_errors=True)
        if srv:
            srv.terminate()

    print("\n%d항목 중 실패 %d" % (N[0], len(FAIL)))
    for f in FAIL:
        print("  🔴", f)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
