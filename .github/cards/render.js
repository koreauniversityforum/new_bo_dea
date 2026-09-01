/* 카드 굽기 — 노트북 없이 GitHub Actions 안에서 카드 그림을 만든다.
 *
 * 왜 브라우저를 띄우나: 카드 디자인(글꼴·띠·그라데이션·자동 줄바꿈)은 전부 캔버스
 * JS 다. 서버에서 파이썬으로 다시 그리면 두 벌이 되어 반드시 갈라진다. 그래서
 * **폰판(docs/, 서버 0개)을 헤드리스 크롬으로 그대로 열어** 사람이 누르는 것과
 * 같은 길(`?auto=brief` → DECK.briefFrom)을 밟게 하고, 캔버스만 꺼내 온다.
 *
 *   node render.js --data 기사.json --out 낼곳 [--quality 0.9]
 *
 * 기사.json = { date, items:[{title, source, url}], outro }
 * 낼곳에 01.jpg … NN.jpg 와 목록.json 을 쓴다.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', '..');      // 레포 뿌리
const DOCS = path.join(ROOT, 'docs');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.otf': 'font/otf', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
};

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/* 폰판을 그대로 얹는 정적 서버. file:// 로 열면 localStorage 와 글꼴이 막힌다. */
function serve() {
  const srv = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const p = path.join(DOCS, rel);
    if (!p.startsWith(DOCS) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cands = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('크롬을 찾지 못했습니다. CHROME_PATH 를 지정하세요.');
}

(async () => {
  const data = JSON.parse(fs.readFileSync(arg('data'), 'utf8'));
  const outDir = arg('out', path.join(ROOT, '.cards'));
  const quality = parseFloat(arg('quality', '0.9'));
  fs.mkdirSync(outDir, { recursive: true });

  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', e => errors.push('page: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    // 같은 출처에서만 localStorage 를 심을 수 있다 → 빈 화면 먼저 열고 심는다
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    // 앱에서 쓰던 설정(워터마크·디자인)을 심는다. 없으면 화면 기본값으로 구워지는데,
    // 기본값의 「보이는 워터마크」는 대각선으로 크게 깔려 그대로 올릴 그림이 못 된다.
    const setPath = arg('settings', path.join(__dirname, '발행설정.json'));
    if (fs.existsSync(setPath)) {
      const conf = JSON.parse(fs.readFileSync(setPath, 'utf8')).localStorage || {};
      await page.evaluate(c => {
        for (const k of Object.keys(c)) {
          const cur = (() => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } })();
          localStorage.setItem(k, JSON.stringify(Object.assign(cur, c[k])));
        }
      }, conf);
      console.log('설정 심음: ' + Object.keys(conf).join(', '));
    }
    await page.evaluate(d => localStorage.setItem('nb_daily', JSON.stringify(d)), data);
    await page.goto(base + '/index.html?auto=brief', { waitUntil: 'networkidle0' });

    const want = (data.items || []).length + 1 + (data.outro ? 1 : 0);
    await page.waitForFunction(
      n => window.DECK && DECK.count() === n, { timeout: 60000, polling: 300 }, want);
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 1200));       // 글꼴 적용 뒤 한 번 더 그리게

    const shots = await page.evaluate(async (q) => {
      const items = DECK.stageItems();
      return items.map(it => ({ name: it.name, dataUrl: it.canvas.toDataURL('image/jpeg', q) }));
    }, quality);

    const list = [];
    shots.forEach((s, i) => {
      const name = String(i + 1).padStart(2, '0') + '.jpg';
      const b64 = s.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      fs.writeFileSync(path.join(outDir, name), buf);
      list.push({ file: name, bytes: buf.length });
      console.log('  · ' + name + ' (' + Math.round(buf.length / 1024) + 'KB)');
    });
    fs.writeFileSync(path.join(outDir, '목록.json'),
      JSON.stringify({ date: data.date || '', cards: list }, null, 1), 'utf8');
    console.log('카드 ' + list.length + '장 구웠습니다 → ' + outDir);
    if (errors.length) console.log('화면 오류(참고): ' + errors.slice(0, 5).join(' / '));
    if (!list.length) throw new Error('카드가 한 장도 안 나왔습니다.');
  } finally {
    await browser.close();
    srv.close();
  }
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
