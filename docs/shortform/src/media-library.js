// 인터넷에서 영상·사진·음악을 가져온다.
// 남의 숏폼 화면을 복사하는 것이 아니라, 상업 이용이 허용된 공개 소재만 모은다.
// 트렌드 분석에서 나온 화면 키워드를 그대로 검색어로 넘겨 쓰는 것이 이 화면의 목적이다.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { rankMedia } = require('./smart-edit');

const USER_AGENT = 'ShortformStudio/0.3 (desktop editor; free media search)';
const COMMERCIAL_LICENSES = new Set(['cc0', 'pdm', 'by', 'by-sa', 'sampling+']);

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(options.timeout || 13000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function idOf(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 14);
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '').trim();
}

function readableSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)}GB`;
  if (bytes >= 1048576) return `${Math.round(bytes / 1048576)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

/* ------------------------------------------------------------------ */
/* Openverse - 사진과 음악. 열쇠 없이 열리고 라이선스가 함께 온다.       */
/* ------------------------------------------------------------------ */

async function searchOpenverse(kind, query, limit) {
  const endpoint = kind === 'audio' ? 'audio' : 'images';
  const params = {
    q: query, license_type: 'commercial', page_size: String(Math.min(20, limit * 3)), mature: 'false'
  };
  // 뉴스 낭독·팟캐스트 대신 실제 음악 카테고리만 요청한다.
  if (kind === 'audio') params.category = 'music';
  const data = await fetchJson(`https://api.openverse.org/v1/${endpoint}/?` + new URLSearchParams(params));
  return (data.results || []).map((entry) => ({
    id: `openverse-${idOf(entry.id)}`,
    kind: kind === 'audio' ? 'audio' : 'image',
    title: entry.title || query,
    creator: entry.creator || '알 수 없음',
    provider: entry.source || 'Openverse',
    license: `CC ${String(entry.license || '').toUpperCase()} ${entry.license_version || ''}`.trim(),
    licenseUrl: entry.license_url || '',
    commercialUse: COMMERCIAL_LICENSES.has(String(entry.license || '').toLowerCase()),
    attributionRequired: String(entry.license || '').toLowerCase() !== 'cc0',
    sourceUrl: entry.foreign_landing_url || '',
    downloadUrl: entry.url || '',
    thumbnail: entry.thumbnail || (kind === 'audio' ? '' : entry.url),
    width: entry.width || null,
    height: entry.height || null,
    durationSeconds: entry.duration ? Math.round(entry.duration / 1000) : null,
    tags: (entry.tags || []).map((tag) => typeof tag === 'string' ? tag : tag.name || '').filter(Boolean),
    category: entry.category || '',
    sizeBytes: entry.filesize || null,
    sizeText: readableSize(entry.filesize),
    extension: entry.filetype || (kind === 'audio' ? 'mp3' : 'jpg')
  })).filter((item) => item.downloadUrl);
}

/* ------------------------------------------------------------------ */
/* 위키미디어 공용 - 영상과 사진                                        */
/* ------------------------------------------------------------------ */

async function searchCommons(kind, query, limit) {
  const mime = kind === 'video' ? 'filemime:video/webm' : kind === 'audio' ? 'filemime:audio/ogg' : 'filemime:image/jpeg';
  const data = await fetchJson('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', origin: '*', prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: '480',
    generator: 'search', gsrnamespace: '6', gsrlimit: String(Math.min(20, limit * 2)),
    gsrsearch: `${query} ${mime}`
  }));
  return Object.values(data.query?.pages || {}).map((page) => {
    const info = page.imageinfo?.[0] || {};
    const meta = info.extmetadata || {};
    const license = stripHtml(meta.LicenseShortName?.value) || '확인 필요';
    return {
      id: `commons-${idOf(page.title)}`,
      kind,
      title: String(page.title || '').replace(/^File:/, ''),
      creator: stripHtml(meta.Artist?.value) || '알 수 없음',
      provider: '위키미디어 공용',
      license,
      licenseUrl: stripHtml(meta.LicenseUrl?.value) || '',
      commercialUse: !/NonCommercial|NC\b/i.test(license),
      attributionRequired: !/CC0|Public domain/i.test(license),
      sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`,
      downloadUrl: info.url || '',
      thumbnail: info.thumburl || (kind === 'image' ? info.url : ''),
      width: info.width || null,
      height: info.height || null,
      durationSeconds: info.duration ? Math.round(info.duration) : null,
      sizeBytes: info.size || null,
      sizeText: readableSize(info.size),
      extension: String(info.mime || '').split('/')[1] || (kind === 'video' ? 'webm' : 'jpg')
    };
  }).filter((item) => item.downloadUrl);
}

/* ------------------------------------------------------------------ */
/* Pexels - 세로 영상이 많아 숏폼에 잘 맞는다. 무료 키가 있을 때만 쓴다. */
/* ------------------------------------------------------------------ */

async function searchPexels(kind, query, limit, apiKey) {
  if (kind === 'audio') return [];
  const endpoint = kind === 'video' ? 'videos/search' : 'v1/search';
  const data = await fetchJson(`https://api.pexels.com/${endpoint}?` + new URLSearchParams({
    query, per_page: String(Math.min(20, limit * 2)), orientation: 'portrait'
  }), { headers: { Authorization: apiKey } });

  if (kind === 'video') {
    return (data.videos || []).map((video) => {
      const file = (video.video_files || [])
        .filter((entry) => entry.file_type === 'video/mp4')
        .sort((a, b) => (b.height || 0) - (a.height || 0))
        .find((entry) => (entry.height || 0) <= 1920) || (video.video_files || [])[0];
      return {
        id: `pexels-${video.id}`,
        kind: 'video',
        title: video.alt || query,
        creator: video.user?.name || 'Pexels',
        provider: 'Pexels',
        license: 'Pexels 라이선스 (상업 이용 가능)',
        licenseUrl: 'https://www.pexels.com/license/',
        commercialUse: true,
        attributionRequired: false,
        sourceUrl: video.url || '',
        downloadUrl: file?.link || '',
        thumbnail: video.image || '',
        width: file?.width || video.width || null,
        height: file?.height || video.height || null,
        durationSeconds: video.duration || null,
        sizeBytes: null,
        sizeText: '',
        extension: 'mp4'
      };
    }).filter((item) => item.downloadUrl);
  }

  return (data.photos || []).map((photo) => ({
    id: `pexels-${photo.id}`,
    kind: 'image',
    title: photo.alt || query,
    creator: photo.photographer || 'Pexels',
    provider: 'Pexels',
    license: 'Pexels 라이선스 (상업 이용 가능)',
    licenseUrl: 'https://www.pexels.com/license/',
    commercialUse: true,
    attributionRequired: false,
    sourceUrl: photo.url || '',
    downloadUrl: photo.src?.large2x || photo.src?.large || photo.src?.original || '',
    thumbnail: photo.src?.medium || '',
    width: photo.width || null,
    height: photo.height || null,
    durationSeconds: null,
    sizeBytes: null,
    sizeText: '',
    extension: 'jpg'
  })).filter((item) => item.downloadUrl);
}

