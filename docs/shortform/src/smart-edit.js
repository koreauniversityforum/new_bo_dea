/* 장면의 의미를 소재 검색과 전환 선택에 연결하는 순수 함수 모음. */
(function expose(factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SmartEdit = api;
})(function buildSmartEdit() {
  const STOP_WORDS = new Set([
    '그리고', '하지만', '그래서', '이것', '저것', '여기', '화면', '장면', '영상', '사진',
    '보여', '드립니다', '합니다', '입니다', '하세요', 'the', 'and', 'with', 'from', 'this', 'that'
  ]);
  const VISUAL_HINTS = [
    [/클로즈업|가까이|디테일/, 'close up detail'], [/손|과정|만들|작업/, 'hands process making'],
    [/전후|비교|차이/, 'before after comparison'], [/도시|서울|거리/, 'city street'],
    [/음식|요리|레시피/, 'food cooking'], [/결과|완성/, 'finished result'],
    [/사람|얼굴|말하/, 'person portrait talking'], [/제품|상품/, 'product showcase'],
    [/자연|풍경/, 'nature landscape']
  ];

  function tokens(value) {
    return [...new Set(String(value || '').toLowerCase()
      .replace(/[#()[\]{}.,!?·:;"']/g, ' ').split(/\s+/)
      .map((word) => word.replace(/은$|는$|이$|가$|을$|를$|에$|로$|와$|과$|도$|만$/u, ''))
      .filter((word) => word.length >= 2 && !STOP_WORDS.has(word)))];
  }

  function sceneBrief(concept, scene, index = 0) {
    const topic = tokens([concept?.title, ...(concept?.visualKeywords || [])].join(' ')).slice(0, 3);
    const words = tokens(`${scene?.caption || ''} ${scene?.visual || ''}`).slice(0, 5);
    const hints = VISUAL_HINTS.filter(([pattern]) => pattern.test(`${scene?.caption || ''} ${scene?.visual || ''}`))
      .flatMap(([, phrase]) => phrase.split(' ')).slice(0, 4);
    const query = [...new Set([...topic, ...words, ...hints])].slice(0, 8).join(' ');
    return {
      index, label: `${index + 1}. ${String(scene?.caption || concept?.hook || '장면').slice(0, 28)}`,
      query: query || String(concept?.title || concept?.hook || 'vertical story'),
      caption: scene?.caption || '', visual: scene?.visual || '',
      start: Number(scene?.start) || 0,
      end: Number(scene?.end) || Math.max(3, (Number(scene?.start) || 0) + 3)
    };
  }

  function sceneBriefs(concept) {
    const scenes = concept?.scenes?.length ? concept.scenes : [{ start: 0, end: concept?.duration || 5, caption: concept?.hook || '' }];
    return scenes.map((scene, index) => sceneBrief(concept, scene, index));
  }

  function scoreMedia(item, context = {}) {
    const wanted = tokens(`${context.query || ''} ${context.caption || ''} ${context.visual || ''}`);
    const offered = new Set(tokens(`${item.title || ''} ${(item.tags || []).join(' ')} ${item.creator || ''}`));
    const matches = wanted.filter((word) => offered.has(word) || [...offered].some((entry) => entry.includes(word) || word.includes(entry)));
    let score = 34 + Math.min(30, matches.length * 8);
    const ratio = item.width && item.height ? item.height / item.width : 0;
    if (ratio >= 1.55) score += 18; else if (ratio >= 1) score += 9; else if (ratio > 0) score -= 8;
    if ((item.height || 0) >= 1280) score += 8;
    if (item.kind === 'video' && item.durationSeconds >= 3 && item.durationSeconds <= 30) score += 6;
    if (item.commercialUse) score += 4;
    if (!item.attributionRequired) score += 2;
    score = Math.max(1, Math.min(99, Math.round(score)));
    const reasons = [];
    if (matches.length) reasons.push(`키워드 ${matches.slice(0, 2).join('·')} 일치`);
    if (ratio >= 1.55) reasons.push('세로 화면 적합');
    if ((item.height || 0) >= 1280) reasons.push('고해상도');
    if (!reasons.length) reasons.push('사용 조건·형식 기준');
    return { score, reasons };
  }

  function rankMedia(items, context = {}) {
    return items.map((item) => ({ ...item, relevance: scoreMedia(item, context) }))
      .sort((a, b) => b.relevance.score - a.relevance.score);
  }

  function recommendTransition(scene, index, total, tempo = 2.4) {
    const text = `${scene?.caption || ''} ${scene?.visual || ''}`;
    let type = 'fade';
    if (index === 0) type = 'cut';
    else if (/비교|전후|반면|바꾸|전환/.test(text)) type = 'wipe';
    else if (/결과|핵심|강조|놀|중요/.test(text)) type = 'zoom';
    else if (/과정|순서|다음|이동/.test(text)) type = 'slide';
    else if (/감성|따뜻|추억|시간/.test(text)) type = 'fade';
    else if (index === total - 1) type = 'fade';
    const duration = type === 'cut' ? 0 : Math.max(0.18, Math.min(0.65, Number(tempo || 2.4) * 0.16));
    return { type, duration: Math.round(duration * 100) / 100 };
  }
  return { tokens, sceneBrief, sceneBriefs, scoreMedia, rankMedia, recommendTransition };
});
