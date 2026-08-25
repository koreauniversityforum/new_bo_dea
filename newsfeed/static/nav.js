/* 머리글 공통 — 인스타 단추 · 화면 사이로 링크와 글 실어 나르기.
 *
 * 왜 한 파일로 모았나: `인스타 올리기` 는 **다섯 화면 모두 같은 자리·같은 모양**이어야
 * 한다는 요구였다. 화면마다 markup 을 복사하면 반드시 갈라진다(실제로 이 프로젝트의
 * 머리글은 화면마다 순서가 달랐다). 자리만 `[data-insta-slot]` 으로 표시하고
 * 단추 자체는 여기서 한 번만 만든다.
 *
 * 실어 나르는 것 두 가지
 *  - **기사 링크** (`nb_url`) — 한 화면에 넣으면 `피드 글`·`인스타 올리기` 로 갈 때
 *    `?url=` 로 따라간다. 같은 주소를 세 번 붙여 넣지 않아도 된다.
 *  - **피드 글** (`nb_feed_text`) — 인스타 올리기에서 문구 칸을 바로 채운다.
 */
(function (global) {
  'use strict';

  const KEY_URL = 'nb_url';
  const KEY_FEED = 'nb_feed_text';
  const STAGE_KEY = 'nb_stage';          // 세션 한정(창을 닫으면 사라진다)

  const get = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const put = (k, v) => { try { localStorage.setItem(k, v || ''); } catch (e) { /* 용량 초과 무시 */ } };

  const url = () => get(KEY_URL).trim();
  const feedText = () => get(KEY_FEED);

  function setUrl(u) {
    put(KEY_URL, (u || '').trim());
    refresh();
  }
  function setFeedText(t) { put(KEY_FEED, t || ''); }

  /** `data-carry` 가 붙은 링크에 지금 기사 주소를 실어 준다.
   *  클릭할 때 고치지 않고 **미리** 고쳐 둔다 — 가운데 클릭·키보드로 열어도 같아야 하므로. */
  function refresh() {
    const u = url();
    document.querySelectorAll('a[data-carry]').forEach(a => {
      const base = a.dataset.carry;
      a.href = u ? base + '?url=' + encodeURIComponent(u) : base;
      a.title = u ? '지금 넣은 기사 링크를 그대로 가져갑니다' : '';
    });
  }

  const LOGO = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<defs><linearGradient id="nbIg" x1="0" y1="24" x2="24" y2="0">' +
    '<stop offset="0" stop-color="#f9ce34"/><stop offset=".5" stop-color="#ee2a7b"/>' +
    '<stop offset="1" stop-color="#6228d7"/></linearGradient></defs>' +
    '<rect x="2.2" y="2.2" width="19.6" height="19.6" rx="5.6" stroke="url(#nbIg)" stroke-width="2"/>' +
    '<circle cx="12" cy="12" r="4.3" stroke="url(#nbIg)" stroke-width="2"/>' +
    '<circle cx="17.4" cy="6.6" r="1.3" fill="url(#nbIg)"/></svg>';

  /** 화면이 준 캔버스를 **out 폴더를 거치지 않고** 임시 자리에 담고 올리기 화면으로 간다.
   *
   * 🔴 **쌓는다.** 갈아 끼우면 앞장을 담고 뒷장을 담는 순간 앞장이 사라져 캐러셀을
   *    못 만든다. 담은 것을 비우는 일은 올리기 화면의 `임시 그림 지우기` 가 맡는다.
   */
  async function stageAndGo(btn, getItems, getDraft) {
    const items = (getItems() || []).filter(it => it && it.canvas);
    if (!items.length) return;
    const p = global.PROG ? global.PROG.start(btn, 'PNG 만드는 중') : null;
    try {
      const payload = [];
      for (let i = 0; i < items.length; i++) {
        if (p) await p.at(0.1 + 0.4 * (i / items.length), 'PNG 만드는 중');
        payload.push({ name: items[i].name, dataUrl: items[i].canvas.toDataURL('image/png') });
      }
      if (p) await p.at(0.5, '보내는 중');
      const send = global.PROG ? global.PROG.postJSON : null;
      const body = { items: payload };
      const j = send
        ? await send('/api/insta-stage', body, f => { if (p) p.at(0.5 + 0.45 * f, '보내는 중'); })
        : await fetch('/api/insta-stage', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).then(r => r.json());
      if (!j.ok) throw new Error(j.error || '임시 저장에 실패했습니다.');
      // 문구는 ① 피드 글 화면에서 쓴 것 ② 없으면 카드에 적은 글로 만든 초안 순서.
      // 둘 다 없으면 빈칸으로 두고 올리기 화면이 후보를 뽑아 준다.
      sessionStorage.setItem(STAGE_KEY, JSON.stringify({
        dir: j.dir, names: j.names, added: (j.names || []).length,
        caption: feedText() || (getDraft ? getDraft() : ''),
        fromCard: !feedText(),
      }));
      if (p) p.done('올리기 화면으로');
      location.href = '/static/insta.html' + (url() ? '?url=' + encodeURIComponent(url()) : '');
    } catch (e) {
      if (p) p.fail(e.message);
      else alert(e.message);
    }
  }

  /** 올리기 화면이 부른다. 한 번 읽으면 지운다(뒤로 갔다 오면 또 담기지 않게). */
  function takeStage() {
    let raw = null;
    try {
      raw = sessionStorage.getItem(STAGE_KEY);
      sessionStorage.removeItem(STAGE_KEY);
    } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* 모든 화면에 똑같이 놓이는 머리글 링크. 화면마다 markup 을 복사하면 반드시
   * 갈라진다(주제 찾기 링크가 실제로 여섯 화면에 복사됐었다) — 인스타 단추처럼
   * 슬롯에서 한 번만 만든다. 지금 보고 있는 화면으로 가는 링크는 안 만든다. */
  /* 「숏폼 만들기」는 PC 앱이 Shortform Studio exe 를 띄우는 일이라 서버가 있어야 한다.
   * 폰판(깃허브 페이지, 서버 0개)에서는 옛 「릴스 만들기」(reel.html, 브라우저만으로 됨)를
   * 그대로 보여 준다. 판별은 폰shim 이 심는 NBD_PHONE 또는 주소로. */
  function isPhoneBuild() {
    try {
      return !!global.NBD_PHONE || location.protocol === 'file:' || /github\.io$/.test(location.hostname);
    } catch (e) { return false; }
  }
  const SCREENS = [
    { href: '/static/topics.html', label: '주제 찾기' },
    { href: '/static/refs.html', label: '참고 사이트' },
    isPhoneBuild()
      ? { href: '/static/reel.html', label: '릴스 만들기' }
      : { href: '/static/shortform.html', label: '숏폼 만들기' },   // reel.html 은 숏폼 화면 안 「간단 릴스」로 이어진다
  ];
  const LINK_STYLE = 'padding:7px 12px;border-radius:8px;border:1px solid #2a2f3a;' +
    'color:#e8eaee;text-decoration:none;font-size:12px';

  function screenLinks() {
    const here = location.pathname.replace(/\/index\.html$/, '/');
    const out = [];
    SCREENS.forEach(s => {
      if (s.href === here) return;
      const a = document.createElement('a');
      a.className = 'ghost';
      a.href = s.href;
      a.textContent = s.label;
      a.style.cssText = LINK_STYLE;
      out.push(a);
    });
    return out;
  }

  /** @param {object} [opt] `opt.stage` 를 주면 단추가 **지금 화면을 담아** 간다. */
  function mount(opt) {
    opt = opt || {};
    document.querySelectorAll('[data-insta-slot]').forEach(slot => {
      let el;
      if (opt.stage) {
        el = document.createElement('button');
        el.className = 'insta-btn';
        el.title = '지금 화면의 카드를 담아 올리기 화면으로 갑니다 (out 폴더에 저장 안 함).\n'
                 + '여러 장이면 만들 때마다 눌러 쌓으면 됩니다.';
        el.addEventListener('click', () => stageAndGo(el, opt.stage, opt.draft));
      } else {
        el = document.createElement('a');
        el.className = 'insta-btn';
        el.href = '/static/insta.html';
        el.dataset.carry = '/static/insta.html';
      }
      el.innerHTML = LOGO + '<span>인스타 올리기</span>';
      const frag = document.createDocumentFragment();
      screenLinks().forEach(a => frag.appendChild(a));
      frag.appendChild(el);
      slot.replaceWith(frag);
    });
    // 인스타 올리기 화면처럼 단추는 필요 없고 **링크만** 놓을 자리
    document.querySelectorAll('[data-nav-slot]').forEach(slot => {
      const frag = document.createDocumentFragment();
      screenLinks().forEach(a => frag.appendChild(a));
      slot.replaceWith(frag);
    });
    refresh();
  }

  /* ── 폰: 미리보기 접기/펼치기 ──────────────────────────────────────────
   * 폰에서는 미리보기를 화면 맨 위에 붙여 둔다(style.css 의 820px 규칙). 사진을
   * 고르는 자리가 한참 아래라, 붙여 두지 않으면 고른 결과가 화면 밖이라서
   * 적용됐는지 알 수 없기 때문이다. 다만 글을 길게 칠 때는 자리를 많이 먹으므로
   * 접을 수 있게 한다. 접어도 76px 짜리 띠로 남아 사진이 바뀐 것은 보인다.
   * PC(821px 이상)에서는 미리보기가 늘 옆에 보이므로 단추를 만들지 않는다.
   */
  const KEY_MIN = 'nb_preview_min';
  const phone = () => window.matchMedia('(max-width:820px)').matches;

  function mountPreviewToggle() {
    const foot = document.querySelector('.stage:has(.canvas-box) .stage-foot');
    if (!foot) return;                       // 카드가 없는 화면(워터마크 등)
    const had = document.getElementById('btnPreviewMin');
    if (!phone()) {                          // PC 로 넓어지면 흔적을 지운다
      if (had) had.remove();
      document.body.classList.remove('preview-min');
      return;
    }
    if (had) return;
    if (get(KEY_MIN) === '1') document.body.classList.add('preview-min');
    const b = document.createElement('button');
    b.id = 'btnPreviewMin';
    b.className = 'mini';
    const paint = () => {
      b.textContent = document.body.classList.contains('preview-min')
        ? '미리보기 펼치기' : '미리보기 접기';
    };
    b.addEventListener('click', () => {
      const min = document.body.classList.toggle('preview-min');
      put(KEY_MIN, min ? '1' : '');
      paint();
    });
    paint();
    foot.prepend(b);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPreviewToggle);
  } else {
    mountPreviewToggle();
  }
  window.addEventListener('resize', mountPreviewToggle);

  global.NAV = { mount, refresh, url, setUrl, feedText, setFeedText, takeStage, LOGO };
})(window);
