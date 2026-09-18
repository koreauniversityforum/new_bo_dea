// 수집한 공개 숏폼의 훅·자막 문체·장면 전환·길이·구조를 분석하고,
// 그 패턴만 참고해 완전히 새로운 대본·자막·스토리보드를 만든다.
// 남의 문장을 그대로 옮기지 않는다. 분석 결과(형식)만 재료로 쓴다.

const HOOK_TYPES = [
  {
    key: 'question', label: '질문형',
    test: (text) => /[?？]/.test(text) || /(왜|어떻게|뭐가|무엇|어디|누가|맞나|일까|할까|인가요)/.test(text),
    guide: '첫 문장에서 답을 미루고 질문을 던져 시청자가 답을 확인하러 남게 만든다.'
  },
  {
    key: 'number', label: '숫자형',
    test: (text) => /(\d+\s*(가지|개|초|분|일|주|년|위|원|만원|배|%))|TOP\s*\d|탑\s*\d/i.test(text),
    guide: '개수를 먼저 약속해 끝까지 볼 이유를 만든다. 화면에도 1/2/3 카운터를 띄운다.'
  },
  {
    key: 'warning', label: '경고·금지형',
    test: (text) => /(하지\s?마|절대|주의|실수|망하|후회|모르면|놓치|위험|큰일)/.test(text),
    guide: '손해를 먼저 보여 주고 해결을 뒤에 붙인다. 첫 1초에 강한 단어를 크게 띄운다.'
  },
  {
    key: 'reveal', label: '반전·결과형',
    test: (text) => /(했더니|해봤|결과|충격|소름|난리|대박|미쳤|진짜|실화|레전드)/.test(text),
    guide: '결과 화면을 0.5초 먼저 보여 준 뒤 과정으로 되돌아간다.'
  },
  {
    key: 'howto', label: '방법·정보형',
    test: (text) => /(방법|하는\s?법|레시피|꿀팁|정리|추천|가이드|치트키|비법|만들기)/.test(text),
    guide: '완성 장면을 먼저 보여 주고 준비물부터 순서대로 붙인다.'
  },
  {
    key: 'empathy', label: '공감형',
    test: (text) => /(우리|다들|나만|여러분|그럴\s?때|일상|현실|공감|~할\s?때)/.test(text),
    guide: '보는 사람의 상황을 그대로 묘사해 “내 얘기”로 만든다.'
  }
];

const DURATION_BUCKETS = [
  { key: 'flash', label: '초단(15초 이하)', max: 15, cuts: 2.0, note: '한 가지 장면만 보여 주고 바로 끝낸다.' },
  { key: 'standard', label: '표준(16~30초)', max: 30, cuts: 2.4, note: '훅 → 본론 3단 → 마무리 한 줄이 들어가는 길이.' },
  { key: 'extended', label: '확장(31~60초)', max: 60, cuts: 2.8, note: '과정을 보여 줄 수 있어 설명형에 적합하다.' },
  { key: 'long', label: '장문(60초 이상)', max: 999, cuts: 3.4, note: '이야기 구조가 필요하다. 중간 이탈을 막을 두 번째 훅을 넣는다.' }
];

const TONE_RULES = [
  { key: 'casual', label: '반말 구어체', test: (text) => /(했어|하자|해봐|이거|진짜|개|ㅋㅋ|ㅠㅠ|없음|있음)/.test(text) },
  { key: 'polite', label: '존댓말', test: (text) => /(요\b|습니다|세요|입니다|해요|보세요)/.test(text) },
  { key: 'declarative', label: '명사·단정형', test: (text) => /(정리|완성|끝|주의|필수|추천|공개)$/.test(text.trim()) }
];

const STRUCTURES = {
  flash: ['한 장면 반복', '훅 → 결과'],
  standard: ['훅 → 근거 3개 → 마무리', '문제 → 해결 → 결과'],
  extended: ['훅 → 과정 → 결과 → 정리', '비교 → 이유 → 결론'],
  long: ['훅 → 상황 → 전환 → 결말 → 요약']
};

const PALETTES = [
  ['#ff6b4a', '#ffcf5a'], ['#7c5cff', '#22d3ee'], ['#12b981', '#0f766e'],
  ['#f472b6', '#f97316'], ['#38bdf8', '#1d4ed8'], ['#facc15', '#b45309']
];

function firstLine(item) {
  return String(item.title || item.caption || '').split('\n')[0].trim();
}

function median(values, decimals = 0) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  const value = list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  return decimals ? Number(value.toFixed(decimals)) : Math.round(value);
}

