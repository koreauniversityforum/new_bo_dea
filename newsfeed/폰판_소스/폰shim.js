/* 폰판 shim — 서버(app.py)가 하던 일을 브라우저 안에서 대신한다.
 *
 * 왜 이렇게 했나: 화면 코드(app.js·outro.js…)를 폰판용으로 복사하면 두 벌이 갈라진다.
 * 이 프로젝트에서 이미 겪은 함정이라, **원본 JS 를 그대로 쓰고** 서버로 나가는 길목
 * (`fetch` 와 `XMLHttpRequest`)만 가로챈다. 새 API 가 생기면 여기 ROUTES 에 한 줄
 * 늘리면 되고, 안 늘리면 화면에 "폰판에서는 안 되는 기능" 이라고 정직하게 뜬다.
 *
 * 대신하는 것
 *   POST /api/analyze  → summarizer.js (파이썬 요약기 이식본, 대조 시험 통과)
 *   POST /api/extract  → 붙여넣은 본문 분석. URL 은 CORS 가 열린 곳만 시도한다.
 *   GET  /api/stock    → Openverse·위키미디어 공용을 브라우저에서 직접 (둘 다 CORS 열림)
 *   POST /api/save     → 서버 out 폴더 대신 **내려받기**
 *   GET  /api/assets   → 함께 담아 둔 로고 목록(고정)
 *   GET  /api/open-out → 폴더가 없으므로 안내만
 *
 * 🔴 위키미디어 API 는 `origin=*` 를 붙여야 익명 CORS 를 내준다. 빼면 조용히 막힌다.
 */
