# -*- coding: utf-8 -*-
"""인스타 피드에 올릴 글(캡션) 만들기 — 규칙 기반, 외부 패키지 없음.

기준 기사 본문에서 뽑은 문장 + 같은 시각대의 유사 기사 제목 목록을 엮어
바로 붙여넣을 수 있는 초안을 만든다.

**중요** — 요약 문장은 원문에서 뽑아낸(발췌) 것이지 새로 쓴 글이 아니다.
그대로 올리면 언론사 문장을 그대로 옮기는 셈이 되므로, 초안은 어디까지나
'뼈대'로 쓰고 본인 말로 고쳐 쓰는 것을 전제로 한다. 그래서 출처 표기 줄을
항상 붙이고, 발췌 문장에는 표시를 남긴다.
"""
from __future__ import annotations

import re

import extractor
import summarizer

STYLES = [
    {"id": "news", "name": "뉴스 전달형", "note": "무슨 일인지 → 왜 중요한지 순서. 시사 계정 기본형."},
    {"id": "magazine", "name": "매거진형", "note": "문장을 이어 쓰는 에세이 톤. 기획·주간 정리에 어울림."},
    {"id": "brief", "name": "짧은 브리핑", "note": "3줄 요약 + 해시태그. 스토리·릴스 설명에."},
    {"id": "cards", "name": "카드 대사 뽑기",
     "note": "카드 한 장씩 넣을 문구를 장 단위로. 앞장 만들기에 그대로 옮겨 쓰는 용."},
]


# ── 재료 ───────────────────────────────────────────────────────────────────
# 기사 첫 문장에 붙는 발신지·바이라인. 그대로 두면 캡션이 "김OO 특파원 =" 으로 시작한다.
BYLINE = re.compile(
    r"^\s*(\([^)]{2,30}\)\s*)?"                       # (서울=연합뉴스)
    r"([가-힣]{2,4}\s*(?:특파원|기자|앵커|논설위원|선임기자)\s*[=＝·]\s*)*")


def _clean_sent(s: str) -> str:
    s = BYLINE.sub("", s or "").strip()
    s = re.sub(r"^[=＝·\-–\s]+", "", s)
    # '…말했다.도시재생 기조에…' 처럼 마침표 뒤에 붙어 온 소제목을 잘라낸다
    m = re.search(r"다\.(?=[가-힣])", s)
    if m:
        s = s[:m.end() - 1]
    return s.strip()


def _sents(body: str, title: str, n: int, limit: int = 120):
    """본문에서 **서로 다른** 문장 n개를 원문 순서대로 뽑는다.

    summarizer.summarize() 는 카드 한 줄용이라 '핵심 n문장 / 리드 / 인용' 같은
    서로 겹치는 후보를 최대 4개만 준다. 피드 글은 여러 문단이 필요하므로
    문장 순위(rank_sentences)를 직접 써서 중복 없이 뽑아야 한다.
    """
    ranked = summarizer.rank_sentences(body, title)
    if ranked:
        allsents = summarizer.sentences(body)
        order = {s: i for i, s in enumerate(allsents)}
        top = [s for s, _ in ranked[:max(n * 2, n + 3)]]
        top.sort(key=lambda s: order.get(s, 10 ** 6))   # 읽는 순서대로 되돌린다
        squeeze = getattr(summarizer, "_compress", lambda s, L: s[:L])
        out = [squeeze(s, limit) for s in top]
    else:
        out = summarizer.summarize(body, title, limit=limit, n=n + 2)
        if isinstance(out, str):
            out = [s for s in out.split("\n") if s.strip()]
    rows = [_clean_sent(s) for s in out]
    rows = [s for s in rows if len(s) >= 10]
    # 본문 정리를 통과하고도 문장에 붙어 들어온 코너 소개·구독 유도를 여기서 한 번 더 턴다.
    # (실측: 경인일보 "…정책 경쟁을 조명합니다" 가 '다른 매체가 짚은 대목'으로 올라갔다)
    rows = [s for s in rows if not extractor.PROMO_LINE.search(s)]
    body_only = [s for s in rows if not summarizer.is_deck(s)]
    if len(body_only) >= 2:                   # 부제는 제목과 겹치므로 되도록 뺀다
        rows = body_only
    # 부제는 '…한 듯', '…에 반발' 처럼 서술어 없이 끝난다. 남았다면 뒤로 민다.
    decky = lambda s: len(s) < 60 and s.rstrip()[-1:] not in '다.?!"\'’”…)'
    rows = [s for s in rows if not decky(s)] + [s for s in rows if decky(s)]
    seen, uniq = set(), []
    for s in rows:
        k = re.sub(r"\W", "", s)[:24]
        if k and k not in seen:
            seen.add(k)
            uniq.append(s)
    return uniq[:n]