function bucketOf(seconds) {
  const value = Number.isFinite(seconds) ? seconds : 30;
  return DURATION_BUCKETS.find((bucket) => value <= bucket.max) || DURATION_BUCKETS.at(-1);
}

function hookTypeOf(text) {
  return HOOK_TYPES.find((type) => type.test(text)) || HOOK_TYPES.find((type) => type.key === 'howto');
}

function toneOf(text) {
  const matched = TONE_RULES.filter((rule) => rule.test(text));
  return matched.length ? matched[0] : { key: 'neutral', label: '중립 서술체' };
}

function emojiCount(text) {
  // 한글도 코드포인트가 커서 범위 비교로는 셀 수 없다. 그림문자 속성으로만 센다.
  return (String(text || '').match(/\p{Extended_Pictographic}/gu) || []).length;
}

/* ------------------------------------------------------------------ */
/* 개별 영상 분석                                                       */
/* ------------------------------------------------------------------ */

function analyzeItem(item) {
  const headline = firstLine(item);
  const caption = String(item.caption || '');
  const hook = hookTypeOf(headline);
  const bucket = bucketOf(item.durationSeconds);
  const tone = toneOf(`${headline} ${caption.slice(0, 120)}`);
  const seconds = Number.isFinite(item.durationSeconds) ? item.durationSeconds : null;
  const estimatedCuts = seconds ? Math.max(2, Math.round(seconds / bucket.cuts)) : null;
  const sentences = caption.split(/[.!?\n]/).map((line) => line.trim()).filter(Boolean);
  const engagement = item.metrics?.engagementRate;

  return {
    id: item.id,
    headline,
    hookType: hook.key,
    hookLabel: hook.label,
    hookGuide: hook.guide,
    durationBucket: bucket.key,
    durationLabel: bucket.label,
    durationNote: bucket.note,
    estimatedCuts,
    cutTempo: seconds && estimatedCuts ? Number((seconds / estimatedCuts).toFixed(1)) : null,
    tone: tone.key,
    toneLabel: tone.label,
    captionLength: caption.length,
    captionSentenceLength: sentences.length ? Math.round(sentences.join(' ').length / sentences.length) : null,
    emoji: emojiCount(`${headline} ${caption}`),
    hashtagCount: (item.hashtags || []).length,
    structure: STRUCTURES[bucket.key][0],
    engagementGrade: engagement === null || engagement === undefined ? null
      : engagement >= 8 ? 'A' : engagement >= 4 ? 'B' : engagement >= 1.5 ? 'C' : 'D',
    // 컷 수와 템포는 공개 메타데이터로 계산한 추정치다. 영상 파일은 내려받지 않는다.
    estimateNote: '길이 기반 추정값입니다. 영상 파일은 내려받지 않습니다.'
  };
}

/* ------------------------------------------------------------------ */
/* 묶음 분석                                                            */
/* ------------------------------------------------------------------ */

function rank(entries) {
  return [...entries.entries()].sort((a, b) => b[1] - a[1]);
}

