# -*- coding: utf-8 -*-
"""insta.py 의 위험한 두 가지를 인스타 없이 검증한다.

① DOM.setFileInputFiles 로 **윈도우 파일 선택창을 띄우지 않고** file input 을 채우는가
② __nb 찾기/누르기가 한글 버튼(만들기·다음·공유하기)과 aria-label 을 제대로 집는가
   — 그리고 **없는 버튼은 확실히 실패**하는가(엉뚱한 걸 누르지 않는가)
"""
import json
import os
import sys
import time

NB = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, NB)
sys.stdout.reconfigure(encoding="utf-8")
import insta  # noqa: E402

CARDS = os.path.join(os.path.dirname(NB), "첫게시물")
PAGE = os.path.join(NB, "out", "_시험_insta.html")

HTML = """<!doctype html><meta charset="utf-8"><title>insta 시험</title>
<body style="font:14px sans-serif">
<input type="file" accept="image/*" multiple style="position:absolute;left:-9999px">
<div role="button" aria-label="새로운 게시물 만들기"><span>만들기</span></div>
<button>다음</button>
<div role="button"><span>공유하기</span></div>
<div role="button"><span>삭제</span></div>
<textarea aria-label="문구 입력..."></textarea>
<script>
  window.__log = [];
  document.querySelectorAll('button,div[role=button]').forEach(el=>{
    el.addEventListener('click', ()=>window.__log.push(
      (el.getAttribute('aria-label')||el.innerText||'').trim()));
  });
  document.querySelector('input[type=file]').addEventListener('change', e=>{
    window.__files = Array.from(e.target.files).map(f=>f.name+':'+f.size);
  });
</script>
</body>"""

fails = []


def ck(name, cond, extra=""):
    print(("  통과  " if cond else "  실패  ") + name + (("  " + str(extra)) if extra else ""))
    if not cond:
        fails.append(name)


def main():
    with open(PAGE, "w", encoding="utf-8") as f:
        f.write(HTML)
    url = "file:///" + PAGE.replace("\\", "/")

    ch = insta.Chrome()
    ch.launch(url)
    # 이미 떠 있던 창이면 attach 가 시험 페이지로 옮겨 준다
    ch.attach("_시험_insta", url=url)
    ch.send("Page.enable")
    ch.send("Runtime.enable")
    ch.send("DOM.enable")
    time.sleep(0.6)
    insta._prep(ch)

    print("① 파일 꽂기 (선택창 없이)")
    files = sorted(os.path.join(CARDS, n) for n in os.listdir(CARDS))[:5]
    ck("카드 5장 있음", len(files) == 5, len(files))
    ch.set_files('input[type="file"]', files)
    time.sleep(0.8)
    got = ch.js("JSON.stringify(window.__files||[])")
    got = json.loads(got or "[]")
    ck("input 에 5개가 꽂혔다", len(got) == 5, got[:2])
    ck("크기가 0이 아니다(진짜 파일)", all(int(g.split(":")[-1]) > 1000 for g in got))
    ck("change 이벤트가 떴다(인스타가 이걸로 반응)", bool(got))

    print("② 버튼 찾아 누르기")
    insta._click(ch, ["만들기", "create"], "만들기", wait=0.2)
    insta._click(ch, ["다음", "next"], "다음", wait=0.2)
    insta._click(ch, ["공유하기", "share"], "공유하기", wait=0.2)
    log = json.loads(ch.js("JSON.stringify(window.__log)"))
    ck("aria-label 로 '만들기' 를 집었다", any("새로운 게시물" in x for x in log), log)
    ck("'다음' 을 눌렀다", "다음" in log)
    ck("'공유하기' 를 눌렀다", "공유하기" in log)
    ck("'삭제' 는 안 눌렀다(엉뚱한 클릭 없음)", "삭제" not in log, log)

    print("③ 없는 버튼은 확실히 실패해야 한다")
    try:
        insta._click(ch, ["존재하지않는버튼"], "없는 것", wait=0.1)
        ck("없는 버튼에서 실패한다", False, "조용히 통과해 버렸다")
    except insta.InstaError as e:
        ck("없는 버튼에서 실패한다", True)
        ck("실패 메시지에 화면에 보인 것들이 담긴다", "공유하기" in str(e), str(e)[:80])

    print("④ 문구 입력")
    cap = "가나다\n둘째 줄 " + "긴글" * 300
    wrote = ch.js("""(function(c){
      const t=document.querySelector('textarea[aria-label*="문구"]');
      if(!t) return false; t.focus();
      const d=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
      d.set.call(t,c); t.dispatchEvent(new Event('input',{bubbles:true})); return true;})(%s)"""
                 % json.dumps(cap, ensure_ascii=False))
    ck("입력 성공", wrote is True)
    back = ch.js("document.querySelector('textarea').value")
    ck("한글·줄바꿈·긴 글이 그대로 들어갔다", back == cap,
       "len %d vs %d" % (len(back or ""), len(cap)))

    ch.close()
    print()
    if fails:
        print("실패 %d개: %s" % (len(fails), fails))
        sys.exit(1)
    print("전부 통과")


if __name__ == "__main__":
    main()
