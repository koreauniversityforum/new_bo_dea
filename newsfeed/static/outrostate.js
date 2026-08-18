/* 뒷장 설정 한 벌 — `뒷장 만들기` 와 `인스타 올리기` 가 **같이** 쓴다.
 *
 * 왜 떼어 냈나: 올리기 화면에서도 뒷장 5종을 골라 담을 수 있어야 하는데, 그리는 데
 * 필요한 설정(배경·로고·워터마크·문구)을 화면마다 다시 쓰면 반드시 갈라진다.
 * 갈라지면 **뒷장 화면에서 보던 것과 올라가는 그림이 달라진다** — 그건 조용히 틀리는
 * 쪽이라 가장 나쁘다. 그래서 읽기·저장·옵션 조립을 여기 하나로 둔다.
 *
 * `outro.js` 가 먼저 실려 있어야 한다(OUTRO.TEMPLATES 를 쓴다).
 */
(function (global) {
  'use strict';

  const KEY = 'nb_outro2';

  function base() {
    const p = OUTRO.BG_PRESETS[0];
    const b = {
      sel: OUTRO.TEMPLATES[0].id, name: '뉴보대_뒷장',
      bgKind: p.kind, bgColor: p.color, bgSeed: p.seed,
      bg: '', zoom: 100, pos: 50, paper: 90, logo: '',
      wmPos: '', wmTone: 'auto', wmSize: 16, wmAlpha: 18, wmMark: false, t: {}
    };
    OUTRO.TEMPLATES.forEach(t => b.t[t.id] = { ...t.defaults });
    return b;
  }

  function load() {
    const b = base();
    try {
      const old = JSON.parse(localStorage.getItem(KEY) || '{}');
      const s = { ...b, ...old, t: { ...b.t } };
      OUTRO.TEMPLATES.forEach(t => s.t[t.id] = { ...t.defaults, ...((old.t || {})[t.id] || {}) });
      if (!OUTRO.byId[s.sel]) s.sel = b.sel;
      return s;
    } catch (e) { return b; }
  }

  const save = (ST) => { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) {} };

  /** 한 장을 그리는 데 필요한 옵션 한 벌. */
  function opts(ST, id, logoImg, bgImg) {
    return {
      ...ST.t[id], logo: logoImg || null, bg: bgImg || null,
      bgView: { x: 0.5, y: ST.pos / 100, zoom: ST.zoom / 100 },
      bgKind: ST.bgKind, bgColor: ST.bgColor, bgSeed: ST.bgSeed,
      paper: ST.paper / 100,
      wmPos: ST.wmPos, wmTone: ST.wmTone, wmSize: ST.wmSize,
      wmAlpha: ST.wmAlpha, wmMark: ST.wmMark
    };
  }

  function fileName(ST, id) {
    const t = OUTRO.byId[id];
    return (ST.name || '뉴보대_뒷장') + '_' + (OUTRO.TEMPLATES.indexOf(t) + 1) + '_' + t.id;
  }

  const loadImage = (src) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('이미지를 불러오지 못했습니다'));
    im.src = src;
  });

  /** 로고·배경 그림을 실제로 불러온다. 없으면 null 로 둔다(그려지긴 한다). */
  async function images(ST) {
    let logoImg = null, bgImg = null;
    try {
      const j = await (await fetch('/api/assets')).json();
      const items = j.items || [];
      const pick = items.includes(ST.logo) ? ST.logo : items[0] || '';
      if (pick) logoImg = await loadImage(pick).catch(() => null);
    } catch (e) { /* assets 없음 */ }
    if (ST.bg) bgImg = await loadImage(ST.bg).catch(() => null);
    return { logoImg, bgImg };
  }

  global.OUTROST = { KEY, load, save, opts, fileName, images, loadImage };
})(window);
