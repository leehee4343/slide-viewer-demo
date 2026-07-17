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
  
  let manifest = null;
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        // 기존 단일 프로젝트 데이터를 멀티 프로젝트 구조로 마이그레이션
        manifest = {
          currentProjectId: "default",
          projects: [
            {
              id: "default",
              name: "기본 프로젝트",
              slides: data
            }
          ]
        };
        writeManifest(manifest);
        console.log("기존 slides.json 데이터를 멀티 프로젝트 구조로 마이그레이션했습니다.");
      } else {
        manifest = data;
      }
    } catch (e) {
      console.error("slides.json 파싱 오류로 초기화합니다:", e);
    }
  }
  
  if (!manifest) {
    manifest = {
      currentProjectId: "default",
      projects: [
        {
          id: "default",
          name: "기본 프로젝트",
          slides: []
        }
      ]
    };
    writeManifest(manifest);
  }
  
  regenerateStaticData();
}

function readManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return {
        currentProjectId: "default",
        projects: [{ id: "default", name: "기본 프로젝트", slides: data }]
      };
    }
    return data;
  } catch {
    return {
      currentProjectId: "default",
      projects: [{ id: "default", name: "기본 프로젝트", slides: [] }]
    };
  }
}

function writeManifest(data) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// 순수 함수로 분리 — deploy-demo.js가 .demo-worktree 등 다른 경로에 대해서도
// 동일한 포맷을 재사용할 수 있도록 경로 의존성 없이 문자열만 생성합니다.
function buildStaticDataFileContent(manifest) {
  return `// 자동 생성 파일 — 서버 없이 index.html을 직접 열었을 때 표시되는 슬라이드 목록입니다. 직접 수정하지 마세요.\n// 이미지를 추가·순서변경하려면 '프로그램 시작.bat'으로 편집 서버를 켠 뒤 브라우저에서 사용하세요.\nwindow.STATIC_PROJECT_DATA = ${JSON.stringify(manifest, null, 2)};\n`;
}

