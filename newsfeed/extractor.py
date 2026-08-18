# -*- coding: utf-8 -*-
"""기사 URL -> 제목 / 본문 / 후보 이미지 추출 (표준 라이브러리만 사용).

readability 계열 알고리즘의 축소판. 한국 언론사 대부분이 cp949/euc-kr 을
아직 쓰기 때문에 인코딩 판별을 별도로 처리한다.
"""
from __future__ import annotations

import gzip
import io
import re
import ssl
import zlib
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}
DROP = {"script", "style", "noscript", "iframe", "svg", "form", "button",
        "aside", "nav", "footer", "header", "figcaption"}

GOOD = re.compile(r"article|news|content|body|entry|read|view|text|post|story|se_component", re.I)
BAD = re.compile(r"comment|reply|sidebar|foot|head|nav|menu|banner|advert|"
                 r"\bad\b|ads|promo|related|recommend|share|sns|copyright|"
                 r"breadcrumb|pagination|tag|reporter|byline", re.I)
BAD_IMG = re.compile(r"logo|icon|banner|btn|button|sprite|blank|spacer|dummy|"
                     r"profile|avatar|emoticon|share|sns|ad[_\-/]|/ads?/|1x1|"
                     r"pixel|watermark", re.I)

# 기사 하단 상투구 제거
NOISE_LINE = re.compile(
    r"(무단\s*전재|재배포\s*금지|저작권자|ⓒ|Copyright|All rights reserved|"
    r"^\s*\[?사진\s*[=＝:]|^\s*사진\s*제공|기자\s*$|@[\w.\-]+\.(?:com|co\.kr|net|kr)|"
    r"^\s*※|구독하기|네이버에서|카카오톡|제보|댓글|사진기자단|"
    # 다음(Daum) 이 본문 위에 끼워 넣는 자동요약 안내
    r"^\s*자동요약\s*$|기사 제목과 주요 문장을 기반으로 자동요약|"
    r"전체 맥락을 이해하기 위해서는|본문 보기를 권장|요약봇이 자동 요약한|"
    r"[〈<＜《]\s*(?:사진|자료|그래픽)\s*[=＝]|"
    r"^\s*이미지\s*확대|^\s*확대\s*보기|크게\s*보기|^\s*원본\s*보기)", re.I)

# ── 언론사 상투·홍보 문구 ────────────────────────────────────────────────
# 코너 소개문이 본문에 섞여 들어오면 캡션에 "그 매체가 다르게 짚은 대목" 인 것처럼
# 올라간다. 실측 사례: 경인일보 "경인 의원들이 주도하는 우리 삶의 어젠다,
# 건강하고 건전한 정책 경쟁을 조명합니다" — 기사가 아니라 코너 소개다.
PROMO_LINE = re.compile(
    # 코너·연재 소개 (…을 조명합니다 / 소개합니다 / 연재합니다 …)
    r"(조명합니다|소개합니다|연재합니다|전해드립니다|전해 드립니다|찾아갑니다|"
    r"짚어봅니다|짚어 봅니다|만나봅니다|만나 봅니다|담아냅니다|알아봅니다|"
    r"함께합니다|함께 합니다|보내주세요|보내 주세요|만나보세요|만나 보세요|"
    # 연재물 머리표
    r"^\s*\[[^\]]{0,20}(연재|기획|시리즈|칼럼|코너)[^\]]{0,20}\]|"
    r"(이|은|는)?\s*(연재|기획)\s*(기사|물|시리즈)\s*(입니다|이다)|"
    # 구독·후원·팔로우 유도
    r"구독|후원|채널\s*추가|친구\s*추가|팔로우|즐겨찾기|알림\s*설정|"
    # 제보·문의·보도자료
    r"보도자료|광고\s*문의|기사\s*문의|제휴\s*문의|"
    # 앱·홈페이지 유도
    r"바로가기|자세히\s*보기|더\s*보기|앱에서\s*보기|홈페이지에서|"
    # 최근 많이 붙는 AI 학습 금지 고지
    r"AI\s*학습|인공지능\s*학습|"
    # 유도 줄머리 기호
    r"^\s*[▶▷☞➤]|^\s*\[\s*(?:관련기사|함께\s*보면)\s*\])", re.I)

# 본문 문장인지 보는 종결 어미. 한국 기사 본문은 '-다' 로 끝난다.
ENDS_DA = re.compile(r"(다|음|함|됨|임)[.\"'”’」』\)\s]*$")
ENDS_YO = re.compile(r"(습니다|합니다|입니다|됩니다|십시오|세요|해요|예요)[.!?\"'”’\s]*$")


class Node:
    __slots__ = ("tag", "attrs", "children", "parent", "text")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children = []
        self.parent = parent
        self.text = ""

    def iter(self):
        yield self
        for c in self.children:
            if isinstance(c, Node):
                yield from c.iter()

    def all_text(self, sep=""):
        out = []
        for n in self.iter():
            if n.tag == "#text":
                out.append(n.text)
            elif n.tag in ("br", "p", "div", "li"):
                out.append("\n")
        return sep.join(out)

    def sig(self):
        return f"{self.attrs.get('id', '')} {self.attrs.get('class', '')}"


