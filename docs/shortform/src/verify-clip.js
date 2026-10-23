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

console.log(`verify-clip: 통과 (후보 ${moments.length}개, 1등 ${moments[0].start}~${moments[0].end}초)`);
