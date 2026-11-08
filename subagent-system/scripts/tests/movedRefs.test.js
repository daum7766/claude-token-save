import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// 파일을 옮기거나 지우는 커밋을 만들 때 그 옛 경로를 아직 가리키는 문서와 메모리가 있으면 막는지 시험한다.
// 임시 설정 저장소, 임시 프로젝트 저장소, 임시 메모리 폴더, 임시 사용 기록을 만들고 조각의 run을 직접 부른다. HOME과 기록 폴더도 임시로 준다.
const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIECE = path.join(SCRIPTS, '..', 'hooks', 'git', 'pre-commit.d', '20-moved-refs.cjs');
const piece = createRequire(import.meta.url)(PIECE);
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const SKIP = HAS_GIT ? false : 'git이 없음';

const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const put = (dir, rel, text) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};

// home 아래에 설정 저장소(.claude)와 프로젝트 저장소(proj)를 만든다. 설정 저장소에는 옮길 문서 docs/ui/GUIDE.md가 커밋돼 있다.
function setup() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'moved-refs-')));
  const config = path.join(home, '.claude');
  const proj = path.join(home, 'proj');
  for (const d of [config, proj]) {
    fs.mkdirSync(d, { recursive: true });
    git(d, 'init', '-q');
  }
  put(config, 'docs/ui/GUIDE.md', '가이드\n');
  put(config, 'docs/other/README.md', '다른 문서\n');
  put(proj, 'README.md', '프로젝트\n');
  for (const d of [config, proj]) {
    git(d, 'add', '-A');
    git(d, 'commit', '-q', '-m', 'init');
  }
  const records = path.join(config, 'subagent-system', 'records');
  put(records, 'subagent-usage.tsv', `날짜\t프로젝트\t정의\t일 종류\t토큰\t도구\t초\t결과\t메모\n2026-11-01\t${proj}/.claude/worktrees/w1\tsonnet-low\t구현\t1\t1\t1\tok\tx\n`);
  const memory = path.join(config, 'projects', proj.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
  fs.mkdirSync(memory, { recursive: true });
  return { home, config, proj, records, memory };
}

// 설정 저장소에서 docs/ui/GUIDE.md를 docs/GUIDE.md로 옮기는 변경을 스테이징해 두고 조각을 돈다.
function moveAndRun(s, env = {}) {
  git(s.config, 'mv', 'docs/ui/GUIDE.md', 'docs/GUIDE.md');
  const saved = process.env.KIT_ALLOW_MOVED_REFS;
  if (env.KIT_ALLOW_MOVED_REFS === undefined) delete process.env.KIT_ALLOW_MOVED_REFS;
  else process.env.KIT_ALLOW_MOVED_REFS = env.KIT_ALLOW_MOVED_REFS;
  const realWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    return piece.run({ repoTop: s.config, configDir: s.config, home: s.home, recordsDir: s.records });
  } finally {
    process.stderr.write = realWrite;
    if (saved === undefined) delete process.env.KIT_ALLOW_MOVED_REFS;
    else process.env.KIT_ALLOW_MOVED_REFS = saved;
  }
}

describe('옮기거나 지운 파일의 옛 경로 검사', { skip: SKIP }, () => {
  it('프로젝트 문서가 옮긴 파일의 옛 경로를 가리키면 커밋을 막고 가리키는 파일과 줄을 알려 준다', () => {
    const s = setup();
    put(s.proj, 'docs/NOTE.md', '앞줄\n읽을 것: ~/.claude/docs/ui/GUIDE.md 를 본다\n');
    git(s.proj, 'add', '-A');
    git(s.proj, 'commit', '-q', '-m', 'ref');
    const msg = moveAndRun(s);
    assert.match(msg, /docs\/ui\/GUIDE\.md → .*docs\/NOTE\.md:2/);
    assert.match(msg, /KIT_ALLOW_MOVED_REFS=1/);
  });

  it('프로젝트 메모리가 옮긴 파일의 옛 경로를 가리키면 커밋을 막는다', () => {
    const s = setup();
    put(s.memory, 'feedback_x.md', '규칙은 ~/.claude/docs/ui/GUIDE.md\n');
    const msg = moveAndRun(s);
    assert.match(msg, /feedback_x\.md:1/);
  });

  it('같은 변경에서 가리키던 문서도 함께 고쳤으면 통과한다', () => {
    const s = setup();
    put(s.config, 'docs/INDEX.md', '목록: docs/ui/GUIDE.md\n');
    git(s.config, 'add', '-A');
    git(s.config, 'commit', '-q', '-m', 'index');
    put(s.config, 'docs/INDEX.md', '목록: docs/GUIDE.md\n');
    git(s.config, 'add', '-A');
    assert.equal(moveAndRun(s), null);
  });

  it('설정 저장소 안 문서가 옛 경로를 고치지 않고 두면 막는다', () => {
    const s = setup();
    put(s.config, 'docs/INDEX.md', '목록: docs/ui/GUIDE.md\n');
    git(s.config, 'add', '-A');
    git(s.config, 'commit', '-q', '-m', 'index');
    assert.match(moveAndRun(s), /docs\/INDEX\.md:1/);
  });

  it('변경 내역과 작업 기록처럼 그때 경로를 이력으로 적은 기록물은 막지 않는다', () => {
    // 기록물은 고칠 대상이 아닌데, 세면 옮길 때마다 헛걸린다.
    const s = setup();
    put(s.config, 'CHANGES.md', '옛 자리 docs/ui/GUIDE.md\n');
    put(s.config, 'docs/plan/work/a-progress.md', '옛 자리 docs/ui/GUIDE.md\n');
    git(s.config, 'add', '-A');
    git(s.config, 'commit', '-q', '-m', 'records');
    assert.equal(moveAndRun(s), null);
  });

  it('파일 이름만 같은 다른 경로의 문서나 이름이 이어진 파일은 막지 않는다', () => {
    const s = setup();
    put(s.proj, 'docs/NOTE.md', '다른 곳: docs/other/GUIDE.md 와 ~/.claude/docs/ui/GUIDE.md.bak 와 GUIDE.md\n');
    git(s.proj, 'add', '-A');
    git(s.proj, 'commit', '-q', '-m', 'same name');
    assert.equal(moveAndRun(s), null);
  });

  it('지우거나 옮기는 파일이 없으면 검사하지 않고 통과한다', () => {
    const s = setup();
    put(s.proj, 'docs/NOTE.md', '~/.claude/docs/ui/GUIDE.md\n');
    git(s.proj, 'add', '-A');
    git(s.proj, 'commit', '-q', '-m', 'ref');
    put(s.config, 'docs/other/README.md', '고침\n');
    git(s.config, 'add', '-A');
    assert.equal(piece.run({ repoTop: s.config, configDir: s.config, home: s.home, recordsDir: s.records }), null);
  });

  it('KIT_ALLOW_MOVED_REFS=1이면 가리키는 곳이 있어도 통과한다', () => {
    const s = setup();
    put(s.memory, 'feedback_x.md', '규칙은 ~/.claude/docs/ui/GUIDE.md\n');
    assert.equal(moveAndRun(s, { KIT_ALLOW_MOVED_REFS: '1' }), null);
  });
});
