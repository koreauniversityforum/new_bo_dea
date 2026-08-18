# -*- coding: utf-8 -*-
"""주제 허브 - 참고 계정·매체의 최신 글/영상을 모아 '주제 후보'로 내놓는다.

「뉴보대 및 경제 참고 웹사이트.txt」(2026-08-13)의 소스 중 **키 없이 받아지는
경로만** 실측으로 추려 담았다. 인스타그램·X 는 로그인 없이는 못 읽어서 뺐고,
유튜브는 공개 RSS(https://www.youtube.com/feeds/videos.xml?channel_id=...)로 받는다.

🔴 이 파일은 뉴보대(newsfeed\\hub.py)와 경제(finance\\news\\hub.py)가 **같은 내용**을
   쓴다. 한쪽을 고치면 반드시 양쪽을 같이 고칠 것 (extractor 3형제와 같은 규칙).
   그래서 프로젝트 안 다른 모듈을 import 하지 않고 표준 라이브러리만 쓴다.

실측 기록 (2026-08-13):
  - 유튜브 채널 ID 는 핸들 페이지(@이름)에서 "channelId" 를 읽어 굳혔다.
    핸들 페이지가 500 을 자주 던져(연속 요청 제한) 실행 중에 해석하지 않는다.
  - @SmartMoney0 과 txt 의 미래에셋 채널 UCZS9... 는 **같은 채널**이었다.
  - 뉴닉 공식 채널(UCwx-KT3brOF-oPjcpA_nMJw)은 핸들 페이지가 두 번 다 같은 ID 를
    줬는데도 RSS 가 404 를 낸 적이 있다. 실패해도 다른 소스는 그대로 간다.
  - 한경·서울경제 등 죽은 언론사 RSS 는 topics.py 쪽 기록 참고.
"""
from __future__ import annotations

import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape

KST = timezone(timedelta(hours=9))
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126 Safari/537.36",
    "Accept-Language": "ko,en;q=0.8",
}

