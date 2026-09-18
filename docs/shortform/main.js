const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EdgeTTS } = require('node-edge-tts');
const { discoverShorts, searchLinkFor } = require('./src/hunter-engine');
const { analyzeCollection, buildConcept, blueprintFrom, updateBlueprint, conceptFromBlueprint, blueprintOptions } = require('./src/shortform-analysis');
const { searchWebMedia, downloadMedia, downloadFromUrl, readCredits } = require('./src/media-library');

let editorWindow;
let trendsWindow;

// 뉴보대 카드뉴스 메이커가 「숏폼 만들기」로 이 앱을 띄울 때 넘기는 맥락 파일.
//   Shortform Studio.exe --from-newbodae=<context.json 경로>
// 파일 안: { keyword, title, images:[절대경로...], source:'newbodae' }
// 두 번째로 켜면 새 창을 또 띄우지 않고 이미 뜬 창에 맥락만 다시 보낸다(single instance).
let pendingContext = null;

function contextPathFromArgv(argv) {
  const flag = (argv || []).find((value) => String(value).startsWith('--from-newbodae='));
  return flag ? flag.slice('--from-newbodae='.length).replace(/^"|"$/g, '') : null;
}

function readContextFile(filePath) {
  if (!filePath) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const images = (Array.isArray(data.images) ? data.images : [])
      .filter((file) => typeof file === 'string' && fs.existsSync(file) && mediaExtensions.has(path.extname(file).toLowerCase()))
      .map(describeMedia);
    return {
      source: data.source || 'newbodae',
      keyword: String(data.keyword || '').trim(),
      title: String(data.title || '').trim(),
      media: images
    };
  } catch (error) {
    console.error('뉴보대 맥락 파일을 읽지 못했습니다:', error.message);
    return null;
  }
}

// 편집 창에는 카드 그림을 소재로, 헌터 창에는 검색어를 넣어 바로 수집시킨다.
function applyContext(context) {
  if (!context) return;
  if (!editorWindow || editorWindow.isDestroyed()) createEditorWindow();
  const sendToEditor = () => editorWindow.webContents.send('newbodae:context', context);
  if (editorWindow.webContents.isLoading()) editorWindow.webContents.once('did-finish-load', sendToEditor);
  else sendToEditor();
  editorWindow.show();
  editorWindow.focus();
  if (context.keyword) {
    createTrendsWindow();
    const sendToHunter = () => trendsWindow && !trendsWindow.isDestroyed() && trendsWindow.webContents.send('hunter:prefill', { keyword: context.keyword });
    if (trendsWindow.webContents.isLoading()) trendsWindow.webContents.once('did-finish-load', sendToHunter);
    else sendToHunter();
  }
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const context = readContextFile(contextPathFromArgv(argv));
    if (context) applyContext(context);
    else if (editorWindow && !editorWindow.isDestroyed()) { editorWindow.show(); editorWindow.focus(); }
  });
}

// 일부 Windows 그래픽 드라이버에서 Chromium GPU 프로세스가 종료되는 문제를 피한다.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const preload = path.join(__dirname, 'preload.js');
const mediaExtensions = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']);

