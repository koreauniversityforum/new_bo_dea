# -*- coding: utf-8 -*-
"""규칙 기반 한국어 기사 요약 / 제목 / 후킹 문구 생성 (외부 패키지 없음).

형태소 분석기를 쓰지 않고 조사·어미 절단 + 빈도 기반 문장 랭킹으로 처리한다.
정확한 문법 분석이 아니라 '카드뉴스에 얹을 후보를 여러 개 뽑아 사람이 고른다'는
전제로 설계했다. 그래서 모든 함수는 단일 정답이 아니라 후보 리스트를 돌려준다.
"""
from __future__ import annotations

import re
from collections import Counter

# ── 조사/어미 절단용 ──────────────────────────────────────────────────────
JOSA = ("으로서", "으로써", "이라고", "라고", "에서는", "에게서", "께서는", "에서도",
        "으로는", "이라는", "라는", "만큼", "처럼", "부터", "까지", "에게", "한테",
        "께서", "에서", "으로", "이나", "보다", "밖에", "조차", "마저", "이란",
        "와의", "과의", "의", "은", "는", "이", "가", "을", "를", "에", "로",
        "와", "과", "도", "만", "라", "야", "인")

STOP = set("""
그리고 그러나 하지만 또한 이번 지난 오늘 내일 어제 대해 대한 통해 위해 위한 관련
있다 없다 했다 한다 된다 됐다 이다 아니 같은 같이 매우 가장 모든 여러 다른 이런 저런
그런 우리 자신 사람 경우 때문 이후 이전 현재 최근 당시 기자 뉴스 사진 제공 무단 전재
배포 금지 저작권자 라며 면서 이라며 밝혔 전했 말했 설명 강조 지적 것으로 것이다 이라고
등의 등을 등이 대변인 관계자 오전 오후 이날 지난해 올해 내년 억원 만원 정도 수준 계획
""".split())

NEG = ("논란", "비판", "우려", "갈등", "무너", "위기", "파문", "의혹", "반발", "지적",
       "미달", "부실", "실패", "하락", "감소", "폐지", "축소", "불만", "충돌", "적자",
       "피해", "붕괴", "혼란", "공방", "반대", "규탄", "사퇴", "고발", "경고", "불신")
POS = ("성과", "성공", "협약", "출범", "유치", "선정", "수상", "확대", "증가", "최초",
       "돌파", "합의", "타결", "개선", "지원", "설립", "달성", "회복", "호평", "기대")

# 서술어 → 명사형 (제목 압축용)
VERB2NOUN = [
    (r"(개최|열)(했|었|한|린)다", "개최"), (r"(밝|드러)(혔|났)다", "밝혀"),
    (r"촉구(했|한)다", "촉구"), (r"요구(했|한)다", "요구"),
    (r"발표(했|한)다", "발표"), (r"제안(했|한)다", "제안"),
    (r"논의(했|한)다", "논의"), (r"합의(했|한)다", "합의"),
    (r"체결(했|한)다", "체결"), (r"점검(했|한)다", "점검"),
    (r"추진(했|한)다", "추진"), (r"결정(했|한)다", "결정"),
    (r"확정(됐|된)다", "확정"), (r"통과(됐|된)다", "통과"),
    (r"선정(됐|된)다", "선정"), (r"비판(했|한)다", "비판"),
    (r"강조(했|한)다", "강조"), (r"지적(했|한)다", "지적"),
    (r"마련(했|한)다", "마련"), (r"모(았|은)다", "모아"),
    (r"나(섰|선)다", "나서"), (r"돌입(했|한)다", "돌입"),
    (r"공개(했|한)다", "공개"), (r"착수(했|한)다", "착수"),
    (r"방문(했|한)다", "방문"), (r"참석(했|한)다", "참석"),
    (r"진행(됐|된|했|한)다", "진행"), (r"실시(했|한)다", "실시"),
    (r"도입(했|한)다", "도입"), (r"시작(했|한)다", "시작"),
]