/* ------------------------------------------------------------------ */
/* 무료 소재 창고는 영어 색인이라 한글 키워드는 그대로 넣으면 0건이다.   */
/* ------------------------------------------------------------------ */

const translationCache = new Map();

// 기계 번역이 자주 틀리는 숏폼·음악 용어는 사전으로 먼저 바꾼다.
const KEYWORD_MAP = [
  [/로파이|로-파이|lofi/i, 'lofi chill beat'], [/잔잔|차분|조용/, 'calm ambient'],
  [/신나|경쾌|업비트/, 'upbeat energetic'], [/감성|따뜻/, 'warm emotional'],
  [/유행|트렌드|바이럴/, 'trendy viral upbeat beat'],
  [/긴장|스릴/, 'tense cinematic'], [/뉴스|시사|속보|기사/, 'news documentary cinematic'],
  [/피아노/, 'piano'], [/기타/, 'acoustic guitar'],
  [/드럼|비트/, 'drum beat'], [/전자음|일렉/, 'electronic synth'],
  [/자취|원룸/, 'small apartment living'], [/요리|레시피|음식/, 'cooking food'],
  [/운동|헬스|러닝/, 'workout running fitness'], [/여행/, 'travel'],
  [/카페|커피/, 'cafe coffee'], [/공부|스터디/, 'study desk'],
  [/만들|과정|제작/, 'making process'], [/결과|완성/, 'finished result'],
  [/비교|전후|차이/, 'before after comparison'], [/사람|얼굴/, 'person portrait'],
  [/촬영|카메라/, 'camera filming'], [/도시|서울/, 'city street'],
  [/자연|풍경/, 'nature landscape'], [/반려|강아지|고양이/, 'pet dog cat'],
  [/패션|옷/, 'fashion clothing'], [/화장|뷰티/, 'beauty makeup']
];

function mappedKeywords(query) {
  const hits = KEYWORD_MAP.filter(([pattern]) => pattern.test(query)).map(([, english]) => english);
  return [...new Set(hits.join(' ').split(' '))].join(' ').trim();
}