function createEditorWindow() {
  editorWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#0b0d10',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  editorWindow.loadFile(path.join(__dirname, 'src', 'editor.html'));
  if (process.env.SHORTFORM_QA_SCREENSHOT) {
    editorWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.SHORTFORM_QA_VIEW === 'hunter') {
          // 네트워크 없이 헌터 화면을 검증한다: 가짜 숏폼 2편을 넣고 담기 -> 분해까지 누른다.
          createTrendsWindow();
          await new Promise((resolve) => trendsWindow.webContents.once('did-finish-load', resolve));
          await trendsWindow.webContents.executeJavaScript(`(async () => {
            state.keyword = '자취 요리';
            state.items = [
              { id: 'r1', title: '자취 요리 왜 다들 이렇게 할까?', caption: '해봤어요', durationSeconds: 32, views: 120000, likes: 4000, comments: 120, metrics: { engagementRate: 3.4, viewsPerDay: 9000 }, hashtags: ['자취'], platform: 'youtube', platformLabel: 'YouTube Shorts', creator: '테스트A', url: 'https://example.com/1', publishedAt: new Date().toISOString(), dataNote: '공개 페이지 수집' },
              { id: 'r2', title: '요리 3가지만 기억하세요', durationSeconds: 20, views: 50000, likes: 900, comments: 40, metrics: { engagementRate: 1.9, viewsPerDay: 2000 }, platform: 'tiktok', platformLabel: 'TikTok', creator: '테스트B', url: 'https://example.com/2', publishedAt: new Date().toISOString(), dataNote: '공식 API' }
            ];
            state.platformStatus = [{ platform: 'youtube', label: 'YouTube Shorts', mode: 'public', count: 1 }, { platform: 'tiktok', label: 'TikTok', mode: 'api', count: 1 }];
            renderAll();
            togglePick('r1'); togglePick('r2');
            await decompose();
            window.scrollTo(0, document.getElementById('blueprintBlock').offsetTop - 20);
          })()`);
          await new Promise((resolve) => setTimeout(resolve, 600));
          const shot = await trendsWindow.capturePage();
          fs.writeFileSync(process.env.SHORTFORM_QA_SCREENSHOT, shot.toPNG());
          app.quit();
          return;
        }
        if (process.env.SHORTFORM_QA_VIEW === 'media') {
          await editorWindow.webContents.executeJavaScript("document.getElementById('webMediaButton').click()");
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const image = await editorWindow.capturePage();
        fs.writeFileSync(process.env.SHORTFORM_QA_SCREENSHOT, image.toPNG());
        app.quit();
      }, 900);
    });
  }
}

function createTrendsWindow() {
  if (trendsWindow && !trendsWindow.isDestroyed()) {
    trendsWindow.focus();
    return;
  }
  trendsWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#080a0d',
    title: '콘텐츠 헌터 · Shortform Studio',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  trendsWindow.loadFile(path.join(__dirname, 'src', 'hunter.html'));
  trendsWindow.on('closed', () => { trendsWindow = null; });
}

app.whenReady().then(() => {
  createEditorWindow();
  pendingContext = readContextFile(contextPathFromArgv(process.argv));
  if (pendingContext) applyContext(pendingContext);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createEditorWindow();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('window:trends', () => { createTrendsWindow(); return true; });
ipcMain.handle('external:open', (_event, url) => shell.openExternal(url));

// 헌터 창에서 편집 앱의 연결 설정 화면을 연다.
ipcMain.handle('window:settings', () => {
  if (!editorWindow || editorWindow.isDestroyed()) createEditorWindow();
  editorWindow.show();
  editorWindow.focus();
  editorWindow.webContents.send('settings:open');
  return true;
});

ipcMain.handle('media:pick', async () => {
  const result = await dialog.showOpenDialog(editorWindow, {
    title: '영상, 사진, 음악 불러오기',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '미디어', extensions: [...mediaExtensions].map((value) => value.slice(1)) },
      { name: '모든 파일', extensions: ['*'] }
    ]
  });
  if (result.canceled) return [];
  return result.filePaths.filter((file) => mediaExtensions.has(path.extname(file).toLowerCase())).map(describeMedia);
});

function describeMedia(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = ['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext) ? 'video'
    : ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? 'image' : 'audio';
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: path.basename(filePath), path: filePath, type };
}

ipcMain.handle('concept:select', (_event, concept) => {
  if (!editorWindow || editorWindow.isDestroyed()) createEditorWindow();
  editorWindow.show();
  editorWindow.focus();
  editorWindow.webContents.send('concept:selected', concept);
  return true;
});

// 콘텐츠 헌터: 공개 숏폼 수집 -> 패턴 분석 -> 새 대본 생성까지 한 번에 돌려준다.
ipcMain.handle('hunter:load', async (_event, options = {}) => {
  const found = await discoverShorts({ ...options, settings: readSettings() });
  const analysis = analyzeCollection(found.items, found.keyword);
  const concept = analysis.sampleSize ? buildConcept(found.keyword, analysis) : null;
  return { ...found, analysis, concept };
});

// 같은 분석에서 다른 문장 조합을 다시 뽑는다.
ipcMain.handle('hunter:remix', (_event, payload = {}) => {
  const { keyword, analysis, variant } = payload;
  if (!analysis?.sampleSize) return null;
  return buildConcept(keyword, analysis, { variant: Number(variant) || 0 });
});