function analyzeCollection(items, keyword = '') {
  const usable = items.filter((item) => item.dataQuality !== 'link-only');
  const analyses = usable.map(analyzeItem);
  if (!analyses.length) {
    return { sampleSize: 0, keyword, signals: [], analyses: [], hashtags: [], platforms: [] };
  }

  const hookCounts = new Map();
  const toneCounts = new Map();
  const structureCounts = new Map();
  const hashtagCounts = new Map();
  const platformCounts = new Map();

  analyses.forEach((analysis) => {
    hookCounts.set(analysis.hookLabel, (hookCounts.get(analysis.hookLabel) || 0) + 1);
    toneCounts.set(analysis.toneLabel, (toneCounts.get(analysis.toneLabel) || 0) + 1);
    structureCounts.set(analysis.structure, (structureCounts.get(analysis.structure) || 0) + 1);
  });
  usable.forEach((item) => {
    platformCounts.set(item.platformLabel, (platformCounts.get(item.platformLabel) || 0) + 1);
    (item.hashtags || []).forEach((tag) => hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1));
  });

  const durations = analyses.map((analysis) => usable.find((item) => item.id === analysis.id)?.durationSeconds)
    .filter((value) => Number.isFinite(value));
  const medianDuration = median(durations) || 28;
  const medianEngagement = median(usable.map((item) => item.metrics?.engagementRate).filter(Number.isFinite), 2);
  const medianViews = median(usable.map((item) => item.views).filter(Number.isFinite));
  const bucket = bucketOf(medianDuration);
  const topHook = rank(hookCounts)[0];
  const topTone = rank(toneCounts)[0];
  const topStructure = rank(structureCounts)[0];
  const freshest = usable.filter((item) => item.publishedAt)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
  const hookDefinition = HOOK_TYPES.find((type) => type.label === topHook?.[0]) || HOOK_TYPES[0];
  const emojiHeavy = analyses.filter((analysis) => analysis.emoji >= 2).length / analyses.length;

  const percent = (count) => Math.round((count / analyses.length) * 100);

  return {
    keyword,
    sampleSize: analyses.length,
    analyses,
    platforms: rank(platformCounts).map(([label, count]) => ({ label, count })),
    hashtags: rank(hashtagCounts).slice(0, 12).map(([tag, count]) => ({ tag, count })),
    medianDuration,
    medianEngagement,
    medianViews,
    recommendedDuration: Math.min(60, Math.max(12, Math.round(medianDuration / 2) * 2)),
    recommendedCuts: Math.max(3, Math.round(medianDuration / bucket.cuts)),
    cutTempo: bucket.cuts,
    dominantHook: topHook?.[0] || '방법·정보형',
    dominantHookKey: hookDefinition.key,
    dominantHookGuide: hookDefinition.guide,
    dominantTone: topTone?.[0] || '존댓말',
    dominantStructure: topStructure?.[0] || STRUCTURES[bucket.key][0],
    emojiUsage: emojiHeavy >= 0.5 ? '이모지 적극 사용' : emojiHeavy >= 0.2 ? '이모지 절제 사용' : '이모지 거의 없음',
    freshest: freshest ? { title: firstLine(freshest), publishedAt: freshest.publishedAt, url: freshest.url } : null,
    signals: [
      { label: '분석한 공개 영상', value: `${analyses.length}편`, note: '조회수·반응이 높은 순으로 수집했습니다.' },
      { label: '많이 쓰는 훅', value: `${topHook?.[0]} ${percent(topHook?.[1] || 0)}%`, note: hookDefinition.guide },
      { label: '자막 문체', value: `${topTone?.[0]} ${percent(topTone?.[1] || 0)}%`, note: `${emojiHeavy >= 0.5 ? '이모지를 적극적으로 섞습니다.' : '이모지는 최소한으로 씁니다.'}` },
      { label: '영상 길이 중앙값', value: `${medianDuration}초`, note: bucket.note },
      { label: '장면 전환', value: `약 ${bucket.cuts}초에 한 번`, note: '길이 기준 추정값입니다.' },
      { label: '많이 쓰는 구조', value: topStructure?.[0] || '', note: '같은 구조를 쓰되 내용은 새로 만듭니다.' },
      ...(medianEngagement !== null ? [{ label: '반응률 중앙값', value: `${medianEngagement}%`, note: '(좋아요+댓글+공유) ÷ 조회수' }] : []),
      ...(medianViews !== null ? [{ label: '조회수 중앙값', value: `${medianViews.toLocaleString('ko-KR')}회`, note: '이 주제의 현재 기준선입니다.' }] : [])
    ]
  };
}

/* ------------------------------------------------------------------ */
/* 새 대본 생성 - 수집한 문장을 쓰지 않고 형식만 따른다                  */
/* ------------------------------------------------------------------ */

const HOOK_TEMPLATES = {
  question: [
    (topic) => `${topic}, 왜 다들 이렇게 하고 있을까요?`,
    (topic) => `${topic} 이거 하나로 끝난다는데 진짜일까요?`,
    (topic) => `${topic} 할 때 이 순서 맞나요?`
  ],
  number: [
    (topic) => `${topic}, 딱 3가지만 기억하세요`,
    (topic) => `${topic} 바꾸는 데 30초면 충분합니다`,
    (topic) => `${topic} 잘하는 사람들의 2가지 습관`
  ],
  warning: [
    (topic) => `${topic} 이렇게 하면 시간만 버립니다`,
    (topic) => `${topic} 시작 전에 이건 꼭 확인하세요`,
    (topic) => `${topic}, 대부분 여기서 실수합니다`
  ],
  reveal: [
    (topic) => `${topic} 방식을 바꿨더니 결과가 이렇게 달라졌습니다`,
    (topic) => `${topic} 이 방법, 직접 해보고 놀랐습니다`,
    (topic) => `${topic} 하루 만에 이만큼 정리됩니다`
  ],
  howto: [
    (topic) => `${topic}, 가장 쉬운 순서로 정리했습니다`,
    (topic) => `${topic} 처음이라면 이 순서대로만 하세요`,
    (topic) => `${topic} 준비물 하나면 바로 됩니다`
  ],
  empathy: [
    (topic) => `${topic} 할 때마다 이런 적 있으시죠`,
    (topic) => `${topic}, 저만 이렇게 헤맸던 거 아니죠`,
    (topic) => `${topic} 하다가 결국 포기했던 분들께`
  ]
};