function regenerateStaticData() {
  const manifest = readManifest();
  fs.writeFileSync(STATIC_DATA_PATH, buildStaticDataFileContent(manifest), 'utf-8');
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function verifyPassword(req, res) {
  const pw = req.headers['x-password'];
  if (pw !== '4343') {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'unauthorized', message: '비밀번호가 올바르지 않습니다.' }));
    return false;
  }
  return true;
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
    // ---- 프로젝트 관리 API ----
    if (pathname === '/api/projects' && req.method === 'GET') {
      return sendJSON(res, 200, readManifest());
    }

    if (pathname === '/api/projects' && req.method === 'POST') {
      if (!verifyPassword(req, res)) return;
      const name = u.searchParams.get('name') || '새 프로젝트';
      const id = makeId();
      
      // 물리 디렉토리 생성
      const projDir = path.join(IMAGES_DIR, id);
      if (!fs.existsSync(projDir)) fs.mkdirSync(projDir);
      
      const manifest = readManifest();
      const newProj = { id, name, slides: [] };
      manifest.projects.push(newProj);
      manifest.currentProjectId = id;
      
      writeManifest(manifest);
      regenerateStaticData();
      return sendJSON(res, 200, { ok: true, project: newProj, currentProjectId: id });
    }

    if (pathname === '/api/projects' && req.method === 'DELETE') {
      if (!verifyPassword(req, res)) return;
      const projectId = u.searchParams.get('projectId');
      if (!projectId) { res.writeHead(400); return res.end('missing projectId'); }
      
      const manifest = readManifest();
      const idx = manifest.projects.findIndex(p => p.id === projectId);
      if (idx === -1) { res.writeHead(404); return res.end('project not found'); }
      
      const targetProj = manifest.projects[idx];
      
      // 1. 해당 프로젝트 슬라이드들의 이미지 물리 파일들 삭제
      targetProj.slides.forEach(s => {
        const imgPath = path.join(ROOT, s.file);
        if (fs.existsSync(imgPath)) {
          try { fs.unlinkSync(imgPath); } catch(e) {}
        }
      });
      
      // 2. 프로젝트 전용 물리 디렉토리 삭제 (있다면)
      const projDir = path.join(IMAGES_DIR, projectId);
      if (fs.existsSync(projDir)) {
        try { fs.rmSync(projDir, { recursive: true, force: true }); } catch(e) {}
      }
      
      // 3. manifest 배열에서 삭제
      manifest.projects.splice(idx, 1);
      
      // 4. 활성 프로젝트 ID 갱신
      if (manifest.currentProjectId === projectId) {
        if (manifest.projects.length > 0) {
          manifest.currentProjectId = manifest.projects[0].id;
        } else {
          // 프로젝트가 아예 없으면 기본 프로젝트 강제 생성
          const defaultProj = { id: "default", name: "기본 프로젝트", slides: [] };
          manifest.projects.push(defaultProj);
          manifest.currentProjectId = "default";
        }
      }
      
      writeManifest(manifest);
      regenerateStaticData();
      return sendJSON(res, 200, { ok: true, currentProjectId: manifest.currentProjectId });
    }

    if (pathname === '/api/projects/active' && req.method === 'PUT') {
      const projectId = u.searchParams.get('projectId');
      if (!projectId) { res.writeHead(400); return res.end('missing projectId'); }
      
      const manifest = readManifest();
      const proj = manifest.projects.find(p => p.id === projectId);
      if (!proj) return sendJSON(res, 404, { error: 'project not found' });
      
      manifest.currentProjectId = projectId;
      
      writeManifest(manifest);
      regenerateStaticData();
      return sendJSON(res, 200, { ok: true, currentProjectId: projectId });
    }

    if (pathname === '/api/projects/rename' && req.method === 'PUT') {
      if (!verifyPassword(req, res)) return;
      const projectId = u.searchParams.get('projectId');
      const newName = u.searchParams.get('name');
      if (!projectId || !newName) { res.writeHead(400); return res.end('missing parameter'); }
      
      const manifest = readManifest();
      const proj = manifest.projects.find(p => p.id === projectId);
      if (!proj) return sendJSON(res, 404, { error: 'project not found' });
      
      proj.name = newName;
      
      writeManifest(manifest);
      regenerateStaticData();
      return sendJSON(res, 200, { ok: true, project: proj });
    }

    // ---- 슬라이드 API ----
    if (pathname === '/api/slides' && req.method === 'GET') {
      const manifest = readManifest();
      const projectId = u.searchParams.get('projectId') || manifest.currentProjectId;
      const proj = manifest.projects.find(p => p.id === projectId);
      if (!proj) return sendJSON(res, 404, { error: 'project not found' });
      return sendJSON(res, 200, proj.slides.sort((a, b) => a.order - b.order));
    }

    if (pathname === '/api/slides' && req.method === 'POST') {
      if (!verifyPassword(req, res)) return;
      const manifest = readManifest();
      const projectId = u.searchParams.get('projectId') || manifest.currentProjectId;
      const proj = manifest.projects.find(p => p.id === projectId);
      if (!proj) return sendJSON(res, 404, { error: 'project not found' });

      const buf = await readBody(req);
      const name = u.searchParams.get('name') || '이름없음';
      const ext = safeExt(u.searchParams.get('ext'));
      const id = makeId();
      const filename = `${id}${ext}`;
      
      let saveDir = IMAGES_DIR;
      let relativeFilePath = `images/${filename}`;
      if (projectId !== 'default') {
        saveDir = path.join(IMAGES_DIR, projectId);
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir);
        relativeFilePath = `images/${projectId}/${filename}`;
      }
      
      fs.writeFileSync(path.join(saveDir, filename), buf);
      
      const slide = { id, name, file: relativeFilePath, order: proj.slides.length };
      proj.slides.push(slide);
      
      writeManifest(manifest);
      regenerateStaticData();
      return sendJSON(res, 200, slide);
    }

    if (pathname === '/api/slides' && req.method === 'DELETE') {
      if (!verifyPassword(req, res)) return;
      const manifest = readManifest();
      const projectId = u.searchParams.get('projectId') || manifest.currentProjectId;
      const proj = manifest.projects.find(p => p.id === projectId);
      if (!proj) return sendJSON(res, 404, { error: 'project not found' });
      
      proj.slides.forEach((s) => {
        const imgPath = path.join(ROOT, s.file);
        if (fs.existsSync(imgPath)) {
          try { fs.unlinkSync(imgPath); } catch(e) {}
        }
      });
      
      const deletedCount = proj.slides.length;
      proj.slides = [];
      
      writeManifest(manifest);
      regenerateStaticData();
      return sendJSON(res, 200, { ok: true, deleted: deletedCount });
    }

    if (pathname === '/api/slides/delete' && req.method === 'DELETE') {
      if (!verifyPassword(req, res)) return;
      const manifest = readManifest();
      const projectId = u.searchParams.get('projectId') || manifest.currentProjectId;
      const slideId = u.searchParams.get('slideId');
      if (!slideId) { res.writeHead(400); return res.end('missing slideId'); }

      const proj = manifest.projects.find(p => p.id === projectId);
      if (!proj) return sendJSON(res, 404, { error: 'project not found' });

      const idx = proj.slides.findIndex(s => s.id === slideId);
      if (idx === -1) return sendJSON(res, 404, { error: 'slide not found' });

      const slide = proj.slides[idx];
      // 1. 물리 파일 삭제
      const imgPath = path.join(ROOT, slide.file);
      if (fs.existsSync(imgPath)) {
        try { fs.unlinkSync(imgPath); } catch(e) {}
      }

      // 2. 배열에서 제거
      proj.slides.splice(idx, 1);

      // 3. order 재배열
      proj.slides.sort((a, b) => a.order - b.order).forEach((s, i) => {
        s.order = i;
      });

      writeManifest(manifest);
      regenerateStaticData();
      return sendJSON(res, 200, { ok: true });
    }


    if (pathname === '/api/slides/reorder' && req.method === 'PUT') {
      if (!verifyPassword(req, res)) return;
      const manifest = readManifest();
      const projectId = u.searchParams.get('projectId') || manifest.currentProjectId;
      const proj = manifest.projects.find(p => p.id === projectId);
      if (!proj) return sendJSON(res, 404, { error: 'project not found' });

      const buf = await readBody(req);
      const pairs = JSON.parse(buf.toString('utf-8'));
      
      pairs.forEach(({ id, order }) => {
        const s = proj.slides.find((x) => x.id === id);
        if (s) s.order = order;
      });
      
      writeManifest(manifest);
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

// deploy-demo.js 등 다른 스크립트가 require()로 함수만 가져다 쓸 때는
// 서버를 자동으로 띄우지 않도록 직접 실행(node server.js)한 경우에만 시작합니다.
if (require.main === module) {
  ensureSetup();
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}/`;
    console.log(`슬라이드 뷰어 편집 서버 실행 중: ${url}`);
    console.log('이 창을 닫으면 서버가 종료됩니다. (편집 기능만 서버가 필요하며, 보기는 index.html을 직접 열어도 됩니다)');
    const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${opener} ${url}`);
  });
}

module.exports = { buildStaticDataFileContent, readManifest, writeManifest };
