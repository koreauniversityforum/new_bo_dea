/* 워터마크 — 무단 퍼가기 대비.

   보이는 로고 워터마크(뒷장 화면)는 **뉴보대(@news_univ)** 몫이고,
   이 파일은 **한국대학생포럼** 표시를 얹는다. 세 겹으로 간다.

     ① 숨긴 무늬   — 아주 옅은 로고+글자를 비스듬히 깔아 둔다. 100%로 보면 안 보이지만
                    대비를 올리면 드러난다. 검정 위에 흰색을 1.5px 밀어 겹치므로
                    **밝은 배경에서도 어두운 배경에서도** 남는다.
                    인스타가 다시 압축하거나 남이 화면을 찍어 가도 대체로 살아 있다.
     ② 보이는 무늬 — **내려받을 때만** 얹는 크고 진한 워터마크. 퍼가도 쓰기 거슬리게
                    만들어 애초에 가져갈 마음이 안 들게 하는 쪽이다.
                    편집 화면 미리보기에는 안 나온다(디자인이 안 보이면 곤란하므로).
     ③ 파일 속 글자 — 픽셀 값의 마지막 비트에 계정·이름·날짜를 심는다. 정확히 읽히지만
                    **JPEG 로 다시 저장되면 사라진다.** 원본 PNG 를 들고 있다가
                    "이게 우리 원본"임을 보일 때 쓰는 것이다.

   🔴 ①③은 퍼가기를 **막는** 게 아니라 **추적하는** 장치다. 막는 쪽은 ②다. */
'use strict';