# use: 'news'=뉴보대(시사 넓게) / 'econ'=경제 / 'both'=둘 다
#   화면은 use 로 걸러 제 쪽 것만 보여 준다.
# kind: 'yt'=유튜브 채널 RSS(url 자리에 채널 ID) / 'rss'=보통 RSS 주소
SOURCES = [
    # ── 국내 증권사·투자 ────────────────────────────────────────────────
    {"key": "toss_yt", "name": "토스증권 유튜브", "group": "국내 증권사·투자",
     "kind": "yt", "url": "UCW_P8DTCnlDcUHRfGFwRRLA", "use": "both",
     "home": "https://www.youtube.com/@toss_securities/videos"},
    {"key": "tossfeed", "name": "토스피드(글)", "group": "국내 증권사·투자",
     "kind": "rss", "url": "https://blog.toss.im/rss.xml", "use": "both",
     "home": "https://toss.im/tossfeed/writer/tossinvest"},
    {"key": "shinhan_yt", "name": "신한투자증권 유튜브", "group": "국내 증권사·투자",
     "kind": "yt", "url": "UCYzZm9_nasRW6npCkjlTjKQ", "use": "both",
     "home": "https://www.youtube.com/@shinhansecurities"},
    {"key": "mirae_yt", "name": "미래에셋 스마트머니", "group": "국내 증권사·투자",
     "kind": "yt", "url": "UCZS9wEZ4itPbBZk_sqccXfw", "use": "both",
     "home": "https://www.youtube.com/@SmartMoney0/videos"},
    {"key": "mirae_blog", "name": "미래에셋 공식블로그", "group": "국내 증권사·투자",
     "kind": "rss", "url": "https://rss.blog.naver.com/how2invest.xml", "use": "both",
     "home": "https://blog.naver.com/how2invest"},
    {"key": "kiwoom_yt", "name": "키움증권 유튜브", "group": "국내 증권사·투자",
     "kind": "yt", "url": "UCZW1d7B2nYqQUiTiOnkirrQ", "use": "both",
     "home": "https://www.youtube.com/@kiwoomchk/videos"},
    {"key": "investing_yt", "name": "인베스팅닷컴 한국", "group": "국내 증권사·투자",
     "kind": "yt", "url": "UCgVFBE-llEp5T-k7uf80wyw", "use": "both",
     "home": "https://www.youtube.com/@Investingcom-kr/videos"},

    # ── 뉴스레터·미디어 ────────────────────────────────────────────────
    {"key": "newneek_yt", "name": "뉴닉 유튜브", "group": "뉴스레터·미디어",
     "kind": "yt", "url": "UCwx-KT3brOF-oPjcpA_nMJw", "use": "news",
     "home": "https://newneek.co/"},
    {"key": "uppity_web", "name": "어피티(머니레터)", "group": "뉴스레터·미디어",
     "kind": "rss", "url": "https://uppity.co.kr/rss", "use": "both",
     "home": "https://uppity.co.kr/"},
    {"key": "uppity_yt", "name": "어피티 유튜브", "group": "뉴스레터·미디어",
     "kind": "yt", "url": "UC8d2HkvVNQlRasXm6yXUw0Q", "use": "both",
     "home": "https://www.youtube.com/@uppity_official/videos"},
    {"key": "soonsal_web", "name": "순살브리핑(글)", "group": "뉴스레터·미디어",
     "kind": "rss", "url": "https://soonsal.com/rss", "use": "both",
     "home": "https://soonsal.com/"},
    {"key": "soonsal_yt", "name": "순살브리핑 유튜브", "group": "뉴스레터·미디어",
     "kind": "yt", "url": "UCAlHlhp6Ug62sP8C6akctmQ", "use": "both",
     "home": "https://www.youtube.com/@soonsal/videos"},
    {"key": "moneygraphy_yt", "name": "머니그라피", "group": "뉴스레터·미디어",
     "kind": "yt", "url": "UCwXOKS-z1t9u6Axmm3blXug", "use": "both",
     "home": "https://www.youtube.com/@Moneygraphy/videos"},
    {"key": "kcie_yt", "name": "투교협(투자 교육)", "group": "뉴스레터·미디어",
     "kind": "yt", "url": "UCBryaPNZJE5bcaKxJO-PasA", "use": "news",
     "home": "https://www.kcie.or.kr/mobile/guide/series/0/"},

    # ── 해외 매체 ──────────────────────────────────────────────────────
    {"key": "bloomberg_yt", "name": "블룸버그 TV", "group": "해외 매체",
     "kind": "yt", "url": "UCIALMKvObZNtJ6AmdCLP7Lg", "use": "both",
     "home": "https://www.youtube.com/@markets/videos"},
    {"key": "cnbc_top", "name": "CNBC 톱뉴스", "group": "해외 매체",
     "kind": "rss", "use": "both", "home": "https://www.cnbc.com/",
     "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"},
    {"key": "cnbc_world", "name": "CNBC 세계 시장", "group": "해외 매체",
     "kind": "rss", "use": "both", "home": "https://www.cnbc.com/world-markets/",
     "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362"},
    {"key": "wsj_world", "name": "WSJ 세계", "group": "해외 매체",
     "kind": "rss", "url": "https://feeds.a.dj.com/rss/RSSWorldNews.xml", "use": "news",
     "home": "https://www.wsj.com/"},
    {"key": "wsj_markets", "name": "WSJ 마켓", "group": "해외 매체",
     "kind": "rss", "url": "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "use": "both",
     "home": "https://www.wsj.com/finance"},
    {"key": "ft_home", "name": "파이낸셜타임즈", "group": "해외 매체",
     "kind": "rss", "url": "https://www.ft.com/rss/home", "use": "both",
     "home": "https://www.ft.com/"},
    {"key": "ft_yt", "name": "FT 유튜브", "group": "해외 매체",
     "kind": "yt", "url": "UCoUxsWakJucWg46KW5RsvPw", "use": "news",
     "home": "https://www.youtube.com/@FinancialTimes/videos"},
    {"key": "econo_fin", "name": "이코노미스트 금융", "group": "해외 매체",
     "kind": "rss", "url": "https://www.economist.com/finance-and-economics/rss.xml",
     "use": "both", "home": "https://www.economist.com/"},
    {"key": "econo_biz", "name": "이코노미스트 비즈니스", "group": "해외 매체",
     "kind": "rss", "url": "https://www.economist.com/business/rss.xml",
     "use": "both", "home": "https://www.economist.com/"},
    {"key": "visualcap_web", "name": "비주얼 캐피탈리스트", "group": "해외 매체",
     "kind": "rss", "url": "https://www.visualcapitalist.com/feed/", "use": "both",
     "home": "https://www.visualcapitalist.com/"},
    {"key": "visualcap_yt", "name": "비주얼캡 유튜브", "group": "해외 매체",
     "kind": "yt", "url": "UCc3e9XOO_neg3mnb9yDTklg", "use": "news",
     "home": "https://www.youtube.com/@visualcap/videos"},
]

GROUP_ORDER = ["국내 증권사·투자", "뉴스레터·미디어", "해외 매체"]

_ATOM = {"a": "http://www.w3.org/2005/Atom"}
_TAG = re.compile(r"<[^>]+>")

# 소스별 캐시. (시각, 항목들). 10분 안에는 다시 받지 않는다 - 유튜브가 연속 요청에
# 500 을 던지는 것을 실측했고, 후보 목록이 10분 사이 바뀔 일도 없다.
_CACHE: dict[str, tuple[float, list]] = {}
_CACHE_TTL = 600
_CACHE_LOCK = threading.Lock()

# 유튜브에 한꺼번에 몰려가면 500 이 오므로 동시에 3개까지만 간다.
_YT_GATE = threading.Semaphore(3)


