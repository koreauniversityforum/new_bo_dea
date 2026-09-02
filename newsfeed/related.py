# -*- coding: utf-8 -*-
"""비슷한 시각에 나온 유사 기사 찾기 (표준 라이브러리만 사용, API 키 불필요).

검색원 두 곳을 쓴다. 2026-08 실측 기준:

  · 구글 뉴스 RSS — 한 번에 최대 100건. 제목·언론사·발행시각이 정확하다.
                    다만 링크가 구글 중계 주소이고 따라가면 JS 리다이렉트
                    페이지가 나와서 **본문은 못 긁는다**.
  · 빙 뉴스 RSS   — 12건 남짓으로 적지만 링크에 실제 기사 주소가 들어 있다.
                    (다만 MSN 같은 재배포 페이지로 가는 경우가 많아 본문이 빈다.)

그래서 이 모듈이 보장하는 것은 **제목 · 언론사 · 발행시각**까지다.
본문은 되면 가져오고 안 되면 없이 간다(`body_ok` 로 표시).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import parse_qs, quote, urlparse

import extractor
import summarizer

GOOGLE = "https://news.google.com/rss/search?q={q}&hl=ko&gl=KR&ceid=KR:ko"
BING = "https://www.bing.com/news/search?q={q}&format=RSS&setmkt=ko-KR"

# 본문을 긁어봐야 소용없는 재배포/집합 사이트
NO_BODY_HOST = re.compile(r"(msn\.com|news\.google\.|bing\.com|finance\.yahoo)", re.I)

# 빙·구글이 언론사 이름 대신 주소를 줄 때가 있어 사람이 읽을 이름으로 바꾼다
HOST_NAME = {
    "yna.co.kr": "연합뉴스", "v.daum.net": "다음뉴스", "n.news.naver.com": "네이버뉴스",
    "news.naver.com": "네이버뉴스", "chosun.com": "조선일보", "donga.com": "동아일보",
    "joongang.co.kr": "중앙일보", "hani.co.kr": "한겨레", "khan.co.kr": "경향신문",
    "hankookilbo.com": "한국일보", "seoul.co.kr": "서울신문", "kmib.co.kr": "국민일보",
    "munhwa.com": "문화일보", "segye.com": "세계일보", "hankyung.com": "한국경제",
    "mk.co.kr": "매일경제", "sedaily.com": "서울경제", "edaily.co.kr": "이데일리",
    "mt.co.kr": "머니투데이", "fnnews.com": "파이낸셜뉴스", "asiae.co.kr": "아시아경제",
    "newsis.com": "뉴시스", "news1.kr": "뉴스1", "ytn.co.kr": "YTN",
    "kbs.co.kr": "KBS", "imnews.imbc.com": "MBC", "news.sbs.co.kr": "SBS",
    "jtbc.co.kr": "JTBC", "ohmynews.com": "오마이뉴스", "pressian.com": "프레시안",
    "bbc.com": "BBC", "reuters.com": "로이터", "msn.com": "MSN(재배포)",
    "ajunews.com": "아주경제", "nocutnews.co.kr": "노컷뉴스", "cbs.co.kr": "CBS",
    "dt.co.kr": "디지털타임스", "etnews.com": "전자신문", "zdnet.co.kr": "ZDNet코리아",
    "biz.chosun.com": "조선비즈", "wowtv.co.kr": "한국경제TV", "inews24.com": "아이뉴스24",
    "heraldcorp.com": "헤럴드경제", "newdaily.co.kr": "뉴데일리", "ichannela.com": "채널A",
    "tvchosun.com": "TV조선", "mbn.co.kr": "MBN", "yonhapnewstv.co.kr": "연합뉴스TV",
}


def _press_name(raw: str, link: str = "") -> str:
    raw = (raw or "").strip()
    host = urlparse(link).netloc.replace("www.", "") if link else ""
    for h, name in HOST_NAME.items():
        if raw == h or (host and host.endswith(h)):
            return name
    # 'v.daum.net' 처럼 주소꼴이면 그대로 두지 말고 도메인만 보여 준다
    if re.match(r"^[\w.\-]+\.(com|net|kr|co\.kr|org)$", raw):
        return HOST_NAME.get(raw, raw)
    return raw

KST = timezone(timedelta(hours=9))


# ── 시각 다루기 ────────────────────────────────────────────────────────────
def parse_when(s: str):
    """기사 메타의 날짜 문자열을 aware datetime 으로. 못 읽으면 None."""
    s = (s or "").strip()
    if not s:
        return None
    try:                                    # RFC822 (RSS pubDate)
        d = parsedate_to_datetime(s)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        pass
    if re.fullmatch(r"\d{14}", s):          # 다음: 20260807163355
        try:
            return datetime.strptime(s, "%Y%m%d%H%M%S").replace(tzinfo=KST)
        except ValueError:
            pass
    t = s.replace("Z", "+00:00")
    for pat in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M%z", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d",
                "%Y.%m.%d %H:%M", "%Y.%m.%d", "%Y/%m/%d %H:%M", "%Y년 %m월 %d일"):
        try:
            d = datetime.strptime(t[:len(datetime.now().strftime(pat)) + 6], pat)
            return d if d.tzinfo else d.replace(tzinfo=KST)
        except ValueError:
            continue
    m = re.search(r"(20\d\d)[-.\/년]\s*(\d{1,2})[-.\/월]\s*(\d{1,2})", s)
    if m:
        y, mo, dy = (int(g) for g in m.groups())
        try:
            return datetime(y, mo, dy, tzinfo=KST)
        except ValueError:
            return None
    return None


def _fmt(d: datetime) -> str:
    return d.astimezone(KST).strftime("%Y-%m-%d %H:%M")


# ── 제목 정리 ──────────────────────────────────────────────────────────────
def _split_press(title: str):
    """'제목 - 언론사' 를 나눈다. 구글 RSS 는 항상 이 꼴로 준다."""
    m = re.match(r"^(.*)\s+-\s+([^\-]{2,20})$", title.strip())
    if m and len(m.group(1)) >= 6:
        return m.group(1).strip(), m.group(2).strip()
    return title.strip(), ""


def _key(title: str) -> str:
    """같은 기사인지 판별할 지문. 특수문자·공백·따옴표를 다 지운다."""
    t = re.sub(r"\[[^\]]{0,14}\]|\([^)]{0,14}\)", "", title)
    return re.sub(r"[^0-9A-Za-z가-힣]", "", t)[:40]


# ── 검색 ───────────────────────────────────────────────────────────────────
def _items_from(raw: bytes):
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return []
    return root.findall(".//item")


def search_google(query: str, days: int = 3, timeout: int = 20):
    q = quote(f"{query} when:{max(1, days)}d")
    try:
        raw, _, _ = extractor.fetch(GOOGLE.format(q=q), timeout=timeout)
    except Exception:
        return []
    out = []
    for it in _items_from(raw):
        title = unescape((it.findtext("title") or "").strip())
        if not title:
            continue
        clean, press = _split_press(title)
        src = it.find("{http://news.google.com/}source")
        if src is not None and (src.text or "").strip():
            press = src.text.strip()
        out.append({"title": clean, "press": press,
                    "link": (it.findtext("link") or "").strip(),
                    "when": parse_when(it.findtext("pubDate") or ""),
                    "direct": False, "src": "google"})
    return out


def search_bing(query: str, timeout: int = 15):
    try:
        raw, _, _ = extractor.fetch(BING.format(q=quote(query)), timeout=timeout)
    except Exception:
        return []
    out = []
    for it in _items_from(raw):
        title = unescape((it.findtext("title") or "").strip())
        link = (it.findtext("link") or "").strip()
        # 빙은 클릭 추적 주소 안에 진짜 주소를 url= 로 넣어 준다
        real = parse_qs(urlparse(link).query).get("url", [""])[0] or link
        if not title:
            continue
        out.append({"title": title, "press": urlparse(real).netloc.replace("www.", ""),
                    "link": real, "when": parse_when(it.findtext("pubDate") or ""),
                    "direct": not NO_BODY_HOST.search(real), "src": "bing"})
    return out


# ── 오늘의 주제 후보 (갈래별) ──────────────────────────────────────────────
# 구글 뉴스 **갈래(섹션) RSS**. 검색 RSS 와 같은 틀이라 파서를 그대로 쓴다.
# 2026-08-13 실측: 여섯 갈래 전부 30~70건씩 온다(POLITICS 도 한국판에 존재).
# 🔴 링크는 구글 중계 주소라 본문은 못 긁는다 — 제목·언론사·시각까지만 보장.
IDEA_FEEDS = {
    "종합": "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko",
    "경제": "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko",
    "정치": "https://news.google.com/rss/headlines/section/topic/POLITICS?hl=ko&gl=KR&ceid=KR:ko",
    "사회": "https://news.google.com/rss/headlines/section/topic/NATION?hl=ko&gl=KR&ceid=KR:ko",
    "세계": "https://news.google.com/rss/headlines/section/topic/WORLD?hl=ko&gl=KR&ceid=KR:ko",
    "IT·과학": "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ko&gl=KR&ceid=KR:ko",
}
IDEA_ORDER = list(IDEA_FEEDS)


def topic_ideas(cat: str, limit: int = 20, timeout: int = 20) -> dict:
    """갈래 하나의 헤드라인 후보. 새것부터, 같은 기사(지문 일치)는 하나만."""
    url = IDEA_FEEDS.get(cat)
    if not url:
        raise ValueError("모르는 갈래입니다: %s (가능: %s)" % (cat, ", ".join(IDEA_ORDER)))
    raw, _, _ = extractor.fetch(url, timeout=timeout)
    seen, out = set(), []
    for it in _items_from(raw):
        title = unescape((it.findtext("title") or "").strip())
        if not title:
            continue
        clean, press = _split_press(title)
        src = it.find("{http://news.google.com/}source")
        if src is not None and (src.text or "").strip():
            press = src.text.strip()
        k = _key(clean)
        if not k or k in seen:
            continue
        seen.add(k)
        w = parse_when(it.findtext("pubDate") or "")
        out.append({"title": clean, "press": _press_name(press) or "(언론사 미상)",
                    "link": (it.findtext("link") or "").strip(),
                    "when": w.astimezone(KST).strftime("%m-%d %H:%M") if w else "",
                    "ts": w.timestamp() if w else 0})
    out.sort(key=lambda x: -x["ts"])
    return {"cat": cat, "items": out[:max(1, min(50, limit))]}


# ── 인용문(쌍따옴표) ───────────────────────────────────────────────────────
# 발언은 여러 매체가 **글자 그대로** 옮긴다. 그래서 낱말로 찾는 것보다 훨씬 정확하게
# "같은 사안을 다룬 기사" 를 모을 수 있다(2026-09-02 요구). 홑따옴표는 강조에도 쓰여
# 발언이 아닌 경우가 많아 쓰지 않는다.
QUOTE_RE = re.compile(u'[“”"＂]([^“”"＂\n]{10,160})[“”"＂]')
# 검색어로 쓸 때 잘라 낼 꼬리 - 인용 끝의 어미까지 같아야 걸리는 것을 줄인다
QUOTE_CUT = re.compile(u"[,.…·!?]+$")


def quotes(body: str, n: int = 3, minlen: int = 12) -> list:
    """본문에서 큰따옴표 안 발언을 뽑는다. 긴 것부터, 같은 말은 하나만.

    긴 발언일수록 다른 기사와 **글자 그대로** 겹칠 확률이 높아 검색에 유리하다.
    """
    out, seen = [], set()
    for m in QUOTE_RE.finditer(body or ""):
        s = re.sub(r"\s+", " ", m.group(1)).strip()
        # 🔴 기자가 끼워 넣은 괄호 설명(예: "…생각에서 (민주당TV 첫 방송)")은 매체마다
        #    달라서 그대로 검색하면 한 건도 안 걸린다(실측). 닫히지 않은 괄호부터 버린다.
        열림 = s.find("(")
        if 열림 > 0 and s.count("(") > s.count(")"):
            s = s[:열림].strip()
        s = QUOTE_CUT.sub("", s)
        if len(s) < minlen:
            continue
        k = _key(s)
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(s)
    out.sort(key=len, reverse=True)
    return out[:max(1, n)]


def _quote_tries(q: str) -> list:
    """검색에 넣어 볼 토막들. 길수록 정확하지만 0건이 되기 쉬워 짧게도 해 본다.

    🔴 통째로 넣으면 마침표·조사 하나만 달라도 안 걸린다. 그래서 앞에서부터
       **어절 경계**로 줄여 가며 두 번 더 시도한다(가운데를 자르면 말이 끊긴다).
    """
    q = q.strip()
    tries = [q]
    for want in (34, 20):
        if len(q) <= want + 4:
            continue
        cut = q[:want]
        sp = cut.rfind(" ")
        if sp >= 12:
            cut = cut[:sp]
        cut = cut.strip()
        if len(cut) >= 12 and cut not in tries:
            tries.append(cut)
    return tries


def find_quoted(quote_text, days: int = 7, limit: int = 10,
                need: int = 3, deep: bool = True) -> dict:
    """**같은 발언을 인용한** 기사들. 구글·빙 모두 따옴표를 정확 구절로 받는다.

    `quote_text` 는 발언 하나(str)여도 되고 여러 개(list)여도 된다.
    `need` 건을 채울 때까지만 다음 발언·짧은 토막으로 넘어간다 - 다 채웠으면 더 안
    부른다(기사 하나에 바깥 요청이 몇 개나 나가는지가 이 화면의 체감 속도다).

    🔴 **가장 긴 발언이 가장 잘 걸리는 것은 아니다**(실측). 긴 발언에는 그 매체만 쓴
       군말이 섞여 한 건도 안 나오는 반면, 두 번째 발언이 6건씩 걸리기도 한다.
       그래서 발언을 하나만 보지 않고 위에서부터 차례로 시도한다.

    돌려주는 항목은 `find()` 와 같은 꼴에 `by_quote=True` 가 붙는다. 본문을 읽어 온
    항목은 그 발언이 **정말 들어 있는지** 확인해 `quote_ok` 로 표시한다.
    """
    말들 = [quote_text] if isinstance(quote_text, str) else list(quote_text or [])
    말들 = [(m or "").strip() for m in 말들]
    말들 = [m for m in 말들 if len(m) >= 12]
    out, seen, used = [], set(), ""
    if not 말들:
        return {"quote": (말들 or [""])[0] if 말들 else "", "items": [],
                "query": "", "found": 0, "verified": 0}

    # 발언 여러 개를 **가로로** 훑는다 - 첫 발언을 짧게 자르며 매달리는 것보다
    # 두 번째 발언을 통째로 넣는 쪽이 훨씬 잘 걸린다(실측: 1건 대 6건).
    토막표 = [_quote_tries(m) for m in 말들]
    후보 = []
    for i in range(max(len(t) for t in 토막표)):
        for m, t in zip(말들, 토막표):
            if i < len(t):
                후보.append((m, t[i]))
    for 원문, 토막 in 후보:
        used = 토막
        rows = search_google('"%s"' % 토막, days=days) + search_bing('"%s"' % 토막)
        for r in rows:
            k = _key(r["title"])
            if not k or k in seen:
                continue
            seen.add(k)
            w = r.get("when")
            out.append({"title": r["title"],
                        "press": _press_name(r["press"], r.get("link", "")) or "(언론사 미상)",
                        "link": r["link"], "direct": r["direct"], "src": r["src"],
                        "date": _fmt(w) if w else "", "gap_h": None,
                        "score": 9.0, "body": "", "body_ok": False,
                        "by_quote": True, "quote": 원문, "quote_ok": False})
        if len(out) >= need:
            break
    q = next((원문 for 원문, 토막 in 후보 if 토막 == used), 말들[0])

    out = out[:limit]
    if deep:
        cands = [i for i in out if i.get("direct")][:4]
        if cands:
            with ThreadPoolExecutor(max_workers=min(4, len(cands))) as ex:
                list(ex.map(try_body, cands))
            # 발언 **어느 하나라도** 그대로 들어 있으면 확인된 것으로 본다. 매체마다
            # 같은 회견에서 다른 대목을 인용하므로, 걸린 토막 하나만 보면 거의 다 놓친다.
            핵심들 = [re.sub(r"\s+", "", m)[:20] for m in 말들 if len(m) >= 12]
            for i in cands:
                몸 = re.sub(r"\s+", "", i.get("body") or "")
                i["quote_ok"] = bool(몸 and any(k and k in 몸 for k in 핵심들))
    return {"quote": q, "query": used, "items": out, "found": len(out),
            "verified": sum(1 for i in out if i.get("quote_ok"))}


# ── 검색어 만들기 ──────────────────────────────────────────────────────────
# 조사가 덜 떨어진 낱말('명문학교서')은 검색어로 쓰면 결과가 거의 안 나온다
JOSA_TAIL = re.compile(r"(서|에|은|는|이|가|을|를|와|과|도|만|의|로|으로|께|부터|까지)$")


def build_query(title: str, body: str = "", n: int = 3) -> str:
    """제목을 두 번 세어 가중치를 주고, 제목+본문 전체에서 핵심 낱말을 뽑는다.

    제목 낱말만 쓰면 '명문학교서' 같은 조사 붙은 토막이 걸려 검색이 0건이 된다.
    """
    pool = f"{title} {title} {body}"
    picked, seen = [], set()
    for w in summarizer.keywords(pool, 20):
        if len(w) < 2 or w in seen:
            continue
        if len(w) > 3 and JOSA_TAIL.search(w) and w[:-1] in seen:
            continue                        # '총기'가 이미 있으면 '총기가'는 버린다
        seen.add(w)
        picked.append(w)
        if len(picked) >= n:
            break
    return " ".join(picked) or (title or "")[:30]


# ── 본문 시도 ──────────────────────────────────────────────────────────────
def _one_url(u: str, base) -> dict:
    """기사 주소 하나를 읽어 한 줄로. 실패해도 예외를 밖으로 내지 않는다."""
    row = {"title": "", "press": "", "link": u, "direct": True, "src": "직접 링크",
           "date": "", "gap_h": None, "score": 9.9, "body": "", "body_ok": False,
           "error": ""}
    try:
        got = extractor.extract(u)
        row["title"] = got.get("title") or u
        # 기사에서 뽑은 언론사 이름이 있으면 그게 정답이다.
        # (포털 주소로 매핑하면 '연합뉴스' 가 '다음뉴스' 로 덮여 버린다)
        row["press"] = (got.get("press") or "").strip() \
            or _press_name("", u) or urlparse(u).netloc.replace("www.", "")
        w = parse_when(got.get("date", ""))
        if w:
            row["date"] = _fmt(w)
            if base:
                row["gap_h"] = round(abs((w - base).total_seconds()) / 3600, 1)
        body = got.get("body", "")
        if len(re.sub(r"\s", "", body)) >= 150:
            row["body"] = body
            row["body_ok"] = True
        else:
            row["error"] = "본문을 찾지 못했습니다"
    except Exception as e:
        row["title"] = u
        row["error"] = f"{type(e).__name__}: {e}"[:80]
    return row


def from_urls(urls, base_when: str = "", workers: int = 4) -> list:
    """사람이 직접 준 기사 주소들을 그대로 읽어 온다.

    구글이 중계 주소로 막는 것과 달리 **직접 주소는 본문이 그대로 나온다.**
    네이버·다음·언론사 주소 모두 여기로 들어오면 본문까지 확보된다.

    한 건에 2~5초씩 걸리므로 여러 건은 동시에 읽는다. 다만 **넣은 순서를
    그대로 돌려준다** — 화면에서 순서로 짝을 맞추기 때문이다.
    """
    base = parse_when(base_when)
    todo = []
    for u in urls:
        u = (u or "").strip()
        if not u:
            continue
        if not u.startswith(("http://", "https://")):
            u = "https://" + u
        todo.append(u)
    if not todo:
        return []
    if len(todo) == 1 or workers <= 1:
        return [_one_url(u, base) for u in todo]
    with ThreadPoolExecutor(max_workers=min(workers, len(todo))) as ex:
        return list(ex.map(lambda u: _one_url(u, base), todo))


def try_body(item: dict, timeout: int = 8) -> dict:
    """직접 주소인 항목만 본문을 긁어 본다. 실패는 조용히 넘어간다."""
    if not item.get("direct") or NO_BODY_HOST.search(item.get("link", "")):
        return item
    try:
        got = extractor.extract(item["link"])
        if len(re.sub(r"\s", "", got.get("body", ""))) >= 200:
            item["body"] = got["body"]
            item["body_ok"] = True
            if got.get("press"):
                item["press"] = got["press"]
    except Exception:
        pass
    return item


# ── 본체 ───────────────────────────────────────────────────────────────────
def find(title: str, body: str = "", when: str = "", url: str = "",
         hours: int = 48, limit: int = 12, deep: bool = False,
         quote_first: bool = True, quote_need: int = 3) -> dict:
    """기준 기사와 비슷한 시각·비슷한 내용의 기사 목록.

    hours — 기준 기사 발행시각 앞뒤로 몇 시간까지 볼 것인가.
    deep  — 직접 주소인 항목의 본문까지 시도할 것인가(느리고 성공률이 낮다).
    quote_first — 본문에 **쌍따옴표 발언**이 있으면 그 발언을 그대로 인용한 기사를
        먼저 찾아 맨 앞에 둔다(2026-09-02 요구). 낱말 검색은 '비슷한 주제'까지
        끌어오지만, 같은 발언을 실은 기사는 **같은 사안**이 거의 확실하다.
    quote_need — 그렇게 몇 건까지 모을 것인가.
    """
    base = parse_when(when) or datetime.now(timezone.utc)
    days = max(1, int((hours + 23) // 24) + 1)

    # 낱말 3개로 좁게 찾아보고, 안 걸리면 2개로 넓히고, 그래도 없으면 기간을 늘린다.
    plans = [(build_query(title, body, 3), days),
             (build_query(title, body, 2), days),
             (build_query(title, body, 2), max(days, 7))]
    rows, query = [], plans[0][0]
    for q, d in plans:
        if not q:
            continue
        query = q
        rows = search_google(q, days=d) + search_bing(q)
        if len(rows) >= 8:
            break

    main_key = _key(title)
    main_host = urlparse(url).netloc.replace("www.", "") if url else ""
    main_tok = set(summarizer.tokens((title or "") + " " + (body or "")[:1500]))
    kw = {w: (14 - i) for i, w in enumerate(summarizer.keywords(
        (title or "") + " " + (body or ""), 14))}

    seen, out = set(), []
    for r in rows:
        k = _key(r["title"])
        if not k or k == main_key or k in seen:
            continue
        if main_host and main_host in r.get("link", ""):
            continue
        w = r.get("when")
        gap = abs((w - base).total_seconds()) / 3600 if w else None
        if gap is not None and gap > hours:
            continue
        tok = set(summarizer.tokens(r["title"]))
        if not tok:
            continue
        hit = tok & main_tok
        # 제목 낱말이 기준 기사와 얼마나 겹치나 + 중요 키워드에 가중치
        score = len(hit) / (len(tok) ** 0.5) + sum(kw.get(t, 0) for t in hit) * 0.06
        if w:                                   # 시각이 가까울수록 가산
            score += max(0.0, 1.2 - gap / max(1, hours))
        if score < 0.6:
            continue
        seen.add(k)
        out.append({"title": r["title"],
                    "press": _press_name(r["press"], r.get("link", "")) or "(언론사 미상)",
                    "link": r["link"], "direct": r["direct"], "src": r["src"],
                    "date": _fmt(w) if w else "", "gap_h": round(gap, 1) if gap is not None else None,
                    "score": round(score, 2), "body": "", "body_ok": False})

    out.sort(key=lambda d: -d["score"])
    out = out[:limit]

    if deep:
        cands = [i for i in out[:6] if i.get("direct")][:4]
        if cands:
            with ThreadPoolExecutor(max_workers=min(4, len(cands))) as ex:
                list(ex.map(try_body, cands))       # try_body 는 항목을 그 자리에서 고친다

    # ── 같은 발언을 인용한 기사를 앞에 세운다 ──────────────────────────────
    말들 = quotes(body, 3) if quote_first else []
    인용 = {"quote": "", "query": "", "items": [], "found": 0, "verified": 0}
    if 말들:
        try:
            인용 = find_quoted(말들, days=max(2, (hours + 23) // 24 + 1),
                             need=quote_need, deep=True)
        except Exception:
            인용 = {"quote": 말들[0], "query": "", "items": [], "found": 0, "verified": 0}
        이미 = {_key(i["title"]) for i in out} | {main_key}
        새것 = [i for i in 인용["items"] if _key(i["title"]) not in 이미]
        # 낱말로 찾은 것에도 표시를 남긴다 - 화면에서 둘을 구분해 보여 줄 수 있게
        붙은말 = {_key(i["title"]): i for i in 인용["items"]}
        for i in out:
            j = 붙은말.get(_key(i["title"]))
            if j:
                i["by_quote"] = True
                i["quote"] = j.get("quote", "")
                i["quote_ok"] = j.get("quote_ok", False)
        out = (새것 + out)[:limit]      # 인용이 앞자리를 가져간다 - 같은 사안이 더 확실하다

    return {"query": query, "base": _fmt(base), "hours": hours,
            "items": out, "found": len(rows),
            "quotes": 말들, "quoted": {k: 인용[k] for k in ("quote", "query", "found", "verified")},
            "quoted_n": sum(1 for i in out if i.get("by_quote")),
            "body_ok": sum(1 for i in out if i.get("body_ok"))}
