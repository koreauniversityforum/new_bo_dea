/* 뉴보대 카드뉴스 메이커 — 삽입 사진(배경 위에 자유롭게 올리는 사진) + 배경 제거
 *
 * 배경 사진(S.bg)과 따로 논다. 장마다 `S.stickers` 에 자리·크기·회전만 적고,
 * 그림 자체는 이 파일의 IMGS(id → { orig, cut }) 에 둔다.
 *  - 시리즈 편집기(deck.js)가 장을 넘길 때 전역 S 를 통째로 갈아 끼운다 → 항상 그때의 S 를 읽는다.
 *  - 그림을 S 에 넣지 않는 까닭: S 는 localStorage(5MB)에 통째로 저장된다. 사진 몇 장이면 넘쳐
 *    저장이 조용히 실패한다. 배경 사진과 같은 규칙으로 주소(http·/api/proxy)만 남기고,
 *    내 PC 파일(blob:)은 남기지 않는다 — 새로 고치면 내 PC 에서 넣은 삽입 사진은 빠진다.
 *
 * 그리는 차례: 배경 → 어두운 막 → 장식·띠·로고 → **삽입 사진** → 글자. 글자는 늘 위에 온다.
 * 고른 표시(테두리·손잡이)는 캔버스가 아니라 위에 얹은 div 에 그린다 — 저장 파일·작은 그림에 안 묻는다.
 *
 * 배경 제거 두 가지:
 *  ① 자동(AI) — @imgly/background-removal 을 **누를 때만** 인터넷에서 받는다(처음 한 번 수십 MB,
 *     그 뒤로는 브라우저 캐시). 사람·물건 사진용. 라이선스 AGPL-3.0.
 *  ② 단색 배경 — 사진 테두리에서 시작해 비슷한 색을 지운다(설치·인터넷 불필요, 즉시).
 *     로고·제품 사진처럼 바탕이 한 색일 때 맞다. 「허용 범위」로 얼마나 비슷하면 지울지 정한다.
 *  사진 자체의 색·밝기는 건드리지 않는다(필터 금지 원칙). 지운 자리의 투명도만 바뀐다.
 *
 * app.js 가 부르는 손잡이: draw(ctx) · frame() · hit(p) · startDrag(o, part, p) · dragTo(d, p, ev)
 *                          · wheel(ev, p) · key(ev) · select(id) · add(src) · ensureAll(st)
 */
