// 공개판 내보내기(tools/kit-export.cjs)를 지어낸 작은 키트로 시험한다: 트리 고르기, 뺀 묶음 표시, 거르기, 메시지 검사 실패 시 멈춤, --into의 지우기와 .git 보존.
// 키트 원본에서만 돈다(설치본 배치라 tools/가 없으면 건너뜀). 견본에는 지어낸 이름만 쓴다.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..', '..', '..');
const TOOL = path.join(KIT, 'tools', 'kit-export.cjs');
const SKIP = fs.existsSync(TOOL) ? false : '설치본 배치라 tools/가 없음(키트 원본에서만 시험)';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `kit-export-test-${name}-`));
const put = (root, rel, text) => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof text === 'string' ? text : `${JSON.stringify(text, null, 2)}\n`);
};
const bundle = (name, order, selectable) => ({ name, title: name, summary: name, order, selectable, alwaysRules: [], options: [], configKeys: [], uses: [], records: [] });
const part = (name, files, kitOnly = []) => ({ bundle: name, part: 'core', origin: 'kit', files, kitOnly, hooks: [], gitHooks: [] });

// 공개 묶음 base와 뺄 묶음 hidden을 가진 견본 키트
function sampleKit({ changes } = {}) {
  const kit = tmp('kit');
  put(kit, 'bundles/base/bundle.json', bundle('base', 0, false));
  put(kit, 'bundles/base/core.part.json', part('base', ['rules/kit-demo.md', 'skills/demo/**'], ['subagent-system/docs/KIT_ONLY.md', 'subagent-system/VERSION']));
  put(kit, 'bundles/base/install.md', 'demo 설치');
  put(kit, 'bundles/hidden/bundle.json', bundle('hidden', 10, true));
  put(kit, 'bundles/hidden/core.part.json', part('hidden', ['rules/kit-hidden.md'], ['extras/perm.json']));
  put(kit, 'subagent-system/rules/kit-demo.md', 'demo 규칙');
  put(kit, 'subagent-system/rules/kit-hidden.md', 'hidden 규칙');
  put(kit, 'subagent-system/skills/demo/SKILL.md', 'skill');
  put(kit, 'subagent-system/docs/KIT_ONLY.md', '키트에서만');
  put(kit, 'extras/perm.json', '{}');
  put(kit, 'CLAUDE.md', '관리 지침');
  put(kit, 'README.md', '비공개 README: 뺀 묶음 소개');
  put(kit, 'README.public.md', 'readme');
  put(kit, 'LICENSE', 'license');
  put(kit, 'subagent-system/APPLY_GUIDE.md', 'guide');
  put(kit, 'subagent-system/BACKGROUND.md', 'background');
  put(kit, 'subagent-system/VERSION', '2030.1.1\n');
  put(kit, 'subagent-system/CHANGES.md', '# 비공개 변경 기록\n');
  put(kit, 'subagent-system/CHANGES.public.md', changes ?? '# 변경 내역\n\n## 2030.1.1\n- 첫 공개판 항목\n');
  put(kit, 'tools/helper.cjs', '// tool');
  put(kit, 'tools/node_modules/x/index.js', 'x');
  put(kit, 'agent-meter/README.md', 'meter');
  put(kit, '.claude-plugin/marketplace.json', '{}');
  put(kit, '.gitignore', 'node_modules/\n*.tmp\n');
  put(kit, 'subagent-system/skills/demo/ignored.tmp', '무시된 파일');
  return kit;
}

// 비공개 이름이 든 설정 폴더(이름은 시험용 가짜)
function fakeConfig() {
  const cfg = tmp('cfg');
  put(cfg, 'subagent-system/config.json', { privateNames: ['DEMO_SECRET_NAME'] });
  return cfg;
}