# 해시태그로 나가면 곤란한 토막들(조사가 붙었거나 뜻이 없는 것)
TAG_STOP = {"명이", "이번", "지난", "오늘", "관련", "대해", "위해", "통해", "대한",
            "것으로", "있다", "없다", "했다", "밝혔", "따르", "지난해", "올해",
            "라고", "하는", "된다", "이다", "당시", "현재", "경우", "가운데"}


def hashtags(title: str, body: str, related=None, n: int = 10):
    words = summarizer.keywords((title or "") + " " + (body or ""), n * 3)
    for r in (related or [])[:6]:
        words += summarizer.keywords(r.get("title", ""), 3)
    tags, seen = [], set()
    for w in words:
        w = re.sub(r"[^0-9A-Za-z가-힣]", "", w)
        if len(w) < 2 or w in seen or w.isdigit():
            continue
        if w in TAG_STOP or w in getattr(summarizer, "STOP", ()):
            continue
        if re.search(r"\d", w) and len(w) <= 3:      # '7명', '3년' 같은 토막
            continue
        # '년까지', '에서는' 처럼 조사·어미가 붙은 채 잘린 낱말
        if re.search(r"(까지|부터|에서|에게|보다|처럼|만큼|이라|라며|면서|하며|"
                     r"으로|에는|과의|와의|들이|들은|들을)$", w):
            continue
        seen.add(w)
        tags.append("#" + w)
        if len(tags) >= n:
            break
    return tags