const BODY_TEMPLATES = {
  '훅 → 근거 3개 → 마무리': (topic) => [
    `첫째, ${topic}에서 가장 먼저 손대야 할 부분입니다.`,
    `둘째, 여기만 바꿔도 결과가 눈에 보입니다.`,
    `셋째, 끝까지 유지하려면 이 습관이 필요합니다.`,
    '지금 화면 그대로 따라 해 보세요.'
  ],
  '문제 → 해결 → 결과': (topic) => [
    `${topic}에서 가장 자주 막히는 지점부터 보여 드릴게요.`,
    '해결은 생각보다 단순합니다. 순서만 바꾸면 됩니다.',
    '바꾸고 나면 이 정도까지 정리됩니다.',
    '오늘 바로 한 번만 해 보세요.'
  ],
  '훅 → 결과': (topic) => [
    `${topic}, 결과부터 보여 드립니다.`,
    '과정은 딱 두 단계였습니다.',
    '이 순서만 기억하세요.'
  ],
  '한 장면 반복': (topic) => [
    `${topic}, 이 장면 하나면 설명 끝납니다.`,
    '다시 한 번 천천히 보여 드릴게요.',
    '저장해 두고 그대로 따라 하세요.'
  ],
  '훅 → 과정 → 결과 → 정리': (topic) => [
    `${topic}, 준비물부터 확인하겠습니다.`,
    '순서대로 진행하면 여기까지 옵니다.',
    '중간에 이 부분만 놓치지 마세요.',
    '결과는 이렇게 나옵니다.',
    '핵심만 한 줄로 정리하면 이겁니다.'
  ],
  '비교 → 이유 → 결론': (topic) => [
    `${topic}, 두 가지 방식을 나란히 놓고 보겠습니다.`,
    '차이가 생기는 이유는 하나입니다.',
    '그래서 저는 이 방식을 씁니다.',
    '여러분 상황에는 어떤 쪽이 맞을까요?'
  ],
  '훅 → 상황 → 전환 → 결말 → 요약': (topic) => [
    `${topic}, 어제까지의 상황부터 말씀드릴게요.`,
    '여기서 방향을 한 번 바꿨습니다.',
    '바꾸고 나서 달라진 부분입니다.',
    '결과는 이렇게 마무리됐습니다.',
    '오늘 내용을 한 줄로 정리합니다.'
  ]
};

const CLOSERS = [
  '도움이 됐다면 저장해 두세요.',
  '비슷한 상황이라면 댓글로 알려 주세요.',
  '다음 편에서 이어서 정리하겠습니다.',
  '저장해 두고 필요할 때 꺼내 보세요.'
];

const VISUAL_MOVES = [
  '정면 클로즈업으로 시작',
  '손 동작 위에서 촬영',
  '전후 화면 좌우 분할',
  '큰 자막 한 줄만 남기기',
  '결과 화면 정지 컷',
  '작업 과정 빠른 배속'
];

const TRANSITIONS = ['컷 전환', '왼쪽으로 밀기', '화이트 플래시', '점프 컷', '확대 후 컷'];

// 같은 키워드에는 같은 결과가 나오도록 무작위 대신 문자열 기반 인덱스를 쓴다.
function seededIndex(seed, length) {
  let total = 0;
  for (const char of String(seed)) total = (total * 31 + char.codePointAt(0)) % 100000;
  return length ? total % length : 0;
}

function toneAdjust(line, tone) {
  if (tone !== '반말 구어체') return line;
  return line
    .replace(/하세요/g, '해봐')
    .replace(/합니다/g, '해')
    .replace(/입니다/g, '이야')
    .replace(/드릴게요/g, '줄게')
    .replace(/드립니다/g, '줄게')
    .replace(/했습니다/g, '했어')
    .replace(/됩니다/g, '돼')
    .replace(/보세요/g, '봐')
    .replace(/주세요/g, '줘')
    .replace(/있으시죠/g, '있지')
    .replace(/까요\?/g, '까?')
    .replace(/요\?/g, '?');
}

