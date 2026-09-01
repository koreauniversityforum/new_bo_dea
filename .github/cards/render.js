/* 카드 굽기 - 노트북 없이 GitHub Actions 안에서 카드 그림을 만든다.
 *
 * 왜 브라우저를 띄우나: 카드 디자인(글꼴·띠·그라데이션·자동 줄바꿈)은 전부 캔버스
 * JS 다. 서버에서 파이썬으로 다시 그리면 두 벌이 되어 반드시 갈라진다. 그래서
 * **폰판(docs/, 서버 0개)을 헤드리스 크롬으로 그대로 열어** 사람이 누르는 것과
 * 같은 길(`?auto=brief` → DECK.briefFrom)을 밟게 하고, 캔버스만 꺼내 온다.
 *
 *   node render.js --data 기사.json --out 낼곳 [--photos 사진폴더] [--quality 0.9]
 *
 * 기사.json = { date, items:[{title, source, url}], outro }
 * 낼곳에 01.jpg/01.png … 과 목록.json(장 종류 포함)을 쓴다.
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

/* 폰판을 그대로 얹는 정적 서버. file:// 로 열면 localStorage 와 글꼴이 막힌다.
   `/사진/` 은 기사 사진을 받아 둔 폴더로 보낸다 - **같은 출처**여야 캔버스가 안 더러워진다
   (다른 출처 그림을 얹으면 toDataURL() 이 막혀 카드를 못 꺼낸다). */
function serve(photoDir) {
  const srv = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    let p;
    if (rel.startsWith('/사진/') && photoDir) {
      p = path.join(photoDir, path.basename(rel));
      if (!fs.existsSync(p)) { res.writeHead(404); return res.end('no photo'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'image/jpeg' });
      return fs.createReadStream(p).pipe(res);
    }
    p = path.join(DOCS, rel);
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

  const photoDir = arg('photos', '');
  // 기사 사진은 주소가 아니라 **우리 서버 경로**로 넘긴다(같은 출처 규칙).
  (data.items || []).forEach(it => { if (it.photo) it.photo = '/사진/' + it.photo; });
  const srv = await serve(photoDir);
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

    // 🔴 장을 하나씩 열어 준다. 안 열면 **뒷장이 앞 장의 복사본으로 나온다**(실측).
    // 뒷장은 outro.js 가 그리는데, 그 설정·그림은 그 장을 한 번 열어야 실린다.
    // 사람이 띠에서 장을 눌러 보는 것과 같은 일 - stageItems() 는 그 뒤라야 제 그림을 준다.
    for (let i = 0; i < want; i++) {
      await page.evaluate(n => window.DECK.activate(n), i);
      await new Promise(r => setTimeout(r, 400));
    }
    await page.evaluate(() => window.DECK.activate(0));
    await new Promise(r => setTimeout(r, 400));

    // 두 벌을 낸다.
    //  - jpg : 인스타·스레드가 JPEG 만 받는다(그림 주소로 넘길 것).
    //  - png : 사람이 내려받아 쓰는 원본(앱의 「저장」과 같은 꼴).
    if (process.env.CARD_DEBUG) {
      console.log(JSON.stringify(await page.evaluate(() => DECK.pages().map(
        p => ({ tpl: p.tpl, src: p.S && p.S.bg && p.S.bg.src, img: !!p.bgImg })))));
    }
    const shots = await page.evaluate(async (q) => {
      const items = DECK.stageItems();
      const kinds = DECK.pages().map(p => p.tpl);
      return items.map((it, i) => ({
        name: it.name, kind: kinds[i] || 'point',
        jpg: it.canvas.toDataURL('image/jpeg', q),
        png: it.canvas.toDataURL('image/png'),
      }));
    }, quality);

    const KIND_KO = { cover: '표지', outro: '뒷장' };
    const list = [];
    let 뉴스번호 = 0;
    shots.forEach((s, i) => {
      const no = String(i + 1).padStart(2, '0');
      const 것 = KIND_KO[s.kind] || ('뉴스 ' + String(++뉴스번호).padStart(2, '0'));
      const row = { no: i + 1, kind: s.kind, label: 것 };
      [['jpg', 'image/jpeg'], ['png', 'image/png']].forEach(([ext, mime]) => {
        const buf = Buffer.from(s[ext].slice(('data:' + mime + ';base64,').length), 'base64');
        fs.writeFileSync(path.join(outDir, no + '.' + ext), buf);
        row[ext] = no + '.' + ext;
        row[ext + 'Bytes'] = buf.length;
      });
      list.push(row);
      console.log('  · ' + no + ' ' + 것 +
        ' (jpg ' + Math.round(row.jpgBytes / 1024) + 'KB / png ' + Math.round(row.pngBytes / 1024) + 'KB)');
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
