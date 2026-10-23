// 긴 영상 -> 쇼츠 엔진. 계산만 하고 파일·프로세스는 만지지 않는다(main.js 와 시험이 같이 쓴다).
//
//   pickMoments(transcript)          받아쓰기에서 15~60초 쇼츠 후보 구간을 점수 순으로
//   layoutFromFaces(window, w, h)    얼굴 표본으로 세로 자르기 방식(track/split/fit)을 정한다
//   videoFilter(layout, w, h)        그 방식대로 1080x1920 을 만드는 ffmpeg 필터
//   buildAss(moment, options)        단어 단위로 켜지는 자막 + 첫 몇 초 훅 문구(ASS)
//
// OpenShorts(mutonby/openshorts, MIT)의 흐름을 참고했다. 구간 고르기는 LLM 대신 규칙으로 한다.

const STOPWORDS = new Set(['그리고', '그래서', '그러면', '그런데', '하지만', '이제', '진짜', '정말', '약간', '그냥', '이렇게', '저렇게',
  '그렇게', '이거', '저거', '그거', '여기', '저기', '거기', '우리', '저희', '제가', '내가', '너무', '이런', '그런', '저런', '있는', '없는',
  '하는', '했는데', '합니다', '있습니다', '같은', '같아요', '거예요', '거죠', '이게', '그게', '뭔가', '어떤', '되게', '아니라', '때문에']);
