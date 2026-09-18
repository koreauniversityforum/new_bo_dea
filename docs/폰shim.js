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

  /* ── 올릴 카드 담아 두기 (2026-09-18) ────────────────────────────────────
   * PC 앱의 「인스타 올리기」 단추는 카드를 서버 `out\_임시_인스타\` 에 **쌓아** 두고
   * 올리기 화면으로 간다. 폰판에는 서버가 없으니 그 자리를 이 기기의 IndexedDB 로 한다.
   * 🔴 localStorage 가 아닌 이유: 1080×1350 PNG 한 장이 1~3MB 라 5MB 한도를 두 장이면 넘는다.
   * 🔴 쌓는다(갈아 끼우지 않는다) - 앞장 담고 뒷장 담는 순간 앞장이 사라지면 캐러셀을 못 만든다.
   *    비우기는 올리기 화면의 「담은 카드 비우기」가 맡는다. 상한은 인스타 캐러셀과 같은 10장. */
  const STAGE_DB = 'nbd_stage', STAGE_STORE = 'cards', STAGE_MAX = 10;
  function stageDb() {
    return new Promise((res, rej) => {
      const q = indexedDB.open(STAGE_DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore(STAGE_STORE, { keyPath: 'id', autoIncrement: true });
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error || new Error('이 브라우저는 카드를 담아 둘 수 없습니다(IndexedDB).'));
    });
  }
  async function stageTx(mode, fn) {
    const db = await stageDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STAGE_STORE, mode);
      const out = fn(tx.objectStore(STAGE_STORE));
      tx.oncomplete = () => { db.close(); res(out && 'result' in out ? out.result : out); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    });
  }
  const STAGE = {
    list: () => stageTx('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => x.id - y.id)),
    clear: () => stageTx('readwrite', s => s.clear()),
    remove: (id) => stageTx('readwrite', s => s.delete(id)),
    async add(items) {
      const now = await STAGE.list();
      if (now.length + items.length > STAGE_MAX) {
        throw new Error('인스타 캐러셀은 ' + STAGE_MAX + '장까지입니다. 지금 ' + now.length
          + '장이 담겨 있어요 - 올리기 화면에서 몇 장 빼고 다시 담아 주세요.');
      }
      await stageTx('readwrite', s => items.forEach(it => s.add({
        name: safeName(it.name || 'card'), blob: dataUrlToBlob(it.dataUrl), at: Date.now() })));
      return STAGE.list();
    },
  };
  global.NBD_STAGE = STAGE;

  /* ── out 폴더 = 이 기기 보관함 (2026-09-18) ──────────────────────────────
   * 앱의 「out 폴더에 저장」·「시리즈 저장」·폴더 정리 화면(out.html)은 서버의 out 폴더를 쓴다.
   * 홈페이지에는 그 폴더가 없으니 이 브라우저의 IndexedDB 를 out 폴더로 쓴다. 「PNG 내려받기」
   * (SAVE.file)는 그대로 내려받기 - 두 단추가 하는 일이 앱과 같게 갈린다.
   * 🔴 보관함은 이 기기·이 브라우저에만 있다(사이트 데이터를 지우면 사라진다). 남길 것은 내려받기. */
  const OUT_DB = 'nbd_out';
  function outTx(mode, fn) {
    return new Promise((res, rej) => {
      const q = indexedDB.open(OUT_DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore('files', { keyPath: 'name' });
      q.onerror = () => rej(q.error || new Error('보관함(IndexedDB)을 열 수 없습니다.'));
      q.onsuccess = () => {
        const t = q.result.transaction('files', mode);
        const r = fn(t.objectStore('files'));
        t.oncomplete = () => { q.result.close(); res(r && 'result' in r ? r.result : undefined); };
        t.onerror = () => { q.result.close(); rej(t.error); };
      };
    });
  }
  const OUT = {
    list: () => outTx('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => y.mtime - x.mtime)),
    get: (name) => outTx('readonly', s => s.get(name)),
    remove: (name) => outTx('readwrite', s => s.delete(name)),
    async put(blob, name) {
      // 같은 이름이 있으면 앱의 out 폴더처럼 덮지 않고 _2, _3 을 붙인다
      const names = new Set((await OUT.list()).map(x => x.name));
      let n = name, i = 2;
      const dot = name.lastIndexOf('.');
      while (names.has(n)) n = (dot > 0 ? name.slice(0, dot) : name) + '_' + (i++) + (dot > 0 ? name.slice(dot) : '');
      await outTx('readwrite', s => s.put({ name: n, blob, size: blob.size, mtime: Math.floor(Date.now() / 1000) }));
      return n;
    },
  };
  global.NBD_OUT = OUT;
  const THUMBS = new Map();                                  // 'stage/이름' · 'out/이름' → blob 주소
  global.NBD_THUMB = (d, n) => THUMBS.get(d + '/' + n) || '';

  /* ── AI 문구 (2026-09-18) ────────────────────────────────────────────────
   * 앱은 키를 **브라우저에만** 두고 요청마다 서버(ai.py)를 거쳐 Claude 로 보낸다.
   * 폰판에는 서버가 없으니 브라우저가 Claude API 를 직접 부른다(키는 똑같이 이 기기에만).
   * 요청문·JSON 꼴은 ai.py 에서 구울 때 뽑은 ai_data.js 를 쓴다 - 두 벌로 갈라지지 않게.
   * 🔴 Anthropic 은 브라우저 직접 호출에 `anthropic-dangerous-direct-browser-access` 머리를
   *    요구한다(없으면 CORS 로 막힌다). 키가 이 브라우저에 있다는 뜻이라 앱과 위험도는 같다.
   * 🔴 Ollama 는 폰판에서 못 쓴다 - 남의 PC(127.0.0.1)에 닿을 수 없고 CORS 도 막혀 있다. */
  function aiJson(s) {
    s = String(s || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { return JSON.parse(s); } catch (e) { /* 아래로 */ }
    const m = /\{[\s\S]*\}/.exec(s);
    if (!m) throw new Error('AI 응답에 JSON 이 없습니다: ' + s.slice(0, 120));
    return JSON.parse(m[0]);
  }
  const aiList = (xs, n) => {
    const out = [];
    (xs || []).forEach(x => { x = String(x || '').replace(/\s+/g, ' ').trim(); if (x && !out.includes(x)) out.push(x); });
    return out.slice(0, n);
  };
  async function aiRun(task, text, title, n, cfg) {
    const D = global.NBD_AI_DATA;
    if (!D) throw new Error('AI 재료(ai_data.js)를 못 찾았습니다. 새로고침해 보세요.');
    cfg = cfg || {};
    if ((cfg.provider || 'anthropic').toLowerCase() === 'ollama') {
      throw new Error('Ollama 는 PC 앱에서만 됩니다(홈페이지는 내 PC 에 닿을 수 없습니다). AI 설정에서 Claude 를 고르세요.');
    }
    if (!(cfg.key || '').trim()) throw new Error('Claude API 키가 없습니다. 「AI 설정」에 넣으세요(이 기기에만 저장).');
    text = String(text || '').trim();
    if (text.length < 40) throw new Error('본문이 너무 짧습니다(40자 이상).');
    text = text.slice(0, 12000);
    const tpl = D.prompts[task];
    if (!tpl) throw new Error('모르는 작업: ' + task);
    const prompt = tpl.split('@@TITLE@@').join(title || '').split('@@N@@').join(String(n || 3))
      .split('@@TEXT@@').join(text);
    let r;
    try {
      r = await global.__nbdFetch(D.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.key.trim(),
          'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: cfg.model || D.model, max_tokens: 4000, system: D.system,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: { type: 'json_schema', schema: D.schemas[task] }, effort: 'medium' } }),
      });
    } catch (e) { throw new Error('AI 서버에 못 닿았습니다: ' + e.message); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) throw new Error('API 키가 틀렸거나 만료됐습니다 (401).');
      if (r.status === 429) throw new Error('요청 한도에 걸렸습니다 (429). 잠시 뒤 다시.');
      throw new Error('AI 서버 오류 ' + r.status + ': ' + String(((j.error || {}).message) || '').slice(0, 200));
    }
    if (j.stop_reason === 'refusal') throw new Error('AI 가 이 요청을 거절했습니다.');
    if (j.stop_reason === 'max_tokens') throw new Error('AI 응답이 잘렸습니다. 본문을 줄여 다시 시도하세요.');
    const out = aiJson((j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
    // ai.run() 과 같은 손질 - 화면이 규칙기반 결과와 구별 없이 쓰도록
    if (task === 'copy') {
      return { titles: aiList(out.titles, 6), hooks: aiList(out.hooks, 6),
               summaries: aiList(out.summaries, 4), keywords: aiList(out.keywords, 5), sentences: [] };
    }
    if (task === 'series') {
      const c = out.cover || {};
      const pages = (out.pages || []).filter(p => p && typeof p === 'object').map((p, i) => ({
        kind: ['point', 'number', 'quote', 'list'].includes(p.kind) ? p.kind : 'point',
        label: String(p.label || ('POINT ' + (i + 1))).trim(), head: String(p.head || '').trim(),
        body: String(p.body || '').trim(), num: String(p.num || '').trim(), who: String(p.who || '').trim() }));
      return { cover: { hook: String(c.hook || '').trim(), title: String(c.title || '').trim(),
                        summary: String(c.summary || '').trim() },
               pages: pages.slice(0, Math.max(1, Math.min(+n || 3, 6))) };
    }
    if (task === 'caption') {
      return { texts: (out.texts || []).filter(t => t && String(t.text || '').trim())
        .map(t => ({ style: String(t.style || 'AI'), text: String(t.text).trim() })).slice(0, 3) };
    }
    return out;
  }

  /* ── 깃허브가 대신하는 서버 일 (2026-09-18) ──────────────────────────────
   * 남의 사이트를 읽는 기능은 `api-call` 워크플로에 맡긴다: 요청을 dispatch 로 보내고
   * `api` 브랜치에 답(res/<id>.json)이 생길 때까지 기다린다. 열쇠는 「인스타 올리기」와
   * 같은 깃허브 열쇠(nbd_pat) 하나. 🔴 raw.githubusercontent 로 읽으면 없는 파일(404)을
   * 몇 분씩 캐시해 답이 생겨도 못 본다 - API(contents)로 읽는다. */
  const GH_REPO = 'koreauniversityforum/new_bo_dea';
  async function ghCall(method, path, query, body) {
    let k = '';
    try { k = localStorage.getItem('nbd_pat') || ''; } catch (e) { /* 무시 */ }
    if (!k) {
      return err('이 기능은 홈페이지에서 **깃허브가 대신** 합니다. 「인스타 올리기」 화면 3번 칸에 '
        + '깃허브 열쇠를 한 번 넣어 주세요(같은 열쇠를 씁니다).');
    }
    const H = { 'Authorization': 'Bearer ' + k, 'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28' };
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('');
    const r = await global.__nbdFetch('https://api.github.com/repos/' + GH_REPO + '/dispatches', {
      method: 'POST', headers: H,
      body: JSON.stringify({ event_type: 'api-call', client_payload: { id, method, path, query, body } }),
    });
    if (r.status !== 204) {
      return err('깃허브에 요청하지 못했습니다(HTTP ' + r.status + ') - '
        + (r.status === 401 ? '열쇠가 틀렸거나 만료됐습니다.' : r.status === 403 || r.status === 404
          ? '열쇠 권한(Contents 쓰기)을 확인하세요.' : '잠시 뒤 다시 해 보세요.'));
    }
    const until = Date.now() + 150000;               // 깃허브 일꾼이 뜨는 데 20~60초
    await new Promise(s => setTimeout(s, 12000));
    while (Date.now() < until) {
      const g = await global.__nbdFetch('https://api.github.com/repos/' + GH_REPO
        + '/contents/res/' + id + '.json?ref=api',
        { headers: Object.assign({}, H, { 'Accept': 'application/vnd.github.raw+json' }), cache: 'no-store' });
      if (g.ok) return json(await g.json());
      await new Promise(s => setTimeout(s, 3000));
    }
    return err('깃허브가 2분 반 안에 답하지 않았습니다. 깃허브 Actions 의 「홈페이지 서버 대행」을 확인하세요.');
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
      // 앱과 같다: AI 설정이 켜져(on) 오면 AI 로, 아니면 규칙기반. 꼴은 같다.
      if (body.ai && body.ai.on) {
        try {
          const out = await aiRun('series', text, body.title || '', body.n || 3, body.ai);
          out.by = 'ai';
          return json({ ok: true, series: out });
        } catch (e) { return err(e.message); }
      }
      if (typeof S.series !== 'function') return err('이 폰판은 시리즈 자동 구성이 없는 옛 판입니다. 새로고침해 보세요.');
      return json({ ok: true, series: S.series(text, body.title || '', body.n || 3) });
    }
    if (path === '/api/ai') {
      const text = (body.text || '').trim();
      if (!text) return err('본문이 비어 있습니다.');
      try {
        const task = (body.task || 'copy').trim();
        return json({ ok: true, task,
          result: await aiRun(task, text, body.title || '', body.n || 3, body.ai || {}) });
      } catch (e) { return err(e.message); }
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
      // 앱의 out 폴더 = 이 기기 보관함 (위 OUT 참고). 내려받기는 「PNG 내려받기」가 맡는다.
      return json({ ok: true, path: '보관함 / ' + await OUT.put(blob, name) });
    }

    /* 폴더 정리 화면(out.html) - 앱과 같은 꼴로 답한다 */
    if (path === '/api/out-list') {
      const rows = (await OUT.list()).map(x => ({ name: x.name, size: x.size, mtime: x.mtime }));
      return json({ ok: true, dir: '이 기기 보관함(브라우저)', items: rows, count: rows.length,
                    total: rows.reduce((a, x) => a + (x.size || 0), 0) });
    }
    if (path === '/api/out-delete') {
      const names = Array.isArray(body.names) ? body.names : [];
      if (!names.length) return err('지울 파일을 고르지 않았습니다.');
      let freed = 0; const done = [];
      for (const n of names.slice(0, 2000)) {
        const x = await OUT.get(String(n));
        if (!x) continue;
        freed += x.size || 0;
        await OUT.remove(x.name);
        done.push(x.name);
      }
      return json({ ok: true, deleted: done.length, freed, failed: [] });
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

    /* 유사 기사 **검색**·주제 찾기·숏폼 찾기는 브라우저가 못 한다(구글이 대리인을 403,
       RSS·유튜브는 CORS 없음). 2026-09-18 부터 깃허브 Actions 가 앱과 같은 파이썬으로
       대신 한다 - 아래 ghCall() 과 .github/cards/api_call.py 참고. 30초 남짓 걸린다. */
    if (path === '/api/related') return ghCall('POST', path, '', body);
    if (path === '/api/topic-ideas') return ghCall('GET', path, query.toString(), null);
    if (path === '/api/hub-fetch') return ghCall('POST', path, '', body);
    if (path === '/api/hub-search') return ghCall('POST', path, '', body);
    if (path === '/api/shorts') return ghCall('GET', path, query.toString(), null);
    if (path === '/api/hub-sources') {
      // 출처 목록은 고정값 - 구울 때 적어 둔 파일을 읽는다(깃허브를 부르지 않는다)
      const r = await global.__nbdFetch('hub-sources.json', { cache: 'no-cache' });
      return r.ok ? json(await r.json()) : err('출처 목록(hub-sources.json)을 못 읽었습니다.');
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
    /* 릴스 「최근 세트 자동 담기」·그림 고르기 - 앱은 out 폴더와 임시(담은 카드)를 훑는다.
       여기서는 담은 카드(STAGE)와 보관함(OUT)을 같은 꼴로 준다. 그림은 <img> 로 뜨므로
       fetch 가로채기가 안 먹는다 - blob 주소를 만들어 두고 NBD_THUMB 로 건넨다(구울 때
       reel.html 의 thumbUrl 이 이걸 쓰게 바꾼다). */
    if (path === '/api/insta-files') {
      THUMBS.forEach(u => URL.revokeObjectURL(u));
      THUMBS.clear();
      const img = /\.(png|jpe?g|webp)$/i;
      const staged = (await STAGE.list()).map((x, i) => ({ name: String(i + 1).padStart(2, '0') + '_' + x.name + '.png', blob: x.blob, at: x.at }));
      const outs = (await OUT.list()).filter(x => img.test(x.name)).sort((a, b) => a.name < b.name ? -1 : 1);
      const groups = [];
      [['임시(담은 카드)', 'stage', staged.map(x => ({ name: x.name, blob: x.blob, mtime: Math.floor((x.at || 0) / 1000) }))],
       ['out', 'out', outs]].forEach(([label, dir, rows]) => {
        if (!rows.length) return;
        rows.forEach(r => THUMBS.set(dir + '/' + r.name, URL.createObjectURL(r.blob)));
        groups.push({ label, dir, items: rows.map(r => ({ name: r.name, size: r.blob.size, w: 1080, h: 1350, mtime: r.mtime })) });
      });
      return json({ ok: true, groups });
    }

    /* 인스타 올리기 단추(nav.js)가 카드를 담는 자리 - 위 STAGE 참고 */
    if (path === '/api/insta-stage') {
      if (body.clear) { await STAGE.clear(); return json({ ok: true, names: [] }); }
      const items = (body.items || []).filter(it => it && it.dataUrl);
      if (!items.length) return err('담을 카드가 없습니다.');
      const all = await STAGE.add(items);
      return json({ ok: true, dir: 'phone', names: all.map(x => x.name) });
    }

    if (path === '/api/reel-save') {
      const name = safeName(query.get('name') || '릴스') + '.' + (query.get('ext') || 'mp4');
      if (!(body instanceof Blob)) return err('영상 데이터를 받지 못했습니다.');
      return json({ ok: true, path: await put(body, name) });
    }

    if (path === '/api/assets') return json({ ok: true, items: ASSETS });

    if (path === '/api/open-out') {
      // 「폴더 열기」: 보관함 화면에서는 전부 내려받기, 다른 화면에서는 보관함 화면으로
      if (!/out\.html$/.test(location.pathname)) { location.href = 'out.html'; return json({ ok: true }); }
      const all = await OUT.list();
      for (const x of all) { download(x.blob, x.name); await new Promise(s => setTimeout(s, 350)); }
      return json({ ok: true, note: all.length + '개를 내려받았습니다.' });
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
  /* 🆕 2026-09-18 인스타 올리기 단추(`[data-insta-slot]`·`.insta-btn`·insta.html 링크)는
     더 이상 감추지 않는다 - 폰판 전용 insta.html 이 깃허브를 거쳐 공식 API 로 올린다. */
  /* 🆕 2026-09-18 AI 문구(#btnAI·#aiBox·#btnMakeAI)와 주제 찾기 링크도 되살렸다 -
     AI 는 브라우저가 Claude 를 직접, 주제 찾기는 깃허브 Actions 가 대신한다(위 aiRun·ghCall). */
  /* 🆕 2026-09-18 out 폴더 단추(#btnOpenOut·#btnDeckSaveAll·#btnSave·out.html 링크)도 되살렸다 -
     out 폴더는 이 기기 보관함(위 OUT)이다. 감출 것이 더 없다(Ollama 는 AI 설정 안에서 안내). */
  const HIDE = [];

  /* 같은 단추라도 폰판에서는 하는 일이 다르다 — 이름을 바꿔 준다(out 폴더 = 이 기기 보관함). */
  const RENAME = { '#btnSaveTxt': '글 내려받기', '#btnSave': '보관함에 저장',
                   '#btnOpenOut': '보관함', '#btnDeckSaveAll': '시리즈 보관함에 저장',
                   // out.html 의 「폴더 열기」 - 보관함 화면에서는 전부 내려받기가 된다
                   '#btnOpen': '전부 내려받기' };

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
