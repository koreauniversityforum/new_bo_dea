// 긴 영상 → 쇼츠 화면. 계산은 main 프로세스(clip-ipc.js · clip-engine.js)가 하고 여기는 고르고 고치는 일만 한다.

const $ = (selector) => document.querySelector(selector);

const LAYOUT_LABEL = { auto: '자동', track: '얼굴 따라가기', split: '두 사람 위아래', fit: '자르지 않고 맞춤' };
const state = {
  status: null,
  video: null,
  transcript: null,
  moments: [],
  faces: null,
  active: null,
  outDir: null,
  results: []
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function clock(seconds) {
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const secs = String(value % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}
function fileUrl(filePath) { return encodeURI(`file:///${filePath.replaceAll('\\', '/')}`).replaceAll('#', '%23').replaceAll('?', '%3F'); }

function setStatus(text, tone) {
  const box = $('#clipStatus');
  box.querySelector('span').textContent = text;
  box.classList.toggle('busy', tone === 'busy');
  box.querySelector('i').style.background = tone === 'bad' ? '#ff7a68' : tone === 'warn' ? '#f6c453' : tone === 'busy' ? '#8fd0ff' : '#6ee7a8';
}

function showProgress(percent, text) {
  $('#clipProgress').hidden = false;
  $('#clipBarFill').style.width = `${percent}%`;
  $('#clipProgressText').textContent = `${percent}% · ${text || ''}`;
}

async function checkEnvironment() {
  const status = await window.studio.clipStatus();
  state.status = status;
  const note = $('#clipEnvNote');
  if (!status.ok) {
    setStatus('파이썬 없음', 'bad');
    note.hidden = false;
    note.textContent = `${status.error} 이 기능은 파이썬 + faster-whisper 가 깔린 PC 에서만 됩니다.`;
    return;
  }
  const missing = [];
  if (!status.ffmpeg) missing.push('ffmpeg');
  if (!status.whisper) missing.push('faster-whisper (pip install faster-whisper)');
  if (!status.opencv) missing.push('opencv-python (얼굴 찾기 · 없으면 자르지 않고 맞춤만)');
  if (missing.length) {
    note.hidden = false;
    note.textContent = `없는 것: ${missing.join(', ')}`;
  }
  setStatus(status.whisper && status.ffmpeg ? `준비됨 · 파이썬 ${status.python}` : '일부만 준비됨', status.whisper && status.ffmpeg ? 'good' : 'warn');
}

async function pickVideo() {
  const picked = await window.studio.clipPickVideo();
  if (!picked) return;
  state.video = picked;
  state.transcript = null;
  state.moments = [];
  state.faces = null;
  state.results = [];
  $('#clipFile').textContent = `${picked.name} · ${(picked.size / 1048576).toFixed(0)} MB`;
  $('#analyzeButton').disabled = !(state.status?.whisper && state.status?.ffmpeg);
  $('#previewVideo').src = fileUrl(picked.path);
  renderMoments();
  renderResults();
}

async function analyze() {
  if (!state.video) return;
  $('#analyzeButton').disabled = true;
  $('#renderButton').disabled = true;
  setStatus('받아쓰는 중', 'busy');
  showProgress(1, '받아쓰기 시작');
  try {
    if (!state.transcript || state.transcript.model !== $('#modelSelect').value) {
      const result = await window.studio.clipTranscribe({ path: state.video.path, model: $('#modelSelect').value, lang: 'ko' });
      if (!result.ok) throw new Error(result.error);
      state.transcript = result.transcript;
    }
    const min = Math.max(5, Number($('#minLength').value) || 15);
    const max = Math.max(min + 5, Number($('#maxLength').value) || 60);
    state.moments = (await window.studio.clipMoments({
      transcript: state.transcript,
      options: { min, max, target: Math.round((min + max) / 2), count: Number($('#countSelect').value) || 6 }
    })).map((moment, index) => ({ ...moment, picked: index < 3, mode: 'auto', captions: true }));
    if (!state.moments.length) {
      $('#momentSummary').textContent = '말소리를 찾지 못해 후보가 없습니다. 말이 들어 있는 영상인지 확인하세요.';
      renderMoments();
      setStatus('후보 없음', 'warn');
      return;
    }
    renderMoments();
    if (state.status?.opencv) {
      setStatus('얼굴 찾는 중', 'busy');
      showProgress(0, '얼굴 찾기');
      const faces = await window.studio.clipFaces({ path: state.video.path, moments: state.moments });
      if (faces.ok) {
        state.faces = faces;
        state.moments.forEach((moment) => { moment.layout = faces.layouts[moment.id]; });
      } else {
        $('#clipEnvNote').hidden = false;
        $('#clipEnvNote').textContent = `얼굴 찾기 실패 → 자르지 않고 맞춤으로 굽습니다. (${faces.error})`;
      }
    }
    state.moments.forEach((moment) => { if (!moment.layout) moment.layout = { mode: 'fit', reason: '얼굴 정보 없음', samples: [] }; });
    renderMoments();
    setStatus('후보 준비됨', 'good');
    showProgress(100, `후보 ${state.moments.length}개`);
  } catch (error) {
    setStatus('실패', 'bad');
    showProgress(0, error.message);
  } finally {
    $('#analyzeButton').disabled = false;
    updateRenderButton();
  }
}

function renderMoments() {
  const list = $('#momentList');
  if (!state.moments.length) { list.innerHTML = ''; return; }
  const total = state.transcript?.duration || 0;
  $('#momentSummary').textContent = `원본 ${clock(total)} · 받아쓰기 ${state.transcript?.segments?.length || 0}문장 · 후보 ${state.moments.length}개 (점수는 이 영상 안에서의 상대값)`;
  list.innerHTML = state.moments.map((moment, index) => {
    const layout = moment.layout;
    const layoutText = layout ? `${LAYOUT_LABEL[layout.mode] || layout.mode}${moment.mode === 'auto' ? ` (자동: ${escapeHtml(layout.reason)})` : ''}` : '얼굴 찾는 중';
    return `<article class="moment-card${state.active === moment.id ? ' active' : ''}" data-id="${moment.id}">
      <input type="checkbox" data-field="picked" ${moment.picked ? 'checked' : ''} aria-label="굽기 대상">
      <div>
        <div class="moment-top"><strong>${index + 1}번</strong><span class="score">${moment.score}점</span><span class="time">${clock(moment.start)} ~ ${clock(moment.end)} · ${Math.round(moment.end - moment.start)}초</span></div>
        <div class="moment-reasons">${moment.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
        <p class="moment-text">${escapeHtml(moment.text)}</p>
        <div class="moment-fields">
          <label>첫 화면 훅 문구<input data-field="hook" value="${escapeHtml(moment.hook)}" maxlength="40"></label>
          <label>세로 자르기<select data-field="mode">${Object.entries(LAYOUT_LABEL).map(([key, label]) => `<option value="${key}" ${moment.mode === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <label>시작(초)<input data-field="start" type="number" step="0.5" value="${moment.start}"></label>
          <label>끝(초)<input data-field="end" type="number" step="0.5" value="${moment.end}"></label>
        </div>
        <div class="moment-layout">자르기: <b>${layoutText}</b></div>
        <label class="moment-caption-toggle"><input type="checkbox" data-field="captions" ${moment.captions ? 'checked' : ''}> 단어 자막 넣기</label>
      </div>
    </article>`;
  }).join('');
}

async function onMomentChange(event) {
  const card = event.target.closest('.moment-card');
  const field = event.target.dataset.field;
  if (!card || !field) return;
  const moment = state.moments.find((item) => item.id === card.dataset.id);
  if (field === 'picked' || field === 'captions') moment[field] = event.target.checked;
  if (field === 'hook') moment.hook = event.target.value;
  if (field === 'start' || field === 'end') {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) moment[field] = Math.max(0, value);
    if (moment.end - moment.start < 3) moment.end = moment.start + 3;
    // 단어는 받아쓰기 전체에서 다시 고른다(구간을 넓혀도 자막이 따라오게).
    moment.words = state.transcript.segments.flatMap((segment) => segment.words || []).filter((word) => word.e > moment.start && word.s < moment.end);
  }
  if (field === 'mode') {
    moment.mode = event.target.value;
    if (state.faces) {
      moment.layout = await window.studio.clipRelayout({
        samples: moment.layout?.samples || [], width: state.faces.width, height: state.faces.height, mode: moment.mode
      });
    } else {
      // 얼굴 표본이 없으면 따라가기·위아래는 자를 기준이 없다.
      moment.layout = { mode: 'fit', reason: '얼굴 정보가 없어 맞춤으로', samples: [] };
    }
    renderMoments();
  }
  updateRenderButton();
}

function onMomentClick(event) {
  if (event.target.closest('input, select, label')) return;
  const card = event.target.closest('.moment-card');
  if (!card) return;
  const moment = state.moments.find((item) => item.id === card.dataset.id);
  state.active = moment.id;
  document.querySelectorAll('.moment-card').forEach((item) => item.classList.toggle('active', item === card));
  const video = $('#previewVideo');
  video.currentTime = moment.start;
  video.play().catch(() => {});
  $('#previewNote').textContent = `${clock(moment.start)} ~ ${clock(moment.end)} 재생 중 (원본 화면 그대로)`;
}

function updateRenderButton() {
  const count = state.moments.filter((moment) => moment.picked).length;
  $('#renderButton').disabled = !count;
  $('#renderButton').textContent = count ? `고른 후보 ${count}개 굽기` : '고른 후보 굽기';
}

function styleOptions() {
  return {
    font: $('#fontSelect').value,
    size: Number($('#sizeInput').value),
    activeColor: $('#activeColor').value,
    captionY: Number($('#captionY').value) / 100,
    hookSeconds: Number($('#hookSeconds').value)
  };
}

async function render() {
  const picked = state.moments.filter((moment) => moment.picked);
  if (!picked.length) return;
  $('#renderButton').disabled = true;
  setStatus('굽는 중', 'busy');
  showProgress(0, '굽기 시작');
  const result = await window.studio.clipRender({
    path: state.video.path,
    title: state.video.name.replace(/\.[^.]+$/, ''),
    width: state.faces?.width || state.transcript.width,
    height: state.faces?.height || state.transcript.height,
    outDir: state.outDir,
    style: styleOptions(),
    moments: picked.map((moment) => ({
      id: moment.id, start: moment.start, end: moment.end, hook: moment.hook, words: moment.words,
      captions: moment.captions, layout: moment.layout
    }))
  });
  state.results = result.files || [];
  state.resultDir = result.outDir;
  renderResults();
  if (result.ok) { setStatus(`${state.results.length}편 완성`, 'good'); showProgress(100, `저장: ${result.outDir}`); }
  else { setStatus('굽기 실패', 'bad'); showProgress(0, result.error); }
  updateRenderButton();
}

function renderResults() {
  const box = $('#clipResults');
  if (!state.results.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<h3 style="margin:0;font-size:12px">완성한 쇼츠</h3>${state.results.map((file, index) => `
    <div class="clip-result"><span>${escapeHtml(file.name)}</span><button data-reveal="${index}">폴더에서 보기</button></div>`).join('')}
    <button id="sendToEditor">편집 창 타임라인으로 보내기</button>`;
}

$('#clipResults').addEventListener('click', async (event) => {
  const reveal = event.target.closest('[data-reveal]');
  if (reveal) window.studio.clipReveal(state.results[Number(reveal.dataset.reveal)].path);
  if (event.target.id === 'sendToEditor') {
    const sent = await window.studio.clipToEditor({ files: state.results, title: state.video?.name.replace(/\.[^.]+$/, '') });
    showProgress(100, `편집 창으로 ${sent}편 보냄`);
  }
});

$('#pickVideoButton').addEventListener('click', pickVideo);
$('#analyzeButton').addEventListener('click', analyze);
$('#renderButton').addEventListener('click', render);
$('#momentList').addEventListener('change', onMomentChange);
$('#momentList').addEventListener('click', onMomentClick);
$('#outDirButton').addEventListener('click', async () => {
  const folder = await window.studio.clipPickOutDir();
  if (folder) { state.outDir = folder; $('#outDirLabel').textContent = folder; }
});
[['#sizeInput', '#sizeValue', ''], ['#captionY', '#captionYValue', '%'], ['#hookSeconds', '#hookSecondsValue', '초']].forEach(([input, label, unit]) => {
  $(input).addEventListener('input', () => { $(label).textContent = `${$(input).value}${unit}`; });
});
$('#previewVideo').addEventListener('timeupdate', () => {
  const moment = state.moments.find((item) => item.id === state.active);
  const video = $('#previewVideo');
  if (moment && video.currentTime >= moment.end) video.pause();
});
window.studio.onClipProgress((progress) => {
  if (progress.label === 'check') return;
  showProgress(progress.percent, progress.text);
});

checkEnvironment();