const JOSA = /(에서는|에서도|으로는|이라는|라는|에게|에서|으로|까지|부터|처럼|보다|하고|이랑|랑|은|는|이|가|을|를|에|의|도|로|와|과|만|요)$/;
const HOOK_CUES = ['왜', '비밀', '사실', '처음', '절대', '실수', '방법', '이유', '핵심', '중요', '놀라', '충격', '몰랐', '진짜로', '결국', '문제', '꼭', '최고', '최악', '반전'];
const SENTENCE_END = /([.?!…]|[다요죠까네])["')\]]*$/;

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function even(value) { return Math.max(2, Math.round(value / 2) * 2); }

function tokens(text) {
  return String(text || '').split(/\s+/)
    .map((word) => word.replace(/[^0-9A-Za-z가-힣]/g, '').replace(JOSA, ''))
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

function isQuestion(text) { return /\?\s*$/.test(text) || /(까|나요|죠|을까요|ㄹ까)\??\s*$/.test(String(text).trim()); }

// 훅 문구: 구간 안에서 질문·단서 낱말이 든 문장을 먼저, 없으면 첫 문장. 화면에 두 줄로 들어가게 줄인다.
function hookFrom(segments, limit = 32) {
  const scored = segments.slice(0, 4).map((segment, index) => {
    const text = segment.text.trim();
    let score = -index;
    if (isQuestion(text)) score += 4;
    score += HOOK_CUES.filter((cue) => text.includes(cue)).length * 2;
    if (/\d/.test(text)) score += 1;
    return { text, score };
  }).sort((a, b) => b.score - a.score);
  const text = (scored[0]?.text || '').replace(/^(그리고|그래서|근데|그런데|자|아|음|어)\s+/, '');
  if (text.length <= limit) return text;
  const words = text.split(/\s+/);
  let out = '';
  for (const word of words) {
    if ((out + ' ' + word).trim().length > limit) break;
    out = (out + ' ' + word).trim();
  }
  // 문장 중간에서 끊었으면 끊긴 것을 보이게 한다(사용자가 화면에서 고쳐 쓰도록).
  return `${out || text.slice(0, limit)}…`;
}

function pickMoments(transcript, options = {}) {
  const minLength = options.min ?? 15;
  const maxLength = options.max ?? 60;
  const target = options.target ?? 35;
  const count = options.count ?? 6;
  const segments = (transcript?.segments || []).filter((segment) => segment.text && segment.end > segment.start);
  if (!segments.length) return [];

  // 영상 전체에서 자주 나온 낱말 = 이 영상의 주제어. 구간 안에 많이 나올수록 알맹이가 있다고 본다.
  const frequency = new Map();
  segments.forEach((segment) => tokens(segment.text).forEach((word) => frequency.set(word, (frequency.get(word) || 0) + 1)));
  const topics = new Set([...frequency.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word]) => word));
  const rates = segments.map((segment) => (segment.words?.length || tokens(segment.text).length) / Math.max(0.5, segment.end - segment.start));
  const baseRate = median(rates) || 2;

  const candidates = [];
  for (let first = 0; first < segments.length; first += 1) {
    let silence = 0;
    for (let last = first; last < segments.length; last += 1) {
      if (last > first) silence += Math.max(0, segments[last].start - segments[last - 1].end - 1.2);
      const start = segments[first].start;
      const end = segments[last].end;
      const length = end - start;
      if (length > maxLength) break;
      if (length < minLength) continue;
      const inside = segments.slice(first, last + 1);
      const text = inside.map((segment) => segment.text).join(' ');
      const words = inside.reduce((sum, segment) => sum + (segment.words?.length || tokens(segment.text).length), 0);
      const reasons = [];
      let score = 0;
      const rate = words / length;
      score += clamp((rate / baseRate - 0.8) * 2.5, -1.5, 1.5);
      if (rate > baseRate * 1.1) reasons.push('말이 빽빽함');
      const opening = segments[first].text;
      if (isQuestion(opening)) { score += 2; reasons.push('질문으로 시작'); }
      const cues = HOOK_CUES.filter((cue) => opening.includes(cue));
      if (cues.length) { score += Math.min(2, cues.length); reasons.push(`첫 문장 단서어 「${cues.slice(0, 2).join('·')}」`); }
      if (/\d/.test(opening)) { score += 0.6; reasons.push('숫자로 시작'); }
      const topicHits = tokens(text).filter((word) => topics.has(word)).length;
      score += Math.min(2.5, topicHits * 0.25);
      if (topicHits >= 4) reasons.push(`주제어 ${topicHits}회`);
      if (SENTENCE_END.test(segments[last].text.trim())) { score += 0.8; reasons.push('문장이 끝나는 자리에서 끝남'); }
      else score -= 0.8;
      if (/^(그리고|그래서|근데|그런데|또|그러니까)/.test(opening.trim())) score -= 1;
      score -= silence * 0.6;
      if (silence > 2) reasons.push(`빈 구간 ${silence.toFixed(0)}초`);
      score -= Math.abs(length - target) / target;
      candidates.push({ first, last, start, end, length, score, reasons });
    }
  }

  // 겹치지 않게 점수 높은 순으로 뽑는다.
  const chosen = [];
  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    if (chosen.some((other) => candidate.start < other.end && other.start < candidate.end)) continue;
    chosen.push(candidate);
  }
  const best = chosen[0]?.score ?? 0;
  const worst = chosen.at(-1)?.score ?? 0;
  return chosen.map((candidate, index) => {
    const inside = segments.slice(candidate.first, candidate.last + 1);
    return {
      id: `m${index + 1}`,
      start: round(candidate.start),
      end: round(candidate.end),
      length: round(candidate.length),
      score: best === worst ? 100 : Math.round(60 + 40 * (candidate.score - worst) / (best - worst)),
      reasons: candidate.reasons,
      hook: hookFrom(inside),
      text: inside.map((segment) => segment.text).join(' '),
      words: inside.flatMap((segment) => segment.words || []),
      // 화면의 「자막 고치기」가 문장 단위로 고친다(editSegment).
      segments: inside.map((segment) => ({ start: segment.start, end: segment.end, text: segment.text, words: segment.words || [] }))
    };
  });
}

function round(value) { return Math.round(value * 100) / 100; }