# 긴 직함을 먼저 둬야 '국무위원장'이 '위원장'으로 잘리지 않는다
TITLED = ("국무위원장", "부위원장", "특별위원장", "사무총장", "부총장", "이사장",
          "당대표", "후보", "의원", "장관", "총장", "대표", "위원장", "회장",
          "교수", "차관", "청장",
          "시장", "지사", "대통령", "국장", "본부장", "센터장", "단장", "총리",
          "처장", "실장", "학회장", "학장", "과장", "팀장")

# 인물명 자리에 와도 사람이 아닌 것들 (정당·기관)
PARTY = ("국민의힘", "더불어민주당", "민주당", "정의당", "개혁신당", "조국혁신당",
         "진보당", "기본소득당", "사회민주당", "무소속", "여당", "야당", "국회",
         "정부", "청와대", "대통령실", "시의회", "구의회", "교육청")
STRONG_MOD = ("긴급", "첫", "합동", "공개", "비공개", "연석", "임시", "특별", "대규모",
              "전국", "제1차", "1차", "확대")
# 후킹 문구에 얹기 좋은 가치 명사 (앞쪽이 우선)
VALUE = ("신뢰", "투명성", "공정성", "민주주의", "중립성", "원칙", "상식", "정의",
         "안전", "형평성", "자율성", "권리", "책임", "약속")
# 키워드로 뽑혀도 카드 문구엔 못 쓰는 일반명사
GENERIC = set(TITLED) | {"관계자", "참석자", "참석자들", "대표들", "기자", "단체",
                         "여부", "방안", "문제", "제도", "관련", "당시", "국민",
                         "이번", "내용", "결과", "상황", "부분", "중요"}
ORG_SUF = ("위원회", "협회", "재단", "연구원", "대학교", "대학", "정부", "부처", "청",
           "공사", "공단", "학회", "연합회", "총학생회", "단체", "본부", "센터",
           "포럼", "네트워크", "노조", "국회", "법원", "검찰", "경찰")
EVENT = ("간담회", "토론회", "세미나", "포럼", "설명회", "공청회", "기자회견", "협약식",
         "발대식", "출범식", "간부회의", "회의", "면담", "워크숍", "컨퍼런스", "총회",
         "선포식", "개막식", "박람회", "campaign", "캠페인", "공모전", "대회", "축제")


# ── 기본 유틸 ─────────────────────────────────────────────────────────────
def _norm(text: str) -> str:
    """붙여넣기한 원문에도 통하도록 상투구·기자 서명·저작권 표기를 걷어낸다."""
    text = text.replace("​", " ").replace("\xa0", " ")
    text = re.sub(r"\[[^\]]{0,40}\]", " ", text)          # [사진=뉴시스] 류
    # 〈사진=국회사진기자단〉 처럼 홑화살괄호로 감싼 사진 출처
    text = re.sub(r"[〈<＜《]\s*(?:사진|자료|그래픽|영상|표)[^〉>＞》]{0,40}[〉>＞》]", " ", text)
    text = re.sub(r"\([^)]{0,30}기자[^)]{0,10}\)", " ", text)
    text = re.sub(r"^\s*이미지\s*확대", " ", text, flags=re.M)
    # 데이트라인 '(서울=연합뉴스) 김효정 기자 =' 를 통째로 제거
    text = re.sub(r"\([^)]{0,40}[=＝][^)]{0,20}\)\s*(?:[가-힣]{2,5}\s*기자)?\s*[=＝]?\s*",
                  " ", text)
    text = re.sub(r"[ⓒ©]\s*[^\n]{0,40}", " ", text)
    text = re.sub(r"(무단\s*전재|재배포\s*금지|저작권자)[^\n]{0,30}", " ", text)
    text = re.sub(r"[\w.\-]+@[\w.\-]+\.[A-Za-z]{2,}", " ", text)
    text = re.sub(r"[가-힣]{2,4}\s*기자\b", " ", text)     # '기자회견'은 \b 때문에 안 걸림
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def sentences(text: str):
    """한국어 문장 분리: 종결어미/구두점 기준."""
    text = _norm(text)
    parts = re.split(
        r"(?<=[다요임함음])\.\s+|(?<=[.!?])\s+|\n+", text)
    out = []
    for p in parts:
        p = (p or "").strip(" \t·-—•ㅇ")
        # '(서울=연합뉴스) 홍길동 기자 =' 의 잔해
        p = re.sub(r"^[=＝]\s*", "", p).strip()
        if not p:
            continue
        if not re.search(r"[가-힣]", p):
            continue
        body = re.sub(r"\s", "", p)
        if len(body) < 12 or len(body) > 220:
            continue
        if p.count("”") + p.count("\"") > 6:
            continue
        out.append(p if p.endswith((".", "!", "?", "다", "요")) else p)
    return out


