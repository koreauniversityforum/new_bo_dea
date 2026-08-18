/* 규칙 기반 한국어 기사 요약 / 제목 / 후킹 문구 — summarizer.py 의 브라우저 이식본.
 *
 * 서버 없이 폰에서 돌리는 배포판이라 파이썬 쪽을 그대로 옮겼다. 원본과 같은 결과를
 * 내야 하므로 함수 이름·순서·상수까지 맞춰 뒀다(대조 시험: 시험_요약기_대조.py).
 *
 * 🔴 파이썬 정규식과 자바스크립트 정규식이 갈라지는 곳
 *   - `\b` : 파이썬 \w 는 한글을 포함하지만 JS 는 아니다. `기자\b` 를 그대로 옮기면
 *     '기자회견'을 걸러내지 못하거나(경계 없음) 문장 끝의 '기자'를 놓친다.
 *     → `기자(?![가-힣])` 로 바꿔 적었다.
 *   - `\w` (메일 주소) : JS 는 ASCII 만이라 오히려 의도에 맞는다. 그대로 둔다.
 *   - 뒤보기(lookbehind)는 크롬·최신 사파리에서 모두 된다.
 */
(function (root) {
  'use strict';

  // ── 조사/어미 절단용 ────────────────────────────────────────────────────
  const JOSA = ["으로서", "으로써", "이라고", "라고", "에서는", "에게서", "께서는", "에서도",
    "으로는", "이라는", "라는", "만큼", "처럼", "부터", "까지", "에게", "한테",
    "께서", "에서", "으로", "이나", "보다", "밖에", "조차", "마저", "이란",
    "와의", "과의", "의", "은", "는", "이", "가", "을", "를", "에", "로",
    "와", "과", "도", "만", "라", "야", "인"];

  const STOP = new Set(`
그리고 그러나 하지만 또한 이번 지난 오늘 내일 어제 대해 대한 통해 위해 위한 관련
있다 없다 했다 한다 된다 됐다 이다 아니 같은 같이 매우 가장 모든 여러 다른 이런 저런
그런 우리 자신 사람 경우 때문 이후 이전 현재 최근 당시 기자 뉴스 사진 제공 무단 전재
배포 금지 저작권자 라며 면서 이라며 밝혔 전했 말했 설명 강조 지적 것으로 것이다 이라고
등의 등을 등이 대변인 관계자 오전 오후 이날 지난해 올해 내년 억원 만원 정도 수준 계획
`.trim().split(/\s+/));

  const NEG = ["논란", "비판", "우려", "갈등", "무너", "위기", "파문", "의혹", "반발", "지적",
    "미달", "부실", "실패", "하락", "감소", "폐지", "축소", "불만", "충돌", "적자",
    "피해", "붕괴", "혼란", "공방", "반대", "규탄", "사퇴", "고발", "경고", "불신"];
  const POS = ["성과", "성공", "협약", "출범", "유치", "선정", "수상", "확대", "증가", "최초",
    "돌파", "합의", "타결", "개선", "지원", "설립", "달성", "회복", "호평", "기대"];

  // 서술어 → 명사형 (제목 압축용)
  const VERB2NOUN = [
    ["(개최|열)(했|었|한|린)다", "개최"], ["(밝|드러)(혔|났)다", "밝혀"],
    ["촉구(했|한)다", "촉구"], ["요구(했|한)다", "요구"],
    ["발표(했|한)다", "발표"], ["제안(했|한)다", "제안"],
    ["논의(했|한)다", "논의"], ["합의(했|한)다", "합의"],
    ["체결(했|한)다", "체결"], ["점검(했|한)다", "점검"],
    ["추진(했|한)다", "추진"], ["결정(했|한)다", "결정"],
    ["확정(됐|된)다", "확정"], ["통과(됐|된)다", "통과"],
    ["선정(됐|된)다", "선정"], ["비판(했|한)다", "비판"],
    ["강조(했|한)다", "강조"], ["지적(했|한)다", "지적"],
    ["마련(했|한)다", "마련"], ["모(았|은)다", "모아"],
    ["나(섰|선)다", "나서"], ["돌입(했|한)다", "돌입"],
    ["공개(했|한)다", "공개"], ["착수(했|한)다", "착수"],
    ["방문(했|한)다", "방문"], ["참석(했|한)다", "참석"],
    ["진행(됐|된|했|한)다", "진행"], ["실시(했|한)다", "실시"],
    ["도입(했|한)다", "도입"], ["시작(했|한)다", "시작"],
  ];

  // 긴 직함을 먼저 둬야 '국무위원장'이 '위원장'으로 잘리지 않는다
  const TITLED = ["국무위원장", "부위원장", "특별위원장", "사무총장", "부총장", "이사장",
    "당대표", "후보", "의원", "장관", "총장", "대표", "위원장", "회장",
    "교수", "차관", "청장",
    "시장", "지사", "대통령", "국장", "본부장", "센터장", "단장", "총리",
    "처장", "실장", "학회장", "학장", "과장", "팀장"];

  const PARTY = ["국민의힘", "더불어민주당", "민주당", "정의당", "개혁신당", "조국혁신당",
    "진보당", "기본소득당", "사회민주당", "무소속", "여당", "야당", "국회",
    "정부", "청와대", "대통령실", "시의회", "구의회", "교육청"];
  const STRONG_MOD = ["긴급", "첫", "합동", "공개", "비공개", "연석", "임시", "특별", "대규모",
    "전국", "제1차", "1차", "확대"];
  const VALUE = ["신뢰", "투명성", "공정성", "민주주의", "중립성", "원칙", "상식", "정의",
    "안전", "형평성", "자율성", "권리", "책임", "약속"];
  const GENERIC = new Set(TITLED.concat(["관계자", "참석자", "참석자들", "대표들", "기자", "단체",
    "여부", "방안", "문제", "제도", "관련", "당시", "국민",
    "이번", "내용", "결과", "상황", "부분", "중요"]));
  const ORG_SUF = ["위원회", "협회", "재단", "연구원", "대학교", "대학", "정부", "부처", "청",
    "공사", "공단", "학회", "연합회", "총학생회", "단체", "본부", "센터",
    "포럼", "네트워크", "노조", "국회", "법원", "검찰", "경찰"];
  const EVENT = ["간담회", "토론회", "세미나", "포럼", "설명회", "공청회", "기자회견", "협약식",
    "발대식", "출범식", "간부회의", "회의", "면담", "워크숍", "컨퍼런스", "총회",
    "선포식", "개막식", "박람회", "campaign", "캠페인", "공모전", "대회", "축제"];

  // ── 파이썬 흉내 도우미 ──────────────────────────────────────────────────
  /** 파이썬 str.strip(chars) — 앞뒤에서 주어진 글자들만 턴다. */
  function stripChars(s, chars) {
    let a = 0, b = s.length;
    while (a < b && chars.indexOf(s[a]) >= 0) a++;
    while (b > a && chars.indexOf(s[b - 1]) >= 0) b--;
    return s.slice(a, b);
  }
  const rstripChars = (s, chars) => {
    let b = s.length;
    while (b > 0 && chars.indexOf(s[b - 1]) >= 0) b--;
    return s.slice(0, b);
  };
  const countOf = (s, sub) => s.split(sub).length - 1;
  /** 정규식 특수문자 탈출 — 낱말을 정규식에 끼워 넣을 때 쓴다. */
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** 빈도 세기 (collections.Counter) */
  function counter(list) {
    const m = new Map();
    for (const x of list) m.set(x, (m.get(x) || 0) + 1);
    return m;
  }
  /** 파이썬 Counter.most_common — 빈도 내림차순, 동률이면 처음 나온 순서 */
  function mostCommon(m, n) {
    const arr = [...m.entries()];
    arr.sort((a, b) => b[1] - a[1]);          // JS sort 는 안정 정렬이라 삽입순 유지
    return n == null ? arr : arr.slice(0, n);
  }

  // ── 기본 유틸 ───────────────────────────────────────────────────────────
  function _norm(text) {
    text = String(text || "").replace(/​/g, " ").replace(/ /g, " ");
    text = text.replace(/\[[^\]]{0,40}\]/g, " ");
    text = text.replace(/[〈<＜《]\s*(?:사진|자료|그래픽|영상|표)[^〉>＞》]{0,40}[〉>＞》]/g, " ");
    text = text.replace(/\([^)]{0,30}기자[^)]{0,10}\)/g, " ");
    text = text.replace(/^\s*이미지\s*확대/gm, " ");
    text = text.replace(/\([^)]{0,40}[=＝][^)]{0,20}\)\s*(?:[가-힣]{2,5}\s*기자)?\s*[=＝]?\s*/g, " ");
    text = text.replace(/[ⓒ©]\s*[^\n]{0,40}/g, " ");
    text = text.replace(/(무단\s*전재|재배포\s*금지|저작권자)[^\n]{0,30}/g, " ");
    text = text.replace(/[\w.\-]+@[\w.\-]+\.[A-Za-z]{2,}/g, " ");
    text = text.replace(/[가-힣]{2,4}\s*기자(?![가-힣])/g, " ");   // 🔴 \b 대체
    text = text.replace(/[ \t]+/g, " ");
    return text.trim();
  }

  function sentences(text) {
    text = _norm(text);
    const parts = text.split(/(?<=[다요임함음])\.\s+|(?<=[.!?])\s+|\n+/);
    const out = [];
    for (let p of parts) {
      p = stripChars(String(p || "").trim(), " \t·-—•ㅇ");
      p = p.replace(/^[=＝]\s*/, "").trim();
      if (!p) continue;
      if (!/[가-힣]/.test(p)) continue;
      const body = p.replace(/\s/g, "");
      if (body.length < 12 || body.length > 220) continue;
      if (countOf(p, "”") + countOf(p, '"') > 6) continue;
      out.push(p);
    }
    return out;
  }

  function is_deck(s) {
    s = s.trim();
    return (s.indexOf("…") >= 0 || s.indexOf("ㆍ") >= 0) && !/(다|요)$|[.!?]$/.test(s);
  }

  function clean_quote(q) {
    q = stripChars(String(q || "").replace(/\s+/g, " ").trim(), " .·,");
    q = q.replace(/(라고|이라고)$/, "").trim();
    if (/^(고|며|면서|라고|이라고|는|은|이|가|을|를|에|와|과|도)(?![가-힣])/.test(q)) return "";
    if (/(다|요)\.\s/.test(q)) return "";
    if (q.replace(/[^가-힣A-Za-z0-9]/g, "").length < 5) return "";
    return q;
  }

  function _strip_josa(tok) {
    if (!/^[가-힣]+$/.test(tok)) return tok;
    for (const j of JOSA) {
      if (tok.length - j.length >= 2 && tok.endsWith(j)) return tok.slice(0, tok.length - j.length);
    }
    return tok;
  }

  function tokens(text) {
    const out = [];
    const found = String(text || "").match(/[가-힣]{2,}|[A-Za-z]{3,}|\d{2,}%?/g) || [];
    for (const raw of found) {
      const t = _strip_josa(raw);
      if (t.length < 2 || STOP.has(t)) continue;
      if (/^\d+$/.test(t)) continue;
      out.push(t);
    }
    return out;
  }

  function keywords(text, n) {
    n = n == null ? 12 : n;
    const c = counter(tokens(text));
    const scored = [...c.entries()].map(([w, f]) => [w, f * (1 + 0.25 * (w.length - 2))]);
    scored.sort((a, b) => b[1] - a[1]);
    return scored.slice(0, n).map(kv => kv[0]);
  }

  function bigrams(text, n) {
    n = n == null ? 6 : n;
    const c = new Map();
    const ss = sentences(text);
    for (const s of (ss.length ? ss : [text])) {
      const tk = tokens(s);
      for (let i = 0; i + 1 < tk.length; i++) {
        const a = tk[i], b = tk[i + 1];
        if (GENERIC.has(a) || GENERIC.has(b) || a === b) continue;
        const k = a + " " + b;
        c.set(k, (c.get(k) || 0) + 1);
      }
    }
    return mostCommon(c, n).filter(kv => kv[1] >= 2).map(kv => kv[0]);
  }

  function topics(text, n) {
    n = n == null ? 10 : n;
    const out = bigrams(text, 4).slice();
    for (const k of keywords(text, n * 2)) {
      if (GENERIC.has(k) || out.some(b => b.indexOf(k) >= 0)) continue;
      out.push(k);
    }
    return out.slice(0, n);
  }

  // ── 요약 ────────────────────────────────────────────────────────────────
  function rank_sentences(text, title) {
    title = title || "";
    const sents = sentences(text);
    if (!sents.length) return [];
    const freq = counter(tokens(text));
    if (!freq.size) return sents.map(s => [s, 0.0]);
    const top = mostCommon(freq, 1)[0][1];
    const tset = new Set(tokens(title));
    const scored = [];
    sents.forEach((s, i) => {
      const tk = tokens(s);
      if (!tk.length) return;
      const uniq = new Set(tk);
      let base = 0;
      uniq.forEach(t => { base += (freq.get(t) || 0) / top; });
      let sc = base / Math.pow(uniq.size, 0.5);
      sc += 0.45 * Math.max(0.0, 1 - i / 8);
      let hit = 0;
      tset.forEach(t => { if (uniq.has(t)) hit++; });
      sc += 0.30 * hit / (tset.size + 1);
      const n = s.replace(/\s/g, "").length;
      if (n >= 35 && n <= 110) sc += 0.2;
      if (s.indexOf('"') >= 0 || s.indexOf("”") >= 0) sc += 0.12;
      if (is_deck(s)) sc -= 1.2;
      scored.push([i, s, sc]);
    });
    scored.sort((a, b) => b[2] - a[2]);
    return scored.map(x => [x[1], x[2]]);
  }

  function _compress(s, limit) {
    s = String(s || "").replace(/^\s*(한편|또한|그러나|하지만|이어|아울러|특히|앞서)[,\s]+/, "");
    s = s.replace(/\s*\([^)]*\)/g, "");
    s = s.replace(/^\s*[=＝·]\s*/, "");
    s = s.replace(/ {2,}/g, " ").trim();
    if (s.length <= limit) return s;
    let cut = s.slice(0, limit);
    const m = /^(.*[,·\s])[^,·\s]*$/.exec(cut);
    if (m && m[1].length > limit * 0.6) cut = m[1];
    return rstripChars(cut, " ,·") + "…";
  }

  function summarize(text, title, limit, n) {
    title = title || ""; limit = limit == null ? 95 : limit; n = n == null ? 2 : n;
    const ranked = rank_sentences(text, title);
    if (!ranked.length) return [];
    const sents = sentences(text);
    const order = new Map();
    sents.forEach((s, i) => { if (!order.has(s)) order.set(s, i); });

    const join = (picked) => {
      const uniq = [...new Set(picked)];
      uniq.sort((a, b) => (order.has(a) ? order.get(a) : 999) - (order.has(b) ? order.get(b) : 999));
      const joined = uniq.map(s => /[.!?"”]$/.test(s) ? s : s + ".").join(" ");
      return _compress(joined, limit);
    };

    const lead = sents.find(s => !is_deck(s)) || sents[0];
    const cands = [];
    cands.push(join(ranked.slice(0, n).map(r => r[0])));
    cands.push(_compress(lead, limit));
    if (ranked.length > 1) {
      cands.push(join(ranked.length > 2
        ? [ranked[0][0], ranked[1][0], ranked[2][0]]
        : [ranked[0][0], ranked[1][0]]));
    }
    for (const m of String(text).matchAll(/["“]([^"”]{15,90})["”]/g)) {
      const q = clean_quote(m[1]);
      if (q) { cands.push(_compress('"' + q + '"', limit)); break; }
    }
    const out = [];
    for (let c of cands) {
      c = String(c || "").trim();
      if (c && out.indexOf(c) < 0) out.push(c);
    }
    return out.slice(0, 4);
  }

  // ── 제목 ────────────────────────────────────────────────────────────────
  function _actor(text, prefer) {
    prefer = prefer || "";
    const m = /^\s*([가-힣]{2,4})\s*[,"“:·]/.exec(prefer);
    if (m) {
      const nm = m[1];
      if (PARTY.indexOf(nm) < 0 && !GENERIC.has(nm) && TITLED.indexOf(nm) < 0 && !STOP.has(nm)) {
        for (const suf of TITLED) {
          if (new RegExp(esc(nm) + "\\s*" + suf).test(text) ||
              new RegExp(esc(nm[0]) + "\\s+" + suf).test(text)) {
            return nm + " " + suf;
          }
        }
      }
    }

    const found = [];
    for (const suf of TITLED) {
      const re = new RegExp("([가-힣]{2,5})(?:\\s+[가-힣]{2,12})?\\s+" + suf, "g");
      for (const mm of text.matchAll(re)) {
        const nm = mm[1];
        if (PARTY.indexOf(nm) >= 0 || STOP.has(nm) || GENERIC.has(nm) || TITLED.indexOf(nm) >= 0
            || nm.endsWith("당") || nm.endsWith("의힘")) continue;
        found.push([nm, suf]);
      }
    }
    for (const [nm, suf] of found) {
      if (prefer && prefer.indexOf(nm) >= 0) return nm + " " + suf;
    }
    if (found.length) return found[0][0] + " " + found[0][1];
    for (const suf of ORG_SUF) {
      const mm = new RegExp("([가-힣]{2,10}" + suf + ")").exec(text);
      if (mm) return mm[1];
    }
    const tp = topics(text, 3);
    return tp.length ? tp[0] : "";
  }

  function _event(text) {
    let best = "";
    for (const e of EVENT) {
      const re = new RegExp("([가-힣A-Za-z0-9]{0,10}\\s?)" + esc(e), "g");
      for (const m of text.matchAll(re)) {
        const mod = m[1].trim();
        const phrase = mod ? (mod + " " + e) : e;
        if (STRONG_MOD.indexOf(mod) >= 0) return phrase;
        if (!best) best = mod.length <= 6 ? phrase : e;
      }
    }
    return best;
  }

  function _to_noun(s) {
    for (const [pat, noun] of VERB2NOUN) {
      if (new RegExp(pat).test(s)) {
        s = s.replace(new RegExp(pat + ".*$"), noun);
        return s.trim();
      }
    }
    s = s.replace(/\s*(이라고|라고)?\s*(이같이\s*)?(밝혔|전했|말했|덧붙였|설명했|강조했|지적했)(습니다|다)\.?$/, "");
    s = s.replace(/[.!?]$/, "");
    return s.trim();
  }

  function _headline_from(s, limit) {
    let t = s.replace(new RegExp("^\\s*[가-힣]{1,6}\\s*(?:" + TITLED.join("|") + ")\\s*(?:은|는|이|가)\\s+"), "");
    if (t.indexOf('"') >= 0 || t.indexOf("“") >= 0) {
      let bare = t.replace(/["“][^"”]*["”]/g, " ");
      bare = bare.replace(/(?<=\s)(며|고|면서|라며|이라며|라고|이라고)(?=\s)/g, " ");
      bare = bare.replace(/\s*(이같이\s*)?(밝혔|전했|말했|덧붙였|설명했|지적했)(습니다|다)\.?\s*$/, "");
      bare = stripChars(bare.replace(/\s{2,}/g, " ").trim(), " ,·");
      if (tokens(bare).length < 3) return "";
      t = bare;
    }
    return _compress(_to_noun(t), limit);
  }

  function titles(text, orig_title, limit) {
    orig_title = orig_title || ""; limit = limit == null ? 26 : limit;
    const sents = sentences(text);
    const lead = sents.find(s => !is_deck(s)) || (orig_title || text.slice(0, 80));
    const actor = _actor(orig_title + " " + lead + " " + text.slice(0, 400), orig_title);
    const event = _event(orig_title + " " + text.slice(0, 600));
    const tp = topic_words(text, 8).filter(k => actor.indexOf(k) < 0 && event.indexOf(k) < 0);

    const cands = [];
    if (actor && event) cands.push(actor + ", " + event);
    if (actor && tp.length) cands.push(actor + ", " + tp[0] + " " + (event || "논의"));
    if (actor && !event && !tp.length) cands.push(actor);

    const ranked = rank_sentences(text, orig_title);
    const plain = ranked.filter(r => r[0].indexOf('"') < 0 && r[0].indexOf("”") < 0 && !is_deck(r[0]))
      .map(r => r[0]);
    for (const s of plain.slice(0, 2)) cands.push(_headline_from(s, limit + 8));
    cands.push(_headline_from(lead, limit + 8));

    if (orig_title) cands.push(_compress(orig_title.replace(/^\[[^\]]*\]\s*/, ""), limit + 10));
    for (const m of String(text).matchAll(/["“]([^"”]{8,30})["”]/g)) {
      const q = clean_quote(m[1]);
      if (q) { cands.push('"' + _compress(q, limit) + '"'); break; }
    }
    if (tp.length >= 2) cands.push(tp[0] + ", " + tp[1] + "까지");

    const out = [];
    for (let c of cands) {
      c = stripChars(String(c || "").replace(/\s{2,}/g, " ").trim(), " ,·");
      if (c.replace(/\s/g, "").length < 5) continue;
      if (out.indexOf(c) < 0) out.push(c);
    }
    return out.slice(0, 6);
  }

  // ── 후킹 문구 ───────────────────────────────────────────────────────────
  const VERBISH = /(다고|한다|했다|하다|됐다|된다|되다|겠다|었다|였다|이다|진다|온다|간다|본다|하며|면서|라며|이라며|으로|에서|에게|까지|부터|보다|처럼|만큼|라고|하는|하고)$/;

  function topic_words(text, n) {
    n = n == null ? 6 : n;
    const out = [];
    for (let w of topics(text, Math.max(n * 3, 18))) {
      w = String(w || "").trim();
      if (w.length < 2 || w.indexOf(" ") >= 0 || VERBISH.test(w)) continue;
      if (out.indexOf(w) < 0) out.push(w);
      if (out.length >= n) break;
    }
    return out;
  }

  function josa(word, pair) {
    pair = pair || ["이", "가"];
    const w = String(word || "").replace(/[^0-9A-Za-z가-힣]/g, "");
    if (!w) return pair[1];
    const ch = w[w.length - 1];
    let has;
    if (ch >= "가" && ch <= "힣") has = (ch.charCodeAt(0) - 0xAC00) % 28 !== 0;
    else if (/\d/.test(ch)) has = "013678".indexOf(ch) >= 0;
    else has = "lmnr".indexOf(ch.toLowerCase()) >= 0;
    return has ? pair[0] : pair[1];
  }

  function hooks(text, orig_title) {
    orig_title = orig_title || "";
    const blob = orig_title + " " + text;
    const tp = topic_words(blob, 8);
    const k0 = tp.length ? tp[0] : "현장";
    const k1 = tp.length > 1 ? tp[1] : k0;
    const val = VALUE.find(v => blob.indexOf(v) >= 0) || "";
    let neg = 0, pos = 0;
    for (const w of NEG) neg += countOf(blob, w);
    for (const w of POS) pos += countOf(blob, w);

    let out = [];
    for (const m of String(text).matchAll(/["“]([^"”]{6,40})["”]/g)) {
      const q = clean_quote(m[1]);
      if (q && q.length >= 6 && q.length <= 22) out.push('"' + q + '"');
      if (out.length >= 2) break;
    }

    if (neg >= pos) {
      if (val) out = out.concat(["무너진 " + val + "..", val + "은 어디로.."]);
      out = out.concat([k0 + ", 무엇이 문제인가", "흔들리는 " + k0, k0 + ".. 그 이면",
        k0 + " 논란의 한복판"]);
    } else {
      if (val) out.push(val + "을 되찾는 길..");
      out = out.concat([k0 + ", 판이 바뀐다", "지금 " + k0 + "에서는..", k0 + ", 여기서 시작",
        k0 + josa(k0) + " 움직인다"]);
    }
    out.push(k0 + " 그리고 " + k1);

    const seen = new Set(), res = [];
    for (let h of out) {
      h = h.trim();
      if (h && !seen.has(h)) { seen.add(h); res.push(h); }
    }
    return res.slice(0, 6);
  }

  function analyze(text, orig_title) {
    text = _norm(text || "");
    orig_title = orig_title || "";
    return {
      titles: titles(text, orig_title),
      hooks: hooks(text, orig_title),
      summaries: summarize(text, orig_title),
      keywords: keywords(text, 10),
      sentences: rank_sentences(text, orig_title).slice(0, 8).map(r => r[0]),
    };
  }

  const API = {
    analyze, titles, hooks, summarize, keywords, topics, topic_words,
    sentences, rank_sentences, tokens, josa, is_deck, clean_quote, _norm, _actor, _event,
  };
  root.SUMMARIZER = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
