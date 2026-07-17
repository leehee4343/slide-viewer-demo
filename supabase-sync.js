/* Supabase 실시간 동기화 — 로컬 서버가 "공개(public)"로 표시된 프로젝트의 변경사항을
 * service_role 키로 Supabase에 반영합니다.
 *
 * service_role 키는 RLS(Row Level Security)를 완전히 우회하는 강력한 권한입니다.
 * 그래서 이 키는 절대 app.js(브라우저에 그대로 노출됨)에 두지 않고, 이 로컬 서버
 * 전용 설정 파일에서만 읽습니다:
 *
 *   .supabase-service.json  (이 저장소에 커밋되지 않음 — .gitignore 처리됨)
 *   { "serviceRoleKey": "여기에 Supabase 대시보드 > Settings > API의 service_role 키 붙여넣기" }
 *
 * 이 파일이 없으면 동기화 기능은 조용히 비활성화되고, 로컬 편집 자체는 평소처럼 동작합니다.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://viusyktclcquljfnquwv.supabase.co';
const SERVICE_CONFIG_PATH = path.join(__dirname, '.supabase-service.json');
const BUCKET = 'sv_slides_bucket';

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

let serviceRoleKey = null;
try {
  const cfg = JSON.parse(fs.readFileSync(SERVICE_CONFIG_PATH, 'utf-8'));
  serviceRoleKey = cfg.serviceRoleKey || null;
} catch {
  // 설정 파일이 없거나 읽을 수 없으면 동기화는 비활성 상태로 둡니다.
}

if (serviceRoleKey) {
  console.log('Supabase 동기화 활성화됨 (공개(public) 표시된 프로젝트만 대상)');
} else {
  console.log(`Supabase 동기화 비활성 — ${path.basename(SERVICE_CONFIG_PATH)} 파일이 없습니다. (로컬 편집은 정상 동작)`);
}

function isEnabled() {
  return !!serviceRoleKey;
}

function request(method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const req = https.request(`${SUPABASE_URL}${urlPath}`, {
      method,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...extraHeaders,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(text ? JSON.parse(text) : null);
        } else {
          reject(new Error(`Supabase ${method} ${urlPath} 실패 (${res.statusCode}): ${text}`));
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function uploadFile(storagePath, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const req = https.request(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': buffer.length,
        'x-upsert': 'true',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Storage 업로드 실패 (${res.statusCode}): ${Buffer.concat(chunks)}`));
      });
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

async function deleteStoragePrefix(prefix) {
  const files = await request('POST', `/storage/v1/object/list/${BUCKET}`, { prefix, limit: 1000 });
  const paths = (files || []).map((f) => `${prefix}${f.name}`);
  if (paths.length > 0) {
    await request('DELETE', `/storage/v1/object/${BUCKET}`, { prefixes: paths });
  }
}

function publicUrlFor(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

// 프로젝트 전체를 Supabase 상태와 맞춥니다: 없는 슬라이드는 업로드, 로컬에서
// 사라진 슬라이드는 삭제, 이름/순서는 갱신. 실패해도 로컬 작업 자체는 이미
// 끝난 뒤이므로, 호출부에서 catch해서 경고만 남기고 넘어가는 걸 전제로 합니다.
async function syncProject(project, rootDir) {
  if (!isEnabled()) return;

  await request('POST', '/rest/v1/sv_projects', [{ id: project.id, name: project.name }], {
    Prefer: 'resolution=merge-duplicates',
  });

  const remoteSlides = await request('GET', `/rest/v1/sv_slides?project_id=eq.${project.id}&select=id`);
  const remoteIds = new Set((remoteSlides || []).map((s) => s.id));
  const localIds = new Set(project.slides.map((s) => s.id));

  const toDelete = [...remoteIds].filter((id) => !localIds.has(id));
  if (toDelete.length > 0) {
    await request('DELETE', `/rest/v1/sv_slides?id=in.(${toDelete.join(',')})`);
  }

  for (const slide of project.slides) {
    const storagePath = `${project.id}/${path.basename(slide.file)}`;
    if (!remoteIds.has(slide.id)) {
      const buf = fs.readFileSync(path.join(rootDir, slide.file));
      const ext = path.extname(slide.file).toLowerCase();
      await uploadFile(storagePath, buf, CONTENT_TYPES[ext]);
      await request('POST', '/rest/v1/sv_slides', [{
        id: slide.id, project_id: project.id, name: slide.name,
        file_url: publicUrlFor(storagePath), order: slide.order,
      }], { Prefer: 'resolution=merge-duplicates' });
    } else {
      await request('PATCH', `/rest/v1/sv_slides?id=eq.${slide.id}`, { name: slide.name, order: slide.order });
    }
  }
}

// 프로젝트를 비공개로 전환하거나 로컬에서 삭제했을 때, Supabase 쪽 데이터도 완전히 제거
async function removeProject(projectId) {
  if (!isEnabled()) return;
  await deleteStoragePrefix(`${projectId}/`);
  await request('DELETE', `/rest/v1/sv_slides?project_id=eq.${projectId}`);
  await request('DELETE', `/rest/v1/sv_projects?id=eq.${projectId}`);
}

module.exports = { isEnabled, syncProject, removeProject };
