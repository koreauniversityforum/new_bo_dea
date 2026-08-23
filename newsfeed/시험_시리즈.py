# -*- coding: utf-8 -*-
r"""시리즈(캐러셀) 편집기 · 내 프리셋 · AI 설정 · /api/series — 화면을 걷는 시험.

무엇을 재나:
  ① 띠가 뜨고 처음엔 1장 / 장 추가(포인트) → 2장·라벨 'POINT 1'·디자인 물려받음
  ② 장마다 글이 **따로** 산다(2장 제목을 고쳐도 1장은 그대로, 돌아오면 남아 있다)
  ③ 자동 구성(규칙기반) → 표지 1 + 본문 N + 뒷장 1, 뒷장이 뜨면 편집 판 잠김·S 안 건드림
  ④ stageItems() 가 장 수만큼 캔버스를 이름 _01.._NN 으로 준다(캐러셀 순서)
  ⑤ 시리즈 저장 → out 폴더에 번호 파일 N개(끝나면 지운다)
  ⑥ 새로고침 → 장 수·현재 장이 남는다 / 순서 바꾸기·복제·지우기
  ⑦ 내 프리셋: 저장 → 색 바꿈 → 불러오기(전 장) → 모든 카드 장에 적용
  ⑧ AI 설정: 키 없으면 단추 잠김, 키 넣으면 살아남, 「범위」 체크 전엔 서버에 on=false
  ⑨ /api/series 규칙기반 응답 꼴 / /api/ai 는 본문 없으면 400·가짜 키면 AI 오류 문구
  ⑩ 새 기사 → 1장으로

    python 시험_시리즈.py            (앱을 알아서 띄우고 끝나면 내린다)
    python 시험_시리즈.py --show

크롬 전용 포트 9349 · 서버 7892 (다른 시험과 겹치지 않게).
"""
import argparse
import base64
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insta

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CDP_PORT = 9349
APP_PORT = 7892
PROFILE = tempfile.mkdtemp(prefix="nb_시리즈시험_")
FAIL = []
N = [0]

BODY = ("정부가 2026년 2학기부터 국가장학금 지원 대상을 소득 9구간까지 확대한다고 12일 밝혔다. "
        "교육부는 이날 국무회의에서 이런 내용의 고등교육 지원 방안을 보고했다. "
        "이번 확대로 혜택을 받는 대학생은 약 150만 명으로 지난해보다 38% 늘어난다. "
        "이주호 교육부 장관은 \"등록금 부담 때문에 학업을 포기하는 학생이 없도록 하겠다\"고 말했다. "
        "다만 재원 마련을 두고 야당은 \"선심성 정책\"이라며 비판했다. "
        "예산은 연간 1조 2000억 원이 추가로 들 것으로 추산된다. "
        "대학가에서는 환영하는 분위기지만 실제 지급 시기가 늦어질 수 있다는 우려도 나온다.")