def is_deck(s: str) -> bool:
    """언론사 부제(데크) 줄 판별.

    '원산 일대서 1발…軍 "…분석중"탄도미사일은 42일만…' 처럼 여러 토막을 말줄임표로
    이어 붙이고 종결어미가 없다. 문장으로 치면 요약을 통째로 잠식하므로 감점한다.
    """
    s = s.strip()
    return ("…" in s or "ㆍ" in s) and not re.search(r"(다|요)$|[.!?]$", s)


def clean_quote(q: str) -> str:
    """따옴표 짝이 어긋나 잡힌 조각('고 전했다. 이어' 등)을 걸러낸다."""
    q = re.sub(r"\s+", " ", q or "").strip(" .·,")
    q = re.sub(r"(라고|이라고)$", "", q).strip()
    if re.match(r"^(고|며|면서|라고|이라고|는|은|이|가|을|를|에|와|과|도)\b", q):
        return ""
    if re.search(r"(다|요)\.\s", q):        # 문장 경계를 넘어선 잘못된 짝
        return ""
    if len(re.sub(r"[^가-힣A-Za-z0-9]", "", q)) < 5:
        return ""
    return q


def _strip_josa(tok: str) -> str:
    if not re.match(r"^[가-힣]+$", tok):
        return tok
    for j in JOSA:
        if len(tok) - len(j) >= 2 and tok.endswith(j):
            return tok[: -len(j)]
    return tok


def tokens(text: str):
    out = []
    for raw in re.findall(r"[가-힣]{2,}|[A-Za-z]{3,}|\d{2,}%?", text):
        t = _strip_josa(raw)
        if len(t) < 2 or t in STOP:
            continue
        if re.match(r"^\d+$", t):
            continue
        out.append(t)
    return out


def keywords(text: str, n: int = 12):
    c = Counter(tokens(text))
    # 긴 단어(복합명사)에 가중치
    scored = {w: f * (1 + 0.25 * (len(w) - 2)) for w, f in c.items()}
    return [w for w, _ in sorted(scored.items(), key=lambda kv: -kv[1])[:n]]


def bigrams(text: str, n: int = 6):
    """'선거 관리', '선관위 개혁' 처럼 붙어 다니는 두 단어 묶음."""
    c = Counter()
    for s in sentences(text) or [text]:
        tk = tokens(s)
        for a, b in zip(tk, tk[1:]):
            if a in GENERIC or b in GENERIC or a == b:
                continue
            c[a + " " + b] += 1
    return [w for w, f in c.most_common(n) if f >= 2]


def topics(text: str, n: int = 10):
    """카드 문구용 소재어: 두 단어 묶음을 앞세우고 일반명사는 뺀다."""
    out = list(bigrams(text, 4))
    for k in keywords(text, n * 2):
        if k in GENERIC or any(k in b for b in out):
            continue
        out.append(k)
    return out[:n]


