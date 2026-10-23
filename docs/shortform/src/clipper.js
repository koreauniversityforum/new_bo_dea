// 긴 영상 → 쇼츠 화면. 계산은 main 프로세스(clip-ipc.js · clip-engine.js)가 하고 여기는 고르고 고치는 일만 한다.

const $ = (selector) => document.querySelector(selector);

const LAYOUT_LABEL = { auto: '자동', track: '얼굴 따라가기', split: '두 사람 위아래', fit: '자르지 않고 맞춤' };
const state = {
  status: null,
  jev: false,
  video: null,
  transcript: null,
  moments: [],
  faces: null,
  active: null,
  outDir: null,
  results: [],
  editing: new Set()
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
  state.jev = (await window.studio.clipJevStatus()).ok;
  $('#jevRankButton').hidden = !state.jev;
}

async function pickVideo() {
  const picked = await window.studio.clipPickVideo();
  if (!picked) return;
  state.video = picked;
  state.transcript = null;
  state.moments = [];
  state.faces = null;
  state.results = [];
  state.editing.clear();
  $('#clipFile').textContent = `${picked.name} · ${(picked.size / 1048576).toFixed(0)} MB`;
  $('#analyzeButton').disabled = !(state.status?.whisper && state.status?.ffmpeg);
  $('#previewVideo').src = fileUrl(picked.path);
  $('#clipTools').hidden = true;
  $('#chapterBox').hidden = true;
  renderMoments();
  renderResults();
}

// 받아쓰기(고친 것 포함)에서 구간 안 문장·낱말을 다시 모은다. 시작·끝을 바꾸거나 자막을 고친 뒤 부른다.
function refreshMomentText(moment) {
  const inside = state.transcript.segments.filter((segment) => segment.end > moment.start && segment.start < moment.end);
  moment.segments = inside.map((segment) => ({ start: segment.start, end: segment.end, text: segment.text, words: segment.words || [] }));
  moment.words = inside.flatMap((segment) => segment.words || []).filter((word) => word.e > moment.start && word.s < moment.end);
  moment.text = inside.map((segment) => segment.text).join(' ');
  moment.keep = null;
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
    })).map((moment, index) => ({ ...moment, picked: index < 3, mode: 'auto', captions: true, tighten: false }));
    if (!state.moments.length) {
      $('#momentSummary').textContent = '말소리를 찾지 못해 후보가 없습니다. 말이 들어 있는 영상인지 확인하세요.';
      renderMoments();
      setStatus('후보 없음', 'warn');
      return;
    }
    $('#clipTools').hidden = false;
    renderMoments();
    if (state.status?.opencv) {
      setStatus('얼굴 찾는 중', 'busy');
      showProgress(0, '얼굴·장면 바뀜 찾기');
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
    const cutNote = layout?.cuts?.length ? ` · 장면 바뀜 ${layout.cuts.length}번` : '';
    const layoutText = layout ? `${LAYOUT_LABEL[layout.mode] || layout.mode}${moment.mode === 'auto' ? ` (자동: ${escapeHtml(layout.reason)})` : ''}${cutNote}` : '얼굴 찾는 중';
    const keepText = moment.tighten && moment.keep ? `${moment.keep.cut}초 줄어 ${Math.round((moment.end - moment.start - moment.keep.cut) * 10) / 10}초` : '';
    const editing = state.editing.has(moment.id);
    const segmentRows = editing ? (moment.segments || []).map((segment, row) =>
      `<label>${clock(segment.start)}<input data-field="segment" data-row="${row}" value="${escapeHtml(segment.text)}"></label>`).join('') : '';
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
        <div class="moment-actions">
          <label><input type="checkbox" data-field="captions" ${moment.captions ? 'checked' : ''}> 단어 자막</label>
          <label title="홀로 쓰인 「음·어·아」와 0.7초 넘는 빈 구간을 잘라 냅니다"><input type="checkbox" data-field="tighten" ${moment.tighten ? 'checked' : ''}> 군말·침묵 빼기</label>
          ${keepText ? `<small>${keepText}</small>` : ''}
          <button data-action="edit">${editing ? '자막 고치기 닫기' : '자막 고치기'}</button>
          <button data-action="preview">세로 미리보기</button>
        </div>
        ${editing ? `<div class="segment-edit">${segmentRows}<small style="font-size:9.5px;color:#6c7681">고친 문장은 받아쓰기 원본에도 반영돼 다른 후보에도 같이 들어갑니다. 낱말 수가 같으면 시각을 그대로, 다르면 그 문장 안에서 글자 수대로 다시 나눕니다.</small></div>` : ''}
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
  if (field === 'tighten') {
    moment.tighten = event.target.checked;
    if (moment.tighten && !moment.keep) moment.keep = await window.studio.clipKeepPreview({ moment });
    renderMoments();
  }
  if (field === 'segment') {
    const row = Number(event.target.dataset.row);
    const original = moment.segments[row];
    const edited = await window.studio.clipEditSegment({ segment: original, text: event.target.value });
    // 받아쓰기 원본을 고쳐 두면 시작·끝을 바꿔도, 다른 후보에서도 고친 글이 따라간다.
    const index = state.transcript.segments.findIndex((segment) => segment.start === original.start && segment.end === original.end);
    if (index >= 0) state.transcript.segments[index] = { ...state.transcript.segments[index], text: edited.text, words: edited.words };
    state.moments.forEach((item) => { if (item.end > original.start && item.start < original.end) refreshMomentText(item); });
    renderMoments();
  }
  if (field === 'start' || field === 'end') {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) moment[field] = Math.max(0, value);
    if (moment.end - moment.start < 3) moment.end = moment.start + 3;
    refreshMomentText(moment);
    if (moment.tighten) moment.keep = await window.studio.clipKeepPreview({ moment });
    renderMoments();
  }
  if (field === 'mode') {
    moment.mode = event.target.value;
    if (state.faces) {
      moment.layout = await window.studio.clipRelayout({
        samples: moment.layout?.samples || [], cuts: moment.layout?.cuts || [], width: state.faces.width, height: state.faces.height, mode: moment.mode
      });
    } else {
      // 얼굴 표본이 없으면 따라가기·위아래는 자를 기준이 없다.
      moment.layout = { mode: 'fit', reason: '얼굴 정보가 없어 맞춤으로', samples: [] };
    }
    renderMoments();
  }
  updateRenderButton();
}