const HIDDEN = (() => {

  const KEY = 'nb_hidden';
  const MAGIC = 'NBD1';
  const LOGO_SRC = 'assets/한국대학생포럼_로고.png';

  const DEFAULT = {
    /* ① 숨긴 무늬 */
    on: true,
    org: '한국대학생포럼',
    handle: '@universityfourm_korea',
    alpha: 1.5,                // %  (0.3~5). 실측 3%부터 눈에 띄기 시작한다
    size: 30,                  // 글자 크기 px
    gap: 300,                  // 타일 최소 간격 px (실제 폭이 더 넓으면 그쪽을 쓴다)
    angle: -22,
    logo: true,                // 무늬에 로고도 넣을까

    /* ② 보이는 무늬 — 내려받기 전용 */
    vOn: true,
    vAlpha: 16,                // %
    vSize: 40,
    vGap: 0,                   // 0 = 글자 폭에 맞춰 자동
    vAngle: -22,
    vTone: 'white',            // white | ink | brand
    vLogo: true,

    /* ③ 파일 속 글자 */
    lsb: true
  };

  const BRAND = '#0b1f6b';     // 한국대학생포럼 로고 남색

  let _cache = null;

  function load() {
    if (_cache) return _cache;
    let s = { ...DEFAULT };
    try { s = { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch (e) { /* 처음이거나 깨졌으면 기본값 */ }
    _cache = s;
    return s;
  }

  function save(patch) {
    const s = { ...load(), ...(patch || {}) };
    _cache = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }

  const reset = () => { try { localStorage.removeItem(KEY); } catch (e) {} _cache = null; return load(); };

  const label = (c) => [(c.org || '').trim(), (c.handle || '').trim()].filter(Boolean).join(' ');

  function payload(c, info) {
    const t = new Date();
    const p = (v) => String(v).padStart(2, '0');
    const when = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} `
      + `${p(t.getHours())}:${p(t.getMinutes())}`;
    return [label(c), (info && info.name) || '', when].filter(Boolean).join(' | ');
  }

  const _newCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  /* ── 로고 ─────────────────────────────────────────────────────────────
     캔버스는 CSS 처럼 알아서 기다려 주지 않는다. 미리 받아 두고, 다 받으면
     화면에 "다시 그려라"고 알린다. 로고가 없어도 글자만으로 동작한다. */
  let _logo = null, _asked = false;
  const _waiting = [];

  function ensureLogo() {
    if (_asked || typeof Image === 'undefined') return;
    _asked = true;
    const im = new Image();
    im.onload = () => {
      _logo = im;
      _waiting.splice(0).forEach(f => { try { f(); } catch (e) {} });
    };
    im.onerror = () => console.warn('[워터마크] 로고를 못 불러왔습니다:', LOGO_SRC);
    im.src = LOGO_SRC;
  }

  /* 로고가 준비되면 한 번 부른다(이미 준비됐으면 즉시). 이때 다시 그리면 된다. */
  function onReady(fn) {
    if (_logo) { fn(); return; }
    _waiting.push(fn);
    ensureLogo();
  }

  /* 로고를 한 가지 색으로 물들여 둔다.
     source-in 은 이미 그린 그림의 '모양'만 남기고 색을 갈아 끼운다. */
  const _tint = new Map();
  function logoTinted(color) {
    if (!_logo) return null;
    if (_tint.has(color)) return _tint.get(color);
    const c = _newCanvas(_logo.naturalWidth, _logo.naturalHeight);
    const g = c.getContext('2d');
    g.drawImage(_logo, 0, 0);
    if (color !== 'orig') {
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
    }
    _tint.set(color, c);
    return c;
  }

  /* ── 타일 한 칸 재기 ──────────────────────────────────────────────────
     글자 폭을 재서 칸 간격을 정한다. 설정한 간격보다 글자가 넓으면 글자 쪽을 쓴다
     — 안 그러면 칸끼리 겹쳐 뭉개져서 나중에 읽어낼 수가 없다.
     겹쳐 읽기(stack)도 **같은 함수**로 간격을 구해야 아귀가 맞는다. */
  let _meas = null;
  function measure(cfg) {
    const c = { ...DEFAULT, ...(cfg || load()) };
    const size = Math.max(10, +c.size || DEFAULT.size);
    if (!_meas) _meas = _newCanvas(8, 8).getContext('2d');
    _meas.font = `800 ${size}px Pretendard, "Malgun Gothic", sans-serif`;
    const text = label(c);
    const tw = text ? _meas.measureText(text).width : 0;
    const useLogo = c.logo !== false && !!_logo;
    const lh = useLogo ? size * 1.9 : 0;
    const lw = useLogo ? lh * _logo.naturalWidth / _logo.naturalHeight : 0;
    const pad = size * 0.5;
    const unitW = lw + (lw && tw ? pad : 0) + tw;
    const unitH = Math.max(lh, size * 1.35);
    return {
      size, text, tw, lw, lh, pad, unitW, unitH,
      TW: Math.max(+c.gap || 0, Math.ceil(unitW + size * 1.8)),
      TH: Math.ceil(unitH + size * 1.5)
    };
  }

  /* 로고 + 글자 한 벌을 (cx, cy) 가운데에 그린다 */
  function unit(ctx, m, cx, cy, color) {
    const x0 = cx - m.unitW / 2;
    if (m.lw) {
      const img = logoTinted(color);
      if (img) ctx.drawImage(img, x0, cy - m.lh / 2, m.lw, m.lh);
    }
    if (m.text) {
      ctx.fillStyle = color === 'orig' ? BRAND : color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.text, x0 + m.lw + (m.lw ? m.pad : 0), cy);
    }
  }

  /* 비스듬히 깔아 놓기 — 줄마다 반 칸 어긋내야 격자 티가 덜 난다 */
  function tile(ctx, W, H, m, angle, paint) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((+angle || 0) * Math.PI / 180);
    ctx.font = `800 ${m.size}px Pretendard, "Malgun Gothic", sans-serif`;
    const R = Math.ceil(Math.hypot(W, H) / 2) + Math.max(m.TW, m.TH);
    let row = 0;
    for (let y = -R; y <= R; y += m.TH, row++) {
      const off = (row % 2) ? m.TW / 2 : 0;
      for (let x = -R + off; x <= R; x += m.TW) paint(x, y);
    }
    ctx.restore();
  }

  /* ── ① 숨긴 무늬 ─────────────────────────────────────────────────────
     검정 → 흰색을 1.5px 밀어 두 번 그린다. 두 색이 거의 상쇄되어 눈에는 안 띄고
     경계에만 미세한 요철이 남는다. 그 요철을 나중에 대비로 끌어올려 읽는다. */
  function pattern(ctx, W, H, cfg) {
    const c = { ...DEFAULT, ...(cfg || load()) };
    if (!c.on) return;
    const a = Math.max(0, Math.min(0.08, (+c.alpha || 0) / 100));
    if (a <= 0) return;
    const m = measure(c);
    if (!m.text && !m.lw) return;
    ensureLogo();
    ctx.save();
    ctx.globalAlpha = a;
    tile(ctx, W, H, m, c.angle, (x, y) => {
      unit(ctx, m, x, y, '#000000');
      unit(ctx, m, x + 1.5, y + 1.5, '#ffffff');
    });
    ctx.restore();
  }

  /* ── ② 보이는 무늬 (내려받기 전용) ────────────────────────────────────
     밝은 배경에서도 보이도록 어두운 그림자를 먼저 깔고 그 위에 본색을 얹는다. */
  function visible(ctx, W, H, cfg) {
    const c = { ...DEFAULT, ...(cfg || load()) };
    if (!c.vOn) return;
    const a = Math.max(0, Math.min(1, (+c.vAlpha || 0) / 100));
    if (a <= 0) return;
    const m = measure({ ...c, size: c.vSize, gap: c.vGap, logo: c.vLogo });
    if (!m.text && !m.lw) return;
    ensureLogo();

    const tone = c.vTone === 'ink' ? '#15181f' : c.vTone === 'brand' ? BRAND : '#ffffff';
    const shadow = tone === '#ffffff' ? '#000000' : '#ffffff';

    ctx.save();
    tile(ctx, W, H, m, c.vAngle, (x, y) => {
      ctx.globalAlpha = a * 0.5;
      unit(ctx, m, x + 2, y + 2, shadow);
      ctx.globalAlpha = a;
      unit(ctx, m, x, y, tone);
    });
    ctx.restore();
  }

  /* ── ③ 파일 속 글자 (LSB) ─────────────────────────────────────────── */
  function stamp(canvas, text) {
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const body = new TextEncoder().encode(text);
    if (body.length > 65535) throw new Error('숨길 글이 너무 깁니다');

    const head = new TextEncoder().encode(MAGIC);
    const buf = new Uint8Array(head.length + 2 + body.length);
    buf.set(head, 0);
    buf[head.length] = body.length >> 8;
    buf[head.length + 1] = body.length & 255;
    buf.set(body, head.length + 2);

    const d = img.data;
    const need = buf.length * 8;
    if (need > (d.length / 4) * 3) throw new Error('그림이 너무 작아 다 못 넣습니다');

    let bit = 0;
    for (let i = 0; i < d.length && bit < need; i += 4) {
      for (let ch = 0; ch < 3 && bit < need; ch++, bit++) {
        const b = (buf[bit >> 3] >> (7 - (bit & 7))) & 1;
        d[i + ch] = (d[i + ch] & 0xFE) | b;
      }
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  /* 그림에서 심어 둔 글자를 읽는다. 없으면 null. */
  function read(imgData) {
    const d = imgData.data;
    let bit = 0;
    const byte = () => {
      let v = 0;
      for (let k = 0; k < 8; k++, bit++) {
        const i = ((bit / 3) | 0) * 4 + (bit % 3);
        if (i >= d.length) return null;
        v = (v << 1) | (d[i] & 1);
      }
      return v;
    };
    const head = [];
    for (let i = 0; i < 4; i++) {
      const b = byte();
      if (b === null) return null;
      head.push(b);
    }
    if (String.fromCharCode(...head) !== MAGIC) return null;
    const hi = byte(), lo = byte();
    if (hi === null || lo === null) return null;
    const n = (hi << 8) | lo;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const b = byte();
      if (b === null) return null;
      out[i] = b;
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(out); }
    catch (e) { return null; }
  }

  /* ── 내보내기 ─────────────────────────────────────────────────────────
     미리보기 캔버스를 건드리지 않으려고 **복사본**에 얹는다.
     (미리보기에 얹으면 다음 렌더에서 지워지거나 두 번 얹힌다)
     순서: 보이는 무늬 → 파일 속 글자. LSB 는 픽셀을 읽고 쓰므로 반드시 맨 끝. */
  function exportCanvas(src, info) {
    const c = _newCanvas(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    const cfg = load();
    visible(g, c.width, c.height, cfg);
    if (cfg.on && cfg.lsb) {
      try { stamp(c, payload(cfg, info)); }
      catch (e) { console.warn('[워터마크] 파일 속 글자 넣기 실패:', e.message); }
    }
    return c;
  }

  /* ── 되살려 보기 ──────────────────────────────────────────────────────
     무늬는 '주변보다 아주 조금 밝거나 어두운' 요철이다. 흐린 판을 빼고 그 차이를
     몇 십 배로 키우면 드러난다.

     🔴 다만 그냥 빼기만 하면 **사진 잡티·별처럼 1px짜리 알갱이가 같이 커져서**
     글자가 묻힌다(실측: 별하늘 뒷장에서 안 읽혔다). 그래서 아주 살짝 흐린 판에서
     많이 흐린 판을 빼는 **띠통과**로 간다 — 알갱이(가장 잔 것)와 배경 그라데이션
     (가장 큰 것)을 양쪽에서 걷어내고 글자 굵기 대역만 남긴다. */
  function blurGray(gray, w, h, r) {
    const tmp = new Float32Array(gray.length), out = new Float32Array(gray.length);
    const win = r * 2 + 1;
    for (let y = 0; y < h; y++) {                       // 가로
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += gray[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / win;
        sum += gray[y * w + Math.min(w - 1, x + r + 1)] - gray[y * w + Math.min(w - 1, Math.max(0, x - r))];
      }
    }
    for (let x = 0; x < w; x++) {                       // 세로
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / win;
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x];
      }
    }
    return out;
  }

  function reveal(imgData, gain = 26, radius = 4) {
    const { width: w, height: h, data: d } = imgData;
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    const fine = blurGray(gray, w, h, 1);                       // 알갱이만 뭉갠 판
    const soft = blurGray(gray, w, h, Math.max(2, radius));     // 글자까지 뭉갠 판
    const out = new ImageData(w, h);
    const o = out.data;
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      let v = 128 + (fine[p] - soft[p]) * gain;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      o[i] = o[i + 1] = o[i + 2] = v;
      o[i + 3] = 255;
    }
    return out;
  }

  /* ── 겹쳐 읽기 ────────────────────────────────────────────────────────
     사진 배경·별하늘처럼 알갱이가 많으면 되살려도 글자가 잘 안 읽힌다.
     그런데 무늬는 **같은 간격으로 계속 반복**되고 사진 알갱이는 제멋대로다.
     그래서 기울기를 되돌린 뒤 한 칸 크기로 접어 겹쳐 평균을 내면
     무늬는 그대로 쌓이고 알갱이는 서로 지워진다(잡음이 √N 배로 줄어든다).

     원본이 1080 폭이었다고 보고 간격을 지금 그림 크기에 맞춘다 —
     인스타가 1080 폭으로 내보내므로 대개 맞는다. */
  function stack(imgData, cfg, gain = 60) {
    const c = { ...DEFAULT, ...(cfg || load()) };
    const w = imgData.width, h = imgData.height;
    const band = reveal(imgData, 1, 4).data;          // 세기 1 = 띠통과만 걸어 둔 판

    const m = measure(c);
    const s = w / 1080;
    const TW = Math.max(8, Math.round(m.TW * s));
    const TH = Math.max(8, Math.round(m.TH * s) * 2);   // 줄마다 반 칸 어긋나므로 두 줄이 한 주기
    const acc = new Float32Array(TW * TH), cnt = new Float32Array(TW * TH);

    const a = (+c.angle || 0) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const cx = w / 2, cy = h / 2;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const u = dx * cos + dy * sin;                // 화면 → 무늬 자리(기울기 되돌림)
        const v = -dx * sin + dy * cos;
        const tu = Math.round(((u % TW) + TW) % TW) % TW;
        const tv = Math.round(((v % TH) + TH) % TH) % TH;
        const i = tv * TW + tu;
        acc[i] += band[(y * w + x) * 4];
        cnt[i]++;
      }
    }

    let sum = 0, n = 0;
    for (let i = 0; i < acc.length; i++) if (cnt[i]) { acc[i] /= cnt[i]; sum += acc[i]; n++; }
    const mean = n ? sum / n : 128;

    const REP = 3;                                    // 읽기 쉽게 3×3 으로 늘어놓는다
    const out = new ImageData(TW * REP, TH * REP);
    const o = out.data;
    for (let y = 0; y < TH * REP; y++) {
      for (let x = 0; x < TW * REP; x++) {
        const src = (y % TH) * TW + (x % TW);
        let val = 128 + (cnt[src] ? acc[src] - mean : 0) * gain;
        val = val < 0 ? 0 : val > 255 ? 255 : val;
        const i = (y * TW * REP + x) * 4;
        o[i] = o[i + 1] = o[i + 2] = val;
        o[i + 3] = 255;
      }
    }
    return out;
  }

  ensureLogo();

  return { DEFAULT, MAGIC, BRAND, LOGO_SRC, load, save, reset, label, payload, measure,
           onReady, pattern, visible, stamp, read, reveal, stack, exportCanvas };
})();

if (typeof module !== 'undefined') module.exports = HIDDEN;