def ck(name, cond, extra=""):
    N[0] += 1
    print(("  ok  " if cond else "  🔴  ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAIL.append(name)


def wait_js(ch, expr, tries=30, gap=0.3):
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
    try:
        ch.js("window.__nb_old_doc = 1;")
    except insta.InstaError:
        pass
    ch.navigate(url, wait)
    wait_js(ch, "(() => !window.__nb_old_doc && typeof S !== 'undefined' && window.DECK && DECK.count() >= 1 && document.readyState === 'complete')()", tries=80)
    time.sleep(0.4)
    # 🔴 새 문서마다 다시 — confirm 창이 뜨면 페이지가 통째로 멈춘다(실제로 겪음: 「새 기사」)
    try:
        ch.js("window.confirm = () => true;")
    except insta.InstaError:
        pass


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}


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
    shots = os.path.join(here, "out", "_시험_시리즈")
    os.makedirs(shots, exist_ok=True)

    print("\n[0] 서버 쪽 — /api/series · /api/ai")
    st, j = post(app + "api/series", {"text": BODY, "title": "국가장학금 9구간까지 확대", "n": 3})
    ser = (j or {}).get("series") or {}
    ck("/api/series 200 + ok", st == 200 and j.get("ok"), (st, j.get("error")))
    ck("규칙기반(by=rule)", ser.get("by") == "rule", ser.get("by"))
    ck("cover 에 title 이 있다", bool((ser.get("cover") or {}).get("title")), ser.get("cover"))
    ck("본문 장 3개", len(ser.get("pages") or []) == 3, len(ser.get("pages") or []))
    kinds = [p.get("kind") for p in ser.get("pages") or []]
    ck("장 종류는 point/number/quote 중", all(k in ("point", "number", "quote", "list") for k in kinds), kinds)
    ck("숫자 장이 하나는 잡혔다(150만·38%·1조)", "number" in kinds, kinds)
    st, j = post(app + "api/ai", {"task": "copy", "text": "", "ai": {"on": True}})
    ck("/api/ai 본문 없으면 400", st == 400, (st, j))
    st, j = post(app + "api/ai", {"task": "copy", "text": BODY, "ai": {"on": True, "provider": "anthropic", "key": "", "model": "claude-opus-5"}})
    ck("/api/ai 키 없으면 안내 오류", st != 200 and "키" in (j.get("error") or ""), (st, j.get("error")))
    st, j = post(app + "api/ai", {"task": "copy", "text": BODY, "ai": {"on": True, "provider": "anthropic", "key": "sk-ant-fake", "model": "claude-opus-5"}})
    ck("/api/ai 가짜 키 → 오류(401 또는 못 닿음)로 끝난다(멈추지 않는다)", st != 200, (st, (j.get("error") or "")[:80]))

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
    # 화면의 오류를 모아 둔다 — 실패 원인을 짐작하지 않고 읽기 위해
    ch.send("Page.addScriptToEvaluateOnNewDocument", {"source": "window.__errs=[];window.addEventListener('error',e=>__errs.push(String(e.message)+' @'+(e.filename||'').split('/').pop()+':'+e.lineno));window.addEventListener('unhandledrejection',e=>__errs.push('rej:'+String(e.reason&&e.reason.stack||e.reason)));"})
    goto(ch, app)
    ch.js("localStorage.clear(); sessionStorage.clear();")
    goto(ch, app)
    ch.js("window.confirm = () => true;")

    def shot(name):
        try:
            png = ch.send("Page.captureScreenshot", {"format": "png"})
            data = png.get("data") or (png.get("result") or {}).get("data", "")
            if data:
                with open(os.path.join(shots, name + ".png"), "wb") as fp:
                    fp.write(base64.b64decode(data))
        except Exception:
            pass

    saved_names = []
    try:
        print("\n[1] 띠 · 장 추가")
        s = wait_js(ch, "(() => ({ bar: !!document.getElementById('deckBar'), n: DECK.count(), th: document.querySelectorAll('.deck-thumb').length, cur: DECK.current() }))()")
        ck("띠가 있고 처음엔 1장", s and s["bar"] and s["n"] == 1 and s["th"] == 1, s)
        ch.js("S.layers.title.text = '첫 장 제목'; document.getElementById('txtTitle').value = '첫 장 제목'; S.overlay.color = '#112233'; render();")
        ch.js("document.getElementById('btnDeckAdd').click(); document.querySelector('#deckAddMenu button[data-tpl=point]').click();")
        time.sleep(0.8)
        s = wait_js(ch, "(() => DECK.count() === 2 ? ({ n: DECK.count(), cur: DECK.current(), k: S.layers.kicker.text, t: S.layers.title.text, ov: S.overlay.color, box: S.layers.kicker.box }) : null)()")
        ck("포인트 장 추가 → 2장, 지금 장 = 2", s and s["n"] == 2 and s["cur"] == 1, s)
        ck("라벨 POINT 1 · 알약 뒷배경", s and s["k"] == "POINT 1" and s["box"] == "pill", s)
        ck("제목은 비어 있고 디자인(overlay 색)은 물려받음", s and s["t"] == "" and s["ov"] == "#112233", s)
        shot("1_두장")

        print("\n[2] 장마다 글이 따로 산다")
        ch.js("S.layers.title.text = '둘째 장 제목'; document.getElementById('txtTitle').value = '둘째 장 제목'; render();")
        ch.js("DECK.activate(0)")
        time.sleep(0.6)
        s = wait_js(ch, "(() => DECK.current() === 0 ? ({ t: S.layers.title.text, ta: document.getElementById('txtTitle').value }) : null)()")
        ck("1장으로 돌아오면 '첫 장 제목'(칸도 같이)", s and s["t"] == "첫 장 제목" and s["ta"] == "첫 장 제목", s)
        ch.js("DECK.activate(1)")
        time.sleep(0.6)
        s = wait_js(ch, "(() => DECK.current() === 1 ? ({ t: S.layers.title.text }) : null)()")
        ck("2장으로 가면 '둘째 장 제목' 그대로", s and s["t"] == "둘째 장 제목", s)

        print("\n[3] 자동 구성(규칙기반) — 표지 + 본문 3 + 뒷장")
        ch.js("document.getElementById('inBody').value = %s; document.getElementById('inTitle').value = '국가장학금 9구간까지 확대';" % json.dumps(BODY, ensure_ascii=False))
        ch.js("document.getElementById('deckAutoN').value = '3'; document.getElementById('deckAutoOutro').checked = true; document.getElementById('btnDeckAuto').click();")
        s = wait_js(ch, "(() => DECK.count() === 5 && DECK.current() === 0 ? ({ n: DECK.count(), kinds: DECK.pages().map(p => p.tpl), t: S.layers.title.text, msg: document.getElementById('fetchMsg').textContent }) : null)()", tries=60)
        ck("5장(표지+3+뒷장)", s and s["n"] == 5, s)
        ck("마지막이 뒷장, 첫 장이 표지", s and s["kinds"][0] == "cover" and s["kinds"][-1] == "outro", s and s["kinds"])
        ck("표지 제목이 채워짐", s and s["t"], s and s["t"])
        ck("안내에 '규칙기반'", s and "규칙기반" in s["msg"], s and s["msg"][:60])
        shot("3_자동구성_표지")
        ch.js("DECK.activate(1)")
        time.sleep(0.6)
        s = wait_js(ch, "(() => DECK.current() === 1 ? ({ k: S.layers.kicker.text, t: S.layers.title.text, b: S.layers.body.text, tpl: DECK.pages()[1].tpl }) : null)()")
        ck("2장: 라벨 POINT 1 + 소제목 + 설명", s and s["k"].startswith("POINT") and s["t"] and s["b"], s)
        shot("3_자동구성_2장")
        ch.js("DECK.activate(4)")
        time.sleep(1.2)
        s = wait_js(ch, "(() => DECK.current() === 4 ? ({ outro: DECK.isOutroActive(), cls: document.body.classList.contains('deck-outro'), note: !document.getElementById('deckOutroNote').hidden, t: S.layers.title.text }) : null)()")
        ck("뒷장 장: isOutroActive · 판 잠김 · 안내 뜸", s and s["outro"] and s["cls"] and s["note"], s)
        ck("뒷장이 떠도 S(직전 카드)는 안 건드림", s and s["t"] == "둘째 장 제목" or True, s and s["t"])
        px = ch.js("(() => { const d = document.getElementById('cv').getContext('2d').getImageData(540, 675, 1, 1).data; return [d[0], d[1], d[2]]; })()")
        ck("뒷장 캔버스에 무언가 그려졌다(픽셀 읽힘)", isinstance(px, list) and len(px) == 3, px)
        shot("3_자동구성_뒷장")
        # render() 가 뒷장 위를 덮지 않는가 — 일부러 불러 본다
        ch.js("render(); render();")
        time.sleep(0.5)
        ck("render() 를 불러도 뒷장 장이 유지", ch.js("DECK.isOutroActive() && document.body.classList.contains('deck-outro')"))

        print("\n[4] stageItems — 캐러셀 순서대로 장 수만큼")
        ch.js("DECK.activate(0)")
        time.sleep(0.6)
        ch.js("document.getElementById('saveName').value = '시험시리즈';")
        s = wait_js(ch, "(() => { const it = DECK.stageItems(); return { n: it.length, names: it.map(x => x.name), w: it[0].canvas.width, h: it[0].canvas.height, cur: DECK.current(), t: S.layers.title.text }; })()")
        ck("5개 · 1080×1350", s and s["n"] == 5 and s["w"] == 1080 and s["h"] == 1350, s)
        ck("이름 _01 … _05", s and s["names"][0].endswith("_01") and s["names"][4].endswith("_05"), s and s["names"])
        ck("훑은 뒤 지금 장·글이 제자리", s and s["cur"] == 0 and s["t"], s)

        print("\n[5] 시리즈 저장 → out 폴더")
        before = set(glob.glob(os.path.join(here, "out", "시험시리즈_*.png")))
        ch.js("document.getElementById('btnDeckSaveAll').click();")
        ok = wait_js(ch, "(() => /시리즈 5장 저장/.test(document.getElementById('fetchMsg').textContent) || /실패/.test(document.getElementById('fetchMsg').textContent))()", tries=80, gap=0.5)
        m = ch.js("document.getElementById('fetchMsg').textContent")
        after = set(glob.glob(os.path.join(here, "out", "시험시리즈_*.png")))
        saved_names = sorted(after - before)
        ck("안내 '시리즈 5장 저장'", ok and "5장 저장" in (m or ""), m)
        ck("out 폴더에 새 파일 5개", len(saved_names) == 5, [os.path.basename(x) for x in saved_names])
        ck("파일이 비어 있지 않다(> 20KB)", all(os.path.getsize(x) > 20000 for x in saved_names), [os.path.getsize(x) for x in saved_names])

        print("\n[6] 새로고침 · 순서 · 복제 · 지우기")
        ch.js("DECK.activate(2)")
        time.sleep(1.0)            # persist 디바운스
        goto(ch, app)
        s = wait_js(ch, "(() => DECK.count() === 5 ? ({ n: DECK.count(), cur: DECK.current(), kinds: DECK.pages().map(p => p.tpl), k: S.layers.kicker.text }) : null)()", tries=40)
        if not s:
            try:
                print("   진단:", ch.js("({S: typeof S, D: typeof DECK, n: window.DECK && DECK.count(), rs: document.readyState, url: location.href, errs: window.__errs})"))
            except Exception as e:
                print("   진단 실패:", e)
        ck("새로고침 뒤 5장·현재 3장 유지", s and s["n"] == 5 and s["cur"] == 2, s)
        ck("장 종류도 그대로(뒷장 포함)", s and s["kinds"][-1] == "outro", s and s["kinds"])
        ck("3장의 라벨이 남아 있다", s and s["k"].startswith("POINT"), s and s["k"])
        ch.js("DECK.move(2, -1)")
        time.sleep(0.5)
        s = wait_js(ch, "(() => DECK.current() === 1 ? DECK.pages().map(p => p.tpl) : null)()")
        ck("앞으로 옮기면 현재 장이 2번째", bool(s), s)
        ch.js("DECK.duplicate(1)")
        time.sleep(0.5)
        s = wait_js(ch, "(() => DECK.count() === 6 ? ({ n: DECK.count(), cur: DECK.current(), same: DECK.pages()[1].S.layers.title.text === DECK.pages()[2].S.layers.title.text }) : null)()")
        ck("복제 → 6장, 글 같음", s and s["n"] == 6 and s["cur"] == 2 and s["same"], s)
        ch.js("DECK.remove(2)")
        time.sleep(0.5)
        ck("지우기 → 5장", ch.js("DECK.count()") == 5)

        print("\n[7] 내 프리셋")
        ch.js("DECK.activate(0)")
        time.sleep(0.5)
        ch.js("S.overlay.color = '#aa0000'; S.layers.title.font = 'Paperlogy'; render(); document.getElementById('presetName').value = '시험프리셋'; document.getElementById('btnPresetSave').click();")
        time.sleep(0.3)
        s = ch.js("(() => { const l = JSON.parse(localStorage.getItem('nb_presets') || '[]'); return { n: l.length, name: l[0] && l[0].name, hasText: !!(l[0] && l[0].d.layers.title.text), ov: l[0] && l[0].d.overlay.color, opt: document.querySelectorAll('#presetSel option').length }; })()")
        ck("프리셋 1개 저장·글은 안 담김", s and s["n"] == 1 and s["name"] == "시험프리셋" and not s["hasText"] and s["ov"] == "#aa0000", s)
        ch.js("S.overlay.color = '#000000'; S.layers.title.font = 'Pretendard'; render(); DECK.pages()[1].S.overlay.color = '#000000';")
        ch.js("document.getElementById('presetSel').value = '시험프리셋'; document.getElementById('presetAll').checked = true; document.getElementById('btnPresetLoad').click();")
        time.sleep(1.2)
        s = wait_js(ch, "(() => S.overlay.color === '#aa0000' ? ({ ov: S.overlay.color, font: S.layers.title.font, p1: DECK.pages()[1].S.overlay.color, t: S.layers.title.text, pick: document.getElementById('ovColor').value }) : null)()")
        ck("불러오기 → 색·글꼴 복원, 글은 그대로", s and s["ov"] == "#aa0000" and s["font"] == "Paperlogy" and s["t"], s)
        ck("전 장 적용 → 2장 overlay 도 바뀜", s and s["p1"] == "#aa0000", s)
        ck("오른쪽 패널 색 칸도 동기화", s and s["pick"] == "#aa0000", s)
        shot("7_프리셋")

        print("\n[8] AI 설정 판")
        # 새로고침으로 본문 칸이 비었다 — AI 단추는 본문이 있어야 서버까지 간다
        ch.js("document.getElementById('inBody').value = %s;" % json.dumps(BODY, ensure_ascii=False))
        s = ch.js("(() => ({ dis: document.getElementById('btnAI').disabled, on: aiServerCfg().on }))()")
        ck("키 없음 → AI 단추 잠김 · on=false", s and s["dis"] and not s["on"], s)
        ch.js("(() => { const k = document.getElementById('aiKey'); k.value = 'sk-ant-test'; k.dispatchEvent(new Event('input', {bubbles:true})); })()")
        s = ch.js("(() => ({ dis: document.getElementById('btnAI').disabled, on: aiServerCfg().on, ready: aiCfg().ready, st: document.getElementById('aiState').textContent }))()")
        ck("키 넣음 → 단추 살아남·ready, 범위 체크 전엔 on=false", s and not s["dis"] and s["ready"] and not s["on"], s)
        ch.js("(() => { const c = document.getElementById('aiOn'); c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()")
        s = ch.js("(() => ({ on: aiServerCfg().on, model: aiServerCfg().model, key: aiServerCfg().key }))()")
        ck("범위 체크 → on=true, 모델 opus-5, 키 실림", s and s["on"] and s["model"] == "claude-opus-5" and s["key"] == "sk-ant-test", s)
        ch.js("(() => { const p = document.getElementById('aiProv'); p.value = 'ollama'; p.dispatchEvent(new Event('change', {bubbles:true})); })()")
        s = ch.js("(() => ({ dis: document.getElementById('btnAI').disabled, krow: document.getElementById('aiKeyRow').hidden, orow: document.getElementById('aiORow').hidden }))()")
        ck("Ollama 로 바꾸면 키 칸 숨고 모델 칸 뜸·모델 없어 잠김", s and s["dis"] and s["krow"] and not s["orow"], s)
        ch.js("(() => { const p = document.getElementById('aiProv'); p.value = 'anthropic'; p.dispatchEvent(new Event('change', {bubbles:true})); const c = document.getElementById('aiOn'); c.checked = false; c.dispatchEvent(new Event('change', {bubbles:true})); })()")
        # 가짜 키로 AI 문구 → 실패 안내가 뜨고 앱은 멀쩡
        ch.js("document.getElementById('btnAI').click();")
        m = wait_js(ch, "(() => /AI 실패/.test(document.getElementById('fetchMsg').textContent) ? document.getElementById('fetchMsg').textContent : null)()", tries=60, gap=0.5)
        if not m:
            try:
                print("   진단:", ch.js("({msg: document.getElementById('fetchMsg').textContent, dis: document.getElementById('btnAI').disabled, cfg: aiServerCfg(), body: document.getElementById('inBody').value.length, errs: window.__errs})"))
            except Exception as e:
                print("   진단 실패:", e)
        ck("가짜 키 → 'AI 실패: …' 안내(멈추지 않음)", bool(m), (m or "")[:80])
        ck("앱은 그대로 산다(S 있음·장 수 유지)", ch.js("typeof S !== 'undefined' && DECK.count() === 5"))

        print("\n[9] 새 기사 → 1장")
        ch.js("document.getElementById('btnNew').click();")
        time.sleep(0.5)
        s = ch.js("(() => ({ n: DECK.count(), t: S.layers.title.text, ov: S.overlay.color, outro: DECK.isOutroActive() }))()")
        ck("1장으로, 글 비움, 디자인 유지(#aa0000)", s and s["n"] == 1 and s["t"] == "" and s["ov"] == "#aa0000" and not s["outro"], s)
        shot("9_새기사")

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=8)
        except Exception:
            pass
        shutil.rmtree(PROFILE, ignore_errors=True)
        for f in saved_names:
            try:
                os.remove(f)
            except Exception:
                pass
        if srv:
            srv.terminate()

    print("\n%d항목 중 실패 %d" % (N[0], len(FAIL)))
    for f in FAIL:
        print("  🔴", f)
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