(function (global) {
  'use strict';

  const PHONE = { version: '1.0', built: (global.NBD_BUILT || '') };
  global.NBD_PHONE = PHONE;

  const UA_NOTE = '폰판(서버 없음)';
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
  const err = (msg) => json({ ok: false, error: msg });

  /* ── 로고: 서버가 assets 폴더를 훑던 자리 ── */
  const ASSETS = ['assets/뉴보대_로고.png', 'assets/뉴보대_로고_원본.png',
                  'assets/한국대학생포럼_로고.png'];

  /* ── 저장 = 내려받기 ────────────────────────────────────────────────────
   * 🔴 폰 브라우저는 data: 주소를 그대로 내려받지 못하는 경우가 있어 blob 으로 바꾼다.
   *    그래도 막히면(사파리 구버전 등) 새 탭으로 띄워 **길게 눌러 저장**하게 둔다. */
  function dataUrlToBlob(dataUrl) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl || '');
    if (!m) return null;
    const mime = m[1];
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const canDownload = 'download' in a;
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    if (!canDownload) a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return canDownload;
  }

  const safeName = (s) => (String(s || 'card').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'card');

  /* 저장은 한 곳으로 모은다 — save.js 가 고른 폴더(있으면)나 내려받기 폴더로.
     🔴 여기서 직접 내려받지 않는다. 두 길이 생기면 파일이 두 곳으로 흩어진다. */
  const put = (blob, name) => (global.SAVE ? global.SAVE.file(blob, name)
    : Promise.resolve((download(blob, name), '내려받기 폴더 / ' + name)));

  /* ── 기사 가져오기 ──────────────────────────────────────────────────────
   * 브라우저는 남의 사이트 본문을 **직접 읽지 못한다**(CORS). 언론사가 우리를
   * 허락해 줄 리 없으니 직접 부르면 100% `Failed to fetch` 다 — 예전 이 자리의
   * "열려 있으면 덤" 은 사실상 언제나 실패하는 길이었다.
   *
   * 그래서 대신 읽어 주는 대리인을 하나 거친다. `r.jina.ai/<주소>` 는 가입도
   * 열쇠도 서버도 필요 없고, `x-return-format: html` 을 주면 **렌더링된 HTML**
   * 을 그대로 돌려준다 — 덕분에 아래 파싱(og:title·#dic_area…)을 한 줄도 고치지
   * 않는다. 프리플라이트(OPTIONS)까지 통과하는 것을 확인했다.
   *
   * 🔴 분당 20회 제한이 있다(키 없이 쓸 때). 넘으면 429 가 오는데, 그냥 실패로
   *    보이면 사용자가 주소를 의심하게 되므로 아래에서 따로 말해 준다.
   * 🔴 기사 주소가 jina.ai 를 거친다. 공개된 뉴스 링크라 민감하지 않지만,
   *    남의 서비스에 기대는 자리라는 것은 알고 있어야 한다. */
  const READER = 'https://r.jina.ai/';
  const NOT_ARTICLE = /(페이지를 찾을 수 없|존재하지 않는 (기사|페이지)|삭제된 기사|요청하신 페이지|잘못된 (접근|주소|요청)|서비스 (이용에 불편|점검)|일시적인 오류|오류가 발생|접근(이 |이)?(제한|차단)|권한이 없|로그인(이 필요| 후 이용| 해 주세요|하세요|이 필요합니다)|회원 전용|유료 (회원|구독)|404 Not Found|Page Not Found|Access Denied|Forbidden|Too Many Requests|자동 등록 방지|보안 문자|captcha|robot)/i;
  function looksLikeErrorPage(title, body) {
    const t = (title || '').trim();
    const b = (body || '').replace(/\s+/g, ' ').trim();
    const n = b.replace(/\s/g, '').length;
    if (NOT_ARTICLE.test(t)) return '제목이 오류·안내 페이지 같습니다: ' + t.slice(0, 40);
    if (n < 600) {
      const m = NOT_ARTICLE.exec(b);
      if (m) return '오류·로그인 안내 페이지입니다(기사 아님): …' + b.slice(Math.max(0, m.index - 15), m.index + m[0].length + 15);
      if (n < 80) return '본문이 너무 짧습니다(' + n + '자) - 기사 페이지가 아니거나 본문이 막혀 있습니다.';
    }
    return '';
  }

  async function fetchArticle(url) {
    let r;
    try {
      r = await global.__nbdFetch(READER + url, {
        mode: 'cors', credentials: 'omit', headers: { 'x-return-format': 'html' },
      });
    } catch (e) {
      throw new Error('대신 읽어 주는 곳(r.jina.ai)에 닿지 못했습니다 — 인터넷 연결을 확인해 주세요.');
    }
    if (r.status === 429) {
      throw new Error('잠깐 사이에 너무 많이 불렀습니다(분당 20회). 1분 뒤에 다시 눌러 주세요.');
    }
    if (!r.ok) throw new Error('HTTP ' + r.status + ' — 주소가 맞는지, 로그인이 필요한 기사는 아닌지 확인해 주세요.');
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = (p) => {
      const el = doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`);
      return el ? (el.getAttribute('content') || '').trim() : '';
    };
    /* 🔴 예전에는 `p` 를 전부 긁었다. 그러면 네이버 화면의 안내문("머니투데이 언론사
       구독되었습니다", "보러가기", "닫기")까지 본문에 섞여 **캡션 첫 줄로 나갔다**
       (2026-09-02 실측). 기사 본문 칸이 있으면 거기만 쓰고, 없을 때만 p 를 훑는다. */
    const 본문칸 = ['#dic_area', '#newsct_article', '#articleBodyContents', '#articeBody',
                  '#article-view-content-div', '.article_body', 'article'];
    let body = '';
    for (const sel of 본문칸) {
      const el = doc.querySelector(sel);
      const t = el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (t.length > 200) { body = t; break; }
    }
    if (!body) {
      /* 🔴 여기서만 걸러야 한다. 본문 칸을 통째로 잡았을 때 같은 잣대를 대면
         저작권 문구 한 줄 때문에 **기사 전체가 사라진다**(경향신문 실측, 0자). */
      const JUNK = /(언론사 구독|구독되었습니다|구독 해지|보러가기|앱 다운로드|많이 본 뉴스|관련 ?기사|Copyright|기사 제보|구독하기)/;
      const ps = [...doc.querySelectorAll('article p, .article_body p, p')]
        .map(el => (el.textContent || '').trim())
        .filter(t => t.length >= 20 && !JUNK.test(t));
      body = [...new Set(ps)].join('\n');
    }
    const images = [...doc.querySelectorAll('meta[property="og:image"]')]
      .map(el => el.getAttribute('content')).filter(Boolean);
    /* 🔴 대리인이 돌려주는 HTML 에는 `og:site_name` 과 `article:published_time` 이
       빠져 있는 일이 잦다(네이버 실측). 출처 칸(credit)이 비면 카드 아래가 휑하게
       나가므로, 같은 뜻이 적혀 있는 다른 자리를 차례로 뒤진다. */
    const firstOf = (...vals) => (vals.find(v => (v || '').trim()) || '').trim();
    const stamp = doc.querySelector('[data-date-time]');
    const title = meta('og:title') || (doc.querySelector('title') || {}).textContent || '';
    /* 🔴 오류·로그인 담벼락을 기사로 읽던 미결 — 가짜 기사 번호면 네이버 오류 페이지
       (341자)를 본문으로 받아 ok 가 났다. 서버 extractor.looks_like_error_page 와 같은 규칙. */
    const why = looksLikeErrorPage(title, body);
    if (why) throw new Error(why);
    return {
      title,
      body, images,
      press: firstOf(meta('og:site_name'), meta('twitter:creator'),
                     (meta('og:article:author') || '').split('|')[0]),
      date: firstOf(meta('article:published_time'),
                    stamp && stamp.getAttribute('data-date-time')),
    };
  }

  /* ── 사진 검색 (서버 _stock 의 브라우저판) ── */
  async function stockOpenverse(term) {
    const url = 'https://api.openverse.org/v1/images/?page_size=30'
      + '&license_type=commercial,modification&q=' + encodeURIComponent(term);
    const r = await global.__nbdFetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      if (r.status === 401 || r.status === 429) {
        throw new Error('Openverse 가 잠시 막았습니다(키 없이 쓰면 시간당 횟수 제한이 '
          + '있습니다). 잠시 뒤 다시 하거나 `위키미디어 공용` 으로 바꿔 보세요.');
      }
      throw new Error('HTTP ' + r.status);
    }
    const data = await r.json();
    return (data.results || []).filter(p => p.url).map(p => ({
      /* 🔴 원본 사진은 제공처가 제각각이라 CORS 가 닫혀 있으면 캔버스가 오염돼
         저장이 통째로 실패한다. Openverse 가 다시 내주는 주소는 CORS 가 열려 있어
         그쪽을 쓴다(가로 최대 600px). */
      thumb: p.thumbnail || p.url,
      full: p.thumbnail || p.url,
      origin: p.url,
      credit: (p.creator || '').trim() || '작자 미상',
      license: (p.license || '').toUpperCase() + (p.license_version ? ' ' + p.license_version : ''),
      title: (p.title || '').trim(),
      link: p.foreign_landing_url || '',
      source: 'Openverse',
    }));
  }

  async function stockWikimedia(term) {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
      + '&generator=search&gsrnamespace=6&gsrlimit=30'
      + '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1080'
      + '&origin=*'                                   // 🔴 없으면 CORS 가 막는다
      + '&gsrsearch=' + encodeURIComponent(term);
    const r = await global.__nbdFetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const pages = Object.values(((data.query || {}).pages) || {});
    const items = [];
    for (const p of pages) {
      const info = (p.imageinfo || [{}])[0];
      const full = info.url;
      if (!full) continue;
      let path = full;
      try { path = new URL(full).pathname; } catch (e) { /* 주소가 아니면 그대로 */ }
      if (!/\.(jpg|jpeg|png|webp)$/i.test(path)) continue;   // 물음표 뒤는 보지 않는다
      const meta = info.extmetadata || {};
      const grab = (k) => ((meta[k] || {}).value || '').replace(/<[^>]+>/g, '').trim();
      items.push({
        thumb: info.thumburl || full,
        full: info.thumburl || full,      // 두 주소 모두 upload.wikimedia.org — CORS 열림
        origin: full,
        credit: grab('Artist') || '작자 미상',
        license: grab('LicenseShortName'),
        title: (p.title || '').replace('File:', ''),
        link: info.descriptionurl || '',
        source: 'Wikimedia Commons',
      });
    }
    return items;
  }

  async function stockPaid(prov, term, key) {
    const url = prov === 'unsplash'
      ? 'https://api.unsplash.com/search/photos?per_page=24&query=' + encodeURIComponent(term)
      : 'https://api.pexels.com/v1/search?per_page=24&query=' + encodeURIComponent(term);
    const headers = prov === 'unsplash' ? { Authorization: 'Client-ID ' + key }
                                        : { Authorization: key };
    const r = await global.__nbdFetch(url, { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' — 키를 다시 확인해 보세요.');
    const data = await r.json();
    if (prov === 'unsplash') {
      return (data.results || []).map(p => ({
        thumb: p.urls.small, full: p.urls.regular, credit: p.user.name,
        link: p.links.html, license: 'Unsplash License', source: 'Unsplash',
        title: (p.description || '').slice(0, 80),
      }));
    }
    return (data.photos || []).map(p => ({
      thumb: p.src.medium, full: p.src.large2x, credit: p.photographer || '',
      link: p.url || '', license: 'Pexels License', source: 'Pexels',
      title: (p.alt || '').slice(0, 80),
    }));
  }

  /* 글투마다 어떤 제목이 어울리는지 — feed.py 의 STYLE_TITLE_NOTE 와 같은 표. */
  const TITLE_NOTE = {
    news: '사실 그대로 — 누가 무엇을 했는지',
    magazine: '기획 톤 — 묻고 들여다보는 말투',
    brief: '짧고 굵게 — 14자 안팎',
    question: '물음표로 끝나는 한 줄 — 댓글을 부르는 결',
    oneline: '한 줄로 끝내기 — 카드가 이미 다 말했을 때',
    cards: '표지 후킹 — 넘겨보게 만드는 한 줄',
  };

  /** 함께 실을 기사 가운데 **기준 기사와 같은 발언을 실은 것**만 골라 낸다.
   *
   * 폰판은 검색을 못 하지만, 사람이 「링크 직접 넣기」로 넣은 기사는 본문이 있다.
   * 그 본문에 기준 기사의 발언이 그대로 들어 있는지는 **여기서 확인할 수 있다** —
   * 검색 없이도 "같은 발언을 실은 보도" 묶음을 만들 수 있는 이유다.
   */
  function quotedFrom(main, related) {
    const F = global.FEEDSTYLES;
    if (!F) return null;
    const 말들 = F.quotes((main && main.body) || '', 3);
    if (!말들.length) return null;
    const norm = (s) => String(s || '').replace(/\s+/g, '');
    const items = [];
    let 쓴말 = '';
    for (const r of (related || [])) {
      const 몸 = norm(r.body || '');
      if (!몸) continue;
      const hit = 말들.find(m => 몸.includes(norm(m).slice(0, 20)));
      if (!hit) continue;
      쓴말 = 쓴말 || hit;
      items.push({ press: r.press || '', title: r.title || '', link: r.link || '' });
    }
    return items.length ? { quote: 쓴말, items } : null;
  }

  /* ── 길목 ───────────────────────────────────────────────────────────── */
  async function route(path, query, body) {
    const S = global.SUMMARIZER;

    if (path === '/api/analyze') {
      const text = (body.text || '').trim();
      if (!text) return err('본문이 비어 있습니다.');
      return json({ ok: true, analysis: S.analyze(text, body.title || '') });
    }

    if (path === '/api/extract') {
      let url = (body.url || '').trim();
      const text = (body.text || '').trim();
      const title = (body.title || '').trim();
      const res = { ok: true, title, body: text, images: [], press: '', date: '', url };
      if (url && !text) {
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        try {
          const got = await fetchArticle(url);
          res.title = title || got.title;
          res.body = got.body;
          res.images = got.images;
          res.press = got.press;
          res.date = got.date;
          res.url = url;
        } catch (e) {
          return err('기사를 가져오지 못했습니다: ' + e.message
            + ' — 계속 안 되면 기사 본문을 복사해 아래 칸에 붙여넣어 주세요(그 길은 항상 됩니다).');
        }
      }
      if (!(res.body || '').trim()) {
        return err('본문을 찾지 못했습니다. 기사 본문을 직접 붙여넣어 주세요.');
      }
      res.analysis = S.analyze(res.body, res.title || '');
      return json(res);
    }

    if (path === '/api/series') {
      const text = (body.text || '').trim();
      if (!text) return err('본문이 비어 있습니다.');
      if (typeof S.series !== 'function') return err('이 폰판은 시리즈 자동 구성이 없는 옛 판입니다. 새로고침해 보세요.');
      return json({ ok: true, series: S.series(text, body.title || '', body.n || 3) });
    }
    if (path === '/api/ai') {
      return err('AI 문구는 PC 앱(뉴보대 카드뉴스 메이커)에서만 됩니다. 폰판은 서버가 없어 규칙기반으로 갑니다.');
    }

    if (path === '/api/stock') {
      const prov = query.get('provider') || 'openverse';
      const term = (query.get('q') || '').trim();
      const key = (query.get('key') || '').trim();
      if (!term) return err('검색어가 비어 있습니다.');
      try {
        let items;
        if (prov === 'openverse') items = await stockOpenverse(term);
        else if (prov === 'wikimedia') items = await stockWikimedia(term);
        else if (!key) {
          return err('Pexels·Unsplash 는 무료지만 **가입해서 키를 받아야** 합니다. '
            + '키 없이 쓰려면 Openverse 나 위키미디어 공용을 고르세요.');
        } else items = await stockPaid(prov, term, key);
        return json({ ok: true, items, provider: prov });
      } catch (e) {
        return err(prov + ' 검색에 실패했습니다: ' + e.message);
      }
    }

    if (path === '/api/save') {
      const blob = dataUrlToBlob(body.dataUrl || '');
      if (!blob) return err('이미지 데이터가 올바르지 않습니다.');
      const name = safeName(body.name) + (blob.type === 'image/jpeg' ? '.jpg' : '.png');
      return json({ ok: true, path: await put(blob, name) });
    }

    /* ── 피드 글 만들기 ────────────────────────────────────────────────
       feed.py 가 하던 일을 feedstyles.js 가 대신한다. 화면(feed.html)은 앱과 **같은
       파일**이라 두 판이 갈라지지 않는다 - 다른 것은 이 아래 계산뿐이다.
       2026-09-02: "기본 모드에서 피드 내용 만들기가 사라졌다"는 지적으로 되살렸다. */
    if (path === '/api/feed') {
      const F = global.FEEDSTYLES;
      if (!F) return err('글투 꾸러미(feedstyles.js)를 못 찾았습니다. 새로고침해 보세요.');
      const main = body.main || {};
      if (!(main.body || '').trim()) return err('기사 본문이 없습니다. 먼저 기사를 가져오세요.');
      const style = body.style || 'news';
      const out = F.one(main, style, {
        date: main.date, channel: body.channel || 'instagram',
        quoted: quotedFrom(main, body.related),
      });
      out.ok = true;
      out.titles = F.titles(main, style, 6);
      out.titleNote = TITLE_NOTE[style] || '';
      out.others = (body.related || []).length;
      return json(out);
    }

    if (path === '/api/titles') {
      const F = global.FEEDSTYLES;
      if (!F) return err('글투 꾸러미(feedstyles.js)를 못 찾았습니다.');
      const main = body.main || {};
      if (!((main.body || '') + (main.title || '')).trim()) {
        return err('기사 본문이나 제목이 필요합니다.');
      }
      const style = body.style || 'news';
      return json({ ok: true, style, titles: F.titles(main, style, 6),
                    note: TITLE_NOTE[style] || '' });
    }

    /* 유사 기사 **검색**은 폰판에서 못 한다 - 구글 뉴스는 대신 읽어 주는 곳을 403 으로
       막고, 네이버 검색 화면은 짜임이 자주 바뀐다(2026-09-02 실측). 대신 주소를 직접
       넣는 길(`/api/fetch-many`)은 되므로 그쪽으로 안내한다. */
    if (path === '/api/related') {
      return err('폰·홈페이지 판에서는 유사 기사 **검색**이 안 됩니다(구글이 막습니다). '
        + '아래 「링크 직접 넣기」에 기사 주소를 넣으면 본문까지 가져와 같이 씁니다.');
    }

    if (path === '/api/fetch-many') {
      let urls = body.urls || [];
      if (typeof urls === 'string') urls = urls.split(/[\s,]+/);
      urls = urls.map(u => (u || '').trim()).filter(Boolean).slice(0, 8);
      if (!urls.length) return err('주소를 한 줄에 하나씩 넣어 주세요.');
      const items = [];
      for (const u0 of urls) {
        const u = /^https?:\/\//i.test(u0) ? u0 : 'https://' + u0;
        const row = { title: '', press: '', link: u, direct: true, src: '직접 링크',
                      date: '', gap_h: null, score: 9.9, body: '', body_ok: false, error: '' };
        try {
          const got = await fetchArticle(u);
          row.title = got.title || u;
          row.press = got.press || '';
          row.date = (got.date || '').replace('T', ' ').slice(0, 16);
          row.body = got.body || '';
          row.body_ok = row.body.length > 200;
        } catch (e) {
          row.error = e.message;
          row.title = row.title || u;
        }
        items.push(row);
      }
      return json({ ok: true, items, body_ok: items.filter(i => i.body_ok).length });
    }

    if (path === '/api/save-text') {
      const name = safeName(body.name || '뉴보대_글') + '.txt';
      const blob = new Blob([body.text || ''], { type: 'text/plain;charset=utf-8' });
      return json({ ok: true, path: await put(blob, name) });
    }

    /* 릴스 — 서버 out 폴더 대신 이 기기에서 고른 파일을 쓴다(reel.html 참고).
       목록 요청은 빈손으로 돌려주면 화면이 파일 고르기 안내를 띄운다. */
    if (path === '/api/insta-files') return json({ ok: true, groups: [] });

    if (path === '/api/reel-save') {
      const name = safeName(query.get('name') || '릴스') + '.' + (query.get('ext') || 'mp4');
      if (!(body instanceof Blob)) return err('영상 데이터를 받지 못했습니다.');
      return json({ ok: true, path: await put(body, name) });
    }

    if (path === '/api/assets') return json({ ok: true, items: ASSETS });

    if (path === '/api/open-out') {
      return json({ ok: true, note: '폰판에는 out 폴더가 없습니다 — 내려받기 폴더를 보세요.' });
    }

    return err('이 기능(' + path + ')은 ' + UA_NOTE + '에서는 쓸 수 없습니다. '
      + 'PC 앱에서 해 주세요.');
  }

  /* ── fetch 가로채기 ── */
  global.__nbdFetch = global.fetch.bind(global);
  const isApi = (u) => /(^|\/)api\/[a-z-]+/i.test(String(u || '').split('?')[0]);

  global.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!isApi(url)) return global.__nbdFetch(input, init);
    let u;
    try { u = new URL(url, location.href); } catch (e) { return global.__nbdFetch(input, init); }
    const path = '/api/' + u.pathname.split('/api/')[1];
    let body = {};
    if (init && init.body) {
      // 릴스는 Blob 을 그대로 보낸다 — JSON 으로 읽으려 들면 안 된다
      if (init.body instanceof Blob) body = init.body;
      else { try { body = JSON.parse(init.body); } catch (e) { body = {}; } }
    }
    return route(path, u.searchParams, body)
      .catch(e => err('폰판 처리 중 오류: ' + (e && e.message ? e.message : e)));
  };

  /* ── XMLHttpRequest 가로채기 ──────────────────────────────────────────
   * 저장·올리기는 진행바 때문에 XHR 을 쓴다(PROG.postJSON). fetch 만 막으면
   * 저장 단추가 조용히 서버를 찾아 나선다 — 그래서 이쪽도 같은 길목으로 보낸다. */
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__nbdUrl = url;
    this.__nbdApi = isApi(url);
    this.__nbdMethod = method;
    /* 🔴 가로챌 요청이라도 원래 open() 은 반드시 부른다. 안 부르면 상태가 UNSENT 로
       남아 바로 뒤따라오는 setRequestHeader() 가 InvalidStateError 로 터진다
       (실측: 저장 단추가 아무 말 없이 죽었다). 진짜 요청은 send() 를 가로채므로
       나가지 않는다. */
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (data) {
    if (!this.__nbdApi) return XS.apply(this, arguments);
    const self = this;
    let u;
    try { u = new URL(self.__nbdUrl, location.href); } catch (e) { u = null; }
    const path = u ? '/api/' + u.pathname.split('/api/')[1] : self.__nbdUrl;
    let body = {};
    if (data) { try { body = JSON.parse(data); } catch (e) { body = {}; } }
    // 진행바가 0% 에서 멈춘 것처럼 보이지 않도록 업로드 이벤트를 흉내 낸다
    const total = (data && data.length) || 1;
    if (self.upload && self.upload.onprogress) {
      setTimeout(() => self.upload.onprogress({ lengthComputable: true, loaded: total, total }), 0);
    }
    route(path, u ? u.searchParams : new URLSearchParams(), body)
      .then(r => r.text())
      .then(text => {
        Object.defineProperty(self, 'responseText', { value: text, configurable: true });
        Object.defineProperty(self, 'status', { value: 200, configurable: true });
        Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
        if (self.onload) self.onload();
      })
      .catch(e => { if (self.onerror) self.onerror(e); });
  };

  /* ── 화면 손질 ────────────────────────────────────────────────────────
   * 서버가 있어야만 되는 단추(폴더 열기·폴더 정리·인스타 올리기·피드 글·주제 찾기)를
   * 남겨 두면 눌렀을 때 오류만 본다. 폰판에서는 아예 감춘다. */
  const HIDE = ['#btnOpenOut', '[data-insta-slot]', '.insta-btn',
    /* AI 문구는 우리 서버를 거쳐 제공자로 가는 길이라 서버 없는 폰판에는 없다 */
    '#btnAI', '#aiBox', '#btnMakeAI',
    /* 시리즈 「out 폴더에 저장」— 폰판은 out 폴더가 없다(PNG 전부 = 내려받기 는 남긴다) */
    '#btnDeckSaveAll',
    /* `out 폴더에 저장` 은 폰판에서 `PNG 내려받기` 와 결과가 같다 — 단추가 둘이면
       어느 쪽이 진짜인지 헷갈리므로 하나만 남긴다. */
    '#btnSave',
    /* 🔴 `피드 글`(feed.html)은 2026-09-02 부터 폰판에도 있다 — feedstyles.js 가
       캡션 생성기를 대신한다. 여기서 감추면 그 화면으로 갈 길이 없어진다. */
    'a[href$="out.html"]', 'a[href$="topics.html"]',
    'a[href$="insta.html"]'];

  /* 같은 단추라도 폰판에서는 하는 일이 다르다 — 이름을 바꿔 준다.
     (out 폴더가 없으니 「저장」은 실제로는 **내려받기**다) */
  const RENAME = { '#btnSaveTxt': '글 내려받기' };

  function tidy() {
    Object.keys(RENAME).forEach(sel => document.querySelectorAll(sel).forEach(el => {
      if (el.dataset.nbdRenamed) return;
      el.dataset.nbdRenamed = '1';
      el.textContent = RENAME[sel];
    }));
    HIDE.forEach(sel => document.querySelectorAll(sel).forEach(el => {
      /* 🔴 이미 감춘 것은 건드리지 않는다. 아래 MutationObserver 가 이 함수를 다시
         부르므로, 매번 style 을 다시 쓰면 스스로를 끝없이 깨우게 된다. */
      if (el.dataset.nbdHidden) return;
      el.dataset.nbdHidden = '1';
      el.hidden = true;
      el.style.display = 'none';
    }));
  }
  /* 🔴 한 번만 돌리면 안 된다. 인스타 단추는 nav.js 가 `[data-insta-slot]` 자리에
     **나중에** 심으므로, 그때 다시 훑지 않으면 눌러 봐야 오류만 나는 단추가 남는다. */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tidy);
  tidy();
  window.addEventListener('load', tidy);
  new MutationObserver(tidy).observe(document.documentElement, { childList: true, subtree: true });
})(window);