# ── 요약 ──────────────────────────────────────────────────────────────────
def rank_sentences(text: str, title: str = ""):
    sents = sentences(text)
    if not sents:
        return []
    freq = Counter(tokens(text))
    if not freq:
        return [(s, 0.0) for s in sents]
    top = freq.most_common(1)[0][1]
    tset = set(tokens(title))
    scored = []
    for i, s in enumerate(sents):
        tk = tokens(s)
        if not tk:
            continue
        base = sum(freq[t] / top for t in set(tk))
        sc = base / (len(set(tk)) ** 0.5)
        sc += 0.45 * max(0.0, 1 - i / 8)                   # 리드 문장 가산
        sc += 0.30 * len(tset & set(tk)) / (len(tset) + 1)  # 제목 어휘 일치
        n = len(re.sub(r"\s", "", s))
        if 35 <= n <= 110:
            sc += 0.2
        if '"' in s or "”" in s:
            sc += 0.12                                     # 직접 인용 선호
        if is_deck(s):
            sc -= 1.2                                      # 부제 줄은 뒤로
        scored.append((i, s, sc))
    scored.sort(key=lambda x: -x[2])
    return [(s, sc) for _, s, sc in scored]


def _compress(s: str, limit: int) -> str:
    """카드 하단 설명문용 압축: 군더더기 제거 후 글자수 맞춤."""
    s = re.sub(r"^\s*(한편|또한|그러나|하지만|이어|아울러|특히|앞서)[,\s]+", "", s)
    s = re.sub(r"\s*\([^)]*\)", "", s)
    s = re.sub(r"^\s*[=＝·]\s*", "", s)          # 괄호를 턴 뒤 남는 데이트라인 잔해
    s = re.sub(r"[ ]{2,}", " ", s).strip()
    if len(s) <= limit:
        return s
    cut = s[:limit]
    m = re.search(r"^(.*[,·\s])[^,·\s]*$", cut)
    if m and len(m.group(1)) > limit * 0.6:
        cut = m.group(1)
    return cut.rstrip(" ,·") + "…"


def summarize(text: str, title: str = "", limit: int = 95, n: int = 2):
    """카드 하단에 얹을 요약문 후보 3개."""
    ranked = rank_sentences(text, title)
    if not ranked:
        return []
    sents = sentences(text)
    order = {s: i for i, s in enumerate(sents)}

    def join(picked):
        picked = sorted(set(picked), key=lambda s: order.get(s, 999))
        joined = " ".join(
            s if s.endswith((".", "!", "?", '"', "”")) else s + "." for s in picked)
        return _compress(joined, limit)

    lead = next((s for s in sents if not is_deck(s)), sents[0])
    cands = []
    cands.append(join([s for s, _ in ranked[:n]]))          # 핵심 n문장
    cands.append(_compress(lead, limit))                    # 리드 문장
    if len(ranked) > 1:
        cands.append(join([ranked[0][0], ranked[1][0], ranked[2][0]]
                          if len(ranked) > 2 else [ranked[0][0], ranked[1][0]]))
    for q in re.findall(r"[\"“]([^\"”]{15,90})[\"”]", text):
        q = clean_quote(q)
        if q:
            cands.append(_compress('"' + q + '"', limit))
            break
    out = []
    for c in cands:
        c = (c or "").strip()
        if c and c not in out:
            out.append(c)
    return out[:4]


