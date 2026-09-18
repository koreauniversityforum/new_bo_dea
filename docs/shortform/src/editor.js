/* Shortform Studio 편집기
 * 클립은 모두 시간 값을 가진다. 화면에 보이는 위치와 내보내는 결과가 같은 값을 쓴다.
 */

const DEFAULT_CAPTION_STYLE = {
  position: 'bottom', size: 62, color: '#ffffff', align: 'center',
  font: '', offset: 0, box: true
};

const PLATFORM_SAFE = {
  instagram: { top: 0.10, bottom: 0.24, right: 0.18, label: 'Instagram Reels' },
  tiktok: { top: 0.09, bottom: 0.28, right: 0.20, label: 'TikTok' },
  youtube: { top: 0.08, bottom: 0.22, right: 0.16, label: 'YouTube Shorts' }
};

const TRANSITIONS = { cut: '컷', fade: '디졸브', slide: '밀기', zoom: '확대', wipe: '와이프', blur: '블러', flash: '플래시' };

const state = {
  title: '새 숏폼 프로젝트',
  hook: '주제를 선택하면 완성된 초안을 만듭니다',
  duration: 25,
  font: 'Noto Sans KR Local',
  palette: ['#ff6b4a', '#ffcf5a', '#17211f'],
  previewPlatform: 'instagram',
  defaultTransition: 'cut',
  defaultTransitionDuration: 0.35,
  concept: null,
  exportedPath: null,
  media: [],
  timeline: { video: [], caption: [], audio: [] },
  tracks: {
    video: { locked: false, hidden: false },
    caption: { locked: false, hidden: false },
    audio: { locked: false, muted: false }
  },
  showSafeZone: true
};

const playback = { current: 0, playing: false, frame: null, lastTimestamp: 0, muted: false };
const history = { undo: [], redo: [] };
let selected = null;      // { track, id }
let mediaFilter = 'all';
let pixelsPerSecond = 34;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  projectTitle: $('#projectTitle'), mediaList: $('#mediaList'), hookInput: $('#hookInput'),
  durationInput: $('#durationInput'), totalTime: $('#totalTime'), currentTime: $('#currentTime'),
  tracks: $('#tracks'), tracksScroll: $('#tracksScroll'), timeRuler: $('#timeRuler'),
  timelineSummary: $('#timelineSummary'), phoneStage: $('#phoneStage'), previewTag: $('#previewTag'),
  qualityScore: $('#qualityScore'), qualityHint: $('#qualityHint'),
  publishDialog: $('#publishDialog'), settingsDialog: $('#settingsDialog'), webMediaDialog: $('#webMediaDialog'), voiceoverDialog: $('#voiceoverDialog'),
  publishStatus: $('#publishStatus'), toast: $('#toast'),
  playButton: $('#playButton'), stagePlayButton: $('#stagePlayButton'), playLine: $('#playLine'),
  playhead: $('#playhead'), previewProgress: $('.preview-progress span'), fontInput: $('#fontInput'),
  platformSwitch: $('#platformPreviewSwitch'), mockPlatformTitle: $('#mockPlatformTitle'),
  mockPlatformTopAction: $('#mockPlatformTopAction'), mockActions: $('#mockActions'),
  mockCaption: $('#mockCaption'), mockMusic: $('#mockMusic'), mockNav: $('#mockNav'),
  stageVideo: $('#stageVideo'), stageImage: $('#stageImage'), stageAudio: $('#stageAudio'),
  stageVideoUnder: $('#stageVideoUnder'), stageImageUnder: $('#stageImageUnder'),
  captionLayer: $('#captionLayer'), safeGuides: $('#safeGuides'), safeZone: $('#safeZone'),
  safeReport: $('#safeReport'), clipInspector: $('#clipInspector'), clipSummary: $('#clipSummary'),
  captionControls: $('#captionControls'), visualControls: $('#visualControls'), audioControls: $('#audioControls')
};

/* ------------------------------------------------------------------ */
/* 공통                                                                */
/* ------------------------------------------------------------------ */

function formatTime(seconds) {
  const value = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fileUrl(filePath) {
  // 웹판: 이 기기 IndexedDB 의 blob 주소(없으면 깃허브 사본) - studio-web.js 가 준다
  return window.studio.fileUrl(filePath);
}

function clipsOf(track) {
  return state.timeline[track] || [];
}

function findClip(track, id) {
  return clipsOf(track).find((clip) => clip.id === id) || null;
}

function selectedClip() {
  return selected ? findClip(selected.track, selected.id) : null;
}

function timelineEnd() {
  return Object.values(state.timeline).flat().reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
}

/* ------------------------------------------------------------------ */
/* 실행 취소 · 다시 실행                                                */
/* ------------------------------------------------------------------ */

function snapshot() {
  return JSON.stringify({ state, selected });
}

// 드래그처럼 값이 연속으로 바뀌는 동작은 시작할 때 한 번만 기록한다.
let pendingHistory = null;

function rememberState(tag = '') {
  if (tag && pendingHistory === tag) return;
  pendingHistory = tag || null;
  history.undo.push(snapshot());
  if (history.undo.length > 60) history.undo.shift();
  history.redo.length = 0;
  updateHistoryButtons();
}

function endHistoryGroup() { pendingHistory = null; }

function applySnapshot(serialized) {
  const parsed = JSON.parse(serialized);
  Object.assign(state, parsed.state);
  selected = parsed.selected;
  pausePlayback();
  render();
}

function undo() {
  if (!history.undo.length) return;
  history.redo.push(snapshot());
  applySnapshot(history.undo.pop());
  showToast('되돌렸습니다.');
}

function redo() {
  if (!history.redo.length) return;
  history.undo.push(snapshot());
  applySnapshot(history.redo.pop());
  showToast('다시 실행했습니다.');
}

function updateHistoryButtons() {
  $('#undoButton').disabled = !history.undo.length;
  $('#redoButton').disabled = !history.redo.length;
  $('#splitClipButton').disabled = !selected;
  $('#deleteClipButton').disabled = !selected;
}

/* ------------------------------------------------------------------ */
/* 타임라인 만들기                                                      */
/* ------------------------------------------------------------------ */

function mediaDuration(item) {
  if (item.type === 'image') return 4;
  return Number(item.durationSeconds) || 6;
}

// 실제 파일 길이를 읽어 클립 길이로 쓴다. 못 읽으면 기본값을 쓴다.
function probeDuration(item) {
  if (item.type === 'image') return Promise.resolve(4);
  return new Promise((resolve) => {
    const node = document.createElement(item.type === 'audio' ? 'audio' : 'video');
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    node.preload = 'metadata';
    node.onloadedmetadata = () => finish(Number.isFinite(node.duration) && node.duration > 0 ? Math.round(node.duration * 10) / 10 : mediaDuration(item));
    node.onerror = () => finish(mediaDuration(item));
    setTimeout(() => finish(mediaDuration(item)), 5000);
    node.src = fileUrl(item.path);
  });
}

async function appendMediaToTimeline(items) {
  const lengths = await Promise.all(items.map(probeDuration));
  items.forEach((item, order) => {
    item.durationSeconds = lengths[order];
    if (item.type === 'audio') {
      state.timeline.audio.push({
        id: newId('a'), mediaId: item.id, name: item.name, path: item.path,
        start: 0, duration: Math.min(lengths[order], Math.max(state.duration, timelineEnd() || state.duration)),
        inPoint: 0, volume: item.audioRole === 'bgm' ? 25 : 100, role: item.audioRole || 'audio'
      });
      return;
    }
    const start = clipsOf('video').reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
    state.timeline.video.push({
      id: newId('v'), mediaId: item.id, name: item.name, path: item.path, type: item.type,
      start: round(start), duration: lengths[order], inPoint: 0,
      transition: state.defaultTransition,
      transitionDuration: state.defaultTransitionDuration,
      keyframes: { startScale: 100, endScale: 100, panX: 0, panY: 0 }
    });
  });
  syncDurationToTimeline();
}

function captionsFromScript(lines, duration) {
  const total = Math.max(4, duration);
  const each = total / Math.max(1, lines.length);
  return lines.map((line, index) => ({
    id: newId('c'), text: line,
    start: round(each * index), duration: round(each),
    style: { ...DEFAULT_CAPTION_STYLE, position: index === 0 ? 'top' : 'bottom' }
  }));
}

function captionsFromScenes(scenes) {
  return scenes.map((scene, index) => ({
    id: newId('c'), text: scene.caption,
    start: round(Number(scene.start) || 0),
    duration: round(Math.max(0.6, (Number(scene.end) || 0) - (Number(scene.start) || 0)) || 3),
    style: {
      ...DEFAULT_CAPTION_STYLE,
      position: index === 0 ? 'top' : /행동 유도/.test(scene.emphasis || '') ? 'bottom' : 'middle',
      size: index === 0 ? 72 : 58
    }
  }));
}

function syncDurationToTimeline() {
  const end = timelineEnd();
  if (end > 0) state.duration = Math.max(5, Math.ceil(end));
  state.timeline.audio.forEach((clip) => {
    if (clip.duration > state.duration) clip.duration = state.duration;
  });
}

/* ------------------------------------------------------------------ */
/* 그리기                                                              */
/* ------------------------------------------------------------------ */

function render() {
  elements.projectTitle.value = state.title;
  elements.hookInput.value = state.hook;
  elements.durationInput.value = state.duration;
  elements.fontInput.value = state.font;
  $('#transitionInput').value = state.defaultTransition;
  elements.totalTime.textContent = formatTime(state.duration);
  elements.phoneStage.style.setProperty('--stage-a', state.palette[0]);
  elements.phoneStage.style.setProperty('--stage-b', state.palette[1]);
  elements.phoneStage.style.setProperty('--project-font', `'${state.font}'`);
  elements.previewTag.textContent = state.concept?.category?.toUpperCase() || 'TREND STORY';
  renderMedia();
  renderTimeline();
  renderInspector();
  renderQuality();
  renderPlatformPreview();
  renderSafeReport();
  updatePlaybackUI();
  updateHistoryButtons();
}

function renderMedia() {
  const media = mediaFilter === 'all' ? state.media : state.media.filter((item) => item.type === mediaFilter);
  elements.mediaList.innerHTML = media.length ? media.map((item) => `
    <article class="media-card ${item.type}" draggable="true" data-media="${escapeHtml(item.id)}" title="${escapeHtml(item.path)}">
      <span class="media-type">${{ video: 'VIDEO', image: 'PHOTO', audio: 'MUSIC' }[item.type]}</span>
      <strong>${escapeHtml(item.name)}</strong>
      ${item.origin === 'web' ? '<em class="from-web">인터넷 소재</em>' : ''}
    </article>`).join('') : '<div class="empty-state">표시할 미디어가 없습니다.</div>';
  $$('[data-media]').forEach((card) => card.addEventListener('dblclick', () => {
    const item = state.media.find((entry) => entry.id === card.dataset.media);
    if (!item) return;
    rememberState();
    appendMediaToTimeline([item]).then(() => {
      render();
      showToast(`${item.name} 을(를) 타임라인 끝에 붙였습니다.`);
    });
  }));
}

function renderTimeline() {
  const total = Math.max(state.duration, timelineEnd(), 5);
  const width = Math.max(640, total * pixelsPerSecond + 80);
  elements.tracks.style.width = `${width}px`;
  elements.timeRuler.style.width = `${width}px`;

  const step = pixelsPerSecond > 60 ? 1 : pixelsPerSecond > 26 ? 2 : 5;
  let ruler = '';
  for (let second = 0; second <= total; second += step) {
    ruler += `<span style="left:${second * pixelsPerSecond}px">${second}s</span>`;
  }
  elements.timeRuler.innerHTML = ruler;

  ['video', 'caption', 'audio'].forEach((track) => {
    const node = $(`.${track}-track`);
    const settings = state.tracks[track];
    node.classList.toggle('locked', settings.locked);
    node.classList.toggle('hidden-track', !!settings.hidden);
    node.classList.toggle('muted-track', !!settings.muted);
    node.innerHTML = clipsOf(track).map((clip) => clipMarkup(track, clip)).join('')
      || `<div class="clip placeholder-clip" style="left:0;width:${Math.min(total, 6) * pixelsPerSecond}px">${trackPlaceholder(track)}</div>`;
  });

  elements.timelineSummary.textContent = `장면 ${clipsOf('video').length} · 자막 ${clipsOf('caption').length} · 오디오 ${clipsOf('audio').length} · 총 ${round(timelineEnd())}초`;
  installClipInteractions();
  $$('.track-label').forEach((label) => {
    const settings = state.tracks[label.dataset.track];
    label.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('on', !!settings[button.dataset.toggle]);
    });
  });
}

