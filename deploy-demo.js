/* 공개 데모(demo 원격) 배포 스크립트
 *
 * git worktree(.demo-worktree/)를 사용해 배포 작업을 완전히 격리합니다.
 * → main 작업 디렉토리의 파일(images/, slides.json 등)은 절대 건드리지 않습니다.
 * → 어떤 프로젝트를 공개할지 매번 직접 선택해야 하며, 최종 게시 전 한 번 더 확인합니다.
 *
 * 주의: 한 번 공개했던 프로젝트를 이후 선택 해제해도, 그 이미지는 demo 저장소의
 * git 히스토리에는 계속 남습니다(완전 삭제가 아니라 "이번 배포부터 제외"일 뿐).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { buildStaticDataFileContent } = require('./server.js');

const ROOT = __dirname;
const WORKTREE_NAME = '.demo-worktree';
const WORKTREE_DIR = path.join(ROOT, WORKTREE_NAME);
const MANIFEST_PATH = path.join(ROOT, 'slides.json');
const DEMO_URL = 'https://leehee4343.github.io/slide-viewer-demo/';

function run(cmd, cwd) {
  execSync(cmd, { cwd: cwd || ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
}
function runCapture(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || ROOT }).toString().trim();
}

// readline의 question()은 (콜백 방식이든 readline/promises든) 입력이 전부 한번에
// 도착하는 비-TTY 소스(파일 리다이렉트 등)에서, 질문이 실제로 걸려있지 않은 순간에
// 도착한 줄을 조용히 흘려버리는 문제가 있습니다 — 그러면 다음 question()이 응답을
// 영원히 기다리다 아무 에러 없이 프로세스가 끝나버립니다. 그래서 question()을 쓰지
// 않고 'line' 이벤트를 큐에 직접 쌓아두는 방식으로 우회합니다 (도착 시점과 무관하게
// 안전하며, 사람이 실제로 타이핑하는 경우에도 동일하게 잘 동작합니다).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lineQueue = [];
const lineWaiters = [];
rl.on('line', (line) => {
  if (lineWaiters.length > 0) lineWaiters.shift()(line);
  else lineQueue.push(line);
});
function ask(question) {
  process.stdout.write(question);
  return new Promise((resolve) => {
    if (lineQueue.length > 0) resolve(lineQueue.shift().trim());
    else lineWaiters.push((line) => resolve(line.trim()));
  });
}

// 이전 실행이 병합 충돌 상태로 중단된 채 남아있는지 확인
function hasUnresolvedMerge() {
  return fs.existsSync(path.join(WORKTREE_DIR, '.git')) &&
    (() => {
      try {
        runCapture('git rev-parse -q --verify MERGE_HEAD', WORKTREE_DIR);
        return true;
      } catch {
        return false;
      }
    })();
}

function ensureWorktree() {
  // 디스크에서 폴더만 수동으로 지워진 경우 등, git의 내부 worktree 등록 정보가
  // 실제 폴더 상태와 어긋나 있을 수 있으므로 먼저 정리합니다.
  run('git worktree prune');

  const dirExists = fs.existsSync(WORKTREE_DIR);
  const isValidWorktree = dirExists && fs.existsSync(path.join(WORKTREE_DIR, '.git'));

  if (dirExists && !isValidWorktree) {
    console.log(`${WORKTREE_NAME} 폴더가 손상된 상태로 보여 다시 만듭니다...`);
    fs.rmSync(WORKTREE_DIR, { recursive: true, force: true });
  }

  if (!dirExists || !isValidWorktree) {
    console.log('격리된 배포 작업공간(.demo-worktree)을 새로 만듭니다...');
    run(`git worktree add "${WORKTREE_NAME}" demo-deploy`, ROOT);
    return;
  }

  if (hasUnresolvedMerge()) {
    console.log('이전 실행에서 병합 충돌이 미해결 상태로 남아있어 정리합니다...');
    try {
      run('git merge --abort', WORKTREE_DIR);
    } catch {
      console.error(`\n자동 정리에 실패했습니다. ${WORKTREE_NAME} 폴더에서 직접 확인해주세요.`);
      process.exit(1);
    }
  }

  console.log('기존 배포 작업공간(.demo-worktree)을 재사용합니다.');
  // 이 폴더의 images/slides.json/slides-data.js는 매 실행마다 통째로 다시 생성되므로,
  // 이전 실행이 "취소"로 끝나며 남긴 staged/미커밋 변경사항은 안전하게 버려도 됩니다.
  // (그래야 이번 merge가 "local changes would be overwritten" 오류 없이 진행됨)
  run('git reset --hard HEAD', WORKTREE_DIR);
  run('git clean -fd', WORKTREE_DIR);
}

function syncMainIntoWorktree() {
  console.log('\nmain의 최신 코드 변경사항을 배포 브랜치에 반영합니다...');
  try {
    run('git merge main -m "sync: main 코드 변경사항 반영"', WORKTREE_DIR);
  } catch (e) {
    console.error(`\n병합 중 오류가 발생했습니다 (충돌이거나 다른 git 문제일 수 있습니다).`);
    console.error(`${WORKTREE_NAME} 폴더에서 'git status'로 원인을 확인해 직접 해결한 뒤 다시 실행해주세요.`);
    console.error('(git merge --abort 로 병합을 취소하고 다시 시작할 수도 있습니다)');
    process.exit(1);
  }
}

async function main() {
  console.log('=== 공개 데모 배포 스크립트 ===\n');

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('slides.json이 없습니다. 먼저 로컬 서버("프로그램 시작.bat")로 슬라이드를 준비해주세요.');
    process.exit(1);
  }

  const dirty = runCapture('git status --porcelain');
  if (dirty) {
    console.error('main 브랜치에 커밋되지 않은 변경사항이 있습니다. 먼저 정리한 뒤 다시 실행해주세요.');
    process.exit(1);
  }

  ensureWorktree();
  syncMainIntoWorktree();

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

  const missingFiles = [];
  selected.forEach((p) => {
    p.slides.forEach((s) => {
      const src = path.join(ROOT, s.file);
      if (!fs.existsSync(src)) {
        missingFiles.push(`${p.name} / ${s.name} (${s.file})`);
        return;
      }
      const dst = path.join(WORKTREE_DIR, s.file);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    });
  });

  if (missingFiles.length > 0) {
    console.log(`\n⚠ 다음 ${missingFiles.length}개 슬라이드는 원본 파일을 찾을 수 없어 건너뜁니다:`);
    missingFiles.forEach((m) => console.log(`  - ${m}`));
  }

  const deployManifest = { currentProjectId: selected[0].id, projects: selected };
  fs.writeFileSync(path.join(WORKTREE_DIR, 'slides.json'), JSON.stringify(deployManifest, null, 2), 'utf-8');
  fs.writeFileSync(path.join(WORKTREE_DIR, 'slides-data.js'), buildStaticDataFileContent(deployManifest), 'utf-8');

  run('git add -f images/ slides.json slides-data.js', WORKTREE_DIR);
  console.log('\n--- 변경 요약 (.demo-worktree 기준) ---');
  run('git status --short', WORKTREE_DIR);

  console.log('\n※ 참고: 이번에 선택 해제한 프로젝트가 과거에 한 번이라도 게시된 적 있다면,');
  console.log('   demo 저장소의 git 히스토리에는 그 이미지가 계속 남아있습니다(완전 삭제 아님).');

  const confirm = await ask('\n위 내용을 공개 데모 사이트에 실제로 게시할까요? ("yes" 입력 시에만 진행): ');
  if (confirm !== 'yes') {
    console.log('게시를 취소했습니다. (.demo-worktree의 변경사항은 스테이징된 채로 남아있습니다)');
    process.exit(0);
  }

  const today = new Date().toISOString().slice(0, 10);
  run(`git commit -m "deploy: ${today} 슬라이드 데이터 배포"`, WORKTREE_DIR);
  run('git push demo demo-deploy:main', WORKTREE_DIR);
  console.log(`\n✅ 공개 데모 배포 완료: ${DEMO_URL}`);
  rl.close();
}

main().catch((e) => { console.error(e); rl.close(); process.exit(1); });
