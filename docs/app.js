/* 뉴보대 카드뉴스 메이커 — 캔버스 렌더러 + 편집기 */
'use strict';

const W = 1080, H = 1350;
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const $ = (id) => document.getElementById(id);

/* ───────────────────────── 상태 ───────────────────────── */
const TEXT_KEYS = ['kicker', 'title', 'body', 'credit'];

function defaults() {
  const base = {
    on: true, text: '', x: 72, y: 800, size: 40, font: 'Pretendard', weight: '700',
    color: '#ffffff', accent: '#ffd400', line: 130, space: -10, opacity: 100,
    width: 86, align: 'left', shadow: 45, box: 'none', boxColor: '#e11d48'
  };
  return {
    bg: { src: '', x: 0.5, y: 0.45, zoom: 1, bright: 100, contrast: 100, sat: 100 },
    overlay: { color: '#000000', strength: 88, start: 38, top: 22 },
    layers: {
      kicker: { ...base, y: 770, size: 44, weight: '500', opacity: 92, line: 130, space: -15, width: 80 },
      title: { ...base, y: 838, size: 84, weight: '700', font: 'Gmarket Sans', line: 122, space: -16, width: 88 },
      body: { ...base, y: 1176, x: 500, size: 27, weight: '500', align: 'center', line: 152, space: -4, width: 74, opacity: 95, shadow: 30 },
      credit: { ...base, on: false, y: 1296, size: 19, weight: '400', opacity: 60, shadow: 20, line: 130 }
    },
    chev: { on: true, color: '#ffffff', x: 958, y: 1218 },
    logo: { on: false, src: '', x: 72, y: 64, size: 150 },
    paper: '#20242e',            // 사진이 없을 때의 바탕색 (스타일 모드가 바꾼다)
    deco: 'none',                // 스타일 모드 장식: none | tag | band
    decoColor: '#ff6b00',
    bands: { top: bandDefault(), bottom: bandDefault() }   // 위/아래 띠 (BREAKING NEWS 등)
  };
}

/* 위/아래 띠 한 줄의 기본값. 방송 뉴스의 속보 띠·레터헤드의 날짜 띠 같은 것.
   `repeat` 는 티커처럼 문구를 ' · ' 로 이어 폭을 채운다(한 번만 그림, 움직이지 않는다). */
function bandDefault() {
  return {
    on: false, color: '#e11d48', height: 64, text: 'BREAKING NEWS', textColor: '#ffffff',
    font: 'Gmarket Sans', weight: '700', size: 30, align: 'left', repeat: false, opacity: 100
  };
}
const BAND_KEYS = ['top', 'bottom'];

/* 동봉 서체가 실제로 갖고 있는 굵기(style.css @font-face 와 같은 표). 없는 굵기를 시키면
   브라우저가 가짜 볼드(글자를 번지게 덧그림)로 흉내 내므로 고르는 칸에서부터 막는다.
   목록에 없는 서체(시스템 글꼴)는 전 굵기를 열어 둔다. */
const FONT_WEIGHTS = {
  'Pretendard': ['400', '500', '700', '800', '900'],
  'Pretendard Black': ['900'],
  'Gmarket Sans': ['500', '700'],
  'S-Core Dream': ['500', '700', '900'],
  '검은고딕': ['400'],
  'Paperlogy': ['500', '800']
};
const WEIGHT_NAMES = { '300': '가늘게 300', '400': '보통 400', '500': '미디엄 500', '700': '볼드 700', '800': '엑스트라볼드 800', '900': '블랙 900' };
const ALL_WEIGHTS = ['300', '400', '500', '700', '800', '900'];
function weightsFor(font) { return FONT_WEIGHTS[font] || ALL_WEIGHTS; }
/** 서체가 못 내는 굵기면 가장 가까운 것으로 옮긴다(위쪽 우선). */
function snapWeight(font, w) {
  const ws = weightsFor(font);
  if (ws.includes(String(w))) return String(w);
  const n = +w;
  return ws.reduce((best, x) => (Math.abs(+x - n) < Math.abs(+best - n) ? x : best), ws[0]);
}
/** 굵기 select 의 보기를 서체에 맞게 다시 만든다. */
function fillWeightSelect(sel, font, cur) {
  const ws = weightsFor(font);
  sel.innerHTML = '';
  ws.forEach(w => {
    const o = document.createElement('option');
    o.value = w; o.textContent = WEIGHT_NAMES[w] || w;
    sel.appendChild(o);
  });
  sel.value = snapWeight(font, cur);
  return sel.value;
}

let S = defaults();
let bgImg = null, logoImg = null;
let sel = 'title';
const boxes = {};              // 히트테스트용 바운딩박스

/* ─────────────────────── 텍스트 조판 ─────────────────────── */
// **강조** 표시를 문자 단위 accent 플래그로 변환
function toChars(text) {
  const out = [];
  const re = /\*\*([\s\S]+?)\*\*/g;
  let i = 0, m;
  while ((m = re.exec(text)) !== null) {
    for (const c of text.slice(i, m.index)) out.push({ c, a: false });
    for (const c of m[1]) out.push({ c, a: true });
    i = re.lastIndex;
  }
  for (const c of text.slice(i)) out.push({ c, a: false });
  return out;
}

const widthOf = (chars) => ctx.measureText(chars.map(o => o.c).join('')).width;

function wrapLines(chars, maxW) {
  const lines = [];
  let cur = [];
  const flush = () => { lines.push(cur); cur = []; };
  for (const ch of chars) {
    if (ch.c === '\n') { flush(); continue; }
    cur.push(ch);
    if (widthOf(cur) > maxW && cur.length > 1) {
      let sp = -1;
      for (let i = cur.length - 2; i > 0; i--) if (cur[i].c === ' ') { sp = i; break; }
      if (sp > 0) {
        const rest = cur.slice(sp + 1);
        cur = cur.slice(0, sp);
        flush();
        cur = rest;
      } else {
        const last = cur.pop();
        flush();
        cur = [last];
      }
    }
  }
  flush();
  return lines.map(l => {
    while (l.length && l[0].c === ' ') l.shift();
    while (l.length && l[l.length - 1].c === ' ') l.pop();
    return l;
  });
}

/* @font-face 폰트는 실제로 쓰일 때 비로소 내려받는다. 캔버스는 CSS가 아니라서
   미리 불러두지 않으면 첫 렌더가 대체 글꼴로 그려진다. */
async function loadFonts() {
  const jobs = TEXT_KEYS.map(k => {
    const L = S.layers[k];
    return document.fonts.load(`${L.weight} ${L.size}px "${L.font}"`);
  });
  BAND_KEYS.forEach(k => {
    const B = (S.bands || {})[k];
    if (B && B.on) jobs.push(document.fonts.load(`${B.weight} ${B.size}px "${B.font}"`));
  });
  try { await Promise.all(jobs); } catch (e) { /* 없는 글꼴은 대체됨 */ }
  await document.fonts.ready;
}

function setFont(L) {
  ctx.font = `${L.weight} ${L.size}px "${L.font}", "Malgun Gothic", sans-serif`;
  ctx.letterSpacing = (L.size * L.space / 1000).toFixed(2) + 'px';
  ctx.textBaseline = 'alphabetic';
}

function layout(L) {
  setFont(L);
  const lines = wrapLines(toChars(L.text || ''), W * L.width / 100).filter(l => l.length);
  const lh = L.size * L.line / 100;
  const widths = lines.map(widthOf);
  const maxW = widths.length ? Math.max(...widths) : 0;
  let x0;
  if (L.align === 'left') x0 = L.x;
  else if (L.align === 'right') x0 = L.x - maxW;
  else x0 = L.x - maxW / 2;
  return { lines, widths, lh, maxW, x0, h: lines.length * lh };
}