function trackPlaceholder(track) {
  return { video: '영상·사진을 끌어다 놓으세요', caption: '자막이 없습니다', audio: '음악·내레이션이 없습니다' }[track];
}

function clipMarkup(track, clip) {
  const left = clip.start * pixelsPerSecond;
  const width = Math.max(18, clip.duration * pixelsPerSecond);
  const isSelected = selected && selected.track === track && selected.id === clip.id;
  const label = track === 'caption' ? clip.text : clip.name;
  const badge = track === 'video' ? (clip.type === 'image' ? 'IMG' : 'VID')
    : track === 'caption' ? 'TXT' : '♫';
  const transition = track === 'video' && clip.transition && clip.transition !== 'cut'
    ? `<b class="clip-transition">${TRANSITIONS[clip.transition]}</b>` : '';
  return `<div class="clip ${isSelected ? 'selected' : ''}" data-track="${track}" data-id="${escapeHtml(clip.id)}" style="left:${left}px;width:${width}px">
    <i class="trim trim-start" data-edge="start"></i>
    <div class="clip-inner"><small>${badge} ${round(clip.duration)}s</small><span>${escapeHtml(label)}</span>${transition}</div>
    <i class="trim trim-end" data-edge="end"></i>
  </div>`;
}

function renderPlatformPreview() {
  const platform = state.previewPlatform;
  const configs = {
    instagram: { title: 'Reels', top: '⌁　⌕　◎', actions: [['♡', '12.8K'], ['◯', '382'], ['➤', '공유'], ['⋯', '']], music: '♫ Original audio · shortform.studio', nav: '⌂　⌕　▣　♡　●' },
    tiktok: { title: '팔로잉　　추천', top: '⌕', actions: [['●', '+'], ['♥', '24.3K'], ['●', '615'], ['↗', '1,204'], ['♫', '']], music: '♫ 오리지널 사운드 - shortform.studio', nav: '홈　친구　　＋　　받은 메시지　프로필' },
    youtube: { title: 'Shorts', top: '⌕　⋮', actions: [['👍', '3.1K'], ['👎', '싫어요'], ['◯', '147'], ['↗', '공유'], ['↻', '리믹스']], music: '♫ 원본 사운드', nav: '홈　Shorts　　＋　　구독　보관함' }
  };
  const config = configs[platform];
  const safe = PLATFORM_SAFE[platform];
  elements.phoneStage.dataset.platform = platform;
  elements.mockPlatformTitle.textContent = config.title;
  elements.mockPlatformTopAction.textContent = config.top;
  elements.mockActions.innerHTML = config.actions.map(([icon, label]) => `<div><i>${icon}</i><span>${label}</span></div>`).join('');
  elements.mockCaption.textContent = state.hook;
  elements.mockMusic.textContent = config.music;
  elements.mockNav.textContent = config.nav;
  elements.platformSwitch.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.platform === platform));
  elements.safeGuides.style.setProperty('--safe-top', `${safe.top * 100}%`);
  elements.safeGuides.style.setProperty('--safe-bottom', `${safe.bottom * 100}%`);
  elements.safeGuides.style.setProperty('--safe-right', `${safe.right * 100}%`);
  elements.safeGuides.hidden = !state.showSafeZone;
  elements.safeZone.hidden = !state.showSafeZone;
  $('#safeToggle').classList.toggle('on', state.showSafeZone);
}

/* 자막이 플랫폼 UI에 가리는지 검사한다. */
function safeAreaIssues() {
  const safe = PLATFORM_SAFE[state.previewPlatform];
  const issues = [];
  clipsOf('caption').forEach((caption, index) => {
    const style = caption.style || DEFAULT_CAPTION_STYLE;
    const height = (style.size / 1920) * 1.6;
    const center = ({ top: 0.16, middle: 0.5, bottom: 0.82 }[style.position] || 0.82) + (style.offset || 0) / 100;
    const top = center - height / 2;
    const bottom = center + height / 2;
    if (top < safe.top) issues.push({ level: 'warn', text: `자막 ${index + 1}이 상단 ${safe.label} 표시 영역에 겹칩니다.` });
    if (bottom > 1 - safe.bottom) issues.push({ level: 'warn', text: `자막 ${index + 1}이 하단 캡션·버튼 영역에 겹칩니다.` });
    if (caption.duration < 1) issues.push({ level: 'info', text: `자막 ${index + 1}이 ${round(caption.duration)}초로 짧아 읽기 어렵습니다.` });
    if (caption.text.length > 34) issues.push({ level: 'info', text: `자막 ${index + 1}이 ${caption.text.length}자입니다. 22자 안쪽으로 줄이면 잘 읽힙니다.` });
  });
  const end = timelineEnd();
  if (end > 0 && clipsOf('video').length === 0) issues.push({ level: 'info', text: '영상 트랙이 비어 있어 배경색으로 렌더링됩니다.' });
  if (state.duration > 60 && state.previewPlatform === 'instagram') issues.push({ level: 'warn', text: 'Instagram Reels 권장 길이를 넘었습니다.' });
  if (state.duration > 180) issues.push({ level: 'warn', text: '숏폼 최대 길이 3분을 넘었습니다.' });
  return issues;
}

