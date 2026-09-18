/* 숏폼 스튜디오 웹판 - PC 판 preload.js 의 `window.studio` 를 브라우저에서 대신한다 (2026-09-18).
 *
 * 화면 코드(editor.js·hunter.js)는 PC 판과 **같은 파일**이다. 다른 것은 이 파일뿐이다.
 *   - 즉시 끝나야 하는 일(설계도 분해·고치기·다시 뽑기·검색 링크) → 브라우저에서 엔진을 그대로 돌린다
 *   - 남의 사이트·ffmpeg·음성이 필요한 일 → 깃허브 Actions(sf-call)가 PC 판 main.js 를 그대로 돌린다
 *   - 파일(소재) → 이 기기 IndexedDB 에 두고, 깃허브가 써야 할 때만 sf-media 브랜치에 올린다
 * 노트북이 꺼져 있어도 된다 - 화면은 깃허브 페이지, 서버 일은 깃허브 Actions.
 *
 * 🔴 sf-media 브랜치는 **공개**다(저장소가 공개). 올린 소재·구운 영상은 주소를 아는 누구나 볼 수
 *    있고, 매주 월요일 새벽에 비운다. 그래서 굽기·음성·내려받기 때만 올린다.
 * 🔴 경로는 `sfm/<sha1>.<ext>` (내용 해시). 같은 파일은 한 번만 올라가고, 프로젝트 파일에 남아도
 *    다른 기기에서 깃허브 사본으로 열린다(7일 안).
 */
