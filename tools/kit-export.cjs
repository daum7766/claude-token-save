#!/usr/bin/env node
'use strict';

/**
 * 키트 공개판 내보내기(키트 관리자용, 사용자 설치에는 깔리지 않는다).
 *
 * 왜: 개발은 비공개 저장소에서 하고 공개 저장소에는 이 명령으로만 얹는다. 손으로 거르면 비공개 묶음 표지가 새거나 공개판이 깨진 채 나간다.
 * 전제: 키트 원본의 묶음 정의(bundles/)가 공개 묶음의 파일 목록을 가진다. 공개 기록은 덮어쓰지 않고 버전마다 한 커밋을 얹는다. push는 하지 않는다.
 *
 * 쓰는 법: node tools/kit-export.cjs [--out <새 폴더>] [--bundles base,routing] [--check] [--into <공개 저장소 폴더>] [--remote <원격 주소에 들어갈 글>]
 *   1) 트리 만들기, 2) 변경 기록과 커밋 메시지 파일, 3) 비공개 이름 검사(0곳이 아니면 멈춤)
 *   --check: 임시 git 저장소로 묶어 키트 시험과 린트, 라우팅만 새로 깔기와 설치본 시험, 10-31판 설치본 갱신을 돌려 찍는다
 *   --old-from: 10-31판을 읽을 공개 저장소 폴더(없으면 --into, 그것도 없으면 ~/programming/claude-token-save)
 *   --into: --remote 필수. 키트와 같은 저장소가 아니고 작업 트리가 깨끗한 폴더(git 저장소)가 추적하는 파일 가운데 새 트리에 없는 것을 지우고 새 트리를 덮은 뒤 git add까지 하고 커밋 명령 한 줄을 찍는다
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const namesTool = require('./kit-private-names.cjs');

// 묶음 밖에서 공개로 나가는 파일과 폴더(끝이 /면 폴더). 공개 목록은 여기 한곳에만 둔다.
const PUBLIC_EXTRA = [
  'README.public.md', // 공개용 README 원본. 내보낼 때 README.md로 바꿔 싣는다(비공개 README는 빠진 묶음을 소개해 링크가 깨진다).
  'LICENSE',
  'subagent-system/APPLY_GUIDE.md',
  'subagent-system/BACKGROUND.md',
  'subagent-system/VERSION',
  'tools/',
  'agent-meter/',
  '.claude-plugin/',
  '.gitignore',
];
const README_SRC = 'README.public.md';
const DEFAULT_BUNDLES = ['base', 'routing', 'safety']; // 일하는 노하우 묶음은 비공개 저장소 권한으로만 나눈다(11-08 대표)
const CHANGES_SRC = 'subagent-system/CHANGES.public.md';
const CHANGES_OUT = 'subagent-system/CHANGES.md';
const SKIP_DIRS = new Set(['node_modules', '.git']);
const SKIP_FILES = new Set(['.DS_Store']);
const OLD_COMMIT = 'ecfd440'; // 10-31판

class Stop extends Error {}
const stop = (msg) => {
  throw new Stop(msg);
};
const log = (msg) => process.stdout.write(`${msg}\n`);

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
const mkTmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `kit-export-${name}-`));

function copyOne(srcRoot, dstRoot, relPath) {
  const from = path.join(srcRoot, ...relPath.split('/'));
  if (!fs.existsSync(from)) stop(`원본에 없는 파일: ${relPath}`);
  const to = path.join(dstRoot, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

// 폴더 안 파일. git 저장소면 추적되는 것만(무시된 부스러기를 안 싣는다), 아니면 폴더를 훑는다.
function listDir(root, relDir) {
  if (!fs.existsSync(path.join(root, ...relDir.split('/')))) stop(`원본에 없는 폴더: ${relDir}`);
  const r = run('git', ['-C', root, 'ls-files', '-z', '--', relDir]);
  const tracked = r.status === 0 ? r.stdout.split('\0').filter(Boolean) : [];
  return tracked.length ? tracked.filter((f) => !f.split('/').some((s) => SKIP_DIRS.has(s) || SKIP_FILES.has(s))) : walk(root, relDir);
}

function walk(root, relDir = '') {
  const out = [];
  const dir = path.join(root, ...(relDir ? relDir.split('/') : []));
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || SKIP_FILES.has(e.name)) continue;
    const r = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out;
}

const parseArgs = (argv) => {
  const o = { bundles: DEFAULT_BUNDLES, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--into') o.into = argv[++i];
    else if (a === '--kit') o.kit = argv[++i];
    else if (a === '--remote') o.remote = argv[++i];
    else if (a === '--public-base') o.publicBase = argv[++i];
    else if (a === '--old-from') o.oldFrom = argv[++i];
    else if (a === '--bundles') o.bundles = String(argv[++i] ?? '').split(',').filter(Boolean);
    else stop(`모르는 인자: ${a}`);
  }
  if (!o.bundles.length) stop('--bundles가 비었습니다');
  return o;
};

// 1) 트리 만들기. 반환: 복사한 파일 상대 경로 목록
// 키트 작업 트리가 깨끗해야 내보낸다(커밋 안 된 수정본과 추적 안 된 파일이 공개판에 실리지 않게). 반환: git이 추적하는 파일 집합
function trackedSet(kit) {
  const st = run('git', ['-C', kit, 'status', '--porcelain', '--untracked-files=all']);
  if (st.status !== 0) stop(`키트 원본이 git 저장소가 아닙니다: ${kit}`);
  if (st.stdout.trim()) stop(`키트 작업 트리가 깨끗하지 않습니다. 커밋하거나 치운 뒤 다시 내보냅니다:\n${st.stdout.trim().split('\n').slice(0, 10).join('\n')}`);
  return new Set(run('git', ['-C', kit, 'ls-files', '-z']).stdout.split('\0').filter(Boolean));
}

async function buildTree({ kit, out, bundles, tracked }) {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'subagent-system', 'scripts', 'kitBundles.js')).href);
  const emptyCfg = mkTmp('emptycfg');
  const defs = mod.loadDefinitions({ kitRoot: kit, configDir: emptyCfg });
  const allBundles = [...defs.bundles.keys()];
  for (const b of bundles) if (!defs.bundles.has(b)) stop(`키트에 없는 묶음: ${b}`);
  const bad = defs.problems.filter((p) => p.level === 'error');
  if (bad.length) stop(`묶음 정의 오류:\n${bad.map((p) => `  ${p.msg}`).join('\n')}`);

  const files = new Set();
  for (const p of defs.parts) {
    if (!bundles.includes(p.bundle)) continue;
    if (p.origin === 'local') continue;
    for (const k of mod.expandFiles(p)) files.add(mod.srcOf(k));
    for (const k of p.kitOnly ?? []) files.add(mod.srcOf(k));
    files.add(p.defFile);
  }
  for (const b of bundles) {
    const def = defs.bundles.get(b);
    files.add(def.defFile);
    for (const f of listDir(kit, `bundles/${b}`)) files.add(f); // 폴더 통째(install.md 등)
  }
  for (const e of PUBLIC_EXTRA) {
    if (e.endsWith('/')) for (const f of listDir(kit, e.slice(0, -1))) files.add(f);
    else files.add(e);
  }
  files.delete('subagent-system/CHANGES.md');
  files.delete('README.md');
  files.delete('CLAUDE.md');
  // 글롭이 무시된 파일까지 담지 않게 git이 추적하는 파일만 남긴다. 정의가 가리키는 파일이 빠지면 아래 정의 검사가 잡는다.
  const list = [...files].filter((f) => !f.startsWith('extras/') && !f.split('/').some((s) => SKIP_DIRS.has(s)) && (!tracked || tracked.has(f))).sort();

  fs.mkdirSync(out, { recursive: true });
  if (fs.readdirSync(out).length) stop(`대상 폴더가 비어 있지 않습니다: ${out}`);
  if (!list.includes(README_SRC)) stop(`${README_SRC}가 없거나 git이 추적하지 않습니다`);
  for (const f of list) {
    if (f === README_SRC) continue;
    copyOne(kit, out, f);
  }
  fs.copyFileSync(path.join(kit, README_SRC), path.join(out, 'README.md'));

  list.splice(list.indexOf(README_SRC), 1, 'README.md');
  const omitted = allBundles.filter((b) => !bundles.includes(b)).sort();
  // 뺀 묶음 조각의 파일을 설치본 키로 펼친 목록. 설치 쪽이 이 키만 고아로 남기고, 그 밖에 키트에서 빠진 파일(base, routing이 지우거나 이름 바꾼 것)은 지운다.
  const keep = new Set();
  for (const p of defs.parts) if (!bundles.includes(p.bundle) && p.origin !== 'local') for (const k of mod.expandFiles(p)) keep.add(k);
  fs.mkdirSync(path.join(out, 'bundles'), { recursive: true });
  fs.writeFileSync(path.join(out, 'bundles', 'omitted.json'), `${JSON.stringify({ omitted, keep: [...keep].sort() }, null, 2)}\n`);
  list.push('bundles/omitted.json');
  return { list: list.sort(), omitted };
}

// 2) 변경 기록과 커밋 메시지 파일. 반환: { messageFile, version }
function writeChanges({ kit, out }) {
  const srcFile = path.join(kit, ...CHANGES_SRC.split('/'));
  if (!fs.existsSync(srcFile)) stop(`${CHANGES_SRC}가 없습니다`);
  const text = fs.readFileSync(srcFile, 'utf8');
  const version = fs.readFileSync(path.join(kit, 'subagent-system', 'VERSION'), 'utf8').trim();
  const m = /^## (\S+)[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
  if (!m) stop(`${CHANGES_SRC}에 \`## <버전>\` 항목이 없습니다`);
  if (m[1] !== version) stop(`${CHANGES_SRC} 첫 항목 버전(${m[1]})이 VERSION(${version})과 다릅니다`);
  fs.writeFileSync(path.join(out, ...CHANGES_OUT.split('/')), text);
  const messageFile = path.join(mkTmp('msg'), 'COMMIT_MSG.txt');
  fs.writeFileSync(messageFile, `공개판 ${version}\n\n${m[2].trim()}\n`);
  return { messageFile, version };
}

// 3) 비공개 이름 검사
function privateNameCheck({ out, messageFile, expectedFiles }) {
  const r = run('node', [path.join(__dirname, 'kit-private-names.cjs'), out, '--walk', '--message-file', messageFile]);
  const text = `${r.stdout}${r.stderr}`;
  if (/검사할 것이 없습니다/.test(text)) stop(`비공개 이름 목록이 비어 검사를 못 했습니다(설치본 로컬 조각 정의나 config.json privateNames 필요):\n${text}`);
  if (r.status !== 0) stop(`비공개 이름이 공개판에 들어 있습니다:\n${text}`);
  const seen = Number((/본 파일 (\d+)개/.exec(text) ?? [])[1]);
  if (expectedFiles !== undefined && seen !== expectedFiles) stop(`비공개 이름 검사가 본 파일 수(${seen})가 트리 파일 수(${expectedFiles})와 다릅니다`);
  log(text.trim().split('\n').slice(-2).join('\n'));
}

function gitInit(dir) {
  const g = (...a) => run('git', ['-c', 'user.name=export', '-c', 'user.email=export@example.invalid', '-C', dir, ...a]);
  g('init', '-q');
  g('add', '-A');
  const c = g('commit', '-q', '-m', 'export');
  if (c.status !== 0) stop(`임시 저장소 커밋 실패: ${c.stderr}`);
}

function tapSummary(out) {
  const num = (k) => Number((new RegExp(`^# ${k} (\\d+)`, 'm').exec(out) ?? [])[1] ?? NaN);
  const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
  return { pass: num('pass'), fail: num('fail'), skipped: num('skipped'), failed };
}

function runKitTests(dir, env) {
  const files = fs.readdirSync(path.join(dir, 'subagent-system', 'scripts', 'tests')).filter((f) => f.endsWith('.test.js')).map((f) => path.join('subagent-system', 'scripts', 'tests', f));
  const r = run('node', ['--test', '--test-reporter=tap', ...files], { cwd: dir, env });
  return { ...tapSummary(r.stdout), status: r.status };
}

function runInstalledTests(cfg, env) {
  const tests = path.join(cfg, 'subagent-system', 'scripts', 'tests');
  if (!fs.existsSync(tests)) return { fail: NaN, failed: ['설치본에 tests/가 없음'], pass: 0 };
  const files = fs.readdirSync(tests).filter((f) => f.endsWith('.test.js')).map((f) => path.join('tests', f));
  const r = run('node', ['--test', '--test-reporter=tap', ...files], { cwd: path.join(cfg, 'subagent-system', 'scripts'), env: { ...env, CLAUDE_CONFIG_DIR: cfg } });
  return tapSummary(r.stdout);
}

const jsonOf = (s) => {
  const i = s.indexOf('{');
  try {
    return JSON.parse(s.slice(i));
  } catch {
    return null;
  }
};

// 4) 시험
async function check({ out, kit, oldFrom }) {
  const stage = mkTmp('stage');
  fs.cpSync(out, stage, { recursive: true });
  gitInit(stage);
  const baseEnv = { ...process.env, CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: mkTmp('cfg-tests') };
  const result = { ok: true };

  const t = runKitTests(stage, baseEnv);
  result.tests = t;
  log(`공개판 키트 시험: 통과 ${t.pass}, 실패 ${t.fail}, 건너뜀 ${t.skipped}`);
  for (const f of t.failed.slice(0, 40)) log(`  실패: ${f}`);
  if (t.fail !== 0) result.ok = false;

  const l = run('node', ['--expose-internals', 'tools/kit-lint.cjs'], { cwd: stage, env: baseEnv });
  const lintTail = `${l.stdout}${l.stderr}`.trim().split('\n').slice(-3).join('\n');
  log(`린트(종료 ${l.status}): ${lintTail}`);
  if (l.status !== 0) result.ok = false;

  // 라우팅만 새로 깔기
  const cfgNew = mkTmp('cfg-new');
  const setup = path.join(stage, 'subagent-system', 'scripts', 'kit-setup.js');
  const inst = run('node', [setup, 'install', '--profile', 'personal', '--bundles', 'routing', '--options', 'none', '--kit', stage], { cwd: stage, env: { ...baseEnv, CLAUDE_CONFIG_DIR: cfgNew } });
  log(`라우팅만 새로 깔기: 종료 ${inst.status}`);
  if (inst.status !== 0) {
    log(`${inst.stdout}${inst.stderr}`.slice(0, 600));
    result.ok = false;
  } else {
    const it = runInstalledTests(cfgNew, baseEnv);
    log(`  설치본 시험: 통과 ${it.pass}, 실패 ${it.fail}`);
    for (const f of (it.failed ?? []).slice(0, 40)) log(`    실패: ${f}`);
    if (it.fail !== 0) result.ok = false;
    result.fresh = it;
  }

  // 10-31판 설치본을 새 공개판으로 갱신
  // 10-31판은 공개 저장소 기록에서 읽는다. 키트 원본은 공개 기록과 출발점이 달라 그 커밋이 없다(실수로 올려도 공개 저장소가 거절하게)
  const old = mkTmp('k1031');
  const oldSrc = git(kit, ['cat-file', '-e', `${OLD_COMMIT}^{commit}`]).status === 0 ? kit : oldFrom;
  const ar = oldSrc ? run('sh', ['-c', `git -C "${oldSrc}" archive ${OLD_COMMIT} | tar -x -C "${old}"`]) : { status: 1, stderr: '공개 저장소 폴더(--old-from)가 없음' };
  if (ar.status !== 0) {
    log(`10-31판(${OLD_COMMIT})을 풀지 못함, 갱신 시험 건너뜀: ${ar.stderr}`);
    result.upgrade = null;
    result.ok = false;
  } else {
    const cfgOld = mkTmp('cfg1031');
    const oldEnv = { ...baseEnv, CLAUDE_CONFIG_DIR: cfgOld };
    const oi = run('node', [path.join(old, 'subagent-system', 'scripts', 'kit-setup.js'), 'install', '--profile', 'personal', '--kit', old], { cwd: old, env: oldEnv });
    if (oi.status !== 0) {
      log(`10-31판 깔기 실패(종료 ${oi.status}): ${`${oi.stdout}${oi.stderr}`.slice(0, 500)}`);
      result.ok = false;
    } else {
      const up = run('node', [setup, 'update', '--kit', stage], { cwd: stage, env: oldEnv });
      const j = jsonOf(up.stdout);
      log(`10-31판 설치본 갱신: 종료 ${up.status}`);
      if (up.status !== 0 || !j) {
        log(`${up.stdout}${up.stderr}`.slice(0, 600));
        result.ok = false;
      } else {
        const removedList = j.orphansRemoved ?? [];
        const hk = j.settings?.hooks ?? {};
        const added = hk.added ?? [];
        const gone = hk.removed ?? [];
        const replaced = (hk.replaced ?? []).map((r) => r.label);
        log(`  지워진 파일 ${removedList.length}개, 이 키트에 없는 묶음이라 남긴 파일 ${(j.orphansLeft ?? []).length}개, 고쳐 써서 남긴 파일 ${(j.orphansKept ?? []).length}개, 훅 등록: 새로 ${added.length}, 빠진 ${gone.length}, 바뀐 ${replaced.length}`);
        for (const n of j.notes ?? []) log(`  알림: ${n}`);
        for (const f of removedList) log(`    지움 ${f}`);
        for (const h of added) log(`    + ${h}`);
        for (const h of gone) log(`    - ${h}`);
        for (const h of replaced) log(`    ~ ${h}`);
        result.upgrade = { removed: removedList.length, hooksAdded: added, hooksGone: gone, hooksReplaced: replaced };
        const left = []; // 갱신 뒤에도 남은 옛 묶음 파일 수를 찍는다
        for (const sub of ['rules', 'skills', 'agents']) {
          const d = path.join(cfgOld, sub);
          if (fs.existsSync(d)) left.push(...walk(d).map((f) => `${sub}/${f}`));
        }
        log(`  갱신 뒤 rules/skills/agents 파일 ${left.length}개`);
      }
    }
  }
  return result;
}

const git = (dir, args) => run('git', ['-C', dir, ...args]);

// 5) 공개 저장소 폴더에 얹기
const realOf = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

function putInto({ out, into, messageFile, remote, list, kit, publicBase = OLD_COMMIT }) {
  if (!fs.existsSync(path.join(into, '.git'))) stop(`git 저장소가 아닙니다: ${into}`);
  if (!remote) stop('--into에는 --remote(공개 저장소 원격 주소에 들어갈 글)가 필요합니다. 엉뚱한 저장소에 얹지 않게 하려는 것입니다');
  const top = git(into, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0 || realOf(top.stdout.trim()) !== realOf(into)) stop(`${into}는 git 저장소의 맨 위 폴더가 아닙니다`);
  // 키트 원본과 같은 저장소면 거절한다(비공개 파일을 지우고 add하게 되므로)
  const common = (d) => realOf(path.resolve(d, git(d, ['rev-parse', '--git-common-dir']).stdout.trim()));
  if (common(into) === common(kit)) stop('키트 원본과 같은 저장소라 얹을 수 없습니다');
  // 키트의 비공개 기록이 든 저장소(키트 복제본)면 거절한다. 공개 저장소는 공개 기준 커밋(10-31판)까지의 기록을 키트와 함께 가지므로,
  // 그 뒤 키트에만 있는 커밋이 하나라도 그 폴더에 있는지로 가른다. 기준 커밋이 키트에 없으면 키트의 모든 커밋을 비공개로 본다
  const hasBase = git(kit, ['cat-file', '-e', `${publicBase}^{commit}`]).status === 0;
  const privateCommits = git(kit, ['rev-list', hasBase ? `${publicBase}..HEAD` : 'HEAD']).stdout.split('\n').filter(Boolean);
  const seen = run('git', ['-C', into, 'cat-file', '--batch-check'], { input: privateCommits.join('\n') + '\n' }).stdout;
  if (seen.split('\n').some((l) => / commit /.test(l))) stop('키트 원본의 비공개 기록이 든 저장소라 얹을 수 없습니다');
  const dirty = git(into, ['status', '--porcelain', '--untracked-files=all']).stdout.trim();
  if (dirty) stop(`공개 저장소 폴더의 작업 트리가 깨끗하지 않습니다(원래 있던 파일이 함께 올라가지 않게):\n${dirty.split('\n').slice(0, 10).join('\n')}`);
  const rem = git(into, ['remote', '-v']);
  const remotes = rem.stdout.trim();
  if (!remotes) stop('원격이 없어 공개 저장소인지 확인할 수 없습니다');
  if (!remotes.includes(remote)) stop(`원격이 ${remote}가 아닙니다:\n${remotes}`);
  const tracked = git(into, ['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  const keep = new Set(list);
  const removed = [];
  for (const f of tracked) {
    if (keep.has(f)) continue;
    fs.rmSync(path.join(into, ...f.split('/')), { force: true });
    removed.push(f);
    // 비게 된 폴더는 지운다
    let d = path.dirname(path.join(into, ...f.split('/')));
    while (d !== into && fs.existsSync(d) && !fs.readdirSync(d).length) {
      fs.rmdirSync(d);
      d = path.dirname(d);
    }
  }
  fs.cpSync(out, into, { recursive: true, force: true });
  const a = git(into, ['add', '-A']);
  if (a.status !== 0) stop(`git add 실패: ${a.stderr}`);
  // add 뒤 스테이지 목록이 새 트리 파일과 지운 파일 밖으로 나가지 않았는지, 경로에 비공개 이름이 없는지 본다.
  const staged = git(into, ['diff', '--cached', '--name-only', '-z', '--no-renames']).stdout.split('\0').filter(Boolean);
  const allowed = new Set([...list, ...removed]);
  const stray = staged.filter((f) => !allowed.has(f));
  if (stray.length) stop(`새 트리에 없는 파일이 스테이지에 올랐습니다(git reset은 직접 하세요):\n${stray.slice(0, 10).join('\n')}`);
  const { names } = namesTool.privateNamesFrom();
  const pathHits = namesTool.scanText(staged.join('\n'), names, '스테이지 경로');
  if (pathHits.length) stop(`스테이지 경로에 비공개 이름이 있습니다: ${pathHits.map((h) => h.name).join(', ')}`);
  log(`공개 저장소 폴더에 얹음: 지운 파일 ${removed.length}개, 스테이지 ${staged.length}개, git add까지 함`);
  log(`커밋(직접 실행): git -C "${into}" commit -F "${messageFile}"`);
  return { removed };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const kit = path.resolve(o.kit ?? path.join(__dirname, '..'));
  const out = path.resolve(o.out ?? path.join(mkTmp('tree'), 'tree'));
  const tracked = trackedSet(kit);
  const { list, omitted } = await buildTree({ kit, out, bundles: o.bundles, tracked });
  log(`트리: ${out} (파일 ${list.length}개, 뺀 묶음 ${omitted.length}개)`);
  const { messageFile, version } = writeChanges({ kit, out });
  list.push(CHANGES_OUT);
  const finalList = [...new Set(list)].sort();
  log(`버전 ${version}, 커밋 메시지 파일: ${messageFile}`);

  // 정의 검사(뺀 묶음을 가리키는 걸침은 오류가 아니어야 한다)
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'subagent-system', 'scripts', 'kitBundles.js')).href);
  const d2 = mod.loadDefinitions({ kitRoot: out, configDir: mkTmp('emptycfg') });
  const bad = d2.problems.filter((p) => p.level === 'error');
  if (bad.length) stop(`공개판 묶음 정의 오류:\n${bad.map((p) => `  ${p.msg}`).join('\n')}`);

  privateNameCheck({ out, messageFile, expectedFiles: finalList.length });
  if (o.check) {
    const defPub = path.join(os.homedir(), 'programming', 'claude-token-save');
    const oldFrom = o.oldFrom ? path.resolve(o.oldFrom) : o.into ? path.resolve(o.into) : fs.existsSync(path.join(defPub, '.git')) ? defPub : null;
    const r = await check({ out, kit, oldFrom });
    if (!r.ok) stop('--check 실패(위 줄 확인)');
    log('--check 통과');
  }
  if (o.into) putInto({ out, into: path.resolve(o.into), messageFile, remote: o.remote, list: finalList, kit, publicBase: o.publicBase });
}

if (require.main === module) {
  main().catch((e) => {
    if (e instanceof Stop) {
      process.stderr.write(`멈춤: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  });
}

module.exports = { PUBLIC_EXTRA, buildTree, writeChanges, privateNameCheck, putInto, main };