function renderSafeReport() {
  const issues = safeAreaIssues();
  const safe = PLATFORM_SAFE[state.previewPlatform];
  elements.safeReport.innerHTML = issues.length
    ? `<strong>${safe.label} 안전 영역 점검 ${issues.length}건</strong>` + issues.slice(0, 4).map((issue) => `<span class="${issue.level}">${escapeHtml(issue.text)}</span>`).join('')
    : `<strong class="ok">${safe.label} 안전 영역 문제 없음</strong>`;
}

function renderQuality() {
  const hasAudio = clipsOf('audio').length > 0;
  const issues = safeAreaIssues().filter((issue) => issue.level === 'warn').length;
  let score = 52 + Math.min(16, clipsOf('video').length * 4) + Math.min(12, clipsOf('caption').length * 2)
    + (state.concept ? 12 : 0) + (hasAudio ? 6 : 0) - issues * 4;
  score = Math.max(20, Math.min(98, score));
  elements.qualityScore.textContent = score;
  $('.quality-card i').style.width = `${score}%`;
  elements.qualityHint.textContent = issues
    ? '안전 영역 경고를 먼저 해결하면 점수가 올라갑니다.'
    : score > 88 ? '훅, 장면, 음악의 조합이 좋습니다. 자막만 검토해 주세요.' : '영상·자막·음악을 채우면 점수가 올라갑니다.';
}

/* ------------------------------------------------------------------ */
/* 검사기 패널                                                          */
/* ------------------------------------------------------------------ */

function renderInspector() {
  const clip = selectedClip();
  elements.clipInspector.hidden = !clip;
  elements.captionControls.hidden = true;
  elements.visualControls.hidden = true;
  elements.audioControls.hidden = true;
  if (!clip) {
    $('#inspectorTitle').textContent = '콘텐츠 설계';
    return;
  }
  $('#inspectorTitle').textContent = { video: '장면 편집', caption: '자막 편집', audio: '오디오 편집' }[selected.track];
  elements.clipSummary.textContent = `${round(clip.start)}초 → ${round(clip.start + clip.duration)}초 · ${round(clip.duration)}초`;

  if (selected.track === 'caption') {
    elements.captionControls.hidden = false;
    const style = clip.style || DEFAULT_CAPTION_STYLE;
    $('#captionText').value = clip.text;
    $('#clipStart').value = round(clip.start);
    $('#clipLength').value = round(clip.duration);
    $('#captionSize').value = style.size;
    $('#captionColor').value = style.color;
    $('#captionAlign').value = style.align;
    $('#captionFont').value = style.font || '';
    $('#captionOffset').value = style.offset || 0;
    $('#captionBox').checked = !!style.box;
    $$('#captionPosition button').forEach((button) => button.classList.toggle('active', button.dataset.value === style.position));
  } else if (selected.track === 'video') {
    elements.visualControls.hidden = false;
    $('#visualStart').value = round(clip.start);
    $('#visualLength').value = round(clip.duration);
    $('#visualIn').value = round(clip.inPoint || 0);
    $('#visualTransition').value = clip.transition || 'cut';
    $('#visualTransitionDuration').value = clip.transitionDuration ?? state.defaultTransitionDuration;
    $('#transitionDurationValue').textContent = `${Number(clip.transitionDuration ?? state.defaultTransitionDuration).toFixed(2)}초`;
    $('#keyStartScale').value = clip.keyframes?.startScale ?? 100;
    $('#keyEndScale').value = clip.keyframes?.endScale ?? 100;
    $('#keyPanX').value = clip.keyframes?.panX ?? 0;
    $('#keyPanY').value = clip.keyframes?.panY ?? 0;
  } else {
    elements.audioControls.hidden = false;
    $('#audioStart').value = round(clip.start);
    $('#audioLength').value = round(clip.duration);
    $('#audioVolume').value = clip.volume ?? 100;
  }
}

/* ------------------------------------------------------------------ */
/* 클립 조작                                                            */
/* ------------------------------------------------------------------ */

function installClipInteractions() {
  $$('.clip[data-id]').forEach((node) => {
    const track = node.dataset.track;
    if (state.tracks[track].locked) { node.classList.add('is-locked'); return; }

    node.addEventListener('pointerdown', (event) => {
      const edge = event.target.closest('.trim')?.dataset.edge;
      selectClip(track, node.dataset.id);
      startDrag(event, node, track, node.dataset.id, edge);
    });
  });
}

