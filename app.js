/* 슬라이드 뷰어 — 정식 버전 애플리케이션 로직
 * 
 * [데이터 공급 모드]
 * 1. Supabase 모드 (GitHub Pages 등 웹 전체): 클라우드 DB 및 Storage 연동 (localStorage 세팅 시)
 * 2. 로컬 서버 모드 (server.js 실행 중): /api/slides 로 로컬 파일 시스템 저장
 * 3. 정적 오프라인 모드: slides-data.js of STATIC_PROJECT_DATA를 읽는 보기 전용 폴백
 */

// Supabase 기본 연동 설정 (여기에 본인의 URL과 Key를 입력해두면 모든 사용자가 수동 설정 입력 없이 자동으로 연동됩니다)
const DEFAULT_SUPABASE_URL = "https://viusyktclcquljfnquwv.supabase.co";
const DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpdXN5a3RjbGNxdWxqZm5xdXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwOTg1ODcsImV4cCI6MjA5NzY3NDU4N30.JI_xZORgZRGjvoir0wpyrXNkdMWB6fUqfTIJzMzxEJc";



let projects = [];     // [{id, name, slides}]
let currentProjectId = 'default';
let slides = [];       // [{id, name, file, order}]
let current = 0;
let mode = 'slide';
let dragSrcIndex = null;
let serverMode = false; // 편집 가능 상태 여부 (Supabase 혹은 로컬 Node 서버 연결 시 true)

const stage = document.getElementById('stage');
const thumbStrip = document.getElementById('thumbStrip');
const gridGrid = document.getElementById('gridGrid');
const gridCount = document.getElementById('gridCount');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const fileInput = document.getElementById('fileInput');
const addBtn = document.getElementById('addBtn');
const clearAllBtn = document.getElementById('clearAllBtn');


const projectSelect = document.getElementById('projectSelect');
const renameProjBtn = document.getElementById('renameProjBtn');
const addProjBtn = document.getElementById('addProjBtn');
const deleteProjBtn = document.getElementById('deleteProjBtn');

/* ==================== 데이터 제공자 (Data Providers) 정의 ==================== */