function renderPayload(extra = {}) {
  return {
    path: state.video.path,
    title: state.video.name.replace(/\.[^.]+$/, ''),
    width: state.faces?.width || state.transcript.width,
    height: state.faces?.height || state.transcript.height,
    hasAudio: Boolean(state.transcript?.segments?.length),
    transcript: state.transcript,
    outDir: state.outDir,
    style: styleOptions(),
    ...extra
  };
}

function momentForRender(moment) {
  return {
    id: moment.id, start: moment.start, end: moment.end, hook: moment.hook, words: moment.words, text: moment.text,
    segments: moment.segments, captions: moment.captions, tighten: moment.tighten, layout: moment.layout
  };
}

async function onMomentClick(event) {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const card = event.target.closest('.moment-card');
  if (!card) return;
  const moment = state.moments.find((item) => item.id === card.dataset.id);
  if (action === 'edit') {
    if (state.editing.has(moment.id)) state.editing.delete(moment.id); else state.editing.add(moment.id);
    renderMoments();
    return;
  }
  if (action === 'preview') {
    setStatus('세로 미리보기 굽는 중', 'busy');
    const result = await window.studio.clipPreview(renderPayload({ moment: momentForRender(moment) }));
    if (!result.ok) { setStatus('미리보기 실패', 'bad'); showProgress(0, result.error); return; }
    $('#verticalBox').hidden = false;
    $('#verticalVideo').src = `${fileUrl(result.path)}?t=${Date.now()}`;
    $('#verticalVideo').play().catch(() => {});
    $('#verticalNote').textContent = `${state.moments.indexOf(moment) + 1}번 세로 미리보기 (앞 8초, 저화질)`;
    setStatus('미리보기 준비됨', 'good');
    showProgress(100, '세로 미리보기');
    return;
  }
  if (event.target.closest('input, select, label, button')) return;
  state.active = moment.id;
  document.querySelectorAll('.moment-card').forEach((item) => item.classList.toggle('active', item === card));
  const video = $('#previewVideo');
  video.currentTime = moment.start;
  video.play().catch(() => {});
  $('#previewNote').textContent = `${clock(moment.start)} ~ ${clock(moment.end)} 재생 중 (원본 화면 그대로)`;
}