// 얼굴 표본(clip_helper.py faces 한 구간) -> 자르기 방식.
//   track : 한 사람. 얼굴을 따라가는 9:16 창(카메라처럼 크게 안 움직이면 가만히 있는다)
//   split : 두 사람이 계속 같이 나옴. 왼쪽 사람 위, 오른쪽 사람 아래로 쌓는다
//   fit   : 얼굴이 거의 없거나 이미 세로 영상. 자르지 않고 검은 여백 안에 맞춘다
function layoutFromFaces(windowData, width, height, force) {
  const samples = (windowData?.samples || []).map((sample) => ({
    t: sample.t,
    // 폭 2.5% 미만은 버린다. 넓게 찍은 화면의 사람 얼굴이 3% 안팎이라(실측 0.031) 3.5% 로 두면 다 놓친다.
    faces: (sample.faces || []).filter((face) => face.score >= 0.6 && face.w >= 0.025).sort((a, b) => b.w * b.h - a.w * a.h)
  }));
  const vertical = height / Math.max(1, width) >= 1.5;
  const total = Math.max(1, samples.length);
  const two = samples.filter((sample) => sample.faces.length >= 2).length / total;
  const any = samples.filter((sample) => sample.faces.length >= 1).length / total;
  const cropWidth = even(height * 9 / 16);

  // 두 사람이 9:16 한 화면에 같이 들어갈 만큼 붙어 있으면 나누지 않는다.
  // 나누면 위 칸·아래 칸에 같은 두 사람이 겹쳐 나온다(실측).
  const pairs = samples.filter((sample) => sample.faces.length >= 2).map((sample) => sample.faces.slice(0, 2).sort((a, b) => a.x - b.x));
  const pairSpan = pairs.length ? median(pairs.map(([a, b]) => b.x + b.w - a.x)) * width : Infinity;
  const together = pairSpan <= cropWidth * 0.85;

  let mode = vertical ? 'fit' : two >= 0.5 ? (together ? 'track' : 'split') : any >= 0.4 ? 'track' : 'fit';
  let reason = vertical ? '이미 세로 영상'
    : two >= 0.5 ? (together ? '두 사람이 붙어 있어 한 화면에 담음' : `두 사람이 ${Math.round(two * 100)}% 표본에 떨어져 나옴`)
      : any >= 0.4 ? `한 사람 얼굴이 ${Math.round(any * 100)}% 표본에 보임` : '얼굴이 거의 안 보임';
  if (force && force !== 'auto') { mode = force; reason = '직접 고름'; }
  if ((mode === 'track' || mode === 'split') && cropWidth > width) { mode = 'fit'; reason += ' · 원본 폭이 좁아 맞춤'; }
  const layout = { mode, reason, faceRate: round(any), twoRate: round(two) };

  if (mode === 'track') {
    // 큰 얼굴 중심(붙어 선 두 사람이면 둘의 가운데)을 따라가되 비어 있는 표본은 앞 값을 잡고, 작은 흔들림은 무시한다.
    // 장면이 바뀌는 자리(cuts, clip_helper 가 ffmpeg scene 값으로 찾음)에서는 천천히 따라가지 않고 그 자리에서 옮긴다.
    // 천천히 따라가면 장면이 바뀐 뒤 화면이 미끄러지듯 옮겨 가는 것이 보인다(실측).
    const cuts = (windowData?.cuts || []).filter((t) => t > 0.2).sort((a, b) => a - b);
    const shotOf = (t) => cuts.filter((cut) => cut <= t).length;
    const toX = (center) => Math.round(clamp(center * width - cropWidth / 2, 0, width - cropWidth));
    const centerOf = (sample) => {
      const [first, second] = sample.faces;
      if (first && second && together) return (Math.min(first.x, second.x) + Math.max(first.x + first.w, second.x + second.w)) / 2;
      return first ? first.x + first.w / 2 : null;
    };
    const deadZone = (cropWidth / width) * 0.12;
    const gap = (samples[1]?.t ?? 0.5) - (samples[0]?.t ?? 0) || 0.5;
    const step = Math.max(1, Math.round(1 / gap));
    const points = [];
    const shots = [...new Set(samples.map((sample) => shotOf(sample.t)))];
    shots.forEach((shot) => {
      const inShot = samples.filter((sample) => shotOf(sample.t) === shot);
      const raw = inShot.map(centerOf);
      const firstSeen = raw.find((value) => value !== null) ?? 0.5;
      let held = firstSeen;
      let camera = firstSeen;
      const steady = raw.map((value) => {
        if (value !== null) held = value;
        if (Math.abs(held - camera) > deadZone) camera += (held - camera) * 0.45;
        return camera;
      });
      const shotStart = shot === 0 ? 0 : cuts[shot - 1];
      if (shot > 0 && points.length) {
        // 바로 앞 프레임까지는 앞 장면 자리, 장면이 바뀌는 순간 새 자리로(0.04초 = 한 프레임 남짓).
        points.push({ t: round(Math.max(points.at(-1).t + 0.01, shotStart - 0.04)), x: points.at(-1).x });
        points.push({ t: round(shotStart), x: toX(steady[0]) });
      }
      // 표본은 초당 2장. 1초 간격 점만 남겨 식을 짧게 한다(장면의 마지막 표본은 꼭 넣는다).
      steady.forEach((center, index) => {
        if (index % step !== 0 && index !== steady.length - 1) return;
        const t = round(inShot[index].t);
        if (points.length && t <= points.at(-1).t) return;
        points.push({ t, x: toX(center) });
      });
    });
    layout.track = points.length ? points : [{ t: 0, x: Math.round((width - cropWidth) / 2) }];
    layout.cuts = cuts;
  }

  if (mode === 'split') {
    const person = (side) => ({
      cx: median(pairs.map((pair) => pair[side].x + pair[side].w / 2)) || (side ? 0.72 : 0.28),
      cy: median(pairs.map((pair) => pair[side].y + pair[side].h / 2)) || 0.4,
      h: median(pairs.map((pair) => pair[side].h)) || 0.25
    });
    layout.split = { top: person(0), bottom: person(1) };
  }
  return layout;
}