# ── 제목 ──────────────────────────────────────────────────────────────────
def _actor(text: str, prefer: str = "") -> str:
    """기사 주인공(인물+직함 또는 기관) 추출.

    '윤상현 국민의힘 의원' 처럼 이름과 직함 사이에 소속이 끼는 형태가 흔해서
    직함 바로 앞 어절만 보면 정당명을 사람 이름으로 착각한다. 소속을 건너뛰고
    맨 앞 어절을 이름 후보로 잡되, 정당·기관명이면 다음 매치로 넘어간다.
    prefer(원문 제목)에 나오는 이름이 있으면 그쪽을 우선한다 — 본문에는 곁가지
    인물이 함께 등장해서 먼저 매칭될 수 있기 때문이다.
    """
    # 기사 본문은 첫 언급 뒤로 '정 후보는'처럼 성씨만 남긴다. 전체 이름은 보통
    # 제목 앞머리에만 있으므로, 제목의 인명과 본문의 직함을 이어 붙인다.
    m = re.match(r"^\s*([가-힣]{2,4})\s*[,\"“:·]", prefer or "")
    if m:
        nm = m.group(1)
        if nm not in PARTY and nm not in GENERIC and nm not in TITLED and nm not in STOP:
            for suf in TITLED:
                if re.search(nm + r"\s*" + suf, text) or re.search(nm[0] + r"\s+" + suf, text):
                    return f"{nm} {suf}"

    found = []
    for suf in TITLED:
        # 직함 앞에 공백을 강제해야 '국무위원장'의 뒷토막을 '위원장'으로 잡지 않는다
        for m in re.finditer(r"([가-힣]{2,5})(?:\s+[가-힣]{2,12})?\s+" + suf, text):
            nm = m.group(1)
            if (nm in PARTY or nm in STOP or nm in GENERIC or nm in TITLED
                    or nm.endswith(("당", "의힘"))):
                continue
            found.append((nm, suf))
    for nm, suf in found:
        if prefer and nm in prefer:
            return f"{nm} {suf}"
    if found:
        return f"{found[0][0]} {found[0][1]}"
    for suf in ORG_SUF:
        m = re.search(r"([가-힣]{2,10}" + suf + r")", text)
        if m:
            return m.group(1)
    tp = topics(text, 3)
    return tp[0] if tp else ""


def _event(text: str) -> str:
    """행사명. '긴급 간담회'처럼 수식어가 붙은 쪽을 우선한다."""
    best = ""
    for e in EVENT:
        for m in re.finditer(r"([가-힣A-Za-z0-9]{0,10}\s?)" + e, text):
            mod = m.group(1).strip()
            phrase = (mod + " " + e).strip() if mod else e
            if mod in STRONG_MOD:
                return phrase
            if not best:
                best = phrase if len(mod) <= 6 else e
    return best


def _to_noun(s: str) -> str:
    for pat, noun in VERB2NOUN:
        if re.search(pat, s):
            s = re.sub(pat + r".*$", noun, s)
            return s.strip()
    s = re.sub(r"\s*(이라고|라고)?\s*(이같이\s*)?"
               r"(밝혔|전했|말했|덧붙였|설명했|강조했|지적했)(습니다|다)\.?$", "", s)
    s = re.sub(r"[.!?]$", "", s)
    return s.strip()


def _headline_from(s: str, limit: int) -> str:
    """문장 하나를 제목투로 압축. 제목감이 안 되면 빈 문자열을 돌려준다."""
    # 직함이 붙은 화자만 턴다. 직함을 선택으로 두면 '북한이', '정부가' 같은
    # 진짜 주어까지 날아가므로 반드시 필수 그룹이어야 한다.
    t = re.sub(r"^\s*[가-힣]{1,6}\s*(?:" + "|".join(TITLED) + r")\s*(?:은|는|이|가)\s+",
               "", s)
    if '"' in t or "“" in t:
        # 인용을 걷어내면 '통해 며 이같이 밝혔습니다' 같은 뼈대만 남는다.
        # 남은 알맹이가 부실하면 제목으로 쓰지 않는다.
        bare = re.sub(r"[\"“][^\"”]*[\"”]", " ", t)
        bare = re.sub(r"(?<=\s)(며|고|면서|라며|이라며|라고|이라고)(?=\s)", " ", bare)
        bare = re.sub(r"\s*(이같이\s*)?(밝혔|전했|말했|덧붙였|설명했|지적했)(습니다|다)\.?\s*$",
                      "", bare)
        bare = re.sub(r"\s{2,}", " ", bare).strip(" ,·")
        if len(tokens(bare)) < 3:
            return ""
        t = bare
    return _compress(_to_noun(t), limit)