function buildConcept(keyword, collection, options = {}) {
  const topic = String(keyword || '').trim() || '이 주제';
  const seed = `${topic}-${options.variant || 0}`;
  const hookKey = collection.dominantHookKey && HOOK_TEMPLATES[collection.dominantHookKey]
    ? collection.dominantHookKey : 'howto';
  const hookPool = HOOK_TEMPLATES[hookKey];
  const hook = toneAdjust(hookPool[seededIndex(seed, hookPool.length)](topic), collection.dominantTone);

  const structure = BODY_TEMPLATES[collection.dominantStructure] ? collection.dominantStructure : '훅 → 근거 3개 → 마무리';
  const body = BODY_TEMPLATES[structure](topic).map((line) => toneAdjust(line, collection.dominantTone));
  const closer = toneAdjust(CLOSERS[seededIndex(`${seed}-closer`, CLOSERS.length)], collection.dominantTone);

  const duration = options.duration || collection.recommendedDuration || 28;
  const script = [hook, ...body, closer];
  const perScene = Math.max(2, Number((duration / script.length).toFixed(1)));

  const scenes = script.map((line, index) => {
    const start = Number((perScene * index).toFixed(1));
    return {
      index: index + 1,
      start,
      end: Number(Math.min(duration, start + perScene).toFixed(1)),
      caption: line,
      visual: VISUAL_MOVES[(seededIndex(seed, VISUAL_MOVES.length) + index) % VISUAL_MOVES.length],
      transition: index === script.length - 1 ? '정지' : TRANSITIONS[(index + seededIndex(seed, TRANSITIONS.length)) % TRANSITIONS.length],
      emphasis: index === 0 ? '가장 큰 자막 · 화면 상단' : index === script.length - 1 ? '행동 유도 문구 · 화면 하단' : '핵심 단어만 강조'
    };
  });

  const hashtags = [...new Set([
    topic.replace(/\s+/g, ''),
    ...collection.hashtags.slice(0, 5).map((entry) => entry.tag)
  ])].filter(Boolean).slice(0, 6);

  return {
    id: `concept-${seededIndex(seed, 999999)}`,
    title: `${topic} 숏폼 초안`,
    category: '헌터 분석',
    hook,
    script,
    scenes,
    duration,
    cutTempo: collection.cutTempo || 2.4,
    recommendedCuts: collection.recommendedCuts || Math.max(3, script.length),
    tone: collection.dominantTone,
    structure,
    hashtags,
    palette: PALETTES[seededIndex(seed, PALETTES.length)],
    visualKeywords: [topic, ...VISUAL_MOVES.slice(0, 2)].slice(0, 4),
    musicMood: ['담백한 로파이', '경쾌한 팝', '미니멀 전자음', '따뜻한 어쿠스틱'][seededIndex(`${seed}-music`, 4)],
    insight: `${collection.dominantHook} 훅과 ‘${structure}’ 구조가 이 주제에서 가장 많이 쓰였습니다. 같은 형식으로 새 문장을 만들었습니다.`,
    basedOn: {
      sampleSize: collection.sampleSize,
      medianDuration: collection.medianDuration,
      medianEngagement: collection.medianEngagement,
      platforms: collection.platforms
    },
    originality: '수집한 영상에서 가져온 것은 훅 유형·길이·구조·문체 통계뿐입니다. 문장, 화면 구성, 자막은 새로 만들었습니다.'
  };
}


/* ------------------------------------------------------------------ */
/* 레퍼런스 분해 - 고른 영상(1편 또는 여러 편)의 구조를 편집 가능한 설계도로 */
/* ------------------------------------------------------------------ */
// 설계도(blueprint)는 「무엇을 베낄지」가 아니라 「어떤 뼈대를 쓸지」다.
// 길이·훅 유형·문체·구조·장면 수·장면별 시간/전환/화면 지시만 담고, 자막 문장은
// 우리 템플릿으로 새로 짓는다. 사용자는 이 설계도의 모든 칸을 손으로 고칠 수 있다.

const SCENE_ROLES = [
  { key: 'hook', label: '훅' },
  { key: 'body', label: '본론' },
  { key: 'closer', label: '마무리' }
];

const TONE_OPTIONS = ['존댓말', '반말 구어체', '명사·단정형', '중립 서술체'];
const STRUCTURE_OPTIONS = Object.keys(BODY_TEMPLATES);
const TRANSITION_OPTIONS = [...TRANSITIONS, '정지'];

function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }

function referenceSummary(item, analysis) {
  return {
    id: item.id,
    title: firstLine(item),
    platform: item.platform,
    platformLabel: item.platformLabel,
    creator: item.creator,
    url: item.url,
    thumbnail: item.thumbnail || null,
    views: item.views ?? null,
    engagementRate: item.metrics?.engagementRate ?? null,
    durationSeconds: Number.isFinite(item.durationSeconds) ? item.durationSeconds : null,
    hookKey: analysis.hookType,
    hookLabel: analysis.hookLabel,
    toneLabel: analysis.toneLabel,
    structure: analysis.structure,
    estimatedCuts: analysis.estimatedCuts,
    cutTempo: analysis.cutTempo
  };
}

// 장면 시간 배분: 훅은 짧고 세게(전체의 12%, 1.5~4초), 마무리는 12%(1.5~5초),
// 본론은 남은 시간을 고르게. 장면마다 `weight` 를 두면 사용자가 만진 길이 비율을 지킨다.
function distributeScenes(scenes, duration) {
  const total = Math.max(4, Number(duration) || 20);
  const list = scenes.map((scene) => ({ ...scene }));
  if (!list.length) return list;
  const hooks = list.filter((scene) => scene.role === 'hook').length;
  const closers = list.filter((scene) => scene.role === 'closer').length;
  const hookShare = hooks ? clamp(total * 0.12, 1.5, 4) : 0;
  const closerShare = closers ? clamp(total * 0.12, 1.5, 5) : 0;
  const bodyTotal = Math.max(0, total - hookShare - closerShare);
  const weightOf = (scene) => (Number(scene.weight) > 0 ? Number(scene.weight) : 1);
  const weightSum = list.filter((scene) => scene.role === 'body').reduce((sum, scene) => sum + weightOf(scene), 0) || 1;
  let cursor = 0;
  list.forEach((scene, index) => {
    let length;
    if (scene.role === 'hook') length = hookShare / hooks;
    else if (scene.role === 'closer') length = closerShare / closers;
    else length = bodyTotal * (weightOf(scene) / weightSum);
    scene.index = index + 1;
    scene.start = Number(cursor.toFixed(1));
    cursor = index === list.length - 1 ? total : cursor + length;
    scene.end = Number(cursor.toFixed(1));
  });
  return list;
}

function captionPool(topic, hookKey, structure, tone, variant = 0) {
  const seed = `${topic}-${variant}`;
  const hookPool = HOOK_TEMPLATES[hookKey] || HOOK_TEMPLATES.howto;
  const hook = toneAdjust(hookPool[seededIndex(seed, hookPool.length)](topic), tone);
  const body = (BODY_TEMPLATES[structure] || BODY_TEMPLATES['훅 → 근거 3개 → 마무리'])(topic)
    .map((line) => toneAdjust(line, tone));
  const closer = toneAdjust(CLOSERS[seededIndex(`${seed}-closer`, CLOSERS.length)], tone);
  return { hook, body, closer, seed };
}

// 장면 수에 맞춰 역할과 문장을 채운다. 본론 문장보다 장면이 많으면 「자막 없이 화면만」
// 장면을 끼우고, 적으면 앞 문장부터 쓴다.
function buildScenes(topic, count, hookKey, structure, tone, variant = 0) {
  const pool = captionPool(topic, hookKey, structure, tone, variant);
  const total = clamp(Math.round(count) || 4, 2, 14);
  const scenes = [{ role: 'hook', caption: pool.hook, weight: 1, silent: false }];
  const bodyCount = Math.max(0, total - 2);
  for (let index = 0; index < bodyCount; index += 1) {
    const line = pool.body[index];
    scenes.push({ role: 'body', caption: line || '', weight: 1, silent: !line });
  }
  scenes.push({ role: 'closer', caption: pool.closer, weight: 1, silent: false });
  const visualOffset = seededIndex(pool.seed, VISUAL_MOVES.length);
  return scenes.map((scene, index) => ({
    ...scene,
    visual: scene.silent ? '작업 과정 빠른 배속' : VISUAL_MOVES[(visualOffset + index) % VISUAL_MOVES.length],
    transition: index === scenes.length - 1 ? '정지' : TRANSITIONS[(index + visualOffset) % TRANSITIONS.length],
    emphasis: scene.role === 'hook' ? '가장 큰 자막 · 화면 상단'
      : scene.role === 'closer' ? '행동 유도 문구 · 화면 하단'
        : scene.silent ? '자막 없이 화면만' : '핵심 단어만 강조'
  }));
}

