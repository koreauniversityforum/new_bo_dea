/* 파일 저장 자리 — 만든 그림·영상을 **늘 같은 곳에** 떨어뜨린다.
 *
 * 웹 페이지는 저장 위치를 마음대로 정할 수 없다. 브라우저가 정한 내려받기 폴더로
 * 갈 뿐이다(대개 `다운로드`). 그래서 두 갈래로 간다.
 *
 *   ① 기본 — 브라우저 내려받기 폴더(대개 `다운로드`). 아무것도 묻지 않는다.
 *   ② 다른 곳에 모으고 싶으면 「저장 위치 바꾸기」로 폴더를 한 번 고른다. 그 뒤로는
 *      **묻지 않고 같은 폴더**에 쌓이고, 고른 폴더는 IndexedDB 에 남아 창을 닫았다
 *      열어도 이어진다. 폴더 고르기가 없는 브라우저(폰)에서는 이 단추가 안 생긴다.
 *
 * 🔴 폴더 고르기(showDirectoryPicker)와 권한 요청은 **누른 직후**에만 열린다.
 *    저장 단추 안에서 부르는 이유다 — 뒤늦게 부르면 브라우저가 조용히 막는다.
 */
(function (global) {
  'use strict';

  const DB = 'nbd-save', STORE = 'handle', KEY = 'dir';
  const canPick = typeof global.showDirectoryPicker === 'function';
  let dirHandle = null;      // 고른 폴더

  /* ── 고른 폴더를 창 너머로 기억하기 (핸들은 문자열이 아니라 IndexedDB 로만 남는다) ── */
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onerror = () => rej(rq.error);
      rq.onsuccess = () => {
        const tx = rq.result.transaction(STORE, mode);
        const out = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { rq.result.close(); res(out && out.result); };
        tx.onerror = () => { rq.result.close(); rej(tx.error); };
      };
    });
  }
  const load = () => idb('readonly', s => s.get(KEY)).catch(() => null);
  const save = (h) => idb('readwrite', s => s.put(h, KEY)).catch(() => null);
  const drop = () => idb('readwrite', s => s.delete(KEY)).catch(() => null);

  async function allowed(h, ask) {
    if (!h || !h.queryPermission) return false;
    const opt = { mode: 'readwrite' };
    if (await h.queryPermission(opt) === 'granted') return true;
    if (!ask) return false;
    return (await h.requestPermission(opt)) === 'granted';
  }

  /** 폴더를 고른다(누른 직후에만 부를 것). 고르면 true. */
  async function pick() {
    if (!canPick) return false;
    try {
      const h = await global.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
      dirHandle = h;
      await save(h);
      return true;
    } catch (e) {
      return false;                      // 창을 닫았다 — 그냥 내려받기로 간다
    }
  }

  /** 지금 저장되는 곳의 이름. */
  function where() {
    return dirHandle ? dirHandle.name : '내려받기 폴더';
  }

  /** 브라우저 기본 내려받기 (폴더를 못 고르는 경우) */
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    if (!('download' in a)) a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** 같은 이름이 있으면 `_2`, `_3` 으로 비켜 간다(덮어쓰기 사고 방지). */
  async function freeName(dir, name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = name;
    for (let i = 2; i < 500; i++) {
      try { await dir.getFileHandle(n); } catch (e) { return n; }   // 없으면 그 이름을 쓴다
      n = base + '_' + i + ext;
    }
    return base + '_' + Date.now() + ext;
  }

  /**
   * 파일 하나를 떨어뜨린다. 고른 폴더가 있으면 거기에, 없으면 내려받기 폴더에.
   * @returns {Promise<string>} 사람에게 보여 줄 저장 위치 문구
   */
  async function file(blob, name) {
    if (canPick) {
      if (!dirHandle) dirHandle = await load();
      if (dirHandle && !(await allowed(dirHandle, true))) dirHandle = null;
      /* 🔴 먼저 묻지 않는다. 기본은 브라우저 내려받기 폴더(=대개 `다운로드`)이고,
         다른 곳에 모으고 싶을 때만 「저장 위치 바꾸기」로 고른다. 저장을 누를 때마다
         폴더 창이 뜨면 방해만 된다. */
      if (dirHandle) {
        try {
          const fname = await freeName(dirHandle, name);
          const fh = await dirHandle.getFileHandle(fname, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
          return dirHandle.name + ' / ' + fname;
        } catch (e) {
          dirHandle = null;
          await drop();                  // 폴더가 사라졌거나 권한이 끊겼다 — 내려받기로
        }
      }
    }
    download(blob, name);
    return '내려받기 폴더 / ' + name;
  }

  /** data: 주소를 덩어리로. (서버로 보내던 그림이 이 길로 온다) */
  function fromDataUrl(dataUrl) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(String(dataUrl || ''));
    if (!m) return null;
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return new Blob([buf], { type: m[1] });
  }

  /** 「저장 위치: … (바꾸기)」 줄을 붙인다. 폴더를 못 고르는 브라우저에서는 만들지 않는다. */
  async function mount(host) {
    if (!canPick || !host || document.getElementById('saveWhere')) return;
    if (!dirHandle) dirHandle = await load();
    const wrap = document.createElement('p');
    wrap.className = 'tip';
    wrap.id = 'saveWhere';
    const paint = () => {
      wrap.innerHTML = '저장 위치: <b>' + where() + '</b> ';
      const b = document.createElement('button');
      b.className = 'mini';
      b.textContent = '바꾸기';
      b.addEventListener('click', async () => { if (await pick()) paint(); });
      wrap.appendChild(b);
    };
    paint();
    host.appendChild(wrap);
  }

  global.SAVE = { file, pick, where, mount, fromDataUrl, canPick };
})(window);