def titles(text: str, orig_title: str = "", limit: int = 26):
    """제목 후보. 2줄(각 ~13자)로 떨어지는 길이를 목표로 한다."""
    sents = sentences(text)
    lead = next((s for s in sents if not is_deck(s)), None) or (orig_title or text[:80])
    actor = _actor(orig_title + " " + lead + " " + text[:400], prefer=orig_title)
    event = _event(orig_title + " " + text[:600])
    # 동사 토막('확대한다고')이 섞이면 '확대한다고까지' 같은 제목이 나온다
    tp = [k for k in topic_words(text, 8) if k not in actor and k not in event]

    cands = []
    if actor and event:
        cands.append(f"{actor}, {event}")
    if actor and tp:
        cands.append(f"{actor}, {tp[0]} {event or '논의'}")
    if actor and not event and not tp:
        cands.append(actor)

    ranked = rank_sentences(text, orig_title)
    plain = [s for s, _ in ranked if '"' not in s and "”" not in s and not is_deck(s)]
    for s in plain[:2]:
        cands.append(_headline_from(s, limit + 8))
    cands.append(_headline_from(lead, limit + 8))

    if orig_title:
        cands.append(_compress(re.sub(r"^\[[^\]]*\]\s*", "", orig_title), limit + 10))
    for q in re.findall(r"[\"“]([^\"”]{8,30})[\"”]", text):
        q = clean_quote(q)
        if q:
            cands.append('"' + _compress(q, limit) + '"')
            break
    if len(tp) >= 2:
        cands.append(f"{tp[0]}, {tp[1]}까지")

    out = []
    for c in cands:
        c = re.sub(r"\s{2,}", " ", (c or "")).strip(" ,·")
        if len(re.sub(r"\s", "", c)) < 5:
            continue
        if c not in out:
            out.append(c)
    return out[:6]


# ── 후킹 문구(강력한 메시지) ──────────────────────────────────────────────
# 제목 틀에 끼우면 말이 안 되는 토막 — 동사·어미가 붙어 있는 것
VERBISH = re.compile(
    r"(다고|한다|했다|하다|됐다|된다|되다|겠다|었다|였다|이다|진다|온다|간다|본다|"
    r"하며|면서|라며|이라며|으로|에서|에게|까지|부터|보다|처럼|만큼|라고|하는|하고)$")


def topic_words(text: str, n: int = 6):
    """제목 틀에 끼울 **깨끗한 낱말**만 고른다.

    `topics()` 는 '확대하겠다고' 같은 동사 토막이나 '정부 대학생' 같은 두 낱말 묶음도
    준다. 틀에 그대로 끼우면 `확대한다고까지` 나 `정부 대학생, 다시 묻는다` 처럼
    말이 안 된다. 그래서 한 낱말짜리 명사만 남긴다.
    """
    out = []
    for w in topics(text, max(n * 3, 18)):
        w = (w or "").strip()
        if len(w) < 2 or " " in w or VERBISH.search(w):
            continue
        if w not in out:
            out.append(w)
        if len(out) >= n:
            break
    return out


def josa(word: str, pair=("이", "가")) -> str:
    """받침에 맞는 조사를 고른다. pair 는 (받침 있을 때, 없을 때).

    ('이','가') ('은','는') ('을','를') ('과','와') 순으로 넣으면 된다.
    이걸 안 쓰면 '대학생가 움직인다' 같은 말이 나온다.
    """
    w = re.sub(r"[^0-9A-Za-z가-힣]", "", word or "")
    if not w:
        return pair[1]
    ch = w[-1]
    if "가" <= ch <= "힣":
        has = (ord(ch) - 0xAC00) % 28 != 0          # 종성이 있으면 받침
    elif ch.isdigit():
        has = ch in "013678"                        # 영·일·삼·육·칠·팔
    else:
        has = ch.lower() in "lmnr"                  # 영문은 대략
    return pair[0] if has else pair[1]