(function (g) {
  'use strict';
  const REPO = 'koreauniversityforum/new_bo_dea';
  const BR = 'sf-media';
  const RAW = (p) => `https://raw.githubusercontent.com/${REPO}/${BR}/${p}`;
  const page = /hunter\.html$/.test(location.pathname) ? 'hunter' : 'editor';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 용량·사생활 모드 */ } }
  };
  const pat = () => { try { return localStorage.getItem('nbd_pat') || ''; } catch (e) { return ''; } };

  /* ── 이 기기의 소재 창고 (IndexedDB) ─────────────────────────────────── */
  const urls = new Map();                                   // path → blob: 주소
  function idb() {
    return new Promise((res, rej) => {
      const q = indexedDB.open('sf_studio', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('media', { keyPath: 'path' });
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }
  async function tx(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction('media', mode);
      const r = fn(t.objectStore('media'));
      t.oncomplete = () => { db.close(); res(r && 'result' in r ? r.result : undefined); };
      t.onerror = () => { db.close(); rej(t.error); };
    });
  }
  const getBlob = (p) => tx('readonly', (s) => s.get(p)).then((x) => x && x.blob);
  const EXT = { video: ['mp4', 'mov', 'mkv', 'webm', 'avi'], image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
                audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] };
  function kindOf(name, mime) {
    const e = String(name).split('.').pop().toLowerCase();
    for (const k of Object.keys(EXT)) if (EXT[k].includes(e)) return k;
    return /^video/.test(mime) ? 'video' : /^image/.test(mime) ? 'image' : 'audio';
  }
  async function sha1(buf) {
    const d = await crypto.subtle.digest('SHA-1', buf);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function putMedia(blob, name, extra) {
    const ext = (String(name).match(/\.([a-z0-9]{2,5})$/i) || [, (blob.type.split('/')[1] || 'bin')])[1].toLowerCase();
    const path = extra && extra.path ? extra.path : `sfm/${await sha1(await blob.arrayBuffer())}.${ext}`;
    const type = kindOf(name, blob.type);
    await tx('readwrite', (s) => s.put({ path, name, type, blob }));
    if (!urls.has(path)) urls.set(path, URL.createObjectURL(blob));
    return Object.assign({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, path, type }, extra || {}, { path });
  }
  function fileUrl(p) {
    p = String(p || '');
    if (urls.has(p)) return urls.get(p);
    if (/^sf[mo]\//.test(p)) return RAW(p);                 // 다른 기기에서 연 프로젝트 - 깃허브 사본
    if (/^(https?|blob|data):/.test(p)) return p;
    return '';
  }
  const ready = tx('readonly', (s) => s.getAll()).then((all) => {
    (all || []).forEach((m) => urls.set(m.path, URL.createObjectURL(m.blob)));
  }).catch(() => {});

  /* ── 파일 고르기 · 내려받기 ──────────────────────────────────────────── */
  function pickFiles(accept, multiple) {
    return new Promise((res) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept; input.multiple = !!multiple;
      input.style.display = 'none';
      input.addEventListener('change', () => { res([...input.files]); input.remove(); });
      // 취소하면 change 가 안 온다 - 창에 초점이 돌아오고 잠시 뒤에도 비었으면 빈손으로
      g.addEventListener('focus', () => setTimeout(() => { if (!input.files || !input.files.length) res([]); }, 800), { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  const safeName = (v) => String(v || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 70) || 'shortform';

  /* ── 깃허브 ─────────────────────────────────────────────────────────── */
  async function gh(method, url, body, accept) {
    const k = pat();
    if (!k) throw new Error('이 일은 깃허브가 대신 합니다. 뉴보대 「인스타 올리기」 화면 3번 칸에 깃허브 열쇠를 한 번 넣어 주세요.');
    const r = await fetch(`https://api.github.com/repos/${REPO}/${url}`, {
      method, body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + k, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });
    if (!r.ok && r.status !== 404) {
      const why = r.status === 401 ? '열쇠가 틀렸거나 만료됐습니다' : r.status === 403 ? '열쇠 권한(Contents 쓰기)을 확인하세요' : 'HTTP ' + r.status;
      const e = new Error('깃허브 요청 실패 - ' + why); e.status = r.status; throw e;
    }
    if (r.status === 404) { const e = new Error('없음'); e.status = 404; throw e; }
    return r;
  }
  const exists = (rel) => gh('GET', `contents/${rel}?ref=${BR}`).then(() => true, (e) => { if (e.status === 404) return false; throw e; });
  const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  async function commit(files, message) {
    const tree = [];
    for (const f of files) {
      const buf = f.blob ? await f.blob.arrayBuffer() : new TextEncoder().encode(f.text);
      const b = await (await gh('POST', 'git/blobs', { content: b64(buf), encoding: 'base64' })).json();
      tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: b.sha });
    }
    for (let i = 0; i < 6; i += 1) {
      const ref = await (await gh('GET', `git/ref/heads/${BR}`)).json();
      const head = await (await gh('GET', `git/commits/${ref.object.sha}`)).json();
      const t = await (await gh('POST', 'git/trees', { base_tree: head.tree.sha, tree })).json();
      const c = await (await gh('POST', 'git/commits', { message, tree: t.sha, parents: [ref.object.sha] })).json();
      try { await gh('PATCH', `git/refs/heads/${BR}`, { sha: c.sha }); return; } catch (e) {
        if (e.status !== 422 || i === 5) throw e;              // 누가 먼저 올렸다 - 새 머리 위로
        await new Promise((s) => setTimeout(s, 800 * (i + 1)));
      }
    }
  }
  // 깃허브 Actions 에게 일을 시키고 답을 기다린다. say(초) 로 경과를 알린다(퍼센트는 지어내지 않는다).
  async function call(channel, args, files, say) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
    await commit([...(files || []), { rel: `req/${id}.json`, text: JSON.stringify({ args }) }], `숏폼 요청 ${channel}`);
    await gh('POST', 'dispatches', { event_type: 'sf-call',
      // 플랫폼 열쇠(설정)는 공개 브랜치 파일이 아니라 dispatch 에만 싣는다
      client_payload: { id, channel, settings: ls.get('sf_settings', {}) } });
    const t0 = Date.now();
    while (Date.now() - t0 < 20 * 60000) {
      await new Promise((s) => setTimeout(s, 4000));
      if (say) say(Math.round((Date.now() - t0) / 1000));
      try {
        const r = await gh('GET', `contents/res/${id}.json?ref=${BR}`, null, 'application/vnd.github.raw+json');
        return (await r.json()).result;
      } catch (e) { if (e.status !== 404) throw e; }
    }
    throw new Error('깃허브가 20분 안에 답하지 않았습니다. 깃허브 Actions 의 「숏폼 스튜디오 서버 대행」을 확인하세요.');
  }
  // 깃허브가 만든 파일(음성·내려받은 소재)을 이 기기로 가져와 소재로 만든다
  async function adopt(media) {
    if (!media || !media.path) return media;
    const r = await gh('GET', `contents/${media.path}?ref=${BR}`, null, 'application/vnd.github.raw+json');
    return putMedia(await r.blob(), media.name || media.path.split('/').pop(), Object.assign({}, media, { path: media.path }));
  }
  async function ensureUploaded(paths) {
    const out = [];
    for (const p of [...new Set(paths)]) {
      if (!/^sfm\//.test(p)) throw new Error('이 소재는 경로가 올바르지 않습니다: ' + p);
      if (await exists(p)) continue;
      const blob = await getBlob(p);
      if (!blob) throw new Error('이 기기에 없는 소재가 있습니다(다른 기기에서 넣은 것 같습니다): ' + p);
      if (blob.size > 95 * 1024 * 1024) throw new Error('100MB 가까운 파일은 깃허브에 못 올립니다: ' + p);
      out.push({ rel: p, blob });
    }
    return out;
  }
  function status(text) {                                    // 편집 화면 아래 상태 줄
    const el = document.getElementById('publishStatus');
    if (el) el.textContent = text;
  }

  /* ── 창 사이 (편집 ↔ 헌터) ─────────────────────────────────────────────
   * PC 판은 창 두 개를 main.js 가 이어 준다. 웹에서는 탭 두 개를 BroadcastChannel 로 잇고,
   * 상대 탭이 아직 없으면 열면서 보낼 것을 localStorage 에 맡겨 둔다(열리면 꺼내 간다). */
  const bc = 'BroadcastChannel' in g ? new BroadcastChannel('sf-studio') : null;
  const on = {};
  function deliver(msg) {
    if (msg.to !== page) return false;
    const fn = on[msg.type];
    if (!fn) return false;
    setTimeout(() => fn(msg.data), 0);
    return true;
  }
  function drain() {
    const q = ls.get('sf_pending', []);
    const left = q.filter((m) => !(m.to === page && on[m.type] && deliver(m)));
    ls.set('sf_pending', left);
  }
  if (bc) bc.onmessage = (e) => { if (deliver(e.data)) ls.set('sf_pending', ls.get('sf_pending', []).filter((m) => m.n !== e.data.n)); };
  function sendTo(to, type, data) {
    const msg = { to, type, data, n: Date.now() + Math.random() };
    ls.set('sf_pending', [...ls.get('sf_pending', []), msg]);
    if (bc) bc.postMessage(msg);
    const name = to === 'hunter' ? 'sf-hunter' : 'sf-editor';
    const w = g.open('', name);
    try { if (!w || w.location.href === 'about:blank') w.location = (to === 'hunter' ? 'hunter.html' : 'editor.html'); else w.focus(); } catch (e) { /* 막힘 */ }
    return true;
  }
  const listen = (type) => (cb) => { on[type] = cb; setTimeout(drain, 50); };

  /* ── 엔진(브라우저에서 바로) ─────────────────────────────────────────── */
  const mods = {};
  async function engine(file) {
    if (mods[file]) return mods[file];
    const src = await (await fetch(file, { cache: 'no-cache' })).text();
    const module = { exports: {} };
    const fakeRequire = (n) => {
      if (/crypto$/.test(n)) return { createHash: () => ({ update() { return this; }, digest: () => Math.random().toString(16).slice(2).padEnd(40, '0') }) };
      throw new Error('브라우저에서 못 쓰는 모듈: ' + n);
    };
    new Function('module', 'exports', 'require', src)(module, module.exports, fakeRequire);
    return (mods[file] = module.exports);
  }

  /* 음성 목록은 main.js 의 KOREAN_VOICES 와 같다 - 목록 때문에 깃허브를 부르면 30초가 걸린다 */
  const VOICES = [
    { name: 'ko-KR-SunHiNeural', culture: 'ko-KR', gender: '여성 · 밝고 또렷함' },
    { name: 'ko-KR-InJoonNeural', culture: 'ko-KR', gender: '남성 · 차분함' }
  ];

  const say = (what) => (s) => status(`${what} - 깃허브에서 처리 중 ${s}초 (보통 30초~3분)`);
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { return { ok: false, error: e.message }; } };

  g.studio = {
    web: true,
    fileUrl,
    openTrends: () => { const w = g.open('hunter.html', 'sf-hunter'); if (w) w.focus(); return true; },
    openSettings: () => sendTo('editor', 'settings'),
    onOpenSettings: listen('settings'),
    pickMedia: async () => {
      const files = await pickFiles('video/*,image/*,audio/*', true);
      const out = [];
      for (const f of files) out.push(await putMedia(f, f.name));
      return out;
    },
    pickOutput: async () => null,
    exportVideo: async (project) => {
      try {
        const p = JSON.parse(JSON.stringify(project));
        const tl = p.timeline || {};
        const paths = [...(tl.video || []), ...(tl.audio || [])].map((c) => c.path);
        status('소재를 깃허브에 올리는 중…');
        const files = await ensureUploaded(paths);
        const r = await call('video:export', [p], files, say('1080×1920 MP4 굽는 중'));
        if (!r || !r.ok) return r || { ok: false, error: '결과가 비었습니다.' };
        status('구운 영상을 받는 중…');
        const v = await gh('GET', `contents/${r.rel}?ref=${BR}`, null, 'application/vnd.github.raw+json');
        saveBlob(await v.blob(), safeName(project.title) + '.mp4');
        return { ok: true, path: r.path };                  // 공개 주소 - 발행(인스타 릴스)에 그대로 쓴다
      } catch (e) { return { ok: false, error: e.message }; }
    },
    loadHunter: async (options) => {
      const r = await call('hunter:load', [options || {}], [], null);
      if (r && r.ok === false && r.error) throw new Error(r.error);
      return r;
    },
    remixConcept: async (p) => {
      p = p || {};
      if (!p.analysis || !p.analysis.sampleSize) return null;
      return (await engine('shortform-analysis.js')).buildConcept(p.keyword, p.analysis, { variant: Number(p.variant) || 0 });
    },
    searchLink: async (p) => (await engine('hunter-engine.js')).searchLinkFor((p || {}).platform, (p || {}).keyword || ''),
    blueprint: async (p) => {
      p = p || {};
      const A = await engine('shortform-analysis.js');
      const bp = A.blueprintFrom(p.items || [], p.keyword || '', { variant: p.variant || 0 });
      return bp ? { blueprint: bp, options: A.blueprintOptions() } : null;
    },
    updateBlueprint: async (p) => (await engine('shortform-analysis.js')).updateBlueprint((p || {}).blueprint, (p || {}).change, (p || {}).options || {}),
    blueprintConcept: async (p) => (await engine('shortform-analysis.js')).conceptFromBlueprint((p || {}).blueprint),
    onHunterPrefill: listen('prefill'),
    onNewbodaeContext: (cb) => { on.newbodae = cb; newbodae(); },
    sendConcept: async (concept) => sendTo('editor', 'concept', concept),
    onConcept: listen('concept'),
    onExportProgress: (cb) => { on.progress = cb; },
    saveProject: async (project) => {
      const name = safeName(project.title || '새 프로젝트') + '.shortform.json';
      saveBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), name);
      return name;
    },
    openProject: async () => {
      const [f] = await pickFiles('.json,application/json', false);
      if (!f) return null;
      return JSON.parse(await f.text());
    },
    loadSettings: async () => ls.get('sf_settings', {}),
    saveSettings: async (s) => { ls.set('sf_settings', s || {}); return true; },
    publish: async (payload) => {
      try {
        const r = await call('publish:start', [payload], [], say('발행 중'));
        return Array.isArray(r) ? r : [{ platform: '발행', ok: false, message: (r && r.error) || '결과가 비었습니다.' }];
      } catch (e) { return [{ platform: '발행', ok: false, message: e.message }]; }
    },
    openExternal: async (url) => { g.open(url, '_blank', 'noopener'); return true; },
    searchWebMedia: async (options) => {
      try { return await call('webmedia:search', [options || {}], [], say('소재 찾는 중')); } catch (e) { return { ok: false, error: e.message, items: [] }; }
    },
    downloadWebMedia: wrap(async (item) => {
      const r = await call('webmedia:download', [item], [], say('소재 받는 중'));
      if (!r || !r.ok) return r;
      ls.set('sf_credits', [...ls.get('sf_credits', []), Object.assign({ at: new Date().toISOString() }, item)].slice(-300));
      return { ok: true, media: await adopt(r.media) };
    }),
    downloadFromUrl: wrap(async (url) => {
      const r = await call('webmedia:downloadUrl', [url], [], say('주소에서 받는 중'));
      return r && r.ok ? { ok: true, media: await adopt(r.media) } : r;
    }),
    webMediaCredits: async () => ls.get('sf_credits', []),
    revealWebMedia: async () => {
      const list = ls.get('sf_credits', []);
      const w = g.open('', '_blank');
      if (w) {
        w.document.title = '받은 소재 출처';
        w.document.body.style.cssText = 'font:14px/1.6 sans-serif;padding:16px';
        w.document.body.innerHTML = '<h3>받은 소재 출처 (' + list.length + ')</h3>' + list.slice().reverse().map((x) =>
          '<div>' + [x.title || x.name || '', x.author || x.creator || '', x.license || '', x.source || x.provider || ''].filter(Boolean).join(' · ')
            .replace(/</g, '&lt;') + (x.pageUrl || x.url ? ' - <a href="' + String(x.pageUrl || x.url).replace(/"/g, '') + '">원본</a>' : '') + '</div>').join('');
      }
      return true;
    },
    listVoices: async () => ({ ok: true, voices: VOICES }),
    generateVoice: wrap(async (options) => {
      const r = await call('voice:generate', [options || {}], [], (s) => {
        const el = document.getElementById('voiceoverStatus');
        if (el) el.textContent = `깃허브에서 음성 만드는 중 ${s}초`;
      });
      return r && r.ok ? { ok: true, media: await adopt(r.media) } : r;
    }),
    openWebMediaPanel: (payload) => sendTo('editor', 'webmedia', payload),
    onOpenWebMedia: listen('webmedia')
  };

  /* ── 뉴보대에서 넘어올 때 (앱의 「숏폼 만들기」와 같은 일) ─────────────
   * 카드 메이커 화면이 「인스타 올리기」로 담아 둔 카드(nbd_stage)를 소재로, 제목·검색어를 잇는다.
   * 같은 사이트(github.io/new_bo_dea)라 IndexedDB 를 그대로 읽을 수 있다. */
  async function newbodae() {
    if (!/[?&]from=newbodae\b/.test(location.search) || !on.newbodae) return;
    // 🔴 editor.js 가 전역에 `history`(되돌리기 기록)를 선언해 브라우저의 history 를 가린다 - window. 로
    g.history.replaceState(null, '', location.pathname);       // 새로고침 때 또 담기지 않게
    const ctx = ls.get('nb_sf_ctx', {}) || {};
    const media = [];
    try {
      const db = await new Promise((res, rej) => { const q = indexedDB.open('nbd_stage', 1); q.onupgradeneeded = () => q.result.createObjectStore('cards', { keyPath: 'id', autoIncrement: true }); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      const cards = await new Promise((res) => { const t = db.transaction('cards', 'readonly').objectStore('cards').getAll(); t.onsuccess = () => res(t.result || []); t.onerror = () => res([]); });
      db.close();
      for (const c of cards.sort((a, b) => a.id - b.id)) media.push(await putMedia(c.blob, (c.name || 'card') + '.png'));
    } catch (e) { /* 담은 카드가 없으면 빈손 */ }
    if (ctx.keyword) sendTo('hunter', 'prefill', { keyword: ctx.keyword });
    on.newbodae({ source: 'newbodae', keyword: ctx.keyword || '', title: ctx.title || '', media });
  }

  // 뉴보대로 돌아가는 길 - PC 판에는 없는 단추라 화면 코드를 건드리지 않고 여기서 얹는다
  g.addEventListener('DOMContentLoaded', () => {
    const a = document.createElement('a');
    a.href = '../../'; a.textContent = '← 뉴보대';
    a.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:9999;padding:6px 10px;border-radius:8px;background:#3b6ef5;color:#fff;font:600 12px sans-serif;text-decoration:none;opacity:.85';
    document.body.appendChild(a);
  });

  g.__sfReady = ready;
})(window);