// 1. 로컬 Node.js 서버 데이터 제공자
const LocalServerProvider = {
  async getProjects() {
    const res = await fetch('/api/projects', { cache: 'no-store' });
    if (!res.ok) throw new Error('no server');
    return res.json();
  },
  async selectActiveProject(projectId) {
    await fetch(`/api/projects/active?projectId=${projectId}`, { method: 'PUT' });
  },
  async createProject(name) {
    const res = await fetch(`/api/projects?name=${encodeURIComponent(name.trim())}`, { 
      method: 'POST',
      headers: { 'X-Password': sessionStorage.getItem('viewer_pw') || '' }
    });
    if (!res.ok) throw new Error('Failed to create project');
    return res.json();
  },
  async deleteProject(projectId) {
    const res = await fetch(`/api/projects?projectId=${projectId}`, { 
      method: 'DELETE',
      headers: { 'X-Password': sessionStorage.getItem('viewer_pw') || '' }
    });
    if (!res.ok) throw new Error('Failed to delete project');
    return res.json();
  },
  async renameProject(projectId, name) {
    const res = await fetch(`/api/projects/rename?projectId=${projectId}&name=${encodeURIComponent(name.trim())}`, {
      method: 'PUT',
      headers: { 'X-Password': sessionStorage.getItem('viewer_pw') || '' }
    });
    if (!res.ok) throw new Error('Failed to rename project');
    return res.json();
  },
  async getSlides(projectId) {
    const res = await fetch(`/api/slides?projectId=${projectId}`);
    if (!res.ok) throw new Error('Failed to fetch slides');
    return res.json();
  },
  async uploadSlide(projectId, file, name, ext) {
    const qs = new URLSearchParams({ projectId, name, ext });
    const res = await fetch(`/api/slides?${qs.toString()}`, {
      method: 'POST',
      headers: { 
        'Content-Type': file.type || 'application/octet-stream',
        'X-Password': sessionStorage.getItem('viewer_pw') || ''
      },
      body: file,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
  async deleteSlides(projectId) {
    const res = await fetch(`/api/slides?projectId=${projectId}`, { 
      method: 'DELETE',
      headers: { 'X-Password': sessionStorage.getItem('viewer_pw') || '' }
    });
    if (!res.ok) throw new Error('Failed to delete slides');
    return res.json();
  },
  async reorderSlides(projectId, pairs) {
    const res = await fetch(`/api/slides/reorder?projectId=${projectId}`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'X-Password': sessionStorage.getItem('viewer_pw') || ''
      },
      body: JSON.stringify(pairs),
    });
    if (!res.ok) throw new Error('Reorder failed');
    return res.json();
  }
};

// 2. Supabase 클라우드 데이터 제공자
let supabaseClient = null;
const SupabaseProvider = {
  async getProjects() {
    const { data: dbProjects, error } = await supabaseClient
      .from('sv_projects')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    
    let activeId = localStorage.getItem('sb_active_project_id');
    if (!activeId && dbProjects.length > 0) {
      activeId = dbProjects[0].id;
      localStorage.setItem('sb_active_project_id', activeId);
    } else if (dbProjects.length === 0) {
      // 프로젝트가 하나도 없으면 강제 초기 생성
      await supabaseClient.from('sv_projects').insert([{ id: 'default', name: '기본 프로젝트' }]);
      activeId = 'default';
      localStorage.setItem('sb_active_project_id', activeId);
      return this.getProjects(); // 재귀 호출로 다시 정렬된 데이터 반환
    }

    const projectsWithSlides = await Promise.all(dbProjects.map(async p => {
      const { data: dbSlides } = await supabaseClient
        .from('sv_slides')
        .select('*')
        .eq('project_id', p.id)
        .order('order', { ascending: true });
      
      const mappedSlides = (dbSlides || []).map(s => ({
        id: s.id,
        name: s.name,
        file: s.file_url,
        order: s.order
      }));

      return {
        id: p.id,
        name: p.name,
        slides: mappedSlides
      };
    }));

    return {
      currentProjectId: activeId,
      projects: projectsWithSlides
    };
  },
  async selectActiveProject(projectId) {
    localStorage.setItem('sb_active_project_id', projectId);
  },
  async createProject(name) {
    const id = makeId();
    const { error } = await supabaseClient
      .from('sv_projects')
      .insert([{ id, name }]);
    if (error) throw error;
    localStorage.setItem('sb_active_project_id', id);
    return { ok: true, currentProjectId: id };
  },
  async deleteProject(projectId) {
    // 1. 스토리지 파일들 삭제
    try {
      const { data: files } = await supabaseClient.storage
        .from('sv_slides_bucket')
        .list(projectId);
      if (files && files.length > 0) {
        const paths = files.map(f => `${projectId}/${f.name}`);
        await supabaseClient.storage.from('sv_slides_bucket').remove(paths);
      }
    } catch (e) {
      console.warn("Storage clean up failed during project delete:", e);
    }

    // 2. DB 삭제 (Cascade로 slides 도 자동 삭제됨)
    const { error } = await supabaseClient
      .from('sv_projects')
      .delete()
      .eq('id', projectId);
    if (error) throw error;

    // 활성 프로젝트 갱신
    const { data: dbProjects } = await supabaseClient.from('sv_projects').select('id');
    let nextActive = 'default';
    if (dbProjects && dbProjects.length > 0) {
      nextActive = dbProjects[0].id;
    } else {
      await supabaseClient.from('sv_projects').insert([{ id: 'default', name: '기본 프로젝트' }]);
    }
    localStorage.setItem('sb_active_project_id', nextActive);
    
    return { ok: true, currentProjectId: nextActive };
  },
  async renameProject(projectId, name) {
    const { error } = await supabaseClient
      .from('sv_projects')
      .update({ name })
      .eq('id', projectId);
    if (error) throw error;
    return { ok: true };
  },
  async getSlides(projectId) {
    const { data, error } = await supabaseClient
      .from('sv_slides')
      .select('*')
      .eq('project_id', projectId)
      .order('order', { ascending: true });
    if (error) throw error;
    
    return data.map(s => ({
      id: s.id,
      name: s.name,
      file: s.file_url,
      order: s.order
    }));
  },
  async uploadSlide(projectId, file, name, ext) {
    const id = makeId();
    const filename = `${id}${ext}`;
    const filePath = `${projectId}/${filename}`;

    // 1. Storage 버킷 'sv_slides_bucket'에 업로드
    const { error: uploadError } = await supabaseClient.storage
      .from('sv_slides_bucket')
      .upload(filePath, file, {
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
        upsert: false
      });
    if (uploadError) throw uploadError;

    // 2. Public URL 획득
    const { data: { publicUrl } } = supabaseClient.storage
      .from('sv_slides_bucket')
      .getPublicUrl(filePath);

    // 3. order 순서 결정을 위한 갯수 계산
    const { data: existingSlides } = await supabaseClient
      .from('sv_slides')
      .select('id')
      .eq('project_id', projectId);
    const nextOrder = existingSlides ? existingSlides.length : 0;

    // 4. 데이터베이스 Insert
    const { error: dbError } = await supabaseClient
      .from('sv_slides')
      .insert([{
        id,
        project_id: projectId,
        name,
        file_url: publicUrl,
        order: nextOrder
      }]);
    if (dbError) throw dbError;

    return { id, name, file: publicUrl, order: nextOrder };
  },
  async deleteSlides(projectId) {
    // 1. Storage 버킷 내 프로젝트 폴더 지우기
    try {
      const { data: files } = await supabaseClient.storage.from('sv_slides_bucket').list(projectId);
      if (files && files.length > 0) {
        const paths = files.map(f => `${projectId}/${f.name}`);
        await supabaseClient.storage.from('sv_slides_bucket').remove(paths);
      }
    } catch (e) {
      console.warn("Storage files delete failed during clearAll:", e);
    }

    // 2. DB slides 삭제
    const { error } = await supabaseClient
      .from('sv_slides')
      .delete()
      .eq('project_id', projectId);
    if (error) throw error;

    return { ok: true, deleted: 1 };
  },
  async reorderSlides(projectId, pairs) {
    const promises = pairs.map(({ id, order }) => 
      supabaseClient
        .from('sv_slides')
        .update({ order })
        .eq('id', id)
        .eq('project_id', projectId)
    );
    const results = await Promise.all(promises);
    const err = results.find(r => r.error);
    if (err) throw err.error;
    return { ok: true };
  }
};

// 3. 정적 보기 전용 오프라인 데이터 제공자
const StaticDataProvider = {
  getProjects() {
    const staticData = window.STATIC_PROJECT_DATA || {
      currentProjectId: "default",
      projects: [{ id: "default", name: "기본 프로젝트", slides: [] }]
    };
    if (window.STATIC_SLIDES && !window.STATIC_PROJECT_DATA) {
      staticData.projects[0].slides = window.STATIC_SLIDES;
    }
    return staticData;
  },
  async selectActiveProject(projectId) {},
  async createProject() { throw new Error('오프라인 보기 전용 모드에서는 생성할 수 없습니다.'); },
  async deleteProject() { throw new Error('오프라인 보기 전용 모드에서는 삭제할 수 없습니다.'); },
  async renameProject() { throw new Error('오프라인 보기 전용 모드에서는 변경할 수 없습니다.'); },
  async getSlides(projectId) {
    const curProj = this.getProjects().projects.find(p => p.id === projectId);
    return curProj ? curProj.slides.slice().sort((a, b) => a.order - b.order) : [];
  },
  async uploadSlide() { throw new Error('오프라인 보기 전용 모드에서는 업로드할 수 없습니다.'); },
  async deleteSlides() { throw new Error('오프라인 보기 전용 모드에서는 삭제할 수 없습니다.'); },
  async reorderSlides() { throw new Error('오프라인 보기 전용 모드에서는 정렬할 수 없습니다.'); }
};

// 기본 동작 제공자 매핑 (추후 init에서 결정됨)
let db = StaticDataProvider;

/* ------------ 유틸리티 ------------ */
async function checkPassword() {
  let pw = sessionStorage.getItem('viewer_pw');
  if (pw === '4343') return true;
  
  pw = prompt("비밀번호를 입력하세요 (편집 권한):");
  if (pw === '4343') {
    sessionStorage.setItem('viewer_pw', '4343');
    return true;
  }
  if (pw !== null) alert("비밀번호가 올바르지 않습니다.");
  return false;
}

function updateUrlParameter(projectId) {
  const newUrl = new URL(location.href);
  if (newUrl.searchParams.get('project') !== projectId) {
    newUrl.searchParams.set('project', projectId);
    history.pushState({ projectId }, '', newUrl.toString());
  }
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ------------ 초기화 ------------ */
async function init() {
  const sbUrl = localStorage.getItem('supabase_url') || DEFAULT_SUPABASE_URL;
  const sbKey = localStorage.getItem('supabase_key') || DEFAULT_SUPABASE_KEY;


  if (sbUrl && sbKey && window.supabase) {
    // 1. Supabase 모드로 실행
    try {
      supabaseClient = window.supabase.createClient(sbUrl, sbKey);
      db = SupabaseProvider;
      const data = await db.getProjects();
      projects = data.projects;
      currentProjectId = data.currentProjectId;
      serverMode = true;
      console.log("Supabase DB 및 스토리지 연동 완료");
    } catch (e) {
      console.error("Supabase 연결 실패 -> 정적 폴백:", e);
      initStaticMode();
    }
  } else {
    // 2. 로컬 Node.js 서버 감지 실행
    try {
      db = LocalServerProvider;
      const data = await db.getProjects();
      projects = data.projects;
      currentProjectId = data.currentProjectId;
      serverMode = true;
      console.log("로컬 편집 서버 연동 완료");
    } catch (e) {
      // 3. 정적 보기 전용 모드 폴백
      initStaticMode();
    }
  }

  const urlParams = new URLSearchParams(location.search);
  const urlProjectId = urlParams.get('project');
  if (urlProjectId && projects.some(p => p.id === urlProjectId)) {
    currentProjectId = urlProjectId;
  } else {
    updateUrlParameter(currentProjectId);
  }

  if (!serverMode) {
    addBtn.classList.add('hidden');
    clearAllBtn.classList.add('hidden');
    if (renameProjBtn) renameProjBtn.classList.add('hidden');
    if (addProjBtn) addProjBtn.classList.add('hidden');
    if (deleteProjBtn) deleteProjBtn.classList.add('hidden');
  } else {
    addBtn.classList.remove('hidden');
    clearAllBtn.classList.remove('hidden');
    if (renameProjBtn) renameProjBtn.classList.remove('hidden');
    if (addProjBtn) addProjBtn.classList.remove('hidden');
    if (deleteProjBtn) deleteProjBtn.classList.remove('hidden');
  }

  renderProjectSelect();
  loadCurrentProjectSlides();
  bindEvents();
}

function initStaticMode() {
  db = StaticDataProvider;
  const staticData = db.getProjects();
  projects = staticData.projects;
  currentProjectId = staticData.currentProjectId;
  serverMode = false;
}

function renderProjectSelect() {
  if (!projectSelect) return;
  projectSelect.innerHTML = projects.map(p => {
    if (!p) return '';
    const name = p.name || '이름없음';
    const id = p.id || '';
    return `<option value="${id}">${name}</option>`;
  }).join('');
  projectSelect.value = currentProjectId;
}

function loadCurrentProjectSlides() {
  const curProj = projects.find(p => p.id === currentProjectId);
  slides = curProj ? curProj.slides.slice().sort((a, b) => a.order - b.order) : [];
  current = 0;
  renderAll();
}

async function onProjectChange(projectId) {
  currentProjectId = projectId;
  updateUrlParameter(projectId);
  if (serverMode) {
    try {
      await db.selectActiveProject(projectId);
    } catch (e) {
      console.error('Failed to save active project status', e);
    }
  }
  loadCurrentProjectSlides();
}

async function createNewProject() {
  if (!serverMode) return;
  const ok = await checkPassword();
  if (!ok) return;
  const name = prompt("새 프로젝트 이름을 입력하세요:");
  if (!name || !name.trim()) return;
  
  try {
    const data = await db.createProject(name);
    
    // 갱신
    const manifest = await db.getProjects();
    projects = manifest.projects;
    currentProjectId = data.currentProjectId;
    
    renderProjectSelect();
    updateUrlParameter(currentProjectId);
    loadCurrentProjectSlides();
  } catch (e) {
    alert('프로젝트 생성 실패: ' + e.message);
  }
}

async function deleteCurrentProject() {
  if (!serverMode) return;
  const ok = await checkPassword();
  if (!ok) return;
  const curProj = projects.find(p => p.id === currentProjectId);
  if (!curProj) return;
  
  if (projects.length <= 1) {
    alert('최소 1개의 프로젝트는 유지해야 하므로 삭제할 수 없습니다.');
    return;
  }
  
  if (!confirm(`현재 프로젝트 '${curProj.name}'을(를) 삭제하시겠습니까?\n이 프로젝트의 모든 슬라이드 이미지 파일도 삭제됩니다.`)) return;
  
  try {
    const data = await db.deleteProject(currentProjectId);
    
    // 갱신
    const manifest = await db.getProjects();
    projects = manifest.projects;
    currentProjectId = data.currentProjectId;
    
    renderProjectSelect();
    updateUrlParameter(currentProjectId);
    loadCurrentProjectSlides();
  } catch (e) {
    alert('프로젝트 삭제 실패: ' + e.message);
  }
}

async function renameCurrentProject() {
  if (!serverMode) return;
  const ok = await checkPassword();
  if (!ok) return;
  const curProj = projects.find(p => p.id === currentProjectId);
  if (!curProj) return;
  
  const newName = prompt("변경할 프로젝트 이름을 입력하세요:", curProj.name);
  if (!newName || !newName.trim() || newName.trim() === curProj.name) return;
  
  try {
    await db.renameProject(currentProjectId, newName);
    
    // 갱신
    const manifest = await db.getProjects();
    projects = manifest.projects;
    
    renderProjectSelect();
  } catch (e) {
    alert('이름 수정 실패: ' + e.message);
  }
}

/* ------------ 렌더링 ------------ */
function emptyMessage() {
  return serverMode
    ? `<b>표시할 슬라이드가 없습니다</b><span>우측 상단 '이미지 추가' 버튼으로 이미지를 업로드해 주세요</span>`
    : `<b>표시할 슬라이드가 없습니다</b><span>보기 전용 모드입니다</span>`;
}

function renderStage() {
  if (slides.length === 0) {
    stage.innerHTML = `
      <div class="empty">
        <svg class="ic" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.6" stroke="currentColor" stroke-width="1.6"/><path d="M5 16l4.5-4.5L12 14l3-3.5L19 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        ${emptyMessage()}
      </div>`;
    prevBtn.classList.add('disabled');
    nextBtn.classList.add('disabled');
    return;
  }
  if (current > slides.length - 1) current = slides.length - 1;
  if (current < 0) current = 0;
  const s = slides[current];
  const isFS = !!(document.fullscreenElement || document.getElementById('slideMode').classList.contains('fallback-fullscreen'));
  const fsTitle = isFS ? '전체화면 종료 (Esc)' : '전체화면으로 보기';
  const fsIcon = isFS
    ? `<svg viewBox="0 0 24 24" fill="none"><path d="M4 14h6v6m0-6-6 6m16-6h-6v6m0-6 6 6M4 10h6V4m0 6-6-6m16 6h-6V4m0 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none"><path d="M8 3H5a2 2 0 0 0-2 2v3m0 8v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3m0-8V5a2 2 0 0 0-2-2h-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  stage.innerHTML = `
    <div class="counter-tag">${String(current + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}</div>
    <div class="stage-actions">
      <button class="stage-btn" onclick="toggleFullscreen()" title="${fsTitle}">
        ${fsIcon}
      </button>
      <button class="stage-btn" onclick="downloadCurrentSlide()" title="이미지 다운로드">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="stage-btn" onclick="openCurrentSlideNewWindow()" title="새 창으로 크게 보기">
        <svg viewBox="0 0 24 24" fill="none"><path d="M14 4h6v6M10 14 20 4M6 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <img src="${s.file}" alt="${s.name}">
  `;
  prevBtn.classList.toggle('disabled', current === 0);
  nextBtn.classList.toggle('disabled', current === slides.length - 1);
}

function renderThumbs() {
  let html = '';
  slides.forEach((s, i) => {
    html += `<div class="thumb ${i === current ? 'on' : ''}" onclick="jump(${i})">
      <img src="${s.file}" alt="${s.name}">
      <div class="thumb-num">${i + 1}</div>
    </div>`;
  });
  thumbStrip.innerHTML = html;
  const onEl = thumbStrip.querySelector('.thumb.on');
  if (onEl) onEl.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function toggleThumbStrip() {
  const collapsed = thumbStrip.classList.toggle('collapsed');
  document.getElementById('thumbToggle').classList.toggle('collapsed', collapsed);
}

function toggleHeader() {
  const collapsed = document.getElementById('hdr').classList.toggle('collapsed');
  document.getElementById('hdrToggle').classList.toggle('collapsed', collapsed);
}

function renderGrid() {
  gridCount.textContent = slides.length + '장';
  if (slides.length === 0) {
    gridGrid.innerHTML = `<div class="grid-empty">${serverMode ? "업로드된 슬라이드가 없습니다. 상단 '이미지 추가' 버튼을 눌러 이미지를 올려보세요." : '표시할 슬라이드가 없습니다.'}</div>`;
    return;
  }
  let html = '';
  slides.forEach((s, i) => {
    const dragAttrs = serverMode ? `draggable="true"
        ondragstart="onCardDragStart(${i}, event)"
        ondragover="onCardDragOver(${i}, event)"
        ondragleave="onCardDragLeave(${i}, event)"
        ondrop="onCardDrop(${i}, event)"
        ondragend="onCardDragEnd(event)"` : '';
    html += `<div class="gc" ${dragAttrs} onclick="jumpFromGrid(${i})">
      <div class="gimg"><img src="${s.file}" alt="${s.name}"></div>
      <div class="gc-ft">
        <b>${String(i + 1).padStart(2, '0')}. ${s.name}</b>
      </div>
    </div>`;
  });
  gridGrid.innerHTML = html;
}

function renderAll() {
  renderStage();
  renderThumbs();
  renderGrid();
}

/* ------------ 현재 슬라이드 다운로드 / 새 창 보기 ------------ */
function downloadCurrentSlide() {
  const s = slides[current];
  if (!s) return;
  if (location.protocol === 'file:') {
    window.open(s.file, '_blank');
    return;
  }
  const ext = (s.file.match(/\.[^/.]+$/) || [''])[0];
  const a = document.createElement('a');
  a.href = s.file;
  a.download = s.name + ext;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function openCurrentSlideNewWindow() {
  const s = slides[current];
  if (!s) return;
  const absoluteUrl = new URL(s.file, location.href).href;
  const win = window.open('', '_blank');
  if (!win) { alert('팝업이 차단되었습니다. 브라우저의 팝업 차단을 해제해 주세요.'); return; }
  win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(s.name)}</title>
<style>
  *{box-sizing:border-box; margin:0; padding:0;}
  html,body{height:100%; background:#0f2a4a;}
  body{display:flex; align-items:center; justify-content:center; overflow:hidden;}
  img{max-width:100vw; max-height:100vh; object-fit:contain; display:block;}
  .close-btn{
    position:fixed; top:20px; right:20px; width:42px; height:42px; border-radius:50%;
    background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.28); color:#fff;
    display:flex; align-items:center; justify-content:center; cursor:pointer; transition:.15s;
  }
  .close-btn:hover{background:rgba(255,255,255,.28);}
  .close-btn svg{width:18px; height:18px;}
</style>
</head>
<body>
  <img src="${escapeHtml(absoluteUrl)}" alt="${escapeHtml(s.name)}">
  <button class="close-btn" onclick="window.close()" title="닫기">
    <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
  </button>
</body>
</html>`);
  win.document.close();
}

/* ------------ 내비게이션 ------------ */
function go(delta) {
  if (slides.length === 0) return;
  current = Math.min(Math.max(current + delta, 0), slides.length - 1);
  renderStage();
  renderThumbs();
}
function jump(i) {
  current = i;
  renderStage();
  renderThumbs();
}
function jumpFromGrid(i) {
  current = i;
  setMode('slide');
}

function setMode(m) {
  mode = m;
  document.getElementById('slideMode').classList.toggle('hidden', m !== 'slide');
  document.getElementById('gridMode').classList.toggle('hidden', m !== 'grid');
  document.getElementById('segSlide').classList.toggle('on', m === 'slide');
  document.getElementById('segGrid').classList.toggle('on', m === 'grid');
  if (m === 'slide') { renderStage(); renderThumbs(); }
  else { renderGrid(); }
}

async function persistOrder() {
  if (!serverMode) return true;
  const ok = await checkPassword();
  if (!ok) return false;
  const pairs = slides.map((s, i) => ({ id: s.id, order: i }));
  try {
    await db.reorderSlides(currentProjectId, pairs);
    slides.forEach((s, i) => { s.order = i; });
    const curProj = projects.find(p => p.id === currentProjectId);
    if (curProj) curProj.slides = slides;
    return true;
  } catch (e) {
    alert('순서 변경 저장 실패: ' + e.message);
    return false;
  }
}

/* ------------ 전체 삭제 — 실제 파일도 서버에서 모두 삭제 ------------ */
async function clearAllSlides() {
  if (!serverMode) return;
  const ok = await checkPassword();
  if (!ok) return;
  if (slides.length === 0) { alert('삭제할 슬라이드가 없습니다.'); return; }
  if (!confirm(`현재 프로젝트의 전체 슬라이드 ${slides.length}장을 모두 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
  
  try {
    await db.deleteSlides(currentProjectId);
    slides = [];
    current = 0;
    const curProj = projects.find(p => p.id === currentProjectId);
    if (curProj) curProj.slides = [];
    renderAll();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
}

async function triggerAddImages() {
  if (!serverMode) return;
  const ok = await checkPassword();
  if (!ok) return;
  fileInput.click();
}

/* ------------ 파일 업로드 — images/ 폴더 혹은 Supabase Storage 에 저장 ------------ */
async function handleFiles(fileList) {
  if (!serverMode) return;
  const ok = await checkPassword();
  if (!ok) return;
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (files.length === 0) return;
  const startIndex = slides.length;
  try {
    for (const file of files) {
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const ext = (file.name.match(/\.[^/.]+$/) || [''])[0];
      
      const slide = await db.uploadSlide(currentProjectId, file, baseName, ext);
      slides.push(slide);
    }
    const curProj = projects.find(p => p.id === currentProjectId);
    if (curProj) curProj.slides = slides;
    current = startIndex;
    renderAll();
  } catch (e) {
    alert('업로드 실패: ' + e.message);
  }
}

/* ------------ 그리드 드래그 순서 변경 ------------ */
function onCardDragStart(i, e) {
  dragSrcIndex = i;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dragging');
}
function onCardDragOver(i, e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (i !== dragSrcIndex) e.currentTarget.classList.add('drag-over');
}
function onCardDragLeave(i, e) {
  e.currentTarget.classList.remove('drag-over');
}
async function onCardDrop(i, e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (dragSrcIndex === null || dragSrcIndex === i) return;
  
  const backup = slides.slice();
  const [moved] = slides.splice(dragSrcIndex, 1);
  slides.splice(i, 0, moved);
  dragSrcIndex = null;
  
  const success = await persistOrder();
  if (!success) {
    slides = backup;
  }
  renderGrid();
}
function onCardDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.gc.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragSrcIndex = null;
}

/* ------------ 전체화면 토글 ------------ */
async function toggleFullscreen() {
  const elem = document.getElementById('slideMode');
  if (!document.fullscreenElement) {
    try {
      await elem.requestFullscreen();
    } catch (err) {
      console.warn('Fullscreen failed, fallback to CSS:', err);
      elem.classList.add('fallback-fullscreen');
      renderStage();
    }
  } else {
    document.exitFullscreen();
  }
}


/* ------------ 이벤트 바인딩 ------------ */
function bindEvents() {
  window.addEventListener('popstate', (e) => {
    const urlParams = new URLSearchParams(location.search);
    const urlProjectId = urlParams.get('project');
    if (urlProjectId && urlProjectId !== currentProjectId && projects.some(p => p.id === urlProjectId)) {
      currentProjectId = urlProjectId;
      if (projectSelect) projectSelect.value = currentProjectId;
      loadCurrentProjectSlides();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (mode !== 'slide') return;
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'Escape') {
      const elem = document.getElementById('slideMode');
      if (elem.classList.contains('fallback-fullscreen')) {
        elem.classList.remove('fallback-fullscreen');
        renderStage();
      }
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const elem = document.getElementById('slideMode');
    if (!document.fullscreenElement) {
      elem.classList.remove('fallback-fullscreen');
    }
    renderStage();
  });

  if (!serverMode) return; // 보기 전용 모드에서는 업로드/드래그 리스너를 걸지 않음

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = '';
  });

  ['dragover', 'dragenter'].forEach(ev => {
    stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(ev => {
    stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.remove('drag'); });
  });
  stage.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
}

init();