// 1080x960 칸에 한 사람을 담는 crop. 얼굴이 칸 위쪽 가운데에 오도록 아래로 조금 내린다.
function splitCrop(person, width, height) {
  let cropHeight = clamp(person.h * height * 3.2, height * 0.45, height);
  let cropWidth = cropHeight * 9 / 8;
  if (cropWidth > width) { cropWidth = width; cropHeight = width * 8 / 9; }
  cropWidth = even(cropWidth);
  cropHeight = even(cropHeight);
  const x = Math.round(clamp(person.cx * width - cropWidth / 2, 0, width - cropWidth));
  const y = Math.round(clamp(person.cy * height - cropHeight * 0.38, 0, height - cropHeight));
  return `crop=${cropWidth}:${cropHeight}:${x}:${y},scale=1080:960`;
}

// 시간에 따라 움직이는 crop x. crop 의 폭·높이는 못 바꾸지만 x·y 식은 프레임마다 다시 계산된다.
function trackExpression(track) {
  if (track.length === 1) return String(track[0].x);
  let expression = String(track.at(-1).x);
  for (let index = track.length - 2; index >= 0; index -= 1) {
    const a = track[index];
    const b = track[index + 1];
    const span = Math.max(0.01, b.t - a.t).toFixed(2);
    expression = `if(lt(t,${b.t.toFixed(2)}),${a.x}+(${b.x - a.x})*(t-${a.t.toFixed(2)})/${span},${expression})`;
  }
  return expression;
}