function drawLayer(key) {
  const L = S.layers[key];
  boxes[key] = null;
  if (!L.on || !(L.text || '').trim()) return;
  const lay = layout(L);
  if (!lay.lines.length) return;

  const lh = lay.lh;
  const asc = L.size * 0.78;          // 첫 줄 베이스라인 보정
  ctx.save();
  ctx.globalAlpha = L.opacity / 100;

  // 글자 뒷배경(띠)
  if (L.box !== 'none') {
    ctx.fillStyle = L.boxColor;
    const padX = L.size * 0.3, padY = L.size * 0.14;
    lay.lines.forEach((ln, i) => {
      const w = lay.widths[i];
      if (!w) return;
      let lx = L.align === 'left' ? L.x : L.align === 'right' ? L.x - w : L.x - w / 2;
      const ry = L.y + i * lh + (lh - L.size) / 2 - padY;
      const rh = L.size + padY * 2;
      ctx.beginPath();
      const r = L.box === 'pill' ? rh / 2 : 0;
      ctx.roundRect(lx - padX, ry, w + padX * 2, rh, r);
      ctx.fill();
    });
  }

  if (L.shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${(L.shadow / 100).toFixed(2)})`;
    ctx.shadowBlur = L.size * 0.42;
    ctx.shadowOffsetY = L.size * 0.06;
  }
  setFont(L);

  lay.lines.forEach((ln, i) => {
    const w = lay.widths[i];
    let x = L.align === 'left' ? L.x : L.align === 'right' ? L.x - w : L.x - w / 2;
    const y = L.y + i * lh + asc;
    // 같은 색끼리 묶어서 출력
    let g = 0;
    while (g < ln.length) {
      let e = g;
      while (e < ln.length && ln[e].a === ln[g].a) e++;
      const seg = ln.slice(g, e).map(o => o.c).join('');
      ctx.fillStyle = ln[g].a ? L.accent : L.color;
      ctx.fillText(seg, x, y);
      x += ctx.measureText(seg).width;
      g = e;
    }
  });
  ctx.restore();

  const pad = L.size * 0.25;
  boxes[key] = { x0: lay.x0 - pad, y0: L.y - pad, x1: lay.x0 + lay.maxW + pad, y1: L.y + lay.h + pad };
}

/* ─────────────────────── 배경 / 장식 ─────────────────────── */
function bgRect() {
  if (!bgImg) return null;
  const s = Math.max(W / bgImg.naturalWidth, H / bgImg.naturalHeight) * S.bg.zoom;
  const dw = bgImg.naturalWidth * s, dh = bgImg.naturalHeight * s;
  return { dw, dh, dx: W / 2 - dw * S.bg.x, dy: H / 2 - dh * S.bg.y };
}

function clampBg() {
  const r = bgRect();
  if (!r) return;
  const mx = W / (2 * r.dw), my = H / (2 * r.dh);
  if (r.dw >= W) S.bg.x = Math.min(1 - mx, Math.max(mx, S.bg.x));
  if (r.dh >= H) S.bg.y = Math.min(1 - my, Math.max(my, S.bg.y));
}

const hex2rgb = (h) => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

function drawChevron() {
  if (!S.chev.on) { boxes.chev = null; return; }
  const { x, y } = S.chev, s = 26;
  ctx.save();
  ctx.strokeStyle = S.chev.color;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 10;
  for (const off of [-14, 8]) {
    ctx.beginPath();
    ctx.moveTo(x + off, y - s / 2);
    ctx.lineTo(x + off + s / 2, y);
    ctx.lineTo(x + off, y + s / 2);
    ctx.stroke();
  }
  ctx.restore();
  boxes.chev = { x0: x - 30, y0: y - 26, x1: x + 34, y1: y + 26 };
}

/* 스타일 모드 장식 — 글자·로고보다 먼저, 오버레이 다음에 그린다 */
function drawDeco() {
  if (!S.deco || S.deco === 'none') return;
  ctx.save();
  ctx.fillStyle = S.decoColor || '#ff6b00';
  if (S.deco === 'tag') {
    ctx.fillRect(72, 96, 120, 14);           // 왼쪽 위 짧고 굵은 브랜드 바
  } else if (S.deco === 'band') {
    // 위/아래 띠(bands)가 켜진 쪽은 같은 자리라 겹친다 — 그쪽 얇은 띠는 숨긴다.
    const bandOn = k => !!(S.bands && S.bands[k] && S.bands[k].on);
    if (!bandOn('top')) ctx.fillRect(0, 0, W, 16);        // 위아래 풀폭 띠 (레터헤드 결)
    if (!bandOn('bottom')) ctx.fillRect(0, H - 16, W, 16);
  }
  ctx.restore();
}

/* 위/아래 띠 — 배경·오버레이·장식 다음, 글자 앞에 그린다(글자가 띠 위에 올 수 있게).
   글자는 띠의 세로 가운데. repeat 면 문구를 ' · ' 로 이어 붙여 폭을 채운다(티커처럼,
   단 움직이지 않는 정지 화면). 반환값은 히트테스트가 아니라 시험용 정보. */
function bandString(B) {
  const t = (B.text || '').trim();
  if (!t) return '';
  if (!B.repeat) return t;
  const sep = '  ·  ';
  let s = t;
  // 한 번에 폭을 넘길 때까지 잇는다(문구가 아주 짧아도 무한 루프가 되지 않게 200회 상한)
  for (let i = 0; i < 200 && ctx.measureText(s).width < W; i++) s += sep + t;
  return s;
}
function drawBands() {
  boxes.bandTop = boxes.bandBottom = null;
  const bands = S.bands || {};
  BAND_KEYS.forEach(k => {
    const B = bands[k];
    if (!B || !B.on) return;
    const h = Math.max(24, Math.min(140, +B.height || 64));
    const y0 = k === 'top' ? 0 : H - h;
    ctx.save();
    ctx.globalAlpha = (B.opacity == null ? 100 : B.opacity) / 100;
    ctx.fillStyle = B.color || '#e11d48';
    ctx.fillRect(0, y0, W, h);
    const size = Math.max(10, Math.min(h - 6, +B.size || 30));
    ctx.font = `${B.weight || '700'} ${size}px "${B.font || 'Gmarket Sans'}", "Malgun Gothic", sans-serif`;
    ctx.letterSpacing = '0px';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = B.textColor || '#ffffff';
    const s = bandString(B);
    if (s) {
      const pad = 40;
      const tw = ctx.measureText(s).width;
      let x = pad;
      if (B.repeat) x = 0;
      else if (B.align === 'center') x = (W - tw) / 2;
      else if (B.align === 'right') x = W - pad - tw;
      // 띠 밖으로 새지 않게 잘라 그린다
      ctx.beginPath(); ctx.rect(0, y0, W, h); ctx.clip();
      ctx.fillText(s, x, y0 + h / 2 + size * 0.04);
    }
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  });
}

function drawLogo() {
  boxes.logo = null;
  if (!S.logo.on || !logoImg) return;
  const w = S.logo.size;
  const h = w * logoImg.naturalHeight / logoImg.naturalWidth;
  ctx.drawImage(logoImg, S.logo.x, S.logo.y, w, h);
  boxes.logo = { x0: S.logo.x, y0: S.logo.y, x1: S.logo.x + w, y1: S.logo.y + h };
}

let noHint = false;          // 내보내기 중에는 「사진을 끌어다…」 안내를 그리지 않는다
function render() {
  // 시리즈의 '뒷장' 이 떠 있으면 앞장 렌더러가 그 위를 덮으면 안 된다 — deck.js 가 대신 그린다
  if (window.DECK && DECK.isOutroActive()) { DECK.renderOutro(); return; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const paper = S.paper || '#20242e';
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);

  if (bgImg) {
    const r = bgRect();
    ctx.save();
    ctx.filter = `brightness(${S.bg.bright}%) contrast(${S.bg.contrast}%) saturate(${S.bg.sat}%)`;
    ctx.drawImage(bgImg, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
  } else {
    const [pr, pg, pb] = hex2rgb(paper);
    ctx.fillStyle = (pr * 0.299 + pg * 0.587 + pb * 0.114) > 140 ? '#b7bcc6' : '#2b3040';
    ctx.font = '500 30px Pretendard, "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    if (!noHint) ctx.fillText('사진을 끌어다 놓거나 왼쪽에서 고르세요', W / 2, H / 2);
    ctx.textAlign = 'left';
  }

  const [r0, g0, b0] = hex2rgb(S.overlay.color);
  const a = S.overlay.strength / 100;
  const gb = ctx.createLinearGradient(0, H * S.overlay.start / 100, 0, H);
  gb.addColorStop(0, `rgba(${r0},${g0},${b0},0)`);
  gb.addColorStop(0.45, `rgba(${r0},${g0},${b0},${(a * 0.45).toFixed(3)})`);
  gb.addColorStop(1, `rgba(${r0},${g0},${b0},${a.toFixed(3)})`);
  ctx.fillStyle = gb;
  ctx.fillRect(0, 0, W, H);

  if (S.overlay.top > 0) {
    const gt = ctx.createLinearGradient(0, 0, 0, H * 0.38);
    gt.addColorStop(0, `rgba(${r0},${g0},${b0},${(S.overlay.top / 100).toFixed(3)})`);
    gt.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
    ctx.fillStyle = gt;
    ctx.fillRect(0, 0, W, H * 0.38);
  }

  drawDeco();
  drawBands();
  drawLogo();
  TEXT_KEYS.forEach(drawLayer);
  drawChevron();
  // 한국대학생포럼 표시를 눈에 안 보이게 깔아 둔다 (설정은 '워터마크' 화면)
  if (typeof HIDDEN !== 'undefined') HIDDEN.pattern(ctx, W, H);
  saveLocal();
  // 시리즈 편집기(deck.js)가 있으면 지금 장의 작은 그림을 갱신한다
  if (window.DECK) DECK.afterRender();
}

/* ─────────────────────── 이미지 로드 ─────────────────────── */
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    /* 폰판: 남의 사진을 캔버스에 올리려면 CORS 표시가 있어야 한다.
       없으면 그려지긴 해도 저장(toDataURL)에서 통째로 막힌다. */
    if (!/^(data:|blob:)/.test(src)) im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('이미지를 불러오지 못했습니다'));
    im.src = src;
  });
}

/* 폰판: 서버가 없으니 사진도 대리인을 하나 거친다.

   🔴 언론사 사진 서버(imgnews.pstatic.net 등)는 CORS 헤더를 주지 않는다. 아래
      loadImage() 가 crossOrigin='anonymous' 를 붙이므로 브라우저가 **아예 거부**한다
      — 폰에서 기사 사진이 안 뜨던 정체가 이것이다. crossOrigin 을 떼면 보이기는
      하나 캔버스가 오염돼 저장이 통째로 막히므로, 떼는 대신 CORS 를 붙여 주는
      곳(wsrv.nl)을 거친다. 실측: 200 · CORS=* · 원본 그대로의 PNG.

   🔴 이미 CORS 를 주는 곳(위키미디어·Openverse)은 **그냥 둔다.** 전부 대리인에게
      맡기면, 지금 잘 되는 사진 검색까지 남의 서비스와 함께 죽는다.

   🔴 두 번 감싸면 안 된다 — app.js 안에서 proxy() 가 겹쳐 불릴 수 있고(1090줄 주석),
      저장된 상태를 다시 읽을 때도 겹친다. 이미 감싼 주소는 그대로 돌려준다. */
const IMG_DIRECT = /(^|\.)(wikimedia\.org|wikipedia\.org|openverse\.org)$/i;
const IMG_PROXY = 'https://wsrv.nl/?url=';
const proxy = (url) => {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return u;          // data: · blob: · 같은 폴더 파일
  if (u.startsWith(IMG_PROXY)) return u;           // 이미 감쌌다
  try { if (IMG_DIRECT.test(new URL(u).hostname)) return u; } catch (e) { return u; }
  return IMG_PROXY + encodeURIComponent(u);
};

async function setBg(src, resetView = true) {
  try {
    bgImg = await loadImage(src);
    S.bg.src = src.startsWith('data:') || src.startsWith('blob:') ? '' : src;
    if (resetView) { S.bg.x = 0.5; S.bg.y = 0.45; S.bg.zoom = 1; }
    clampBg();
    render();
    document.querySelectorAll('.thumbs img').forEach(t => t.classList.toggle('on', t.dataset.full === src));
  } catch (e) {
    msg($('fetchMsg'), '사진을 불러오지 못했습니다: ' + e.message, 'err');
  }
}

/* ─────────────────────── 마우스 조작 ─────────────────────── */
const HIT_ORDER = ['credit', 'body', 'title', 'kicker', 'chev', 'logo'];
let drag = null;

function toCanvas(ev) {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height };
}

function hit(p) {
  for (const k of HIT_ORDER) {
    const b = boxes[k];
    if (b && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) return k;
  }
  return null;
}

cv.addEventListener('pointerdown', (ev) => {
  if (window.DECK && DECK.isOutroActive()) return;      // 뒷장은 여기서 안 만진다
  const p = toCanvas(ev);
  const k = hit(p);
  cv.setPointerCapture(ev.pointerId);
  cv.classList.add('dragging');
  if (k) {
    if (TEXT_KEYS.includes(k)) selectLayer(k);
    const o = k === 'chev' ? S.chev : k === 'logo' ? S.logo : S.layers[k];
    drag = { mode: 'obj', o, ox: o.x - p.x, oy: o.y - p.y };
  } else {
    drag = { mode: 'bg', px: p.x, py: p.y };
  }
});

cv.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const p = toCanvas(ev);
  if (drag.mode === 'obj') {
    drag.o.x = Math.round(p.x + drag.ox);
    drag.o.y = Math.round(p.y + drag.oy);
  } else if (bgImg) {
    const r = bgRect();
    S.bg.x -= (p.x - drag.px) / r.dw;
    S.bg.y -= (p.y - drag.py) / r.dh;
    drag.px = p.x; drag.py = p.y;
    clampBg();
  }
  render();
});

const endDrag = () => { drag = null; cv.classList.remove('dragging'); };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

cv.addEventListener('wheel', (ev) => {
  if (!bgImg || (window.DECK && DECK.isOutroActive())) return;
  ev.preventDefault();
  const p = toCanvas(ev);
  const r = bgRect();
  const u = (p.x - r.dx) / r.dw, v = (p.y - r.dy) / r.dh;
  S.bg.zoom = Math.min(6, Math.max(1, S.bg.zoom * (ev.deltaY < 0 ? 1.09 : 1 / 1.09)));
  const r2 = bgRect();
  S.bg.x = (W / 2 - p.x) / r2.dw + u;
  S.bg.y = (H / 2 - p.y) / r2.dh + v;
  clampBg();
  render();
}, { passive: false });

document.addEventListener('keydown', (ev) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
  if (window.DECK && DECK.isOutroActive()) return;
  const d = ev.shiftKey ? 10 : 2;
  const map = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
  if (!map[ev.key]) return;
  ev.preventDefault();
  const L = S.layers[sel];
  L.x += map[ev.key][0];
  L.y += map[ev.key][1];
  render();
});

/* 드래그&드롭 / 붙여넣기 */
const dz = $('dropzone');
['dragenter', 'dragover'].forEach(e =>
  dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(e =>
  dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.remove('over'); }));

dz.addEventListener('drop', (ev) => {
  const f = [...(ev.dataTransfer.files || [])].find(f => f.type.startsWith('image/'));
  if (f) return setBg(URL.createObjectURL(f));
  const url = ev.dataTransfer.getData('text/uri-list') || ev.dataTransfer.getData('text/plain');
  if (url && /^https?:\/\//.test(url.trim())) setBg(proxy(url.trim()));
});

document.addEventListener('paste', (ev) => {
  if (/^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) return;
  for (const it of ev.clipboardData.items) {
    if (it.type.startsWith('image/')) {
      setBg(URL.createObjectURL(it.getAsFile()));
      ev.preventDefault();
      return;
    }
  }
});

/* ─────────────────────── 우측 컨트롤 ─────────────────────── */
const NAMES = { kicker: '후킹 문구', title: '제목', body: '요약문', credit: '출처' };

function selectLayer(k) {
  sel = k;
  $('selInfo').textContent = '선택: ' + NAMES[k];
  $('selName').textContent = NAMES[k];
  syncControls();
}

function syncControls() {
  const L = S.layers[sel];
  $('tFont').value = L.font;
  // 굵기 보기는 서체가 낼 수 있는 것만 — 못 내는 굵기가 상태에 있으면 가까운 것으로 옮긴다
  L.weight = fillWeightSelect($('tWeight'), L.font, L.weight);
  $('tSize').value = L.size;
  $('tColor').value = L.color;
  $('tAccent').value = L.accent;
  $('tLine').value = L.line;
  $('tSpace').value = L.space;
  $('tOpacity').value = L.opacity;
  $('tWidth').value = L.width;
  $('tShadow').value = L.shadow;
  $('tBoxColor').value = L.boxColor;
  segSet('tAlign', L.align);
  segSet('tBox', L.box);
  updateVals();
}

function segSet(id, v) {
  $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

function updateVals() {
  document.querySelectorAll('.ctl').forEach(c => {
    const r = c.querySelector('input[type=range]'), v = c.querySelector('.val');
    if (r && v) v.textContent = r.value;
  });
}

function bindRange(id, apply) {
  $(id).addEventListener('input', () => { apply(+$(id).value); updateVals(); render(); });
}

[['tSize', 'size'], ['tLine', 'line'], ['tSpace', 'space'],
['tOpacity', 'opacity'], ['tWidth', 'width'], ['tShadow', 'shadow']]
  .forEach(([id, key]) => bindRange(id, v => { S.layers[sel][key] = v; }));

[['tFont', 'font'], ['tWeight', 'weight'], ['tColor', 'color'],
['tAccent', 'accent'], ['tBoxColor', 'boxColor']]
  .forEach(([id, key]) => $(id).addEventListener('input', async () => {
    S.layers[sel][key] = $(id).value;
    // 서체를 바꾸면 굵기 보기도 그 서체 것으로(가짜 볼드 방지)
    if (key === 'font') S.layers[sel].weight = fillWeightSelect($('tWeight'), $(id).value, S.layers[sel].weight);
    render();
    if (key === 'font' || key === 'weight') { await loadFonts(); render(); }
  }));

['tAlign', 'tBox'].forEach(id => $(id).addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  S.layers[sel][id === 'tAlign' ? 'align' : 'box'] = b.dataset.v;
  segSet(id, b.dataset.v);
  render();
}));

bindRange('ovStrength', v => S.overlay.strength = v);
bindRange('ovStart', v => S.overlay.start = v);
bindRange('ovTop', v => S.overlay.top = v);
$('ovColor').addEventListener('input', () => { S.overlay.color = $('ovColor').value; render(); });
bindRange('imgBright', v => S.bg.bright = v);
bindRange('imgContrast', v => S.bg.contrast = v);
bindRange('imgSat', v => S.bg.sat = v);
$('btnFitCover').addEventListener('click', () => {
  S.bg.x = 0.5; S.bg.y = 0.45; S.bg.zoom = 1;
  S.bg.bright = S.bg.contrast = S.bg.sat = 100;
  ['imgBright', 'imgContrast', 'imgSat'].forEach(i => $(i).value = 100);
  updateVals(); render();
});

$('chevOn').addEventListener('change', () => { S.chev.on = $('chevOn').checked; render(); });
$('chevColor').addEventListener('input', () => { S.chev.color = $('chevColor').value; render(); });
bindRange('logoSize', v => S.logo.size = v);
$('logoSel').addEventListener('change', async () => {
  const v = $('logoSel').value;
  S.logo.src = v;
  S.logo.on = !!v;
  logoImg = v ? await loadImage(v).catch(() => null) : null;
  render();
});

/* ─────────────────────── 위/아래 띠 패널 ───────────────────────
   위·아래 두 줄을 같은 틀로 만든다(패널 언어는 .ctl / .seg / range 그대로).
   서체 보기는 '선택한 글자' 의 서체 select 를 그대로 복제해 동봉 6종이 빠지지 않게 한다. */
const BAND_NAMES = { top: '위 띠', bottom: '아래 띠' };
function buildBandPanel() {
  const root = $('bands');
  if (!root) return;
  const fontOpts = $('tFont').innerHTML;
  BAND_KEYS.forEach(k => {
    const box = document.createElement('div');
    box.className = 'band-row';
    box.dataset.band = k;
    box.innerHTML = `
      <div class="ctl"><label><b>${BAND_NAMES[k]}</b></label>
        <input id="bd_${k}_on" type="checkbox"> <span class="hint">켜기</span>
        <span style="flex:1"></span>
        <span class="hint">반복</span> <input id="bd_${k}_repeat" type="checkbox" title="문구를 ' · ' 로 이어 폭을 채웁니다(티커처럼)"></div>
      <div class="ctl"><label>문구</label><input id="bd_${k}_text" type="text" placeholder="BREAKING NEWS · 속보 · 오늘의 뉴스"></div>
      <div class="ctl"><label>색 / 글자색</label>
        <input id="bd_${k}_color" type="color" value="#e11d48">
        <input id="bd_${k}_textColor" type="color" value="#ffffff"></div>
      <div class="ctl"><label>높이</label><input id="bd_${k}_height" type="range" min="24" max="140" value="64"><span class="val"></span></div>
      <div class="ctl"><label>서체</label><select id="bd_${k}_font">${fontOpts}</select></div>
      <div class="ctl"><label>굵기</label><select id="bd_${k}_weight"></select></div>
      <div class="ctl"><label>크기</label><input id="bd_${k}_size" type="range" min="12" max="120" value="30"><span class="val"></span></div>
      <div class="ctl"><label>정렬</label>
        <div class="seg" id="bd_${k}_align">
          <button data-v="left">왼쪽</button><button data-v="center">가운데</button><button data-v="right">오른쪽</button>
        </div></div>
      <div class="ctl"><label>투명도</label><input id="bd_${k}_opacity" type="range" min="10" max="100" value="100"><span class="val"></span></div>`;
    root.appendChild(box);

    const B = () => S.bands[k];
    $(`bd_${k}_on`).addEventListener('change', async () => { B().on = $(`bd_${k}_on`).checked; syncBandTexts(); render(); await loadFonts(); render(); });
    $(`bd_${k}_repeat`).addEventListener('change', () => { B().repeat = $(`bd_${k}_repeat`).checked; render(); });
    $(`bd_${k}_text`).addEventListener('input', () => { B().text = $(`bd_${k}_text`).value; syncBandTexts(); render(); });
    $(`bd_${k}_color`).addEventListener('input', () => { B().color = $(`bd_${k}_color`).value; render(); });
    $(`bd_${k}_textColor`).addEventListener('input', () => { B().textColor = $(`bd_${k}_textColor`).value; render(); });
    ['height', 'size', 'opacity'].forEach(p =>
      $(`bd_${k}_${p}`).addEventListener('input', () => { B()[p] = +$(`bd_${k}_${p}`).value; updateVals(); render(); }));
    $(`bd_${k}_font`).addEventListener('input', async () => {
      B().font = $(`bd_${k}_font`).value;
      B().weight = fillWeightSelect($(`bd_${k}_weight`), B().font, B().weight);
      render(); await loadFonts(); render();
    });
    $(`bd_${k}_weight`).addEventListener('input', async () => { B().weight = $(`bd_${k}_weight`).value; render(); await loadFonts(); render(); });
    $(`bd_${k}_align`).addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      B().align = b.dataset.v;
      segSet(`bd_${k}_align`, b.dataset.v);
      render();
    });
  });
}

function syncBandControls() {
  syncBandTexts();
  if (!$('bands')) return;
  BAND_KEYS.forEach(k => {
    const B = S.bands[k];
    if (!$(`bd_${k}_on`)) return;
    $(`bd_${k}_on`).checked = !!B.on;
    $(`bd_${k}_repeat`).checked = !!B.repeat;
    $(`bd_${k}_text`).value = B.text || '';
    $(`bd_${k}_color`).value = B.color;
    $(`bd_${k}_textColor`).value = B.textColor;
    $(`bd_${k}_height`).value = B.height;
    $(`bd_${k}_size`).value = B.size;
    $(`bd_${k}_opacity`).value = B.opacity == null ? 100 : B.opacity;
    $(`bd_${k}_font`).value = B.font;
    B.weight = fillWeightSelect($(`bd_${k}_weight`), B.font, B.weight);
    segSet(`bd_${k}_align`, B.align || 'left');
  });
  updateVals();
}

/* 프리셋 4개 — 자주 쓰는 띠를 한 번에. 날짜는 오늘 것을 넣는다. */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};
const BAND_PRESETS = {
  breaking_kr: () => { Object.assign(S.bands.top, bandDefault(), { on: true, color: '#e11d48', textColor: '#ffffff', text: '속보', font: 'Gmarket Sans', weight: '700', size: 34, height: 68, align: 'left', repeat: false }); },
  breaking_en: () => { Object.assign(S.bands.top, bandDefault(), { on: true, color: '#111111', textColor: '#ffffff', text: 'BREAKING NEWS', font: 'Gmarket Sans', weight: '700', size: 30, height: 64, align: 'left', repeat: true }); },
  date: () => { Object.assign(S.bands.bottom, bandDefault(), { on: true, color: '#15181f', textColor: '#ffffff', text: '오늘의 뉴스 · ' + todayStr(), font: 'Pretendard', weight: '500', size: 26, height: 56, align: 'center', repeat: false }); },
  off: () => { S.bands.top.on = false; S.bands.bottom.on = false; }
};
if ($('bandPresets')) {
  $('bandPresets').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-preset]');
    if (!b || !BAND_PRESETS[b.dataset.preset]) return;
    BAND_PRESETS[b.dataset.preset]();
    syncBandControls();
    render(); await loadFonts(); render();
  });
}
buildBandPanel();

/* ────────── 왼쪽 「2. 문구 고르기」 의 띠 문구 칸 ──────────
   띠 글자(어피티 MONEY LETTER · CNBC BREAKING NEWS …)는 브랜드 토큰이 넣어 주는데,
   고치려면 오른쪽 디자인 패널을 끝까지 내려가야 했다. 제목·요약문과 같은 자리에서
   바로 고치도록 왼쪽에도 칸을 뒀다 — 양쪽은 같은 S.bands[k].text 를 본다. */
const BAND_TA = { top: 'txtBandTop', bottom: 'txtBandBottom' };

function syncBandTexts() {
  BAND_KEYS.forEach(k => {
    const el = $(BAND_TA[k]);
    if (!el) return;
    const B = (S.bands || {})[k] || {};
    if (document.activeElement !== el) el.value = B.text || '';
    const btn = document.querySelector(`[data-band-toggle="${k}"]`);
    if (btn) {
      btn.classList.toggle('off', !B.on);
      btn.textContent = B.on ? '표시' : '숨김';
    }
  });
}

BAND_KEYS.forEach(k => {
  const el = $(BAND_TA[k]);
  if (!el) return;
  el.addEventListener('input', async () => {
    const B = S.bands[k];
    B.text = el.value;
    // 꺼진 띠에 글자를 치면 아무 일도 안 일어나 답답하다 — 글자가 생기면 켜 준다.
    const turnedOn = !B.on && el.value.trim() !== '';
    if (turnedOn) B.on = true;
    if ($(`bd_${k}_text`)) $(`bd_${k}_text`).value = el.value;
    if ($(`bd_${k}_on`)) $(`bd_${k}_on`).checked = B.on;
    syncBandTexts();
    render();
    if (turnedOn) { await loadFonts(); render(); }
  });
});

document.querySelectorAll('[data-band-toggle]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const k = btn.dataset.bandToggle;
    if (!S.bands || !S.bands[k]) return;
    S.bands[k].on = !S.bands[k].on;
    if ($(`bd_${k}_on`)) $(`bd_${k}_on`).checked = S.bands[k].on;
    syncBandTexts();
    render(); await loadFonts(); render();
  });
});
syncBandTexts();

/* 텍스트 입력 */
const TA = { kicker: 'txtKicker', title: 'txtTitle', body: 'txtBody', credit: 'txtCredit' };
Object.entries(TA).forEach(([k, id]) => {
  $(id).addEventListener('input', () => { S.layers[k].text = $(id).value; render(); });
  $(id).addEventListener('focus', () => selectLayer(k));
});

document.querySelectorAll('[data-toggle]').forEach(b => {
  b.addEventListener('click', () => {
    const k = b.dataset.toggle;
    S.layers[k].on = !S.layers[k].on;
    b.classList.toggle('off', !S.layers[k].on);
    b.textContent = S.layers[k].on ? '표시' : '숨김';
    render();
  });
});

/* ─────────────────────── 스타일 모드 ───────────────────────
   잘나가는 카드뉴스 계정들의 결을 통째로 입힌다 — 글꼴·색·장식·바탕까지.
   색은 2026-08-12 로고·아바타에서 실측: 뉴닉 #ff6b00 / 어피티 #ff441f /
   스브스뉴스 #0050f8 / 크랩 #f80090+#40d0f8 / 캐릿 #f8a800 / 토스 #3182f6.
   (색만 바꾸는 '색 테마'와 달리 글꼴·자간·박스·그림자를 함께 정한다) */
/* pure 판 — 스타일 모드 없는 기본 디자인 전용. 값은 /api/config.js 가 app.js 보다
   먼저 (동기로) 넣어 준다. 상태 저장 열쇠도 갈라 둔다 — 두 판을 오가도 본판에서
   입힌 모드의 글꼴·장식이 pure 판으로 새어 들어오지 않게. */
const PURE = !!(window.NB_CONFIG && window.NB_CONFIG.pure);
const STATE_KEY = PURE ? 'nb_state_pure' : 'nb_state';

const STYLES = [
  {
    brand: 'newneek', aliases: ['newnik', 'neek'], n: '뉴닉풍', hint: '흰 종이 · 오렌지 포인트 · 지마켓 산스',
    paper: '#ffffff', ov: { color: '#ffffff', strength: 94, start: 26, top: 0 },
    deco: 'tag', decoColor: '#ff6b00', chev: '#15181f',
    bt: '#ffffff', btx: '#15181f', bd: '#ff6b00',
    L: {
      kicker: { font: 'Gmarket Sans', weight: '500', size: 36, color: '#ffffff', accent: '#ffe8d6', box: 'pill', boxColor: '#ff6b00', shadow: 0, space: -6 },
      title: { font: 'Gmarket Sans', weight: '700', size: 82, color: '#15181f', accent: '#ff6b00', box: 'none', shadow: 0, space: -16, line: 124 },
      body: { font: 'Pretendard', weight: '500', size: 27, color: '#3f4550', accent: '#ff6b00', box: 'none', shadow: 0 },
      credit: { font: 'Pretendard', weight: '400', color: '#9aa0ab', accent: '#ff6b00', box: 'none', shadow: 0 }
    }
  },
  {
    brand: 'subusu', aliases: ['sbsnews', 'sbs', 'subusunews'], n: '스브스뉴스풍', hint: '사진 꽉 채움 · 파란 배지 · 검은고딕 초대형',
    paper: '#101018', ov: { color: '#000000', strength: 92, start: 34, top: 26 },
    deco: 'none', decoColor: '#0050f8', chev: '#ffffff',
    bt: '#0050f8', btx: '#ffffff', bd: '#0050f8',
    L: {
      kicker: { font: 'Pretendard', weight: '700', size: 38, color: '#ffffff', accent: '#ffd400', box: 'bar', boxColor: '#0050f8', shadow: 0, space: -8 },
      title: { font: '검은고딕', weight: '400', size: 96, color: '#ffffff', accent: '#ffd400', box: 'none', shadow: 55, space: 0, line: 116 },
      body: { font: 'Pretendard', weight: '500', size: 27, color: '#ffffff', accent: '#ffd400', box: 'none', shadow: 30 },
      credit: { font: 'Pretendard', weight: '400', color: '#ffffff', accent: '#ffd400', box: 'none', shadow: 20 }
    }
  },
  {
    brand: 'uppity', aliases: ['uppity_moneyletter', 'moneyletter'], n: '어피티풍', hint: '레터헤드 레드 띠 · 에스코어 드림',
    paper: '#fffdf8', ov: { color: '#fffdf8', strength: 94, start: 24, top: 0 },
    deco: 'band', decoColor: '#ff441f', chev: '#15181f',
    bt: '#fffdf8', btx: '#ff441f', bd: '#ff441f',
    L: {
      kicker: { font: 'S-Core Dream', weight: '700', size: 36, color: '#ff441f', accent: '#ff441f', box: 'none', boxColor: '#ff441f', shadow: 0, space: -4 },
      title: { font: 'S-Core Dream', weight: '900', size: 78, color: '#15181f', accent: '#ff441f', box: 'none', shadow: 0, space: -12, line: 128 },
      body: { font: 'Pretendard', weight: '500', size: 27, color: '#3f4550', accent: '#ff441f', box: 'none', shadow: 0 },
      credit: { font: 'Pretendard', weight: '400', color: '#9aa0ab', accent: '#ff441f', box: 'none', shadow: 0 }
    }
  },
  {
    brand: 'klab', aliases: ['crab', 'kraeb', 'kbs_klab'], n: '크랩풍', hint: '먹빛 · 마젠타 스티커 · 시안 강조',
    paper: '#0b0b12', ov: { color: '#0b0b12', strength: 92, start: 34, top: 24 },
    deco: 'none', decoColor: '#f80090', chev: '#40d0f8',
    bt: '#0b0b12', btx: '#f80090', bd: '#f80090',
    L: {
      kicker: { font: 'Gmarket Sans', weight: '500', size: 36, color: '#ffffff', accent: '#ffffff', box: 'pill', boxColor: '#f80090', shadow: 0, space: -6 },
      title: { font: 'Gmarket Sans', weight: '700', size: 86, color: '#ffffff', accent: '#40d0f8', box: 'none', shadow: 50, space: -14, line: 122 },
      body: { font: 'Pretendard', weight: '500', size: 27, color: '#e8eaee', accent: '#40d0f8', box: 'none', shadow: 30 },
      credit: { font: 'Pretendard', weight: '400', color: '#c8cdd6', accent: '#40d0f8', box: 'none', shadow: 20 }
    }
  },
  {
    brand: 'careet', aliases: ['carrot', 'univ_tomorrow'], n: '캐릿풍', hint: '앰버 스티커 · 페이퍼로지',
    paper: '#fffaf0', ov: { color: '#fffaf0', strength: 94, start: 26, top: 0 },
    deco: 'tag', decoColor: '#f8a800', chev: '#15181f',
    bt: '#f8a800', btx: '#15181f', bd: '#f8a800',
    L: {
      kicker: { font: 'Paperlogy', weight: '800', size: 36, color: '#15181f', accent: '#15181f', box: 'pill', boxColor: '#f8a800', shadow: 0, space: -4 },
      title: { font: 'Paperlogy', weight: '800', size: 82, color: '#15181f', accent: '#e09000', box: 'none', shadow: 0, space: -14, line: 124 },
      body: { font: 'Pretendard', weight: '500', size: 27, color: '#3f4550', accent: '#e09000', box: 'none', shadow: 0 },
      credit: { font: 'Pretendard', weight: '400', color: '#9aa0ab', accent: '#e09000', box: 'none', shadow: 0 }
    }
  },
  {
    brand: 'toss', aliases: ['tossinvest', 'toss_securities', 'tosssecurities'], n: '토스풍', hint: '여백 · 블루 한 점 · 프리텐다드',
    paper: '#ffffff', ov: { color: '#ffffff', strength: 95, start: 22, top: 0 },
    deco: 'none', decoColor: '#3182f6', chev: '#191f28',
    bt: '#ffffff', btx: '#3182f6', bd: '#3182f6',
    L: {
      kicker: { font: 'Pretendard', weight: '700', size: 38, color: '#3182f6', accent: '#3182f6', box: 'none', boxColor: '#3182f6', shadow: 0, space: -10 },
      title: { font: 'Pretendard Black', weight: '900', size: 84, color: '#191f28', accent: '#3182f6', box: 'none', shadow: 0, space: -30, line: 122 },
      body: { font: 'Pretendard', weight: '500', size: 27, color: '#4e5968', accent: '#3182f6', box: 'none', shadow: 0 },
      credit: { font: 'Pretendard', weight: '400', color: '#8b95a1', accent: '#3182f6', box: 'none', shadow: 0 }
    }
  }
];
/* ── 브랜드 토큰(static/brands.js) 덮어쓰기 ──────────────────────────────
   `브랜드_동기화.py` 가 바탕화면 `ai_활용\<브랜드> style\design.md` §9 의 JSON 을 모아
   `window.BRAND_STYLES` 로 내려 준다(정적 파일 — 앱은 바탕화면을 읽지 않는다).
   같은 brand 키면 내장 항목을 덮고, 없는 브랜드는 뒤에 붙는다. 파일이 없거나 비어도
   그대로 돈다. 항목 모양은 design.md §9 의 `newbodae` 덩어리(brand·label 포함). */
const BUILTIN_N = STYLES.length;
function brandToStyle(raw) {
  const nb = raw.newbodae || raw;                       // 통째로 온 것도, newbodae 만 온 것도 받는다
  const st = {
    brand: raw.brand, n: raw.label || raw.n || raw.brand, hint: nb.hint || '',
    paper: nb.paper, ov: nb.overlay || nb.ov, deco: nb.deco || 'none', decoColor: nb.decoColor,
    chev: nb.chev, L: nb.L || {}, bands: nb.bands, group: raw.group || nb.group || ''
  };
  const btn = nb.button || {};
  st.bt = btn.bg || nb.bt || st.paper || '#2b303c';
  st.btx = btn.text || nb.btx || '#e8eaee';
  st.bd = btn.border || nb.bd || st.decoColor || '#3a4152';
  return st;
}
function mergeBrandStyles() {
  const list = Array.isArray(window.BRAND_STYLES) ? window.BRAND_STYLES : [];
  let over = 0, added = 0;
  list.forEach(raw => {
    if (!raw || !raw.brand) return;
    let st;
    try { st = brandToStyle(raw); } catch (e) { return; }
    if (!st.paper || !st.L) return;
    // brand 키가 같거나(별칭 포함), 한글 표기가 내장 이름과 겹치면 같은 브랜드로 본다
    //   (예: '토스증권' 토큰 ↔ 내장 '토스풍', 'subusu' ↔ '스브스뉴스풍')
    const same = x => {
      if (x.brand === st.brand || (x.aliases || []).includes(st.brand)) return true;
      const base = (x.n || '').replace(/풍$/, '');
      const nm = String(st.n || '');
      return !!base && !!nm && (nm.startsWith(base) || base.startsWith(nm));
    };
    const i = STYLES.findIndex(same);
    if (i >= 0) {
      // 내장값 위에 덮는다 — 토큰이 빠뜨린 칸은 내장값이 남는다. 단추 이름(n)은 내장 것을 지킨다.
      const base = STYLES[i];
      const L = {};
      TEXT_KEYS.forEach(k => { L[k] = { ...(base.L[k] || {}), ...(st.L[k] || {}) }; });
      STYLES[i] = { ...base, ...st, n: base.n, brand: base.brand, aliases: base.aliases,
                    hint: st.hint || base.hint, ov: { ...base.ov, ...(st.ov || {}) }, L, bands: st.bands || base.bands };
      over++;
    } else {
      STYLES.push(st);
      added++;
    }
  });
  return { over, added, total: STYLES.length };
}
const BRAND_MERGE = mergeBrandStyles();

/** 스타일 모드 하나를 상태에 입힌다(단추·select 공용). 띠도 함께 — 없으면 둘 다 끈다. */
async function applyStyle(st) {
  S.overlay = { ...S.overlay, ...(st.ov || {}) };
  S.paper = st.paper;
  S.deco = st.deco || 'none';
  S.decoColor = st.decoColor || S.decoColor;
  if (st.chev) S.chev.color = st.chev;
  TEXT_KEYS.forEach(k => {
    Object.assign(S.layers[k], st.L[k] || {});
    S.layers[k].weight = snapWeight(S.layers[k].font, S.layers[k].weight);
  });
  BAND_KEYS.forEach(k => {
    const b = (st.bands || {})[k];
    S.bands[k] = { ...bandDefault(), ...(b || {}), on: !!(b && b.on) };
    S.bands[k].weight = snapWeight(S.bands[k].font, S.bands[k].weight);
  });
  $('chevColor').value = S.chev.color;
  syncOverlayControls();
  syncControls();
  syncBandControls();
  render();                 // 폰트가 아직이어도 일단 보여 주고
  await loadFonts();
  render();                 // 폰트가 뜨면 제대로 다시

  /* 추천 노래 — 카드에 적은 글과 기사 원문을 함께 본다.
     카드 글(후킹·제목·요약)이 그 카드의 성격을 제일 잘 말해 주고,
     기사 본문은 카드에 안 실린 맥락을 채워 준다. */
  BGM = window.NB_BGM ? NB_BGM.mount($('bgmHost'), () => ({
    title: [layerText('kicker'), layerText('title')].filter(Boolean).join(' ') ||
           $('inTitle').value.trim(),
    body: [layerText('body'), $('inBody').value.trim()].filter(Boolean).join('\n'),
    cat: ''
  })) : null;
}

if (PURE) {
  // 단추를 만들고 숨기는 게 아니라 **아예 안 만든다** — 시험도 개수로 잰다.
  $('styles').style.display = 'none';
  const head = $('styles').previousElementSibling;      // "스타일 모드" 소제목
  if (head && head.classList.contains('subhead')) head.style.display = 'none';
  ['brandHead', 'brandRow'].forEach(id => { if ($(id)) $(id).style.display = 'none'; });
}
(PURE ? [] : STYLES.slice(0, BUILTIN_N)).forEach(st => {
  const b = document.createElement('button');
  b.textContent = st.n;
  b.title = st.hint;
  b.style.background = st.bt;
  b.style.color = st.btx;
  b.style.borderColor = st.bd;
  b.addEventListener('click', () => applyStyle(st));
  $('styles').appendChild(b);
});
/* 내장 6종 뒤에 붙은 브랜드는 단추가 아니라 select 로(20개가 넘는다). 갈래(group)가
   있으면 optgroup 으로 묶는다. 고르면 바로 입힌다. */
(function buildBrandSelect() {
  const sel = $('brandSel');
  if (!sel) return;
  const extra = PURE ? [] : STYLES.slice(BUILTIN_N);
  if (!extra.length) {
    ['brandHead', 'brandRow'].forEach(id => { if ($(id)) $(id).style.display = 'none'; });
    return;
  }
  const groups = {};
  extra.forEach(st => { (groups[st.group || ''] = groups[st.group || ''] || []).push(st); });
  Object.keys(groups).forEach(g => {
    const parent = g ? Object.assign(document.createElement('optgroup'), { label: g }) : sel;
    groups[g].forEach(st => {
      const o = document.createElement('option');
      o.value = st.brand; o.textContent = st.n; o.title = st.hint || '';
      parent.appendChild(o);
    });
    if (g) sel.appendChild(parent);
  });
  if ($('brandCount')) $('brandCount').textContent = `(${extra.length}종)`;
  sel.addEventListener('change', () => {
    const st = STYLES.find(x => x.brand === sel.value);
    if (st) applyStyle(st);
  });
  if ($('btnBrandApply')) $('btnBrandApply').addEventListener('click', () => {
    const st = STYLES.find(x => x.brand === sel.value);
    if (st) applyStyle(st);
  });
})();

/* 색 테마 */
const THEMES = [
  { n: '블랙', ov: '#000000', st: 88, txt: '#ffffff', ac: '#ffd400', box: '#e11d48' },
  { n: '네이비', ov: '#061634', st: 90, txt: '#ffffff', ac: '#7cc0ff', box: '#1d4ed8' },
  { n: '레드', ov: '#1a0407', st: 90, txt: '#ffffff', ac: '#ff5252', box: '#dc2626' },
  { n: '그린', ov: '#03170f', st: 88, txt: '#ffffff', ac: '#4ade80', box: '#059669' },
  { n: '화이트', ov: '#ffffff', st: 92, txt: '#15181f', ac: '#e11d48', box: '#15181f' }
];
THEMES.forEach(t => {
  const b = document.createElement('button');
  b.textContent = t.n;
  b.style.background = t.ov;
  b.style.color = t.txt;
  b.style.borderColor = t.ac;
  b.addEventListener('click', () => {
    S.overlay.color = t.ov;
    S.overlay.strength = t.st;
    S.overlay.top = t.ov === '#ffffff' ? 0 : 22;
    S.paper = t.ov === '#ffffff' ? '#ffffff' : t.ov;   // 사진 없을 때 바탕도 맞춘다
    S.deco = 'none';                                   // 색 테마는 장식 없이 순수 색
    TEXT_KEYS.forEach(k => {
      S.layers[k].color = t.txt;
      S.layers[k].accent = t.ac;
      S.layers[k].boxColor = t.box;
      S.layers[k].shadow = t.ov === '#ffffff' ? 0 : (k === 'title' ? 55 : 40);
    });
    S.chev.color = t.txt;
    // 띠는 끄지 않고 색만 테마 강조색으로 맞춘다(글자색은 그대로)
    BAND_KEYS.forEach(k => { if (S.bands && S.bands[k]) S.bands[k].color = t.ac; });
    $('ovColor').value = t.ov;
    $('ovStrength').value = t.st;
    $('ovTop').value = S.overlay.top;
    $('chevColor').value = t.txt;
    syncControls();
    syncBandControls();
    render();
  });
  $('themes').appendChild(b);
});

/* ─────────────────────── 기사 가져오기 ─────────────────────── */
function msg(el, text, cls) { el.className = 'msg ' + (cls || ''); el.textContent = text; }

async function api(path, body) {
  const r = await fetch(path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  } : undefined);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || '요청 실패');
  return j;
}

function chips(elId, list, targetKey) {
  const el = $(elId);
  el.innerHTML = '';
  (list || []).forEach(t => {
    const c = document.createElement('div');
    c.className = 'chip';
    c.textContent = t;
    c.title = t + '  (클릭하면 적용)';
    c.addEventListener('click', () => {
      S.layers[targetKey].text = t;
      $(TA[targetKey]).value = t;
      selectLayer(targetKey);
      render();
    });
    el.appendChild(c);
  });
}

function applyAnalysis(a) {
  chips('chipsHook', a.hooks, 'kicker');
  chips('chipsTitle', a.titles, 'title');
  chips('chipsSummary', a.summaries, 'body');
  const put = (k, v) => { if (v) { S.layers[k].text = v; $(TA[k]).value = v; } };
  put('kicker', (a.hooks || [])[0]);
  put('title', (a.titles || [])[0]);
  put('body', (a.summaries || [])[0]);
  $('stockQ').value = (a.keywords || []).slice(0, 2).join(' ');
  render();
}

/* 기사 사진에는 언론사 로고·아이콘·같은 사진이 섞여 온다(실측: 연합 18장 중 첫 장이
   로고였다). 주소만 보고 거를 수 있는 것은 여기서 턴다 — 나머지는 뜨는 크기로 거른다. */
const JUNK = /(logo|watermark|sprite|icon|blank|dummy|noimage|no_image|banner|btn_|_ad_)/i;
function cleanImages(urls) {
  const seen = new Set(), out = [];
  (urls || []).forEach(u => {
    if (!u || JUNK.test(u)) return;
    const key = u.split('?')[0];            // 같은 사진에 크기 옵션만 다른 경우가 많다
    if (seen.has(key)) return;
    seen.add(key);
    out.push(u);
  });
  return out;
}

function showImages(urls, ref) {
  const g = $('gridArticle');
  g.innerHTML = '';
  const rows = cleanImages(urls);
  const dropped = (urls || []).length - rows.length;
  $('imgCount').textContent = rows.length
    ? `(${rows.length}장${dropped ? ' · 로고·중복 ' + dropped + '장 걸러냄' : ''})`
    : '(없음)';
  rows.forEach(u => {
    const p = proxy(u, ref);
    const im = document.createElement('img');
    im.src = p;
    /* 🔴 여기에 **감싼 주소**(p)를 넣어 두면, 누를 때 `proxy(proxy(u))` 가 되어
       서버가 `/api/proxy?url=/api/proxy?...` 를 주소로 알고 받으러 나선다.
       그래서 기사 속 사진은 눌러도 배경이 되지 않았다. 원래 주소를 들고 있다가
       쓸 때 한 번만 감싼다. */
    im.dataset.full = u;
    im.loading = 'lazy';
    im.onerror = () => im.remove();
    // 로고·아이콘은 대개 작다. 뜨고 나서야 알 수 있으므로 여기서 한 번 더 턴다.
    im.onload = () => { if (im.naturalWidth < 400) im.remove(); };
    bindThumb(im, { thumb: p, full: u, ref });
    g.appendChild(im);
  });
}

/* ── 여러 장 고르고 합치기 ────────────────────────────────────────────────
   한 장만 고르면 예전처럼 바로 배경이 된다. 두 장부터 합치기가 열린다. */
let mixed = [];        // [{thumb, full, credit, license, source}]

/** 썸네일 하나에 조작을 묶는다.
 *
 * 그냥 누르기      = **이 사진을 지금 배경으로** (한 장만 쓰고 싶을 때가 대부분이다)
 * Ctrl(⌘)/Shift+누르기 = 합치기 목록에 담기·빼기
 * 길게 누르기(폰)  = 같은 담기·빼기 (폰에는 Ctrl 이 없다)
 *
 * 🔴 예전에는 누를 때마다 담기만 했다. 그래서 **둘째 장부터는 눌러도 화면이 그대로**여서
 *    적용이 안 되는 것처럼 보였다(한 장일 때만 배경이 됐다).
 */
function bindThumb(im, it) {
  let timer = null, longPressed = false;
  const toMix = () => { longPressed = true; pickPhoto(it, im, true); };

  im.addEventListener('click', (ev) => {
    if (longPressed) { longPressed = false; return; }   // 길게 누른 뒤 따라오는 click 은 무시
    pickPhoto(it, im, ev.ctrlKey || ev.metaKey || ev.shiftKey);
  });
  im.addEventListener('touchstart', () => {
    longPressed = false;
    timer = setTimeout(toMix, 500);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(e =>
    im.addEventListener(e, () => clearTimeout(timer), { passive: true }));
}

async function pickPhoto(it, imEl, forMix) {
  if (forMix) {
    const i = mixed.findIndex(x => x.full === it.full);
    if (i >= 0) mixed.splice(i, 1);
    else {
      if (mixed.length >= 5) { msg($('fetchMsg'), '한 번에 5장까지 합칠 수 있습니다.', 'err'); return; }
      mixed.push(it);
    }
    paintMix();
    return;
  }
  // 그냥 누르면 이 한 장으로 간다. 담아 둔 것이 있어도 이 사진으로 갈아 끼운다.
  mixed = [it];
  // `setBg` 가 스스로 고른 표시를 지우므로 **끝난 뒤에** 다시 칠한다.
  await setBg(proxy(it.full, it.ref));
  paintMix();
}

function markPicked() {
  document.querySelectorAll('#gridArticle img, #gridStock img').forEach(im => {
    im.classList.toggle('on', mixed.some(x => x.full === (im.dataset.full || im.dataset.src)));
  });
}

function paintMix() {
  const box = $('mixPicked');
  box.innerHTML = '';
  $('mixCount').textContent = mixed.length + '장';
  mixed.forEach((it, i) => {
    const im = document.createElement('img');
    im.src = it.thumb;
    im.title = (i + 1) + '. ' + (it.credit || '') + ' · 눌러서 빼기';
    im.addEventListener('click', () => { mixed.splice(i, 1); paintMix(); markPicked(); });
    box.appendChild(im);
  });
  // 출처·라이선스는 **고른 즉시** 출처 칸에 쌓아 둔다. 나중에 적으려면 잊는다.
  const cred = mixed.filter(x => x.credit).map(x =>
    x.credit + (x.license ? '(' + x.license + ')' : '')).join(' · ');
  if (cred) {
    const base = (S.layers.credit.text || '').split(' | ')[0];
    S.layers.credit.text = [base, '사진 ' + cred].filter(Boolean).join(' | ');
    $('txtCredit').value = S.layers.credit.text;
    render();
  }
  markPicked();
}

/** 고른 사진 2~5장을 한 장으로. 원본 카드 크기(1080×1350)에 그린다. */
async function mixToCanvas(mode, gap) {
  const W = cv.width || 1080, H = cv.height || 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0d0f14';
  g.fillRect(0, 0, W, H);
  const imgs = await Promise.all(mixed.map(x => new Promise(res => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = proxy(x.full);
  })));
  const ok = imgs.filter(Boolean);
  if (!ok.length) throw new Error('사진을 불러오지 못했습니다.');

  /* 칸에 꽉 채우되 비율은 지킨다(넘치는 쪽을 잘라 낸다) */
  const cover = (im, x, y, w, h) => {
    const s = Math.max(w / im.width, h / im.height);
    const dw = im.width * s, dh = im.height * s;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    g.restore();
  };

  if (mode === 'blend') {
    // 거치게 섞기 — 세로로 겹쳐 놓고 이음매를 흐린다
    ok.forEach((im, i) => {
      g.globalAlpha = 1;
      const band = H / ok.length;
      const y = i * band;
      cover(im, 0, y, W, band + 2);
      if (i) {                                  // 위쪽 이음매를 부드럽게
        const gr = g.createLinearGradient(0, y - band * 0.28, 0, y + band * 0.28);
        gr.addColorStop(0, 'rgba(13,15,20,0)');
        gr.addColorStop(0.5, 'rgba(13,15,20,.55)');
        gr.addColorStop(1, 'rgba(13,15,20,0)');
        g.fillStyle = gr;
        g.fillRect(0, y - band * 0.28, W, band * 0.56);
      }
    });
  } else if (mode === 'strip') {
    const n = ok.length, bw = (W - gap * (n - 1)) / n;
    ok.forEach((im, i) => cover(im, i * (bw + gap), 0, bw, H));
  } else {
    // 칸 나누기 — 장수마다 결이 다르다
    const n = ok.length;
    const cells = [];
    const half = (W - gap) / 2, halfH = (H - gap) / 2;
    if (n === 2) {
      cells.push([0, 0, W, halfH], [0, halfH + gap, W, halfH]);
    } else if (n === 3) {
      cells.push([0, 0, W, halfH],
                 [0, halfH + gap, half, halfH], [half + gap, halfH + gap, half, halfH]);
    } else if (n === 4) {
      cells.push([0, 0, half, halfH], [half + gap, 0, half, halfH],
                 [0, halfH + gap, half, halfH], [half + gap, halfH + gap, half, halfH]);
    } else {
      const third = (H - gap * 2) / 3;
      cells.push([0, 0, W, third],
                 [0, third + gap, half, third], [half + gap, third + gap, half, third],
                 [0, (third + gap) * 2, half, third], [half + gap, (third + gap) * 2, half, third]);
    }
    ok.forEach((im, i) => { const r = cells[i]; if (r) cover(im, r[0], r[1], r[2], r[3]); });
  }
  return c;
}

/* ── 한 번 띄워 놓고 기사를 몇 개든 ──────────────────────────────────────
   🔴 지난 기사의 흔적이 조용히 남는 것이 문제였다. `/api/extract` 는 **본문을 같이
   주면 그쪽을 우선**한다(URL 이 막힌 언론사를 위한 길이다). 그런데 화면은 새 주소를
   넣을 때도 칸에 남은 지난 기사 본문을 함께 보내고 있었다 —
   실측: 두 번째 링크에서 사진 18장·출처는 새 기사인데 본문·제목·문구 후보는
   첫 기사 그대로였다. 즉 **한 번 열면 기사 하나** 였다.

   두 갈래로 막는다.
     ① 주소가 바뀌면 **우리가 채운 글**은 스스로 비운다(아래 `AUTO`).
        사람이 손으로 붙여 넣은 본문은 건드리지 않는다 — 그게 정상 사용법이라
        지우면 안 되고, 대신 그 사실을 화면에 적는다.
     ② `새 기사` 단추 — 글·사진·문구를 털되 **디자인은 남긴다**(`초기화` 와 다른 점).
        디자인이 날아가면 기사마다 테마를 다시 잡아야 해서 결국 다시 띄우게 된다. */
const AUTO = { url: '', body: '', title: '', saveName: '' };
const normUrl = (u) => (u || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
const sameUrl = (a, b) => !!normUrl(a) && normUrl(a) === normUrl(b);

/** 기사에 딸린 것만 비운다. 디자인(테마·글꼴·크기·자리·워터마크)은 그대로 둔다. */
function newArticle(opt) {
  opt = opt || {};
  if (!opt.keepUrl) { $('inUrl').value = ''; NAV.setUrl(''); }
  $('inBody').value = '';
  $('inTitle').value = '';
  ['chipsHook', 'chipsTitle', 'chipsSummary'].forEach(id => $(id).innerHTML = '');
  $('gridArticle').innerHTML = '';
  $('imgCount').textContent = '';
  $('stockQ').value = '';
  mixed = [];
  paintMix();
  TEXT_KEYS.forEach(k => { S.layers[k].text = ''; $(TA[k]).value = ''; });
  $('saveName').value = '';
  // 🔴 지난 기사의 피드 글이 남으면 **다음 게시물의 문구**가 되어 조용히 틀린다
  NAV.setFeedText('');
  AUTO.url = ''; AUTO.body = ''; AUTO.title = ''; AUTO.saveName = '';
  if (!opt.keepPhoto) {
    S.bg.src = ''; bgImg = null;
    S.bg.x = 0.5; S.bg.y = 0.45; S.bg.zoom = 1;
  }
  // 시리즈도 새 기사와 함께 한 장으로 돌아간다(디자인은 지금 장 것을 물려받는다)
  if (window.DECK && !opt.keepDeck) DECK.resetToOne();
  render();
}

$('btnFetch').addEventListener('click', async () => {
  const url = $('inUrl').value.trim();
  if (!url) return msg($('fetchMsg'), 'URL을 입력하세요.', 'err');

  const fresh = !!AUTO.url && !sameUrl(url, AUTO.url);   // 지난 기사와 다른 주소인가
  const bodyBox = $('inBody').value.trim();
  const titleBox = $('inTitle').value.trim();
  let handwritten = false;
  if (fresh) {
    if (bodyBox && bodyBox === AUTO.body) $('inBody').value = '';    // 우리가 채운 것 → 버린다
    else if (bodyBox) handwritten = true;                            // 사람이 쓴 것 → 남긴다
    if (titleBox && titleBox === AUTO.title) $('inTitle').value = '';
    mixed = []; paintMix();                 // 고른 사진도 지난 기사 것이다
    NAV.setFeedText('');
  }

  msg($('fetchMsg'), '기사를 가져오는 중…', 'wait');
  try {
    const j = await api('/api/extract', { url, text: $('inBody').value.trim(), title: $('inTitle').value.trim() });
    $('inBody').value = j.body || '';
    if (j.title && !$('inTitle').value.trim()) $('inTitle').value = j.title;
    S.layers.credit.text = [j.press, j.date ? j.date.slice(0, 10) : ''].filter(Boolean).join(' · ');
    $('txtCredit').value = S.layers.credit.text;
    applyAnalysis(j.analysis);
    showImages(j.images || [], j.url);
    // 자동 배경도 **거른 뒤** 첫 장으로 — 안 그러면 언론사 로고가 배경이 된다(실측)
    const first = cleanImages(j.images || [])[0];
    if (first) setBg(proxy(first, j.url));
    // 저장 이름도 기사마다 새로. 사람이 직접 적은 이름은 그대로 둔다.
    const auto = '뉴보대_' + (j.title || 'card').slice(0, 20);
    const cur = $('saveName').value.trim();
    if (!cur || cur === AUTO.saveName) { $('saveName').value = auto; AUTO.saveName = auto; }
    // 다음 링크에서 "이건 우리가 채운 글" 이라고 알아보려면 여기서 적어 둬야 한다
    AUTO.url = url;
    AUTO.body = $('inBody').value.trim();
    AUTO.title = $('inTitle').value.trim();
    msg($('fetchMsg'),
      `가져왔습니다 · 본문 ${(j.body || '').length}자 · 사진 ${(j.images || []).length}장`
      + (handwritten ? ' · 🔴 본문 칸에 직접 넣은 글을 그대로 썼습니다(이 기사 본문이 아닙니다). '
        + '기사 본문으로 하려면 본문 칸을 비우고 다시 [가져오기].' : ''),
      handwritten ? 'wait' : 'ok');
  } catch (e) {
    msg($('fetchMsg'), e.message, 'err');
  }
});

$('btnAnalyze').addEventListener('click', async () => {
  const text = $('inBody').value.trim();
  if (!text) return msg($('fetchMsg'), '본문을 붙여넣으세요.', 'err');
  msg($('fetchMsg'), '분석 중…', 'wait');
  try {
    const j = await api('/api/analyze', { text, title: $('inTitle').value.trim() });
    applyAnalysis(j.analysis);
    msg($('fetchMsg'), '문구 후보를 만들었습니다.', 'ok');
  } catch (e) {
    msg($('fetchMsg'), e.message, 'err');
  }
});

/* 사진: 파일 / 스톡 */
$('btnPick').addEventListener('click', () => $('filePick').click());
$('filePick').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) setBg(URL.createObjectURL(f));
});
$('btnClearBg').addEventListener('click', () => { bgImg = null; S.bg.src = ''; render(); });

/* 키가 필요한 곳과 아닌 곳을 화면에서 갈라 준다.
   🔴 예전에는 Pexels·Unsplash 뿐이라 키가 없으면 무조건 400 이 났다 — 고장 난 것처럼
   보였지만 실은 키를 안 받은 것이었다. 이제 기본은 **키 없이 되는 곳**이다. */
const FREE_PROV = { openverse: 'Openverse', wikimedia: '위키미디어 공용' };
const PROV_NOTE = {
  openverse: 'CC 라이선스 사진을 모아 검색합니다. 상업적 이용·수정이 허용된 것만 가져옵니다. (키 불필요)',
  wikimedia: '위키미디어 공용. 사전·기록 사진이 많습니다. (키 불필요)',
  pexels: '무료지만 pexels.com/api 에서 키를 받아야 합니다.',
  unsplash: '무료지만 unsplash.com/developers 에서 키를 받아야 합니다.',
};
function syncProv() {
  const p = $('stockProvider').value;
  const free = !!FREE_PROV[p];
  $('stockKeyBox').hidden = free;
  $('stockNote').textContent = PROV_NOTE[p] || '';
  if (!free) $('stockKey').value = localStorage.getItem('nb_key_' + p) || '';
}
$('stockKey').addEventListener('input', () => localStorage.setItem('nb_key_' + $('stockProvider').value, $('stockKey').value));
$('stockProvider').addEventListener('change', syncProv);
syncProv();

$('btnStock').addEventListener('click', async () => {
  const q = $('stockQ').value.trim();
  const prov = $('stockProvider').value;
  const key = ($('stockKey').value || '').trim();
  if (!q) return msg($('fetchMsg'), '검색어를 넣으세요.', 'err');
  msg($('fetchMsg'), '사진 찾는 중…', 'wait');
  try {
    const j = await api(`/api/stock?provider=${prov}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`);
    const g = $('gridStock');
    g.innerHTML = '';
    j.items.forEach(it => {
      const im = document.createElement('img');
      im.src = it.thumb;
      im.dataset.full = it.full;
      im.loading = 'lazy';
      im.title = [it.title, it.credit, it.license].filter(Boolean).join(' · ');
      im.onerror = () => im.remove();
      bindThumb(im, it);
      g.appendChild(im);
    });
    msg($('fetchMsg'), `${j.items.length}장 찾았습니다. 누르면 바로 배경이 되고, Ctrl(⌘)+누르기(폰은 길게 누르기)로 여러 장을 합치기에 담습니다.`, 'ok');
  } catch (e) {
    msg($('fetchMsg'), e.message, 'err');
  }
});

/* ── 합치기 ── */
$('mixGap').addEventListener('input', () => {
  $('mixGapRow').querySelector('.val').textContent = $('mixGap').value;
});
$('btnMixClear').addEventListener('click', () => { mixed = []; paintMix(); });
$('btnMix').addEventListener('click', async () => {
  if (mixed.length < 2) return msg($('fetchMsg'), '두 장 이상 골라야 합칩니다.', 'err');
  const p = PROG.start('btnMix', '사진 받는 중');
  try {
    await p.at(0.15, '사진 받는 중');
    const c = await mixToCanvas($('mixMode').value, +$('mixGap').value);
    await p.at(0.8, '배경으로 넣는 중');
    await setBg(c.toDataURL('image/png'));
    markPicked();                     // setBg 가 지운 '고른 표시' 를 되살린다
    p.done('합쳤습니다');
    msg($('fetchMsg'), `${mixed.length}장을 합쳐 배경으로 넣었습니다.`, 'ok');
  } catch (e) {
    p.fail(e.message);
    msg($('fetchMsg'), e.message, 'err');
  }
});


/* ─────────────────────── 디자인 한 벌 (프리셋 · 시리즈 전 장 적용) ───────────────────────
   "디자인" = 글·사진을 뺀 나머지. 글(layers[k].text)·사진(bg.src/x/y/zoom)은 장마다
   다르고, 그 밖의 전부(색·글꼴·크기·자리·띠·로고·화살표·보정)는 시리즈 안에서 같아야
   한 묶음으로 보인다. 프리셋 저장과 「전 장에 적용」이 **같은 함수**를 쓴다. */
function designOf(st) {
  st = st || S;
  const layers = {};
  TEXT_KEYS.forEach(k => { const { text, ...rest } = st.layers[k]; layers[k] = { ...rest }; });
  const bands = {};
  BAND_KEYS.forEach(k => { bands[k] = { ...(st.bands || {})[k] }; });
  const { src, x, y, zoom, ...bgAdj } = st.bg;
  return {
    v: 1,
    overlay: { ...st.overlay }, paper: st.paper, deco: st.deco, decoColor: st.decoColor,
    chev: { ...st.chev }, logo: { ...st.logo }, bands, layers, bgAdj
  };
}
function applyDesign(st, d) {
  if (!d) return st;
  const out = mergeState(st);
  if (d.overlay) out.overlay = { ...out.overlay, ...d.overlay };
  if (d.paper) out.paper = d.paper;
  if (d.deco) out.deco = d.deco;
  if (d.decoColor) out.decoColor = d.decoColor;
  if (d.chev) out.chev = { ...out.chev, ...d.chev };
  if (d.logo) out.logo = { ...out.logo, ...d.logo };
  if (d.bgAdj) out.bg = { ...out.bg, ...d.bgAdj };
  TEXT_KEYS.forEach(k => {
    if (!d.layers || !d.layers[k]) return;
    const text = out.layers[k].text;
    out.layers[k] = { ...out.layers[k], ...d.layers[k], text };
    out.layers[k].weight = snapWeight(out.layers[k].font, out.layers[k].weight);
  });
  BAND_KEYS.forEach(k => {
    if (!d.bands || !d.bands[k]) return;
    out.bands[k] = { ...bandDefault(), ...d.bands[k] };
    out.bands[k].weight = snapWeight(out.bands[k].font, out.bands[k].weight);
  });
  return out;
}

/* ── 내 프리셋 — 이름 붙여 두고 다음 시리즈에 그대로 ── */
const PRESET_KEY = PURE ? 'nb_presets_pure' : 'nb_presets';
function presets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch (e) { return []; } }
function savePresets(list) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch (e) { /* 용량 초과 */ } }
function paintPresets() {
  const el = $('presetSel');
  if (!el) return;
  const cur = el.value;
  el.innerHTML = '';
  const list = presets();
  if (!list.length) {
    const o = document.createElement('option'); o.value = ''; o.textContent = '(저장한 프리셋 없음)'; el.appendChild(o);
  }
  list.forEach(p => {
    const o = document.createElement('option'); o.value = p.name; o.textContent = p.name; el.appendChild(o);
  });
  if (cur && list.some(p => p.name === cur)) el.value = cur;
}
async function applyDesignEverywhere(d, all) {
  if (all && window.DECK && DECK.count() > 1) {
    await DECK.applyDesignAll(d);      // 지금 장 포함 전 장 — 안에서 render 까지
  } else {
    S = applyDesign(S, d);
    if (S.logo.src) logoImg = await loadImage(S.logo.src).catch(() => null); else logoImg = null;
    syncAllFromState();
    render();
    await loadFonts();
    render();
  }
}
if ($('btnPresetSave')) {
  paintPresets();
  $('btnPresetSave').addEventListener('click', () => {
    const name = ($('presetName').value || '').trim();
    if (!name) { msg($('fetchMsg'), '프리셋 이름을 적으세요.', 'err'); $('presetName').focus(); return; }
    const list = presets().filter(p => p.name !== name);
    list.unshift({ name, at: Date.now(), d: designOf(S) });
    savePresets(list.slice(0, 40));
    paintPresets();
    $('presetSel').value = name;
    msg($('fetchMsg'), `프리셋 「${name}」 저장 — 글·사진은 빼고 디자인만 담았습니다.`, 'ok');
  });
  $('btnPresetLoad').addEventListener('click', async () => {
    const name = $('presetSel').value;
    const p = presets().find(x => x.name === name);
    if (!p) return msg($('fetchMsg'), '불러올 프리셋을 고르세요.', 'err');
    await applyDesignEverywhere(p.d, $('presetAll').checked);
    $('presetName').value = name;
    msg($('fetchMsg'), `프리셋 「${name}」 적용` + ($('presetAll').checked && window.DECK && DECK.count() > 1 ? ' (시리즈 전 장)' : ''), 'ok');
  });
  $('btnPresetDel').addEventListener('click', () => {
    const name = $('presetSel').value;
    if (!name || !confirm(`프리셋 「${name}」 을 지울까요?`)) return;
    savePresets(presets().filter(p => p.name !== name));
    paintPresets();
  });
}

/* ─────────────────────── AI 문구 (선택) ───────────────────────
   규칙기반 옆의 한 길. 키가 없으면 아무것도 바뀌지 않는다.
   키는 **이 브라우저(localStorage)** 에만 있고 요청마다 우리 서버를 거쳐 제공자에게 간다 —
   서버 파일에 남기지 않는다(배포 ZIP 에 딸려 나가면 안 된다). */
const AI_KEY = 'nb_ai';
function aiLoad() { try { return JSON.parse(localStorage.getItem(AI_KEY) || '{}'); } catch (e) { return {}; } }
function aiSave(c) { try { localStorage.setItem(AI_KEY, JSON.stringify(c)); } catch (e) { /* */ } }
/** 화면이 아는 설정 한 벌. ready=키(또는 모델)가 있다, on=시리즈·피드 글까지 AI 로. */
function aiCfg() {
  const c = aiLoad();
  const prov = c.provider || 'anthropic';
  const ready = prov === 'ollama' ? !!(c.omodel || '').trim() : !!(c.key || '').trim();
  return { on: !!c.on && ready, ready, provider: prov, key: c.key || '', model: c.model || 'claude-opus-5',
    omodel: c.omodel || '', base: c.base || '' };
}
/** 서버에 보낼 꼴. on=false 면 서버는 규칙기반으로 간다. */
function aiServerCfg() {
  const c = aiCfg();
  return { on: c.on, provider: c.provider, key: c.key, model: c.provider === 'ollama' ? c.omodel : c.model, base: c.base };
}
function syncAiPanel() {
  if (!$('aiProv')) return;
  const c = aiLoad();
  $('aiProv').value = c.provider || 'anthropic';
  $('aiKey').value = c.key || '';
  $('aiModel').value = c.model || 'claude-opus-5';
  $('aiOModel').value = c.omodel || '';
  $('aiOn').checked = !!c.on;
  const oll = $('aiProv').value === 'ollama';
  $('aiKeyRow').hidden = oll; $('aiModelRow').hidden = oll; $('aiORow').hidden = !oll;
  const r = aiCfg();
  $('aiState').textContent = r.ready
    ? (oll ? `Ollama · ${r.omodel}` : `Claude · ${r.model}`) + (r.on ? ' · 시리즈·피드 글도 AI' : '')
    : (oll ? 'Ollama 모델 이름을 적으세요' : '키를 넣으면 ✨ AI 문구 단추가 살아납니다');
  $('btnAI').disabled = !r.ready;
  $('btnAI').title = r.ready ? '본문을 AI 에게 주고 제목·후킹·요약 후보를 받습니다' : 'AI 설정에서 키(또는 Ollama 모델)를 먼저 넣으세요';
}
if ($('aiProv')) {
  syncAiPanel();
  const pick = () => {
    const c = aiLoad();
    c.provider = $('aiProv').value; c.key = $('aiKey').value.trim(); c.model = $('aiModel').value;
    c.omodel = $('aiOModel').value.trim(); c.on = $('aiOn').checked;
    aiSave(c); syncAiPanel();
  };
  ['aiProv', 'aiKey', 'aiModel', 'aiOModel', 'aiOn'].forEach(id => {
    $(id).addEventListener('input', pick); $(id).addEventListener('change', pick);
  });
  $('btnAI').addEventListener('click', async () => {
    const text = $('inBody').value.trim();
    if (!text) return msg($('fetchMsg'), '먼저 기사를 가져오거나 본문을 붙여넣으세요.', 'err');
    const p = PROG.start('btnAI', 'AI 가 읽는 중');
    try {
      await p.at(0.15, 'AI 가 읽는 중');
      const j = await api('/api/ai', { task: 'copy', text, title: $('inTitle').value.trim(), ai: { ...aiServerCfg(), on: true } });
      await p.at(0.9, '채우는 중');
      applyAnalysis(j.result);
      p.done('AI 문구');
      msg($('fetchMsg'), `AI 후보를 받았습니다 · 제목 ${(j.result.titles || []).length}·후킹 ${(j.result.hooks || []).length}·요약 ${(j.result.summaries || []).length}. 칩을 눌러 고르세요.`, 'ok');
    } catch (e) {
      p.fail('실패');
      msg($('fetchMsg'), 'AI 실패: ' + e.message, 'err');
    }
  });
}

/* ─────────────────────── 저장 ─────────────────────── */
const outName = () => ($('saveName').value.trim() || '뉴보대_카드');

/* 켜져 있는 글자 층의 글만 꺼낸다 (꺼 둔 층은 카드에 안 보이므로 셈에서 뺀다) */
const layerText = k => (S.layers[k] && S.layers[k].on ? (S.layers[k].text || '').trim() : '');
let BGM = null;   // bgm.js 가 만들어 주는 추천 노래 패널

/* 내보낼 때만 파일 속에 글자를 심는다. 미리보기 캔버스는 건드리지 않는다.
   사진이 없을 때 그리는 「사진을 끌어다…」 안내는 **미리보기용**이다. 그대로 내보내면
   안내 문구가 박힌 카드가 저장된다(실측 - 시리즈 자동 구성처럼 사진 없이 만든 장에서 났다).
   그래서 내보내기 직전에만 안내를 끄고 한 번 더 그린다. 뒷장은 outro.js 가 그린 것이
   캔버스에 얹혀 있으므로 다시 그리면 안 된다. */
const outCanvas = () => {
  const isOutro = (typeof DECK !== 'undefined' && DECK.isOutroActive) ? DECK.isOutroActive() : false;
  if (!isOutro) { noHint = true; render(); }
  const out = (typeof HIDDEN !== 'undefined') ? HIDDEN.exportCanvas(cv, { name: outName() }) : cv;
  if (!isOutro) { noHint = false; render(); }
  return out;
};
const hiddenNote = () => {
  if (typeof HIDDEN === 'undefined') return '';
  const c = HIDDEN.load();
  const on = [c.vOn && '보이는 워터마크', c.on && '숨긴 표시'].filter(Boolean);
  return on.length ? ' (' + on.join(' + ') + ' 포함)' : '';
};

// 로고는 늦게 도착한다. 오면 숨긴 무늬를 다시 깔아야 한다.
if (typeof HIDDEN !== 'undefined') HIDDEN.onReady(() => render());

/* ── 워터마크 스위치 (오른쪽 패널) ─────────────────────────────────────
   화면을 옮기지 않고 여기서 바로 켜고 끈다. 세부 설정은 워터마크 화면에.
   '보이는 워터마크' 는 저장 파일에만 얹히므로 미리보기는 그대로다. */
function syncWmPanel() {
  if (typeof HIDDEN === 'undefined') return;
  const c = HIDDEN.load();
  $('wmVisible').checked = !!c.vOn;
  $('wmHidden').checked = !!c.on;
  $('wmTip').innerHTML = c.vOn
    ? '⚠ <b>저장하면 그림 위에 워터마크가 얹힙니다.</b> 우리 계정에 올릴 거면 끄세요.'
    : (c.on ? '숨긴 표시만 들어갑니다. 눈에는 안 보입니다.'
            : '아무 표시도 안 들어갑니다.');
}
if (typeof HIDDEN !== 'undefined') {
  $('wmVisible').addEventListener('change', () => {
    HIDDEN.save({ vOn: $('wmVisible').checked });
    syncWmPanel();
    msg($('fetchMsg'), $('wmVisible').checked
      ? '보이는 워터마크를 켰습니다. 저장하는 파일에 얹힙니다.'
      : '보이는 워터마크를 껐습니다. 저장 파일이 깨끗해집니다.', 'ok');
  });
  $('wmHidden').addEventListener('change', () => {
    HIDDEN.save({ on: $('wmHidden').checked });
    syncWmPanel();
    render();                       // 숨긴 무늬는 미리보기에도 깔린다
  });
  syncWmPanel();
}

/* 진행도는 **끝난 단계**로만 올린다(prog.js 주석 참고).
   워터마크 심기와 PNG 만들기는 주 스레드를 잡으므로 단계 사이에 한 프레임 쉰다. */
$('btnDownload').addEventListener('click', async () => {
  const p = PROG.start('btnDownload', '워터마크 심는 중');
  try {
    await p.at(0.05, '워터마크 심는 중');
    const c = outCanvas();
    await p.at(0.4, 'PNG 만드는 중');
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await p.at(0.85, '내려받는 중');
    /* 저장 위치를 한 번 고르면 그 뒤로는 묻지 않고 같은 폴더에 쌓인다(save.js). */
    const at = await SAVE.file(blob, outName() + '.png');
    p.done('내려받음');
    msg($('fetchMsg'), '저장했습니다 → ' + at + hiddenNote(), 'ok');
  } catch (e) {
    p.fail(e.message);
    msg($('fetchMsg'), e.message, 'err');
  }
});

$('btnSave').addEventListener('click', async () => {
  const p = PROG.start('btnSave', '워터마크 심는 중');
  try {
    await p.at(0.05, '워터마크 심는 중');
    const c = outCanvas();
    await p.at(0.3, 'PNG 만드는 중');
    const dataUrl = c.toDataURL('image/png');
    await p.at(0.55, '보내는 중');
    // 보내는 구간만 진짜 바이트로 잰다 — fetch 로는 못 재는 부분이다
    const j = await PROG.postJSON('/api/save', { dataUrl, name: outName() },
      f => p.at(0.55 + 0.42 * f, '보내는 중'));
    p.done('저장함');
    msg($('fetchMsg'), '저장했습니다 → ' + j.path + hiddenNote(), 'ok');
    if (BGM) BGM.redraw();   // 카드가 완성됐으니 지금 글로 노래를 다시 잡는다
  } catch (e) {
    p.fail(e.message);
    msg($('fetchMsg'), e.message, 'err');
  }
});

/* 머리글 — 인스타 단추는 **저장을 거치지 않고** 지금 캔버스를 그대로 가져간다.
   워터마크 설정은 저장 때와 똑같이 `outCanvas()` 를 거치므로 결과물이 갈리지 않는다.

   문구도 빈손으로 보내지 않는다 — `피드 글` 화면을 안 거쳤으면 **카드에 적은 글**
   (후킹·제목·요약문)을 캡션 초안으로 넘긴다. 올리기 화면에서 고쳐 쓰면 된다. */
const cardDraft = () => {
  const t = k => (S.layers[k] && S.layers[k].on ? (S.layers[k].text || '').trim() : '');
  const rows = [t('kicker'), t('title'), t('body')].filter(Boolean);
  return rows.length ? rows.join('\n\n') : '';
};
NAV.mount({
  // 시리즈가 두 장 이상이면 **전부** 담는다(표지→본문→뒷장 순서 그대로 캐러셀).
  stage: () => (window.DECK && DECK.count() > 1) ? DECK.stageItems() : [{ canvas: outCanvas(), name: outName() }],
  draft: cardDraft
});
$('inUrl').addEventListener('input', () => NAV.setUrl($('inUrl').value));

$('btnOpenOut').addEventListener('click', () => fetch('/api/open-out'));

$('btnNew').addEventListener('click', () => {
  const dirty = $('inUrl').value.trim() || $('inBody').value.trim() || S.bg.src || bgImg
    || TEXT_KEYS.some(k => (S.layers[k].text || '').trim());
  if (dirty && !confirm('지금 기사의 글·사진을 비우고 새 기사를 시작할까요?\n디자인(테마·글꼴·자리)은 그대로 둡니다.')) return;
  newArticle();
  msg($('fetchMsg'), '비웠습니다. 다음 기사 링크를 넣으세요 · 디자인은 그대로입니다.', 'ok');
  $('inUrl').focus();
});

$('btnReset').addEventListener('click', () => {
  if (!confirm('디자인과 문구를 모두 초기화할까요?')) return;
  localStorage.removeItem(STATE_KEY);
  S = defaults();
  newArticle();                    // 기사 쪽(글·사진·링크·피드 글)도 같이 턴다
  syncOverlayControls();
  syncBandControls();
  selectLayer('title');
  render();
});

/* ─────────────────────── 상태 저장/복원 ─────────────────────── */
/* 🔴 `let` 이 아니라 `var` 다. 로고가 **캐시에 있으면** HIDDEN.onReady 가
   그 자리에서 바로 render() 를 부르는데, 그때 이 줄은 아직 실행 전이다.
   let 이면 그 순간 TDZ 오류가 나고 **이 아래 코드가 통째로 안 붙는다**
   (저장 단추·boot() 가 조용히 죽는다). var 는 끌어올려져 그 사고가 없다. */
var saveTimer = null;
function saveLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(S)); } catch (e) { /* 용량 초과 무시 */ }
  }, 400);
}

function syncOverlayControls() {
  $('ovColor').value = S.overlay.color;
  $('ovStrength').value = S.overlay.strength;
  $('ovStart').value = S.overlay.start;
  $('ovTop').value = S.overlay.top;
  $('imgBright').value = S.bg.bright;
  $('imgContrast').value = S.bg.contrast;
  $('imgSat').value = S.bg.sat;
  $('chevOn').checked = S.chev.on;
  $('chevColor').value = S.chev.color;
  $('logoSize').value = S.logo.size;
  updateVals();
}

/** 저장돼 있던 상태(옛 버전 포함)를 지금 기본값 위에 얹어 빠진 칸을 채운다.
 *  boot() 의 복원과 시리즈 편집기(deck.js)의 장 전환이 **같은 길**을 쓴다. */
function mergeState(old) {
  const d = defaults();
  old = old || {};
  return {
    ...d, ...old,
    bg: { ...d.bg, ...(old.bg || {}) },
    overlay: { ...d.overlay, ...(old.overlay || {}) },
    chev: { ...d.chev, ...(old.chev || {}) },
    logo: { ...d.logo, ...(old.logo || {}) },
    layers: Object.fromEntries(TEXT_KEYS.map(k =>
      [k, { ...d.layers[k], ...((old.layers || {})[k] || {}) }])),
    // 띠는 나중에 생겼다 — 옛 상태에 없으면 기본값(둘 다 꺼짐)
    bands: Object.fromEntries(BAND_KEYS.map(k =>
      [k, { ...d.bands[k], ...((old.bands || {})[k] || {}) }]))
  };
}

/** 상태 S → 왼쪽·오른쪽 패널 전부. S 를 통째로 갈아 끼운 뒤(복원·장 전환) 부른다. */
function syncAllFromState() {
  if (!S.bands) S.bands = defaults().bands;
  Object.entries(TA).forEach(([k, id]) => $(id).value = S.layers[k].text || '');
  document.querySelectorAll('[data-toggle]').forEach(b => {
    const on = S.layers[b.dataset.toggle].on;
    b.classList.toggle('off', !on);
    b.textContent = on ? '표시' : '숨김';
  });
  syncOverlayControls();
  syncBandControls();
  if ($('logoSel')) $('logoSel').value = S.logo.src || '';
  selectLayer(sel && S.layers[sel] ? sel : 'title');
}

async function boot() {
  // 저장 위치 줄 — 폴더를 고를 수 있는 브라우저에서만 생긴다(save.js)
  if (typeof SAVE !== 'undefined') SAVE.mount($('saveWhereHost'));
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) S = mergeState(JSON.parse(raw));
  } catch (e) { S = defaults(); }
  syncAllFromState();

  $('stockKey').value = localStorage.getItem('nb_key_pexels') || '';

  // 로고 목록
  try {
    const j = await api('/api/assets');
    j.items.forEach(u => {
      const o = document.createElement('option');
      o.value = u;
      o.textContent = decodeURIComponent(u.split('/').pop());
      $('logoSel').appendChild(o);
    });
    if (S.logo.src && j.items.includes(S.logo.src)) {
      $('logoSel').value = S.logo.src;
      logoImg = await loadImage(S.logo.src).catch(() => null);
    }
  } catch (e) { /* assets 없음 */ }

  if (S.bg.src) await setBg(S.bg.src, false).catch(() => { });

  await loadFonts();
  render();

  // 주소창에 ?url=기사주소 를 붙이면 바로 가져오기까지 실행 (북마크용·화면 사이 이동)
  // 링크로 온 것이 아니면 **칸만 채우고 가져오지는 않는다** — 화면을 열 때마다
  // 언론사에 요청을 보내면 곤란하다.
  const sp = new URLSearchParams(location.search);
  const q = sp.get('url');
  // 주제 찾기에서 넘어올 때 제목도 같이 온다(?title=) — 구글 중계 주소는 본문이
  // 안 잡힐 때가 많은데, 그때도 정확한 제목만은 남는다. 가져오기 전에 채워야
  // /api/extract 가 이 제목을 우선으로 쓴다.
  const qt = (sp.get('title') || '').trim();
  if (qt && !$('inTitle').value.trim()) $('inTitle').value = qt;
  if (q || NAV.url()) {
    $('inUrl').value = q || NAV.url();
    NAV.setUrl($('inUrl').value);
    if (q) $('btnFetch').click();
  }
}

/* deck.js(시리즈 편집기)가 이 약속 뒤에 붙는다 — 복원이 끝난 S 위에서 장을 세워야 한다 */
const APP_READY = boot();