def hooks(text: str, orig_title: str = ""):
    """카드 상단에 얹을 짧고 센 한 줄 후보."""
    blob = orig_title + " " + text
    tp = topic_words(blob, 8)          # 두 낱말 묶음·동사 토막을 빼야 말이 된다
    k0 = tp[0] if tp else "현장"
    k1 = tp[1] if len(tp) > 1 else k0
    val = next((v for v in VALUE if v in blob), "")
    neg = sum(blob.count(w) for w in NEG)
    pos = sum(blob.count(w) for w in POS)

    out = []
    # 1) 기사 속 직접 인용에서 짧고 센 구절
    for raw_q in re.findall(r"[\"“]([^\"”]{6,40})[\"”]", text):
        q = clean_quote(raw_q)
        if q and 6 <= len(q) <= 22:
            out.append(f'"{q}"')
        if len(out) >= 2:
            break

    if neg >= pos:
        if val:
            out += [f"무너진 {val}..", f"{val}은 어디로.."]
        out += [f"{k0}, 무엇이 문제인가", f"흔들리는 {k0}", f"{k0}.. 그 이면",
                f"{k0} 논란의 한복판"]
    else:
        if val:
            out.append(f"{val}을 되찾는 길..")
        out += [f"{k0}, 판이 바뀐다", f"지금 {k0}에서는..", f"{k0}, 여기서 시작",
                f"{k0}{josa(k0)} 움직인다"]
    out.append(f"{k0} 그리고 {k1}")

    seen, res = set(), []
    for h in out:
        h = h.strip()
        if h and h not in seen:
            seen.add(h)
            res.append(h)
    return res[:6]


def analyze(text: str, orig_title: str = "") -> dict:
    text = _norm(text or "")
    return {
        "titles": titles(text, orig_title),
        "hooks": hooks(text, orig_title),
        "summaries": summarize(text, orig_title),
        "keywords": keywords(text, 10),
        "sentences": [s for s, _ in rank_sentences(text, orig_title)[:8]],
    }


# ── 시리즈(캐러셀) 자동 구성 ──────────────────────────────────────────────
# 기사 하나를 「표지 + 본문 장 N + (뒷장)」으로 나눈다. 앞장(표지)은 analyze() 의
# 첫 후보를 그대로 쓰고, 본문 장은 **서로 다른 핵심 문장** 하나씩을 맡는다.
# 장의 종류는 문장 생김새로 고른다 — 숫자가 박힌 문장은 '숫자 강조', 따옴표 안의
# 말은 '인용', 나머지는 '포인트'. 같은 문장을 두 장에 쓰지 않고, 기사 차례를
# 지킨다(읽는 순서가 기사 전개와 같아야 헷갈리지 않는다).
_NUM_RE = re.compile(
    r"(\d[\d,.]*\s*(?:%|퍼센트|억\s?원|조\s?원|만\s?원|천\s?원|억|조|만\s?명|명|건|배|원|"
    r"달러|년|개월|일|시간|위|곳|개|대|톤|km|㎞|m|㎡|%p|p))")


def _pick_number(s: str) -> str:
    """문장에서 카드에 크게 박을 숫자 한 토막. 없으면 빈 문자열."""
    m = _NUM_RE.search(s)
    if not m:
        return ""
    n = re.sub(r"\s+", "", m.group(1))
    n = n.replace("퍼센트", "%")
    return n[:10]


def _kind_of(s: str):
    """문장 → (장 종류, 덧붙이는 값). quote 는 따옴표 안 글, number 는 숫자."""
    m = re.search(r"[\"“]([^\"”]{12,80})[\"”]", s)
    if m:
        q = clean_quote(m.group(1))
        if q and len(q) >= 12:
            return "quote", q
    n = _pick_number(s)
    if n:
        return "number", n
    return "point", ""


