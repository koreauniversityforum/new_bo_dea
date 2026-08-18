/* 뉴보대 뒷장(팔로우 유도) 렌더러 — 캔버스 그리기 전용, DOM 의존 없음.
   app.js 에 합칠 때는 이 파일을 그대로 불러오고 OUTRO.draw(ctx, id, opts) 만 부르면 된다.

   참고한 실제 계정 뒷장 (출처: 뒷장 예시.txt)
     1 spotlight  @woozudoc        https://www.instagram.com/p/Dazm0vhE-Pv/
     2 hello      한국항공대학교    https://www.instagram.com/p/DbaSDeimfqo/
     3 editorial  @knewnew         https://www.instagram.com/p/Dbsc7iwiRLj/
     4 wordmark   @luxmag.kr       https://www.instagram.com/p/DbslYd0kwHG/
     5 profile    @space_mystery.zip https://www.instagram.com/p/Dbt9cV6CTBc/
   (다섯 장 모두 왼쪽에 보이는 화살표는 인스타그램이 얹는 넘김 버튼이라 그리지 않는다.) */
'use strict';

const OUTRO = (() => {

  const W = 1080, H = 1350;

  /* 로고에서 뽑은 실제 색 */
  const C = {
    navy: '#04286e',
    blue: '#0050eb',
    yellow: '#fcbb25',
    white: '#ffffff',
    ink: '#15181f',
    gray: '#8a8f9c'
  };

  /* ───────────────────────── 그리기 도우미 ───────────────────────── */

  const hex2rgb = (h) => {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const rgba = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };

  /* 고른 색 하나에서 배경 한 벌을 만들어내려면 색상환을 돌려야 한다 */
  function hex2hsl(hex) {
    let [r, g, b] = hex2rgb(hex).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    const l = (mx + mn) / 2;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return [h, s, l];
  }

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.min(1, Math.max(0, s));
    l = Math.min(1, Math.max(0, l));
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + t.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  /* **강조** → 문자별 accent 플래그 (app.js 와 같은 표기) */
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

  function setFont(ctx, o) {
    ctx.font = `${o.weight || 500} ${o.size}px "${o.font || 'Pretendard'}", "Malgun Gothic", sans-serif`;
    ctx.letterSpacing = ((o.size * (o.space ?? -20)) / 1000).toFixed(2) + 'px';
    ctx.textBaseline = 'alphabetic';
  }

  const widthOf = (ctx, chars) => ctx.measureText(chars.map(o => o.c).join('')).width;

  function wrap(ctx, chars, maxW) {
    const lines = [];
    let cur = [];
    const flush = () => { lines.push(cur); cur = []; };
    for (const ch of chars) {
      if (ch.c === '\n') { flush(); continue; }
      cur.push(ch);
      if (maxW && widthOf(ctx, cur) > maxW && cur.length > 1) {
        let sp = -1;
        for (let i = cur.length - 2; i > 0; i--) if (cur[i].c === ' ') { sp = i; break; }
        if (sp > 0) { const rest = cur.slice(sp + 1); cur = cur.slice(0, sp); flush(); cur = rest; }
        else { const last = cur.pop(); flush(); cur = [last]; }
      }
    }
    flush();
    return lines.map(l => {
      while (l.length && l[0].c === ' ') l.shift();
      while (l.length && l[l.length - 1].c === ' ') l.pop();
      return l;
    }).filter(l => l.length);
  }

  /* 한 덩어리 글을 그리고 차지한 높이를 돌려준다.
     o: {x, y(첫 줄 윗변), size, weight, font, space, line(%), align, color, accent,
         alpha, shadow, maxW} */
  function text(ctx, str, o) {
    if (!(str || '').trim()) return 0;
    setFont(ctx, o);
    const lines = wrap(ctx, toChars(str), o.maxW || 0);
    if (!lines.length) return 0;
    const lh = o.size * (o.line || 130) / 100;
    const asc = o.size * 0.78;
    const align = o.align || 'left';

    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    if (o.shadow) {
      ctx.shadowColor = `rgba(0,0,0,${o.shadow})`;
      ctx.shadowBlur = o.size * 0.5;
      ctx.shadowOffsetY = o.size * 0.06;
    }
    lines.forEach((ln, i) => {
      const w = widthOf(ctx, ln);
      let x = align === 'left' ? o.x : align === 'right' ? o.x - w : o.x - w / 2;
      const y = o.y + i * lh + asc;
      let g = 0;
      while (g < ln.length) {
        let e = g;
        while (e < ln.length && ln[e].a === ln[g].a) e++;
        const seg = ln.slice(g, e).map(v => v.c).join('');
        ctx.fillStyle = ln[g].a ? (o.accent || C.yellow) : (o.color || C.white);
        ctx.fillText(seg, x, y);
        x += ctx.measureText(seg).width;
        g = e;
      }
    });
    ctx.restore();
    return lines.length * lh;
  }

  /* 텍스트 폭 재기(줄바꿈 없이) */
  function measure(ctx, str, o) {
    setFont(ctx, o);
    return ctx.measureText(str.replace(/\*\*/g, '')).width;
  }

  /* 사진을 화면에 꽉 차게(cover) 깔기 */
  function cover(ctx, img, view) {
    const v = { x: 0.5, y: 0.5, zoom: 1, ...(view || {}) };
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * v.zoom;
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, W / 2 - dw * v.x, H / 2 - dh * v.y, dw, dh);
  }

  /* ───────────────────── 만들어 쓰는 배경 ─────────────────────
     사진이 없어도 되도록 오로라 / 밤하늘 / 단색을 직접 그린다.
     씨앗(seed)이 같으면 매번 똑같은 그림이 나오므로 "준비된 사진"처럼 쓸 수 있다. */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function stars(g, seed, n, hue) {
    const rnd = mulberry32(seed ^ 0x9e37);
    for (let i = 0; i < n; i++) {
      const x = rnd() * W, y = rnd() * H, r = rnd() * 1.9 + 0.4;
      g.globalAlpha = 0.16 + rnd() * 0.72;
      g.fillStyle = rnd() > 0.92 ? hsl(hue + 40, 0.9, 0.72) : '#ffffff';
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /* 오로라 커튼 한 겹. 세로 기울기 그라데이션 하나를 만들어 두고
     열마다 위아래로 옮겨 칠한다(그라데이션도 함께 따라 움직인다). */
  function curtain(g, { yc, amp, freq, phase, th, col, alpha, core }) {
    const yAt = (x) => yc
      + Math.sin(x * freq + phase) * amp
      + Math.sin(x * freq * 2.7 + phase * 1.6) * amp * 0.32;

    // 몸통: 위가 짙고 아래로 길게 흘러내린다
    const body = g.createLinearGradient(0, -th * 0.5, 0, th);
    body.addColorStop(0, rgba(col, 0));
    body.addColorStop(0.3, rgba(col, alpha));
    body.addColorStop(0.62, rgba(col, alpha * 0.4));
    body.addColorStop(1, rgba(col, 0));

    // 주름: 몸통보다 길고 가는 세로줄. 이게 아래로 흘러야 오로라로 읽힌다.
    const rayGrad = core && g.createLinearGradient(0, -th * 0.3, 0, th * 1.05);
    if (rayGrad) {
      rayGrad.addColorStop(0, rgba(core, 0));
      rayGrad.addColorStop(0.16, rgba(core, 0.5));
      rayGrad.addColorStop(0.5, rgba(core, 0.18));
      rayGrad.addColorStop(1, rgba(core, 0));
    }

    // 성긴 밝기 변화(몸통) / 촘촘한 줄무늬(주름)
    const slow = (x) => 0.5 + 0.5 * (Math.sin(x * 0.0127 - phase * 1.7) * 0.6
      + Math.sin(x * 0.0331 + phase * 3.1) * 0.4);
    const fine = (x) => {
      const a = 0.5 + 0.5 * Math.sin(x * 0.191 + phase * 5);
      const b = 0.5 + 0.5 * Math.sin(x * 0.083 - phase * 2.3);
      return a * a * (0.35 + 0.65 * b);
    };

    for (let x = -20; x <= W + 20; x += 3) {
      const y = yAt(x);
      g.save();
      g.translate(0, y);
      g.globalAlpha = 0.55 + 0.45 * slow(x);
      g.fillStyle = body;
      g.fillRect(x, -th * 0.5, 5, th * 1.5);
      if (rayGrad) {
        g.globalAlpha = fine(x) * (0.4 + 0.6 * slow(x));
        g.fillStyle = rayGrad;
        g.fillRect(x, -th * 0.3, 4, th * 1.35);
      }
      g.restore();
    }
    g.globalAlpha = 1;
  }

  /* 무거운 그림은 한 번만 그려 캐시한다 (색+씨앗이 같으면 재사용) */
  const _bgCache = new Map();
  function cached(key, make) {
    if (_bgCache.has(key)) return _bgCache.get(key);
    const c = make();
    if (_bgCache.size > 16) _bgCache.delete(_bgCache.keys().next().value);
    _bgCache.set(key, c);
    return c;
  }
  const _newCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  function auroraCanvas(color, seed) {
    return cached('a|' + color + '|' + seed, () => {
      const s = 0.5, w = Math.round(W * s), h = Math.round(H * s);
      const [hue, sat] = hex2hsl(color);
      const rnd = mulberry32(seed);

      // 1) 커튼 (흐리게 만들 대상)
      const a = _newCanvas(w, h);
      const g = a.getContext('2d');
      g.setTransform(s, 0, 0, s, 0, 0);
      g.globalCompositeOperation = 'lighter';
      const cols = [
        hsl(hue, Math.max(0.75, sat), 0.52),
        hsl(hue + 46, 0.85, 0.55),
        hsl(hue - 52, 0.8, 0.48),
        hsl(hue + 20, 0.8, 0.5)
      ];
      for (let i = 0; i < 4; i++) {
        curtain(g, {
          yc: H * (0.2 + i * 0.14) + (rnd() - 0.5) * 120,
          amp: 45 + rnd() * 95,
          freq: 0.0014 + rnd() * 0.002,
          phase: rnd() * 6.28,
          th: 230 + rnd() * 190,
          col: cols[i],
          core: hsl(hue + (i % 2 ? 34 : -18), 0.85, 0.78),
          alpha: 0.46 - i * 0.06
        });
      }

      // 2) 밑바탕 + 흐리게 얹기 + 별
      const b = _newCanvas(w, h);
      const g2 = b.getContext('2d');
      g2.setTransform(s, 0, 0, s, 0, 0);
      const base = g2.createLinearGradient(0, 0, W * 0.35, H);
      base.addColorStop(0, hsl(hue - 20, 0.75, 0.05));
      base.addColorStop(0.5, hsl(hue, 0.7, 0.09));
      base.addColorStop(1, hsl(hue + 25, 0.8, 0.035));
      g2.fillStyle = base;
      g2.fillRect(0, 0, W, H);
      g2.setTransform(1, 0, 0, 1, 0, 0);
      g2.filter = 'blur(6px)';            // 절반 크기라 실제로는 12px 정도
      g2.drawImage(a, 0, 0);
      g2.filter = 'none';
      g2.setTransform(s, 0, 0, s, 0, 0);
      stars(g2, seed, 380, hue);
      return b;
    });
  }

  function nightCanvas(color, seed) {
    return cached('n|' + color + '|' + seed, () => {
      const s = 0.5, w = Math.round(W * s), h = Math.round(H * s);
      const [hue, sat] = hex2hsl(color);
      const c = _newCanvas(w, h);
      const g = c.getContext('2d');
      g.setTransform(s, 0, 0, s, 0, 0);
      const base = g.createLinearGradient(0, 0, W * 0.4, H);
      base.addColorStop(0, hsl(hue - 10, 0.8, 0.09));
      base.addColorStop(0.55, hsl(hue, Math.max(0.6, sat), 0.22));
      base.addColorStop(1, hsl(hue + 8, 0.85, 0.06));
      g.fillStyle = base;
      g.fillRect(0, 0, W, H);
      const glow = g.createRadialGradient(W * 0.78, H * 0.16, 0, W * 0.78, H * 0.16, W * 0.75);
      glow.addColorStop(0, rgba(hsl(hue, 0.9, 0.5), 0.42));
      glow.addColorStop(1, rgba(hsl(hue, 0.9, 0.5), 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      stars(g, seed, 460, hue);
      return c;
    });
  }

  function solidBg(ctx, color) {
    const [hue, sat] = hex2hsl(color);
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, hsl(hue - 8, sat, 0.24));
    g.addColorStop(0.55, hsl(hue, sat, 0.13));
    g.addColorStop(1, hsl(hue + 10, sat, 0.06));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* ───────────── 시사·경제·정치·법률용 배경 그림 ─────────────
     사진을 구해 오지 않아도 되도록 캔버스로 직접 그린다. 글자가 위에 얹히므로
     실루엣은 흐릿하게, 가장자리는 어둡게(비네트) 두는 것이 원칙이다. */

  function vignette(g, a = 0.55) {
    const r = g.createRadialGradient(W / 2, H * 0.44, W * 0.18, W / 2, H * 0.5, W * 0.92);
    r.addColorStop(0, 'rgba(0,0,0,0)');
    r.addColorStop(1, `rgba(0,0,0,${a})`);
    g.fillStyle = r;
    g.fillRect(0, 0, W, H);
  }

  const SCENES = {
    /* 법정의 저울 — 법률·판결·재판 기사 */
    justice: {
      name: '법정 저울', blur: 3,
      draw(g, hue) {
        const cx = W / 2, beamY = H * 0.36, postBot = H * 0.68, arm = 300;
        const glow = g.createRadialGradient(cx, H * 0.33, 0, cx, H * 0.33, W * 0.62);
        glow.addColorStop(0, rgba(hsl(hue, 0.85, 0.55), 0.4));
        glow.addColorStop(1, rgba(hsl(hue, 0.85, 0.5), 0));
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);

        const ink = hsl(hue + 12, 0.35, 0.9);
        g.save();
        g.translate(cx, beamY);
        g.rotate(-3.5 * Math.PI / 180);      // 살짝 기울여야 저울로 보인다
        g.translate(-cx, -beamY);

        g.fillStyle = ink;
        g.globalAlpha = 0.2;
        g.strokeStyle = ink;
        g.lineWidth = 5;
        g.lineCap = 'round';

        roundRect(g, cx - arm, beamY - 8, arm * 2, 16, 8); g.fill();   // 가로대
        roundRect(g, cx - 11, beamY, 22, postBot - beamY, 8); g.fill(); // 기둥
        g.beginPath(); g.arc(cx, beamY - 30, 24, 0, 7); g.fill();       // 꼭대기 장식

        g.beginPath();                                                  // 받침
        g.moveTo(cx - 150, postBot + 74); g.lineTo(cx + 150, postBot + 74);
        g.lineTo(cx + 52, postBot); g.lineTo(cx - 52, postBot);
        g.closePath(); g.fill();

        for (const s of [-1, 1]) {                                      // 접시 둘
          const px = cx + arm * s, py = beamY + 178;
          g.globalAlpha = 0.28;
          g.beginPath();
          for (const d of [-70, 0, 70]) { g.moveTo(px, beamY + 8); g.lineTo(px + d, py - 8); }
          g.stroke();
          g.globalAlpha = 0.2;
          g.beginPath();
          g.moveTo(px - 82, py - 8);
          g.quadraticCurveTo(px, py + 66, px + 82, py - 8);
          g.closePath(); g.fill();
        }
        g.restore();
        g.globalAlpha = 1;
        vignette(g, 0.62);
      }
    },

    /* 국회·법원 파사드 — 정치·제도 기사 */
    columns: {
      name: '국회 기둥', blur: 2,
      draw(g, hue) {
        const glow = g.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, W * 0.78);
        glow.addColorStop(0, rgba(hsl(hue, 0.85, 0.58), 0.52));
        glow.addColorStop(1, rgba(hsl(hue, 0.85, 0.45), 0));
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);

        g.fillStyle = hsl(hue, 0.75, 0.045);      // 역광 실루엣
        g.globalAlpha = 0.82;
        const top = H * 0.2, ent = H * 0.33, colTop = ent + 44, colBot = H * 0.72;

        g.beginPath();                            // 삼각 지붕
        g.moveTo(W / 2, top); g.lineTo(W / 2 + 430, ent); g.lineTo(W / 2 - 430, ent);
        g.closePath(); g.fill();
        g.fillRect(W / 2 - 452, ent, 904, 44);    // 처마

        const n = 6, gap = 760 / (n - 1);
        for (let i = 0; i < n; i++) {
          const x = W / 2 - 380 + i * gap;
          g.fillRect(x - 34, colTop, 68, colBot - colTop);
          g.fillRect(x - 46, colTop - 16, 92, 20);     // 기둥머리
          g.fillRect(x - 46, colBot - 18, 92, 22);     // 기둥발
        }
        for (let i = 0; i < 4; i++)                    // 계단
          g.fillRect(W / 2 - 470 - i * 26, colBot + 4 + i * 22, 940 + i * 52, 24);
        g.globalAlpha = 1;
        vignette(g, 0.5);
      }
    },

    /* 신문 지면 — 시사 전반. 뉴보대 성격에 가장 잘 맞는다 */
    newspaper: {
      name: '신문 지면', blur: 3,
      draw(g, hue, sat, rnd) {
        const ink = hsl(hue + 8, 0.25, 0.88);
        g.save();
        g.translate(W / 2, H / 2);
        g.rotate(-5.5 * Math.PI / 180);
        g.translate(-W / 2, -H / 2);
        g.globalAlpha = 0.16;
        g.fillStyle = ink;

        g.fillRect(90, 150, W - 180, 54);                 // 제호
        g.globalAlpha = 0.11;
        g.fillRect(90, 236, 560, 84);                     // 큰 제목
        g.fillRect(90, 344, 380, 30);

        const colW = (W - 180 - 60) / 4;
        for (let c = 0; c < 4; c++) {
          const x = 90 + c * (colW + 20);
          let y = 420 + rnd() * 40;
          if (c === 1 || c === 3) {                       // 사진 자리
            g.globalAlpha = 0.13;
            g.fillRect(x, y, colW, 150);
            y += 170;
          }
          while (y < H - 150) {
            g.globalAlpha = 0.075 + rnd() * 0.05;
            g.fillRect(x, y, colW * (0.55 + rnd() * 0.45), 9);
            y += 22;
          }
        }
        g.restore();
        g.globalAlpha = 1;
        vignette(g, 0.6);
      }
    },

    /* 봉 차트 — 경제·증시 기사 */
    chart: {
      name: '경제 차트', blur: 2,
      draw(g, hue, sat, rnd) {
        const up = hsl(hue, 0.85, 0.56), dn = hsl(hue + 190, 0.7, 0.5);
        g.strokeStyle = rgba(hsl(hue, 0.4, 0.8), 0.09);
        g.lineWidth = 2;
        for (let i = 1; i < 9; i++) {                     // 눈금
          g.beginPath(); g.moveTo(60, H * i / 9); g.lineTo(W - 60, H * i / 9); g.stroke();
        }

        const n = 20, w = (W - 120) / n;
        let v = H * 0.78;
        const pts = [];
        for (let i = 0; i < n; i++) {
          const x = 60 + i * w + w / 2;
          const step = (rnd() - 0.62) * 120;              // 전체로는 우상향
          const o = v, cl = Math.min(H * 0.86, Math.max(H * 0.18, v + step));
          const hi = Math.min(o, cl) - rnd() * 46, lo = Math.max(o, cl) + rnd() * 46;
          g.globalAlpha = 0.4;
          g.strokeStyle = cl < o ? up : dn;
          g.lineWidth = 4;
          g.beginPath(); g.moveTo(x, hi); g.lineTo(x, lo); g.stroke();
          g.fillStyle = cl < o ? up : dn;
          g.fillRect(x - w * 0.32, Math.min(o, cl), w * 0.64, Math.max(10, Math.abs(cl - o)));
          pts.push([x, cl]);
          v = cl;
        }

        const area = g.createLinearGradient(0, H * 0.2, 0, H);   // 선 아래 면
        area.addColorStop(0, rgba(hsl(hue, 0.9, 0.6), 0.22));
        area.addColorStop(1, rgba(hsl(hue, 0.9, 0.6), 0));
        g.fillStyle = area;
        g.beginPath();
        pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
        g.lineTo(pts[pts.length - 1][0], H); g.lineTo(pts[0][0], H);
        g.closePath(); g.fill();

        g.globalAlpha = 0.55;                             // 추세선
        g.strokeStyle = hsl(hue, 0.9, 0.68);
        g.lineWidth = 6;
        g.lineJoin = 'round';
        g.beginPath();
        pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
        g.stroke();
        g.globalAlpha = 1;
        vignette(g, 0.58);
      }
    }
  };

  function sceneCanvas(kind, color, seed) {
    return cached(kind + '|' + color + '|' + seed, () => {
      const sc = SCENES[kind];
      const s = 0.5, w = Math.round(W * s), h = Math.round(H * s);
      const [hue, sat] = hex2hsl(color);

      const a = _newCanvas(w, h);
      const g = a.getContext('2d');
      g.setTransform(s, 0, 0, s, 0, 0);
      const base = g.createLinearGradient(0, 0, W * 0.3, H);
      base.addColorStop(0, hsl(hue - 12, 0.8, 0.09));
      base.addColorStop(0.55, hsl(hue, Math.max(0.6, sat), 0.14));
      base.addColorStop(1, hsl(hue + 10, 0.85, 0.045));
      g.fillStyle = base;
      g.fillRect(0, 0, W, H);
      sc.draw(g, hue, sat, mulberry32(seed));

      if (!sc.blur) return a;
      const b = _newCanvas(w, h);
      const g2 = b.getContext('2d');
      g2.filter = `blur(${sc.blur}px)`;
      g2.drawImage(a, 0, 0);
      return b;
    });
  }

  /* 위아래를 눌러 글자가 뜨게 하는 반투명 막 */
  function scrim(ctx, bottom, top) {
    if (!bottom && !top) return;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba('#01060f', top));
    g.addColorStop(0.4, rgba('#01060f', top * 0.2));
    g.addColorStop(0.68, rgba('#01060f', bottom * 0.35));
    g.addColorStop(1, rgba('#01060f', bottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* 배경 그리기 — o.bgKind: aurora | night | solid | photo */
  function backdrop(ctx, o, opt) {
    const { dim = 0.62, blur = 0, top = 0.18, light = 0 } = opt || {};
    const color = o.bgColor || '#1f7bff';
    const seed = o.bgSeed ?? 7;
    const kind = (o.bgKind === 'photo' && !o.bg) ? 'aurora' : (o.bgKind || 'aurora');

    if (kind === 'photo') {
      ctx.save();
      if (blur) ctx.filter = `blur(${blur}px)`;
      cover(ctx, o.bg, o.bgView);
      ctx.restore();
      ctx.fillStyle = rgba('#01060f', dim);
      ctx.fillRect(0, 0, W, H);
      scrim(ctx, 0, top);
    } else if (kind === 'solid') {
      solidBg(ctx, color);
      scrim(ctx, dim * 0.35, top * 0.5);
    } else {
      const src = SCENES[kind] ? sceneCanvas(kind, color, seed)
        : kind === 'night' ? nightCanvas(color, seed)
          : auroraCanvas(color, seed);
      ctx.save();
      if (blur) ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(src, 0, 0, W, H);
      ctx.restore();
      scrim(ctx, dim * 0.55, top * 0.7);
    }

    // 밝은 바탕(② 흰 바탕 인사)은 같은 배경 위에 흰 막을 씌워 파스텔로 만든다
    if (light) {
      ctx.fillStyle = rgba('#ffffff', light);
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* 배경 종류 이름표 (편집 화면의 고르는 칸에 그대로 쓴다) */
  const BG_KINDS = [
    { v: 'night',     n: '밤하늘' },
    { v: 'justice',   n: '법정 저울 (법률·판결)' },
    { v: 'columns',   n: '국회 기둥 (정치·제도)' },
    { v: 'newspaper', n: '신문 지면 (시사 전반)' },
    { v: 'chart',     n: '경제 차트 (증시·경제)' },
    { v: 'aurora',    n: '오로라' },
    { v: 'solid',     n: '단색' },
    { v: 'photo',     n: '사진 (직접 넣기)' }
  ];

  /* 배경 프리셋 — 클릭 한 번으로 고르는 "준비된 배경".
     앞장에 시사·경제·정치 기사가 들어가므로 그쪽을 앞에 둔다. */
  const BG_PRESETS = [
    { name: '밤하늘 남색',   kind: 'night',     color: '#0050eb', seed: 7 },
    { name: '신문 지면',     kind: 'newspaper', color: '#0050eb', seed: 9 },
    { name: '법정 저울',     kind: 'justice',   color: '#0050eb', seed: 3 },
    { name: '국회 기둥',     kind: 'columns',   color: '#0050eb', seed: 2 },
    { name: '경제 차트',     kind: 'chart',     color: '#0050eb', seed: 4 },
    { name: '저울 금색',     kind: 'justice',   color: '#fcbb25', seed: 3 },
    { name: '기둥 금색',     kind: 'columns',   color: '#c9922a', seed: 2 },
    { name: '차트 레드',     kind: 'chart',     color: '#e5484d', seed: 4 },
    { name: '신문 먹색',     kind: 'newspaper', color: '#5b6472', seed: 9 },
    { name: '오로라 블루',   kind: 'aurora',    color: '#1f7bff', seed: 12 },
    { name: '오로라 그린',   kind: 'aurora',    color: '#24f0a0', seed: 5 },
    { name: '단색 남색',     kind: 'solid',     color: '#04286e', seed: 0 }
  ];

  /* ── 로고 여백 다듬기 ──────────────────────────────────────────
     PNG 로고는 사방에 투명 여백이 넓다. 그대로 그리면 작고 위로 뜬다.
     한 번 훑어서 (1) 실제 그림이 있는 사각형과 (2) 글자 부분을 뺀 심벌 영역을
     구해 두고 이후에는 캐시를 쓴다. */
  const _bbox = new WeakMap();

  function bounds(img) {
    if (!img) return null;
    if (_bbox.has(img)) return _bbox.get(img);
    let info = null;
    try {
      const N = 240;
      const s = Math.min(1, N / Math.max(img.naturalWidth, img.naturalHeight));
      const cw = Math.max(1, Math.round(img.naturalWidth * s));
      const chh = Math.max(1, Math.round(img.naturalHeight * s));
      const c = document.createElement('canvas');
      c.width = cw; c.height = chh;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, cw, chh);
      const d = g.getImageData(0, 0, cw, chh).data;

      const rows = new Array(chh).fill(0), cols = new Array(cw).fill(0);
      let opaque = 0;
      for (let y = 0; y < chh; y++) {
        for (let x = 0; x < cw; x++) {
          if (d[(y * cw + x) * 4 + 3] > 24) { rows[y]++; cols[x]++; opaque++; }
        }
      }
      if (!opaque) throw new Error('빈 그림');

      const first = (a) => a.findIndex(v => v > 0);
      const last = (a) => a.length - 1 - [...a].reverse().findIndex(v => v > 0);
      const y0 = first(rows), y1 = last(rows), x0 = first(cols), x1 = last(cols);
      const k = 1 / s;
      const full = { x: x0 * k, y: y0 * k, w: (x1 - x0 + 1) * k, h: (y1 - y0 + 1) * k };

      // 심벌과 글자 사이의 빈 줄(가장 긴 것)을 찾아 그 위만 심벌로 본다
      let bs = -1, bl = 0, run = -1;
      for (let y = y0; y <= y1; y++) {
        if (rows[y] === 0) { if (run < 0) run = y; }
        else if (run >= 0) { if (y - run > bl) { bl = y - run; bs = run; } run = -1; }
      }
      let mark = full;
      const relTop = bs > 0 ? (bs - y0) / (y1 - y0) : 0;
      if (bs > 0 && relTop > 0.45 && relTop < 0.92) {
        mark = { x: full.x, y: full.y, w: full.w, h: (bs - y0) * k };
        // 심벌만 다시 좌우로 조인다
        let mx0 = cw, mx1 = 0;
        for (let y = y0; y < bs; y++) {
          for (let x = 0; x < cw; x++) {
            if (d[(y * cw + x) * 4 + 3] > 24) { if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; }
          }
        }
        if (mx1 >= mx0) { mark.x = mx0 * k; mark.w = (mx1 - mx0 + 1) * k; }
      }
      info = { full, mark };
    } catch (e) {
      info = { full: { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }, mark: null };
    }
    _bbox.set(img, info);
    return info;
  }

  /* 로고를 원형으로 오려 그리기 (흰 바탕을 깔아야 남색 글자가 보인다) */
  function avatar(ctx, img, cx, cy, d, opt) {
    // clip:false — 이미 흰 바탕 위라 동그랗게 오릴 필요가 없을 때(모서리가 잘리는 걸 막는다)
    const { ring = null, pad = 0.12, bg = '#ffffff', part = 'mark', clip = true } = opt || {};
    ctx.save();
    if (ring) {
      const g = ctx.createLinearGradient(cx - d / 2, cy - d / 2, cx + d / 2, cy + d / 2);
      g.addColorStop(0, ring[0]);
      g.addColorStop(1, ring[1]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2 + 7, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2 + 3, 0, 7);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, 7);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    if (img) {
      if (clip) ctx.clip();
      const b = bounds(img);
      const r = (part === 'mark' && b.mark) ? b.mark : b.full;
      const box = d * (1 - pad);
      const s = box / Math.max(r.w, r.h);
      ctx.drawImage(img, r.x, r.y, r.w, r.h,
        cx - r.w * s / 2, cy - r.h * s / 2, r.w * s, r.h * s);
    }
    ctx.restore();
  }

  /* 로고 가로 배치(그림 + 글자) — 밝은 바탕 전용. 투명 여백은 잘라낸다. */
  function logoBlock(ctx, img, cx, top, w) {
    if (!img) return 0;
    const r = bounds(img).full;
    const h = w * r.h / r.w;
    ctx.drawImage(img, r.x, r.y, r.w, r.h, cx - w / 2, top, w, h);
    return h;
  }

  /* ── 로고 워터마크 ────────────────────────────────────────────
     배경 위에 로고를 옅게 얹는 선택 기능. 로고는 남색이라 어두운 배경에서는
     거의 안 보이므로, 잘라낸 로고를 한 가지 색으로 물들여 쓰는 길을 같이 둔다.
     (source-in 은 이미 그려 둔 그림의 '모양'만 남기고 색을 갈아 끼운다) */
  const _piece = new WeakMap();

  function logoPiece(img, part, color) {
    let per = _piece.get(img);
    if (!per) { per = {}; _piece.set(img, per); }
    const key = part + '|' + color;
    if (per[key]) return per[key];

    const b = bounds(img);
    const r = (part === 'mark' && b.mark) ? b.mark : b.full;
    const c = _newCanvas(Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h)));
    const g = c.getContext('2d');
    g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    if (color !== 'orig') {
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
    }
    per[key] = c;
    return c;
  }

  const WM_POS = [
    { v: '',   n: '없음' },
    { v: 'tl', n: '왼쪽 위' },
    { v: 'tr', n: '오른쪽 위' },
    { v: 'bl', n: '왼쪽 아래' },
    { v: 'br', n: '오른쪽 아래' },
    { v: 'c',  n: '가운데 (크게)' }
  ];
  const WM_TONE = [
    { v: 'auto',  n: '자동 (배경에 맞춰)' },
    { v: 'white', n: '흰색' },
    { v: 'ink',   n: '먹색' },
    { v: 'brand', n: '브랜드 남색' },
    { v: 'orig',  n: '원본 그대로' }
  ];

  /* light — 밝은 바탕 뒷장인가(자동 색 고를 때 쓴다) */
  function watermark(ctx, o, light) {
    const pos = o.wmPos || '';
    const a = Math.max(0, Math.min(1, (o.wmAlpha == null ? 18 : o.wmAlpha) / 100));
    if (!pos || !o.logo || a <= 0) return;

    const tone = o.wmTone || 'auto';
    const color = tone === 'white' ? '#ffffff'
      : tone === 'ink' ? C.ink
        : tone === 'brand' ? C.navy
          : tone === 'orig' ? 'orig'
            : (light ? C.navy : '#ffffff');          // auto
    const img = logoPiece(o.logo, o.wmMark ? 'mark' : 'full', color);

    const pct = (o.wmSize == null ? 16 : o.wmSize) / 100;
    const w = W * pct * (pos === 'c' ? 3.1 : 1);
    const h = w * img.height / img.width;
    const m = 48;
    const x = pos === 'c' ? (W - w) / 2 : (pos === 'tl' || pos === 'bl') ? m : W - m - w;
    const y = pos === 'c' ? (H - h) / 2 : (pos === 'tl' || pos === 'tr') ? m : H - m - h;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  /* ───────────────────────── 뒷장 5종 ───────────────────────── */

  const TEMPLATES = [
    /* 1. 프로필 알약 — @woozudoc 형 */
    {
      id: 'spotlight',
      name: '① 프로필 알약',
      note: '어두운 배경 + 가운데 질문 + 흰 알약 프로필. 시리즈물 마지막 장에 잘 어울립니다.',
      fields: ['label', 'head', 'handle', 'sub', 'foot'],
      defaults: {
        label: '📰 오늘의 대학 뉴스',
        head: '대학생이 알아야 할 뉴스가\n**궁금하다면?**',
        handle: '@news_univ',
        sub: '뉴스 보는 대학생 | 한국대학생포럼',
        foot: '@news_univ'
      },
      draw(ctx, o) {
        backdrop(ctx, o, { dim: 0.66 });

        text(ctx, o.label, {
          x: W / 2, y: 74, size: 30, weight: '500', align: 'center',
          color: C.white, alpha: 0.88, maxW: W - 240, shadow: 0.35
        });

        text(ctx, o.head, {
          x: W / 2, y: 508, size: 50, weight: '800', align: 'center', line: 138,
          color: C.white, accent: C.yellow, maxW: W - 200, shadow: 0.45
        });

        // 알약 카드
        const pw = 716, ph = 176, px = (W - pw) / 2, py = 672;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.42)';
        ctx.shadowBlur = 44;
        ctx.shadowOffsetY = 14;
        ctx.fillStyle = C.white;
        roundRect(ctx, px, py, pw, ph, ph / 2);
        ctx.fill();
        ctx.restore();

        const d = 128;
        avatar(ctx, o.logo, px + 34 + d / 2, py + ph / 2, d, { pad: 0.02, clip: false });

        const tx = px + 34 + d + 30;
        text(ctx, o.handle, { x: tx, y: py + 42, size: 42, weight: '800', color: C.navy, space: -30 });
        text(ctx, o.sub, { x: tx, y: py + 100, size: 27, weight: '500', color: '#5a6172' });

        text(ctx, o.foot, {
          x: W / 2, y: 1252, size: 26, weight: '500', align: 'center',
          color: C.white, alpha: 0.5
        });
      }
    },

    /* 2. 흰 바탕 인사 — 한국항공대학교 형 */
    {
      id: 'hello',
      name: '② 밝은 바탕 인사',
      note: '로고만 크게. 배경 위에 흰 막을 씌워 파스텔로 만듭니다. 가장 안전한 기본값.',
      light: true,
      fields: ['head', 'handle'],
      defaults: {
        head: '대학 뉴스도\n**뉴스 보는 대학생**에서',
        handle: '@news_univ'
      },
      draw(ctx, o) {
        // 밝기(o.paper)는 편집 화면에서 조절한다. 1이면 완전한 흰 바탕.
        backdrop(ctx, o, { dim: 0, top: 0, light: o.paper ?? 0.9 });

        logoBlock(ctx, o.logo, W / 2, 292, 476);

        text(ctx, o.head, {
          x: W / 2, y: 878, size: 52, weight: '600', align: 'center', line: 148,
          color: C.navy, accent: C.blue, maxW: W - 180
        });

        text(ctx, o.handle, {
          x: W / 2, y: 1232, size: 30, weight: '700', align: 'center',
          color: C.blue, alpha: 0.85
        });
      }
    },

    /* 3. 사진 + 왼쪽 정렬 — @knewnew 형 */
    {
      id: 'editorial',
      name: '③ 사진 위 왼쪽 정렬',
      note: '기사 사진을 그대로 깔고 쓰는 잡지풍. 사진이 좋을 때 가장 예쁩니다.',
      fields: ['head', 'wordmark', 'handle'],
      defaults: {
        head: '복잡한 뉴스를 대학생 눈높이로\n3분 만에 읽고 싶다면',
        wordmark: '뉴스 보는 **대학생**',
        handle: '@news_univ'
      },
      draw(ctx, o) {
        backdrop(ctx, o, { dim: 0.58, top: 0.3 });

        // 아래쪽을 한 번 더 눌러 글자가 뜨게 한다
        const gb = ctx.createLinearGradient(0, H * 0.3, 0, H);
        gb.addColorStop(0, rgba('#01060f', 0));
        gb.addColorStop(1, rgba('#01060f', 0.55));
        ctx.fillStyle = gb;
        ctx.fillRect(0, H * 0.3, W, H * 0.7);

        const x = 148, ty = 604;
        const h = text(ctx, o.head, {
          x, y: ty, size: 47, weight: '500', line: 146,
          color: C.white, maxW: W - x - 110, shadow: 0.4
        });

        // 글 왼쪽 세로줄
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = C.white;
        ctx.fillRect(96, ty, 3, h);
        ctx.restore();

        text(ctx, o.wordmark, {
          x, y: ty + h + 74, size: 64, weight: '900', font: 'Pretendard Black', space: -28,
          color: C.white, accent: C.yellow, shadow: 0.45
        });

        text(ctx, o.handle, {
          x, y: ty + h + 74 + 92, size: 27, weight: '500',
          color: C.white, alpha: 0.62
        });
      }
    },

    /* 4. 큰 워드마크 — @luxmag.kr 형 */
    {
      id: 'wordmark',
      name: '④ 큰 워드마크',
      note: '사진을 흐리게 깔고 브랜드 이름만 크게. 계정 각인용.',
      fields: ['mark', 'sub'],
      defaults: {
        mark: '뉴보대',
        sub: '@news_univ 팔로우하고\n매일 대학 뉴스 3분 요약 받아보세요'
      },
      draw(ctx, o) {
        backdrop(ctx, o, { dim: 0.68, blur: o.bgKind === 'photo' ? 18 : 0, top: 0.12 });

        const cy = 546;
        avatar(ctx, o.logo, W / 2, 420, 136, { pad: 0.26 });

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.5)';
        ctx.shadowBlur = 42;
        text(ctx, o.mark, {
          x: W / 2, y: cy, size: 152, weight: '900', font: 'Pretendard Black',
          align: 'center', space: -22, color: C.white, maxW: W - 140
        });
        ctx.restore();

        text(ctx, o.sub, {
          x: W / 2, y: cy + 214, size: 32, weight: '600', align: 'center', line: 152,
          color: C.white, alpha: 0.92, maxW: W - 200, shadow: 0.4
        });
      }
    },

    /* 5. 인스타 프로필 카드 — @space_mystery.zip 형 */
    {
      id: 'profile',
      name: '⑤ 인스타 프로필 카드',
      note: '팔로우 버튼까지 그려 넣는 방식. 전환율이 가장 높지만 숫자는 꼭 실제 값으로.',
      fields: ['user', 'category', 'stats', 'bio', 'btn1', 'btn2', 'head', 'foot'],
      defaults: {
        user: 'news_univ',
        category: '뉴스 · 대학생',
        stats: '',                       // 예) 게시물 30 / 팔로워 1,200 / 팔로우 25
        bio: '🎓 대학생을 위한 뉴스 큐레이션\n📰 정치·경제·사회 3분 요약\n📍 한국대학생포럼 뉴스 보는 대학생',
        btn1: '팔로우',
        btn2: '메시지 보내기',
        head: '복잡한 뉴스는 그만,\n대학생에게 필요한 것만\n골라 담은 **3분 브리핑**',
        foot: 'NEWS_UNIV'
      },
      draw(ctx, o) {
        backdrop(ctx, o, { dim: 0.72 });

        const cx = 110, cw = 860, pad = 44;
        const inner = cx + pad;
        const d = 132;
        const colX = inner + d + 34;

        // 카드 높이를 내용에 맞춰 먼저 계산
        const bioLines = (o.bio || '').split('\n').filter(s => s.trim()).length;
        const statsOn = !!(o.stats || '').trim();
        const bodyTop = pad + (statsOn ? 214 : 176);
        const bioH = bioLines * 42;
        const ch = bodyTop + bioH + 30 + 78 + pad;
        const cy = Math.round((H * 0.42 - ch / 2) / 2) * 2;

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.45)';
        ctx.shadowBlur = 50;
        ctx.shadowOffsetY = 16;
        ctx.fillStyle = C.white;
        roundRect(ctx, cx, cy, cw, ch, 34);
        ctx.fill();
        ctx.restore();

        avatar(ctx, o.logo, inner + d / 2, cy + pad + d / 2, d,
          { ring: [C.yellow, C.blue], pad: 0.26 });

        text(ctx, o.user, { x: colX, y: cy + pad + 8, size: 36, weight: '700', color: C.ink, space: -20 });
        const uw = measure(ctx, o.user, { size: 36, weight: '700', space: -20 });
        text(ctx, '···', { x: colX + uw + 16, y: cy + pad + 4, size: 32, weight: '700', color: C.gray });

        text(ctx, o.category, { x: colX, y: cy + pad + 62, size: 25, weight: '500', color: C.gray });

        if (statsOn) {
          text(ctx, o.stats, { x: colX, y: cy + pad + 120, size: 26, weight: '600', color: C.ink, maxW: cw - (colX - cx) - pad });
        }

        text(ctx, o.bio, {
          x: inner, y: cy + bodyTop, size: 26, weight: '500', line: 162,
          color: '#2b2f38', maxW: cw - pad * 2
        });

        // 버튼 두 개
        const by = cy + bodyTop + bioH + 30, bh = 78, gap = 20;
        const bw = (cw - pad * 2 - gap) / 2;
        ctx.fillStyle = C.blue;
        roundRect(ctx, inner, by, bw, bh, 16);
        ctx.fill();
        text(ctx, o.btn1, { x: inner + bw / 2, y: by + 24, size: 29, weight: '700', align: 'center', color: C.white });

        ctx.fillStyle = '#eff1f5';
        roundRect(ctx, inner + bw + gap, by, bw, bh, 16);
        ctx.fill();
        text(ctx, o.btn2, { x: inner + bw + gap + bw / 2, y: by + 24, size: 29, weight: '600', align: 'center', color: C.ink });

        // 카드 아래 큰 문구
        text(ctx, o.head, {
          x: W / 2, y: cy + ch + 96, size: 47, weight: '800', align: 'center', line: 146,
          color: C.white, accent: C.yellow, maxW: W - 150, shadow: 0.45
        });

        text(ctx, o.foot, {
          x: W / 2, y: 1256, size: 28, weight: '700', align: 'center',
          color: '#6ea8ff', space: 40
        });
      }
    }
  ];

  const byId = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));

  /* opts: { logo, bg, bgView, bgKind, bgColor, bgSeed, paper, ...템플릿 문구 }
     scale — 작은 미리보기용. 1080×1350 좌표 그대로 두고 배율만 준다. */
  function draw(ctx, id, opts, scale = 1) {
    const t = byId[id];
    if (!t) throw new Error('없는 뒷장 형식: ' + id);
    const o = { ...t.defaults, ...(opts || {}) };
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'left';
    t.draw(ctx, o);
    watermark(ctx, o, t.light);        // 보이는 워터마크(뉴보대) — 기본값은 '없음'
    // 보이지 않는 워터마크(한국대학생포럼). 파일이 없으면 그냥 넘어간다.
    if (typeof HIDDEN !== 'undefined') HIDDEN.pattern(ctx, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* 배경만 그리기 — 배경 고르는 썸네일용 */
  function drawBackground(ctx, o, scale = 1) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    backdrop(ctx, o || {}, { dim: 0.3, top: 0.1, light: o && o.light ? o.light : 0 });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* 이 파일이 쓰는 글꼴을 미리 내려받는다 (캔버스는 CSS 로딩을 기다려주지 않는다) */
  async function loadFonts() {
    const jobs = [
      '400 30px "Pretendard"', '500 30px "Pretendard"', '600 30px "Pretendard"',
      '700 30px "Pretendard"', '800 30px "Pretendard"', '900 30px "Pretendard"',
      '900 30px "Pretendard Black"'
    ].map(f => document.fonts.load(f, '뉴스보는대학생0123'));
    try { await Promise.all(jobs); } catch (e) { /* 없는 굵기는 대체됨 */ }
    await document.fonts.ready;
  }

  return {
    W, H, C, TEMPLATES, byId, BG_PRESETS, BG_KINDS, WM_POS, WM_TONE,
    draw, drawBackground, loadFonts,
    text, backdrop, avatar, watermark, hsl, hex2hsl
  };
})();

if (typeof module !== 'undefined') module.exports = OUTRO;
