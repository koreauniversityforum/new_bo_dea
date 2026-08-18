/* 저장·올리기가 얼마나 갔는지 **버튼 바로 아래**에 띄운다.
 *
 * 🔴 % 를 지어내지 않는다. 실제로 끝난 단계에서만 올라가고, 서버로 보내는 구간만
 *    바이트로 잰다(`XMLHttpRequest.upload.onprogress`). 저 혼자 흐르는 막대는
 *    "도는 중"과 "멈춤"을 구별하지 못하게 만들어 없느니만 못하다.
 *
 * 🔑 캔버스 일(워터마크 심기·PNG 만들기)은 **주 스레드를 잡는다.** 그 사이에 막대를
 *    갱신해 봐야 화면이 안 그려지므로, 단계 사이마다 한 프레임 쉬어 준다(`breathe`).
 *    안 그러면 0% 에 있다가 100% 로 튄다.
 */
(function (global) {
  'use strict';

  const breathe = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

  function barOf(btn) {
    let wrap = btn.parentElement;
    if (!wrap || !wrap.classList.contains('prog-wrap')) {
      wrap = document.createElement('span');
      wrap.className = 'prog-wrap';
      btn.parentNode.insertBefore(wrap, btn);
      wrap.appendChild(btn);
    }
    let bar = wrap.querySelector(':scope > .prog');
    if (!bar) {
      bar = document.createElement('span');
      bar.className = 'prog';
      bar.innerHTML = '<i></i><b></b>';
      wrap.appendChild(bar);
    }
    return bar;
  }

  /** 진행바를 켠다. 돌려주는 손잡이로 단계를 올린다.
   *  @param {HTMLElement|string} target 단추(또는 그 id)
   */
  function start(target, firstLabel) {
    const btn = typeof target === 'string' ? document.getElementById(target) : target;
    const bar = barOf(btn);
    const fill = bar.querySelector('i');
    const txt = bar.querySelector('b');
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    bar.className = 'prog on';
    fill.style.width = '0%';
    txt.textContent = firstLabel || '준비';
    let hideTimer = null;
    clearTimeout(bar._t);

    const api = {
      /** @param {number} frac 0~1 (실제로 끝난 만큼) */
      async at(frac, label) {
        const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
        fill.style.width = pct + '%';
        txt.textContent = (label ? label + ' ' : '') + pct + '%';
        await breathe();          // 캔버스 일 전에 화면이 실제로 그려지게
      },
      done(label) {
        bar.className = 'prog on ok';
        fill.style.width = '100%';
        txt.textContent = (label || '끝') + ' 100%';
        btn.disabled = wasDisabled;
        bar._t = setTimeout(() => { bar.className = 'prog'; }, 2600);
      },
      fail(label) {
        bar.className = 'prog on err';
        txt.textContent = label || '막힘';
        btn.disabled = wasDisabled;
        bar._t = setTimeout(() => { bar.className = 'prog'; }, 5000);
      },
    };
    if (hideTimer) clearTimeout(hideTimer);
    return api;
  }

  /** JSON 을 보내면서 **올라간 바이트**를 알려 준다. fetch 로는 못 재는 부분이다. */
  function postJSON(url, body, onUpload) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (onUpload) {
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) onUpload(e.loaded / e.total, e.loaded, e.total);
        };
      }
      xhr.onload = () => {
        let j;
        try { j = JSON.parse(xhr.responseText); }
        catch (e) { return reject(new Error('서버 응답을 못 읽었습니다 (' + xhr.status + ')')); }
        if (!j.ok) return reject(new Error(j.error || '요청 실패'));
        resolve(j);
      };
      xhr.onerror = () => reject(new Error('서버에 못 닿았습니다.'));
      xhr.send(JSON.stringify(body));
    });
  }

  global.PROG = { start, postJSON, breathe };
})(window);
