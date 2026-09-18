const state = {
  keyword: '',
  items: [],
  analysis: null,
  concept: null,
  platformStatus: [],
  platform: 'all',
  sort: 'views',
  period: 'month',
  variant: 0,
  loading: false,
  // 레퍼런스 분해: 카드에서 담은 영상 id 와 그걸로 만든 설계도(사용자가 고친 값 포함)
  picked: [],
  blueprint: null,
  blueprintOptions: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const PLATFORM_LABEL = { youtube: 'YouTube Shorts', instagram: 'Instagram Reels', tiktok: 'TikTok' };
const MODE_LABEL = {
  api: { text: '공식 API 연결됨', tone: 'good' },
  public: { text: '공개 페이지 수집', tone: 'ok' },
  link: { text: '미연결 · 검색 링크만', tone: 'warn' },
  error: { text: '수집 실패', tone: 'bad' }
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatCount(value) {
  if (value === null || value === undefined) return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  if (number >= 100000000) return `${(number / 100000000).toFixed(1)}억`;
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}만`;
  return number.toLocaleString('ko-KR');
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '길이 미확인';
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}초`;
}

function timeAgo(value) {
  if (!value) return '게시 시점 미확인';
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return '게시 시점 미확인';
  if (minutes < 60) return `${Math.max(1, minutes)}분 전`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}시간 전`;
  if (minutes < 43200) return `${Math.round(minutes / 1440)}일 전`;
  if (minutes < 525600) return `${Math.round(minutes / 43200)}개월 전`;
  return `${Math.round(minutes / 525600)}년 전`;
}

function setStatus(text, busy = false) {
  $('#hunterStatus').classList.toggle('busy', busy);
  $('#hunterStatus').querySelector('span').textContent = text;
}

/* ------------------------------------------------------------------ */

async function loadHunter() {
  if (state.loading) return;
  const keyword = $('#hunterSearch').value.trim();
  if (!keyword) {
    $('#hunterSearch').focus();
    setStatus('키워드를 먼저 입력해 주세요');
    return;
  }
  state.loading = true;
  state.keyword = keyword;
  state.period = $('#periodSelect').value;
  state.sort = $('#sortSelect').value;
  $('#refreshButton').disabled = true;
  setStatus(`“${keyword}” 공개 숏폼을 모으는 중`, true);
  $('#shortsGrid').innerHTML = '<div class="loading-cards"><i></i><strong>공개 숏폼을 모으고 있습니다</strong><span>조회수·좋아요·댓글과 게시 시점을 함께 읽습니다.</span></div>';

  try {
    const result = await window.studio.loadHunter({
      keyword,
      platforms: state.platform === 'all' ? ['youtube', 'instagram', 'tiktok'] : [state.platform],
      sort: state.sort,
      period: state.period,
      limit: 12
    });
    state.items = result.items || [];
    state.analysis = result.analysis || null;
    state.concept = result.concept || null;
    state.platformStatus = result.platformStatus || [];
    state.variant = 0;
    state.picked = [];
    state.blueprint = null;
    renderPickedStrip();
    renderBlueprint();
    $('#updatedAt').textContent = `${new Date(result.collectedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 수집`;
    setStatus(`${state.items.filter((item) => item.dataQuality !== 'link-only').length}편 분석 완료`);
    renderAll();
  } catch (error) {
    $('#shortsGrid').innerHTML = `<div class="trend-empty"><strong>수집하지 못했습니다.</strong><span>${escapeHtml(error.message || '잠시 후 다시 시도해 주세요.')}</span></div>`;
    setStatus('수집 실패');
  } finally {
    state.loading = false;
    $('#refreshButton').disabled = false;
  }
}

function renderAll() {
  renderSourceStrip();
  renderAnalysis();
  renderCards();
  renderConcept();
  renderPlatformDots();
}

/* 플랫폼별 수집 방식과 연결 상태를 숨기지 않고 그대로 보여 준다. */
function renderSourceStrip() {
  $('#sourceStrip').innerHTML = state.platformStatus.map((status) => {
    const mode = MODE_LABEL[status.mode] || MODE_LABEL.error;
    return `<div class="source-pill ${mode.tone}">
      <strong>${escapeHtml(status.label)}</strong>
      <span>${escapeHtml(mode.text)}</span>
      <small>${status.count ? `${status.count}편 수집` : escapeHtml(status.message || '')}</small>
    </div>`;
  }).join('');
}

function renderPlatformDots() {
  $$('#platformBar button[data-platform]').forEach((button) => {
    const status = state.platformStatus.find((entry) => entry.platform === button.dataset.platform);
    const dot = button.querySelector('.dot');
    if (!dot) return;
    dot.className = `dot ${status ? (MODE_LABEL[status.mode] || MODE_LABEL.error).tone : ''}`;
  });
}

function renderAnalysis() {
  const analysis = state.analysis;
  if (!analysis || !analysis.sampleSize) {
    $('#analysisBlock').hidden = true;
    return;
  }
  $('#analysisBlock').hidden = false;
  $('#analysisSummary').textContent = `${analysis.sampleSize}편 기준 · 권장 길이 ${analysis.recommendedDuration}초 · 컷 약 ${analysis.recommendedCuts}개`;
  $('#signalGrid').innerHTML = analysis.signals.map((signal) => `
    <article class="signal-card">
      <small>${escapeHtml(signal.label)}</small>
      <strong>${escapeHtml(signal.value)}</strong>
      <p>${escapeHtml(signal.note)}</p>
    </article>`).join('');
}

function visibleItems() {
  const filtered = state.platform === 'all'
    ? state.items
    : state.items.filter((item) => item.platform === state.platform);
  const measured = filtered.filter((item) => item.dataQuality !== 'link-only');
  const links = filtered.filter((item) => item.dataQuality === 'link-only');
  const sorters = {
    views: (a, b) => (b.views || 0) - (a.views || 0),
    engagement: (a, b) => (b.metrics?.engagementRate ?? -1) - (a.metrics?.engagementRate ?? -1),
    velocity: (a, b) => (b.metrics?.viewsPerDay ?? -1) - (a.metrics?.viewsPerDay ?? -1),
    recent: (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
  };
  return [...measured.sort(sorters[state.sort] || sorters.views), ...links];
}

function renderCards() {
  const items = visibleItems();
  $('#resultCount').textContent = items.filter((item) => item.dataQuality !== 'link-only').length;
  if (!items.length) {
    $('#shortsGrid').innerHTML = '<div class="trend-empty"><strong>표시할 숏폼이 없습니다.</strong><span>다른 키워드나 기간으로 다시 수집해 보세요.</span></div>';
    return;
  }

  $('#shortsGrid').innerHTML = items.map((item, index) => {
    if (item.dataQuality === 'link-only') {
      return `<article class="short-card link-only" data-id="${escapeHtml(item.id)}">
        <div class="link-body">
          <span class="platform-tag ${escapeHtml(item.platform)}">${escapeHtml(item.platformLabel)}</span>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.dataNote)}</p>
        </div>
        <div class="card-buttons">
          <button class="ghost open-settings-inline">연결 설정</button>
          <button class="open-source" data-url="${escapeHtml(item.url)}">원문 검색 열기 ↗</button>
        </div>
      </article>`;
    }
    const analysis = state.analysis?.analyses?.find((entry) => entry.id === item.id);
    return `<article class="short-card" data-id="${escapeHtml(item.id)}">
      <div class="card-thumb ${item.thumbnail ? '' : 'no-thumb'}" ${item.thumbnail ? `style="background-image:url('${escapeHtml(item.thumbnail)}')"` : ''}>
        <span class="rank">${String(index + 1).padStart(2, '0')}</span>
        <span class="platform-tag ${escapeHtml(item.platform)}">${escapeHtml(item.platformLabel)}</span>
        <span class="duration">${escapeHtml(formatDuration(item.durationSeconds))}</span>
      </div>
      <div class="card-body">
        <div class="creator-row"><strong>${escapeHtml(item.creator)}</strong><time>${escapeHtml(timeAgo(item.publishedAt))}</time></div>
        <h3>${escapeHtml(item.title)}</h3>
        <div class="metric-row">
          <span><small>조회수</small><b>${formatCount(item.views)}</b></span>
          <span><small>좋아요</small><b>${formatCount(item.likes)}</b></span>
          <span><small>댓글</small><b>${formatCount(item.comments)}</b></span>
          <span><small>반응률</small><b>${item.metrics?.engagementRate ?? '-'}${item.metrics?.engagementRate ? '%' : ''}</b></span>
        </div>
        ${analysis ? `<div class="tag-row"><span>${escapeHtml(analysis.hookLabel)}</span><span>${escapeHtml(analysis.toneLabel)}</span><span>컷 약 ${analysis.estimatedCuts ?? '-'}개</span></div>` : ''}
        <div class="quality-line">${escapeHtml(item.dataNote)}</div>
      </div>
      <div class="card-buttons">
        <button class="ghost pick-button ${state.picked.includes(item.id) ? 'on' : ''}" data-id="${escapeHtml(item.id)}">${state.picked.includes(item.id) ? '담김 ✓' : '참고로 담기'}</button>
        <button class="ghost analyze-button" data-id="${escapeHtml(item.id)}">구조 분석</button>
        <button class="open-source" data-url="${escapeHtml(item.url)}">원문 ↗</button>
      </div>
    </article>`;
  }).join('');
  $$('.pick-button').forEach((button) => button.addEventListener('click', () => togglePick(button.dataset.id)));

  $$('.open-source').forEach((button) => button.addEventListener('click', () => window.studio.openExternal(button.dataset.url)));
  $$('.analyze-button').forEach((button) => button.addEventListener('click', () => openDetail(button.dataset.id)));
  $$('.open-settings-inline').forEach((button) => button.addEventListener('click', () => window.studio.openSettings()));
}

/* ------------------------------------------------------------------ */
/* 레퍼런스 분해 · 구조 편집                                             */
/* ------------------------------------------------------------------ */
// 카드에서 「참고로 담기」로 모은 영상을 뼈대(설계도)로 바꾸고, 설계도의 칸을 사용자가
// 직접 고친 뒤 편집 앱으로 넘긴다. 1편이면 그 영상의 구조, 여러 편이면 공통 구조.

function togglePick(id) {
  if (state.picked.includes(id)) state.picked = state.picked.filter((entry) => entry !== id);
  else state.picked.push(id);
  renderCards();
  renderPickedStrip();
}

function pickedItems() {
  return state.picked.map((id) => state.items.find((item) => item.id === id)).filter(Boolean);
}

function renderPickedStrip() {
  const items = pickedItems();
  $('#blueprintBlock').hidden = !items.length && !state.blueprint;
  $('#decomposeButton').disabled = !items.length;
  $('#blueprintSummary').textContent = items.length
    ? (items.length === 1 ? '1편 담김 · 이 영상의 뼈대를 그대로 편집합니다' : `${items.length}편 담김 · 공통 뼈대로 비슷한 유형을 만듭니다`)
    : '카드에서 「참고로 담기」를 누르면 여기서 뼈대를 뜯어 고칠 수 있습니다';
  $('#pickedStrip').innerHTML = items.map((item) => {
    const analysis = state.analysis?.analyses?.find((entry) => entry.id === item.id);
    return `<div class="picked-chip">
      <span class="platform-tag ${escapeHtml(item.platform)}">${escapeHtml(item.platformLabel)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(formatDuration(item.durationSeconds))}${analysis ? ` · ${escapeHtml(analysis.hookLabel)} · 컷 약 ${analysis.estimatedCuts ?? '-'}개 · ${escapeHtml(analysis.toneLabel)}` : ''}</small>
      <button data-id="${escapeHtml(item.id)}" aria-label="빼기">×</button>
    </div>`;
  }).join('');
  $$('#pickedStrip button').forEach((button) => button.addEventListener('click', () => togglePick(button.dataset.id)));
}

async function decompose() {
  const items = pickedItems();
  if (!items.length) return;
  setStatus(`${items.length}편의 구조를 뜯는 중`, true);
  const result = await window.studio.blueprint({ items, keyword: state.keyword || $('#hunterSearch').value.trim() });
  if (!result) { setStatus('분해할 수 있는 영상이 없습니다(검색 링크만 있는 항목은 수치가 없습니다)'); return; }
  state.blueprint = result.blueprint;
  state.blueprintOptions = result.options;
  renderBlueprint();
  setStatus(`${items.length}편 분해 완료 · 아래에서 구조를 고치세요`);
  $('#blueprintEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fillSelect(select, entries, current) {
  select.innerHTML = entries.map((entry) => {
    const value = typeof entry === 'string' ? entry : entry.key;
    const label = typeof entry === 'string' ? entry : entry.label;
    return `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function renderBlueprint() {
  const blueprint = state.blueprint;
  const options = state.blueprintOptions;
  $('#blueprintEditor').hidden = !blueprint;
  if (!blueprint || !options) return;
  $('#bpDuration').value = blueprint.duration;
  $('#bpCount').value = blueprint.scenes.length;
  fillSelect($('#bpHook'), options.hooks, blueprint.hookKey);
  fillSelect($('#bpTone'), options.tones, blueprint.tone);
  fillSelect($('#bpStructure'), options.structures, blueprint.structure);
  $('#visualOptions').innerHTML = options.visuals.map((visual) => `<option value="${escapeHtml(visual)}">`).join('');
  const hookGuide = options.hooks.find((entry) => entry.key === blueprint.hookKey)?.guide || '';
  $('#blueprintNote').textContent = `${blueprint.note} ${hookGuide}`;

  $('#sceneTable').innerHTML = `<div class="scene-row scene-head">
      <span>#</span><span>시간</span><span>역할</span><span>자막(새 문장)</span><span>화면</span><span>전환</span><span>강조</span><span></span>
    </div>` + blueprint.scenes.map((scene, index) => `
    <div class="scene-row role-${escapeHtml(scene.role)}" data-index="${index}">
      <span class="scene-no">${index + 1}</span>
      <span class="scene-time"><input type="number" step="0.1" min="0" data-field="start" value="${scene.start}"><i>→</i><input type="number" step="0.1" min="0" data-field="end" value="${scene.end}"></span>
      <select data-field="role">${options.roles.map((role) => `<option value="${role.key}" ${role.key === scene.role ? 'selected' : ''}>${role.label}</option>`).join('')}</select>
      <input type="text" data-field="caption" value="${escapeHtml(scene.caption)}" placeholder="비우면 자막 없이 화면만">
      <input type="text" data-field="visual" list="visualOptions" value="${escapeHtml(scene.visual)}">
      <select data-field="transition">${options.transitions.map((name) => `<option value="${escapeHtml(name)}" ${name === scene.transition ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select>
      <input type="text" data-field="emphasis" value="${escapeHtml(scene.emphasis || '')}">
      <span class="scene-ops"><button data-op="up" title="위로">↑</button><button data-op="down" title="아래로">↓</button><button data-op="remove" title="장면 삭제">×</button></span>
    </div>`).join('');

  $$('#sceneTable [data-field]').forEach((input) => input.addEventListener('change', () => onSceneFieldChange(input)));
  $$('#sceneTable [data-op]').forEach((button) => button.addEventListener('click', () => onSceneOp(button)));
}

// 장면 칸을 직접 고친 값은 그대로 설계도에 넣는다. 시간은 겹치지 않게만 바로잡는다.
function onSceneFieldChange(input) {
  const row = input.closest('.scene-row');
  const index = Number(row.dataset.index);
  const scene = state.blueprint.scenes[index];
  if (!scene) return;
  const field = input.dataset.field;
  if (field === 'start' || field === 'end') {
    const value = Math.max(0, Number(input.value) || 0);
    scene[field] = Number(value.toFixed(1));
    if (scene.end <= scene.start) scene.end = Number((scene.start + 0.5).toFixed(1));
    // 앞뒤 장면과 이어 붙인다. 손으로 만진 길이는 비중(weight)으로 남겨 재배분 때도 지킨다.
    const previous = state.blueprint.scenes[index - 1];
    const next = state.blueprint.scenes[index + 1];
    if (previous && previous.end !== scene.start) previous.end = scene.start;
    if (next && next.start !== scene.end) next.start = scene.end;
    if (scene.role === 'body') scene.weight = Math.max(0.2, scene.end - scene.start);
    state.blueprint.duration = Math.max(state.blueprint.duration, Math.round(state.blueprint.scenes.at(-1).end));
    renderBlueprint();
  } else if (field === 'role') {
    scene.role = input.value;
    row.className = `scene-row role-${scene.role}`;
  } else {
    scene[field] = input.value;
  }
  $('#bpDuration').value = state.blueprint.duration;
}

async function onSceneOp(button) {
  const row = button.closest('.scene-row');
  const index = Number(row.dataset.index);
  const scenes = state.blueprint.scenes;
  const op = button.dataset.op;
  if (op === 'remove') {
    if (scenes.length <= 2) { setStatus('장면은 최소 2개가 필요합니다'); return; }
    scenes.splice(index, 1);
  } else if (op === 'up' && index > 0) {
    [scenes[index - 1], scenes[index]] = [scenes[index], scenes[index - 1]];
  } else if (op === 'down' && index < scenes.length - 1) {
    [scenes[index + 1], scenes[index]] = [scenes[index], scenes[index + 1]];
  } else return;
  await refreshBlueprint('redistribute');
}

async function refreshBlueprint(change, options = {}) {
  if (!state.blueprint) return;
  const next = await window.studio.updateBlueprint({ blueprint: state.blueprint, change, options });
  if (next) state.blueprint = next;
  renderBlueprint();
}

async function sendBlueprint() {
  if (!state.blueprint) return;
  const concept = await window.studio.blueprintConcept({ blueprint: state.blueprint });
  if (!concept) return;
  state.concept = concept;
  renderConcept();
  await window.studio.sendConcept(concept);
  const button = $('#bpSendButton');
  button.textContent = '편집 앱에 이 구조로 초안을 만들었습니다 ✓';
  setTimeout(() => { button.textContent = '이 구조로 편집 앱에 보내기 →'; }, 2200);
}

$('#decomposeButton').addEventListener('click', decompose);
$('#clearPickedButton').addEventListener('click', () => {
  state.picked = [];
  state.blueprint = null;
  renderCards();
  renderPickedStrip();
  renderBlueprint();
});
$('#bpDuration').addEventListener('change', () => { state.blueprint.duration = Number($('#bpDuration').value) || state.blueprint.duration; refreshBlueprint('duration'); });
$('#bpCount').addEventListener('change', () => refreshBlueprint('count', { count: Number($('#bpCount').value) }));
['#bpHook', '#bpTone', '#bpStructure'].forEach((selector) => {
  $(selector).addEventListener('change', () => {
    state.blueprint.hookKey = $('#bpHook').value;
    state.blueprint.tone = $('#bpTone').value;
    state.blueprint.structure = $('#bpStructure').value;
    // 훅·문체·구조를 바꾸면 문장을 다시 짓는다(장면 수·시간은 그대로). 손으로 쓴 자막은 덮인다.
    refreshBlueprint('rewrite', { variant: state.blueprint.variant || 0 });
  });
});
$('#bpAddScene').addEventListener('click', () => refreshBlueprint('count', { count: state.blueprint.scenes.length + 1 }));
$('#bpRedistribute').addEventListener('click', () => refreshBlueprint('redistribute'));
$('#bpRewrite').addEventListener('click', () => refreshBlueprint('rewrite'));
$('#bpFindMedia').addEventListener('click', () => {
  if (!state.blueprint) return;
  const firstVisual = state.blueprint.scenes.find((scene) => scene.role === 'body')?.visual;
  window.studio.openWebMediaPanel({ kind: 'video', query: firstVisual || state.blueprint.keyword });
});
$('#bpSendButton').addEventListener('click', sendBlueprint);

// 뉴보대에서 「숏폼 만들기」로 넘어오면 검색어를 채우고 바로 수집한다.
window.studio.onHunterPrefill((payload) => {
  const keyword = String(payload?.keyword || '').trim();
  if (!keyword) return;
  $('#hunterSearch').value = keyword;
  loadHunter();
});

/* ------------------------------------------------------------------ */

function renderConcept() {
  const concept = state.concept;
  if (!concept) {
    $('#conceptBlock').hidden = true;
    return;
  }
  $('#conceptBlock').hidden = false;
  $('#conceptHook').style.setProperty('--a', concept.palette[0]);
  $('#conceptHook').style.setProperty('--b', concept.palette[1]);
  $('#conceptHook').innerHTML = `
    <small>첫 문장</small>
    <h3>${escapeHtml(concept.hook)}</h3>
    <p>${escapeHtml(concept.insight)}</p>
    <dl>
      <div><dt>길이</dt><dd>${concept.duration}초</dd></div>
      <div><dt>구성</dt><dd>${escapeHtml(concept.structure)}</dd></div>
      <div><dt>문체</dt><dd>${escapeHtml(concept.tone)}</dd></div>
      <div><dt>컷</dt><dd>약 ${concept.recommendedCuts}개 · ${concept.cutTempo}초 간격</dd></div>
      <div><dt>음악</dt><dd>${escapeHtml(concept.musicMood)}</dd></div>
    </dl>
    <div class="hashtag-row">${concept.hashtags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>`;

  $('#conceptBoard').innerHTML = concept.scenes.map((scene) => `
    <div class="board-row">
      <span class="board-time">${scene.start}s<i>→</i>${scene.end}s</span>
      <span class="board-visual">${escapeHtml(scene.visual)}<small>${escapeHtml(scene.transition)}</small></span>
      <span class="board-caption">${escapeHtml(scene.caption)}<small>${escapeHtml(scene.emphasis)}</small></span>
    </div>`).join('');

  $('#originalityNote').textContent = concept.originality;
}

async function remixConcept() {
  if (!state.analysis?.sampleSize) return;
  state.variant += 1;
  const concept = await window.studio.remixConcept({
    keyword: state.keyword, analysis: state.analysis, variant: state.variant
  });
  if (concept) {
    state.concept = concept;
    renderConcept();
  }
}

async function sendConcept() {
  if (!state.concept) return;
  await window.studio.sendConcept(state.concept);
  const button = $('#sendConceptButton');
  button.textContent = '편집 앱에 초안을 만들었습니다 ✓';
  setTimeout(() => { button.textContent = '편집 앱으로 보내기 →'; }, 2200);
}

/* ------------------------------------------------------------------ */

function openDetail(id) {
  const item = state.items.find((entry) => entry.id === id);
  const analysis = state.analysis?.analyses?.find((entry) => entry.id === id);
  if (!item || !analysis) return;

  $('#detailCard').innerHTML = `
    <div class="detail-head">
      <div>
        <span class="detail-platform">${escapeHtml(item.platformLabel)} · ${escapeHtml(item.creator)}</span>
        <h2>${escapeHtml(item.title)}</h2>
        <p>${escapeHtml(timeAgo(item.publishedAt))} · ${escapeHtml(formatDuration(item.durationSeconds))} · ${escapeHtml(item.dataNote)}</p>
      </div>
      <button class="detail-close" aria-label="닫기">×</button>
    </div>
    <div class="detail-metrics">
      <div><small>조회수</small><strong>${formatCount(item.views)}</strong></div>
      <div><small>좋아요</small><strong>${formatCount(item.likes)}</strong></div>
      <div><small>댓글</small><strong>${formatCount(item.comments)}</strong></div>
      <div><small>반응률</small><strong>${item.metrics?.engagementRate ?? '-'}${item.metrics?.engagementRate ? '%' : ''}</strong></div>
      <div><small>하루 조회수</small><strong>${formatCount(item.metrics?.viewsPerDay)}</strong></div>
    </div>
    <div class="detail-analysis">
      <section>
        <h4>훅</h4>
        <strong>${escapeHtml(analysis.hookLabel)}</strong>
        <p>${escapeHtml(analysis.hookGuide)}</p>
      </section>
      <section>
        <h4>자막 문체</h4>
        <strong>${escapeHtml(analysis.toneLabel)}</strong>
        <p>문장 평균 ${analysis.captionSentenceLength ?? '-'}자 · 이모지 ${analysis.emoji}개 · 해시태그 ${analysis.hashtagCount}개</p>
      </section>
      <section>
        <h4>길이와 장면 전환</h4>
        <strong>${escapeHtml(analysis.durationLabel)}</strong>
        <p>컷 약 ${analysis.estimatedCuts ?? '-'}개 · ${analysis.cutTempo ?? '-'}초 간격 (${escapeHtml(analysis.estimateNote)})</p>
      </section>
      <section>
        <h4>콘텐츠 구조</h4>
        <strong>${escapeHtml(analysis.structure)}</strong>
        <p>${escapeHtml(analysis.durationNote)}</p>
      </section>
    </div>
    ${item.caption ? `<div class="detail-caption"><h4>공개 캡션 (원문 인용, 참고용)</h4><pre>${escapeHtml(item.caption.slice(0, 500))}</pre></div>` : ''}
    ${item.hashtags?.length ? `<div class="hashtag-row">${item.hashtags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
    <div class="detail-actions">
      <button class="cancel-detail">닫기</button>
      <button class="open-detail-source">원문 열기 ↗</button>
    </div>`;

  $('#detailOverlay').classList.add('open');
  $('.detail-close').addEventListener('click', closeDetail);
  $('.cancel-detail').addEventListener('click', closeDetail);
  $('.open-detail-source').addEventListener('click', () => window.studio.openExternal(item.url));
}

function closeDetail() { $('#detailOverlay').classList.remove('open'); }

/* ------------------------------------------------------------------ */

$('#refreshButton').addEventListener('click', loadHunter);
$('#hunterSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadHunter(); });
$('#clearSearch').addEventListener('click', () => { $('#hunterSearch').value = ''; $('#hunterSearch').focus(); });
$('#sortSelect').addEventListener('change', () => { state.sort = $('#sortSelect').value; renderCards(); });
$('#periodSelect').addEventListener('change', () => { state.period = $('#periodSelect').value; });
$('#openSettings').addEventListener('click', () => window.studio.openSettings());
$('#remixButton').addEventListener('click', remixConcept);
$('#findMediaButton').addEventListener('click', () => {
  if (!state.concept) return;
  // 조회수 높은 숏폼이 실제로 쓰는 화면 키워드를 그대로 소재 검색어로 넘긴다.
  window.studio.openWebMediaPanel({
    kind: 'video',
    query: state.concept.visualKeywords?.[0] || state.keyword
  });
});
$('#sendConceptButton').addEventListener('click', sendConcept);
$('#platformBar').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-platform]');
  if (!button) return;
  state.platform = button.dataset.platform;
  $$('#platformBar button[data-platform]').forEach((item) => item.classList.toggle('active', item === button));
  renderCards();
});
$('#detailOverlay').addEventListener('click', (event) => { if (event.target === $('#detailOverlay')) closeDetail(); });
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
$('#hunterSearch').focus();
