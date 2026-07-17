/* 공개 데모(demo 원격) 배포 스크립트
 *
 * git worktree(.demo-worktree/)를 사용해 배포 작업을 완전히 격리합니다.
 * → main 작업 디렉토리의 파일(images/, slides.json 등)은 절대 건드리지 않습니다.
 * → 어떤 프로젝트를 공개할지 매번 직접 선택해야 하며, 최종 게시 전 한 번 더 확인합니다.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = __dirname;
const WORKTREE_DIR = path.join(ROOT, '.demo-worktree');
const MANIFEST_PATH = path.join(ROOT, 'slides.json');
const DEMO_URL = 'https://leehee4343.github.io/slide-viewer-demo/';

function run(cmd, cwd) {
  execSync(cmd, { cwd: cwd || ROOT, stdio: 'inherit' });
}
function runCapture(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || ROOT }).toString().trim();
}
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

function regenerateStaticContent(manifest) {
  return `// 자동 생성 파일 — 서버 없이 index.html을 직접 열었을 때 표시되는 슬라이드 목록입니다. 직접 수정하지 마세요.
// 이미지를 추가·순서변경하려면 '프로그램 시작.bat'으로 편집 서버를 켠 뒤 브라우저에서 사용하세요.
window.STATIC_PROJECT_DATA = ${JSON.stringify(manifest, null, 2)};
`;
}

async function main() {
  console.log('=== 공개 데모 배포 스크립트 ===\n');

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('slides.json이 없습니다. 먼저 로컬 서버("프로그램 시작.bat")로 슬라이드를 준비해주세요.');
    process.exit(1);
  }

  const dirty = runCapture('git status --porcelain -- . ":(exclude).demo-worktree"');
  if (dirty) {
    console.error('main 브랜치에 커밋되지 않은 변경사항이 있습니다. 먼저 정리한 뒤 다시 실행해주세요.');
    process.exit(1);
  }

  if (!fs.existsSync(WORKTREE_DIR)) {
    console.log('격리된 배포 작업공간(.demo-worktree)을 새로 만듭니다...');
    run(`git worktree add "${WORKTREE_DIR}" demo-deploy`);
  } else {
    console.log('기존 배포 작업공간(.demo-worktree)을 재사용합니다.');
  }

  console.log('\nmain의 최신 코드 변경사항을 배포 브랜치에 반영합니다...');
  try {
    run('git merge main -m "sync: main 코드 변경사항 반영"', WORKTREE_DIR);
  } catch (e) {
    console.error('\nmerge 충돌이 발생했습니다. .demo-worktree 폴더에서 직접 해결한 뒤 다시 실행해주세요.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  console.log('\n로컬에 존재하는 프로젝트 목록:');
  manifest.projects.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.name}  (id: ${p.id}, ${p.slides.length}장)`);
  });

  const answer = await ask('\n공개 데모에 포함할 프로젝트 번호를 콤마로 입력하세요 (예: 1,2 / all=전체 / 빈 값=취소): ');
  if (!answer) { console.log('취소되었습니다.'); process.exit(0); }

  let selected;
  if (answer.trim().toLowerCase() === 'all') {
    selected = manifest.projects;
  } else {
    const idxs = answer.split(',').map((s) => parseInt(s.trim(), 10) - 1);
    selected = idxs.map((i) => manifest.projects[i]).filter(Boolean);
  }
  if (selected.length === 0) { console.log('선택된 프로젝트가 없어 취소합니다.'); process.exit(0); }

  console.log('\n선택됨: ' + selected.map((p) => `${p.name}(${p.slides.length}장)`).join(', '));

  const wtImages = path.join(WORKTREE_DIR, 'images');
  fs.rmSync(wtImages, { recursive: true, force: true });
  fs.mkdirSync(wtImages, { recursive: true });

  selected.forEach((p) => {
    p.slides.forEach((s) => {
      const src = path.join(ROOT, s.file);
      const dst = path.join(WORKTREE_DIR, s.file);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    });
  });

  const deployManifest = { currentProjectId: selected[0].id, projects: selected };
  fs.writeFileSync(path.join(WORKTREE_DIR, 'slides.json'), JSON.stringify(deployManifest, null, 2), 'utf-8');
  fs.writeFileSync(path.join(WORKTREE_DIR, 'slides-data.js'), regenerateStaticContent(deployManifest), 'utf-8');

  run('git add -f images/ slides.json slides-data.js', WORKTREE_DIR);
  console.log('\n--- 변경 요약 (.demo-worktree 기준) ---');
  run('git status --short', WORKTREE_DIR);

  const confirm = await ask('\n위 내용을 공개 데모 사이트에 실제로 게시할까요? ("yes" 입력 시에만 진행): ');
  if (confirm !== 'yes') {
    console.log('게시를 취소했습니다. (.demo-worktree의 변경사항은 스테이징된 채로 남아있습니다)');
    process.exit(0);
  }

  const today = new Date().toISOString().slice(0, 10);
  run(`git commit -m "deploy: ${today} 슬라이드 데이터 배포"`, WORKTREE_DIR);
  run('git push demo demo-deploy:main', WORKTREE_DIR);
  console.log(`\n✅ 공개 데모 배포 완료: ${DEMO_URL}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
