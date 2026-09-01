/* 시리즈(캐러셀) 편집기 — 표지 + 본문 장 + 뒷장을 **한 화면**에서.
 *
 * 왜 만들었나: 이 앱은 「기사 1건 = 앞장 1장」 이었다. 캐러셀을 만들려면 앞장을 만들고 →
 * 올리기에 담고 → 돌아와 같은 틀로 2장째를 다시 만들고 … 를 왕복해야 했다. 실제 첫
 * 게시물은 표지·시사·경제·정치·뒷장 5장이었고, 그 왕복이 이 도구를 안 쓰게 만드는
 * 마찰이었다. 그래서 장 목록(deck)을 캔버스 위에 띠로 두고, 장마다 앱의 상태 S 한 벌을
 * 통째로 들고 있게 했다 — **편집기는 한 줄도 안 바꾸고** 장만 갈아 끼운다.
 *
 * 구조
 *  - pages[i] = { id, kind:'card'|'outro', tpl, S, bgImg, outroId, thumb }
 *  - 지금 장의 S·bgImg 는 app.js 의 전역 `S`·`bgImg` 가 **그 자체**다(복사가 아니다).
 *    장을 떠날 때 commit() 으로 pages[cur] 에 적고, 들어올 때 전역에 얹는다.
 *  - '뒷장' 장은 outro.js 가 그린다(뒷장 만들기 화면의 설정 OUTROST 그대로). 이 장이 떠 있을
 *    때 app.js 의 render()·마우스는 손을 뗀다(isOutroActive).
 *  - 저장(localStorage `nb_deck`)은 S 만 — 사진(data:/blob:)은 오늘도 새로고침에 날아가듯
 *    여기서도 URL 사진만 되살아난다.
 *
 * app.js 가 열어 둔 손잡이: S, bgImg, logoImg, render, loadFonts, loadImage, mergeState,
 * syncAllFromState, designOf, applyDesign, outCanvas, outName, api, msg, aiServerCfg, PROG, SAVE.
 * (전부 classic script 의 최상위 let/const/function 이라 이름으로 닿는다 — window.X 아님.)
 */