async function toSearchQuery(query) {
  if (!/[가-힣]/.test(query)) return { text: query, translated: false };
  const mapped = mappedKeywords(query);
  if (translationCache.has(query)) return { text: translationCache.get(query), translated: true };
  try {
    const data = await fetchJson('https://api.mymemory.translated.net/get?' + new URLSearchParams({
      q: query, langpair: 'ko|en'
    }), { timeout: 8000 });
    const text = String(data?.responseData?.translatedText || '').trim();
    if (text && !/[가-힣]/.test(text)) {
      const enriched = [...new Set(`${mapped} ${text}`.split(/\s+/).filter(Boolean))].join(' ');
      translationCache.set(query, enriched);
      return { text: enriched, translated: true };
    }
  } catch { /* 번역이 안 되면 한글을 걷어낸 나머지로 찾는다. */ }
  if (mapped) return { text: mapped, translated: true };
  const ascii = query.replace(/[가-힣]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { text: ascii || query, translated: false };
}

async function searchWebMedia(options = {}) {
  const original = String(options.query || '').trim().slice(0, 80);
  const kind = ['image', 'video', 'audio'].includes(options.kind) ? options.kind : 'image';
  const limit = Math.min(24, Math.max(6, Number(options.limit) || 12));
  const pexelsKey = options.settings?.pexels?.apiKey?.trim();

  if (!original) return { query: original, kind, items: [], sources: [] };
  const searchTerm = await toSearchQuery(original);
  const searchWords = [...new Set(searchTerm.text.split(/\s+/).filter(Boolean))];
  const genericVisual = new Set(['warm', 'emotional', 'trendy', 'viral', 'beautiful', 'scene', 'video', 'image', 'process']);
  const compactVisual = [
    ...searchWords.filter((word) => !genericVisual.has(word.toLowerCase())),
    ...searchWords.filter((word) => genericVisual.has(word.toLowerCase()))
  ].slice(0, 4).join(' ');
  const query = kind === 'audio'
    ? `${searchTerm.text} instrumental background music`.replace(/\s+/g, ' ').trim()
    : compactVisual || searchTerm.text;

  const jobs = [];
  if (kind === 'video') {
    if (pexelsKey) jobs.push(['Pexels', searchPexels(kind, query, limit, pexelsKey)]);
    jobs.push(['위키미디어 공용', searchCommons('video', query, limit)]);
  } else if (kind === 'audio') {
    jobs.push(['Openverse', searchOpenverse('audio', query, limit)]);
  } else {
    jobs.push(['Openverse', searchOpenverse('image', query, limit)]);
    if (pexelsKey) jobs.push(['Pexels', searchPexels('image', query, limit, pexelsKey)]);
    jobs.push(['위키미디어 공용', searchCommons('image', query, limit)]);
  }

  let settled = await Promise.allSettled(jobs.map(([, job]) => job));
  const foundCount = settled.reduce((total, result) => total + (result.status === 'fulfilled' ? result.value.length : 0), 0);

  // 검색어가 길어 0건이 나오면 핵심 낱말 하나로 한 번 더 찾는다.
  let usedQuery = query;
  if (!foundCount) {
    const words = query.split(/\s+/).filter(Boolean);
    const audioGeneric = new Set(['music', 'background', 'instrumental', 'audio', 'song', 'news']);
    const fallback = kind === 'audio'
      ? words.filter((word) => !audioGeneric.has(word.toLowerCase())).slice(-2).join(' ')
      : words.slice(0, Math.min(2, words.length)).join(' ');
    if (fallback && fallback !== query) {
      usedQuery = fallback;
      const retryJobs = jobs.map(([name]) => {
        if (name === 'Pexels') return searchPexels(kind, fallback, limit, pexelsKey);
        if (name === 'Openverse') return searchOpenverse(kind, fallback, limit);
        return searchCommons(kind, fallback, limit);
      });
      settled = await Promise.allSettled(retryJobs);
    }
  }
  const sources = jobs.map(([name], index) => ({
    name,
    ok: settled[index].status === 'fulfilled',
    count: settled[index].status === 'fulfilled' ? settled[index].value.length : 0,
    message: settled[index].status === 'rejected' ? settled[index].reason?.message || '실패' : ''
  }));

  const speechPattern = /\b(article|audiobook|book reading|spoken|speech|podcast|interview|lecture|sermon|newscast|news report|voice.?over|narration|pronunciation|a\s?cappella|vocals?|singing|lyrics?)\b|낭독|연설|인터뷰|팟캐스트|기사|뉴스 음성|보컬|노래 가사/i;
  const items = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter((item) => options.allowNonCommercial ? true : item.commercialUse)
    .filter((item) => kind !== 'audio' || !speechPattern.test(`${item.title} ${item.creator} ${(item.tags || []).join(' ')}`))
    .slice(0, limit * 2);

  // 세로 영상과 작은 용량을 앞으로 올린다. 음악은 30초 이상인 트랙을 우선한다.
  items.sort((a, b) => {
    if (kind === 'audio') {
      const usableA = !a.durationSeconds || a.durationSeconds >= 30 ? 1 : 0;
      const usableB = !b.durationSeconds || b.durationSeconds >= 30 ? 1 : 0;
      if (usableA !== usableB) return usableB - usableA;
    }
    const verticalA = a.height && a.width ? (a.height >= a.width ? 1 : 0) : 0;
    const verticalB = b.height && b.width ? (b.height >= b.width ? 1 : 0) : 0;
    if (verticalA !== verticalB) return verticalB - verticalA;
    return (a.sizeBytes || 0) - (b.sizeBytes || 0);
  });

  const rankedItems = rankMedia(items.slice(0, limit * 2), { ...(options.context || {}), query: usedQuery });
  return {
    query: original,
    searchedWith: usedQuery,
    translated: searchTerm.translated,
    kind,
    items: rankedItems.slice(0, limit),
    sources
  };
}

/* ------------------------------------------------------------------ */
/* 내려받기 - 앱 폴더에 저장하고 출처를 함께 남긴다.                     */
/* ------------------------------------------------------------------ */

const MAX_BYTES = 220 * 1024 * 1024;

function safeFileName(value, extension) {
  const base = String(value || 'media').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'media';
  return `${base}.${(extension || 'bin').replace(/[^0-9a-z]/gi, '') || 'bin'}`;
}

function kindFromMime(mime = '', fallback = 'image') {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  return fallback;
}

async function downloadMedia(item, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const response = await fetch(item.downloadUrl, {
    headers: { 'User-Agent': USER_AGENT, Referer: item.sourceUrl || '' },
    redirect: 'follow',
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`내려받기 실패 HTTP ${response.status}`);

  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error(`파일이 너무 큽니다 (${readableSize(declared)}). 다른 소재를 골라 주세요.`);

  const mime = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error(`파일이 너무 큽니다 (${readableSize(buffer.length)}).`);

  const extension = item.extension || mime.split('/')[1] || 'bin';
  const fileName = safeFileName(`${item.title}-${item.id}`, extension);
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, buffer);

  const credit = {
    file: fileName,
    title: item.title,
    creator: item.creator,
    provider: item.provider,
    license: item.license,
    licenseUrl: item.licenseUrl,
    sourceUrl: item.sourceUrl,
    attributionRequired: item.attributionRequired,
    savedAt: new Date().toISOString()
  };
  appendCredit(targetDir, credit);

  const type = kindFromMime(mime, item.kind);
  return {
    id: `${item.id}-${buffer.length}`,
    name: fileName,
    path: filePath,
    type,
    audioRole: type === 'audio' ? 'bgm' : undefined,
    origin: 'web',
    credit
  };
}

// 직접 붙여 넣은 주소에서 가져온다. 사용자가 권리를 가진 파일에 쓰는 통로다.
async function downloadFromUrl(url, targetDir) {
  const address = String(url || '').trim();
  if (!/^https?:\/\//i.test(address)) throw new Error('http 또는 https 주소만 가져올 수 있습니다.');
  const parsed = new URL(address);
  const guessedName = decodeURIComponent(parsed.pathname.split('/').pop() || 'media');
  const extension = guessedName.includes('.') ? guessedName.split('.').pop() : '';
  return downloadMedia({
    id: idOf(address),
    title: guessedName.replace(/\.[^.]+$/, '') || '가져온 파일',
    creator: parsed.hostname,
    provider: parsed.hostname,
    license: '사용자가 직접 입력한 주소',
    licenseUrl: '',
    sourceUrl: address,
    downloadUrl: address,
    attributionRequired: false,
    extension,
    kind: 'image'
  }, targetDir);
}

function creditsPath(targetDir) {
  return path.join(targetDir, 'credits.json');
}

function appendCredit(targetDir, credit) {
  const file = creditsPath(targetDir);
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { list = []; }
  list = list.filter((entry) => entry.file !== credit.file);
  list.push(credit);
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}

function readCredits(targetDir) {
  try { return JSON.parse(fs.readFileSync(creditsPath(targetDir), 'utf8')); } catch { return []; }
}

module.exports = { searchWebMedia, downloadMedia, downloadFromUrl, readCredits };