function blueprintOptions() {
  return {
    hooks: HOOK_TYPES.map((type) => ({ key: type.key, label: type.label, guide: type.guide })),
    tones: TONE_OPTIONS,
    structures: STRUCTURE_OPTIONS,
    transitions: TRANSITION_OPTIONS,
    visuals: VISUAL_MOVES,
    roles: SCENE_ROLES
  };
}

// 고른 레퍼런스에서 설계도를 만든다. 1편이면 그 영상의 뼈대, 여러 편이면 공통 뼈대.
function blueprintFrom(items, keyword = '', options = {}) {
  const usable = (items || []).filter((item) => item && item.dataQuality !== 'link-only');
  if (!usable.length) return null;
  const topic = String(keyword || '').trim() || '이 주제';
  const variant = Number(options.variant) || 0;

  let base;
  let sources;
  let mode;
  if (usable.length === 1) {
    const analysis = analyzeItem(usable[0]);
    const seconds = Number.isFinite(usable[0].durationSeconds) ? usable[0].durationSeconds : 28;
    mode = 'single';
    sources = [referenceSummary(usable[0], analysis)];
    base = {
      duration: clamp(Math.round(seconds), 6, 120),
      hookKey: analysis.hookType,
      tone: analysis.toneLabel,
      structure: analysis.structure,
      sceneCount: clamp(analysis.estimatedCuts || 4, 3, 10),
      cutTempo: analysis.cutTempo || 2.4,
      hashtags: (usable[0].hashtags || []).slice(0, 5)
    };
  } else {
    const collection = analyzeCollection(usable, topic);
    mode = 'group';
    sources = usable.map((item) => referenceSummary(item, collection.analyses.find((entry) => entry.id === item.id) || analyzeItem(item)));
    base = {
      duration: collection.recommendedDuration,
      hookKey: collection.dominantHookKey,
      tone: collection.dominantTone,
      structure: collection.dominantStructure,
      sceneCount: clamp(collection.recommendedCuts, 3, 10),
      cutTempo: collection.cutTempo,
      hashtags: collection.hashtags.slice(0, 5).map((entry) => entry.tag)
    };
  }
  if (!TONE_OPTIONS.includes(base.tone)) base.tone = '중립 서술체';
  if (!BODY_TEMPLATES[base.structure]) base.structure = STRUCTURE_OPTIONS[0];

  const scenes = distributeScenes(buildScenes(topic, base.sceneCount, base.hookKey, base.structure, base.tone, variant), base.duration);
  const seed = `${topic}-bp-${variant}`;
  return {
    id: `blueprint-${seededIndex(`${seed}-${sources.map((entry) => entry.id).join(',')}`, 999999)}`,
    mode,
    keyword: topic,
    sources,
    duration: base.duration,
    hookKey: base.hookKey,
    hookLabel: (HOOK_TYPES.find((type) => type.key === base.hookKey) || HOOK_TYPES[0]).label,
    tone: base.tone,
    structure: base.structure,
    cutTempo: base.cutTempo,
    variant,
    hashtags: [...new Set([topic.replace(/\s+/g, ''), ...base.hashtags])].filter(Boolean).slice(0, 6),
    palette: PALETTES[seededIndex(seed, PALETTES.length)],
    musicMood: ['담백한 로파이', '경쾌한 팝', '미니멀 전자음', '따뜻한 어쿠스틱'][seededIndex(`${seed}-music`, 4)],
    scenes,
    note: mode === 'single'
      ? `「${sources[0].title}」의 길이·훅 유형·컷 수·문체만 가져왔습니다. 문장과 화면은 새로 지었습니다.`
      : `${sources.length}편에서 가장 많이 쓰인 길이·훅·구조·문체를 합쳤습니다. 문장과 화면은 새로 지었습니다.`
  };
}