function startDrag(event, node, track, id, edge) {
  const clip = findClip(track, id);
  if (!clip) return;
  event.preventDefault();
  const startX = event.clientX;
  const origin = { start: clip.start, duration: clip.duration, inPoint: clip.inPoint || 0 };
  const tag = `${edge || 'move'}-${id}`;
  let moved = false;

  const onMove = (moveEvent) => {
    const deltaSeconds = (moveEvent.clientX - startX) / pixelsPerSecond;
    if (!moved && Math.abs(moveEvent.clientX - startX) < 3) return;
    if (!moved) { rememberState(tag); moved = true; }

    if (edge === 'start') {
      const maxShift = origin.duration - 0.4;
      const shift = Math.max(-origin.start, Math.min(maxShift, deltaSeconds));
      clip.start = round(origin.start + shift);
      clip.duration = round(origin.duration - shift);
      if (track !== 'caption') clip.inPoint = round(Math.max(0, origin.inPoint + shift));
    } else if (edge === 'end') {
      clip.duration = round(Math.max(0.4, origin.duration + deltaSeconds));
    } else {
      clip.start = round(Math.max(0, origin.start + deltaSeconds));
    }
    renderTimeline();
    renderInspector();
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) {
      endHistoryGroup();
      syncDurationToTimeline();
      render();
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function selectClip(track, id) {
  selected = { track, id };
  renderTimeline();
  renderInspector();
  updateHistoryButtons();
}

function splitAtPlayhead() {
  const clip = selectedClip();
  if (!clip) { showToast('분할할 클립을 먼저 선택해 주세요.'); return; }
  const track = selected.track;
  if (state.tracks[track].locked) { showToast('잠긴 트랙은 편집할 수 없습니다.'); return; }
  const cut = playback.current;
  if (cut <= clip.start + 0.2 || cut >= clip.start + clip.duration - 0.2) {
    showToast('재생 헤드를 클립 안쪽에 두고 분할해 주세요.');
    return;
  }
  rememberState();
  const firstLength = round(cut - clip.start);
  const secondLength = round(clip.duration - firstLength);
  const second = {
    ...JSON.parse(JSON.stringify(clip)),
    id: newId(track[0]),
    start: round(cut),
    duration: secondLength
  };
  if (track !== 'caption') second.inPoint = round((clip.inPoint || 0) + firstLength);
  if (track === 'caption') {
    const middle = Math.max(1, clip.text.lastIndexOf(' ', Math.floor(clip.text.length / 2)));
    second.text = clip.text.slice(middle).trim() || clip.text;
    clip.text = clip.text.slice(0, middle).trim() || clip.text;
  }
  clip.duration = firstLength;
  const list = clipsOf(track);
  list.splice(list.indexOf(clip) + 1, 0, second);
  selected = { track, id: second.id };
  render();
  showToast(`${round(cut)}초에서 클립을 나눴습니다.`);
}

function deleteSelected() {
  const clip = selectedClip();
  if (!clip) return;
  if (state.tracks[selected.track].locked) { showToast('잠긴 트랙은 편집할 수 없습니다.'); return; }
  rememberState();
  const list = clipsOf(selected.track);
  list.splice(list.indexOf(clip), 1);
  selected = null;
  syncDurationToTimeline();
  render();
  showToast('선택한 클립을 삭제했습니다.');
}

function addCaptionAtPlayhead() {
  rememberState();
  const caption = {
    id: newId('c'), text: '새 자막',
    start: round(playback.current), duration: 2.5,
    style: { ...DEFAULT_CAPTION_STYLE }
  };
  state.timeline.caption.push(caption);
  state.timeline.caption.sort((a, b) => a.start - b.start);
  selected = { track: 'caption', id: caption.id };
  syncDurationToTimeline();
  render();
  $('#captionText').focus();
  $('#captionText').select();
}

/* ------------------------------------------------------------------ */
/* 재생과 화면                                                          */
/* ------------------------------------------------------------------ */

function activeVideoClip(time) {
  return clipsOf('video').filter((clip) => time >= clip.start && time < clip.start + clip.duration)
    .sort((a, b) => b.start - a.start)[0] || null;
}

// 전환이 물리는 구간에서는 두 클립이 동시에 살아 있다. 위 클립 아래에 깔릴 앞 클립.
function underVideoClip(time, topClip) {
  if (!topClip) return null;
  return clipsOf('video')
    .filter((clip) => clip.id !== topClip.id && time >= clip.start && time < clip.start + clip.duration)
    .filter((clip) => clip.start < topClip.start)
    .sort((a, b) => b.start - a.start)[0] || null;
}

function activeCaptions(time) {
  return clipsOf('caption').filter((clip) => time >= clip.start && time < clip.start + clip.duration);
}

function activeAudioClip(time) {
  return clipsOf('audio').find((clip) => time >= clip.start && time < clip.start + clip.duration) || null;
}

let lastVideoClipId = null;
let lastAudioClipId = null;

// 아래층은 효과 없이 그대로 보여 준다. 위 클립이 알파로 녹아들면서 진짜 디졸브가 된다.
function paintUnderLayer(time, topClip) {
  const under = state.tracks.video.hidden ? null : underVideoClip(time, topClip);
  const video = elements.stageVideoUnder;
  const image = elements.stageImageUnder;
  if (!under) {
    video.hidden = true;
    image.hidden = true;
    if (!video.paused) video.pause();
    return;
  }
  if (under.type === 'image') {
    video.hidden = true;
    if (!video.paused) video.pause();
    image.hidden = false;
    if (image.dataset.clip !== under.id) { image.src = fileUrl(under.path); image.dataset.clip = under.id; }
  } else {
    image.hidden = true;
    video.hidden = false;
    if (video.dataset.clip !== under.id) { video.src = fileUrl(under.path); video.dataset.clip = under.id; }
    const target = (under.inPoint || 0) + (time - under.start);
    if (Number.isFinite(video.duration) && target <= video.duration && Math.abs(video.currentTime - target) > 0.25) {
      video.currentTime = target;
    }
    if (playback.playing && video.paused) video.play().catch(() => {});
    if (!playback.playing && !video.paused) video.pause();
  }
  const node = under.type === 'image' ? image : video;
  const progress = (time - under.start) / Math.max(0.1, under.duration);
  const keys = under.keyframes || {};
  const scale = ((keys.startScale ?? 100) + ((keys.endScale ?? 100) - (keys.startScale ?? 100)) * progress) / 100;
  node.style.transform = `translate(${(keys.panX ?? 0) * progress}px, ${(keys.panY ?? 0) * progress}px) scale(${scale})`;
  node.style.opacity = '1';
  node.style.filter = '';
  node.style.clipPath = '';
}

function updateStageMedia() {
  const time = playback.current;
  const clip = state.tracks.video.hidden ? null : activeVideoClip(time);
  paintUnderLayer(time, clip);
  const video = elements.stageVideo;
  const image = elements.stageImage;

  if (!clip) {
    video.hidden = true; image.hidden = true;
    if (!video.paused) video.pause();
    lastVideoClipId = null;
  } else if (clip.type === 'image') {
    video.hidden = true;
    if (!video.paused) video.pause();
    image.hidden = false;
    if (image.dataset.clip !== clip.id) { image.src = fileUrl(clip.path); image.dataset.clip = clip.id; }
    lastVideoClipId = clip.id;
  } else {
    image.hidden = true;
    video.hidden = false;
    if (video.dataset.clip !== clip.id) {
      video.src = fileUrl(clip.path);
      video.dataset.clip = clip.id;
      lastVideoClipId = clip.id;
    }
    const target = (clip.inPoint || 0) + (time - clip.start);
    if (Number.isFinite(video.duration) && target <= video.duration && Math.abs(video.currentTime - target) > 0.25) {
      video.currentTime = target;
    }
    if (playback.playing && video.paused) video.play().catch(() => {});
    if (!playback.playing && !video.paused) video.pause();
  }

  if (clip) {
    const progress = (time - clip.start) / Math.max(0.1, clip.duration);
    const keys = clip.keyframes || {};
    const scale = ((keys.startScale ?? 100) + ((keys.endScale ?? 100) - (keys.startScale ?? 100)) * progress) / 100;
    const panX = (keys.panX ?? 0) * progress;
    const panY = (keys.panY ?? 0) * progress;
    const node = clip.type === 'image' ? image : video;
    const transitionDuration = Math.max(0.05, Number(clip.transitionDuration) || 0.35);
    const entering = Math.max(0, Math.min(1, (time - clip.start) / transitionDuration));
    const transitionScale = clip.transition === 'zoom' ? 1.08 - entering * 0.08 : 1;
    node.style.transform = `translate(${panX}px, ${panY}px) scale(${scale * transitionScale})`;
    node.style.opacity = ['fade', 'zoom', 'blur', 'flash'].includes(clip.transition) ? String(entering) : '1';
    node.style.filter = clip.transition === 'blur' ? `blur(${(1 - entering) * 14}px)`
      : clip.transition === 'flash' ? `brightness(${1 + (1 - entering) * 2.2})` : '';
    node.style.clipPath = clip.transition === 'wipe' ? `inset(0 ${(1 - entering) * 100}% 0 0)` : '';
    if (clip.transition === 'slide') node.style.transform += ` translateX(${(1 - entering) * 100}%)`;
  }

  const audioClip = state.tracks.audio.muted ? null : activeAudioClip(time);
  const audio = elements.stageAudio;
  if (!audioClip) {
    if (!audio.paused) audio.pause();
    lastAudioClipId = null;
  } else {
    if (audio.dataset.clip !== audioClip.id) {
      audio.src = fileUrl(audioClip.path);
      audio.dataset.clip = audioClip.id;
      lastAudioClipId = audioClip.id;
    }
    audio.volume = Math.min(1, (audioClip.volume ?? 100) / 100) * (playback.muted ? 0 : 1);
    const target = (audioClip.inPoint || 0) + (time - audioClip.start);
    if (Number.isFinite(audio.duration) && Math.abs(audio.currentTime - target) > 0.3) audio.currentTime = target;
    if (playback.playing && audio.paused) audio.play().catch(() => {});
    if (!playback.playing && !audio.paused) audio.pause();
  }

  renderCaptionLayer(time);
}

function renderCaptionLayer(time) {
  if (state.tracks.caption.hidden) { elements.captionLayer.innerHTML = ''; return; }
  const captions = activeCaptions(time);
  elements.captionLayer.innerHTML = captions.map((caption) => {
    const style = caption.style || DEFAULT_CAPTION_STYLE;
    const top = ({ top: 16, middle: 50, bottom: 82 }[style.position] || 82) + (style.offset || 0);
    return `<p class="stage-caption ${style.box ? 'boxed' : ''}" style="
      top:${top}%;
      font-size:${(style.size / 1080) * 100}cqw;
      color:${escapeHtml(style.color)};
      text-align:${style.align};
      font-family:'${escapeHtml(style.font || state.font)}', sans-serif;
    ">${escapeHtml(caption.text)}</p>`;
  }).join('');
}

function updatePlaybackUI() {
  const total = Math.max(state.duration, timelineEnd());
  playback.current = Math.min(playback.current, total);
  const progress = total ? playback.current / total : 0;
  elements.currentTime.textContent = formatTime(playback.current);
  elements.playButton.textContent = playback.playing ? '❚❚' : '▶';
  elements.stagePlayButton.textContent = playback.playing ? '❚❚' : '▶';
  elements.playLine.querySelector('i').style.width = `${progress * 100}%`;
  elements.previewProgress.style.width = `${progress * 100}%`;
  elements.playhead.style.left = `${playback.current * pixelsPerSecond}px`;
  elements.phoneStage.classList.toggle('is-playing', playback.playing);
  $('#muteButton').classList.toggle('muted', playback.muted);
  updateStageMedia();
}

function playbackFrame(timestamp) {
  if (!playback.playing) return;
  if (!playback.lastTimestamp) playback.lastTimestamp = timestamp;
  playback.current += (timestamp - playback.lastTimestamp) / 1000;
  playback.lastTimestamp = timestamp;
  const total = Math.max(state.duration, timelineEnd());
  if (playback.current >= total) {
    playback.current = total;
    pausePlayback();
    return;
  }
  updatePlaybackUI();
  playback.frame = requestAnimationFrame(playbackFrame);
}

function togglePlayback() {
  if (playback.playing) { pausePlayback(); return; }
  const total = Math.max(state.duration, timelineEnd());
  if (playback.current >= total) playback.current = 0;
  playback.playing = true;
  playback.lastTimestamp = 0;
  updatePlaybackUI();
  playback.frame = requestAnimationFrame(playbackFrame);
}

function pausePlayback() {
  playback.playing = false;
  playback.lastTimestamp = 0;
  if (playback.frame) cancelAnimationFrame(playback.frame);
  playback.frame = null;
  elements.stageVideo.pause();
  elements.stageVideoUnder.pause();
  elements.stageAudio.pause();
  updatePlaybackUI();
}

function seekTo(seconds) {
  const total = Math.max(state.duration, timelineEnd());
  playback.current = Math.max(0, Math.min(total, seconds));
  playback.lastTimestamp = 0;
  updatePlaybackUI();
}

/* ------------------------------------------------------------------ */
/* 미디어 불러오기와 콘셉트                                              */
/* ------------------------------------------------------------------ */

async function importMedia() {
  const picked = await window.studio.pickMedia();
  if (!picked.length) return;
  rememberState();
  const known = new Set(state.media.map((item) => item.path));
  const fresh = picked.filter((item) => !known.has(item.path));
  state.media.push(...fresh);
  await appendMediaToTimeline(fresh);
  render();
  showToast(`${fresh.length}개 미디어를 타임라인에 배치했습니다.`);
}

function applyConcept(concept) {
  rememberState();
  pausePlayback();
  state.concept = concept;
  state.title = concept.title || state.title;
  state.hook = concept.hook || state.hook;
  state.duration = concept.duration || 25;
  state.palette = concept.palette ? [...concept.palette, '#17211f'].slice(0, 3) : state.palette;
  state.timeline.caption = concept.scenes?.length
    ? captionsFromScenes(concept.scenes)
    : captionsFromScript(concept.script || [concept.hook], state.duration);
  if (concept.scenes?.length) {
    const map = { '컷 전환': 'cut', '점프 컷': 'cut', '화이트 플래시': 'fade', '왼쪽으로 밀기': 'slide', '확대 후 컷': 'zoom' };
    state.defaultTransition = map[concept.scenes[0].transition] || 'cut';
  }
  spreadVideoClipsOverDuration();
  playback.current = 0;
  selected = null;
  render();
  showToast(`‘${concept.title}’ 초안을 만들었습니다.`);
}

// 콘셉트 길이에 맞춰 이미 올려둔 장면들을 고르게 다시 편다.
function spreadVideoClipsOverDuration() {
  const clips = clipsOf('video');
  if (!clips.length) return;
  const each = state.duration / clips.length;
  clips.forEach((clip, index) => {
    clip.start = round(each * index);
    clip.duration = round(each);
  });
}

/* ------------------------------------------------------------------ */
/* 인터넷 소재 가져오기                                                 */
/* ------------------------------------------------------------------ */

const webMedia = { kind: 'video', items: [], busy: false, sceneIndex: null };

function sceneBriefs() {
  return state.concept ? window.SmartEdit.sceneBriefs(state.concept) : [];
}

function smartConnectScenes(notify = true) {
  const clips = clipsOf('video').slice().sort((a, b) => a.start - b.start);
  if (clips.length < 2) {
    if (notify) showToast('연결할 장면이 두 개 이상 필요합니다.');
    return;
  }
  rememberState();
  clips.forEach((clip) => {
    const oldOverlap = Number(clip.transitionOverlap) || 0;
    if (oldOverlap) {
      clip.start = round(clip.start + oldOverlap, 2);
      clip.duration = round(Math.max(0.3, clip.duration - oldOverlap), 2);
      clip.transitionOverlap = 0;
    }
  });
  clips.forEach((clip, index) => {
    const midpoint = clip.start + clip.duration / 2;
    const sceneIndex = Math.max(0, (state.concept?.scenes || []).findIndex((scene) => midpoint >= scene.start && midpoint < scene.end));
    const scene = state.concept?.scenes?.[sceneIndex];
    const recommendation = window.SmartEdit.recommendTransition(scene, index, clips.length, state.concept?.cutTempo);
    clip.transition = recommendation.type;
    clip.transitionDuration = recommendation.duration;
    if (index > 0 && recommendation.duration > 0) {
      clip.start = round(Math.max(0, clip.start - recommendation.duration), 2);
      clip.duration = round(clip.duration + recommendation.duration, 2);
      clip.transitionOverlap = recommendation.duration;
    }
  });
  state.timeline.video.sort((a, b) => a.start - b.start);
  render();
  if (notify) showToast('장면 의미와 템포에 맞춰 전환을 연결했습니다.');
}

function currentSceneBrief() {
  return sceneBriefs().find((brief) => brief.index === webMedia.sceneIndex) || null;
}

function renderSceneMatches() {
  const briefs = sceneBriefs();
  const row = $('#sceneMatchRow');
  if (!briefs.length) {
    row.innerHTML = '<span class="keyword-hint">콘텐츠 헌터에서 원고를 만들면 장면별 검색·배치가 활성화됩니다.</span>';
    $('#smartFillButton').disabled = true;
    return;
  }
  $('#smartFillButton').disabled = false;
  row.innerHTML = briefs.map((brief) => `<button type="button" class="scene-chip ${brief.index === webMedia.sceneIndex ? 'active' : ''}" data-scene="${brief.index}" title="${escapeHtml(brief.query)}">${escapeHtml(brief.label)}</button>`).join('');
  $$('#sceneMatchRow .scene-chip').forEach((chip) => chip.addEventListener('click', () => {
    webMedia.sceneIndex = Number(chip.dataset.scene);
    $('#webMediaQuery').value = currentSceneBrief().query;
    renderSceneMatches();
    searchWebMedia();
  }));
}

function trendKeywords() {
  const concept = state.concept;
  if (!concept) return [];
  return [...new Set([...(concept.visualKeywords || []), ...(concept.hashtags || []), concept.musicMood || ''])]
    .filter(Boolean).slice(0, 8);
}

function renderTrendKeywords() {
  const keywords = trendKeywords();
  const row = $('#trendKeywordRow');
  if (!keywords.length) {
    row.innerHTML = '<span class="keyword-hint">콘텐츠 헌터에서 주제를 보내면 조회수 높은 숏폼이 쓰는 화면 키워드가 여기에 뜹니다.</span>';
    return;
  }
  row.innerHTML = '<span class="keyword-hint">트렌드 키워드</span>'
    + keywords.map((word) => `<button type="button" class="keyword-chip">${escapeHtml(word)}</button>`).join('');
  $$('#trendKeywordRow .keyword-chip').forEach((chip) => chip.addEventListener('click', () => {
    $('#webMediaQuery').value = chip.textContent;
    searchWebMedia();
  }));
}

function openWebMedia(payload = {}) {
  renderTrendKeywords();
  renderSceneMatches();
  if (payload.kind) webMedia.kind = payload.kind;
  $$('#webKindTabs button').forEach((button) => button.classList.toggle('active', button.dataset.kind === webMedia.kind));
  // 기본 프로젝트 이름으로 검색해 봐야 쓸모가 없다. 트렌드 키워드를 먼저 쓴다.
  $('#webMediaQuery').value = payload.query || $('#webMediaQuery').value || trendKeywords()[0] || '';
  if (!elements.webMediaDialog.open) elements.webMediaDialog.showModal();
  if (payload.query) searchWebMedia();
}

async function searchWebMedia() {
  const query = $('#webMediaQuery').value.trim();
  if (!query || webMedia.busy) return;
  webMedia.busy = true;
  $('#webMediaSearchButton').disabled = true;
  $('#webMediaStatus').textContent = `“${query}” 소재를 찾고 있습니다…`;
  $('#webMediaGrid').innerHTML = '';
  try {
    const result = await window.studio.searchWebMedia({ query, kind: webMedia.kind, limit: 12, context: currentSceneBrief() || { query } });
    webMedia.items = result.items || [];
    const sourceText = (result.sources || []).map((source) => `${source.name} ${source.ok ? `${source.count}건` : '실패'}`).join(' · ');
    const translated = result.translated && result.searchedWith !== result.query
      ? ` · 영어 색인이라 “${result.searchedWith}”로 찾았습니다`
      : '';
    $('#webMediaStatus').textContent = webMedia.items.length
      ? `${webMedia.items.length}건 · ${sourceText}${translated}`
      : `결과가 없습니다. 다른 키워드로 찾아보세요. (${sourceText})`;
    renderWebMediaResults();
  } catch (error) {
    $('#webMediaStatus').textContent = `검색 실패: ${error.message}`;
  } finally {
    webMedia.busy = false;
    $('#webMediaSearchButton').disabled = false;
  }
}

function renderWebMediaResults() {
  $('#webMediaGrid').innerHTML = webMedia.items.map((item, index) => `
    <article class="web-media-card">
      <div class="web-thumb ${item.thumbnail ? '' : 'no-thumb'}" ${item.thumbnail ? `style="background-image:url('${escapeHtml(item.thumbnail)}')"` : ''}>
        <span class="kind-badge">${item.kind === 'video' ? '영상' : item.kind === 'audio' ? '음악' : '사진'}</span>
        ${item.width && item.height ? `<span class="size-badge">${item.width}×${item.height}</span>` : ''}
        ${item.durationSeconds ? `<span class="duration-badge">${formatTime(item.durationSeconds)}</span>` : ''}
        ${item.sizeText ? `<span class="bytes-badge">${escapeHtml(item.sizeText)}</span>` : ''}
        ${item.relevance ? `<span class="match-score">적합도 ${item.relevance.score}</span>` : ''}
      </div>
      <div class="web-info">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.creator)} · ${escapeHtml(item.provider)}</small>
        ${item.relevance ? `<small class="match-reason">${escapeHtml(item.relevance.reasons.join(' · '))}</small>` : ''}
        <span class="license-tag">${escapeHtml(item.license)}${item.attributionRequired ? ' · 출처 표기 필요' : ''}</span>
      </div>
      <div class="web-buttons">
        <button type="button" class="ghost" data-source="${escapeHtml(item.sourceUrl)}">원문</button>
        <button type="button" class="import" data-index="${index}">가져오기</button>
        ${currentSceneBrief() ? `<button type="button" class="place-scene" data-place="${index}">장면 배치</button>` : ''}
      </div>
    </article>`).join('');
  $$('#webMediaGrid [data-source]').forEach((button) => button.addEventListener('click', () => window.studio.openExternal(button.dataset.source)));
  $$('#webMediaGrid .import').forEach((button) => button.addEventListener('click', () => importWebItem(Number(button.dataset.index), button)));
  $$('#webMediaGrid .place-scene').forEach((button) => button.addEventListener('click', () => importWebItem(Number(button.dataset.place), button, true)));
}

async function importWebItem(index, button, placeInScene = false) {
  const item = webMedia.items[index];
  if (!item) return;
  button.disabled = true;
  button.textContent = '가져오는 중…';
  const result = await window.studio.downloadWebMedia(item);
  if (!result.ok) {
    button.disabled = false;
    button.textContent = '가져오기';
    showToast(`가져오지 못했습니다: ${result.error}`);
    return;
  }
  await addImportedMedia(result.media);
  button.textContent = '가져옴 ✓';
}

async function addImportedMedia(media, placement = null, replace = false) {
  rememberState();
  if (!state.media.some((entry) => entry.path === media.path)) {
    state.media.push(media);
    if (!placement) await appendMediaToTimeline([media]);
  }
  if (placement && media.type !== 'audio') {
    if (replace) {
      const middle = (placement.start + placement.end) / 2;
      state.timeline.video = clipsOf('video').filter((clip) => !(middle >= clip.start && middle < clip.start + clip.duration));
    }
    const recommendation = window.SmartEdit.recommendTransition(
      state.concept?.scenes?.[placement.index], placement.index, sceneBriefs().length, state.concept?.cutTempo
    );
    state.timeline.video.push({
      id: newId('v'), mediaId: media.id, name: media.name, path: media.path, type: media.type,
      start: placement.start, duration: Math.max(0.6, placement.end - placement.start), inPoint: 0,
      transition: recommendation.type, transitionDuration: recommendation.duration,
      keyframes: { startScale: 100, endScale: media.type === 'image' ? 108 : 100, panX: 0, panY: 0 }
    });
    state.timeline.video.sort((a, b) => a.start - b.start);
    syncDurationToTimeline();
  }
  render();
  showToast(placement ? `${placement.index + 1}번 장면에 소재를 배치했습니다.` : `${media.name} 을(를) 타임라인에 추가했습니다.`);
}

async function smartFillScenes() {
  const briefs = sceneBriefs();
  if (!briefs.length || webMedia.busy) return;
  webMedia.busy = true;
  const button = $('#smartFillButton');
  button.disabled = true;
  const used = new Set(state.media.map((item) => item.credit?.sourceUrl).filter(Boolean));
  let filled = 0;
  try {
    for (const brief of briefs) {
      const middle = (brief.start + brief.end) / 2;
      if (clipsOf('video').some((clip) => middle >= clip.start && middle < clip.start + clip.duration)) continue;
      button.textContent = `${brief.index + 1}/${briefs.length} 장면 찾는 중…`;
      let result = await window.studio.searchWebMedia({ query: brief.query, kind: webMedia.kind, limit: 8, context: brief });
      if (!result.items?.length && webMedia.kind === 'video') {
        result = await window.studio.searchWebMedia({ query: brief.query, kind: 'image', limit: 8, context: brief });
      }
      const candidate = (result.items || []).find((item) => !used.has(item.sourceUrl));
      if (!candidate) continue;
      const downloaded = await window.studio.downloadWebMedia(candidate);
      if (!downloaded.ok) continue;
      used.add(candidate.sourceUrl);
      await addImportedMedia(downloaded.media, brief, false);
      filled += 1;
    }
    if (filled) smartConnectScenes(false);
    showToast(`${filled}개 빈 장면을 자동으로 채웠습니다.`);
  } finally {
    webMedia.busy = false;
    button.disabled = false;
    button.textContent = '빈 장면 스마트 채우기';
  }
}

function currentNarrationText() {
  const captions = [...clipsOf('caption')]
    .sort((a, b) => a.start - b.start)
    .map((clip) => clip.text?.trim())
    .filter(Boolean);
  return captions.length ? captions.join('\n') : (state.hook || '').trim();
}

async function openVoiceover() {
  $('#voiceoverText').value = currentNarrationText();
  $('#voiceoverStatus').textContent = '한국어 신경망 음성을 확인하고 있습니다…';
  $('#generateVoiceButton').disabled = true;
  if (!elements.voiceoverDialog.open) elements.voiceoverDialog.showModal();
  const result = await window.studio.listVoices();
  const voices = result.voices || [];
  $('#voiceSelect').innerHTML = voices.map((voice) =>
    `<option value="${escapeHtml(voice.name)}">${escapeHtml(voice.name)} · ${escapeHtml(voice.culture)} · ${escapeHtml(voice.gender)}</option>`
  ).join('');
  const korean = voices.find((voice) => String(voice.culture).toLowerCase().startsWith('ko'));
  if (korean) $('#voiceSelect').value = korean.name;
  $('#voiceoverStatus').textContent = result.ok
    ? `${voices.length}개 목소리 사용 가능 · 한국어 목소리를 우선 선택했습니다.`
    : `음성 엔진을 불러오지 못했습니다: ${result.error}`;
  $('#generateVoiceButton').disabled = !result.ok || !voices.length;
}

async function generateVoiceover() {
  const text = $('#voiceoverText').value.trim();
  if (!text) { $('#voiceoverStatus').textContent = '읽을 원고를 입력해 주세요.'; return; }
  const button = $('#generateVoiceButton');
  button.disabled = true;
  button.textContent = '음성 만드는 중…';
  $('#voiceoverStatus').textContent = '한국어 신경망 음성이 원고를 읽고 있습니다.';
  const result = await window.studio.generateVoice({
    text,
    voice: $('#voiceSelect').value,
    rate: Number($('#voiceRate').value),
    title: `${state.title}-내레이션`
  });
  button.disabled = false;
  button.textContent = '음성 만들고 배치';
  if (!result.ok) { $('#voiceoverStatus').textContent = `생성 실패: ${result.error}`; return; }
  await addImportedMedia(result.media, placeInScene ? currentSceneBrief() : null, placeInScene);
  elements.voiceoverDialog.close();
  showToast('원고 음성을 오디오 타임라인에 배치했습니다.');
}

async function importFromUrl() {
  const url = $('#webMediaUrl').value.trim();
  if (!url) return;
  $('#webMediaUrlButton').disabled = true;
  const result = await window.studio.downloadFromUrl(url);
  $('#webMediaUrlButton').disabled = false;
  if (!result.ok) { showToast(`가져오지 못했습니다: ${result.error}`); return; }
  $('#webMediaUrl').value = '';
  await addImportedMedia(result.media);
}

/* ------------------------------------------------------------------ */
/* 내보내기와 발행                                                      */
/* ------------------------------------------------------------------ */

function syncInputs() {
  state.title = elements.projectTitle.value.trim() || state.title;
  state.hook = elements.hookInput.value.trim() || state.hook;
  state.duration = Number(elements.durationInput.value) || state.duration;
}

async function exportVideo(closeDialog = false) {
  syncInputs();
  elements.publishStatus.className = 'publish-status';
  elements.publishStatus.textContent = '1080 × 1920 MP4를 렌더링하고 있습니다…';
  const result = await window.studio.exportVideo(state);
  if (result.canceled) return null;
  if (!result.ok) {
    elements.publishStatus.className = 'publish-status error';
    elements.publishStatus.textContent = `저장 실패: ${result.error}`;
    return null;
  }
  state.exportedPath = result.path;
  elements.publishStatus.className = 'publish-status success';
  elements.publishStatus.textContent = `저장 완료 · ${result.path}`;
  showToast('MP4 저장이 완료되었습니다.');
  if (closeDialog) elements.publishDialog.close();
  return result.path;
}

function openPublish() {
  syncInputs();
  $('#publishTitle').value = state.title;
  $('#publishDescription').value = state.hook;
  $('#publishTags').value = (state.concept?.hashtags || ['쇼츠', '릴스', '숏폼']).join(', ');
  elements.publishStatus.textContent = state.exportedPath ? `최근 영상 · ${state.exportedPath}` : '발행 전에 MP4 영상을 먼저 저장합니다.';
  elements.publishDialog.showModal();
}

async function exportAndPublish() {
  const platforms = $$('#publishDialog [type="checkbox"]:checked').map((input) => input.value);
  if (!platforms.length) {
    elements.publishStatus.className = 'publish-status error';
    elements.publishStatus.textContent = '발행할 플랫폼을 하나 이상 선택해 주세요.';
    return;
  }
  const videoPath = await exportVideo(false);
  if (!videoPath) return;
  elements.publishStatus.className = 'publish-status';
  elements.publishStatus.textContent = '선택한 플랫폼으로 전송하고 있습니다…';
  const results = await window.studio.publish({
    videoPath, platforms,
    title: $('#publishTitle').value.trim(),
    description: $('#publishDescription').value.trim(),
    tags: $('#publishTags').value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean),
    publicVideoUrl: $('#publicVideoUrl').value.trim(),
    privacy: 'private'
  });
  const success = results.filter((item) => item.ok);
  const failed = results.filter((item) => !item.ok);
  elements.publishStatus.className = failed.length ? 'publish-status error' : 'publish-status success';
  elements.publishStatus.innerHTML = [
    ...success.map((item) => `✓ ${escapeHtml(item.message)}`),
    ...failed.map((item) => `• ${escapeHtml(item.platform)}: ${escapeHtml(item.message)}`)
  ].join('<br>');
}

async function openSettings() {
  const settings = await window.studio.loadSettings();
  $('#youtubeApiKey').value = settings.youtube?.apiKey || '';
  $('#youtubeToken').value = settings.youtube?.accessToken || '';
  $('#tiktokClientKey').value = settings.tiktok?.clientKey || '';
  $('#tiktokClientSecret').value = settings.tiktok?.clientSecret || '';
  $('#tiktokRegion').value = settings.tiktok?.regionCode || 'KR';
  $('#tiktokToken').value = settings.tiktok?.accessToken || '';
  $('#tiktokPrivacy').value = settings.tiktok?.privacyLevel || 'SELF_ONLY';
  $('#pexelsKey').value = settings.pexels?.apiKey || '';
  $('#instagramUserId').value = settings.instagram?.userId || '';
  $('#instagramToken').value = settings.instagram?.accessToken || '';
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
}

async function saveSettings() {
  await window.studio.saveSettings({
    youtube: { apiKey: $('#youtubeApiKey').value.trim(), accessToken: $('#youtubeToken').value.trim() },
    tiktok: {
      clientKey: $('#tiktokClientKey').value.trim(), clientSecret: $('#tiktokClientSecret').value.trim(),
      regionCode: $('#tiktokRegion').value, accessToken: $('#tiktokToken').value.trim(), privacyLevel: $('#tiktokPrivacy').value
    },
    pexels: { apiKey: $('#pexelsKey').value.trim() },
    instagram: { userId: $('#instagramUserId').value.trim(), accessToken: $('#instagramToken').value.trim() }
  });
  elements.settingsDialog.close();
  showToast('플랫폼 연결 정보를 저장했습니다.');
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove('show'), 2400);
}