// input: 원본 그대로면 [0:v], 군말·침묵을 뺀 뒤면 이어 붙인 [cat] 을 받는다.
function videoFilter(layout, width, height, input = '[0:v]') {
  if (layout.mode === 'track') {
    const cropWidth = even(height * 9 / 16);
    // 식 안의 쉼표가 필터 구분자로 읽히지 않게 작은따옴표로 감싼다.
    return `${input}crop=${cropWidth}:${even(height)}:x='${trackExpression(layout.track)}':y=0,scale=1080:1920,setsar=1[base]`;
  }
  if (layout.mode === 'split') {
    return `${input}split[ta][tb];[ta]${splitCrop(layout.split.top, width, height)}[top];[tb]${splitCrop(layout.split.bottom, width, height)}[bottom];[top][bottom]vstack,setsar=1[base]`;
  }
  return `${input}scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1[base]`;
}

// 남길 구간들을 잘라 이어 붙이는 필터. 결과 라벨 [cat](영상)·[acat](소리).
function concatFilter(intervals, withAudio) {
  const parts = intervals.map((item, index) => {
    const v = `[0:v]trim=start=${item.start.toFixed(3)}:end=${item.end.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`;
    const a = withAudio ? `;[0:a]atrim=start=${item.start.toFixed(3)}:end=${item.end.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]` : '';
    return v + a;
  });
  const labels = intervals.map((_, index) => `[v${index}]${withAudio ? `[a${index}]` : ''}`).join('');
  return `${parts.join(';')};${labels}concat=n=${intervals.length}:v=1:a=${withAudio ? 1 : 0}[cat]${withAudio ? '[acat]' : ''}`;
}

const FONT_FAMILY = {
  'Noto Sans KR Local': 'Noto Sans KR', 'Black Han Sans': 'Black Han Sans', 'Do Hyeon': 'Do Hyeon',
  Jua: 'Jua', 'Gowun Dodum': 'Gowun Dodum', 'Nanum Myeongjo': 'Nanum Myeongjo'
};

