// 콘텐츠 헌터 수집기
// 뉴스 RSS가 아니라 실제로 유행 중인 공개 숏폼(YouTube Shorts / Instagram Reels / TikTok)을 모은다.
// 타인의 영상 파일이나 사진은 내려받지 않는다. 공개 메타데이터와 원문 링크만 사용한다.

const crypto = require('node:crypto');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BACKSLASH = String.fromCharCode(92);

const PLATFORMS = {
  youtube: { label: 'YouTube Shorts', icon: '▶' },
  instagram: { label: 'Instagram Reels', icon: '◎' },
  tiktok: { label: 'TikTok', icon: '♪' }
};

async function fetchPage(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6',
      ...(options.headers || {})
    },
    method: options.method || 'GET',
    body: options.body,
    signal: AbortSignal.timeout(options.timeout || 12000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { text: await response.text(), finalUrl: response.url, redirected: response.redirected };
}

async function fetchText(url, options = {}) {
  return (await fetchPage(url, options)).text;
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

/* ------------------------------------------------------------------ */
/* 공통 도우미                                                          */
/* ------------------------------------------------------------------ */

// `var ytInitialData = {...};` 형태로 박혀 있는 JSON을 괄호 균형으로 잘라낸다.
function extractAssignedJson(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === BACKSLASH) escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
}


function collectRenderers(node, key, bucket = []) {
  if (!node || typeof node !== 'object') return bucket;
  if (node[key]) bucket.push(node[key]);
  for (const value of Object.values(node)) collectRenderers(value, key, bucket);
  return bucket;
}

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.simpleText || value.content || (value.runs || []).map((run) => run.text).join('') || '';
}

function toNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').toUpperCase();
  const number = Number(text.match(/[\d.]+/)?.[0] || 0);
  if (!number) return 0;
  if (text.includes('억')) return Math.round(number * 100000000);
  if (text.includes('만')) return Math.round(number * 10000);
  if (text.includes('천')) return Math.round(number * 1000);
  if (/[\d.]B/.test(text)) return Math.round(number * 1000000000);
  if (/[\d.]M/.test(text)) return Math.round(number * 1000000);
  if (/[\d.]K/.test(text)) return Math.round(number * 1000);
  return Math.round(number);
}

