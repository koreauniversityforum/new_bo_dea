const fs = require('node:fs');
const path = require('node:path');

const directory = __dirname;
const script = fs.readFileSync(path.join(directory, 'editor.js'), 'utf8');
const html = fs.readFileSync(path.join(directory, 'editor.html'), 'utf8');
const referencedIds = [...script.matchAll(/\$\('#([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
const missing = [...new Set(referencedIds)].filter((id) => !html.includes(`id="${id}"`));

if (missing.length) {
  console.error(`editor.html에 없는 요소: ${missing.join(', ')}`);
  process.exit(1);
}

// 헌터 화면도 같은 검사: hunter.js 가 부르는 id 가 hunter.html 에 있어야 한다.
const hunterScript = fs.readFileSync(path.join(directory, 'hunter.js'), 'utf8');
const hunterHtml = fs.readFileSync(path.join(directory, 'hunter.html'), 'utf8');
const hunterIds = [...hunterScript.matchAll(/\$\('#([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
const hunterMissing = [...new Set(hunterIds)].filter((id) => !hunterHtml.includes(`id="${id}"`));
if (hunterMissing.length) {
  console.error(`hunter.html에 없는 요소: ${hunterMissing.join(', ')}`);
  process.exit(1);
}

// 레퍼런스 분해 회귀 시험: 1편/여러 편 설계도, 길이·장면 수·문장 갱신, 콘셉트 변환
const { blueprintFrom, updateBlueprint, conceptFromBlueprint, blueprintOptions } = require('./shortform-analysis');
const refs = [
  { id: 'r1', title: '자취 요리 왜 다들 이렇게 할까?', caption: '해봤어요', durationSeconds: 32, views: 1000, metrics: { engagementRate: 5 }, hashtags: ['자취'], platform: 'youtube', platformLabel: 'YouTube Shorts', creator: 'a', url: 'u1' },
  { id: 'r2', title: '요리 3가지만 기억하세요', durationSeconds: 20, views: 500, metrics: { engagementRate: 2 }, platform: 'tiktok', platformLabel: 'TikTok', creator: 'b', url: 'u2' },
  { id: 'r3', title: '검색 링크만', dataQuality: 'link-only', platform: 'instagram', platformLabel: 'Instagram Reels', url: 'u3' }
];
const single = blueprintFrom([refs[0]], '자취 요리');
if (!single || single.mode !== 'single' || single.duration !== 32 || single.hookKey !== 'question') process.exit(1);
if (single.scenes[0].role !== 'hook' || single.scenes.at(-1).role !== 'closer' || single.scenes.at(-1).end !== 32) process.exit(1);
const group = blueprintFrom(refs, '자취 요리');
if (!group || group.mode !== 'group' || group.sources.length !== 2) process.exit(1);
if (blueprintFrom([refs[2]], '자취 요리') !== null) process.exit(1);
const longer = updateBlueprint({ ...group, duration: 45 }, 'duration');
if (longer.scenes.at(-1).end !== 45 || longer.scenes.length !== group.scenes.length) process.exit(1);
const counted = updateBlueprint(group, 'count', { count: 5 });
if (counted.scenes.length !== 5 || counted.scenes[0].caption !== group.scenes[0].caption) process.exit(1);
const rewritten = updateBlueprint({ ...group, hookKey: 'warning', tone: '반말 구어체' }, 'rewrite');
if (rewritten.scenes[0].caption === group.scenes[0].caption || rewritten.hookLabel !== '경고·금지형') process.exit(1);
const bpConcept = conceptFromBlueprint(rewritten);
if (!bpConcept || bpConcept.scenes.length !== rewritten.scenes.length || !bpConcept.hook || !bpConcept.basedOn.references.length) process.exit(1);
const options = blueprintOptions();
if (!options.hooks.length || !options.structures.length || !options.transitions.includes('정지')) process.exit(1);

const { sceneBriefs, rankMedia, recommendTransition } = require('./smart-edit');
const concept = {
  title: '서울 카페 추천', visualKeywords: ['카페', '커피'], cutTempo: 2.4,
  scenes: [
    { start: 0, end: 4, caption: '따뜻한 커피를 만드는 과정', visual: '손 동작 위에서 촬영' },
    { start: 4, end: 8, caption: '완성된 결과가 핵심', visual: '결과 화면' }
  ]
};
const briefs = sceneBriefs(concept);
const ranked = rankMedia([
  { title: 'coffee making hands', tags: ['cafe'], width: 1080, height: 1920, kind: 'video', durationSeconds: 8, commercialUse: true, attributionRequired: false },
  { title: 'wide city', width: 1920, height: 1080, kind: 'image', commercialUse: true }
], briefs[0]);

if (briefs.length !== 2 || ranked[0].title !== 'coffee making hands') process.exit(1);
if (recommendTransition(concept.scenes[1], 1, 2, concept.cutTempo).type !== 'zoom') process.exit(1);
console.log(`편집기 요소 ${new Set(referencedIds).size}개 · 헌터 요소 ${new Set(hunterIds).size}개 · 레퍼런스 분해 · 장면 매칭 · 소재 순위 · 전환 추천 검증 통과`);
