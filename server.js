/* 슬라이드 뷰어 로컬 편집 서버
 * - 정적 파일(index.html, app.js, style.css, images/) 서빙
 * - /api/slides 로 업로드된 이미지를 images/ 폴더에 실제 파일로 저장
 * - slides.json(순서/이름 메타데이터)과 slides-data.js(정적 폴백 데이터)를 매 변경마다 갱신
 *   → 서버 없이 index.html만 열어도(파일 공유 시) 마지막 상태가 그대로 보임
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, 'images');
const MANIFEST_PATH = path.join(ROOT, 'slides.json');
const STATIC_DATA_PATH = path.join(ROOT, 'slides-data.js');
const PORT = 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function ensureSetup() {
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR);
  if (!fs.existsSync(MANIFEST_PATH)) fs.writeFileSync(MANIFEST_PATH, '[]', 'utf-8');
  if (!fs.existsSync(STATIC_DATA_PATH)) regenerateStaticData();
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function writeManifest(list) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(list, null, 2), 'utf-8');
}

function regenerateStaticData() {
  const list = readManifest().sort((a, b) => a.order - b.order);
  const content = `// 자동 생성 파일 — 서버 없이 index.html을 직접 열었을 때 표시되는 슬라이드 목록입니다. 직접 수정하지 마세요.\n// 이미지를 추가·순서변경하려면 '프로그램 시작.bat'으로 편집 서버를 켠 뒤 브라우저에서 사용하세요.\nwindow.STATIC_SLIDES = ${JSON.stringify(list, null, 2)};\n`;
  fs.writeFileSync(STATIC_DATA_PATH, content, 'utf-8');
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeExt(ext) {
  const e = (ext || '').toLowerCase();
  return /^\.(png|jpe?g|gif|webp)$/.test(e) ? e : '.png';
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(u.pathname);

  try {
    if (pathname === '/api/slides' && req.method === 'GET') {
      return sendJSON(res, 200, readManifest().sort((a, b) => a.order - b.order));
    }

    if (pathname === '/api/slides' && req.method === 'POST') {
      const buf = await readBody(req);
      const name = u.searchParams.get('name') || '이름없음';
      const ext = safeExt(u.searchParams.get('ext'));
      const id = makeId();
      const filename = `${id}${ext}`;
      fs.writeFileSync(path.join(IMAGES_DIR, filename), buf);
      const list = readManifest();
      const slide = { id, name, file: `images/${filename}`, order: list.length };
      list.push(slide);
      writeManifest(list);
      regenerateStaticData();
      return sendJSON(res, 200, slide);
    }

    if (pathname === '/api/slides' && req.method === 'DELETE') {
      const list = readManifest();
      list.forEach((s) => {
        const imgPath = path.join(ROOT, s.file);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      });
      writeManifest([]);
      regenerateStaticData();
      return sendJSON(res, 200, { ok: true, deleted: list.length });
    }

    if (pathname === '/api/slides/reorder' && req.method === 'PUT') {
      const buf = await readBody(req);
      const pairs = JSON.parse(buf.toString('utf-8'));
      const list = readManifest();
      pairs.forEach(({ id, order }) => {
        const s = list.find((x) => x.id === id);
        if (s) s.order = order;
      });
      writeManifest(list);
      regenerateStaticData();
      return sendJSON(res, 200, { ok: true });
    }

    // ---- 정적 파일 서빙 ----
    const reqPath = pathname === '/' ? '/index.html' : pathname;
    const full = path.join(ROOT, reqPath);
    if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
});

ensureSetup();
server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`슬라이드 뷰어 편집 서버 실행 중: ${url}`);
  console.log('이 창을 닫으면 서버가 종료됩니다. (편집 기능만 서버가 필요하며, 보기는 index.html을 직접 열어도 됩니다)');
  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} ${url}`);
});