/* 예전 형식(script 배열)으로 저장한 프로젝트도 열 수 있게 맞춰 준다. */
function migrateProject(project) {
  const next = { ...project };
  if (!next.timeline) {
    next.timeline = { video: [], caption: [], audio: [] };
    (next.media || []).forEach((item) => {
      if (item.type === 'audio') {
        next.timeline.audio.push({ id: newId('a'), mediaId: item.id, name: item.name, path: item.path, start: 0, duration: next.duration || 25, inPoint: 0, volume: 100 });
      } else {
        const start = next.timeline.video.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
        next.timeline.video.push({
          id: newId('v'), mediaId: item.id, name: item.name, path: item.path, type: item.type,
          start, duration: item.type === 'image' ? 4 : 6, inPoint: 0, transition: 'cut',
          transitionDuration: 0.35,
          keyframes: { startScale: 100, endScale: 100, panX: 0, panY: 0 }
        });
      }
    });
    next.timeline.caption = captionsFromScript(next.script || [next.hook || '자막'], next.duration || 25);
  }
  if (!next.tracks) {
    next.tracks = { video: { locked: false, hidden: false }, caption: { locked: false, hidden: false }, audio: { locked: false, muted: false } };
  }
  next.defaultTransitionDuration = Number(next.defaultTransitionDuration) || 0.35;
  (next.timeline.video || []).forEach((clip) => { if (!Number.isFinite(Number(clip.transitionDuration))) clip.transitionDuration = 0.35; });
  delete next.script;
  return next;
}