class Tree(HTMLParser):
    """관대한 파서: 닫는 태그가 어긋나도 트리를 유지한다."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.cur = self.root
        self.meta = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            self.meta.append(a)
            return
        if tag == "title":
            self._in_title = True
            return
        if tag in VOID:
            self.cur.children.append(Node(tag, a, self.cur))
            return
        n = Node(tag, a, self.cur)
        self.cur.children.append(n)
        self.cur = n

    def handle_startendtag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            self.meta.append(a)
        else:
            self.cur.children.append(Node(tag, a, self.cur))

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
            return
        if tag in VOID:
            return
        n = self.cur
        while n is not self.root:
            if n.tag == tag:
                self.cur = n.parent or self.root
                return
            n = n.parent or self.root
        # 짝이 없는 닫는 태그는 무시

    def handle_data(self, data):
        if self._in_title:
            self.title += data
            return
        if not data.strip():
            return
        p = self.cur
        while p is not None and p is not self.root:
            if p.tag in DROP:
                return
            p = p.parent
        t = Node("#text", {}, self.cur)
        t.text = data
        self.cur.children.append(t)


def _decode(raw: bytes, ctype: str) -> str:
    m = re.search(rb'charset\s*=\s*["\']?\s*([\w\-]+)', raw[:8192], re.I)
    cands = []
    if m:
        cands.append(m.group(1).decode("ascii", "ignore"))
    m2 = re.search(r"charset\s*=\s*([\w\-]+)", ctype or "", re.I)
    if m2:
        cands.append(m2.group(1))
    cands += ["utf-8", "cp949", "euc-kr", "latin-1"]
    for enc in cands:
        enc = {"ks_c_5601-1987": "cp949", "euckr": "euc-kr",
               "utf8": "utf-8"}.get(enc.lower(), enc)
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "replace")


def fetch(url: str, referer: str = "", timeout: int = 20):
    """(bytes, content_type, final_url) 반환."""
    headers = {"User-Agent": UA,
               "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
               "Accept": "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
               "Accept-Encoding": "gzip, deflate"}
    if referer:
        headers["Referer"] = referer
    req = Request(url, headers=headers)
    try:
        r = urlopen(req, timeout=timeout)
    except ssl.SSLError:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        r = urlopen(req, timeout=timeout, context=ctx)
    raw = r.read()
    enc = (r.headers.get("Content-Encoding") or "").lower()
    if enc == "gzip":
        try:
            raw = gzip.decompress(raw)
        except OSError:
            pass
    elif enc == "deflate":
        try:
            raw = zlib.decompress(raw, -zlib.MAX_WBITS)
        except zlib.error:
            pass
    return raw, r.headers.get("Content-Type", ""), r.geturl()


def _meta(metas, *names):
    for a in metas:
        key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
        if key in names and a.get("content", "").strip():
            return unescape(a["content"]).strip()
    return ""


# 포털 이름은 언론사가 아니다
PORTAL = ("네이버", "네이버 뉴스", "naver", "daum", "다음", "다음뉴스", "카카오", "nate", "네이트")


def _clean_press(raw: str) -> str:
    """'Daum | 연합뉴스' / '이데일리 | 네이버' 에서 진짜 언론사만 남긴다."""
    parts = [p.strip() for p in re.split(r"[|·ㅣ/]", raw or "") if p.strip()]
    real = [p for p in parts if p.lower() not in PORTAL]
    return (real[0] if real else (parts[0] if parts else "")).strip()


def _clean_text(raw: str) -> str:
    lines = []
    for ln in raw.split("\n"):
        ln = re.sub(r"[ \t ​]+", " ", ln).strip()
        if not ln or len(ln) < 2:
            continue
        if NOISE_LINE.search(ln):
            continue
        lines.append(ln)
    lines = _drop_promo(lines)
    # 연속 중복 제거
    out = []
    for ln in lines:
        if not out or out[-1] != ln:
            out.append(ln)
    return "\n".join(out)


def _drop_promo(lines):
    """언론사 코너 소개·구독 유도 같은 상투 문구를 걷어낸다.

    두 가지로 잡는다.

      ① 대놓고 드러나는 말투 — `PROMO_LINE` (…조명합니다 / 구독 / ▶ …)
      ② **문체가 튀는 줄** — 한국 기사 본문은 '-다' 로 끝난다(했다·밝혔다·이다).
         코너 소개·안내문은 '-습니다' 체다. 그래서 본문 대부분이 '-다' 체일 때
         혼자 '-습니다' 로 끝나는 긴 줄은 기사 문장이 아니라고 본다.

    🔴 ②는 **본문이 '-다' 체일 때만** 쓴다. 방송사 기사처럼 처음부터 끝까지 존댓말인
    글에 그냥 걸면 본문을 통째로 지운다. 그래서 비율을 먼저 세고 판단한다.
    """
    if not lines:
        return lines

    long_lines = [l for l in lines if len(re.sub(r"\s", "", l)) >= 25]
    da = sum(1 for l in long_lines if ENDS_DA.search(l))
    yo = sum(1 for l in long_lines if ENDS_YO.search(l))
    da_style = (len(long_lines) >= 4 and da >= max(3, int(len(long_lines) * 0.6))
                and da > yo * 2)

    out = []
    for ln in lines:
        if PROMO_LINE.search(ln):
            continue
        if da_style and len(re.sub(r"\s", "", ln)) >= 25 and ENDS_YO.search(ln):
            continue                      # '-다' 체 본문에 혼자 섞인 '-습니다' 줄
        out.append(ln)
    # 다 지워 버렸으면 판단이 틀린 것이므로 원래대로 둔다
    return out or lines


def _score(node: Node) -> float:
    text = node.all_text()
    tl = len(re.sub(r"\s", "", text))
    if tl < 120:
        return -1e9
    link = 0
    for n in node.iter():
        if n.tag == "a":
            link += len(re.sub(r"\s", "", n.all_text()))
    ps = sum(1 for n in node.iter() if n.tag == "p")
    brs = sum(1 for n in node.iter() if n.tag == "br")
    s = tl - 2.5 * link + 30 * ps + 6 * brs
    sig = node.sig()
    if GOOD.search(sig):
        s += 250
    if BAD.search(sig):
        s -= 400
    if node.tag == "article":
        s += 300
    if node.attrs.get("itemprop", "").lower() == "articlebody":
        s += 400
    # 지나치게 깊은 래퍼 선호 방지
    return s


def _img_urls(node: Node, base: str):
    urls = []
    for n in node.iter():
        if n.tag != "img":
            continue
        a = n.attrs
        src = (a.get("data-src") or a.get("data-original") or a.get("data-lazy-src")
               or a.get("src") or "")
        if not src and a.get("srcset"):
            src = a["srcset"].split(",")[0].strip().split(" ")[0]
        if not src or src.startswith("data:"):
            continue
        try:
            w = int(re.sub(r"\D", "", a.get("width", "") or "0") or 0)
            h = int(re.sub(r"\D", "", a.get("height", "") or "0") or 0)
        except ValueError:
            w = h = 0
        if (w and w < 250) or (h and h < 200):
            continue
        full = urljoin(base, unescape(src))
        p = urlparse(full)
        if BAD_IMG.search(p.path):
            continue
        # 네이버는 관련기사 썸네일을 type=nf352_352 / nfs690_388 로 내보낸다.
        # 본문 사진은 type=w860 처럼 w 로 시작하므로 nf 계열만 걷어낸다.
        if re.search(r"type=nfs?\d", p.query) or "/tvcast/" in p.path:
            continue
        urls.append(full)
    return urls


def extract(url: str) -> dict:
    raw, ctype, final = fetch(url)
    html = _decode(raw, ctype)
    t = Tree()
    try:
        t.feed(html)
    except Exception:
        pass

    title = (_meta(t.meta, "og:title", "twitter:title") or t.title or "").strip()
    title = re.sub(r"\s*[|\-–:>ㅣ]\s*[^|\-–:>ㅣ]{1,25}$", "", title).strip()

    # 언론사: 포털은 'Daum | 연합뉴스', '이데일리 | 네이버' 처럼 붙여 내보낸다.
    press = _clean_press(_meta(t.meta, "og:article:author", "article:media_name",
                               "og:site_name", "dable:author"))
    date = _meta(t.meta, "article:published_time", "og:regdate", "og:regdate".lower(),
                 "date", "pubdate", "datepublished")
    if not date:
        # 네이버는 메타 대신 본문 위 표기에만 시각을 둔다
        m = re.search(r'data-date-time="([^"]+)"', html) or \
            re.search(r'"datePublished"\s*:\s*"([^"]+)"', html)
        if m:
            date = m.group(1).strip()

    best, best_s = None, -1e9
    for n in t.root.iter():
        if n.tag not in ("div", "article", "section", "td", "main", "body"):
            continue
        s = _score(n)
        if s > best_s:
            best, best_s = n, s

    body = _clean_text(best.all_text()) if best is not None else ""
    if len(re.sub(r"\s", "", body)) < 150:
        body = _clean_text(t.root.all_text())

    imgs = []
    for u in ([_meta(t.meta, "og:image", "twitter:image")] +
              (_img_urls(best, final) if best is not None else []) +
              _img_urls(t.root, final)):
        if u and u not in imgs:
            imgs.append(urljoin(final, u))

    return {"ok": True, "url": final, "title": title, "press": press,
            "date": date, "body": body, "images": imgs[:24]}