function assTime(seconds) {
  const value = Math.max(0, seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const secs = (value % 60).toFixed(2).padStart(5, '0');
  return `${hours}:${String(minutes).padStart(2, '0')}:${secs}`;
}
// 한 줄에 들어가는 글자 수. 한글 한 자 폭을 글자 크기의 0.95배로 보고 좌우 여백을 뺀 920px 에 맞춘다.
function charsPerLine(size) { return Math.max(6, Math.floor(920 / (size * 0.95))); }

// 훅 글자 크기: 짧으면 자막보다 크게, 20자를 넘으면 자막 크기로 줄여 세 줄 안에 들게 한다.
function hookSize(text, size) { return Math.round(String(text || '').length > 20 ? size : size * 1.15); }

// 띄어쓰기에서 줄을 나누되 줄 길이를 고르게 한다(첫 줄만 꽉 차고 둘째 줄이 한 낱말인 모양을 피함).
function wrapLines(text, maxChars) {
  if (text.length <= maxChars || text.includes('\n')) return text;
  const words = text.split(/\s+/).filter(Boolean);
  const count = Math.ceil(text.length / maxChars);
  const target = text.length / count;
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && (candidate.length > maxChars || (line.length >= target && lines.length < count - 1))) {
      lines.push(line);
      line = word;
    } else line = candidate;
  });
  if (line) lines.push(line);
  return lines.join('\n');
}
function assText(text) { return String(text).replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N'); }
function assColor(hex) {
  const value = String(hex || '#ffffff').replace('#', '').padEnd(6, 'f');
  return `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}`.toUpperCase();
}

// 단어를 화면 한 줄 분량(2~4단어, 14자 안팎)으로 묶는다. 말이 끊기거나 문장이 끝나면 새 줄.
function chunkWords(words, maxChars = 14, maxWords = 4) {
  const chunks = [];
  let current = [];
  words.forEach((word, index) => {
    const previous = words[index - 1];
    const text = current.map((item) => item.w).join(' ');
    const breakHere = current.length && (
      current.length >= maxWords || (text + ' ' + word.w).length > maxChars
      || (previous && word.s - previous.e > 0.6)
      // 문장 끝: 문장부호는 바로, 「~다·~요」로 끝난 낱말은 잠깐 쉬었을 때만(「바다」 같은 낱말에서 안 끊기게)
      || /[.?!…]$/.test(previous?.w || '') || (/[다요죠]$/.test(previous?.w || '') && word.s - previous.e > 0.25));
    if (breakHere) { chunks.push(current); current = []; }
    current.push(word);
  });
  if (current.length) chunks.push(current);
  return chunks;
}

function buildAss(moment, options = {}) {
  const family = FONT_FAMILY[options.font] || 'Noto Sans KR';
  const size = Math.round(options.size || 74);
  const color = assColor(options.color || '#ffffff');
  const active = assColor(options.activeColor || '#ffd400');
  const y = options.layoutMode === 'split' ? 960 : Math.round(1920 * (options.captionY ?? 0.68));
  const hookSeconds = options.hookSeconds ?? 3;
  const lines = [
    // WrapStyle 1 = 우리가 나눈 줄을 지키되, 그래도 화면을 넘으면 libass 가 한 번 더 접는다(안전망).
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 1', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // 자막 가독성은 화면을 어둡게 하지 않고 글자 테두리로만 확보한다.
    `Style: Word,${family},${size},${color},${color},&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,5,60,60,0,1`,
    `Style: Hook,${family},${hookSize(options.hook ?? moment.hook, size)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,9,3,5,70,70,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const hook = String(options.hook ?? moment.hook ?? '').trim();
  if (hook && hookSeconds > 0) {
    // 훅은 윗변을 기준으로 놓는다(\an8). 줄 수가 늘어도 화면 위로 넘치지 않는다.
    // 위아래 화면은 위 칸 얼굴이 y≈360 에 오므로 맨 위(110)에서 시작한다.
    const hookTop = options.layoutMode === 'split' ? 110 : 250;
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(hookSeconds)},Hook,,0,0,0,,{\\an8\\pos(540,${hookTop})\\fad(150,200)}${assText(wrapLines(hook, charsPerLine(hookSize(hook, size))))}`);
  }
  if (options.captions !== false) {
    const words = (moment.words || []).map((word) => ({ ...word, s: word.s - moment.start, e: word.e - moment.start }))
      .filter((word) => word.e > 0 && word.s < moment.end - moment.start);
    const chunks = chunkWords(words, charsPerLine(size));
    chunks.forEach((chunk, chunkIndex) => {
      const nextStart = chunks[chunkIndex + 1]?.[0]?.s;
      const chunkEnd = nextStart !== undefined && nextStart - chunk.at(-1).e < 0.4 ? nextStart : chunk.at(-1).e + 0.15;
      chunk.forEach((word, wordIndex) => {
        const from = wordIndex === 0 ? chunk[0].s : word.s;
        const to = chunk[wordIndex + 1]?.s ?? chunkEnd;
        if (to <= from) return;
        const text = chunk.map((item, index) => index === wordIndex ? `{\\c${active}}${assText(item.w)}{\\c${color}}` : assText(item.w)).join(' ');
        lines.push(`Dialogue: 0,${assTime(from)},${assTime(to)},Word,,0,0,0,,{\\pos(540,${y})}${text}`);
      });
    });
  }
  return lines.join('\n') + '\n';
}

// ── 자막 고치기 ─────────────────────────────────────────────────────────
// 받아쓰기가 틀린 문장(「쌌습니다→쌓습니다」 실측)을 사람이 고치면, 낱말 수가 같으면 시각을 그대로 쓰고
// 다르면 그 문장의 말한 구간(첫 낱말 시작~끝 낱말 끝)에 글자 수 비율로 다시 나눠 놓는다.
function editSegment(segment, text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const old = segment.words || [];
  if (!words.length) return { ...segment, text: '', words: [] };
  if (words.length === old.length) return { ...segment, text: words.join(' '), words: old.map((word, index) => ({ ...word, w: words[index] })) };
  const from = old[0]?.s ?? segment.start;
  const to = old.at(-1)?.e ?? segment.end;
  const total = words.reduce((sum, word) => sum + word.length, 0);
  let cursor = from;
  const placed = words.map((word) => {
    const span = (to - from) * word.length / total;
    const item = { w: word, s: round(cursor), e: round(cursor + span), p: 1 };
    cursor += span;
    return item;
  });
  return { ...segment, text: words.join(' '), words: placed };
}