/* ------------------------------------------------------------------ */
/* 이벤트 연결                                                          */
/* ------------------------------------------------------------------ */

$('#importButton').addEventListener('click', importMedia);
$('#dropZone').addEventListener('click', importMedia);
$('#trendButton').addEventListener('click', () => window.studio.openTrends());
$('#publishButton').addEventListener('click', openPublish);
$('#exportOnlyButton').addEventListener('click', () => exportVideo(false));
$('#exportPublishButton').addEventListener('click', exportAndPublish);
$('#settingsButton').addEventListener('click', openSettings);
$('#saveSettingsButton').addEventListener('click', saveSettings);

$('#webMediaButton').addEventListener('click', () => openWebMedia());
$('#voiceoverButton').addEventListener('click', openVoiceover);
$('#generateVoiceButton').addEventListener('click', generateVoiceover);
$('#webMediaSearchButton').addEventListener('click', searchWebMedia);
$('#smartFillButton').addEventListener('click', smartFillScenes);
$('#smartConnectButton').addEventListener('click', () => smartConnectScenes(true));
$('#webMediaQuery').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); searchWebMedia(); } });
$('#webMediaUrlButton').addEventListener('click', importFromUrl);
$('#openWebMediaFolder').addEventListener('click', () => window.studio.revealWebMedia());
$('#webKindTabs').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  webMedia.kind = button.dataset.kind;
  $$('#webKindTabs button').forEach((item) => item.classList.toggle('active', item === button));
  if ($('#webMediaQuery').value.trim()) searchWebMedia();
});