function clockToSeconds(value) {
  const parts = String(value || '').trim().split(':');
  if (!parts.length || parts.some((part) => part === '' || !Number.isFinite(Number(part)))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

// "3일 전", "2주 전" 같은 상대 표기를 대략적인 ISO 시각으로 되돌린다.
function relativeToIso(text) {
  const value = String(text || '');
  const amount = Number(value.match(/\d+/)?.[0] || 0);
  if (!amount) return '';
  const unit = [
    [/분/, 60000], [/시간/, 3600000], [/일/, 86400000],
    [/주/, 604800000], [/개월|달/, 2592000000], [/년/, 31536000000]
  ].find(([pattern]) => pattern.test(value));
  if (!unit) return '';
  return new Date(Date.now() - amount * unit[1]).toISOString();
}

function parseKoreanDate(value) {
  const match = String(value || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function hashtagsOf(text) {
  return [...new Set([...String(text || '').matchAll(/#([0-9A-Za-z가-힣_]{1,30})/g)].map((match) => match[1]))].slice(0, 12);
}

function idOf(platform, key) {
  return `${platform}-${crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 12)}`;
}

function withMetrics(item) {
  const views = Number(item.views) || 0;
  const likes = Number(item.likes) || 0;
  const comments = Number(item.comments) || 0;
  const shares = Number(item.shares) || 0;
  const reactions = likes + comments + shares;
  const ageDays = item.publishedAt
    ? Math.max(0.25, (Date.now() - new Date(item.publishedAt).getTime()) / 86400000)
    : null;
  return {
    ...item,
    metrics: {
      reactions,
      engagementRate: views ? Number(((reactions / views) * 100).toFixed(2)) : null,
      likeRate: views && likes ? Number(((likes / views) * 100).toFixed(2)) : null,
      commentRate: views && comments ? Number(((comments / views) * 100).toFixed(2)) : null,
      viewsPerDay: views && ageDays ? Math.round(views / ageDays) : null,
      ageDays: ageDays ? Number(ageDays.toFixed(1)) : null
    }
  };
}

/* ------------------------------------------------------------------ */
/* YouTube Shorts - 공개 검색 페이지 수집 + 선택적 공식 API             */
/* ------------------------------------------------------------------ */

function parseSearchVideos(data) {
  return collectRenderers(data, 'videoRenderer').map((video) => {
    const seconds = clockToSeconds(textOf(video.lengthText));
    const viewText = textOf(video.viewCountText) || textOf(video.shortViewCountText);
    return {
      videoId: video.videoId,
      title: textOf(video.title),
      creator: textOf(video.ownerText) || textOf(video.longBylineText),
      views: toNumber(viewText),
      durationSeconds: seconds,
      durationText: textOf(video.lengthText),
      publishedText: textOf(video.publishedTimeText),
      publishedAt: relativeToIso(textOf(video.publishedTimeText)),
      thumbnail: (video.thumbnail?.thumbnails || []).at(-1)?.url || ''
    };
  }).filter((item) => item.videoId && item.title);
}

// 검색 결과 안의 Shorts 선반은 접근성 문구에만 정보가 들어 있다.
function parseShortsShelf(data) {
  return collectRenderers(data, 'shortsLockupViewModel').map((lockup) => {
    const videoId = lockup.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
      || String(lockup.entityId || '').replace('shorts-shelf-item-', '');
    const accessibility = lockup.accessibilityText || '';
    const title = accessibility.split(', 조회수')[0].trim();
    const views = toNumber(accessibility.match(/조회수\s*([\d.,만억천]+)/)?.[1] || '');
    return {
      videoId,
      title: title || textOf(lockup.overlayMetadata?.primaryText),
      creator: '',
      views,
      durationSeconds: null,
      durationText: 'Shorts',
      publishedText: '',
      publishedAt: '',
      thumbnail: lockup.onTap?.innertubeCommand?.reelWatchEndpoint?.thumbnail?.thumbnails?.at(-1)?.url || ''
    };
  }).filter((item) => item.videoId && item.title);
}

// YouTube 페이지는 같은 JSON을 어떤 곳은 그대로, 어떤 곳은 \xNN 로 감싸서 심어 둔다.
// 숫자만 뽑을 용도로 두 겹을 모두 벗긴 사본을 만든다.
function flattenYouTubeHtml(html) {
  const hexEscape = new RegExp(`${BACKSLASH}${BACKSLASH}x([0-9a-fA-F]{2})`, 'g');
  const quoteEscape = new RegExp(`${BACKSLASH}${BACKSLASH}+"`, 'g');
  return html.replace(hexEscape, (_match, hex) => String.fromCharCode(parseInt(hex, 16))).replace(quoteEscape, '"');
}

// Shorts 페이지에는 다음 영상들이 함께 실려 있어 댓글 수를 잘못 집을 수 있다.
// 댓글 수만 videoId 로 지정되는 innertube 응답에서 따로 확인한다.
async function fetchCommentCount(videoId, clientVersion) {
  try {
    const text = await fetchText('https://www.youtube.com/youtubei/v1/next?prettyPrint=false', {
      method: 'POST',
      timeout: 9000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: clientVersion || '2.20260819.01.00', hl: 'ko', gl: 'KR' } },
        videoId
      })
    });
    const match = text.match(/"engagementPanelTitleHeaderRenderer":\{"title":\{"runs":\[\{"text":"댓글"\}\]\},"contextualInfo":\{"runs":\[\{"text":"([^"]+)"/);
    return match ? toNumber(match[1]) : null;
  } catch {
    return null;
  }
}

// 개별 Shorts 페이지에서 정확한 조회수·좋아요·게시일·캡션을 읽는다.
async function enrichYouTubeShort(videoId) {
  const page = await fetchPage(`https://www.youtube.com/shorts/${videoId}?hl=ko&gl=KR`, { timeout: 11000 });
  const html = page.text;
  const player = extractAssignedJson(html, 'var ytInitialPlayerResponse = ');
  const details = player?.videoDetails || {};
  const micro = player?.microformat?.playerMicroformatRenderer || {};
  const flat = flattenYouTubeHtml(html);

  const likeMatch = flat.match(/"likeCount":"?(\d+)/)
    || flat.match(/"likeCountIfIndifferent":\{"content":"([\d.,만억천KMB]+)"/);
  const viewMatch = flat.match(/"viewCount":"(\d+)"/);
  // Shorts 페이지에는 다음 영상 데이터가 섞여 있어 날짜는 microformat 만 신뢰한다.
  const dateText = micro.publishDate || micro.uploadDate || '';
  const clientVersion = html.match(/"clientVersion":"([\d.]+)"/)?.[1];
  const comments = await fetchCommentCount(videoId, clientVersion);

  return {
    // /shorts/ 주소가 /watch 로 넘어가면 세로 숏폼이 아니라 일반 영상이다.
    isShort: String(page.finalUrl).includes('/shorts/'),
    views: Number(details.viewCount) || toNumber(viewMatch?.[1]) || 0,
    likes: likeMatch ? toNumber(likeMatch[1]) : null,
    comments,
    caption: String(details.shortDescription || '').slice(0, 900),
    creator: details.author || micro.ownerChannelName || '',
    creatorUrl: micro.ownerProfileUrl || '',
    title: details.title || '',
    durationSeconds: Number(details.lengthSeconds) || null,
    publishedAt: /^\d{4}-\d{2}-\d{2}/.test(dateText) ? new Date(dateText).toISOString() : parseKoreanDate(dateText),
    keywords: details.keywords || []
  };
}

const PERIOD_DAYS = Object.freeze({ day1: 1, day3: 3, day5: 5, week: 7, month: 30 });

function periodDays(period) {
  return PERIOD_DAYS[period] || null;
}

async function collectYouTubeApi(keyword, apiKey, limit, period = 'all') {
  const params = {
    part: 'snippet', q: `${keyword} #shorts`, type: 'video', videoDuration: 'short',
    order: 'viewCount', maxResults: String(Math.min(25, limit * 2)), regionCode: 'KR',
    relevanceLanguage: 'ko', key: apiKey
  };
  const days = periodDays(period);
  if (days) params.publishedAfter = new Date(Date.now() - days * 86400000).toISOString();
  const search = await fetchJson('https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams(params));
  const ids = (search.items || []).map((item) => item.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const detail = await fetchJson('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({
    part: 'snippet,statistics,contentDetails', id: ids.join(','), key: apiKey
  }));
  return (detail.items || []).map((video) => {
    const iso = video.contentDetails?.duration || '';
    const parts = iso.match(/PT(?:(\d+)M)?(?:(\d+)S)?/) || [];
    const seconds = Number(parts[1] || 0) * 60 + Number(parts[2] || 0);
    if (seconds > 185) return null;
    return withMetrics({
      id: idOf('youtube', video.id),
      platform: 'youtube',
      platformLabel: PLATFORMS.youtube.label,
      title: video.snippet?.title || '',
      caption: String(video.snippet?.description || '').slice(0, 900),
      creator: video.snippet?.channelTitle || '',
      creatorUrl: `https://www.youtube.com/channel/${video.snippet?.channelId || ''}`,
      publishedAt: video.snippet?.publishedAt || '',
      publishedText: '',
      views: Number(video.statistics?.viewCount) || 0,
      likes: video.statistics?.likeCount === undefined ? null : Number(video.statistics.likeCount),
      comments: video.statistics?.commentCount === undefined ? null : Number(video.statistics.commentCount),
      shares: null,
      durationSeconds: seconds || null,
      durationText: seconds ? `0:${String(seconds % 60).padStart(2, '0')}` : 'Shorts',
      url: `https://www.youtube.com/shorts/${video.id}`,
      thumbnail: video.snippet?.thumbnails?.high?.url || '',
      hashtags: hashtagsOf(`${video.snippet?.title} ${video.snippet?.description}`),
      dataQuality: 'measured',
      dataNote: 'YouTube Data API v3 공식 수치'
    });
  }).filter(Boolean);
}

// 검색 필터 코드(protobuf). 유형=Shorts 에 업로드 기간을 덧붙인 값이다.
const YOUTUBE_PERIOD_FILTER = {
  all: 'EgIQCQ%3D%3D',
  month: 'EgQIBBAJ',
  week: 'EgQIAxAJ',
  // YouTube 공개 검색은 3일·5일 필터가 없으므로 최근 7일 후보를 받은 뒤 게시 시각으로 거른다.
  day1: 'EgQIAhAJ',
  day3: 'EgQIAxAJ',
  day5: 'EgQIAxAJ'
};

async function collectYouTubePublic(keyword, limit, period = 'all') {
  const query = encodeURIComponent(keyword);
  // 기간을 고른 경우 기간 밖 결과가 섞이지 않도록 해당 필터만 쓴다.
  const urls = period === 'all' ? [
    `https://www.youtube.com/results?search_query=${query}&hl=ko&gl=KR&sp=${YOUTUBE_PERIOD_FILTER.all}`,
    // 조회수순 + 짧은 영상. 오래 살아남은 인기 숏폼을 함께 건진다.
    `https://www.youtube.com/results?search_query=${query}&hl=ko&gl=KR&sp=CAMSBBABGAE%3D`,
    // 일반 검색은 Shorts 선반을 함께 돌려준다.
    `https://www.youtube.com/results?search_query=${encodeURIComponent(`${keyword} 쇼츠`)}&hl=ko&gl=KR`
  ] : [
    `https://www.youtube.com/results?search_query=${query}&hl=ko&gl=KR&sp=${YOUTUBE_PERIOD_FILTER[period]}`,
    `https://www.youtube.com/results?search_query=${encodeURIComponent(`${keyword} 쇼츠`)}&hl=ko&gl=KR&sp=${YOUTUBE_PERIOD_FILTER[period]}`
  ];
  const pages = await Promise.allSettled(urls.map((url) => fetchText(url)));
  const candidates = [];
  pages.forEach((page) => {
    if (page.status !== 'fulfilled') return;
    const data = extractAssignedJson(page.value, 'var ytInitialData = ');
    if (!data) return;
    candidates.push(...parseSearchVideos(data), ...parseShortsShelf(data));
  });

  const unique = new Map();
  candidates.forEach((item) => {
    if (item.durationSeconds !== null && item.durationSeconds > 185) return;
    const existing = unique.get(item.videoId);
    if (!existing || (item.views || 0) > (existing.views || 0)) unique.set(item.videoId, { ...existing, ...item });
  });

  // 세로 숏폼이 아닌 항목이 걸러질 것을 감안해 넉넉히 확인한다.
  const ranked = [...unique.values()].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, limit + 6);
  const enriched = await Promise.allSettled(ranked.map((item) => enrichYouTubeShort(item.videoId)));

  return ranked.map((item, index) => {
    const extra = enriched[index].status === 'fulfilled' ? enriched[index].value : {};
    if (extra.isShort === false) return null;
    const publishedAt = extra.publishedAt || item.publishedAt || '';
    return withMetrics({
      id: idOf('youtube', item.videoId),
      platform: 'youtube',
      platformLabel: PLATFORMS.youtube.label,
      title: extra.title || item.title,
      caption: extra.caption || '',
      creator: extra.creator || item.creator || 'YouTube',
      creatorUrl: extra.creatorUrl || '',
      publishedAt,
      publishedText: item.publishedText || '',
      views: extra.views || item.views || 0,
      likes: extra.likes ?? null,
      comments: extra.comments ?? null,
      shares: null,
      durationSeconds: extra.durationSeconds || item.durationSeconds,
      durationText: item.durationText || (extra.durationSeconds ? `0:${String(extra.durationSeconds % 60).padStart(2, '0')}` : 'Shorts'),
      url: `https://www.youtube.com/shorts/${item.videoId}`,
      thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
      hashtags: hashtagsOf(`${extra.title || item.title} ${extra.caption || ''}`),
      dataQuality: extra.views ? 'public-page' : 'public-list',
      dataNote: extra.views ? '공개 Shorts 페이지에서 읽은 수치' : '검색 결과 목록에 표시된 수치'
    });
  }).filter(Boolean).slice(0, limit);
}

async function collectYouTube(keyword, settings, limit, period) {
  const apiKey = settings?.youtube?.apiKey?.trim();
  if (apiKey) {
    try {
      const items = await collectYouTubeApi(keyword, apiKey, limit, period);
      if (items.length) return { items, mode: 'api', message: '공식 Data API로 수집했습니다.' };
    } catch (error) {
      // 키가 만료됐거나 할당량이 끝난 경우 공개 페이지 수집으로 내려간다.
      const items = await collectYouTubePublic(keyword, limit, period);
      return {
        items: withinPeriod(items, period),
        mode: 'public',
        message: `공식 API 실패(${error.message}) · 공개 페이지로 수집했습니다.`
      };
    }
  }
  const items = await collectYouTubePublic(keyword, limit, period);
  const fresh = withinPeriod(items, period);
  if (period !== 'all' && !fresh.length && items.length) {
    return { items: [], mode: 'public', message: '선택한 기간 안에서 게시 시각이 확인된 결과가 없습니다.' };
  }
  return {
    items: fresh, mode: 'public',
    message: fresh.length ? '공개 Shorts 페이지에서 수집했습니다.' : '공개 페이지에서 결과를 찾지 못했습니다.'
  };
}

// 1·3·5일은 정확도가 중요하므로 게시 시점을 모르는 항목을 제외한다.
// 기존 7·30일 조회는 수집 누락을 줄이기 위해 게시 시점 미확인 항목을 유지한다.
function withinPeriod(items, period) {
  if (period === 'all') return items;
  const days = periodDays(period);
  if (!days) return items;
  const limitTime = Date.now() - days * 86400000;
  const strict = ['day1', 'day3', 'day5'].includes(period);
  return items.filter((item) => {
    const publishedTime = new Date(item.publishedAt || '').getTime();
    if (!Number.isFinite(publishedTime)) return !strict;
    return publishedTime >= limitTime;
  });
}

/* ------------------------------------------------------------------ */
/* TikTok - 공식 Research API가 있을 때만 실제 수치를 얻는다             */
/* ------------------------------------------------------------------ */

async function tiktokAccessToken(config) {
  if (config.accessToken?.trim()) return config.accessToken.trim();
  if (!config.clientKey?.trim() || !config.clientSecret?.trim()) return '';
  const body = new URLSearchParams({
    client_key: config.clientKey.trim(),
    client_secret: config.clientSecret.trim(),
    grant_type: 'client_credentials'
  });
  const data = await fetchJson('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: body.toString()
  });
  if (!data.access_token) throw new Error(data.error_description || 'TikTok 토큰 발급 실패');
  return data.access_token;
}

function tiktokDateStamp(offsetDays) {
  const date = new Date(Date.now() - offsetDays * 86400000);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

async function collectTikTok(keyword, settings, limit, period = 'all') {
  const config = settings?.tiktok || {};
  const searchUrl = `https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`;
  const token = await tiktokAccessToken(config).catch(() => '');
  if (!token) {
    return {
      items: [linkOnlyItem('tiktok', keyword, searchUrl, 'TikTok Research API를 연결하면 조회수·좋아요·댓글을 그대로 가져옵니다.')],
      mode: 'link',
      message: '공식 API 미연결 · 공개 수치 없음, 검색 링크만 제공합니다.'
    };
  }

  const fields = 'id,video_description,create_time,region_code,share_count,view_count,like_count,comment_count,username,hashtag_names';
  const hashtag = keyword.replace(/[^0-9A-Za-z가-힣]/g, '') || keyword;
  const payload = {
    query: {
      and: [
        { operation: 'IN', field_name: 'region_code', field_values: [config.regionCode || 'KR'] },
        { operation: 'IN', field_name: 'hashtag_name', field_values: [hashtag] }
      ]
    },
    // 날짜 API는 자정 기준이므로 하루를 넓게 요청한 뒤 아래에서 실제 시각으로 재검증한다.
    start_date: tiktokDateStamp(periodDays(period) ?? 29),
    end_date: tiktokDateStamp(0),
    max_count: Math.min(100, limit * 2)
  };

  try {
    const data = await fetchJson(`https://open.tiktokapis.com/v2/research/video/query/?fields=${fields}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 15000
    });
    const videos = data?.data?.videos || [];
    if (!videos.length) throw new Error(data?.error?.message || '결과 없음');
    const items = withinPeriod(videos.map((video) => withMetrics({
      id: idOf('tiktok', video.id),
      platform: 'tiktok',
      platformLabel: PLATFORMS.tiktok.label,
      title: String(video.video_description || '').split('\n')[0].slice(0, 90) || `@${video.username}`,
      caption: String(video.video_description || '').slice(0, 900),
      creator: video.username ? `@${video.username}` : 'TikTok',
      creatorUrl: video.username ? `https://www.tiktok.com/@${video.username}` : '',
      publishedAt: video.create_time ? new Date(video.create_time * 1000).toISOString() : '',
      publishedText: '',
      views: Number(video.view_count) || 0,
      likes: Number(video.like_count) || 0,
      comments: Number(video.comment_count) || 0,
      shares: Number(video.share_count) || 0,
      durationSeconds: null,
      durationText: 'TikTok',
      url: video.username ? `https://www.tiktok.com/@${video.username}/video/${video.id}` : searchUrl,
      thumbnail: '',
      hashtags: (video.hashtag_names || []).slice(0, 12),
      dataQuality: 'measured',
      dataNote: 'TikTok Research API 공식 수치'
    })), period).sort((a, b) => b.views - a.views).slice(0, limit);
    return { items, mode: 'api', message: '공식 Research API로 수집했습니다.' };
  } catch (error) {
    return {
      items: [linkOnlyItem('tiktok', keyword, searchUrl, `Research API 응답 실패: ${error.message}`)],
      mode: 'link',
      message: `공식 API 응답 실패 · ${error.message}`
    };
  }
}

/* ------------------------------------------------------------------ */
/* Instagram - Graph API 해시태그 인기 게시물                            */
/* ------------------------------------------------------------------ */

async function collectInstagram(keyword, settings, limit, period = 'all') {
  const config = settings?.instagram || {};
  const searchUrl = `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(keyword)}`;
  const token = config.accessToken?.trim();
  const userId = config.userId?.trim();
  if (!token || !userId) {
    return {
      items: [linkOnlyItem('instagram', keyword, searchUrl, 'Instagram Graph API를 연결하면 좋아요·댓글 수를 그대로 가져옵니다.')],
      mode: 'link',
      message: '공식 API 미연결 · 공개 수치 없음, 검색 링크만 제공합니다.'
    };
  }

  const version = config.apiVersion || 'v21.0';
  const tag = keyword.replace(/[^0-9A-Za-z가-힣]/g, '') || keyword;
  try {
    const search = await fetchJson(`https://graph.facebook.com/${version}/ig_hashtag_search?` + new URLSearchParams({
      user_id: userId, q: tag, access_token: token
    }));
    const hashtagId = search?.data?.[0]?.id;
    if (!hashtagId) throw new Error('해시태그를 찾지 못했습니다.');
    const media = await fetchJson(`https://graph.facebook.com/${version}/${hashtagId}/top_media?` + new URLSearchParams({
      user_id: userId, access_token: token,
      fields: 'id,caption,like_count,comments_count,media_type,permalink,timestamp'
    }));
    const items = withinPeriod((media?.data || [])
      .filter((entry) => entry.media_type === 'VIDEO' || entry.media_type === 'CAROUSEL_ALBUM')
      .map((entry) => withMetrics({
        id: idOf('instagram', entry.id),
        platform: 'instagram',
        platformLabel: PLATFORMS.instagram.label,
        title: String(entry.caption || '').split('\n')[0].slice(0, 90) || 'Instagram Reels',
        caption: String(entry.caption || '').slice(0, 900),
        creator: 'Instagram 공개 인기 게시물',
        creatorUrl: '',
        publishedAt: entry.timestamp || '',
        publishedText: '',
        views: 0,
        likes: Number(entry.like_count) || 0,
        comments: Number(entry.comments_count) || 0,
        shares: null,
        durationSeconds: null,
        durationText: 'Reels',
        url: entry.permalink || searchUrl,
        thumbnail: '',
        hashtags: hashtagsOf(entry.caption),
        dataQuality: 'measured',
        dataNote: 'Instagram Graph API 공식 수치 (해시태그 인기 게시물은 조회수를 제공하지 않습니다)'
      })), period)
      .sort((a, b) => b.metrics.reactions - a.metrics.reactions)
      .slice(0, limit);
    if (!items.length) throw new Error('영상 게시물이 없습니다.');
    return { items, mode: 'api', message: '공식 Graph API로 수집했습니다.' };
  } catch (error) {
    return {
      items: [linkOnlyItem('instagram', keyword, searchUrl, `Graph API 응답 실패: ${error.message}`)],
      mode: 'link',
      message: `공식 API 응답 실패 · ${error.message}`
    };
  }
}

/* ------------------------------------------------------------------ */

function linkOnlyItem(platform, keyword, url, reason) {
  return withMetrics({
    id: idOf(platform, `${keyword}-link`),
    platform,
    platformLabel: PLATFORMS[platform].label,
    title: `“${keyword}” ${PLATFORMS[platform].label} 인기 검색`,
    caption: '',
    creator: `${PLATFORMS[platform].label} 공개 검색`,
    creatorUrl: '',
    publishedAt: '',
    publishedText: '',
    views: null, likes: null, comments: null, shares: null,
    durationSeconds: null, durationText: '검색',
    url,
    thumbnail: '',
    hashtags: [],
    dataQuality: 'link-only',
    dataNote: reason
  });
}

const SORTERS = {
  views: (a, b) => (b.views || 0) - (a.views || 0),
  engagement: (a, b) => (b.metrics.engagementRate ?? -1) - (a.metrics.engagementRate ?? -1) || b.metrics.reactions - a.metrics.reactions,
  reactions: (a, b) => b.metrics.reactions - a.metrics.reactions,
  velocity: (a, b) => (b.metrics.viewsPerDay ?? -1) - (a.metrics.viewsPerDay ?? -1),
  recent: (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
};

async function discoverShorts(options = {}) {
  const keyword = String(options.keyword || '').trim().slice(0, 80) || '요즘 유행';
  const requested = Array.isArray(options.platforms) && options.platforms.length
    ? options.platforms.filter((name) => PLATFORMS[name])
    : Object.keys(PLATFORMS);
  const limit = Math.min(20, Math.max(4, Number(options.limit) || 10));
  const period = ['all', 'month', 'week', 'day5', 'day3', 'day1'].includes(options.period) ? options.period : 'all';
  const settings = options.settings || {};

  const jobs = requested.map(async (platform) => {
    const collector = { youtube: collectYouTube, instagram: collectInstagram, tiktok: collectTikTok }[platform];
    try {
      const result = await collector(keyword, settings, limit, period);
      return { platform, ...result };
    } catch (error) {
      return {
        platform, mode: 'error', message: error.message,
        items: [linkOnlyItem(platform, keyword, searchLinkFor(platform, keyword), `수집 실패: ${error.message}`)]
      };
    }
  });

  const results = await Promise.all(jobs);
  const items = results.flatMap((result) => result.items);
  const measured = items.filter((item) => item.dataQuality !== 'link-only');
  const linkOnly = items.filter((item) => item.dataQuality === 'link-only');
  const sorter = SORTERS[options.sort] || SORTERS.views;

  return {
    keyword,
    period,
    collectedAt: new Date().toISOString(),
    items: [...measured.sort(sorter), ...linkOnly],
    platformStatus: results.map((result) => ({
      platform: result.platform,
      label: PLATFORMS[result.platform].label,
      mode: result.mode,
      message: result.message,
      count: result.items.filter((item) => item.dataQuality !== 'link-only').length
    }))
  };
}

function searchLinkFor(platform, keyword) {
  const query = encodeURIComponent(keyword);
  return {
    youtube: `https://www.youtube.com/results?search_query=${query}&sp=CAMSBBABGAE%3D`,
    tiktok: `https://www.tiktok.com/search/video?q=${query}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${query}`
  }[platform];
}

module.exports = { discoverShorts, PLATFORMS, PERIOD_DAYS, periodDays, withinPeriod, toNumber, hashtagsOf, searchLinkFor };
