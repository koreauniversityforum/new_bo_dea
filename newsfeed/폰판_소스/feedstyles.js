/* 피드 글(캡션) 네 가지 글투 — 폰판(서버 0개)용. `feed.py` 의 옮김.
 *
 * 왜 옮겼나: 캡션 생성기(feed.py 512줄)는 앱 서버에만 있어서 폰판·홈페이지에는
 * 「피드 글」이 통째로 없었다. 그런데 「정기 뉴스 메이커」에서 새벽에 구운 카드를
 * 그대로 올리려면 글이 있어야 한다(2026-09-02 요구: 네 가지 글투를 여기에도).
 *
 * 파이썬판과 다른 점 — 재료가 다르다
 *   · 앱   : 기사 **본문 전체**를 서버가 긁어 문장을 뽑는다.
 *   · 폰판 : 새벽에 챙겨 둔 **두 문장 요약**이 기본. 본문을 가져온 카드는 본문까지 쓴다.
 * 그래서 같은 글투라도 앱 쪽이 문장이 많다. 뼈대(절 이름·출처 줄·안내문)는 맞춰 두어
 * 두 판의 결과가 서로 낯설지 않게 했다.
 *
 * 🔴 요약 문장은 **원문에서 뽑아낸 것**이다. 그대로 올리면 언론사 문장을 옮기는 셈이라
 *    안내문을 항상 붙인다(파이썬판과 같은 규칙).
 */