// 레퍼런스 분해: 고른 영상들 -> 편집 가능한 설계도 -> 편집 앱용 콘셉트
ipcMain.handle('hunter:blueprint', (_event, payload = {}) => {
  const blueprint = blueprintFrom(payload.items || [], payload.keyword || '', { variant: payload.variant || 0 });
  return blueprint ? { blueprint, options: blueprintOptions() } : null;
});
ipcMain.handle('hunter:blueprintUpdate', (_event, payload = {}) => updateBlueprint(payload.blueprint, payload.change, payload.options || {}));
ipcMain.handle('hunter:blueprintConcept', (_event, payload = {}) => conceptFromBlueprint(payload.blueprint));

ipcMain.handle('hunter:searchLink', (_event, payload = {}) => searchLinkFor(payload.platform, payload.keyword || ''));

// 인터넷 소재 창고. 내려받은 파일은 앱 폴더에 모으고 출처를 함께 남긴다.
function webMediaDir() {
  return path.join(app.getPath('userData'), 'web-media');
}

function voiceoverDir() {
  return path.join(app.getPath('userData'), 'voiceovers');
}

const KOREAN_VOICES = [
  { name: 'ko-KR-SunHiNeural', culture: 'ko-KR', gender: '여성 · 밝고 또렷함' },
  { name: 'ko-KR-InJoonNeural', culture: 'ko-KR', gender: '남성 · 차분함' }
];

ipcMain.handle('voice:list', async () => ({ ok: true, voices: KOREAN_VOICES }));

ipcMain.handle('voice:generate', async (_event, options = {}) => {
  const text = String(options.text || '').trim().slice(0, 6000);
  if (!text) return { ok: false, error: '음성으로 만들 원고가 비어 있습니다.' };
  const targetDir = voiceoverDir();
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = safeName(options.title || `원고음성-${stamp}`);
  const outputPath = path.join(targetDir, `${base}-${Date.now()}.mp3`);
  try {
    const rate = Math.max(-5, Math.min(5, Number(options.rate) || 0));
    const tts = new EdgeTTS({
      voice: KOREAN_VOICES.some((voice) => voice.name === options.voice) ? options.voice : KOREAN_VOICES[0].name,
      lang: 'ko-KR',
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
      rate: rate ? `${rate > 0 ? '+' : ''}${rate * 10}%` : 'default',
      pitch: 'default',
      volume: 'default',
      timeout: 30000
    });
    await tts.ttsPromise(text, outputPath);
    if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).size) throw new Error('음성 파일이 생성되지 않았습니다.');
    return {
      ok: true,
      media: { id: `voice-${Date.now()}`, name: path.basename(outputPath), path: outputPath, type: 'audio', origin: 'tts', audioRole: 'narration' }
    };
  } catch (error) {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* 정리 실패는 생성 오류보다 중요하지 않다. */ }
    return { ok: false, error: `인터넷 음성 생성 실패: ${error.message}` };
  }
});

ipcMain.handle('webmedia:search', (_event, options = {}) => searchWebMedia({ ...options, settings: readSettings() }));

