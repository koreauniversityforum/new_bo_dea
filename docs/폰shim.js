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
   * 서버가 없으니 언론사 사이트는 대부분 CORS 로 막힌다(정상이다 — 브라우저가
   * 남의 사이트 본문을 읽지 못하게 막는 것). 그래서 **본문 붙여넣기가 기본**이고,
   * URL 은 "열려 있으면 덤" 으로만 시도한다. 실패를 조용히 삼키지 않고 이유를 말한다. */
  async function fetchArticle(url) {
    const r = await global.__nbdFetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = (p) => {
      const el = doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`);
      return el ? (el.getAttribute('content') || '').trim() : '';
    };
    const ps = [...doc.querySelectorAll('article p, #dic_area, #articleBodyContents, .article_body p, p')]
      .map(el => (el.textContent || '').trim())
      .filter(t => t.length >= 20);
    const body = [...new Set(ps)].join('\n');
    const images = [...doc.querySelectorAll('meta[property="og:image"]')]
      .map(el => el.getAttribute('content')).filter(Boolean);
    return {
      title: meta('og:title') || (doc.querySelector('title') || {}).textContent || '',
      body, images, press: meta('og:site_name') || '', date: meta('article:published_time') || '',
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
          return err('이 판(' + UA_NOTE + ')은 언론사 사이트를 대신 읽어 줄 서버가 없습니다. '
            + '기사 본문을 복사해 아래 칸에 붙여넣어 주세요. (막힌 이유: ' + e.message + ')');
        }
      }
      if (!(res.body || '').trim()) {
        return err('본문을 찾지 못했습니다. 기사 본문을 직접 붙여넣어 주세요.');
      }
      res.analysis = S.analyze(res.body, res.title || '');
      return json(res);
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
    /* `out 폴더에 저장` 은 폰판에서 `PNG 내려받기` 와 결과가 같다 — 단추가 둘이면
       어느 쪽이 진짜인지 헷갈리므로 하나만 남긴다. */
    '#btnSave',
    'a[href$="out.html"]', 'a[href$="feed.html"]', 'a[href$="topics.html"]',
    'a[href$="insta.html"]'];

  function tidy() {
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