// ── 군말·침묵 빼기 ──────────────────────────────────────────────────────
// 낱말 시각으로 남길 구간을 만든다. 「음·어·아」처럼 홀로 쓰인 군말은 빼고, 낱말 사이가 maxGap 보다
// 길면 앞뒤로 keepPad 만 남긴다. 결과는 구간 시작(moment.start) 기준 초.
const FILLERS = new Set(['음', '어', '아', '에', '흠', '음음', '어어', '그', '저', '뭐']);
function isFiller(word) { return FILLERS.has(String(word).replace(/[.,?!…~]/g, '')); }

function keepIntervals(moment, options = {}) {
  const maxGap = options.maxGap ?? 0.7;
  const pad = options.keepPad ?? 0.15;
  const length = moment.end - moment.start;
  const words = (moment.words || [])
    .map((word) => ({ ...word, s: word.s - moment.start, e: word.e - moment.start }))
    .filter((word) => word.e > 0 && word.s < length && !isFiller(word.w));
  if (!words.length) return [{ start: 0, end: round(length) }];
  const intervals = [];
  let current = { start: Math.max(0, words[0].s - pad), end: words[0].e + pad };
  for (const word of words.slice(1)) {
    if (word.s - current.end <= maxGap) current.end = word.e + pad;
    else { intervals.push(current); current = { start: word.s - pad, end: word.e + pad }; }
  }
  intervals.push(current);
  return intervals.map((item) => ({ start: round(Math.max(0, item.start)), end: round(Math.min(length, item.end)) }))
    .filter((item) => item.end - item.start > 0.1);
}

// 원래 시각 t(구간 기준) → 군말·침묵을 뺀 뒤의 시각. 잘린 자리 안이면 null.
function remapTime(t, intervals) {
  let offset = 0;
  for (const item of intervals) {
    if (t < item.start) return null;
    if (t <= item.end) return round(offset + t - item.start);
    offset += item.end - item.start;
  }
  return null;
}

// 구간 하나를 「뺀 뒤」 모양으로: 낱말 시각·추적 점·장면 바뀜을 새 시간축으로 옮긴다(시작=0, 끝=새 길이).
function tightenMoment(moment, layout, intervals) {
  const newLength = round(intervals.reduce((sum, item) => sum + item.end - item.start, 0));
  const words = (moment.words || []).map((word) => {
    if (isFiller(word.w)) return null;
    const s = remapTime(word.s - moment.start, intervals);
    const e = remapTime(Math.min(word.e - moment.start, moment.end - moment.start), intervals);
    return s === null || e === null ? null : { ...word, s, e };
  }).filter(Boolean);
  const next = { ...layout };
  if (layout?.track) {
    const points = layout.track.map((point) => ({ ...point, t: remapTime(point.t, intervals) })).filter((point) => point.t !== null);
    // 잘린 이음매마다 그 자리의 x 로 점을 하나씩 넣어 식이 비지 않게 한다.
    let offset = 0;
    intervals.forEach((item) => {
      const near = layout.track.reduce((best, point) => (Math.abs(point.t - item.start) < Math.abs(best.t - item.start) ? point : best), layout.track[0]);
      points.push({ t: round(offset), x: near.x });
      offset += item.end - item.start;
    });
    points.sort((a, b) => a.t - b.t);
    next.track = points.filter((point, index) => index === 0 || point.t > points[index - 1].t);
  }
  return { moment: { ...moment, start: 0, end: newLength, words }, layout: next, length: newLength };
}

