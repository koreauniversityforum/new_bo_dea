// 「긴 영상 → 쇼츠」 창의 IPC. 받아쓰기·얼굴 찾기는 tools/clip_helper.py(파이썬)에 맡기고,
// 구간 고르기·자르기 계산은 clip-engine.js, 굽기는 ffmpeg 로 한다.
// 파이썬이나 faster-whisper 가 없는 PC(공유 ZIP 받은 사람)는 clip:status 가 이유를 알려 주고 화면이 막는다.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pickMoments, layoutFromFaces, videoFilter, buildAss } = require('./clip-engine');

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
      data.windows.forEach((windowData) => { layouts[windowData.id] = { ...layoutFromFaces(windowData, data.width, data.height), samples: windowData.samples }; });
      return { ok: true, engine: data.engine, width: data.width, height: data.height, layouts };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // 같은 얼굴 표본으로 방식만 바꿔 다시 계산한다(화면의 「자동/추적/위아래/맞춤」).
  ipcMain.handle('clip:relayout', (_event, payload = {}) => {
    const layout = layoutFromFaces({ samples: payload.samples || [] }, payload.width, payload.height, payload.mode);
    return { ...layout, samples: payload.samples || [] };
  });

  ipcMain.handle('clip:pickOutDir', async () => {
    const result = await dialog.showOpenDialog(clipperWindow, { title: '쇼츠를 저장할 폴더', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('clip:render', async (_event, payload = {}) => {
    const outDir = payload.outDir || path.join(app.getPath('videos'), 'Shortform Studio 쇼츠');
    fs.mkdirSync(outDir, { recursive: true });
    const work = fs.mkdtempSync(path.join(asciiWorkRoot(), 'clips-'));
    const fonts = path.join(work, 'fonts');
    fs.mkdirSync(fonts);
    // libass 의 fontsdir 도 drawtext 처럼 영문 경로여야 한다 → 글꼴을 작업 폴더로 복사
    for (const file of (fs.existsSync(fontsDir()) ? fs.readdirSync(fontsDir()) : []).filter((name) => /\.(ttf|otf)$/i.test(name))) fs.copyFileSync(path.join(fontsDir(), file), path.join(fonts, file));
    const stem = (payload.title || path.parse(payload.path).name).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 50) || 'clip';
    const done = [];
    try {
      const items = payload.moments || [];
      for (let index = 0; index < items.length; index += 1) {
        const moment = items[index];
        const layout = moment.layout || { mode: 'fit' };
        const assFile = path.join(work, `${moment.id}.ass`);
        fs.writeFileSync(assFile, buildAss(moment, { ...payload.style, hook: moment.hook, layoutMode: layout.mode, captions: moment.captions !== false }), 'utf8');
        const output = path.join(outDir, `${stem}_${String(index + 1).padStart(2, '0')}_${Math.floor(moment.start)}s.mp4`);
        const filter = `${videoFilter(layout, payload.width, payload.height)};[base]subtitles=filename='${filterPath(assFile)}':fontsdir='${filterPath(fonts)}'[outv]`;
        const length = moment.end - moment.start;
        const args = ['-y', '-ss', moment.start.toFixed(2), '-t', length.toFixed(2), '-i', payload.path,
          '-filter_complex', filter, '-map', '[outv]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
          '-r', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output];
        await ffmpeg(args, length, (percent) => send('clip:progress', { label: 'render', percent: Math.round((index + percent / 100) / items.length * 100), text: `${index + 1}/${items.length}번 굽는 중` }));
        done.push({ id: moment.id, path: output, name: path.basename(output) });
      }
      send('clip:progress', { label: 'render', percent: 100, text: '굽기 끝' });
      return { ok: true, outDir, files: done };
    } catch (error) {
      return { ok: false, error: error.message, files: done };
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