elements.hookInput.addEventListener('input', () => { state.hook = elements.hookInput.value; elements.mockCaption.textContent = state.hook; });
elements.durationInput.addEventListener('change', () => {
  rememberState();
  state.duration = Math.max(5, Number(elements.durationInput.value) || state.duration);
  render();
});
$('#transitionInput').addEventListener('change', (event) => {
  rememberState();
  state.defaultTransition = event.target.value;
  clipsOf('video').forEach((clip) => { clip.transition = state.defaultTransition; clip.transitionDuration = state.defaultTransitionDuration; });
  render();
});
elements.fontInput.addEventListener('change', () => {
  rememberState();
  state.font = elements.fontInput.value;
  render();
  showToast(`${elements.fontInput.options[elements.fontInput.selectedIndex].text}를 적용했습니다.`);
});
$('#palettePicker').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const color = getComputedStyle(button).getPropertyValue('--color').trim();
  rememberState();
  state.palette = [color, state.palette[1], state.palette[2]];
  render();
});
elements.platformSwitch.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  state.previewPlatform = button.dataset.platform;
  renderPlatformPreview();
  renderSafeReport();
  renderQuality();
  showToast(`${button.textContent} 업로드 화면으로 전환했습니다.`);
});
$('#safeToggle').addEventListener('click', () => { state.showSafeZone = !state.showSafeZone; renderPlatformPreview(); });
elements.projectTitle.addEventListener('change', () => { state.title = elements.projectTitle.value; });