def _get(url: str, timeout: int = 12) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _clean(text: str) -> str:
    return _TAG.sub("", unescape(text or "")).strip()


def _fmt(dt: datetime | None) -> tuple[str, float]:
    if not dt:
        return "", 0.0
    if not dt.tzinfo:
        dt = dt.replace(tzinfo=KST)
    return dt.astimezone(KST).strftime("%m-%d %H:%M"), dt.timestamp()


def _parse_when(raw: str) -> datetime | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:                                    # RFC822 (RSS pubDate)
        return parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        pass
    try:                                    # ISO (유튜브 published)
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fetch_yt(src: dict, per: int) -> list[dict]:
    # 유튜브는 연속 요청에 일시적 500 을 잘 던진다(실측). 한 번은 쉬었다 다시 간다.
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={src['url']}"
    with _YT_GATE:
        for wait in (1.5, 3.0):
            try:
                raw = _get(url)
                break
            except Exception:
                time.sleep(wait)
        else:
            raw = _get(url)
    root = ET.fromstring(raw)
    out = []
    for e in root.findall("a:entry", _ATOM)[:per]:
        title = _clean(e.findtext("a:title", "", _ATOM))
        link_el = e.find("a:link", _ATOM)
        link = link_el.get("href") if link_el is not None else ""
        when, ts = _fmt(_parse_when(e.findtext("a:published", "", _ATOM)))
        if title and link:
            out.append({"title": title, "link": link, "when": when, "ts": ts,
                        "media": "영상"})
    return out


def _fetch_rss(src: dict, per: int) -> list[dict]:
    raw = _get(src["url"])
    root = ET.fromstring(raw)
    items = root.findall(".//item")
    out = []
    if items:                               # RSS 2.0
        for it in items[:per]:
            title = _clean(it.findtext("title") or "")
            link = (it.findtext("link") or "").strip()
            when, ts = _fmt(_parse_when(it.findtext("pubDate") or ""))
            if title and link:
                out.append({"title": title, "link": link, "when": when, "ts": ts,
                            "media": "글"})
    else:                                   # Atom
        for e in root.findall(".//a:entry", _ATOM)[:per]:
            title = _clean(e.findtext("a:title", "", _ATOM))
            link_el = e.find("a:link", _ATOM)
            link = link_el.get("href") if link_el is not None else ""
            when, ts = _fmt(_parse_when(e.findtext("a:updated", "", _ATOM)))
            if title and link:
                out.append({"title": title, "link": link, "when": when, "ts": ts,
                            "media": "글"})
    return out


def _fetch_one(src: dict, per: int) -> tuple[str, list, str]:
    """(키, 항목들, 오류문구). 실패는 예외가 아니라 문구로 돌려준다."""
    key = src["key"]
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit and time.time() - hit[0] < _CACHE_TTL:
            return key, hit[1], ""
    try:
        rows = (_fetch_yt if src["kind"] == "yt" else _fetch_rss)(src, per)
    except Exception as e:                  # 한 소스가 죽어도 나머지는 간다
        return key, [], f"{type(e).__name__}"
    for r in rows:
        r["key"] = key
        r["source"] = src["name"]
        r["group"] = src["group"]
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), rows)
    return key, rows, ""


def listing(use: str = "") -> list[dict]:
    """소스 목록(내용은 안 받는다). 화면의 체크박스 거리."""
    out = []
    for s in SOURCES:
        if use and s["use"] not in (use, "both"):
            continue
        out.append({"key": s["key"], "name": s["name"], "group": s["group"],
                    "media": "영상" if s["kind"] == "yt" else "글",
                    "home": s.get("home", "")})
    return out


def fetch(keys=None, use: str = "", per: int = 8, workers: int = 8) -> dict:
    """고른 소스들의 최신 항목. 항목은 새것부터.

    keys 가 비면 use 에 해당하는 전부를 받는다. 소스 하나가 늦거나 죽어도
    나머지는 그대로 오고, 죽은 소스는 errors 에 이름이 실린다.
    """
    wanted = []
    keyset = set(keys or [])
    for s in SOURCES:
        if keyset and s["key"] not in keyset:
            continue
        if not keyset and use and s["use"] not in (use, "both"):
            continue
        wanted.append(s)
    if not wanted:
        return {"items": [], "errors": [], "fetched": 0}

    items, errors = [], []
    with ThreadPoolExecutor(max_workers=min(workers, len(wanted))) as ex:
        for key, rows, err in ex.map(lambda s: _fetch_one(s, per), wanted):
            items.extend(rows)
            if err:
                name = next((s["name"] for s in SOURCES if s["key"] == key), key)
                errors.append({"key": key, "name": name, "error": err})

    items.sort(key=lambda r: -(r.get("ts") or 0))
    return {"items": items, "errors": errors, "fetched": len(wanted) - len(errors)}