(function (root) {
  'use strict';

  const STYLES = [
    { id: 'news', name: '뉴스 전달형', note: '무슨 일인지 → 왜 중요한지 순서. 시사 계정 기본형.' },
    { id: 'magazine', name: '매거진형', note: '문장을 이어 쓰는 에세이 톤. 기획·주간 정리에 어울림.' },
    { id: 'brief', name: '짧은 브리핑', note: '3줄 요약 + 해시태그. 스토리·릴스 설명에.' },
    { id: 'question', name: '질문 던지기', note: '표지 후킹을 첫 줄로. 댓글을 부르는 결.' },
    { id: 'oneline', name: '한 줄 + 태그', note: '카드가 이미 다 말한 경우. 캡션은 짧게.' },
    { id: 'cards', name: '카드 대사 뽑기', note: '카드 한 장씩 넣을 문구를 장 단위로.' },
  ];

  /* 어디에 올리나 — feed.py 의 CHANNELS 와 같은 표. 문장을 새로 쓰지 않고
     길이 상한과 해시태그 개수만 손본다. */
  const CHANNELS = [
    { id: 'instagram', name: '인스타 피드', limit: 2200, tags: 30, note: '기본. 2,200자까지, 해시태그 그대로.' },
    { id: 'threads', name: '스레드', limit: 500, tags: 3, note: '500자까지. 해시태그는 셋만.' },
    { id: 'x', name: 'X(트위터)', limit: 280, tags: 2, note: '280자까지. 핵심 한두 줄 + 링크.' },
    { id: 'facebook', name: '페이스북', limit: 0, tags: 3, note: '길이는 자유. 해시태그는 적게.' },
    { id: 'blog', name: '블로그·뉴스레터', limit: 0, tags: 0, note: '해시태그 없이 소제목·문단 그대로.' },
  ];
  const channelOf = (id) => CHANNELS.find(c => c.id === id) || CHANNELS[0];

  /** 내용이 다 잘려 혼자 남은 절 제목인가. */
  const 머리만 = (s) => ['📌', '📊', '🔁', '🗞', '🗣', '🗂', '—'].includes((s || '').trim().slice(0, 1));

  /** 이미 쓴 글을 채널 규격에 맞춘다. 기본값(인스타)은 손대지 않는다. */
  function shape(text, tags, channel) {
    const ch = channelOf(channel);
    if (ch.id === 'instagram') return text;
    tags = (tags || []).slice();
    const 줄 = String(text || '').split('\n');
    const 출처 = 줄.find(l => l.startsWith('🔗')) || '';
    let 몸 = 줄.filter(l => !l.startsWith('🔗') && !l.startsWith('※') && !l.trim().startsWith('#'));
    const 쓸태그 = ch.tags ? tags.slice(0, ch.tags) : [];
    const 짧음 = !!ch.limit && ch.limit <= 700;      // 스레드·X 는 안내문을 뺀다

    const 합치기 = (몸줄) => {
      const 조각 = [몸줄.join('\n').trim()];
      if (출처) 조각.push(출처);
      if (!짧음) 조각.push(NOTE);
      if (쓸태그.length) 조각.push(쓸태그.join(' '));
      return 조각.filter(Boolean).join('\n\n').trim();
    };

    let 글 = 합치기(몸);
    if (!ch.limit) return 글;
    while (글.length > ch.limit && 몸.length > 1) {
      몸.pop();
      while (몸.length && (!몸[몸.length - 1].trim() || 머리만(몸[몸.length - 1]))) 몸.pop();
      글 = 합치기(몸);
    }
    if (글.length > ch.limit && 몸.length) {
      const 여백 = 글.length - 몸[0].length;
      글 = 합치기([몸[0].slice(0, Math.max(20, ch.limit - 여백 - 1)).trim() + '…']);
    }
    return 글;
  }

  const MINE = '[여기에 우리 계정의 시각을 한두 문장 덧붙이세요]';
  const NOTE = '※ 원문을 요약·재구성한 초안입니다. 올리기 전에 사실관계와 표현을 확인하세요.';

  const BASE_TAGS = ['뉴스', '뉴스요약', '시사', '대학생', '오늘의뉴스', '뉴보대', '한국대학생포럼'];
  /* 제목·요약에 이 말이 있으면 해시태그를 하나 더 붙인다(caption.py 와 같은 표). */
  const FIELD_TAGS = [
    ['예산', '예산안'], ['부동산', '부동산'], ['금리', '금리'], ['환율', '환율'],
    ['반도체', '반도체'], ['AI', 'AI'], ['인공지능', 'AI'], ['고용', '고용'],
    ['北', '북한'], ['북한', '북한'], ['대통령', '대통령실'], ['국회', '국회'],
    ['검찰', '검찰'], ['법원', '법원'], ['추석', '추석'], ['의료', '의료'],
    ['교육', '교육'], ['등록금', '등록금'], ['청년', '청년'], ['기후', '기후'],
  ];

  /* ── 잔손질 ──────────────────────────────────────────────────────────── */
  // 기사 첫 문장에 붙는 발신지·바이라인. 두면 캡션이 "(서울=연합뉴스) 김OO 기자 =" 로 시작한다.
  const BYLINE = /^\s*(\([^)]{2,30}\)\s*)?([가-힣]{2,4}\s*(?:특파원|기자|앵커|논설위원|선임기자)\s*[=＝·]\s*)*/;

  function clean(s) {
    s = String(s == null ? '' : s).replace(BYLINE, '').trim();
    return s.replace(/^[=＝·\-–\s]+/, '').replace(/\s+/g, ' ').trim();
  }

  function 날짜말(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? `${+m[2]}월 ${+m[3]}일` : '오늘';
  }

  /** 본문에서 문장 뽑기. summarizer.js 가 있으면 그쪽(파이썬 요약기 이식본)을 쓴다. */
  function sents(body, title, n, limit) {
    body = String(body || '').trim();
    if (!body) return [];
    limit = limit || 180;
    let rows = [];
    try {
      if (root.SUMMARIZER && root.SUMMARIZER.summarize) {
        rows = root.SUMMARIZER.summarize(body, title || '', limit, n) || [];
      }
    } catch (e) { rows = []; }
    if (!rows.length) {
      rows = body.split(/(?<=다\.)\s+|\n+/).map(clean).filter(s => s.length >= 18);
    }
    const out = [], seen = new Set();
    for (const s0 of rows) {
      const s = clean(s0);
      const k = s.replace(/\W/g, '').slice(0, 20);
      if (!s || seen.has(k)) continue;
      seen.add(k);
      out.push(s.length > limit ? s.slice(0, limit - 1) + '…' : s);
      if (out.length >= n) break;
    }
    return out;
  }

  /** 기사 재료 한 건에서 쓸 문장들 — 본문이 있으면 본문, 없으면 요약 한 줄. */
  function lines(it, n) {
    const 본문 = sents(it.body, it.title, n, 180);
    if (본문.length) return 본문;
    const s = clean(it.summary);
    return s ? [s] : [];
  }

  function hashtags(text, extra) {
    const tags = BASE_TAGS.slice();
    const hay = String(text || '');
    for (const [말, 태] of FIELD_TAGS) {
      if (hay.includes(말) && !tags.includes(태)) tags.push(태);
    }
    for (const t of (extra || [])) if (t && !tags.includes(t)) tags.push(t);
    return tags.map(t => '#' + t);
  }

  function sourceLine(press, title, date) {
    const bits = [];
    if (press) bits.push(press);
    if (title) bits.push(`「${title}」`);
    let line = '🔗 출처: ' + (bits.length ? bits.join(' ') : '원문 기사');
    const d = 날짜말(date);
    if (d !== '오늘') line += ` (${d})`;
    return line;
  }

  /* ── 인용문(쌍따옴표) ─────────────────────────────────────────────────
     related.py 의 quotes() 와 같은 규칙. 홑따옴표는 강조에도 쓰여 빼 둔다. */
  const QUOTE_RE = /[“”"＂]([^“”"＂\n]{10,160})[“”"＂]/g;

  function quotes(body, n) {
    const out = [], seen = new Set();
    let m;
    QUOTE_RE.lastIndex = 0;
    while ((m = QUOTE_RE.exec(String(body || '')))) {
      let s = m[1].replace(/\s+/g, ' ').trim();
      const 열림 = s.indexOf('(');
      if (열림 > 0 && (s.split('(').length > s.split(')').length)) s = s.slice(0, 열림).trim();
      s = s.replace(/[,.…·!?]+$/, '');
      if (s.length < 12) continue;
      const k = s.replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 40);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    out.sort((a, b) => b.length - a.length);
    return out.slice(0, n || 3);
  }

  /** 같은 발언을 인용한 기사 묶음 → 캡션에 넣을 줄들. 없으면 빈 배열. */
  function quoteSection(quoted, short) {
    if (!quoted || !(quoted.items || []).length) return [];
    const 말 = String(quoted.quote || '').trim();
    const 매체 = [];
    for (const r of quoted.items) {
      const p = (r.press || '').trim() || '(언론사 미상)';
      if (!매체.includes(p)) 매체.push(p);
    }
    const 머리 = 말 ? `🗣 “${말}”` : '🗣 같은 발언을 실은 보도';
    const 셈 = `이 발언을 그대로 실은 보도 ${quoted.items.length}건` +
      (매체.length ? ' · ' + 매체.slice(0, 4).join(' · ') : '');
    if (short) return ['', 머리, 셈];
    const L = ['', 머리, 셈];
    if (quoted.items.length < 3) {
      L.push('(3건을 채우지 못했습니다 — 같은 발언을 실은 기사가 이만큼만 잡혔습니다)');
    }
    for (const r of quoted.items.slice(0, 6)) {
      L.push(`· ${(r.press || '').trim() || '(언론사 미상)'} — ${(r.title || '').trim()}`);
    }
    return L;
  }

  /* ── 기사 한 건 ──────────────────────────────────────────────────────── */
  function one(item, style, opts) {
    item = item || {};
    opts = opts || {};
    style = style || 'news';
    const title = clean(item.title);
    const press = clean(item.press || item.source);
    const rows = lines(item, style === 'brief' ? 3 : 6);
    const qs = quoteSection(opts.quoted, style === 'brief');
    const tags = hashtags(title + ' ' + (item.summary || '') + ' ' + (item.body || ''), opts.tags);
    const src = sourceLine(press, title, opts.date || item.date);
    let L = [];

    if (style === 'question') {
      // 「인스타 올리기」의 캡션 후보에만 있던 결. 글투로도 고를 수 있게 올렸다.
      const 낱말 = ((root.SUMMARIZER && root.SUMMARIZER.topic_words)
        ? (root.SUMMARIZER.topic_words(title + ' ' + (item.body || ''), 3) || []) : []);
      const k0 = 낱말[0] || (title || '이번 사안').slice(0, 8);
      L = [(hook(item) || `${k0}, 어떻게 보시나요?`), ''];
      L = L.concat(qs.slice(1));
      rows.slice(0, 3).forEach(s => L.push('· ' + s));
      L = L.concat(['', `${k0}, 여러분에게는 어떤 이야기인가요? 댓글로 남겨 주세요.`,
        '', MINE, '', src, NOTE, '', tags.join(' ')]);

    } else if (style === 'oneline') {
      L = [title];
      if (rows[0] && rows[0] !== title) L = L.concat(['', rows[0]]);
      L = L.concat(['', src, NOTE, '', tags.slice(0, 8).join(' ')]);

    } else if (style === 'brief') {
      L = [title, ''];
      rows.slice(0, 3).forEach(s => L.push('· ' + s));
      L = L.concat(qs, ['', src, NOTE, '', tags.join(' ')]);

    } else if (style === 'magazine') {
      L = [title];
      for (let i = 0; i < rows.length; i += 2) {
        L.push('');
        L = L.concat(rows.slice(i, i + 2));
      }
      L = L.concat(qs, ['', MINE, '', src, NOTE, '', tags.join(' ')]);

    } else if (style === 'cards') {
      L = ['🗂 카드 대사 초안 — 이 기사 한 건',
        '「앞장 만들기」의 후킹 문구 / 제목 / 요약문 칸에 그대로 옮겨 넣으세요.',
        '', '━━ 1장 · 표지 ━━',
        `제목      ▸ ${title}`,
        `요약문    ▸ ${rows[0] || '(요약이 없습니다)'}`];
      rows.slice(1).forEach((s, i) => {
        L.push('', `━━ ${i + 2}장 ━━`, `요약문    ▸ ${s}`);
      });
      L = L.concat(qs, ['', '━━ 마지막 장 · 뒷장 ━━',
        '출처 표기 ▸ ' + (press ? `${press} 「${title}」` : '원문 기사'),
        '', MINE, '', src, NOTE, '', tags.join(' ')]);

    } else {                                     // news
      L = [title, '', '📌 무슨 일인가'];
      rows.slice(0, 3).forEach(s => L.push('· ' + s));
      if (rows.length > 3) {
        L.push('', '📊 짚어볼 점');
        rows.slice(3).forEach(s => L.push('· ' + s));
      }
      L = L.concat(qs, ['', MINE, '', src, NOTE, '', tags.join(' ')]);
    }
    return finish(L, style, item, opts);
  }

  /* ── 여러 건(브리핑 한 게시물) ───────────────────────────────────────── */
  function many(items, style, opts) {
    items = (items || []).filter(x => x && (x.title || '').trim());
    opts = opts || {};
    style = style || 'news';
    const 날 = 날짜말(opts.date);
    const 출처 = [];
    items.forEach(it => {
      const p = clean(it.press || it.source);
      if (p && !출처.includes(p)) 출처.push(p);
    });
    const tags = hashtags(items.map(x => (x.title || '') + ' ' + (x.summary || '')).join(' '), opts.tags);
    const qs = quoteSection(opts.quoted, style === 'brief');
    let L = [];

    if (style === 'question') {
      L = [`${날}, 오늘 이 소식은 어떻게 보시나요?`, ''];
      items.forEach((it, i) => L.push(`${i + 1}. ${clean(it.title)}`));
      L = L.concat(qs, ['', '가장 눈에 띈 번호를 댓글로 남겨 주세요.', '', MINE]);

    } else if (style === 'oneline') {
      L = [`📰 ${날} 오늘의 뉴스 ${items.length}꼭지`, '',
        items.map(x => clean(x.title)).join(' / ')];
      L = L.concat(qs.slice(0, 3));

    } else if (style === 'brief') {
      L = [`📰 ${날} 뉴스 ${items.length}꼭지`, ''];
      items.forEach((it, i) => L.push(`${i + 1}. ${clean(it.title)}`));
      L = L.concat(qs);

    } else if (style === 'magazine') {
      L = [`${날}, 오늘 눈에 띈 ${items.length}가지`];
      items.forEach(it => {
        L.push('');
        L.push(clean(it.title));
        const s = (lines(it, 2) || []);
        if (s.length) L = L.concat(s);
      });
      L = L.concat(qs, ['', MINE]);

    } else if (style === 'cards') {
      L = [`🗂 카드 대사 초안 — 표지 1장 + 뉴스 ${items.length}장 + 뒷장 1장`,
        '「앞장 만들기」의 후킹 문구 / 제목 / 요약문 칸에 그대로 옮겨 넣으세요.',
        '', '━━ 1장 · 표지 ━━',
        `제목      ▸ ${날} 오늘의 뉴스`,
        `요약문    ▸ ${items.slice(0, 3).map(x => clean(x.title)).join(' / ')}`];
      items.forEach((it, i) => {
        L.push('', `━━ ${i + 2}장 · NEWS ${String(i + 1).padStart(2, '0')} ━━`,
          `제목      ▸ ${clean(it.title)}`,
          `요약문    ▸ ${(lines(it, 1)[0] || clean(it.press || it.source) || '')}`);
      });
      L.push('', `━━ ${items.length + 2}장 · 뒷장 ━━`, '계정 소개 뒷장을 붙이세요.');
      L = L.concat(qs);

    } else {                                     // news
      L = [`📰 ${날} 오늘의 뉴스`, ''];
      items.forEach((it, i) => {
        L.push(`${i + 1}. ${clean(it.title)}`);
        const s = lines(it, 1)[0];
        if (s) L.push(`   ${s}`);
      });
      L = L.concat(qs, ['', '자세한 내용은 각 카드에서 확인하세요.', '', MINE]);
    }

    L.push('');
    if (출처.length) L.push('🔗 출처: ' + 출처.join(', '));
    L.push(NOTE, '', tags.join(' '));
    return finish(L, style, { title: `${날} 오늘의 뉴스` }, opts);
  }

  /** 후킹 문구 한 줄. summarizer 가 있으면 그쪽 것을 쓴다. */
  function hook(item) {
    try {
      if (root.SUMMARIZER && root.SUMMARIZER.hooks) {
        return (root.SUMMARIZER.hooks(item.body || '', item.title || '') || [''])[0] || '';
      }
    } catch (e) { /* 없으면 없는 대로 */ }
    return '';
  }

  function finish(L, style, item, opts) {
    opts = opts || {};
    const raw = L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const tags = (raw.match(/#[^\s#]+/g) || []);
    const ch = channelOf(opts.channel);
    const text = shape(raw, tags, ch.id);
    return {
      text: text, style: style, chars: text.length,
      channel: ch.id, channelName: ch.name, limit: ch.limit,
      warn: !!ch.limit && text.length > ch.limit,
      quoted: ((opts.quoted && opts.quoted.items) || []).length,
      title: (item && item.title) || '',
    };
  }

  /** 글투에 맞는 제목 후보. 재료는 전부 기사에서 나온다(지어내지 않는다). */
  function titles(item, style, n) {
    item = item || {};
    const 길이 = { brief: 14, oneline: 18, cards: 22, question: 24, news: 28, magazine: 30 };
    const 자름 = 길이[style] || 26;
    const out = [];
    try {
      if (root.SUMMARIZER && root.SUMMARIZER.titles) {
        (root.SUMMARIZER.titles(item.body || '', item.title || '', 자름) || [])
          .forEach(t => out.push(t));
      }
    } catch (e) { /* 없으면 아래 재료로만 */ }
    const 낱말 = ((root.SUMMARIZER && root.SUMMARIZER.topic_words)
      ? (root.SUMMARIZER.topic_words((item.title || '') + ' ' + (item.body || ''), 3) || []) : []);
    const k0 = 낱말[0] || (clean(item.title) || '이번 사안').slice(0, 8);
    const k1 = 낱말[1] || k0;
    const 덧 = {
      brief: [`${k0} ${k1}`, `${k0}, 무슨 일`, `${k0} 3줄 정리`],
      magazine: [`${k0}, 다시 묻는다`, `${k0}의 안쪽`, `${k0}, 그 다음은`],
      question: [`${k0}, 어떻게 보시나요`, `${k0}, 여러분 생각은`],
      oneline: [`${k0} 한 줄 정리`, `${k0}, 이것만`],
      cards: [`${k0}, 알고 계셨나요`, `${k0}, 정리했습니다`],
      news: [`${k0}, ${k1} 어떻게 되나`, `${k0}, 이렇게 바뀐다`],
    }[style] || [];
    덧.forEach(t => out.push(t));
    const 본 = clean(item.title);
    if (본) out.push(본.length > 30 ? 본.slice(0, 29) + '…' : 본);
    const seen = new Set(), 결과 = [];
    for (const t of out) {
      const s = clean(t);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      결과.push(s);
      if (결과.length >= (n || 6)) break;
    }
    return 결과;
  }

  root.FEEDSTYLES = {
    STYLES, CHANNELS, one, many, quotes, hashtags, sents, clean, shape, titles,
    styleOf: (id) => STYLES.find(s => s.id === id) || STYLES[0],
    channelOf,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