// ── 게시 글 (OpenShorts 의 YouTube Studio 부분을 규칙으로) ─────────────────
// 제목 후보 3 · 설명 · 해시태그(인스타 한도 5개) · 원본 영상 챕터. 지어내지 않고 받아쓴 문장에서만 고른다.
const ADVERBS = new Set(['먼저', '계속', '다시', '바로', '크게', '많이', '가장', '아직', '솔직하게', '생각보다', '함께', '모두', '정말로', '이번', '오늘', '처음부터', '완벽하게', '여러분']);
// tokens() 가 끝의 「요」를 조사로 떼므로 「것이었어(요)·안녕하세(요)」 꼴도 여기서 걸러야 한다(실측).
const VERBAL_END = /(면|고|서|며|게|지|기|니|다|요|죠|네|는데|어서|아서|려고|면서|했|합|하는|된|되는|있|없|았|었|겠|던|든|어|아|세|냐|까|야)$/;
function nounish(word) { return word.length >= 2 && !ADVERBS.has(word) && !VERBAL_END.test(word); }

function postText(moment, transcript) {
  const sentences = (moment.segments || []).map((segment) => segment.text.trim()).filter(Boolean);
  const all = (transcript?.segments || []).map((segment) => segment.text).join(' ');
  const counts = new Map();
  tokens(all).forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  const inMoment = new Set(tokens(moment.text));
  // 해시태그는 명사 같은 낱말만: 「먼저·말씀드리면·발표하기」처럼 부사·활용형이 걸렸다(실측).
  // 영상 전체에서 두 번 이상 나온 것을 먼저, 모자라면 한 번 나온 것으로 채운다.
  const ranked = [...counts.entries()].filter(([word]) => inMoment.has(word) && nounish(word))
    .sort((a, b) => (b[1] >= 2) - (a[1] >= 2) || b[1] - a[1] || b[0].length - a[0].length);
  const tags = ranked.slice(0, 5).map(([word]) => `#${word}`);
  const titles = [...new Set([
    moment.hook,
    sentences.find((text) => isQuestion(text)),
    sentences.find((text) => HOOK_CUES.some((cue) => text.includes(cue))),
    sentences[0]
  ].filter(Boolean).map((text) => text.replace(/…$/, '')))].slice(0, 3);
  const description = sentences.slice(0, 3).join(' ');
  return { titles, description, tags };
}

// 원본 영상 챕터: 1.5초 넘게 쉬는 자리에서, 앞 챕터가 60초를 넘었을 때 나눈다. 제목은 그 챕터 첫 문장을 줄인 것.
function chapters(transcript, minLength = 60) {
  const segments = transcript?.segments || [];
  if (!segments.length) return [];
  const list = [{ start: 0, first: segments[0] }];
  segments.forEach((segment, index) => {
    const previous = segments[index - 1];
    if (!previous) return;
    if (segment.start - previous.end >= 1.5 && segment.start - list.at(-1).start >= minLength) list.push({ start: segment.start, first: segment });
  });
  const stamp = (seconds) => {
    const value = Math.floor(seconds);
    const hours = Math.floor(value / 3600);
    const rest = `${Math.floor(value % 3600 / 60)}:${String(value % 60).padStart(2, '0')}`;
    return hours ? `${hours}:${rest.padStart(5, '0')}` : rest;
  };
  return list.map((item) => ({ start: item.start, label: `${stamp(item.start)} ${hookFrom([item.first], 28).replace(/…$/, '')}` }));
}

module.exports = { editSegment, keepIntervals, remapTime, tightenMoment, postText, chapters, isFiller, concatFilter, pickMoments, layoutFromFaces, videoFilter, buildAss, chunkWords, trackExpression, hookFrom, tokens, wrapLines, charsPerLine };
