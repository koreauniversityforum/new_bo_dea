# -*- coding: utf-8 -*-
"""피드 글 네 가지 글투(폰판 feedstyles.js) 시험.

    python 시험_글투.py

인터넷 없이 돈다. node 로 `폰판_소스/feedstyles.js` 를 불러 결과를 JSON 으로 받아 본다.
(파이썬판 feed.py 와 **같은 뼈대**를 내는지, 글투마다 실제로 달라지는지를 본다.
 두 판이 갈라지면 「정기 뉴스 메이커」의 글만 조용히 낡는다.)
"""
import json
import os
import subprocess
import sys
import tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
JS = os.path.join(BASE, "폰판_소스", "feedstyles.js")

시험 = []


def 확인(이름, 조건, 덧말=""):
    시험.append((이름, bool(조건)))
    print(("  ok " if 조건 else "  ✗  ") + 이름 + ((" — " + str(덧말)) if 덧말 else ""))


ITEMS = [
    {"title": "추석 13대 성수품 16만t 푼다",
     "summary": "추석을 앞두고 사과·배·한우·계란 등 성수품 공급이 평시보다 1.6배 늘어난다.",
     "press": "머니투데이", "url": "https://n.news.naver.com/a/1"},
    {"title": "공무원 3851명 늘린다",
     "summary": "안전·특허·수사 인력을 중심으로 정원을 늘린다.",
     "press": "뉴시스", "url": "https://n.news.naver.com/a/2"},
]
QUOTED = {"quote": "지금은 속도보다 방향이 중요하다",
          "items": [{"press": "조선일보", "title": "가"}, {"press": "중앙일보", "title": "나"},
                    {"press": "한겨레", "title": "다"}]}
본문 = ('김 대표는 회의에서 "지금은 속도보다 방향이 중요하다"고 말했다. '
       "그는 예산 처리 시한을 못 박지는 않았다. 참석자들은 대체로 공감했다고 전했다. "
       "회의는 두 시간 넘게 이어졌고 후속 대책도 논의됐다.")


해요체 = [("법원이 판결했다.", "법원이 판결했어요."), ("수당은 임금이 아니다.", "수당은 임금이 아니에요."),
         ("계획이다.", "계획이에요."), ("문제다", "문제다"), ("회의가 열린다.", "회의가 열린다."),
         ("지급해야 한다.", "지급해야 해요."), ("적용된다.", "적용돼요."), ("근거가 없다.", "근거가 없어요."),
         ("받지 않는다.", "받지 않아요."), ("비용이 많다.", "비용이 많아요."),
         ("부담이 될 전망이다.", "부담이 될 전망이에요."), ('그는 "좋다"', '그는 "좋다"')]


def 돌리기():
    """node 로 feedstyles.js 를 불러 결과를 받아 온다."""
    script = """
const fs = require('fs');
global.window = global;
require(process.argv[2]);
const [items, quoted, body, HAEYO] = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const out = { many: {}, one: {}, quotes: FEEDSTYLES.quotes(body, 3),
              styles: FEEDSTYLES.STYLES.map(s => s.id) };
for (const s of out.styles) {
  out.many[s] = FEEDSTYLES.many(items, s, { date: '2026-09-02', quoted });
  out.one[s] = FEEDSTYLES.one({ title: '김 대표 회의 발언', body: body, press: '연합뉴스' },
                              s, { date: '2026-09-02', quoted });
}
out.nbdCh = {};
for (const c of FEEDSTYLES.CHANNELS) {
  out.nbdCh[c.id] = FEEDSTYLES.one({ title: '[단독] 김 대표 회의 발언', body: body, press: '연합뉴스' }, 'nbd',
    { date: '2026-09-02 10:00', channel: c.id,
      related: [{ press: 'SBS', date: '2024-01-12', body: '본문' }, { press: '제목만', date: '2024-01-13' }] });
}
out.haeyo = HAEYO.map(FEEDSTYLES.haeyo);
out.noQuote = FEEDSTYLES.many(items, 'news', { date: '2026-09-02' });
out.channels = {};
for (const c of FEEDSTYLES.CHANNELS) {
  out.channels[c.id] = FEEDSTYLES.one({ title: '김 대표 회의 발언', body: body, press: '연합뉴스' },
                                      'news', { date: '2026-09-02', quoted, channel: c.id });
}
out.few = FEEDSTYLES.one({ title: 'ㄱ', body: body, press: '연합뉴스' }, 'news',
                         { quoted: { quote: quoted.quote, items: quoted.items.slice(0, 2) } });
process.stdout.write(JSON.stringify(out));
"""
    with tempfile.TemporaryDirectory() as tmp:
        js = os.path.join(tmp, "run.js")
        data = os.path.join(tmp, "data.json")
        with open(js, "w", encoding="utf-8") as f:
            f.write(script)
        with open(data, "w", encoding="utf-8") as f:
            json.dump([ITEMS, QUOTED, 본문, [a for a, _ in 해요체]], f, ensure_ascii=False)
        r = subprocess.run(["node", js, JS, data], capture_output=True, text=True,
                           encoding="utf-8", shell=(os.name == "nt"))
    if r.returncode != 0:
        print("node 실패:\n" + (r.stderr or "")[:800])
        sys.exit(1)
    return json.loads(r.stdout)


