/* 슬라이드 뷰어 — 정식 버전 애플리케이션 로직
 * 서버 모드(server.js 실행 중): /api/slides 로 실제 파일 업로드/순서변경/전체삭제 (편집 가능)
 * 정적 모드(index.html을 그냥 열었을 때): slides-data.js의 STATIC_SLIDES를 읽어 보기 전용으로 표시
 */

let slides = [];       // [{id, name, file, order}]
let current = 0;
let mode = 'slide';
let dragSrcIndex = null;
let serverMode = false;

const stage = document.getElementById('stage');
const thumbStrip = document.getElementById('thumbStrip');
const gridGrid = document.getElementById('gridGrid');
const gridCount = document.getElementById('gridCount');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const fileInput = document.getElementById('fileInput');
const addBtn = document.getElementById('addBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const viewOnlyBanner = document.getElementById('viewOnlyBanner');

/* ------------ 초기화 ------------ */
async function init() {
  try {
    const res = await fetch('/api/slides', { cache: 'no-store' });
    if (!res.ok) throw new Error('no server');
    slides = (await res.json()).sort((a, b) => a.order - b.order);
    serverMode = true;
  } catch (e) {
    slides = (window.STATIC_SLIDES || []).slice().sort((a, b) => a.order - b.order);
    serverMode = false;
  }
  if (!serverMode) {
    viewOnlyBanner.classList.remove('hidden');
    addBtn.classList.add('hidden');
    clearAllBtn.classList.add('hidden');
  }
  renderAll();
  bindEvents();
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
    // file://에서는 브라우저가 download 속성을 무시하고 현재 탭을 이미지로 이동시켜버리므로,
    // 새 탭으로 열어 앱 화면을 유지하고 사용자가 직접 '다른 이름으로 저장'하도록 한다.
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
  if (!serverMode) return;
  const pairs = slides.map((s, i) => ({ id: s.id, order: i }));
  await fetch('/api/slides/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pairs),
  });
  slides.forEach((s, i) => { s.order = i; });
}

/* ------------ 전체 삭제 — 실제 파일도 서버에서 모두 삭제 ------------ */
async function clearAllSlides() {
  if (!serverMode) return;
  if (slides.length === 0) { alert('삭제할 슬라이드가 없습니다.'); return; }
  if (!confirm(`전체 슬라이드 ${slides.length}장을 모두 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
  await fetch('/api/slides', { method: 'DELETE' });
  slides = [];
  current = 0;
  renderAll();
}

/* ------------ 파일 업로드 (F-01) — images/ 폴더에 실제 파일로 저장 ------------ */
async function handleFiles(fileList) {
  if (!serverMode) return;
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (files.length === 0) return;
  const startIndex = slides.length;
  for (const file of files) {
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const ext = (file.name.match(/\.[^/.]+$/) || [''])[0];
    const qs = new URLSearchParams({ name: baseName, ext });
    const res = await fetch(`/api/slides?${qs.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const slide = await res.json();
    slides.push(slide);
  }
  current = startIndex;
  renderAll();
}

/* ------------ 그리드 드래그 순서 변경 (F-07) ------------ */
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
  const [moved] = slides.splice(dragSrcIndex, 1);
  slides.splice(i, 0, moved);
  dragSrcIndex = null;
  await persistOrder();
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