ipcMain.handle('webmedia:download', async (_event, item) => {
  try {
    return { ok: true, media: await downloadMedia(item, webMediaDir()) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('webmedia:downloadUrl', async (_event, url) => {
  try {
    return { ok: true, media: await downloadFromUrl(url, webMediaDir()) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('webmedia:credits', () => readCredits(webMediaDir()));
ipcMain.handle('webmedia:reveal', () => {
  fs.mkdirSync(webMediaDir(), { recursive: true });
  shell.openPath(webMediaDir());
  return true;
});

// 헌터 창에서 편집 앱의 소재 검색을 바로 연다.
ipcMain.handle('window:webmedia', (_event, payload = {}) => {
  if (!editorWindow || editorWindow.isDestroyed()) createEditorWindow();
  editorWindow.show();
  editorWindow.focus();
  editorWindow.webContents.send('webmedia:open', payload);
  return true;
});




ipcMain.handle('project:save', async (_event, project) => {
  const result = await dialog.showSaveDialog(editorWindow, {
    title: '프로젝트 저장', defaultPath: `${safeName(project.title || '새 프로젝트')}.shortform.json`,
    filters: [{ name: 'Shortform Studio 프로젝트', extensions: ['shortform.json', 'json'] }]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, JSON.stringify(project, null, 2), 'utf8');
  return result.filePath;
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(editorWindow, { properties: ['openFile'], filters: [{ name: 'Shortform Studio 프로젝트', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  return JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
});

ipcMain.handle('settings:load', () => readSettings());
ipcMain.handle('settings:save', (_event, settings) => {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  return true;
});

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}

ipcMain.handle('video:export', async (_event, project) => {
  const result = await dialog.showSaveDialog(editorWindow, {
    title: '숏폼 영상 내보내기', defaultPath: `${safeName(project.title || 'shortform')}.mp4`, filters: [{ name: 'MP4 영상', extensions: ['mp4'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    await renderWithFfmpeg(project, result.filePath, (percent) => {
      if (editorWindow && !editorWindow.isDestroyed()) editorWindow.webContents.send('export:progress', percent);
    });
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

function safeName(value) { return value.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 70) || 'shortform'; }
function escapeDrawtext(value) { return String(value).replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'").replaceAll('%', '\\%'); }

function projectFontFile(fontName) {
  const files = {
    'Noto Sans KR Local': 'NotoSansKR-Variable.ttf', 'Black Han Sans': 'BlackHanSans-Regular.ttf',
    'Do Hyeon': 'DoHyeon-Regular.ttf', Jua: 'Jua-Regular.ttf',
    'Gowun Dodum': 'GowunDodum-Regular.ttf', 'Nanum Myeongjo': 'NanumMyeongjo-Regular.ttf'
  };
  const file = files[fontName] || files['Noto Sans KR Local'];
  const base = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : __dirname;
  const candidate = path.join(base, 'assets', 'fonts', file);
  return fs.existsSync(candidate) ? candidate : 'C:\\Windows\\Fonts\\malgunbd.ttf';
}

function escapeFilterPath(filePath) { return filePath.replaceAll('\\', '/').replace(':', '\\:').replaceAll("'", "\\'"); }

// ffmpeg 필터 문자열에 한글 경로가 들어가면 drawtext 가 글꼴을 못 읽는다.
// (입력·출력 파일 경로는 멀쩡한데 필터 안의 경로만 깨진다.)
// 그래서 글꼴과 자막 파일은 영문 경로에 복사해 두고 그 사본을 가리킨다.
function isAsciiPath(value) {
  return !/[^\x20-\x7E]/.test(String(value));
}

function asciiWorkRoot() {
  const candidates = [
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'ShortformStudio'),
    path.join(process.env.SystemDrive || 'C:', 'ShortformStudio-temp'),
    app.getPath('temp')
  ];
  for (const directory of candidates) {
    if (!isAsciiPath(directory)) continue;
    try {
      fs.mkdirSync(directory, { recursive: true });
      const probe = path.join(directory, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return directory;
    } catch { /* 다음 후보를 시도한다. */ }
  }
  return app.getPath('temp');
}

// 타임라인을 그대로 영상으로 굽는다.
// 화면에서 본 시작 시각, 길이, 자막 위치, 전환, 키프레임이 같은 값으로 들어간다.
function captionFontFile(project, caption, workDir) {
  const source = projectFontFile(caption.style?.font || project.font);
  if (isAsciiPath(source)) return source;
  const copy = path.join(workDir, `font-${path.basename(source).replace(/[^0-9a-zA-Z.]/g, '')}`);
  if (!fs.existsSync(copy)) fs.copyFileSync(source, copy);
  return copy;
}

function captionTextFile(directory, index, text) {
  const file = path.join(directory, `caption-${index}.txt`);
  // 자막은 파일로 넘긴다. 따옴표나 콜론이 섞여도 필터가 깨지지 않는다.
  fs.writeFileSync(file, wrapCaption(text), 'utf8');
  return file;
}

// drawtext 는 줄바꿈을 스스로 하지 않는다. 한국어 기준으로 미리 끊어 준다.
function wrapCaption(text, perLine = 16) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    if (!line.length) line = word;
    else if ((line + ' ' + word).length <= perLine) line += ` ${word}`;
    else { lines.push(line); line = word; }
  });
  if (line) lines.push(line);
  return lines.join('\n');
}

function captionY(caption) {
  const position = caption.style?.position || 'bottom';
  const base = { top: 0.16, middle: 0.5, bottom: 0.82 }[position] ?? 0.82;
  const offset = (Number(caption.style?.offset) || 0) / 100;
  return Math.max(0.05, Math.min(0.95, base + offset));
}

function captionX(caption) {
  const align = caption.style?.align || 'center';
  if (align === 'left') return '80';
  if (align === 'right') return 'w-text_w-80';
  return '(w-text_w)/2';
}

// 키프레임(확대·이동). crop 의 폭·높이는 시간에 따라 못 바꾸므로 zoompan 으로 만든다.
function keyframeFilter(clip) {
  const keys = clip.keyframes || {};
  const startScale = Math.max(100, Number(keys.startScale) || 100) / 100;
  const endScale = Math.max(100, Number(keys.endScale) || 100) / 100;
  const panX = Number(keys.panX) || 0;
  const panY = Number(keys.panY) || 0;
  if (startScale === 1 && endScale === 1 && !panX && !panY) {
    return 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30';
  }
  const frames = Math.max(2, Math.round(clip.duration * 30)) - 1;
  const zoom = `${startScale.toFixed(3)}+(${(endScale - startScale).toFixed(3)})*on/${frames}`;
  const moveX = (panX * 6).toFixed(1);
  const moveY = (panY * 6).toFixed(1);
  return [
    'fps=30',
    'scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840',
    `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)+${moveX}*on/${frames}':y='ih/2-(ih/zoom/2)+${moveY}*on/${frames}':d=1:s=1080x1920:fps=30`
  ].join(',');
}

function overlayX(clip) {
  if (clip.transition === 'slide') {
    const start = clip.start.toFixed(2);
    const duration = Math.max(0.05, Number(clip.transitionDuration) || 0.35).toFixed(2);
    return `'if(lt(t-${start},${duration}),(1-(t-${start})/${duration})*W,0)'`;
  }
  return '0';
}

// 앞 클립과 물리는 구간에서 알파를 녹여야 진짜 디졸브가 된다.
// alpha=1 을 빼면 색만 검게 빠져서 앞 영상이 아니라 검은 화면이 비친다.
// 뒤 클립이 위에 겹쳐 오므로 끝 페이드는 마지막 클립에서만 쓴다.
function transitionFilter(clip, isLast) {
  const duration = Math.max(0.05, Number(clip.transitionDuration) || 0.35);
  const d = duration.toFixed(2);
  const endStart = Math.max(0, clip.duration - duration).toFixed(2);
  const tail = isLast ? `,fade=t=out:st=${endStart}:d=${d}:alpha=1` : '';
  if (clip.transition === 'flash') return `,fade=t=in:st=0:d=${d}:color=white${tail}`;
  if (clip.transition === 'blur') return `,gblur=sigma=8:enable='lt(t,${d})',fade=t=in:st=0:d=${d}:alpha=1${tail}`;
  if (clip.transition === 'fade' || clip.transition === 'zoom') return `,fade=t=in:st=0:d=${d}:alpha=1${tail}`;
  return tail;
}

async function renderWithFfmpeg(project, outputPath, onProgress) {
  const timeline = project.timeline || { video: [], caption: [], audio: [] };
  const tracks = project.tracks || {};
  const videoClips = (tracks.video?.hidden ? [] : timeline.video || [])
    .slice().sort((a, b) => a.start - b.start).slice(0, 40);
  const captions = (tracks.caption?.hidden ? [] : timeline.caption || []).slice(0, 40);
  const audioClips = (tracks.audio?.muted ? [] : timeline.audio || []).slice(0, 8);
  const duration = Math.max(
    3,
    Number(project.duration) || 0,
    ...[...videoClips, ...captions, ...audioClips].map((clip) => clip.start + clip.duration)
  );

  const workDir = fs.mkdtempSync(path.join(asciiWorkRoot(), 'render-'));
  const args = ['-y'];
  const filters = [];

  filters.push(`color=c=${normalizeColor(project.palette?.[0] || '#101418')}:s=1080x1920:r=30:d=${duration.toFixed(2)}[bg]`);

  videoClips.forEach((clip) => {
    if (clip.type === 'image') args.push('-loop', '1', '-framerate', '30', '-t', String(clip.duration), '-i', clip.path);
    else args.push('-ss', String(clip.inPoint || 0), '-t', String(clip.duration), '-i', clip.path);
  });
  audioClips.forEach((clip) => {
    args.push('-ss', String(clip.inPoint || 0), '-t', String(clip.duration), '-i', clip.path);
  });

  let last = 'bg';
  videoClips.forEach((clip, index) => {
    const isLast = index === videoClips.length - 1;
    const base = `[${index}:v]${keyframeFilter(clip)},format=yuva420p`;
    const shift = `,setpts=PTS-STARTPTS+${clip.start.toFixed(2)}/TB[v${index}]`;
    if (clip.transition === 'wipe') {
      // 와이프는 자리를 옮기지 않고 왼쪽부터 드러나야 한다. drawbox·crop 의 폭은 시간에 따라 못 바꾸므로
      // 흰 판을 검은 판 위로 밀어 넣어 가리개를 만들고 알파로 붙인다. 시간 이동은 붙인 뒤에 한다.
      const d = Math.max(0.05, Number(clip.transitionDuration) || 0.35).toFixed(2);
      const span = clip.duration.toFixed(2);
      filters.push(`color=c=black:s=1080x1920:r=30:d=${span}[wa${index}]`);
      filters.push(`color=c=white:s=1080x1920:r=30:d=${span}[wb${index}]`);
      filters.push(`[wa${index}][wb${index}]overlay=x='-W+W*min(1,t/${d})':y=0,format=gray[wm${index}]`);
      filters.push(`${base}[wv${index}]`);
      filters.push(`[wv${index}][wm${index}]alphamerge${transitionFilter(clip, isLast)}${shift}`);
    } else {
      filters.push(`${base}${transitionFilter(clip, isLast)}${shift}`);
    }
    const next = `ov${index}`;
    filters.push(`[${last}][v${index}]overlay=x=${overlayX(clip)}:y=0:eof_action=pass:enable='between(t,${clip.start.toFixed(2)},${(clip.start + clip.duration).toFixed(2)})'[${next}]`);
    last = next;
  });

  captions.forEach((caption, index) => {
    if (!String(caption.text || '').trim()) return;
    const textFile = captionTextFile(workDir, index, caption.text);
    const style = caption.style || {};
    const box = style.box ? ':box=1:boxcolor=black@0.45:boxborderw=22' : '';
    const next = `cap${index}`;
    filters.push([
      `[${last}]drawtext=fontfile='${escapeFilterPath(captionFontFile(project, caption, workDir))}'`,
      `textfile='${escapeFilterPath(textFile)}'`,
      // % 가 들어간 자막이 통째로 사라지는 것을 막는다. drawtext 의 기본 확장 기능을 끈다.
      'expansion=none',
      `fontcolor=${(style.color || '#ffffff').replace('#', '0x')}`,
      `fontsize=${Math.round(Number(style.size) || 58)}`,
      'line_spacing=14',
      'borderw=5:bordercolor=black@0.5',
      `x=${captionX(caption)}`,
      `y=h*${captionY(caption).toFixed(3)}-text_h/2`,
      `enable='between(t,${caption.start.toFixed(2)},${(caption.start + caption.duration).toFixed(2)})'${box}`
    ].join(':') + `[${next}]`);
    last = next;
  });

  filters.push(`[${last}]format=yuv420p[outv]`);

  if (audioClips.length) {
    const labels = audioClips.map((clip, index) => {
      const input = videoClips.length + index;
      const delay = Math.round(clip.start * 1000);
      const volume = Math.max(0, (Number(clip.volume) ?? 100) / 100);
      filters.push(`[${input}:a]aresample=44100,volume=${volume.toFixed(2)},adelay=${delay}|${delay}[a${index}]`);
      return `[a${index}]`;
    });
    filters.push(audioClips.length > 1
      ? `${labels.join('')}amix=inputs=${audioClips.length}:dropout_transition=0:normalize=0[outa]`
      : `${labels[0]}anull[outa]`);
  }

  args.push('-filter_complex', filters.join(';'), '-map', '[outv]');
  if (audioClips.length) args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k');
  else args.push('-an');
  args.push('-t', duration.toFixed(2), '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outputPath);

  try {
    await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, { windowsHide: true });
      let errorText = '';
      child.stderr.on('data', (chunk) => {
        const line = chunk.toString();
        errorText += line;
        const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (match && onProgress) {
          const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          onProgress(Math.min(99, Math.round(seconds / duration * 100)));
        }
      });
      child.on('error', (error) => reject(new Error(`FFmpeg 실행 실패: ${error.message}. ffmpeg 설치를 확인해 주세요.`)));
      child.on('close', (code) => code === 0
        ? resolve()
        : reject(new Error(errorText.split('\n').filter(Boolean).slice(-8).join('\n') || `FFmpeg 종료 코드 ${code}`)));
    });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function normalizeColor(value) { return value.replace('#', '0x'); }

ipcMain.handle('publish:start', async (_event, payload) => {
  const settings = readSettings();
  const platforms = payload.platforms || [];
  const results = [];
  for (const platform of platforms) {
    try {
      if (platform === 'youtube') results.push({ platform, ...(await publishYouTube(payload, settings.youtube || {})) });
      if (platform === 'tiktok') results.push({ platform, ...(await publishTikTok(payload, settings.tiktok || {})) });
      if (platform === 'instagram') results.push({ platform, ...(await publishInstagram(payload, settings.instagram || {})) });
    } catch (error) { results.push({ platform, ok: false, message: error.message }); }
  }
  return results;
});

async function publishYouTube(payload, config) {
  if (!config.accessToken) throw new Error('YouTube 액세스 토큰을 설정해 주세요.');
  const metadata = { snippet: { title: payload.title, description: payload.description || '', categoryId: '22', tags: payload.tags || [] }, status: { privacyStatus: payload.privacy || 'private', selfDeclaredMadeForKids: false } };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4' }, body: JSON.stringify(metadata)
  });
  if (!init.ok) throw new Error(`YouTube 업로드 준비 실패: ${await init.text()}`);
  const location = init.headers.get('location');
  const video = fs.readFileSync(payload.videoPath);
  const upload = await fetch(location, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length) }, body: video });
  if (!upload.ok) throw new Error(`YouTube 업로드 실패: ${await upload.text()}`);
  const data = await upload.json();
  return { ok: true, message: 'YouTube 업로드 완료', url: `https://youtu.be/${data.id}` };
}

async function publishTikTok(payload, config) {
  if (!config.accessToken) throw new Error('TikTok 액세스 토큰을 설정해 주세요.');
  const size = fs.statSync(payload.videoPath).size;
  const init = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ post_info: { title: [payload.description, ...(payload.tags || []).map((tag) => `#${tag}`)].filter(Boolean).join(' ').slice(0, 2200), privacy_level: config.privacyLevel || 'SELF_ONLY', disable_duet: false, disable_comment: false, disable_stitch: false }, source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } })
  });
  const initData = await init.json();
  if (!init.ok || !initData.data?.upload_url) throw new Error(`TikTok 업로드 준비 실패: ${JSON.stringify(initData)}`);
  const video = fs.readFileSync(payload.videoPath);
  const upload = await fetch(initData.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` }, body: video });
  if (!upload.ok) throw new Error(`TikTok 파일 업로드 실패: ${await upload.text()}`);
  return { ok: true, message: 'TikTok 전송 완료', publishId: initData.data.publish_id };
}

async function publishInstagram(payload, config) {
  if (!config.accessToken || !config.userId) throw new Error('Instagram 사용자 ID와 액세스 토큰을 설정해 주세요.');
  if (!payload.publicVideoUrl) throw new Error('Instagram은 접근 가능한 공개 영상 URL이 필요합니다. 발행 창에 영상 URL을 입력해 주세요.');
  const params = new URLSearchParams({ media_type: 'REELS', video_url: payload.publicVideoUrl, caption: [payload.description, ...(payload.tags || []).map((tag) => `#${tag}`)].filter(Boolean).join(' '), access_token: config.accessToken });
  const create = await fetch(`https://graph.instagram.com/v25.0/${config.userId}/media`, { method: 'POST', body: params });
  const container = await create.json();
  if (!create.ok || !container.id) throw new Error(`Instagram 컨테이너 생성 실패: ${JSON.stringify(container)}`);
  for (let count = 0; count < 20; count += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const status = await fetch(`https://graph.instagram.com/v25.0/${container.id}?fields=status_code&access_token=${encodeURIComponent(config.accessToken)}`).then((response) => response.json());
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR' || count === 19) throw new Error(`Instagram 영상 처리 실패: ${JSON.stringify(status)}`);
  }
  const publish = await fetch(`https://graph.instagram.com/v25.0/${config.userId}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: container.id, access_token: config.accessToken }) });
  const data = await publish.json();
  if (!publish.ok || !data.id) throw new Error(`Instagram 발행 실패: ${JSON.stringify(data)}`);
  return { ok: true, message: 'Instagram 릴스 발행 완료', mediaId: data.id };
}