$$('.media-tabs button').forEach((button) => button.addEventListener('click', () => {
  $$('.media-tabs button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  mediaFilter = button.dataset.filter;
  renderMedia();
}));

$('#saveProjectButton').addEventListener('click', async () => {
  syncInputs();
  const file = await window.studio.saveProject(state);
  if (file) showToast('프로젝트를 저장했습니다.');
});
$('#openProjectButton').addEventListener('click', async () => {
  const project = await window.studio.openProject();
  if (!project) return;
  Object.assign(state, migrateProject(project));
  history.undo.length = 0;
  history.redo.length = 0;
  selected = null;
  pausePlayback();
  playback.current = 0;
  render();
  showToast('프로젝트를 열었습니다.');
});

window.studio.onConcept(applyConcept);
// 뉴보대 「숏폼 만들기」에서 넘어온 맥락: 카드 그림을 소재로 올리고 제목을 잇는다.
window.studio.onNewbodaeContext(async (context) => {
  if (!context) return;
  const known = new Set(state.media.map((item) => item.path));
  const fresh = (context.media || []).filter((item) => !known.has(item.path));
  if (fresh.length) {
    rememberState();
    state.media.push(...fresh);
    await appendMediaToTimeline(fresh);
  }
  if (context.title && (!state.title || state.title === '새 숏폼 프로젝트')) state.title = context.title;
  render();
  showToast(fresh.length
    ? `뉴보대에서 카드 ${fresh.length}장을 가져와 타임라인에 놓았습니다.`
    : '뉴보대에서 열었습니다. 왼쪽에서 소재를 불러오거나 콘텐츠 헌터에서 구조를 고르세요.');
});
window.studio.onOpenSettings(openSettings);
window.studio.onOpenWebMedia(openWebMedia);
window.studio.onExportProgress((progress) => { elements.publishStatus.textContent = `영상 렌더링 ${progress}%`; });

elements.playButton.addEventListener('click', togglePlayback);
elements.stagePlayButton.addEventListener('click', togglePlayback);
$('#muteButton').addEventListener('click', () => { playback.muted = !playback.muted; updatePlaybackUI(); });
elements.playLine.addEventListener('click', (event) => {
  const rect = elements.playLine.getBoundingClientRect();
  seekTo((event.clientX - rect.left) / rect.width * Math.max(state.duration, timelineEnd()));
});
elements.tracks.addEventListener('click', (event) => {
  if (event.target.closest('.clip[data-id]')) return;
  const rect = elements.tracks.getBoundingClientRect();
  seekTo((event.clientX - rect.left) / pixelsPerSecond);
  selected = null;
  renderTimeline();
  renderInspector();
});
elements.timeRuler.addEventListener('click', (event) => {
  const rect = elements.timeRuler.getBoundingClientRect();
  seekTo((event.clientX - rect.left) / pixelsPerSecond);
});

$('#undoButton').addEventListener('click', undo);
$('#redoButton').addEventListener('click', redo);
$('#splitClipButton').addEventListener('click', splitAtPlayhead);
$('#deleteClipButton').addEventListener('click', deleteSelected);
$('#addCaptionButton').addEventListener('click', addCaptionAtPlayhead);

$('#timelineZoom').addEventListener('input', (event) => {
  pixelsPerSecond = Number(event.target.value);
  renderTimeline();
  updatePlaybackUI();
});
$('#zoomOutButton').addEventListener('click', () => {
  $('#timelineZoom').value = Math.max(12, pixelsPerSecond - 8);
  $('#timelineZoom').dispatchEvent(new Event('input'));
});
$('#zoomInButton').addEventListener('click', () => {
  $('#timelineZoom').value = Math.min(90, pixelsPerSecond + 8);
  $('#timelineZoom').dispatchEvent(new Event('input'));
});

$$('.track-label button').forEach((button) => button.addEventListener('click', () => {
  const track = button.closest('.track-label').dataset.track;
  const key = button.dataset.toggle;
  rememberState();
  state.tracks[track][key] = !state.tracks[track][key];
  render();
  const labels = { locked: '잠금', hidden: '숨김', muted: '음소거' };
  showToast(`${track} 트랙 ${labels[key]} ${state.tracks[track][key] ? '켜짐' : '꺼짐'}`);
}));

/* 자막 편집 */
function updateSelectedCaption(mutate, tag) {
  const clip = selectedClip();
  if (!clip || selected.track !== 'caption') return;
  rememberState(tag);
  mutate(clip);
  syncDurationToTimeline();
  renderTimeline();
  renderCaptionLayer(playback.current);
  renderSafeReport();
  renderQuality();
}

$('#captionText').addEventListener('input', (event) => updateSelectedCaption((clip) => { clip.text = event.target.value; }, 'caption-text'));
$('#captionText').addEventListener('change', endHistoryGroup);
$('#clipStart').addEventListener('change', (event) => { updateSelectedCaption((clip) => { clip.start = Math.max(0, Number(event.target.value) || 0); }); endHistoryGroup(); render(); });
$('#clipLength').addEventListener('change', (event) => { updateSelectedCaption((clip) => { clip.duration = Math.max(0.4, Number(event.target.value) || 1); }); endHistoryGroup(); render(); });
$('#captionSize').addEventListener('input', (event) => updateSelectedCaption((clip) => { clip.style.size = Number(event.target.value); }, 'caption-size'));
$('#captionSize').addEventListener('change', endHistoryGroup);
$('#captionColor').addEventListener('input', (event) => updateSelectedCaption((clip) => { clip.style.color = event.target.value; }, 'caption-color'));
$('#captionColor').addEventListener('change', endHistoryGroup);
$('#captionAlign').addEventListener('change', (event) => { updateSelectedCaption((clip) => { clip.style.align = event.target.value; }); endHistoryGroup(); });
$('#captionFont').addEventListener('change', (event) => { updateSelectedCaption((clip) => { clip.style.font = event.target.value; }); endHistoryGroup(); });
$('#captionOffset').addEventListener('input', (event) => updateSelectedCaption((clip) => { clip.style.offset = Number(event.target.value); }, 'caption-offset'));
$('#captionOffset').addEventListener('change', endHistoryGroup);
$('#captionBox').addEventListener('change', (event) => { updateSelectedCaption((clip) => { clip.style.box = event.target.checked; }); endHistoryGroup(); });
$('#captionPosition').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  updateSelectedCaption((clip) => { clip.style.position = button.dataset.value; });
  endHistoryGroup();
  renderInspector();
});

/* 장면 편집 */
function updateSelectedVisual(mutate, tag) {
  const clip = selectedClip();
  if (!clip || selected.track !== 'video') return;
  rememberState(tag);
  mutate(clip);
  syncDurationToTimeline();
  renderTimeline();
  updateStageMedia();
}

$('#visualStart').addEventListener('change', (event) => { updateSelectedVisual((clip) => { clip.start = Math.max(0, Number(event.target.value) || 0); }); endHistoryGroup(); render(); });
$('#visualLength').addEventListener('change', (event) => { updateSelectedVisual((clip) => { clip.duration = Math.max(0.3, Number(event.target.value) || 1); }); endHistoryGroup(); render(); });
$('#visualIn').addEventListener('change', (event) => { updateSelectedVisual((clip) => { clip.inPoint = Math.max(0, Number(event.target.value) || 0); }); endHistoryGroup(); });
$('#visualTransition').addEventListener('change', (event) => { updateSelectedVisual((clip) => { clip.transition = event.target.value; }); endHistoryGroup(); });
$('#visualTransitionDuration').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  $('#transitionDurationValue').textContent = `${value.toFixed(2)}초`;
  updateSelectedVisual((clip) => { clip.transitionDuration = value; }, 'transition-duration');
});
$('#visualTransitionDuration').addEventListener('change', endHistoryGroup);
['keyStartScale', 'keyEndScale', 'keyPanX', 'keyPanY'].forEach((id) => {
  const key = { keyStartScale: 'startScale', keyEndScale: 'endScale', keyPanX: 'panX', keyPanY: 'panY' }[id];
  $(`#${id}`).addEventListener('input', (event) => updateSelectedVisual((clip) => {
    clip.keyframes = { ...(clip.keyframes || {}), [key]: Number(event.target.value) };
  }, `key-${key}`));
  $(`#${id}`).addEventListener('change', endHistoryGroup);
});

/* 음악 편집 */
function updateSelectedAudio(mutate, tag) {
  const clip = selectedClip();
  if (!clip || selected.track !== 'audio') return;
  rememberState(tag);
  mutate(clip);
  renderTimeline();
  updateStageMedia();
}
$('#audioStart').addEventListener('change', (event) => { updateSelectedAudio((clip) => { clip.start = Math.max(0, Number(event.target.value) || 0); }); endHistoryGroup(); render(); });
$('#audioLength').addEventListener('change', (event) => { updateSelectedAudio((clip) => { clip.duration = Math.max(0.5, Number(event.target.value) || 1); }); endHistoryGroup(); render(); });
$('#audioVolume').addEventListener('input', (event) => updateSelectedAudio((clip) => { clip.volume = Number(event.target.value); }, 'audio-volume'));
$('#audioVolume').addEventListener('change', endHistoryGroup);

window.addEventListener('keydown', (event) => {
  const typing = event.target.matches('input,textarea,select');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (typing) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); splitAtPlayhead(); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); seekTo(playback.current - (event.shiftKey ? 1 : 0.1)); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); seekTo(playback.current + (event.shiftKey ? 1 : 0.1)); }
});

window.addEventListener('blur', pausePlayback);

state.timeline.caption = captionsFromScript([
  state.hook, '핵심 내용을 전달하세요', '저장과 공유를 유도하세요'
], state.duration);
render();