def _nice_date(s: str) -> str:
    """'20260807163851' / '2026-08-07T16:08:41+09:00' 을 사람이 읽는 꼴로."""
    s = (s or "").strip()
    if re.fullmatch(r"\d{14}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]} {s[8:10]}:{s[10:12]}"
    if re.fullmatch(r"\d{8}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return s[:16].replace("T", " ")


def _source_line(press: str, title: str, date: str, url: str = "") -> str:
    bits = [b for b in (press.strip(), f"「{title.strip()}」" if title.strip() else "") if b]
    line = "🔗 출처: " + " ".join(bits) if bits else "🔗 출처: 원문 기사"
    d = _nice_date(date)
    if d:
        line += f" ({d})"
    return line


def cross(main_body: str, main_title: str, related, n_common: int = 4, n_diff: int = 6):
    """관련 기사의 **본문이 있을 때만** 돌아가는 교차 정리.

    - 공통: 여러 기사에 함께 나온 낱말 (여러 매체가 같이 짚은 사실)
    - 차이: 기준 기사에는 없고 그 매체만 다룬 문장

    본문 없이 제목만 있는 항목은 여기에 끼지 않는다(제목만으로 '공통 사실'을
    말하면 없는 내용을 지어내는 셈이 되므로).
    """
    withbody = [r for r in (related or []) if (r.get("body") or "").strip()]
    if not withbody:
        return {"common": [], "diff": [], "used": 0}

    main_tok = set(summarizer.tokens(main_body + " " + main_title))
    # 어느 낱말이 몇 개 매체에 나왔나
    seen_in = {}
    for r in withbody:
        for w in set(summarizer.keywords(r["body"], 25)):
            seen_in[w] = seen_in.get(w, 0) + 1
    common = [w for w, c in sorted(seen_in.items(), key=lambda kv: (-kv[1], kv[0]))
              if c >= max(2, (len(withbody) + 1) // 2) and len(w) >= 2][:n_common * 3]

    # 공통 낱말이 가장 많이 든 문장을 기준 기사에서 뽑는다
    common_rows = []
    if common:
        for s in _sents(main_body, main_title, 6, limit=180):
            hit = sum(1 for w in common if w in s)
            if hit >= 2:
                common_rows.append((hit, s))
        common_rows.sort(key=lambda x: -x[0])
    common_rows = [s for _, s in common_rows[:n_common]]

    # 매체별로 '기준 기사에 없던' 문장. 기사가 적으면 한 곳에서 두 줄까지 뽑는다.
    per = 2 if len(withbody) <= 2 else 1
    diff, seen_d = [], set()
    for r in withbody[:n_diff]:
        picks = []
        for s in _sents(r["body"], r.get("title", ""), 7, limit=170):
            tk = set(summarizer.tokens(s))
            if not tk or len(s) < 20:
                continue
            new = len(tk - main_tok) / len(tk)
            k = re.sub(r"\W", "", s)[:24]
            if new >= 0.35 and k not in seen_d:
                picks.append((new, s, k))
        picks.sort(key=lambda x: -x[0])
        for _, s, k in picks[:per]:
            seen_d.add(k)
            diff.append(f"· {r.get('press') or '다른 매체'} — {s}")
    return {"common": common_rows, "diff": diff,
            "used": len(withbody), "words": common[:n_common * 2]}


def quote_block(main_body: str, main_title: str, related, n_show: int = 6) -> dict:
    """**같은 발언(쌍따옴표)을 인용한** 기사들을 한 덩어리로 정리한다.

    2026-09-02 요구: "인용한 쌍따옴표 내부 문장이 같은 기사들을 3개 이상 요약해서
    동일한 맥락으로 피드 글을 작성". 낱말이 비슷한 기사는 주제만 같을 수 있지만,
    같은 발언을 글자 그대로 옮긴 기사는 **같은 사안**이 거의 확실하다. 그래서 이
    묶음을 따로 세워 캡션의 맥락을 여기에 맞춘다.

    related 항목은 `related.find()` 가 붙여 준 `by_quote` 표시로 가른다.
    """
    rows = [r for r in (related or []) if r.get("by_quote")]
    말 = ""
    for r in rows:
        말 = (r.get("quote") or "").strip()
        if 말:
            break
    if not 말:
        말 = (related_quotes(main_body) or [""])[0]

    presses, lines, seen = [], [], set()
    for r in rows[:n_show]:
        p = (r.get("press") or "").strip() or "(언론사 미상)"
        if p not in presses:
            presses.append(p)
        t = (r.get("title") or "").strip()
        k = re.sub(r"\W", "", t)[:24]
        if not t or k in seen:
            continue
        seen.add(k)
        표 = " ✔" if r.get("quote_ok") else ""          # 본문에서 그 발언을 실제로 확인
        lines.append(f"· {p} — {t}{표}")

    cx = cross(main_body, main_title, rows, n_common=3, n_diff=4)
    return {"quote": 말, "n": len(rows), "presses": presses, "lines": lines,
            "common": cx["common"], "diff": cx["diff"], "bodies": cx["used"],
            "enough": len(rows) >= 3}


def _quote_section(qb: dict, short: bool = False) -> list:
    """캡션에 넣을 인용 묶음. 건수가 모자라면 **모자란 대로** 적는다(부풀리지 않는다)."""
    if not qb or not qb["n"]:
        return []
    말 = qb["quote"]
    머리 = (f'🗣 “{말}”' if 말 else "🗣 같은 발언을 실은 보도")
    셈 = f'이 발언을 그대로 실은 보도 {qb["n"]}건' + \
        (f' · {" · ".join(qb["presses"][:4])}' if qb["presses"] else "")
    if short:                                   # 짧은 브리핑·표지용 - 두 줄까지만
        L = ["", 머리, 셈]
        if qb["common"]:
            L.append(f'· {qb["common"][0]}')
        return L

    L = ["", 머리, 셈]
    if not qb["enough"]:
        L.append("(3건을 채우지 못했습니다 — 같은 발언을 실은 기사가 이만큼만 잡혔습니다)")
    L += qb["lines"]
    if qb["common"]:
        L += ["", "— 이 보도들이 함께 짚은 맥락"] + [f"· {s}" for s in qb["common"]]
    if qb["diff"]:
        L += ["", "— 매체마다 다르게 덧붙인 대목"] + qb["diff"]
    return L


def related_quotes(body: str, n: int = 3) -> list:
    """발언 뽑기는 related 쪽에 있다. feed 는 검색 모듈에 기대지 않는 것이 원칙이라
    맨 위에서 import 하지 않고 필요할 때만 빌려 쓴다(없어도 캡션은 나와야 한다)."""
    try:
        import related as _r
        return _r.quotes(body, n)
    except Exception:
        return []


# 우리 계정의 시각은 프로그램이 지어낼 수 없다. 빈칸으로 남겨 두고 표시한다.
MINE = "[여기에 우리 계정의 시각을 한두 문장 덧붙이세요]"

STYLE_TITLE_NOTE = {
    "news": "사실 그대로 — 누가 무엇을 했는지",
    "magazine": "기획 톤 — 묻고 들여다보는 말투",
    "brief": "짧고 굵게 — 14자 안팎",
    "cards": "표지 후킹 — 넘겨보게 만드는 한 줄",
}


def title_ideas(title: str = "", body: str = "", style: str = "news", n: int = 6):
    """글투에 맞는 제목 후보를 **최소 5개** 돌려준다.

    재료는 전부 기사에서 뽑은 것(주체·사건·핵심 낱말)이다. 글투에 맞춰 **말투만**
    바꿀 뿐 없는 사실을 지어내지 않는다. 고르는 것도 고치는 것도 사람 몫이라
    후보는 넉넉히 주고 판단은 넘긴다.
    """
    title = (title or "").strip()
    body = (body or "").strip()
    squeeze = getattr(summarizer, "_compress", lambda s, L: s[:L])

    facts = [t for t in summarizer.titles(body, title) if t]
    hooked = [h for h in summarizer.hooks(body, title) if h]
    tp = summarizer.topic_words(title + " " + body, 6)
    k0 = tp[0] if tp else (title[:8] or "이번 사안")
    k1 = tp[1] if len(tp) > 1 else k0
    k2 = tp[2] if len(tp) > 2 else k1
    j = summarizer.josa                          # 받침에 맞는 조사

    if style == "brief":
        cands = [squeeze(t, 14) for t in facts]
        cands += [f"{k0} {k1}", f"{k0}, 무슨 일", f"{k0} 한눈에", f"{k0} 3줄 정리",
                  f"{k0}, 이렇게 바뀐다"]
    elif style == "magazine":
        cands = [f"{k0}, 다시 묻는다", f"{k0}의 안쪽", f"{k0}, 무엇이 남았나",
                 f"{k0}{j(k0, ('과', '와'))} {k1} 사이", f"{k0}, 그 다음은"]
        cands += [squeeze(t, 30) for t in facts]
    elif style == "cards":
        cands = hooked[:4]
        cands += [squeeze(t, 22) for t in facts]
        cands += [f"{k0}, 알고 계셨나요", f"{k0}{j(k0, ('은', '는'))} 지금 이렇습니다",
                  f"{k0}, 정리했습니다"]
    else:                                        # news
        cands = [squeeze(t, 28) for t in facts]
        cands += [f"{k0}, {k1} 어떻게 되나", f"{k0}, 이렇게 바뀐다", f"{k0}·{k1} 쟁점은"]
        cands += hooked[:2]

    if title:
        cands.append(squeeze(re.sub(r"^\[[^\]]*\]\s*", "", title), 30))
    # 그래도 모자라면 핵심 낱말 조합으로 채운다(5개는 반드시 준다)
    cands += [f"{k0}, {k1}", f"{k1}{j(k1, ('과', '와'))} {k2}", f"{k0} {k1} {k2}"]

    out, seen = [], set()
    for c in cands:
        c = re.sub(r"\s{2,}", " ", (c or "")).strip(" ,·")
        key = re.sub(r"[^0-9A-Za-z가-힣]", "", c)
        if len(key) < 4 or key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out[:max(n, 5)]


def _card_rows(body: str, title: str, n: int = 4):
    """카드 한 장에 들어갈 (제목, 요약문) 짝.

    한 장에 **서로 다른 두 문장**을 쓴다 — 앞 문장은 제목투로 줄여 큰 글씨 자리에,
    뒤 문장은 그대로 아래 설명 자리에. 한 문장을 제목과 요약문에 겹쳐 쓰면
    카드가 같은 말을 두 번 하게 된다.

    제목투로 줄이는 일은 summarizer 의 `_headline_from()` 이 한다. 그게 빈손이면
    문장 앞부분만 잘라 쓴다 — 어느 쪽이든 **원문 발췌**이지 지어낸 말이 아니다.
    """
    head_of = getattr(summarizer, "_headline_from", None)
    squeeze = getattr(summarizer, "_compress", lambda s, L: s[:L])
    sents = _sents(body, title, n * 2, limit=150)
    rows = []
    for i in range(0, len(sents), 2):
        s = sents[i]
        head = ""
        if head_of:
            try:
                # 카드 제목은 두 줄까지 들어가므로 30자쯤 잡는다
                head = re.sub(r"\s{2,}", " ", head_of(s, 30) or "").strip(" ,·")
            except Exception:
                head = ""
        if len(re.sub(r"[^0-9A-Za-z가-힣]", "", head)) < 5:
            head = squeeze(s, 30)
        sub = squeeze(sents[i + 1], 90) if i + 1 < len(sents) else ""
        rows.append((head, sub))
        if len(rows) >= n:
            break
    return rows


def _others(related, n=4):
    rows = []
    for r in (related or [])[:n]:
        t = r.get("title", "").strip()
        if not t:
            continue
        p = (r.get("press") or "").strip()
        when = (r.get("date") or "")[5:16]        # MM-DD HH:MM
        rows.append(f"· {p} — {t}" + (f" ({when})" if when else ""))
    return rows


# ── 본체 ───────────────────────────────────────────────────────────────────
def compose(main: dict, related=None, style: str = "news") -> dict:
    title = (main.get("title") or "").strip()
    body = (main.get("body") or "").strip()
    press = (main.get("press") or "").strip()
    date = (main.get("date") or "").strip()
    url = (main.get("url") or "").strip()
    related = related or []

    an = summarizer.analyze(body, title) if body else {}
    hook = (an.get("hooks") or [""])[0]
    head = (an.get("titles") or [title])[0] or title
    tags = hashtags(title, body, related)
    others = _others(related)
    cx = cross(body, title, related)          # 본문이 있는 관련 기사만 쓴다
    qb = quote_block(body, title, related)     # 같은 발언을 인용한 기사 묶음
    qs = _quote_section(qb)
    src = _source_line(press, title, date, url)
    note = "※ 원문을 요약·재구성한 초안입니다. 올리기 전에 사실관계와 표현을 확인하세요."

    L = []
    if style == "brief":
        L = [title or head, ""]
        for s in _sents(body, title, 3, limit=130):
            L.append(f"· {s}")
        L += _quote_section(qb, short=True)
        if others and not qb["enough"]:
            L += ["", f"🗞 같은 사안을 다룬 보도 {len(related)}건"]
        L += ["", src, note, "", " ".join(tags)]

    elif style == "cards":
        # 앞장 만들기 화면의 칸 이름(후킹 문구 / 제목 / 요약문)을 그대로 쓴다.
        rows = _card_rows(body, title, 5 if cx["used"] else 4)
        lead = (an.get("summaries") or [""])[0]
        last = len(rows) + 2
        L = [f"🗂 카드뉴스 대사 초안 — 표지 1장 + 본문 {len(rows)}장 + 뒷장 1장",
             "「앞장 만들기」의 후킹 문구 / 제목 / 요약문 칸에 그대로 옮겨 넣으세요.",
             "",
             "━━ 1장 · 표지 ━━",
             f"후킹 문구 ▸ {hook or '(직접 써 주세요)'}",
             f"제목      ▸ {head or title}",
             f"요약문    ▸ {lead or (rows[0][1] if rows else '')}"]
        if not rows:
            L += ["", "(본문이 짧아 더 뽑을 문장이 없습니다. 기사 전문을 붙여넣어 보세요.)"]
        for i, (h, s) in enumerate(rows, start=2):
            L += ["", f"━━ {i}장 ━━", f"제목      ▸ {h}"]
            if s:
                L.append(f"요약문    ▸ {s}")
        L += ["", f"━━ {last}장 · 뒷장 ━━",
              "「뒷장 만들기」에서 5종 중 하나를 골라 저장하세요.",
              "출처 표기 ▸ " + (f"{press or '언론사'} 「{title}」" if title else "원문 기사")]
        L += _quote_section(qb)
        if cx["common"]:
            L += ["", f"🔁 {cx['used']}개 매체가 함께 짚은 대목 — 골라 쓸 재료"]
            L += [f"· {s}" for s in cx["common"]]
        if cx["diff"]:
            L += ["", "🗞 매체별로 다르게 다룬 부분"] + cx["diff"]
        elif others and not qb["enough"]:
            L += ["", "🗞 다른 매체는 이렇게 봤다"] + others
        L += ["", MINE, "", src, note, "", " ".join(tags)]

    elif style == "magazine":
        # 여러 기사로 팩트를 맞춘 경우에는 길어져도 되므로 문단을 넉넉히 나눈다
        rows = _sents(body, title, 8 if cx["used"] else 5, limit=200)
        L.append(hook or title or head)
        for i in range(0, len(rows), 2):        # 두 문장씩 한 문단
            L.append("")
            L += rows[i:i + 2]
        L += _quote_section(qb)
        if cx["common"]:
            L += ["", f"여러 매체가 공통으로 짚은 대목은 이렇습니다.", *cx["common"]]
        if cx["diff"]:
            L += ["", "— 같은 시각, 다른 지면에서는", *cx["diff"]]
        elif others and not qb["enough"]:
            L += ["", "— 같은 시각, 다른 지면에서는", *others]
        L += ["", MINE, "", src, note, "", " ".join(tags)]

    else:  # news
        rows = _sents(body, title, 8 if cx["used"] else 5, limit=200)
        L.append(hook or title or head)
        L.append("")
        L.append("📌 무슨 일인가")
        for s in rows[:3]:
            L.append(f"· {s}")
        if rows[3:]:
            L.append("")
            L.append("📊 짚어볼 점")
            for s in rows[3:]:
                L.append(f"· {s}")
        L += _quote_section(qb)
        if cx["common"]:
            L.append("")
            L.append(f"🔁 {cx['used']}개 매체가 함께 짚은 대목")
            for s in cx["common"]:
                L.append(f"· {s}")
        if cx["diff"]:
            L.append("")
            L.append("🗞 매체별로 다르게 다룬 부분")
            L += cx["diff"]
        elif others and not qb["enough"]:
            L.append("")
            L.append("🗞 다른 매체는 이렇게 봤다")
            L += others
        L += ["", MINE, "", src, note, "", " ".join(tags)]

    text = "\n".join(L).strip()
    return {"text": text, "hashtags": tags, "style": style,
            "chars": len(text), "others": len(others),
            "quote": qb["quote"], "quoted": qb["n"], "quoteEnough": qb["enough"],
            "titles": title_ideas(title, body, style),
            "titleNote": STYLE_TITLE_NOTE.get(style, ""),
            "warn": len(text) > 2200}      # 인스타 캡션 상한 2,200자


# ── 캡션 후보 5개 ─────────────────────────────────────────────────────────
# 올리기 화면(insta.html)에서 쓴다. 앞장 만들기의 제목 추천과 같은 결 —
# **고를 것을 여러 개 주고 고치는 자리를 남긴다.** 하나만 주면 그대로 올리게 된다.
CAPTION_STYLES = [
    ("news", "뉴스 전달형", "무슨 일인지 → 짚어볼 점. 시사 계정 기본형."),
    ("brief", "짧은 브리핑", "3줄 요약 + 해시태그. 가볍게 올릴 때."),
    ("question", "질문 던지기", "표지 후킹을 첫 줄로. 댓글을 부르는 결."),
    ("magazine", "매거진형", "문장을 이어 쓰는 에세이 톤. 기획·주간 정리에."),
    ("oneline", "한 줄 + 태그", "카드가 이미 다 말한 경우. 캡션은 짧게."),
]

# 기사 없이 올릴 때(첫 게시물·공지·프로필 안내) 쓰는 틀.
# 여기에는 **채울 자리를 대괄호로 남긴다** — 프로그램이 사실을 지어내면 안 되므로.
BLANK_CAPTIONS = [
    ("intro", "첫 게시물 · 계정 소개",
     "계정을 처음 열 때. 무엇을 하는 곳인지부터.",
     ["안녕하세요, 뉴보대입니다.", "",
      "[한 줄로 우리가 무엇을 하는 계정인지]", "",
      "· [올릴 것 ①]", "· [올릴 것 ②]", "· [올리는 주기]", "",
      "궁금한 점이나 다뤘으면 하는 주제는 댓글·DM 으로 남겨 주세요.", "",
      "#뉴보대 #대학생 #뉴스 #카드뉴스"]),
    ("today", "오늘의 카드뉴스",
     "평소 올리는 카드뉴스에 붙이는 기본 틀.",
     ["[제목 — 카드 표지에 쓴 문구]", "",
      "📌 무슨 일인가", "· [사실 ①]", "· [사실 ②]", "",
      "📊 짚어볼 점", "· [우리가 보탤 시각]", "",
      "🔗 출처: [언론사] 「[기사 제목]」", "",
      "#뉴보대 #대학생 #[주제]"]),
    ("ask", "질문 던지기",
     "댓글을 부르는 결. 반응을 보고 싶을 때.",
     ["[여러분은 어떻게 생각하시나요?]", "",
      "[상황을 두세 문장으로]", "",
      "① [보기 하나]", "② [보기 둘]", "",
      "댓글에 번호로 남겨 주세요.", "",
      "#뉴보대 #대학생 #[주제]"]),
    ("notice", "공지·안내",
     "모집·행사·운영 안내처럼 사실만 또박또박 전할 때.",
     ["📢 [공지 제목]", "",
      "· 무엇을 : [내용]", "· 언제 : [일시]", "· 어디서 : [장소·링크]", "· 누구나 : [대상]", "",
      "신청은 프로필 링크에서 받습니다.", "",
      "#뉴보대 #대학생 #공지"]),
    ("short", "한 줄 + 태그",
     "카드가 이미 다 말했을 때. 설명을 얹지 않는다.",
     ["[한 줄]", "", "#뉴보대 #대학생 #[주제]"]),
]


def _cap_question(body, title, an, tags, src, note):
    hook = (an.get("hooks") or [""])[0]
    tp = summarizer.topic_words((title or "") + " " + (body or ""), 4)
    k0 = tp[0] if tp else ((title or "")[:8] or "이번 사안")
    j = summarizer.josa
    L = [hook or f"{k0}, 어떻게 보시나요?", ""]
    for s in _sents(body, title, 3, limit=130):
        L.append(f"· {s}")
    L += ["", f"{k0}{j(k0, ('은', '는'))} 여러분에게 어떤 이야기인가요? 댓글로 남겨 주세요.",
          "", MINE, "", src, note, "", " ".join(tags)]
    return L


def _cap_oneline(body, title, an, tags, src, note):
    """카드가 이미 다 말한 경우. **짧은 것도 후보에 있어야 한다** —
    긴 초안만 주면 전부 길게 올리게 된다."""
    head = (an.get("titles") or [title])[0] or title
    lead = ((an.get("summaries") or [""])[0]
            or (_sents(body, title, 1, limit=120) or [""])[0])
    L = [head or title]
    if lead and lead != head:
        L += ["", lead]
    L += ["", src, note, "", " ".join(tags[:8])]
    return L


def caption_ideas(main: dict, related=None, n: int = 5):
    """인스타 캡션 후보 **5개**. 글투만 다르고 재료는 전부 같은 기사에서 나온다.

    기사가 없으면(첫 게시물·공지 등) 빈칸을 남긴 **틀 5개**를 준다 — 사실을
    지어내는 대신 채울 자리를 보여 주는 쪽이 맞다.
    """
    main = main or {}
    title = (main.get("title") or "").strip()
    body = (main.get("body") or "").strip()
    related = related or []

    if not body and not title:
        out = []
        for sid, name, note, lines in BLANK_CAPTIONS[:max(n, 1)]:
            text = "\n".join(lines).strip()
            out.append({"id": sid, "name": name, "note": note, "text": text,
                        "chars": len(text), "warn": False, "blank": True,
                        "head": lines[0]})
        return out

    an = summarizer.analyze(body, title) if body else {}
    tags = hashtags(title, body, related)
    src = _source_line((main.get("press") or "").strip(), title,
                       (main.get("date") or "").strip(), (main.get("url") or "").strip())
    note = "※ 원문을 요약·재구성한 초안입니다. 올리기 전에 사실관계와 표현을 확인하세요."

    out = []
    for sid, name, hint in CAPTION_STYLES[:max(n, 1)]:
        if sid == "question":
            text = "\n".join(_cap_question(body, title, an, tags, src, note)).strip()
        elif sid == "oneline":
            text = "\n".join(_cap_oneline(body, title, an, tags, src, note)).strip()
        else:
            text = compose(main, related, sid)["text"]
        head = next((l for l in text.split("\n") if l.strip()), "")
        out.append({"id": sid, "name": name, "note": hint, "text": text,
                    "chars": len(text), "warn": len(text) > 2200,
                    "blank": False, "head": head})
    return out