// 사용자가 설계도를 고친 뒤 부르는 갱신. change 에 따라 손댈 범위를 좁힌다.
//   duration      길이만 바뀜 -> 장면 시간만 다시 배분(문장·순서 유지)
//   count         장면 수 바뀜 -> 장면을 늘리거나 줄이되 있던 문장은 지킨다
//   rewrite       훅/문체/구조 바뀜 또는 「문장 새로 짓기」 -> 문장·화면·전환 재생성(장면 수·시간 유지)
//   redistribute  순서·역할을 손으로 바꾼 뒤 시간만 다시 고르게
function updateBlueprint(blueprint, change = 'redistribute', options = {}) {
  if (!blueprint) return null;
  const next = { ...blueprint, scenes: (blueprint.scenes || []).map((scene) => ({ ...scene })) };
  next.duration = clamp(Math.round(Number(next.duration) || 20), 4, 180);
  if (!TONE_OPTIONS.includes(next.tone)) next.tone = '중립 서술체';
  if (!BODY_TEMPLATES[next.structure]) next.structure = STRUCTURE_OPTIONS[0];
  if (!HOOK_TEMPLATES[next.hookKey]) next.hookKey = 'howto';
  next.hookLabel = (HOOK_TYPES.find((type) => type.key === next.hookKey) || HOOK_TYPES[0]).label;

  if (change === 'count') {
    const target = clamp(Math.round(Number(options.count) || next.scenes.length), 2, 14);
    const fresh = buildScenes(next.keyword, target, next.hookKey, next.structure, next.tone, next.variant || 0);
    const keptBody = next.scenes.filter((scene) => scene.role === 'body');
    const hook = next.scenes.find((scene) => scene.role === 'hook') || fresh[0];
    const closer = [...next.scenes].reverse().find((scene) => scene.role === 'closer') || fresh.at(-1);
    const body = fresh.filter((scene) => scene.role === 'body').map((scene, index) => (keptBody[index] ? { ...keptBody[index] } : scene));
    next.scenes = [hook, ...body, closer];
  } else if (change === 'rewrite') {
    next.variant = Number.isFinite(options.variant) ? options.variant : (next.variant || 0) + 1;
    const fresh = buildScenes(next.keyword, next.scenes.length, next.hookKey, next.structure, next.tone, next.variant);
    next.scenes = fresh.map((scene, index) => ({ ...scene, weight: next.scenes[index]?.weight || 1 }));
  }
  next.scenes = distributeScenes(next.scenes, next.duration);
  next.cutTempo = Number((next.duration / Math.max(1, next.scenes.length)).toFixed(1));
  return next;
}

// 설계도를 편집 앱이 받는 콘셉트 형태로 바꾼다(buildConcept 결과와 같은 모양).
function conceptFromBlueprint(blueprint) {
  if (!blueprint) return null;
  const scenes = (blueprint.scenes || []).map((scene, index, list) => ({
    index: index + 1,
    start: Number(scene.start) || 0,
    end: Number(scene.end) || 0,
    caption: String(scene.caption || ''),
    visual: String(scene.visual || ''),
    transition: scene.transition || (index === list.length - 1 ? '정지' : '컷 전환'),
    emphasis: scene.emphasis || '',
    role: scene.role
  }));
  const script = scenes.map((scene) => scene.caption).filter(Boolean);
  const hook = scenes.find((scene) => scene.role === 'hook')?.caption || script[0] || blueprint.keyword;
  const sourceNames = blueprint.sources.map((entry) => entry.title).slice(0, 3).join(', ');
  return {
    id: `concept-${blueprint.id}`,
    title: `${blueprint.keyword} 숏폼 초안`,
    category: blueprint.mode === 'single' ? '레퍼런스 1편 구조' : `레퍼런스 ${blueprint.sources.length}편 구조`,
    hook,
    script,
    scenes,
    duration: blueprint.duration,
    cutTempo: blueprint.cutTempo,
    recommendedCuts: scenes.length,
    tone: blueprint.tone,
    structure: blueprint.structure,
    hashtags: blueprint.hashtags || [],
    palette: blueprint.palette || PALETTES[0],
    visualKeywords: [blueprint.keyword, ...scenes.map((scene) => scene.visual).filter(Boolean).slice(0, 2)],
    musicMood: blueprint.musicMood || '담백한 로파이',
    insight: `${blueprint.hookLabel} 훅 · ‘${blueprint.structure}’ 구조 · ${blueprint.duration}초 · 장면 ${scenes.length}개. 참고: ${sourceNames}`,
    basedOn: {
      sampleSize: blueprint.sources.length,
      medianDuration: median(blueprint.sources.map((entry) => entry.durationSeconds)),
      medianEngagement: median(blueprint.sources.map((entry) => entry.engagementRate), 2),
      references: blueprint.sources.map((entry) => ({ title: entry.title, url: entry.url, platformLabel: entry.platformLabel }))
    },
    originality: '레퍼런스에서 가져온 것은 길이·훅 유형·장면 수·구조·문체뿐입니다. 문장, 화면 구성, 자막은 새로 만들었습니다.'
  };
}

module.exports = {
  analyzeItem, analyzeCollection, buildConcept,
  blueprintFrom, updateBlueprint, conceptFromBlueprint, blueprintOptions,
  HOOK_TYPES, DURATION_BUCKETS
};

