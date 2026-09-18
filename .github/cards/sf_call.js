// 숏폼 스튜디오 웹판의 「서버 일」을 깃허브 Actions 에서 한다 (2026-09-18).
//
// PC 판(Electron)은 화면(renderer)이 window.studio → ipcMain.handle('채널') 로 main.js 에 일을
// 시킨다. 여기서는 **main.js 를 한 줄도 고치지 않고** 그대로 불러온다 - require('electron') 만
// 가짜로 바꿔 끼우면 ipcMain.handle 로 등록되는 처리기를 전부 손에 쥘 수 있다. 그러면 영상
// 굽기(ffmpeg)·음성(edge-tts)·트렌드 수집·소재 검색/내려받기·발행이 PC 판과 **같은 코드**로 돈다.
//
// 요청: dispatch payload {id, channel, settings} + sf-media 브랜치 req/<id>.json {args}
//       (설정에는 플랫폼 열쇠가 들어 있어 공개 브랜치 파일에 두지 않고 payload 로만 받는다)
// 파일: 브라우저가 올린 소재는 sf-media 의 sfm/<sha1>.<ext>. 여기서 만든 것도 같은 자리에.
// 답  : sf-media 의 res/<id>.json
//
// 🔴 저장소가 공개라 로그도 공개다. payload·설정·결과 내용은 찍지 않는다.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..');
const STUDIO = path.join(ROOT, 'docs', 'shortform');           // 폰판에 실린 스튜디오 원본 사본
const REPO = process.env.GITHUB_REPOSITORY || 'koreauniversityforum/new_bo_dea';
const BRANCH = 'sf-media';
const TOKEN = process.env.GITHUB_TOKEN || '';
const RAW = (p) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p}`;
const ALLOW = new Set(['hunter:load', 'webmedia:search', 'webmedia:download', 'webmedia:downloadUrl',
  'voice:generate', 'video:export', 'publish:start']);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'));
const USERDATA = path.join(TMP, 'userData');
fs.mkdirSync(USERDATA, { recursive: true });

// ── 가짜 electron ────────────────────────────────────────────────────────
const handlers = {};
let saveTarget = '';
const electronStub = {
  app: {
    requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}),
    disableHardwareAcceleration() {}, commandLine: { appendSwitch() {} }, isPackaged: false,
    getPath: (name) => (name === 'temp' ? os.tmpdir() : USERDATA), quit() {}
  },
  BrowserWindow: function () { throw new Error('창 없음'); },
  ipcMain: { handle(name, fn) { handlers[name] = fn; } },
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: saveTarget }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] })
  },
  shell: { openExternal() {}, openPath() {} }
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

// ── sf-media 브랜치 ─────────────────────────────────────────────────────
// 깃 복제 대신 Git Data API(blob → tree → commit → ref)로 올린다. 브라우저 쪽(studio-web.js)과
// 같은 방식이고, 여러 요청이 동시에 와도 ref 갱신이 밀리면 새 머리 위에 다시 쌓으면 된다.
async function gh(method, url, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${url}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'nbd-sf',
      'Content-Type': 'application/json' }
  });
  if (!res.ok) { const e = new Error(`깃허브 ${method} ${url.split('?')[0]} → ${res.status}`); e.status = res.status; throw e; }
  return res.status === 204 ? null : res.json();
}
const staged = [];
function stage(rel, sourceFile) { staged.push({ rel, buf: fs.readFileSync(sourceFile) }); }
async function pushAll(message) {
  if (!staged.length) return;
  const tree = [];
  for (const f of staged) {
    const b = await gh('POST', 'git/blobs', { content: f.buf.toString('base64'), encoding: 'base64' });
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: b.sha });
  }
  for (let i = 0; i < 6; i += 1) {
    const ref = await gh('GET', `git/ref/heads/${BRANCH}`);
    const head = await gh('GET', `git/commits/${ref.object.sha}`);
    const t = await gh('POST', 'git/trees', { base_tree: head.tree.sha, tree });
    const c = await gh('POST', 'git/commits', { message, tree: t.sha, parents: [ref.object.sha] });
    try { await gh('PATCH', `git/refs/heads/${BRANCH}`, { sha: c.sha }); staged.length = 0; return; } catch (error) {
      if (error.status !== 422 || i === 5) throw error;   // 누가 먼저 올렸다 - 새 머리로 다시
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}
async function download(rel, dest) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${rel}?ref=${BRANCH}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'nbd-sf' }
  });
  if (!res.ok) throw new Error(`소재를 못 받았습니다(${res.status}): ${path.basename(rel)} - 7일이 지나 치워졌을 수 있습니다.`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}
async function readJson(rel) {
  const file = await download(rel, path.join(TMP, 'req', path.basename(rel)));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
// 여기서 만든 파일(음성·내려받은 소재·영상)을 브라우저가 쓰는 꼴로 바꿔 올린다
function publishFile(localPath, folder = 'sfm') {
  const buf = fs.readFileSync(localPath);
  const ext = path.extname(localPath).toLowerCase() || '.bin';
  const rel = `${folder}/${crypto.createHash('sha1').update(buf).digest('hex')}${ext}`;
  stage(rel, localPath);
  return { rel, url: RAW(rel) };
}
function webMedia(media) {
  if (!media || !media.path) return media;
  const { rel, url } = publishFile(media.path);
  return { ...media, path: rel, url, bytes: fs.statSync(media.path).size };
}

// sfm/… 경로를 받아 둔 로컬 파일로 바꾼다(영상 굽기·발행 전에)
async function localize(project) {
  const map = {};
  const tl = project.timeline || {};
  for (const clip of [...(tl.video || []), ...(tl.audio || [])]) {
    const p = String(clip.path || '');
    if (!p.startsWith('sfm/')) throw new Error(`이 기기에만 있는 소재가 섞였습니다: ${clip.name || p}`);
    if (!map[p]) map[p] = await download(p, path.join(TMP, 'media', path.basename(p)));
    clip.path = map[p];
  }
  return project;
}

async function run(channel, args) {
  const handler = handlers[channel];
  if (!handler) throw new Error(`처리기가 없습니다: ${channel}`);
  if (channel === 'video:export') {
    const project = await localize(args[0] || {});
    saveTarget = path.join(TMP, 'out.mp4');
    const r = await handler({}, project);
    if (!r || !r.ok) return r || { ok: false, error: '렌더링 결과가 비었습니다.' };
    const { rel, url } = publishFile(saveTarget, 'sfo');
    return { ok: true, path: url, rel, bytes: fs.statSync(saveTarget).size };
  }
  if (channel === 'publish:start') {
    const payload = { ...(args[0] || {}) };
    const src = String(payload.videoPath || '');
    const rel = src.includes(`/${BRANCH}/`) ? src.split(`/${BRANCH}/`)[1] : src;
    if (!/^sf[mo]\//.test(rel)) throw new Error('발행할 영상이 깃허브에 없습니다. 먼저 MP4 로 내보내 주세요.');
    payload.videoPath = await download(rel, path.join(TMP, 'publish', path.basename(rel)));
    // 인스타 릴스는 공개 주소가 필요하다 - 방금 구운 영상의 raw 주소를 그대로 쓴다
    if (!payload.publicVideoUrl) payload.publicVideoUrl = RAW(rel);
    return handler({}, payload);
  }
  const r = await handler({}, ...args);
  if (channel === 'voice:generate' || channel === 'webmedia:download' || channel === 'webmedia:downloadUrl') {
    return r && r.ok ? { ...r, media: webMedia(r.media) } : r;
  }
  return r;
}

(async () => {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const p = event.client_payload || {};
  const id = String(p.id || '');
  if (!/^[a-z0-9]{8,40}$/.test(id)) { console.log('id 가 올바르지 않습니다.'); process.exit(1); }
  const channel = String(p.channel || '');
  // 플랫폼 열쇠는 main.js 가 userData/settings.json 에서 읽는다 - 이 실행 안에서만 쓰고 버린다
  fs.writeFileSync(path.join(USERDATA, 'settings.json'), JSON.stringify(p.settings || {}), 'utf8');
  const t0 = Date.now();
  let out;
  try {
    if (!ALLOW.has(channel)) throw new Error(`홈페이지에서 대신할 수 없는 일입니다: ${channel}`);
    require(path.join(STUDIO, 'main.js'));
    const req = await readJson(`req/${id}.json`);
    out = await run(channel, req.args || []);
  } catch (error) {
    out = { ok: false, error: `깃허브에서 처리하다 멈췄습니다: ${error.message}` };
  }
  const resFile = path.join(TMP, 'res.json');
  fs.writeFileSync(resFile, JSON.stringify({ result: out, took_s: Math.round((Date.now() - t0) / 100) / 10 }));
  stage(`res/${id}.json`, resFile);
  await pushAll(`숏폼 ${channel} ${id}`);
  const ok = Array.isArray(out) ? out.every((x) => x && x.ok) : !!(out && out.ok !== false);
  console.log(`처리: ${channel} -> ok=${ok} (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
  fs.rmSync(path.join(USERDATA, 'settings.json'), { force: true });
  process.exit(0);
})();