def main():
    if not os.path.isfile(JS):
        print("feedstyles.js 가 없습니다: " + JS)
        return 1
    d = 돌리기()

    print("■ 글투 목록")
    확인("글투 여섯 가지가 그대로 있다",
        d["styles"] == ["news", "magazine", "brief", "question", "oneline", "cards", "nbd"], d["styles"])

    print("■ 묶음 글(브리핑 전체)")
    본 = {k: v["text"] for k, v in d["many"].items()}
    묶음뉴보대 = 본.pop("nbd")
    확인("글투마다 글이 다르다", len(set(본.values())) == len(본), len(set(본.values())))
    확인("모든 글에 기사 제목이 들어간다",
        all(ITEMS[0]["title"] in t for t in 본.values()))
    확인("모든 글에 해시태그가 붙는다", all("#뉴스" in t for t in 본.values()))
    확인("모든 글에 안내문이 붙는다", all("※ 원문을" in t for t in 본.values()))
    확인("카드 대사는 장 단위로 나뉜다", "━━ 1장 · 표지 ━━" in 본["cards"])
    확인("짧은 브리핑이 가장 짧다",
        len(본["brief"]) == min(len(t) for t in 본.values()),
        {k: len(v) for k, v in 본.items()})

    print("■ 인용 묶음(같은 발언을 실은 보도)")
    확인("네 글투 모두에 인용이 들어간다", all("🗣" in t for t in 본.values()))
    확인("건수를 적는다", all("보도 3건" in t for t in 본.values()))
    확인("인용이 없으면 인용 절도 없다", "🗣" not in d["noQuote"]["text"])
    확인("3건을 못 채우면 그대로 적는다", "3건을 채우지 못했습니다" in d["few"]["text"])

    print("■ 기사 한 건")
    한 = {k: v["text"] for k, v in d["one"].items()}
    한뉴보대 = 한.pop("nbd")
    확인("글투마다 글이 다르다", len(set(한.values())) == len(한), len(set(한.values())))
    확인("본문에서 문장을 뽑아 쓴다", "속도보다 방향" in 한["news"])
    확인("출처 줄이 붙는다", all("🔗 출처: 연합뉴스" in t for t in 한.values()))

    print("■ 채널(올릴 곳)")
    ch = d["channels"]
    확인("인스타는 손대지 않는다", ch["instagram"]["text"] == d["one"]["news"]["text"])
    확인("스레드는 500자 안", ch["threads"]["chars"] <= 500, ch["threads"]["chars"])
    확인("X 는 280자 안", ch["x"]["chars"] <= 280, ch["x"]["chars"])
    확인("짧은 채널은 출처를 남긴다",
        all("🔗 출처" in ch[c]["text"] for c in ("threads", "x")))
    확인("블로그는 해시태그가 없다", "#" not in ch["blog"]["text"])
    확인("X 는 해시태그를 둘까지", len([w for w in ch["x"]["text"].split() if w.startswith("#")]) <= 2)

    print("■ 뉴보대 형식")
    import feed
    파이썬 = feed.compose({"title": "[단독] 김 대표 회의 발언", "body": 본문, "press": "연합뉴스",
                         "date": "2026-09-02 10:00"},
                        [{"press": "SBS", "date": "2024-01-12", "title": "관련", "body": 본문}], "nbd")
    폰 = d["nbdCh"]["instagram"]["text"]
    for 이름, t in (("앱", 파이썬["text"]), ("폰", 폰)):
        차례 = [t.find(x) for x in ('🤔', '📌 무슨 일이야?', '📊 짚어볼 점', '💬 독자 질문', '출처: ', '#뉴보대')]
        확인(이름 + ": 게시글 차례대로 나온다", -1 not in 차례 and 차례 == sorted(차례), 차례)
        확인(이름 + ": 출처가 매체(날짜) 꼴", "출처: 연합뉴스(2026.09.02), SBS(2024.01.12)" in t)
        확인(이름 + ": 말머리 제거", "[단독]" not in t and "#단독" not in t)
        확인(이름 + ": 초안 안내문·줄표 없음", "※" not in t and "—" not in t)
        확인(이름 + ": 판단 자리는 빈칸", "[기사에 없는 내용이나" in t)
        확인(이름 + ": 태그 13개 이내", len([w for w in t.split() if w.startswith("#")]) <= 13)
    확인("폰: 본문 없는 관련 기사는 출처에 안 넣는다", "제목만" not in 폰)
    확인("묶음 글도 틀을 따른다", "💬 독자 질문" in 묶음뉴보대 and ITEMS[0]["title"] in 묶음뉴보대)
    확인("한 건 글은 다른 글투와 다르다", 한뉴보대 not in 한.values())
    for 채널 in ("threads", "x"):
        c = d["nbdCh"][채널]
        확인(채널 + ": 상한 안 + 출처 유지", c["chars"] <= c["limit"] and "출처: 연합뉴스" in c["text"], c["chars"])
    확인("블로그: 안내문을 새로 붙이지 않는다", "※" not in d["nbdCh"]["blog"]["text"])
    확인("앱 스레드도 출처 유지", "출처: 연합뉴스" in feed.shape(파이썬["text"], 파이썬["hashtags"], "threads"))
    확인("해요체 바꾸기(앱)", [feed.haeyo(a) for a, _ in 해요체] == [b for _, b in 해요체],
        [feed.haeyo(a) for a, _ in 해요체])
    확인("해요체 바꾸기(폰) = 앱", d["haeyo"] == [b for _, b in 해요체], d["haeyo"])
    import ai
    문 = ai._prompt("caption_nbd", "본문", "제목", 3)
    확인("AI 요청문에 틀이 있다", all(x in 문 for x in ("📌 무슨 일이야?", "📊 짚어볼 점", "💬 독자 질문", "출처:")))
    원래 = ai._anthropic
    ai._anthropic = lambda *a: {"texts": [{"style": "x", "text": " 글 "}, {"style": "y", "text": "둘째"}]}
    try:
        확인("AI 결과는 한 편", ai.run("caption_nbd", "가" * 50, "제목", 3, {"key": "k"}) ==
            {"texts": [{"style": "뉴보대 형식", "text": "글"}]})
    finally:
        ai._anthropic = 원래

    print("■ 발언 뽑기 (related.quotes 와 같은 규칙)")
    확인("쌍따옴표 안을 뽑는다", d["quotes"] == ["지금은 속도보다 방향이 중요하다"], d["quotes"])

    실패 = [n for n, ok in 시험 if not ok]
    print("\n%d항목 중 실패 %d" % (len(시험), len(실패)))
    for n in 실패:
        print("  - " + n)
    return 1 if 실패 else 0


if __name__ == "__main__":
    sys.exit(main())
