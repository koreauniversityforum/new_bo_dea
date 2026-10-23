// 「긴 영상 → 쇼츠」 창의 IPC. 받아쓰기·얼굴 찾기는 tools/clip_helper.py(파이썬)에 맡기고,
// 구간 고르기·자르기 계산은 clip-engine.js, 굽기는 ffmpeg 로 한다.
// 파이썬이나 faster-whisper 가 없는 PC(공유 ZIP 받은 사람)는 clip:status 가 이유를 알려 주고 화면이 막는다.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pickMoments, layoutFromFaces, videoFilter, buildAss, concatFilter, keepIntervals, tightenMoment, editSegment, postText, chapters } = require('./clip-engine');

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'];

function registerClipIpc({ ipcMain, app, dialog, shell, BrowserWindow, preload, getEditorWindow, asciiWorkRoot, fontsDir }) {
  let clipperWindow = null;
  let statusCache = null;

  const base = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : path.join(__dirname, '..');
  const helper = path.join(base, 'tools', 'clip_helper.py');
  const dataDir = () => path.join(app.getPath('userData'), 'clips');
  // 받아쓰기 모델(수백 MB)은 C: 여유가 적은 노트북을 생각해 바꿀 수 있게 둔다: 환경변수 SHORTFORM_MODELS
  const modelsDir = () => process.env.SHORTFORM_MODELS || path.join(app.getPath('userData'), 'models');

  function send(channel, payload) {
    if (clipperWindow && !clipperWindow.isDestroyed()) clipperWindow.webContents.send(channel, payload);
  }

  function runPython(args, label) {
    const candidates = [['python', []], ['py', ['-3']]];
    return new Promise((resolve, reject) => {
      const attempt = (index) => {
        if (index >= candidates.length) { reject(new Error('파이썬을 찾지 못했습니다. python 3.10 이상이 PATH 에 있어야 합니다.')); return; }
        const [command, prefix] = candidates[index];
        const child = spawn(command, [...prefix, helper, ...args], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
        let errorText = '';
        let movedOn = false;
        const next = () => { if (!movedOn) { movedOn = true; attempt(index + 1); } };
        child.stderr.on('data', (chunk) => {
          const text = chunk.toString('utf8');
          errorText += text;
          text.split(/\r?\n/).forEach((line) => {
            const match = line.match(/^PROGRESS (\d+) ?(.*)$/);
            if (match) send('clip:progress', { label, percent: Number(match[1]), text: match[2] });
          });
        });
        child.on('error', next);
        child.on('close', (code) => {
          if (movedOn) return;
          if (code === 0) resolve(errorText);
          else if (code === 9009) next(); // 윈도우 「앱 실행 별칭」 python(스토어 안내)은 9009 로 끝난다
          else reject(new Error(errorText.split(/\r?\n/).filter((line) => line && !line.startsWith('PROGRESS')).slice(-6).join('\n') || `파이썬 종료 코드 ${code}`));
        });
      };
      attempt(0);
    });
  }

  function cacheKey(filePath, extra) {
    const stat = fs.statSync(filePath);
    return crypto.createHash('sha1').update(`${filePath}|${stat.size}|${stat.mtimeMs}|${extra}`).digest('hex').slice(0, 16);
  }

  function createClipperWindow() {
    if (clipperWindow && !clipperWindow.isDestroyed()) { clipperWindow.show(); clipperWindow.focus(); return; }
    clipperWindow = new BrowserWindow({
      width: 1380, height: 900, minWidth: 1040, minHeight: 680, backgroundColor: '#080a0d',
      title: '긴 영상 → 쇼츠 · Shortform Studio',
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
    });
    clipperWindow.loadFile(path.join(__dirname, 'clipper.html'));
    clipperWindow.on('closed', () => { clipperWindow = null; });
  }

  ipcMain.handle('window:clipper', () => { createClipperWindow(); return true; });

  ipcMain.handle('clip:status', async (_event, fresh) => {
    if (statusCache && !fresh) return statusCache;
    try {
      const text = await runPython(['check'], 'check');
      const line = text.split(/\r?\n/).find((row) => row.startsWith('RESULT '));
      statusCache = { ok: true, ...JSON.parse(line.slice(7)), modelsDir: modelsDir() };
    } catch (error) {
      statusCache = { ok: false, error: error.message, whisper: false, opencv: false };
    }
    return statusCache;
  });

  ipcMain.handle('clip:pickVideo', async () => {
    const result = await dialog.showOpenDialog(clipperWindow || getEditorWindow(), {
      title: '쇼츠로 자를 긴 영상 고르기', properties: ['openFile'],
      filters: [{ name: '영상', extensions: VIDEO_EXTENSIONS }, { name: '모든 파일', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    return { path: filePath, name: path.basename(filePath), size: fs.statSync(filePath).size };
  });

  ipcMain.handle('clip:transcribe', async (_event, payload = {}) => {
    try {
      const model = ['tiny', 'base', 'small', 'medium'].includes(payload.model) ? payload.model : 'small';
      const folder = path.join(dataDir(), cacheKey(payload.path, model));
      const output = path.join(folder, 'transcript.json');
      if (!fs.existsSync(output)) {
        fs.mkdirSync(folder, { recursive: true });
        await runPython(['transcribe', payload.path, output, '--models', modelsDir(), '--model', model, '--lang', payload.lang || 'ko'], 'transcribe');
      }
      return { ok: true, transcript: JSON.parse(fs.readFileSync(output, 'utf8')), cached: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('clip:moments', (_event, payload = {}) => pickMoments(payload.transcript, payload.options || {}));

  ipcMain.handle('clip:faces', async (_event, payload = {}) => {
    try {
      const moments = payload.moments || [];
      const folder = path.join(dataDir(), cacheKey(payload.path, 'faces'));
      fs.mkdirSync(folder, { recursive: true });
      const windowsFile = path.join(folder, `windows-${Date.now()}.json`);
      const output = path.join(folder, `faces-${Date.now()}.json`);
      fs.writeFileSync(windowsFile, JSON.stringify(moments.map((moment) => ({ id: moment.id, start: moment.start, end: moment.end }))), 'utf8');
      await runPython(['faces', payload.path, windowsFile, output, '--models', modelsDir()], 'faces');
      const data = JSON.parse(fs.readFileSync(output, 'utf8'));
      const layouts = {};
      data.windows.forEach((windowData) => { layouts[windowData.id] = { cuts: windowData.cuts || [], ...layoutFromFaces(windowData, data.width, data.height), samples: windowData.samples }; });
      return { ok: true, engine: data.engine, width: data.width, height: data.height, layouts };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // 같은 얼굴 표본으로 방식만 바꿔 다시 계산한다(화면의 「자동/추적/위아래/맞춤」).
  ipcMain.handle('clip:relayout', (_event, payload = {}) => {
    const layout = layoutFromFaces({ samples: payload.samples || [], cuts: payload.cuts || [] }, payload.width, payload.height, payload.mode);
    return { cuts: payload.cuts || [], ...layout, samples: payload.samples || [] };
  });

  ipcMain.handle('clip:pickOutDir', async () => {
    const result = await dialog.showOpenDialog(clipperWindow, { title: '쇼츠를 저장할 폴더', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // 작업 폴더(영문 경로) + 글꼴 사본. libass 의 fontsdir 도 drawtext 처럼 영문 경로여야 한다.
  function makeWork() {
    const work = fs.mkdtempSync(path.join(asciiWorkRoot(), 'clips-'));
    const fonts = path.join(work, 'fonts');
    fs.mkdirSync(fonts);
    for (const file of (fs.existsSync(fontsDir()) ? fs.readdirSync(fontsDir()) : []).filter((name) => /\.(ttf|otf)$/i.test(name))) fs.copyFileSync(path.join(fontsDir(), file), path.join(fonts, file));
    return { work, fonts };
  }

  // 구간 하나 굽기. tighten = 군말·침묵 빼기, preview = 앞 seconds 초만 540x960 으로 빨리.
  async function renderMoment(source, moment, payload, output, work, options = {}) {
    let layout = moment.layout || { mode: 'fit' };
    // 빼지 않으면 낱말 시각은 원본 기준 그대로 둔다(buildAss 가 moment.start 를 뺀다).
    let shaped = moment;
    let length = moment.end - moment.start;
    let intervals = null;
    if (moment.tighten) {
      intervals = keepIntervals(moment);
      const tightened = tightenMoment(moment, layout, intervals);
      shaped = { ...tightened.moment, hook: moment.hook };
      layout = tightened.layout;
      length = tightened.length;
    }
    if (options.preview) length = Math.min(length, options.seconds || 8);
    const assFile = path.join(work.work, `${moment.id}-${options.preview ? 'p' : 'r'}.ass`);
    fs.writeFileSync(assFile, buildAss(shaped, { ...payload.style, hook: moment.hook, layoutMode: layout.mode, captions: moment.captions !== false }), 'utf8');
    const withAudio = payload.hasAudio !== false;
    const head = intervals ? `${concatFilter(intervals, withAudio)};` : '';
    const tail = options.preview ? ',scale=540:960' : '';
    const filter = `${head}${videoFilter(layout, payload.width, payload.height, intervals ? '[cat]' : '[0:v]')};[base]subtitles=filename='${filterPath(assFile)}':fontsdir='${filterPath(work.fonts)}'${tail}[outv]`;
    const audioMap = intervals ? (withAudio ? ['-map', '[acat]'] : []) : ['-map', '0:a?'];
    const args = ['-y', '-ss', moment.start.toFixed(2), '-t', (moment.end - moment.start).toFixed(2), '-i', source,
      '-filter_complex', filter, '-map', '[outv]', ...audioMap, '-t', length.toFixed(2),
      '-c:v', 'libx264', '-preset', options.preview ? 'ultrafast' : 'medium', '-crf', options.preview ? '30' : '20',
      '-r', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output];
    await ffmpeg(args, length, options.onProgress || (() => {}));
    return length;
  }

  ipcMain.handle('clip:render', async (_event, payload = {}) => {
    const outDir = payload.outDir || path.join(app.getPath('videos'), 'Shortform Studio 쇼츠');
    fs.mkdirSync(outDir, { recursive: true });
    const work = makeWork();
    const stem = (payload.title || path.parse(payload.path).name).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 50) || 'clip';
    const done = [];
    try {
      const items = payload.moments || [];
      for (let index = 0; index < items.length; index += 1) {
        const moment = items[index];
        const output = path.join(outDir, `${stem}_${String(index + 1).padStart(2, '0')}_${Math.floor(moment.start)}s.mp4`);
        const length = await renderMoment(payload.path, moment, payload, output, work, {
          onProgress: (percent) => send('clip:progress', { label: 'render', percent: Math.round((index + percent / 100) / items.length * 100), text: `${index + 1}/${items.length}번 굽는 중` })
        });
        // 게시 글(제목 후보·설명·해시태그)을 영상 옆에 같이 둔다. 받아쓴 문장에서만 고른다.
        const post = postText(moment, payload.transcript);
        const postFile = output.replace(/\.mp4$/, '_게시글.txt');
        fs.writeFileSync(postFile, [
          '[제목 후보]', ...post.titles.map((title, i) => `${i + 1}. ${title}`), '',
          '[설명]', post.description, '', '[해시태그] (인스타 한도 5개)', post.tags.join(' '), '',
          `[원본] ${path.basename(payload.path)} ${Math.floor(moment.start)}~${Math.floor(moment.end)}초${moment.tighten ? ' · 군말·침묵 뺌' : ''}`
        ].join('\n'), 'utf8');
        done.push({ id: moment.id, path: output, name: path.basename(output), post, postFile, length: Math.round(length * 10) / 10 });
      }
      send('clip:progress', { label: 'render', percent: 100, text: '굽기 끝' });
      return { ok: true, outDir, files: done };
    } catch (error) {
      return { ok: false, error: error.message, files: done };
    } finally {
      fs.rmSync(work.work, { recursive: true, force: true });
    }
  });

  // 세로 미리보기: 앞 8초를 540x960 으로 빨리 구워 화면에서 바로 튼다(잘린 모양·자막·훅 확인용).
  ipcMain.handle('clip:preview', async (_event, payload = {}) => {
    const work = makeWork();
    try {
      const folder = path.join(dataDir(), 'previews');
      fs.mkdirSync(folder, { recursive: true });
      for (const old of fs.readdirSync(folder)) { try { fs.unlinkSync(path.join(folder, old)); } catch { /* 틀고 있는 파일은 다음에 지운다 */ } }
      const output = path.join(folder, `preview-${Date.now()}.mp4`);
      await renderMoment(payload.path, payload.moment, payload, output, work, {
        preview: true, seconds: 8,
        onProgress: (percent) => send('clip:progress', { label: 'preview', percent: Math.round(percent), text: '세로 미리보기 굽는 중' })
      });
      return { ok: true, path: output };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      fs.rmSync(work.work, { recursive: true, force: true });
    }
  });

  // 자막 고치기: 문장 하나의 글을 바꾸고 낱말 시각을 다시 놓는다.
  ipcMain.handle('clip:editSegment', (_event, payload = {}) => editSegment(payload.segment, payload.text));
  ipcMain.handle('clip:chapters', (_event, payload = {}) => chapters(payload.transcript));
  // 챕터 같은 글을 저장 폴더(없으면 원본 옆)에 남긴다.
  ipcMain.handle('clip:writeText', (_event, payload = {}) => {
    const folder = payload.outDir || path.dirname(payload.source);
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${path.parse(payload.source).name}_${payload.suffix || '글'}.txt`);
    fs.writeFileSync(file, String(payload.text || ''), 'utf8');
    return file;
  });
  ipcMain.handle('clip:keepPreview', (_event, payload = {}) => {
    const intervals = keepIntervals(payload.moment);
    const kept = intervals.reduce((sum, item) => sum + item.end - item.start, 0);
    return { intervals, kept: Math.round(kept * 10) / 10, cut: Math.round((payload.moment.end - payload.moment.start - kept) * 10) / 10 };
  });

  // Jev(TypeSafe) 로 후보 순위 보정. 이 PC 에 jev 명령이 있을 때만(공유 ZIP 받은 사람에게는 단추가 안 보인다).
  // 후보는 규칙이 만들고 Jev 는 「따로 봐도 이야기가 되는가」「자연스럽게 끝나는가」만 확률로 판정한다.
  function runJev(args) {
    return new Promise((resolve, reject) => {
      const child = spawn('jev', args, { windowsHide: true, shell: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => { out += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { err += chunk.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split(/\r?\n/).slice(-3).join(' ') || `jev 종료 코드 ${code}`))));
    });
  }
  ipcMain.handle('clip:jevStatus', async () => {
    try { await runJev(['--help']); return { ok: true }; } catch { return { ok: false }; }
  });
  ipcMain.handle('clip:jevRank', async (_event, payload = {}) => {
    const work = fs.mkdtempSync(path.join(asciiWorkRoot(), 'jev-'));
    try {
      const results = {};
      const moments = payload.moments || [];
      for (let index = 0; index < moments.length; index += 1) {
        const moment = moments[index];
        const file = path.join(work, `${moment.id}.txt`);
        fs.writeFileSync(file, String(moment.text || '').slice(0, 2500), 'utf8');
        const out = await runJev(['-f', `"${file}"`,
          '-n', '"Does this excerpt work as a standalone short video: it opens with a clear hook and a viewer understands it without the rest of the video?"',
          '-n', '"Does the excerpt end at a natural conclusion rather than in the middle of a thought?"', '--json']);
        const answers = JSON.parse(out.slice(out.indexOf('{'))).answers || {};
        const standalone = Number(answers.noul1?.noul ?? 0.5);
        const ending = Number(answers.noul2?.noul ?? 0.5);
        results[moment.id] = { standalone, ending };
        send('clip:progress', { label: 'jev', percent: Math.round((index + 1) / moments.length * 100), text: `Jev 판정 ${index + 1}/${moments.length}` });
      }
      return { ok: true, results };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  ipcMain.handle('clip:reveal', (_event, target) => { if (target) shell.showItemInFolder(target); return true; });

  // 구운 쇼츠를 편집 창 타임라인으로 보낸다(자막·전환을 더 손볼 때).
  ipcMain.handle('clip:toEditor', (_event, payload = {}) => {
    const editor = getEditorWindow(true);
    const media = (payload.files || []).filter((file) => fs.existsSync(file.path)).map((file) => ({
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, path: file.path, type: 'video'
    }));
    const deliver = () => editor.webContents.send('clips:import', { media, title: payload.title || '' });
    if (editor.webContents.isLoading()) editor.webContents.once('did-finish-load', deliver);
    else deliver();
    editor.show();
    editor.focus();
    return media.length;
  });
}

function filterPath(filePath) { return filePath.replaceAll('\\', '/').replace(':', '\\:').replaceAll("'", "\\'"); }

function ffmpeg(args, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true });
    let errorText = '';
    child.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      errorText = (errorText + line).slice(-6000);
      const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) onProgress(Math.min(99, (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) / duration * 100));
    });
    child.on('error', (error) => reject(new Error(`FFmpeg 실행 실패: ${error.message}`)));
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(errorText.split('\n').filter(Boolean).slice(-8).join('\n'))));
  });
}

module.exports = { registerClipIpc };