const STK = (() => {
  const IMGS = {};             // id → { orig, cut, loading, dead }
  let selId = null;
  const MAX_SIDE = 1600;       // 배경 제거 작업 크기 상한(이보다 크면 줄여서 지운다)
  const IMGLY = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
  let imglyP = null;

  const list = () => (S.stickers || (S.stickers = []));
  const find = (id) => list().find(o => o.id === id) || null;
  const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const keepSrc = (src) => (/^(data:|blob:)/.test(src) ? '' : src);
  const outroOn = () => !!(window.DECK && DECK.isOutroActive());
  const note = (t, cls) => { const el = $('stkMsg'); if (el) msg(el, t, cls); };

  /** 지금 그릴 그림 — 배경을 지웠으면 지운 판, 아니면 원본 */
  function pic(o) {
    const m = IMGS[o.id];
    if (!m || !m.orig) return null;
    return (o.cut && m.cut) ? m.cut : m.orig;
  }
  const natW = (im) => im.naturalWidth || im.width;
  const natH = (im) => im.naturalHeight || im.height;
  function heightOf(o) {
    const m = IMGS[o.id];
    if (!m || !m.orig) return o.w;
    return o.w * natH(m.orig) / natW(m.orig);
  }

  /** 그림이 아직 안 실렸으면 싣는다(새로 고침 뒤 · 안 열어 본 장). 끝나면 다시 그린다. */
  function ensure(o) {
    if (IMGS[o.id]) return IMGS[o.id].p || Promise.resolve();
    if (!o.src) { IMGS[o.id] = { dead: true }; return Promise.resolve(); }
    const m = IMGS[o.id] = { loading: true };
    m.p = loadImage(o.src).then(async im => {
      m.orig = im; m.loading = false;
      // 단색 지우기는 금방이라 다시 해 둔다. AI 는 무거워 사용자가 다시 누르게 둔다.
      if (o.cut === 'color') { try { m.cut = cutColor(im, o.tol || 40); } catch (e) { o.cut = ''; } }
      else if (o.cut) o.cut = '';
      render();
    }).catch(() => { m.dead = true; m.loading = false; render(); });
    return m.p;
  }
  async function ensureAll(st) {
    const arr = (st && st.stickers) || [];
    for (const o of arr) await ensure(o);
  }

  /* ───────────── 그리기 ───────────── */
  function draw(g) {
    // 그림을 잃은 것(내 PC 파일을 넣고 새로 고침)은 조용히 뺀다
    if (S.stickers && S.stickers.some(o => IMGS[o.id] && IMGS[o.id].dead)) {
      S.stickers = S.stickers.filter(o => !(IMGS[o.id] && IMGS[o.id].dead));
    }
    list().forEach(o => {
      const im = pic(o);
      if (!im) { ensure(o); return; }
      const w = o.w, h = heightOf(o);
      g.save();
      g.translate(o.x, o.y);
      g.rotate((o.rot || 0) * Math.PI / 180);
      if (o.flip) g.scale(-1, 1);
      g.drawImage(im, -w / 2, -h / 2, w, h);
      g.restore();
    });
  }

  /** 고른 사진의 테두리·손잡이(div). 캔버스 밖이라 저장에 안 들어간다. */
  let frameEl = null;
  function frameBox() {
    if (frameEl) return frameEl;
    const box = cv.parentElement;
    frameEl = document.createElement('div');
    frameEl.className = 'stk-frame';
    frameEl.innerHTML = '<i class="stk-rot"></i><i class="stk-size"></i>';
    box.appendChild(frameEl);
    return frameEl;
  }
  function frame() {
    const el = frameBox();
    const o = selId && find(selId);
    if (!o || !pic(o) || outroOn()) { el.hidden = true; return; }
    const sc = cv.clientWidth / W;
    const h = heightOf(o);
    el.hidden = false;
    el.style.left = (cv.offsetLeft + o.x * sc) + 'px';
    el.style.top = (cv.offsetTop + o.y * sc) + 'px';
    el.style.width = (o.w * sc) + 'px';
    el.style.height = (h * sc) + 'px';
    el.style.transform = `translate(-50%,-50%) rotate(${o.rot || 0}deg)`;
    syncPanel();
  }
  window.addEventListener('resize', () => frame());

  /* ───────────── 마우스 ───────────── */
  /** 사진 기준 좌표로 바꾼다(회전을 되돌린다) */
  function local(o, p) {
    const a = -(o.rot || 0) * Math.PI / 180;
    const dx = p.x - o.x, dy = p.y - o.y;
    return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
  }
  /** 눌린 자리 → { o, part: 'move'|'size'|'rot' } 또는 null. 위에 그린 것부터 본다. */
  function hit(p) {
    if (outroOn()) return null;
    const grab = 30 * W / Math.max(1, cv.clientWidth);     // 손잡이 반경(화면 약 30px)
    const s = selId && find(selId);
    if (s && pic(s)) {
      const q = local(s, p), h = heightOf(s);
      if (Math.hypot(q.x - s.w / 2, q.y - h / 2) <= grab) return { o: s, part: 'size' };
      if (Math.hypot(q.x, q.y - (-h / 2 - grab * 1.6)) <= grab) return { o: s, part: 'rot' };
    }
    const arr = list();
    for (let i = arr.length - 1; i >= 0; i--) {
      const o = arr[i];
      if (!pic(o)) continue;
      const q = local(o, p), h = heightOf(o);
      if (Math.abs(q.x) <= o.w / 2 && Math.abs(q.y) <= h / 2) return { o, part: 'move' };
    }
    return null;
  }
  function startDrag(o, part, p) {
    select(o.id);
    return { mode: 'stk', part, o, ox: o.x - p.x, oy: o.y - p.y,
             w0: o.w, d0: Math.max(1, Math.hypot(p.x - o.x, p.y - o.y)) };
  }
  function dragTo(d, p, ev) {
    const o = d.o;
    if (d.part === 'move') {
      o.x = Math.round(p.x + d.ox); o.y = Math.round(p.y + d.oy);
    } else if (d.part === 'size') {
      o.w = clampW(d.w0 * Math.hypot(p.x - o.x, p.y - o.y) / d.d0);
    } else {
      let a = Math.atan2(p.y - o.y, p.x - o.x) * 180 / Math.PI + 90;
      if (ev && ev.shiftKey) a = Math.round(a / 15) * 15;           // Shift = 15° 씩
      a = ((a + 180) % 360 + 360) % 360 - 180;
      o.rot = Math.round(a);
    }
  }
  const clampW = (w) => Math.round(Math.min(W * 3, Math.max(40, w)));

  /** 휠: 사진 위에서 굴리면 그 사진 크기. 배경 확대보다 먼저 받는다. */
  function wheel(ev, p) {
    const h = hit(p);
    if (!h) return false;
    ev.preventDefault();
    select(h.o.id);
    h.o.w = clampW(h.o.w * (ev.deltaY < 0 ? 1.06 : 1 / 1.06));
    render();
    return true;
  }
  /** 키: 고른 사진이 있으면 화살표=이동 · Delete=지우기 · Esc=고르기 풀기 */
  function key(ev) {
    const o = selId && find(selId);
    if (!o || outroOn()) return false;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); remove(o.id); return true; }
    if (ev.key === 'Escape') { select(null); return true; }
    const d = ev.shiftKey ? 10 : 2;
    const map = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
    if (!map[ev.key]) return false;
    ev.preventDefault();
    o.x += map[ev.key][0]; o.y += map[ev.key][1];
    render();
    return true;
  }

  /* ───────────── 넣기·빼기 ───────────── */
  async function add(src) {
    if (outroOn()) { note('뒷장에는 사진을 삽입할 수 없습니다. 카드 장을 고르세요.', 'err'); return null; }
    let im;
    try { im = await loadImage(src); } catch (e) { note('사진을 불러오지 못했습니다: ' + e.message, 'err'); return null; }
    const n = list().length;
    // 처음 크기: 카드 폭의 45% · 높이는 카드의 50% 를 넘지 않게
    let w = W * 0.45;
    const h = w * natH(im) / natW(im);
    if (h > H * 0.5) w *= H * 0.5 / h;
    const o = { id: uid(), src: keepSrc(src), x: Math.round(W / 2 + n * 36), y: Math.round(H * 0.42 + n * 36),
                w: Math.round(w), rot: 0, flip: false, cut: '', tol: 40 };
    IMGS[o.id] = { orig: im };
    list().push(o);
    select(o.id);
    render();
    note('삽입했습니다. 캔버스에서 끌어 옮기고, 오른쪽 아래 점=크기 · 위쪽 점=회전.', 'ok');
    return o;
  }
  function remove(id) {
    S.stickers = list().filter(o => o.id !== id);
    if (selId === id) selId = null;
    render(); paintPanel();
  }
  function select(id) {
    if (selId === id) return;
    selId = id;
    paintPanel();
    frame();
  }
  function selected() { return selId && find(selId); }

  /* ───────────── 배경 제거 ───────────── */
  function workCanvas(im) {
    const s = Math.min(1, MAX_SIDE / Math.max(natW(im), natH(im)));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(natW(im) * s));
    c.height = Math.max(1, Math.round(natH(im) * s));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c;
  }

  /** 단색 배경 지우기 — 테두리 픽셀마다 그 색을 기준으로, 이어진 비슷한 색을 투명하게 한다.
   *  기준을 씨앗마다 따로 두므로 위·아래 색이 다른 바탕(하늘+바닥)도 함께 지워진다.
   *  지운 곳과 맞닿은 가장자리는 허용 범위의 1.6배까지 반투명으로 이어 계단을 줄인다. */
  function cutColor(im, tol) {
    const c = workCanvas(im);
    const g = c.getContext('2d');
    let d;
    try { d = g.getImageData(0, 0, c.width, c.height); }
    catch (e) { throw new Error('다른 사이트의 사진이라 픽셀을 읽을 수 없습니다. 내 PC 에 받아 다시 넣어 보세요.'); }
    const w = c.width, h = c.height, px = d.data, N = w * h;
    const ref = new Int32Array(N).fill(-1);      // 이 픽셀을 지우게 한 씨앗(테두리 픽셀)
    const q = new Int32Array(N);
    let qh = 0, qt = 0;
    const t2 = tol * tol;
    const dist2 = (i, j) => {
      const a = i * 4, b = j * 4;
      const dr = px[a] - px[b], dg = px[a + 1] - px[b + 1], db = px[a + 2] - px[b + 2];
      return dr * dr + dg * dg + db * db;
    };
    const seed = (i) => { if (ref[i] < 0) { ref[i] = i; q[qt++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (qh < qt) {
      const i = q[qh++], s = ref[i], x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nb) {
        if (j < 0 || j >= N || ref[j] >= 0) continue;
        if (px[j * 4 + 3] < 8 || dist2(j, s) <= t2) { ref[j] = s; q[qt++] = j; }
      }
    }
    // 가장자리: 지운 곳 옆에 붙은 픽셀은 색이 가까운 만큼 반투명
    const soft = tol * 1.6, s2 = soft * soft;
    const alpha = new Uint8ClampedArray(N);
    for (let i = 0; i < N; i++) alpha[i] = ref[i] >= 0 ? 0 : px[i * 4 + 3];
    for (let i = 0; i < N; i++) {
      if (ref[i] >= 0) continue;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      let best = -1;
      for (const j of nb) if (j >= 0 && j < N && ref[j] >= 0) { const dd = dist2(i, ref[j]); if (best < 0 || dd < best) best = dd; }
      if (best >= 0 && best < s2) {
        const k = (Math.sqrt(best) - tol) / (soft - tol);
        alpha[i] = Math.round(px[i * 4 + 3] * Math.min(1, Math.max(0.15, k)));
      }
    }
    let gone = 0;
    for (let i = 0; i < N; i++) { px[i * 4 + 3] = alpha[i]; if (!alpha[i]) gone++; }
    g.putImageData(d, 0, 0);
    c._gone = gone / N;
    return c;
  }

  /** 자동(AI) — 처음 누를 때 라이브러리·모델을 받는다. 결과는 투명 PNG. */
  async function cutAI(im, onProg) {
    if (!imglyP) imglyP = import(IMGLY).catch(e => { imglyP = null; throw e; });
    let lib;
    try { lib = await imglyP; }
    catch (e) { throw new Error('배경 제거 도구를 받지 못했습니다(인터넷 연결 확인). 바탕이 한 색이면 「단색 배경 지우기」를 쓰세요.'); }
    const fn = lib.removeBackground || lib.default;
    const c = workCanvas(im);
    let blob;
    try { blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('사진 읽기 실패')), 'image/png')); }
    catch (e) { throw new Error('다른 사이트의 사진이라 읽을 수 없습니다. 내 PC 에 받아 다시 넣어 보세요.'); }
    const out = await fn(blob, {
      output: { format: 'image/png' },
      progress: (k, cur, total) => onProg && onProg(k, cur, total)
    });
    const url = URL.createObjectURL(out);
    try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
  }

  let busy = false;
  async function runCut(mode) {
    const o = selected();
    if (!o) { note('먼저 캔버스나 아래 목록에서 삽입 사진을 고르세요.', 'err'); return; }
    const m = IMGS[o.id];
    if (!m || !m.orig) { note('사진이 아직 실리지 않았습니다.', 'err'); return; }
    if (busy) return;
    busy = true;
    paintPanel();
    try {
      if (mode === 'color') {
        m.cut = cutColor(m.orig, o.tol || 40);
        o.cut = 'color';
        const pct = Math.round((m.cut._gone || 0) * 100);
        note(pct < 2 ? '지운 곳이 거의 없습니다. 「허용 범위」를 올려 보세요(바탕이 한 색일 때 맞는 방식입니다).'
                     : `바탕 ${pct}% 를 지웠습니다. 덜 지워졌거나 너무 지워지면 「허용 범위」를 움직이세요.`, 'ok');
      } else {
        note('자동 배경 제거 준비 중… 처음 한 번은 모델을 받느라 시간이 걸립니다.', '');
        m.cut = await cutAI(m.orig, (k, cur, total) => {
          if (/fetch/.test(k) && total) note(`모델 받는 중 ${Math.round(cur / total * 100)}%`, '');
          else if (/compute|inference/.test(k)) note('배경을 지우는 중…', '');
        });
        o.cut = 'ai';
        note('배경을 지웠습니다(자동). 「원래대로」로 되돌릴 수 있습니다.', 'ok');
      }
    } catch (e) {
      note(e.message || String(e), 'err');
    } finally {
      busy = false;
      render(); paintPanel();
    }
  }
  function uncut() {
    const o = selected();
    if (!o) return;
    o.cut = '';
    render(); paintPanel();
    note('원본으로 되돌렸습니다.', 'ok');
  }

  /* ───────────── 왼쪽 패널 ───────────── */
  function paintPanel() {
    const box = $('stkList');
    if (!box) return;
    const arr = list();
    $('stkCount').textContent = arr.length + '장';
    box.innerHTML = '';
    arr.forEach((o, i) => {
      const m = IMGS[o.id];
      const im = document.createElement('img');
      if (m && m.orig) im.src = m.orig.src;
      im.title = (i + 1) + '번째 삽입 사진 · 눌러서 고르기';
      im.classList.toggle('on', o.id === selId);
      im.addEventListener('click', () => select(o.id === selId ? null : o.id));
      box.appendChild(im);
    });
    const o = selected();
    $('stkEdit').hidden = !o;
    if (o) {
      $('btnStkAI').disabled = busy;
      $('btnStkColor').disabled = busy;
      $('btnStkUncut').disabled = busy || !o.cut;
      $('stkCutState').textContent = o.cut === 'ai' ? '배경 지움(자동)' : o.cut === 'color' ? '배경 지움(단색)' : '원본';
    }
    syncPanel();
  }
  /** 끌거나 굴릴 때마다 슬라이더 숫자만 맞춘다(목록은 다시 안 그림) */
  function syncPanel() {
    const o = selected();
    if (!o || !$('stkSize')) return;
    const put = (id, v) => {
      const el = $(id);
      if (document.activeElement !== el) el.value = v;
      el.parentElement.querySelector('.val').textContent = v;
    };
    put('stkSize', Math.round(o.w));
    put('stkRot', o.rot || 0);
    put('stkTol', o.tol || 40);
  }

  function bind() {
    if (!$('stkList')) return;
    const css = document.createElement('style');
    css.textContent = `
      .stk-frame{position:absolute;pointer-events:none;border:1.5px solid #3b6ef5;box-sizing:border-box;border-radius:2px}
      .stk-frame i{position:absolute;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid #3b6ef5;box-sizing:border-box}
      .stk-frame .stk-size{right:-6px;bottom:-6px}
      .stk-frame .stk-rot{left:50%;top:-38px;margin-left:-6px}
      .stk-frame .stk-rot::after{content:'';position:absolute;left:3px;top:10px;width:1.5px;height:26px;background:#3b6ef5}
      #stkList img{background-color:#d8dbe2;background-image:linear-gradient(45deg,#b9bdc6 25%,transparent 25%,transparent 75%,#b9bdc6 75%),linear-gradient(45deg,#b9bdc6 25%,transparent 25%,transparent 75%,#b9bdc6 75%);background-size:10px 10px;background-position:0 0,5px 5px;object-fit:contain}`;
    document.head.appendChild(css);

    $('btnStkAdd').addEventListener('click', () => $('stkPick').click());
    $('stkPick').addEventListener('change', async (e) => {
      for (const f of [...e.target.files]) await add(URL.createObjectURL(f));
      e.target.value = '';
    });
    const range = (id, apply) => $(id).addEventListener('input', () => {
      const o = selected(); if (!o) return;
      apply(o, +$(id).value);
      render();
    });
    range('stkSize', (o, v) => { o.w = clampW(v); });
    range('stkRot', (o, v) => { o.rot = v; });
    let tolTimer = null;
    $('stkTol').addEventListener('input', () => {
      const o = selected(); if (!o) return;
      o.tol = +$('stkTol').value;
      syncPanel();
      // 이미 단색으로 지웠으면 움직이는 대로 다시 지운다(살짝 늦춰 연달아 계산하지 않게)
      if (o.cut === 'color') { clearTimeout(tolTimer); tolTimer = setTimeout(() => runCut('color'), 120); }
    });
    $('btnStkFlip').addEventListener('click', () => { const o = selected(); if (o) { o.flip = !o.flip; render(); } });
    $('btnStkFront').addEventListener('click', () => {
      const o = selected(); if (!o) return;
      S.stickers = list().filter(x => x !== o).concat(o); render(); paintPanel();
    });
    $('btnStkBack').addEventListener('click', () => {
      const o = selected(); if (!o) return;
      S.stickers = [o].concat(list().filter(x => x !== o)); render(); paintPanel();
    });
    $('btnStkCopy').addEventListener('click', () => {
      const o = selected(); if (!o) return;
      const c = { ...o, id: uid(), x: o.x + 36, y: o.y + 36 };
      IMGS[c.id] = { ...IMGS[o.id] };
      list().push(c); select(c.id); render();
    });
    $('btnStkFit').addEventListener('click', () => {
      const o = selected(); if (!o) return;
      o.x = W / 2; o.y = H / 2; o.rot = 0;
      const h = heightOf(o) / o.w;
      o.w = clampW(Math.max(W, H / h));          // 카드를 꽉 덮는 크기
      render();
    });
    $('btnStkDel').addEventListener('click', () => { const o = selected(); if (o) remove(o.id); });
    $('btnStkAI').addEventListener('click', () => runCut('ai'));
    $('btnStkColor').addEventListener('click', () => runCut('color'));
    $('btnStkUncut').addEventListener('click', uncut);
    paintPanel();
  }

  /** 장이 바뀌면(시리즈) 고른 표시를 풀고 목록을 그 장 것으로 */
  let lastS = null;
  function afterRender() {
    if (lastS !== S) { lastS = S; if (selId && !find(selId)) selId = null; paintPanel(); }
    frame();
  }

  bind();
  return { draw, frame: afterRender, hit, startDrag, dragTo, wheel, key, select, add, remove, ensureAll, selected };
})();