const gitIn = (dir, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-C', dir, ...a], { encoding: 'utf8' });
// 견본 키트를 git 저장소로 만들어 모두 커밋한다(내보내기는 깨끗한 작업 트리만 받는다)
const commitKit = (kit) => {
  if (!fs.existsSync(path.join(kit, '.git'))) gitIn(kit, 'init', '-q');
  gitIn(kit, 'add', '-A');
  gitIn(kit, 'commit', '-q', '--allow-empty', '-m', 'sample');
};

const exportKit = (kit, args, cfg = fakeConfig(), { dirty = false } = {}) => {
  if (!dirty) commitKit(kit);
  return spawnSync('node', [TOOL, '--kit', kit, '--bundles', 'base', ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
};

const listFiles = (root, rel = '') =>
  fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? (e.name === '.git' ? [] : listFiles(root, r)) : [r];
  });

describe('공개판 트리 만들기', { skip: SKIP }, () => {
  it('공개 묶음 파일과 묶음 밖 공개 파일만 담고, 뺀 묶음은 omitted.json에 적는다', () => {
    const kit = sampleKit();
    const out = path.join(tmp('out'), 'tree');
    const r = exportKit(kit, ['--out', out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const files = listFiles(out).sort();
    for (const f of ['bundles/base/bundle.json', 'bundles/base/core.part.json', 'bundles/base/install.md', 'subagent-system/rules/kit-demo.md', 'subagent-system/skills/demo/SKILL.md', 'subagent-system/docs/KIT_ONLY.md', 'README.md', 'LICENSE', 'subagent-system/VERSION', 'tools/helper.cjs', 'agent-meter/README.md', '.claude-plugin/marketplace.json', '.gitignore']) {
      assert.ok(files.includes(f), `담겨야 함: ${f}\n${files.join('\n')}`);
    }
    assert.ok(!files.some((f) => f.startsWith('bundles/hidden/')), '뺀 묶음 폴더');
    assert.ok(!files.some((f) => f.startsWith('extras/')), 'extras');
    assert.ok(!files.includes('CLAUDE.md'), '키트 뿌리 CLAUDE.md');
    assert.ok(!files.includes('README.public.md'), '공개용 README 원본 이름은 남기지 않는다');
    assert.equal(fs.readFileSync(path.join(out, 'README.md'), 'utf8'), 'readme', 'README.md는 공개용 원본 내용');
    assert.ok(!files.some((f) => f.includes('node_modules')), 'node_modules');
    assert.ok(!files.some((f) => /hidden/.test(f) && f !== 'bundles/omitted.json'), '뺀 묶음 파일');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'bundles', 'omitted.json'), 'utf8')), { omitted: ['hidden'], keep: ['rules/kit-hidden.md'] });
    assert.ok(!files.includes('subagent-system/skills/demo/ignored.tmp'), '무시된 파일은 글롭이 있어도 담지 않는다');
  });

  it('공개용 변경 기록을 CHANGES.md로 복사하고 맨 위 항목으로 커밋 메시지 파일을 만든다', () => {
    const kit = sampleKit();
    const out = path.join(tmp('out'), 'tree');
    const r = exportKit(kit, ['--out', out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(path.join(out, 'subagent-system', 'CHANGES.md'), 'utf8'), /첫 공개판 항목/);
    assert.doesNotMatch(fs.readFileSync(path.join(out, 'subagent-system', 'CHANGES.md'), 'utf8'), /비공개 변경 기록/);
    const msgFile = /커밋 메시지 파일: (.+)/.exec(r.stdout)[1];
    assert.equal(fs.readFileSync(msgFile, 'utf8'), '공개판 2030.1.1\n\n- 첫 공개판 항목\n');
  });

  it('변경 기록 첫 항목이 VERSION과 다르면 멈춘다', () => {
    const kit = sampleKit({ changes: '# 변경 내역\n\n## 2029.1.1\n- 옛 항목\n' });
    const r = exportKit(kit, ['--out', path.join(tmp('out'), 'tree')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /VERSION/);
  });
});

describe('깨끗한 작업 트리만 내보낸다', { skip: SKIP }, () => {
  it('커밋 안 된 수정이나 추적 안 된 파일이 있으면 멈춘다', () => {
    const kit = sampleKit();
    commitKit(kit);
    put(kit, 'README.md', '커밋 안 된 수정');
    const r1 = exportKit(kit, ['--out', path.join(tmp('out'), 'tree')], fakeConfig(), { dirty: true });
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /깨끗하지 않습니다/);
    commitKit(kit);
    put(kit, 'subagent-system/skills/demo/new.md', '추적 안 된 파일');
    const r2 = exportKit(kit, ['--out', path.join(tmp('out'), 'tree2')], fakeConfig(), { dirty: true });
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /깨끗하지 않습니다/);
  });
});