def series(text: str, orig_title: str = "", n: int = 3) -> dict:
    """기사 → 표지 1장 + 본문 장 n장 재료. 뒷장은 화면이 붙인다.

    돌려주는 꼴(AI 판 `ai.series()` 와 **같다** — 화면은 둘을 구별하지 않는다):
      { "cover": {"hook","title","summary"},
        "pages": [ {"kind": "point|number|quote", "label": "POINT 1",
                    "head": "...", "body": "...", "num": "38%", "who": "..."} ] }
    """
    text = _norm(text or "")
    n = max(1, min(int(n or 3), 6))
    a = analyze(text, orig_title)
    cover = {
        "hook": (a["hooks"] or [""])[0],
        "title": (a["titles"] or [orig_title or ""])[0],
        "summary": (a["summaries"] or [""])[0],
    }
    sents = sentences(text)
    order = {s: i for i, s in enumerate(sents)}
    ranked = [s for s, _ in rank_sentences(text, orig_title) if not is_deck(s)]
    # 표지 요약문에 이미 쓴 문장은 본문 장에서 뺀다 — 같은 말이 두 번 나오면 싱겁다
    used = set(s for s in sents if s and cover["summary"] and s[:25] in cover["summary"])
    picked = []
    seen_heads = set()
    for s in ranked:
        if s in used:
            continue
        if len(re.sub(r"\s", "", s)) < 18:
            continue
        head = _headline_from(s, 30) or _compress(_to_noun(s), 30)
        key = re.sub(r"\s", "", head)[:12]
        if not head or key in seen_heads:
            continue
        seen_heads.add(key)
        picked.append((s, head))
        if len(picked) >= n:
            break
    # 숫자가 박힌 문장이 하나도 안 뽑혔는데 기사에 있으면, 순위가 가장 낮은 포인트 장과
    # 바꾼다 — 카드뉴스에서 숫자 한 장은 가장 잘 읽히는 장이라서(기사에 숫자가 있을 때만).
    if picked and not any(_kind_of(s)[0] == "number" for s, _ in picked):
        for s in ranked:
            if s in used or any(s == q for q, _ in picked):
                continue
            if _kind_of(s)[0] != "number" or len(re.sub(r"\s", "", s)) < 18:
                continue
            head = _headline_from(s, 30) or _compress(_to_noun(s), 30)
            if head:
                picked[-1] = (s, head)
            break
    picked.sort(key=lambda p: order.get(p[0], 999))       # 기사 전개 순서로
    actor = _actor(orig_title + " " + text[:600], prefer=orig_title)
    pages = []
    quotes_used = 0
    picked_set = set(q for q, _ in picked)
    used_next = set()
    for i, (s, head) in enumerate(picked, 1):
        kind, extra = _kind_of(s)
        # 소제목 = 그 문장을 제목투로(3줄까지 허용), 설명 = **다음 문장**(기사 전개를 잇는다).
        # 같은 문장을 소제목·설명에 겹쳐 쓰면 '…' 로 잘린 앞토막 + 전문이 두 번 나와 싱겁다.
        head = _headline_from(s, 44) or _compress(_to_noun(s), 44)
        idx = order.get(s, -1)
        nxt = ""
        for j in range(idx + 1, min(idx + 3, len(sents))):
            cand = sents[j]
            if (cand and not is_deck(cand) and cand not in picked_set and cand not in used_next
                    and len(re.sub(r"\s", "", cand)) >= 12):
                nxt = cand
                used_next.add(cand)
                break
        body = _compress(nxt, 110) if nxt else ""
        if kind == "quote" and quotes_used >= 1:          # 인용 장은 한 장이면 족하다
            kind, extra = "point", ""
        pg = {"kind": kind, "label": f"POINT {i}", "head": head,
              "body": body, "num": "", "who": ""}
        if kind == "number":
            pg["num"] = extra
        elif kind == "quote":
            quotes_used += 1
            pg["head"] = extra                              # 인용 장의 큰 글씨 = 인용문
            pg["who"] = actor
            pg["body"] = _compress(re.sub(r"[\"“][^\"”]*[\"”]", "", s).strip(" ,·"), 90) or body
        pages.append(pg)
    return {"cover": cover, "pages": pages}