// Jev 판정으로 순위 보정: 새 점수 = 규칙 점수 60% + Jev(따로 보기·끝맺음 평균) 40%.
async function jevRank() {
  if (!state.moments.length) return;
  $('#jevRankButton').disabled = true;
  setStatus('Jev 판정 중', 'busy');
  const result = await window.studio.clipJevRank({ moments: state.moments.map((moment) => ({ id: moment.id, text: moment.text })) });
  $('#jevRankButton').disabled = false;
  if (!result.ok) { setStatus('Jev 실패', 'bad'); showProgress(0, result.error); return; }
  state.moments.forEach((moment) => {
    const judged = result.results[moment.id];
    if (!judged) return;
    moment.ruleScore = moment.ruleScore ?? moment.score;
    moment.score = Math.round(moment.ruleScore * 0.6 + 100 * (judged.standalone + judged.ending) / 2 * 0.4);
    moment.reasons = moment.reasons.filter((reason) => !reason.startsWith('Jev')).concat(`Jev 따로 보기 ${judged.standalone.toFixed(2)} · 끝맺음 ${judged.ending.toFixed(2)}`);
  });
  state.moments.sort((a, b) => b.score - a.score);
  renderMoments();
  setStatus('Jev 판정 반영', 'good');
  showProgress(100, 'Jev 판정으로 순위를 다시 매김 (규칙 60% + Jev 40%)');
}

async function makeChapters() {
  if (!state.transcript) return;
  const list = await window.studio.clipChapters({ transcript: state.transcript });
  $('#chapterBox').hidden = false;
  $('#chapterText').value = list.map((item) => item.label).join('\n');
  $('#chapterNote').textContent = list.length >= 3
    ? `챕터 ${list.length}개. 유튜브 설명란에 붙이면 됩니다(첫 줄 0:00, 3개 이상, 각 10초 이상이 조건).`
    : `챕터 ${list.length}개 - 유튜브는 3개 이상이어야 챕터로 인식합니다. 영상이 짧거나 쉬는 자리가 적습니다.`;
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
  const result = await window.studio.clipRender(renderPayload({ moments: picked.map(momentForRender) }));
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
  box.innerHTML = `<h3 style="margin:0;font-size:12px">완성한 쇼츠 · 게시 글은 영상 옆 _게시글.txt</h3>${state.results.map((file, index) => `
    <div class="clip-result"><span>${escapeHtml(file.name)} · ${file.length}초</span><button data-reveal="${index}">폴더에서 보기</button></div>
    ${file.post ? `<div class="clip-post">제목: ${escapeHtml(file.post.titles[0] || '')}<br>${escapeHtml(file.post.tags.join(' '))} <button data-copy="${index}">게시 글 복사</button></div>` : ''}`).join('')}
    <button id="sendToEditor">편집 창 타임라인으로 보내기</button>`;
}

function postTextOf(file) {
  const post = file.post;
  return [post.titles[0] || '', '', post.description, '', post.tags.join(' ')].join('\n');
}

$('#clipResults').addEventListener('click', async (event) => {
  const reveal = event.target.closest('[data-reveal]');
  if (reveal) window.studio.clipReveal(state.results[Number(reveal.dataset.reveal)].path);
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard.writeText(postTextOf(state.results[Number(copy.dataset.copy)])).catch(() => {});
    showProgress(100, '게시 글을 복사했습니다');
  }
  if (event.target.id === 'sendToEditor') {
    const sent = await window.studio.clipToEditor({ files: state.results, title: state.video?.name.replace(/\.[^.]+$/, '') });
    showProgress(100, `편집 창으로 ${sent}편 보냄`);
  }
});

$('#pickVideoButton').addEventListener('click', pickVideo);
$('#analyzeButton').addEventListener('click', analyze);
$('#renderButton').addEventListener('click', render);
$('#jevRankButton').addEventListener('click', jevRank);
$('#chaptersButton').addEventListener('click', makeChapters);
$('#chapterCopy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#chapterText').value).catch(() => {});
  $('#chapterNote').textContent = '복사했습니다.';
});
$('#chapterSave').addEventListener('click', async () => {
  const file = await window.studio.clipWriteText({ source: state.video.path, outDir: state.outDir, suffix: '챕터', text: $('#chapterText').value });
  $('#chapterNote').textContent = `저장: ${file}`;
});
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