describe('비공개 이름 검사', { skip: SKIP }, () => {
  it('내보낸 트리가 어떤 저장소의 무시 폴더 안에 있어도 폴더를 직접 훑어 잡는다', () => {
    const kit = sampleKit();
    put(kit, 'README.public.md', 'DEMO_SECRET_NAME 안내');
    const host = tmp('host');
    gitIn(host, 'init', '-q');
    put(host, '.gitignore', 'out/\n');
    const r = exportKit(kit, ['--out', path.join(host, 'out', 'tree')]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /비공개 이름/);
  });

  it('도구에 폴더 훑기 선택지를 주면 git 목록 없이 본 파일 수를 찍는다', () => {
    const dir = tmp('walk');
    put(dir, 'a.md', 'x');
    put(dir, 'sub/b.md', 'DEMO_SECRET_NAME');
    const r = spawnSync('node', [path.join(KIT, 'tools', 'kit-private-names.cjs'), dir, '--walk'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: fakeConfig() } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /본 파일 2개/);
    assert.match(r.stdout, /sub\/b\.md:1/);
  });

  it('커밋 메시지에 비공개 이름이 있으면 멈춘다', () => {
    const kit = sampleKit({ changes: '# 변경 내역\n\n## 2030.1.1\n- DEMO_SECRET_NAME 관련 항목\n' });
    const r = exportKit(kit, ['--out', path.join(tmp('out'), 'tree')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /비공개 이름/);
  });

  it('공개 파일에 비공개 이름이 있으면 멈춘다', () => {
    const kit = sampleKit();
    put(kit, 'README.public.md', 'DEMO_SECRET_NAME 안내');
    const r = exportKit(kit, ['--out', path.join(tmp('out'), 'tree')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /비공개 이름/);
  });

  it('이름 목록이 비어 있으면 검사를 못 한 것이라 멈춘다', () => {
    const kit = sampleKit();
    const r = exportKit(kit, ['--out', path.join(tmp('out'), 'tree')], tmp('emptycfg'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /목록이 비어/);
  });
});

describe('공개 저장소 폴더에 얹기(--into)', { skip: SKIP }, () => {
  const git = (dir, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-C', dir, ...a], { encoding: 'utf8' });
  function fakeRepo() {
    const repo = tmp('repo');
    git(repo, 'init', '-q');
    git(repo, 'remote', 'add', 'origin', 'https://example.invalid/pub/kit.git');
    put(repo, 'old/removed.md', '옛 파일');
    put(repo, 'README.md', '옛 readme');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    return repo;
  }

  it('새 트리에 없는 추적 파일은 지우고 새 트리로 덮은 뒤 git add까지 하며 .git은 둔다', () => {
    const kit = sampleKit();
    const repo = fakeRepo();
    const headBefore = git(repo, 'rev-parse', 'HEAD').stdout;
    const r = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', repo, '--remote', 'example.invalid/pub/kit']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(repo, 'old', 'removed.md')), '지워진 파일');
    assert.ok(!fs.existsSync(path.join(repo, 'old')), '빈 폴더');
    assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'readme');
    assert.ok(fs.existsSync(path.join(repo, 'bundles', 'omitted.json')));
    assert.equal(git(repo, 'rev-parse', 'HEAD').stdout, headBefore, '커밋은 하지 않는다');
    const status = git(repo, 'status', '--porcelain').stdout;
    assert.match(status, /^D {1,2}old\/removed\.md/m);
    assert.match(status, /^A {1,2}bundles\/omitted\.json/m);
    assert.match(r.stdout, /git -C ".+" commit -F ".+COMMIT_MSG\.txt"/);
  });

  it('--remote가 없거나 다른 원격이면 멈춘다', () => {
    const kit = sampleKit();
    const repo = fakeRepo();
    const r1 = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', repo]);
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /--remote/);
    const r2 = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', repo, '--remote', 'other.invalid/x']);
    assert.equal(r2.status, 1);
    assert.ok(fs.existsSync(path.join(repo, 'old', 'removed.md')));
  });

  it('키트 원본과 같은 저장소이거나 키트의 비공개 기록이 든 복제본이면 멈추고 아무것도 지우지 않는다', () => {
    const kit = sampleKit();
    commitKit(kit);
    gitIn(kit, 'remote', 'add', 'origin', 'https://example.invalid/pub/kit.git');
    const r1 = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', kit, '--remote', 'example.invalid/pub/kit']);
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /같은 저장소/);
    assert.ok(fs.existsSync(path.join(kit, 'bundles', 'hidden', 'bundle.json')), '비공개 파일이 그대로');
    const clone = tmp('clone');
    spawnSync('git', ['clone', '-q', kit, clone]);
    gitIn(clone, 'remote', 'set-url', 'origin', 'https://example.invalid/pub/kit.git');
    const r2 = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', clone, '--remote', 'example.invalid/pub/kit']);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /비공개 기록이 든/);
  });

  it('키트와 첫 기록을 함께 가진 공개 저장소(키트의 옛 커밋까지만 있는 폴더)에는 얹는다', () => {
    const kit = sampleKit();
    commitKit(kit);
    gitIn(kit, 'branch', 'pub');
    put(kit, 'later.md', '비공개 뒤 커밋');
    commitKit(kit);
    const pub = tmp('pub');
    spawnSync('git', ['clone', '-q', '--no-local', '--single-branch', '--branch', 'pub', kit, pub]);
    gitIn(pub, 'remote', 'set-url', 'origin', 'https://example.invalid/pub/kit.git');
    const r = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', pub, '--remote', 'example.invalid/pub/kit', '--public-base', 'pub']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const r2 = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', pub, '--remote', 'example.invalid/pub/kit']);
    assert.equal(r2.status, 1, '기준 커밋이 없으면 키트의 모든 커밋을 비공개로 본다');
    assert.match(r2.stderr, /비공개 기록이 든/);
  });

  it('공개 저장소 폴더에 원래 있던 추적 안 된 파일이 있으면 멈추고 올리지 않는다', () => {
    const kit = sampleKit();
    const repo = fakeRepo();
    put(repo, 'secret-note.md', '원래 있던 비공개 메모');
    const r = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', repo, '--remote', 'example.invalid/pub/kit']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /깨끗하지 않습니다/);
    assert.equal(gitIn(repo, 'diff', '--cached', '--name-only').stdout.trim(), '', '스테이지에 아무것도 올리지 않는다');
  });

  it('git 저장소가 아니거나 원격이 없으면 멈추고 아무것도 지우지 않는다', () => {
    const kit = sampleKit();
    const plain = tmp('plain');
    put(plain, 'keep.md', 'x');
    const r1 = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', plain, '--remote', 'x']);
    assert.equal(r1.status, 1);
    assert.ok(fs.existsSync(path.join(plain, 'keep.md')));
    const noRemote = tmp('noremote');
    git(noRemote, 'init', '-q');
    const r2 = exportKit(kit, ['--out', path.join(tmp('out'), 'tree'), '--into', noRemote, '--remote', 'x']);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /원격/);
  });
});