(function (global) {
  'use strict';

  const KEY = (typeof PURE !== 'undefined' && PURE) ? 'nb_deck_pure' : 'nb_deck';
  const TW = 64, TH = 80;                      // 작은 그림 크기 (1080:1350 = 4:5)
  const pages = [];
  let cur = 0;
  let sweeping = false;                        // 전 장 훑는 중(작은 그림 갱신 금지)
  let booted = false;
  let outroST = null, outroImgs = null;        // 뒷장 설정·그림 캐시

  const uid = () => 'p' + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad2 = (n) => String(n).padStart(2, '0');
  const isOutro = (p) => p && p.kind === 'outro';
  const TPL_NAMES = { cover: '표지', point: '포인트', number: '숫자', quote: '인용', list: '목록', blank: '빈 장', outro: '뒷장' };

  /* ───────────── 장 템플릿 — 지금 장의 디자인을 물려받고 글 자리·크기만 바꾼다 ───────────── */
  function freshFrom(baseS) {
    const st = mergeState(clone(baseS));
    TEXT_KEYS.forEach(k => { st.layers[k].text = ''; });
    return st;
  }
  /** 표지 자리(기본값의 x/y/size/align)로 돌려놓되 글꼴·색은 지금 것을 지킨다. */
  function coverGeometry(st) {
    const d = defaults();
    TEXT_KEYS.forEach(k => {
      const L = st.layers[k], D = d.layers[k];
      Object.assign(L, { x: D.x, y: D.y, size: D.size, align: D.align, width: D.width, line: D.line, box: 'none', on: k !== 'credit' ? true : L.on });
    });
    return st;
  }
  const TEMPLATES = {
    cover(st, d) {
      coverGeometry(st);
      st.layers.kicker.text = d.hook || '';
      st.layers.title.text = d.title || '';
      st.layers.body.text = d.summary || '';
      return st;
    },
    point(st, d) {
      const K = st.layers.kicker, T = st.layers.title, B = st.layers.body;
      Object.assign(K, { on: true, text: d.label || 'POINT', x: 72, y: 690, size: 30, weight: '800', align: 'left', width: 60, box: 'pill', boxColor: st.decoColor || T.accent || '#e11d48', color: '#ffffff', opacity: 100, line: 130 });
      Object.assign(T, { on: true, text: d.head || '', x: 72, y: 770, size: 66, align: 'left', width: 86, line: 122 });
      Object.assign(B, { on: true, text: d.body || '', x: 72, y: 1110, size: 31, align: 'left', width: 84, line: 150 });
      return st;
    },
    number(st, d) {
      const K = st.layers.kicker, T = st.layers.title, B = st.layers.body;
      Object.assign(K, { on: true, text: d.label || 'POINT', x: 72, y: 560, size: 30, weight: '800', align: 'left', width: 60, box: 'pill', boxColor: st.decoColor || T.accent || '#e11d48', color: '#ffffff', opacity: 100, line: 130 });
      Object.assign(T, { on: true, text: d.num || '00%', x: 72, y: 640, size: 190, weight: '900', font: 'Gmarket Sans', align: 'left', width: 90, line: 105, space: -30 });
      const head = (d.head || '').trim(), body = (d.body || '').trim();
      Object.assign(B, { on: true, text: [head ? `**${head}**` : '', body].filter(Boolean).join('\n'), x: 72, y: 960, size: 33, align: 'left', width: 84, line: 150 });
      return st;
    },
    quote(st, d) {
      const K = st.layers.kicker, T = st.layers.title, B = st.layers.body;
      Object.assign(K, { on: true, text: d.label || 'QUOTE', x: 72, y: 600, size: 30, weight: '800', align: 'left', width: 60, box: 'pill', boxColor: st.decoColor || T.accent || '#e11d48', color: '#ffffff', opacity: 100, line: 130 });
      const q = (d.head || '').trim().replace(/^["“]|["”]$/g, '');
      Object.assign(T, { on: true, text: q ? `“${q}”` : '', x: 72, y: 680, size: 58, font: 'Noto Serif KR', weight: '700', align: 'left', width: 86, line: 134 });
      const who = (d.who || '').trim(), body = (d.body || '').trim();
      Object.assign(B, { on: true, text: [who ? `- ${who}` : '', body].filter(Boolean).join('\n'), x: 72, y: 1120, size: 30, align: 'left', width: 84, line: 150 });
      return st;
    },
    list(st, d) {
      const K = st.layers.kicker, T = st.layers.title, B = st.layers.body;
      Object.assign(K, { on: true, text: d.label || 'POINT', x: 72, y: 560, size: 30, weight: '800', align: 'left', width: 60, box: 'pill', boxColor: st.decoColor || T.accent || '#e11d48', color: '#ffffff', opacity: 100, line: 130 });
      Object.assign(T, { on: true, text: d.head || '핵심 3가지', x: 72, y: 640, size: 62, align: 'left', width: 86, line: 122 });
      const body = (d.body || '').trim() || '① \n② \n③ ';
      Object.assign(B, { on: true, text: body, x: 72, y: 800, size: 36, weight: '600', align: 'left', width: 86, line: 165 });
      return st;
    },
    blank(st) { return st; }
  };

  /* ───────────── 전역 S ↔ pages[cur] ───────────── */
  function commit() {
    const p = pages[cur];
    if (!p || isOutro(p)) return;
    p.S = S; p.bgImg = bgImg || null;
  }
  function baseCard() {
    // 새 장의 바탕이 될 카드 한 장 — 지금 장(카드면) → 가장 가까운 카드 → 기본값
    const p = pages[cur];
    if (p && !isOutro(p)) return p;
    for (let i = cur; i >= 0; i--) if (!isOutro(pages[i])) return pages[i];
    return pages.find(x => !isOutro(x)) || null;
  }

  /* ───────────── 뒷장 그리기 ───────────── */
  async function loadOutro(force) {
    if (typeof OUTROST === 'undefined' || typeof OUTRO === 'undefined') return false;
    const st = OUTROST.load();
    const changed = !outroST || JSON.stringify([st.bg, st.logo]) !== JSON.stringify([outroST.bg, outroST.logo]);
    outroST = st;
    if (force || changed || !outroImgs) outroImgs = await OUTROST.images(st);
    return true;
  }
  function drawOutroTo(p) {
    if (!outroST || typeof OUTRO === 'undefined') return;
    const id = OUTRO.byId[p.outroId] ? p.outroId : outroST.sel;
    OUTRO.draw(ctx, id, OUTROST.opts(outroST, id, outroImgs && outroImgs.logoImg, outroImgs && outroImgs.bgImg));
  }
  let outroDrawing = false;
  async function renderOutro() {
    const p = pages[cur];
    if (!isOutro(p) || outroDrawing) return;
    outroDrawing = true;
    try {
      if (await loadOutro(false)) {
        if (OUTRO.loadFonts) await OUTRO.loadFonts();
        drawOutroTo(p);
        thumbOf(p);
      }
    } finally { outroDrawing = false; }
  }

  /* ───────────── 장 전환 ───────────── */
  async function activate(i, opt) {
    opt = opt || {};
    if (!opt.noCommit) commit();
    cur = Math.max(0, Math.min(i, pages.length - 1));
    const p = pages[cur];
    if (!p) return;
    if (isOutro(p)) {
      document.body.classList.add('deck-outro');
      $('deckOutroNote').hidden = false;
      await loadOutro(true);                 // 뒷장 화면에서 고쳤을 수 있다 — 매번 새로 읽는다
      await renderOutro();
    } else {
      document.body.classList.remove('deck-outro');
      $('deckOutroNote').hidden = true;
      S = p.S;
      bgImg = p.bgImg || null;
      if (!bgImg && S.bg.src) {
        try { bgImg = await loadImage(S.bg.src); p.bgImg = bgImg; } catch (e) { /* 사진 죽음 — 없이 간다 */ }
      }
      const want = S.logo.src || '';
      if (!want) logoImg = null;
      else if (!logoImg || (logoImg.src || '').indexOf(want) < 0) logoImg = await loadImage(want).catch(() => null);
      syncAllFromState();
      render();
      await loadFonts();
      render();
    }
    paint();
    persist();
  }

  /* ───────────── 장 만들기/지우기/옮기기 ───────────── */
  function makeCard(tpl, data, fromS, fromBg) {
    const base = fromS || (baseCard() ? baseCard().S : S);
    const st = freshFrom(base);
    (TEMPLATES[tpl] || TEMPLATES.blank)(st, data || {});
    const bg = fromBg !== undefined ? fromBg : (baseCard() ? baseCard().bgImg : bgImg);
    return { id: uid(), kind: 'card', tpl, S: st, bgImg: bg || null, thumb: null };
  }
  function makeOutro() {
    const sel = (typeof OUTROST !== 'undefined') ? OUTROST.load().sel : '';
    return { id: uid(), kind: 'outro', tpl: 'outro', S: null, bgImg: null, outroId: sel, thumb: null };
  }
  async function add(tpl, data, at) {
    commit();
    const p = tpl === 'outro' ? makeOutro() : makeCard(tpl, data);
    const idx = at == null ? cur + 1 : at;
    pages.splice(idx, 0, p);
    await activate(idx, { noCommit: true });
    return p;
  }
  async function remove(i) {
    if (pages.length <= 1) { msg($('fetchMsg'), '마지막 한 장은 지울 수 없습니다. 「새 기사」로 비우세요.', 'err'); return; }
    commit();
    pages.splice(i, 1);
    await activate(Math.min(i, pages.length - 1), { noCommit: true });
  }
  async function duplicate(i) {
    commit();
    const src = pages[i];
    const p = isOutro(src) ? makeOutro() : { id: uid(), kind: 'card', tpl: src.tpl, S: mergeState(clone(src.S)), bgImg: src.bgImg, thumb: null };
    if (isOutro(src)) p.outroId = src.outroId;
    pages.splice(i + 1, 0, p);
    await activate(i + 1, { noCommit: true });
  }
  async function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    commit();
    const [p] = pages.splice(i, 1);
    pages.splice(j, 0, p);
    await activate(j, { noCommit: true });
  }
  function resetToOne() {
    // 새 기사: 지금 장(카드) 한 장만 남긴다. 뒷장이 떠 있었으면 가장 가까운 카드로.
    const keep = baseCard();
    pages.length = 0;
    if (keep) { pages.push(keep); }
    else pages.push({ id: uid(), kind: 'card', tpl: 'cover', S, bgImg: bgImg || null, thumb: null });
    cur = 0;
    document.body.classList.remove('deck-outro');
    if ($('deckOutroNote')) $('deckOutroNote').hidden = true;
    // S 가 지금 전역과 같은 객체가 되도록 — newArticle 이 이어서 S 를 비우므로 여기선 건드리지 않는다
    if (pages[0].S !== S) { pages[0].S = S; pages[0].bgImg = bgImg || null; }
    paint();
    persist();
  }

  /* ───────────── 자동 구성 ───────────── */
  async function autoCompose() {
    const text = $('inBody').value.trim();
    if (!text) return msg($('fetchMsg'), '먼저 기사를 가져오거나 본문을 붙여넣으세요.', 'err');
    const n = +$('deckAutoN').value || 3;
    const withOutro = $('deckAutoOutro').checked;
    const ai = (typeof aiServerCfg === 'function') ? aiServerCfg() : { on: false };
    const p = PROG.start('btnDeckAuto', ai.on ? 'AI 가 나누는 중' : '나누는 중');
    try {
      await p.at(0.1, ai.on ? 'AI 가 나누는 중' : '나누는 중');
      const j = await api('/api/series', { text, title: $('inTitle').value.trim(), n, ai });
      const ser = j.series || {};
      await p.at(0.7, '장을 만드는 중');
      commit();
      const base = baseCard();
      const baseS = base ? base.S : S;
      const baseBg = base ? base.bgImg : bgImg;
      // 표지 = 지금 카드(디자인·사진 유지). 글은 받은 것으로 — 비어 온 칸은 지금 글을 지킨다
      const cover = mergeState(clone(baseS));
      const c = ser.cover || {};
      coverGeometry(cover);
      if (c.hook) cover.layers.kicker.text = c.hook;
      if (c.title) cover.layers.title.text = c.title;
      if (c.summary) cover.layers.body.text = c.summary;
      const list = [{ id: uid(), kind: 'card', tpl: 'cover', S: cover, bgImg: baseBg || null, thumb: null }];
      (ser.pages || []).forEach((pg, i) => {
        const tpl = TEMPLATES[pg.kind] ? pg.kind : 'point';
        const data = { ...pg, label: pg.label || `POINT ${i + 1}` };
        list.push(makeCard(tpl, data, cover, baseBg || null));
      });
      if (withOutro) list.push(makeOutro());
      pages.length = 0;
      list.forEach(x => pages.push(x));
      await activate(0, { noCommit: true });
      p.done('구성함');
      msg($('fetchMsg'), `시리즈 ${pages.length}장 — 표지 1 + 본문 ${(ser.pages || []).length}` + (withOutro ? ' + 뒷장 1' : '') +
        (ser.by === 'ai' ? ' (AI)' : ' (규칙기반 — AI 설정을 켜면 문장이 좋아집니다)') + '. 위 띠에서 장을 눌러 고치세요.', 'ok');
    } catch (e) {
      p.fail('실패');
      msg($('fetchMsg'), '자동 구성 실패: ' + e.message, 'err');
    }
  }

  /* ───────────── 오늘의 뉴스 → 브리핑 한 벌 ─────────────
     「오늘의 뉴스」 화면(daily.html)에서 기사 여러 건을 골라 오면 표지 1장 +
     기사마다 1장을 세운다. **본문을 가져오지 않는다** — 제목·매체만으로 세우고
     살은 사람이 붙인다(기사 N건의 본문을 한 번에 긁으면 언론사에 무리도 가고
     느리다). 기사 하나를 깊게 다룰 때는 `카드` 단추 → `?auto=series` 쪽이다. */
  const MONTH_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
  function briefTitle(date) {
    const m = MONTH_DAY.exec(date || '');
    if (!m) return '오늘의 뉴스';
    return `${+m[2]}월 ${+m[3]}일 뉴스`;
  }
  async function briefFrom(d) {
    const items = (d && d.items || []).filter(x => x && x.title);
    if (!items.length) return msg($('fetchMsg'), '고른 기사가 없습니다.', 'err');
    const p = PROG.start('btnDeckAuto', '브리핑 세우는 중');
    try {
      commit();
      const base = baseCard();
      const baseS = base ? base.S : S;
      const baseBg = base ? base.bgImg : bgImg;

      // 기사 사진을 먼저 싣는다. 사진이 없으면 카드가 '검은 화면'처럼 보인다(2026-09-02 지적).
      // 부르는 쪽이 **같은 출처** 주소로 줘야 한다 - 다른 출처면 캔버스가 오염돼 저장이 막힌다.
      const 사진 = {};
      for (const it of items) {
        if (!it.photo || 사진[it.photo]) continue;
        try { 사진[it.photo] = await loadImage(it.photo); } catch (e) { /* 없으면 없는 대로 */ }
      }

      const cover = mergeState(clone(baseS));
      coverGeometry(cover);
      cover.layers.kicker.text = '오늘의 뉴스';
      cover.layers.title.text = briefTitle(d.date);
      cover.layers.body.text = items.slice(0, 3).map(x => '· ' + x.title).join('\n');
      // 표지에도 첫 기사 사진을 깔아 준다(사진이 하나도 없으면 지금 카드 그대로).
      const 표지감 = items.find(x => x.photo && 사진[x.photo]);
      cover.bg.src = 표지감 ? 표지감.photo : '';
      const list = [{
        id: uid(), kind: 'card', tpl: 'cover', S: cover,
        bgImg: 표지감 ? 사진[표지감.photo] : (baseBg || null), thumb: null
      }];

      items.forEach((it, i) => {
        const img = it.photo ? 사진[it.photo] : null;
        const card = makeCard('point', {
          label: 'NEWS ' + pad2(i + 1),
          head: it.title,
          // 요약이 있으면 요약을, 없으면 매체 이름만. 카드에 할 말이 있어야 한다.
          body: (it.summary || '').trim() || it.press || it.source || ''
        }, cover, img || null);
        card.S.bg.src = img ? it.photo : '';
        list.push(card);
      });
      if (d.outro) list.push(makeOutro());

      pages.length = 0;
      list.forEach(x => pages.push(x));
      await activate(0, { noCommit: true });
      p.done('세웠음');
      msg($('fetchMsg'), `브리핑 ${pages.length}장 — 표지 1 + 기사 ${items.length}` +
        (d.outro ? ' + 뒷장 1' : '') + '. 위 띠에서 장을 눌러 문구를 고치세요.', 'ok');
    } catch (e) {
      p.fail('실패');
      msg($('fetchMsg'), '브리핑 만들기 실패: ' + e.message, 'err');
    }
  }

  /* 「오늘의 뉴스」에서 넘어온 일감 처리 — 주소의 `?auto=` 를 본다.
       series : `?url=` 로 이미 가져오기가 걸려 있다. 본문이 차기를 기다렸다 자동 구성.
       brief  : localStorage `nb_daily` 에 담겨 온 기사들로 브리핑. */
  async function autoFromDaily() {
    let sp;
    try { sp = new URLSearchParams(location.search); } catch (e) { return; }
    const want = sp.get('auto') || '';
    if (!want) return;
    if (want === 'brief') {
      let d = null;
      try { d = JSON.parse(localStorage.getItem('nb_daily') || 'null'); } catch (e) { d = null; }
      try { localStorage.removeItem('nb_daily'); } catch (e) { /* 무시 */ }
      if (d) await briefFrom(d);
      return;
    }
    if (want !== 'series') return;
    // 본문이 채워질 때까지 기다린다(가져오기는 app.js 가 이미 눌렀다). 최대 25초.
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const body = ($('inBody').value || '').trim();
      if (body.length > 120) { await autoCompose(); return; }
      await new Promise(r => setTimeout(r, 400));
    }
    msg($('fetchMsg'), '본문을 못 가져와 자동 구성을 건너뜁니다. 본문을 붙여넣고 「자동 구성」을 누르세요.', 'err');
  }

  /* ───────────── 디자인 전 장 적용 ───────────── */
  async function applyDesignAll(d) {
    commit();
    d = d || designOf(S);
    pages.forEach(p => { if (!isOutro(p)) p.S = applyDesign(p.S, d); });
    await activate(cur, { noCommit: true });
    pages.forEach(p => { if (!isOutro(p) && p !== pages[cur]) p.thumb = null; });
    refreshThumbsLater();
  }

  /* ───────────── 전 장 그리기(저장·올리기) ─────────────
     동기로 훑는다 — NAV 의 stage 콜백이 동기라서. 사진·글꼴은 이미 실려 있을 때만 제대로 나온다.
     (장을 한 번이라도 열었거나 boot 의 예열이 끝났으면 실려 있다.) */
  function sweep(fn) {
    commit();
    const keepS = S, keepBg = bgImg, keepCur = cur;
    const wasOutro = isOutro(pages[cur]);
    sweeping = true;
    try {
      pages.forEach((p, i) => {
        cur = i;
        if (isOutro(p)) {
          if (outroST) drawOutroTo(p);
        } else {
          S = p.S; bgImg = p.bgImg || null;
          render();
        }
        fn(p, i);
      });
    } finally {
      cur = keepCur; S = keepS; bgImg = keepBg;
      sweeping = false;
      if (wasOutro) { if (outroST) drawOutroTo(pages[cur]); } else render();
    }
  }
  function baseName() { return outName(); }
  function stageItems() {
    const items = [];
    sweep((p, i) => items.push({ canvas: outCanvas(), name: `${baseName()}_${pad2(i + 1)}` }));
    return items;
  }
  async function preloadAll() {
    // 안 열어 본 장의 사진을 미리 실어 둔다 — 그래야 stageItems() 가 사진 있는 그림을 준다
    for (const p of pages) {
      if (isOutro(p)) { await loadOutro(false); continue; }
      if (!p.bgImg && p.S && p.S.bg && p.S.bg.src) {
        try { p.bgImg = await loadImage(p.S.bg.src); } catch (e) { /* */ }
      }
    }
  }
  async function saveAll(mode) {
    if (!pages.length) return;
    const btn = mode === 'download' ? 'btnDeckDownloadAll' : 'btnDeckSaveAll';
    const p = PROG.start(btn, '준비 중');
    try {
      await preloadAll();
      await p.at(0.1, '그리는 중');
      const items = stageItems();
      const paths = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const f0 = 0.15 + 0.8 * (i / items.length), f1 = 0.15 + 0.8 * ((i + 1) / items.length);
        await p.at(f0, `${i + 1}/${items.length} 저장 중`);
        if (mode === 'download') {
          const blob = await new Promise(r => it.canvas.toBlob(r, 'image/png'));
          paths.push(await SAVE.file(blob, it.name + '.png'));
        } else {
          const j = await PROG.postJSON('/api/save', { dataUrl: it.canvas.toDataURL('image/png'), name: it.name },
            f => p.at(f0 + (f1 - f0) * f, `${i + 1}/${items.length} 보내는 중`));
          paths.push(j.path);
        }
      }
      p.done(`${items.length}장 저장`);
      msg($('fetchMsg'), `시리즈 ${items.length}장 저장 → ${paths[0] || ''}${paths.length > 1 ? ' … ' + paths[paths.length - 1].split(/[\\/]/).pop() : ''}` + hiddenNote(), 'ok');
    } catch (e) {
      p.fail('실패');
      msg($('fetchMsg'), '시리즈 저장 실패: ' + e.message, 'err');
    }
  }

  /* ───────────── 작은 그림·띠 그리기 ───────────── */
  function thumbOf(p) {
    if (!p.thumb) { p.thumb = document.createElement('canvas'); p.thumb.width = TW; p.thumb.height = TH; }
    const g = p.thumb.getContext('2d');
    g.clearRect(0, 0, TW, TH);
    g.drawImage(cv, 0, 0, TW, TH);
    return p.thumb;
  }
  let thumbTimer = null;
  function afterRender() {
    if (sweeping || !booted) return;
    const p = pages[cur];
    if (!p || isOutro(p)) return;
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => { thumbOf(p); paintThumbOnly(p); persist(); }, 120);
  }
  function refreshThumbsLater() {
    // 안 열어 본 장은 작은 그림이 없다 — 조용히 한 번 훑어 채운다(사진은 preloadAll 뒤에)
    setTimeout(async () => {
      await preloadAll();
      sweep((p) => { thumbOf(p); });
      paint();
    }, 50);
  }
  function paintThumbOnly(p) {
    const el = document.querySelector(`.deck-thumb[data-id="${p.id}"] canvas`);
    if (el && p.thumb) { el.getContext('2d').clearRect(0, 0, TW, TH); el.getContext('2d').drawImage(p.thumb, 0, 0); }
  }
  function paint() {
    const root = $('deckPages');
    if (!root) return;
    root.innerHTML = '';
    pages.forEach((p, i) => {
      const d = document.createElement('div');
      d.className = 'deck-thumb' + (i === cur ? ' on' : '') + (isOutro(p) ? ' outro' : '');
      d.dataset.id = p.id;
      d.title = `${i + 1}장 · ${TPL_NAMES[p.tpl] || p.tpl}`;
      const c = document.createElement('canvas'); c.width = TW; c.height = TH;
      if (p.thumb) c.getContext('2d').drawImage(p.thumb, 0, 0);
      d.appendChild(c);
      const n = document.createElement('span'); n.className = 'num'; n.textContent = i + 1; d.appendChild(n);
      const t = document.createElement('span'); t.className = 'tpl'; t.textContent = TPL_NAMES[p.tpl] || ''; d.appendChild(t);
      d.addEventListener('click', (ev) => { if (ev.target.closest('.deck-ops')) return; activate(i); });
      if (i === cur) {
        const ops = document.createElement('div'); ops.className = 'deck-ops';
        const mk = (txt, title, fn) => { const b = document.createElement('button'); b.textContent = txt; b.title = title; b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); }); ops.appendChild(b); };
        mk('◀', '앞으로', () => move(i, -1));
        mk('▶', '뒤로', () => move(i, 1));
        mk('⧉', '복제', () => duplicate(i));
        mk('✕', '이 장 지우기', () => { if (confirm(`${i + 1}장을 지울까요?`)) remove(i); });
        d.appendChild(ops);
      }
      root.appendChild(d);
    });
    const cnt = $('deckCount');
    if (cnt) cnt.textContent = `${pages.length}장`;
    const on = document.querySelector('.deck-thumb.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* ───────────── 저장/복원 ───────────── */
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      commit();
      try {
        localStorage.setItem(KEY, JSON.stringify({
          cur, pages: pages.map(p => ({ id: p.id, kind: p.kind, tpl: p.tpl, S: isOutro(p) ? null : p.S, outroId: p.outroId || '' }))
        }));
      } catch (e) { /* 용량 초과 — 장 수를 줄이라고 알릴 자리 */ }
    }, 300);
  }
  function restore() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const j = JSON.parse(raw);
      if (!j || !Array.isArray(j.pages) || !j.pages.length) return false;
      // 한 장짜리는 앱의 원래 저장(nb_state)이 진실이다 — 두 곳이 갈라지지 않게 여기선 물러난다.
      // (장이 둘 이상일 때만 장 목록이 진실.) 옛 상태 복원·다른 시험들이 nb_state 만 본다.
      if (j.pages.length === 1 && j.pages[0].kind !== 'outro') return false;
      j.pages.forEach(p => {
        if (p.kind === 'outro') pages.push({ id: p.id || uid(), kind: 'outro', tpl: 'outro', S: null, bgImg: null, outroId: p.outroId || '', thumb: null });
        else pages.push({ id: p.id || uid(), kind: 'card', tpl: p.tpl || 'cover', S: mergeState(p.S || {}), bgImg: null, thumb: null });
      });
      cur = Math.max(0, Math.min(+j.cur || 0, pages.length - 1));
      return true;
    } catch (e) { pages.length = 0; return false; }
  }

  /* ───────────── 단추 ───────────── */
  function bind() {
    const menu = $('deckAddMenu');
    $('btnDeckAdd').addEventListener('click', (ev) => { ev.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', (ev) => { if (!ev.target.closest('.deck-add')) menu.hidden = true; });
    menu.querySelectorAll('button[data-tpl]').forEach(b => b.addEventListener('click', async () => {
      menu.hidden = true;
      const tpl = b.dataset.tpl;
      const n = pages.filter(p => !isOutro(p) && p.tpl !== 'cover').length + 1;
      await add(tpl, { label: `POINT ${n}` });
      msg($('fetchMsg'), `${cur + 1}장(${TPL_NAMES[tpl]}) 추가 — 지금 장의 디자인을 물려받았습니다. 왼쪽에서 글을 고치세요.`, 'ok');
    }));
    $('btnDeckAuto').addEventListener('click', autoCompose);
    $('btnDeckDesignAll').addEventListener('click', async () => {
      if (isOutro(pages[cur])) return msg($('fetchMsg'), '카드 장을 골라 놓고 누르세요(그 장의 디자인을 퍼뜨립니다).', 'err');
      await applyDesignAll(designOf(S));
      msg($('fetchMsg'), `지금 장의 디자인을 ${pages.filter(p => !isOutro(p)).length}장 전부에 입혔습니다. 글·사진은 그대로입니다.`, 'ok');
    });
    $('btnDeckSaveAll').addEventListener('click', () => saveAll('out'));
    $('btnDeckDownloadAll').addEventListener('click', () => saveAll('download'));
  }

  async function boot() {
    if (!$('deckBar')) return;
    bind();
    const had = restore();
    if (!had) {
      pages.push({ id: uid(), kind: 'card', tpl: 'cover', S, bgImg: bgImg || null, thumb: null });
      cur = 0;
    }
    booted = true;
    if (had) {
      await activate(cur, { noCommit: true });
      refreshThumbsLater();
    } else {
      thumbOf(pages[0]);
      paint();
      persist();
    }
    autoFromDaily();                         // 「오늘의 뉴스」에서 넘어왔으면 이어서
  }

  global.DECK = {
    boot, count: () => pages.length, pages: () => pages, current: () => cur,
    activate, add, remove, move, duplicate, resetToOne, autoCompose, applyDesignAll,
    briefFrom,
    stageItems, saveAll, afterRender, renderOutro, paint,
    isOutroActive: () => isOutro(pages[cur])
  };

  if (typeof APP_READY !== 'undefined' && APP_READY && APP_READY.then) APP_READY.then(boot).catch(boot);
  else boot();
})(window);
