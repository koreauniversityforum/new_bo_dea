// 긴 영상 → 쇼츠 회귀 시험: 화면 id, 구간 고르기, 자르기 방식, 필터 식, 자막(ASS).
const fs = require('node:fs');
const path = require('node:path');
const { pickMoments, layoutFromFaces, videoFilter, buildAss, chunkWords, trackExpression } = require('./clip-engine');

function fail(message) { console.error(`verify-clip: ${message}`); process.exit(1); }

const script = fs.readFileSync(path.join(__dirname, 'clipper.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'clipper.html'), 'utf8');
const ids = [...new Set([...script.matchAll(/\$\('#([A-Za-z0-9_-]+)/g)].map((match) => match[1]))];
const missing = ids.filter((id) => !html.includes(`id="${id}"`));
if (missing.length) fail(`clipper.html에 없는 요소: ${missing.join(', ')}`);

// 가짜 받아쓰기: 3초마다 한 문장. 40초 지점에 질문으로 시작하는 알맹이 구간을 심는다.
const segments = [];
const filler = ['오늘 날씨가 좋네요', '그래서 저희가 왔어요', '음 그러니까 이렇게', '네 맞아요'];
for (let t = 0; t < 180; t += 3) {
  let text = filler[(t / 3) % filler.length];
  if (t === 42) text = '왜 대학생 투표율이 낮을까요?';
  if (t > 42 && t < 78) text = '대학생 투표율 문제는 등록금 정책과 연결됩니다';
  if (t === 78) text = '그래서 투표가 중요합니다.';
  const words = text.split(' ').map((w, index, all) => ({ w, s: t + index * (2.6 / all.length), e: t + (index + 1) * (2.6 / all.length), p: 0.9 }));
  segments.push({ start: t, end: t + 2.6, text, words });
}
const moments = pickMoments({ duration: 180, segments }, { min: 15, max: 60, target: 35, count: 4 });
if (!moments.length || moments.length > 4) fail(`후보 수 ${moments.length}`);
if (Math.abs(moments[0].start - 42) > 0.01) fail(`1등 후보가 질문 구간이 아님: ${moments[0].start}`);
if (!moments[0].reasons.includes('질문으로 시작')) fail('질문 이유가 빠짐');
if (moments.some((a, i) => moments.some((b, j) => i !== j && a.start < b.end && b.start < a.end))) fail('후보 구간이 겹침');
if (moments.some((m) => m.end - m.start < 15 || m.end - m.start > 60)) fail('길이 범위 밖 후보');
if (!moments[0].hook.startsWith('왜 대학생')) fail(`훅 문구: ${moments[0].hook}`);
if (pickMoments({ segments: [] }).length !== 0) fail('빈 받아쓰기에서 후보가 나옴');

// 자르기 방식
const sample = (faces) => faces.map((x, index) => ({ t: index * 0.5, faces: x }));
const one = { x: 0.6, y: 0.3, w: 0.1, h: 0.18, score: 0.9 };
const left = { x: 0.2, y: 0.3, w: 0.09, h: 0.16, score: 0.9 };
const right = { x: 0.7, y: 0.32, w: 0.09, h: 0.16, score: 0.9 };
const track = layoutFromFaces({ samples: sample(Array(20).fill([one])) }, 1920, 1080);
if (track.mode !== 'track' || !track.track.length) fail(`한 사람 → ${track.mode}`);
if (track.track.some((point) => point.x < 0 || point.x > 1920 - 608)) fail('추적 창이 화면 밖');
if (track.track.at(-1).t !== 9.5) fail(`마지막 표본 누락: ${track.track.at(-1).t}`);
const split = layoutFromFaces({ samples: sample(Array(20).fill([right, left])) }, 1920, 1080);
if (split.mode !== 'split' || split.split.top.cx > split.split.bottom.cx) fail('두 사람 → 위=왼쪽 사람이어야 함');
const close = layoutFromFaces({ samples: sample(Array(20).fill([{ ...left, x: 0.45 }, { ...right, x: 0.53 }])) }, 1920, 1080);
if (close.mode !== 'track' || !close.reason.includes('붙어')) fail(`붙어 선 두 사람 → ${close.mode}`);
const middle = (0.45 + 0.53 + 0.09) / 2 * 1920 - 304;
if (Math.abs(close.track[0].x - middle) > 2) fail(`붙어 선 두 사람의 가운데를 따라가지 않음: ${close.track[0].x} vs ${middle}`);
if (layoutFromFaces({ samples: sample(Array(20).fill([])) }, 1920, 1080).mode !== 'fit') fail('얼굴 없음 → fit');
if (layoutFromFaces({ samples: sample(Array(20).fill([one])) }, 1080, 1920).mode !== 'fit') fail('세로 영상 → fit');
if (layoutFromFaces({ samples: sample(Array(20).fill([one])) }, 1920, 1080, 'split').mode !== 'split') fail('직접 고른 방식 무시됨');

// 필터: 식은 작은따옴표 안, 쉼표 이스케이프 없음, 위아래는 vstack
const trackFilter = videoFilter(track, 1920, 1080);
if (!/x='[^']+'/.test(trackFilter) || trackFilter.includes('\\,')) fail(`추적 필터: ${trackFilter}`);
if (trackExpression([{ t: 0, x: 10 }, { t: 1, x: 30 }]) !== 'if(lt(t,1.00),10+(20)*(t-0.00)/1.00,30)') fail('추적 식 모양');
if (!videoFilter(split, 1920, 1080).includes('vstack')) fail('위아래 필터');
if (!videoFilter({ mode: 'fit' }, 1920, 1080).includes('pad=1080:1920')) fail('맞춤 필터');
if (/blur/.test(videoFilter({ mode: 'fit' }, 1920, 1080))) fail('맞춤에 흐림을 쓰면 안 됨(검은 여백)');

// 줄 나누기: 어느 줄도 한도를 넘지 않고, 줄 길이가 고르다
const { wrapLines, charsPerLine } = require('./clip-engine');
const long = '왜 대학생팀이 국제우주대회에서 발표하기가 어려울까요?';
const wrapped = wrapLines(long, charsPerLine(90)).split('\n');
if (wrapped.some((line) => line.length > charsPerLine(90) && line.includes(' '))) fail(`훅 줄이 너무 김: ${wrapped.join(' / ')}`);
if (Math.max(...wrapped.map((l) => l.length)) - Math.min(...wrapped.map((l) => l.length)) > 8) fail(`줄 길이가 고르지 않음: ${wrapped.join(' / ')}`);

// 자막: 단어 묶음, 지금 단어 색, 훅, 위아래 화면은 이음매 높이
const chunks = chunkWords([{ w: '가나다', s: 0, e: 0.3 }, { w: '라마', s: 0.3, e: 0.6 }, { w: '바사아자차카', s: 2, e: 2.4 }]);
if (chunks.length !== 2) fail(`말 끊김에서 줄이 안 나뉨: ${chunks.length}`);
const ass = buildAss(moments[0], { hook: '왜 대학생 투표율이 이렇게 낮을까?', layoutMode: 'track', activeColor: '#ffd400' });
if (!ass.includes('Style: Word') || !ass.includes('&H0000D4FF')) fail('지금 단어 색(BGR) 누락');
if (!/Hook,,0,0,0,,\{[^}]*\}왜 대학생 투표율이\\N이렇게 낮을까\?/.test(ass)) fail('훅 두 줄 나눔');
if (/Dialogue: 0,0:00:-/.test(ass)) fail('음수 시각');
if (!buildAss(moments[0], { layoutMode: 'split' }).includes('\\pos(540,960)')) fail('위아래 화면 자막이 이음매에 없음');
if (buildAss(moments[0], { captions: false, hookSeconds: 0 }).includes('Dialogue')) fail('자막·훅 끄기');

// 장면 바뀜: 바뀌는 자리에서 한 프레임 안에 옮긴다(천천히 미끄러지지 않음)
const leftFace = { x: 0.1, y: 0.3, w: 0.08, h: 0.15, score: 0.9 };
const rightFace = { x: 0.8, y: 0.3, w: 0.08, h: 0.15, score: 0.9 };
const cutLayout = layoutFromFaces({ samples: sample([...Array(10).fill([leftFace]), ...Array(10).fill([rightFace])]), cuts: [5] }, 1920, 1080);
const before = cutLayout.track.filter((p) => p.t < 5).at(-1);
const atCut = cutLayout.track.find((p) => p.t === 5);
if (!atCut || !before || 5 - before.t > 0.05 || atCut.x - before.x < 900) fail(`장면 바뀜에서 바로 안 옮김: ${JSON.stringify(cutLayout.track)}`);
const noCut = layoutFromFaces({ samples: sample([...Array(10).fill([leftFace]), ...Array(10).fill([rightFace])]) }, 1920, 1080);
if (noCut.track.find((p) => p.t === 5)?.x > atCut.x - 300) fail('장면 바뀜 없이도 똑같이 뛰면 시험이 무의미');

// 자막 고치기
const {
  editSegment, keepIntervals, remapTime, tightenMoment, postText, chapters, concatFilter
} = require('./clip-engine');
const seg = { start: 10, end: 12, text: '짐은 많이 쌓습니다', words: [{ w: '짐은', s: 10, e: 10.5 }, { w: '많이', s: 10.6, e: 11 }, { w: '쌓습니다', s: 11.1, e: 12 }] };
const same = editSegment(seg, '짐을 많이 쌌습니다');
if (same.words[2].w !== '쌌습니다' || same.words[2].s !== 11.1) fail('같은 낱말 수 고치기');
const more = editSegment(seg, '짐을 생각보다 많이 쌌습니다');
if (more.words.length !== 4 || more.words[0].s !== 10 || Math.abs(more.words.at(-1).e - 12) > 0.01) fail(`낱말 수가 달라진 고치기: ${JSON.stringify(more.words)}`);
if (more.words.some((w, i) => i && w.s < more.words[i - 1].e - 0.001)) fail('다시 나눈 낱말 시각이 겹침');

// 군말·침묵 빼기
const talk = { start: 100, end: 110, words: [
  { w: '안녕하세요', s: 100.2, e: 101 }, { w: '음', s: 101.1, e: 101.5 }, { w: '오늘은', s: 101.6, e: 102 },
  { w: '발표', s: 105, e: 105.5 }, { w: '합니다.', s: 105.6, e: 106.2 }] };
const keep = keepIntervals(talk);
if (keep.length !== 2) fail(`남길 구간 수: ${JSON.stringify(keep)}`);
if (remapTime(4, keep) !== null) fail('침묵 안 시각이 살아 있음');
if (remapTime(keep[1].start, keep) !== Math.round((keep[0].end - keep[0].start) * 100) / 100) fail('두 번째 구간 시작 시각 옮김');
const tight = tightenMoment(talk, { mode: 'track', track: [{ t: 0, x: 100 }, { t: 5, x: 300 }, { t: 9, x: 500 }] }, keep);
if (tight.moment.words.some((w) => w.w === '음')) fail('군말 「음」이 자막에 남음');
if (tight.length >= 9 || tight.moment.end !== tight.length) fail(`줄어든 길이: ${tight.length}`);
if (tight.layout.track.some((p, i) => i && p.t <= tight.layout.track[i - 1].t)) fail('옮긴 추적 점 시각이 거꾸로');
const cat = concatFilter(keep, true);
if (!cat.includes('concat=n=2:v=1:a=1[cat][acat]') || !cat.includes('atrim')) fail(`이어 붙이기 필터: ${cat}`);
if (!videoFilter({ mode: 'fit' }, 1920, 1080, '[cat]').startsWith('[cat]')) fail('이어 붙인 입력 라벨');

// 게시 글·챕터
const post = postText(moments[0], { segments });
if (!post.titles.length || post.tags.length > 5 || post.tags.some((tag) => !tag.startsWith('#'))) fail(`게시 글: ${JSON.stringify(post)}`);
const chaptersOut = chapters({ segments: [{ start: 0, end: 50, text: '처음 이야기' }, { start: 70, end: 100, text: '두 번째 이야기입니다' }, { start: 102, end: 130, text: '이어서' }, { start: 140, end: 150, text: '세 번째' }] });
// 102초는 앞 챕터(70초)에서 60초가 안 지나 안 나누고, 140초는 70초 지나고 10초 쉬어 나눈다.
if (chaptersOut[0].label !== '0:00 처음 이야기' || chaptersOut.length !== 3 || !chaptersOut[1].label.startsWith('1:10') || !chaptersOut[2].label.startsWith('2:20')) fail(`챕터: ${JSON.stringify(chaptersOut)}`);

console.log(`verify-clip: 통과 (후보 ${moments.length}개, 1등 ${moments[0].start}~${moments[0].end}초)`);
