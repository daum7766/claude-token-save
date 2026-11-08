// 설치 바닥(빈 폴더에 깔기, 묶음 더하기와 빼기, 갱신, 제거)을 실제 키트 원본으로 끝까지 돌려 본다.
// 시험 이름의 U5-n은 설치 바닥 설계 9.4의 번호다. 장치 이름은 지어낸 것(demo-local, demo-guard)만 쓴다.
// 키트 원본에서만 돈다(설치본 배치에는 bundles 폴더가 없다). 원본은 임시 git 저장소로 복사해 쓰므로 작업 폴더의 커밋 여부와 상관없다.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { missingBundles, partialKit } from './fixtures/installedLayout.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NEW_FILES, loadDefinitions, entriesFor, selectableBundles, optionIds } from '../kitBundles.js';

const require = createRequire(import.meta.url);
const lockApi = require('../kitInstalled.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '..');
const KIT_SETUP = path.join(SCRIPTS, 'kit-setup.js');
const KIT_SRC = path.resolve(HERE, '..', '..', '..');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const SKIP = !HAS_GIT ? 'git이 없음' : !fs.existsSync(path.join(KIT_SRC, 'bundles', 'base', 'bundle.json')) ? '설치본 배치라 키트 원본이 없음' : false;
const FIXTURE = SKIP ? null : JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'entries-caa02fe.json'), 'utf8'));

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `install-base-${name}-`));
const put = (root, rel, text = 'x\n') => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof text === 'string' ? text : `${JSON.stringify(text, null, 2)}\n`);
  return f;
};
const get = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
const getJson = (root, rel) => JSON.parse(get(root, rel));
const exists = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CONFIG_DIR' && k !== 'NODE_TEST_CONTEXT' && !k.startsWith('SUBAGENT_') && !k.startsWith('GIT_') && k !== 'ASK_LOG_FILE' && k !== 'KIT_DRIFT_SKIP'));
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
const gitOk = (cwd, ...args) => {
  const r = git(cwd, ...args);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

// 명령 실행. 종료 코드와 JSON 결과를 함께 돌려준다.
const setup = (cfg, args, env = {}) => spawnSync(process.execPath, [KIT_SETUP, ...args], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg, ...env }, encoding: 'utf8' });
const setupJson = (cfg, args, env = {}) => {
  const r = setup(cfg, args, env);
  assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}${r.stdout.slice(0, 600)}`);
  return JSON.parse(r.stdout);
};

// 키트 원본 사본(임시 git 저장소). 정의와 설치 대상 파일만 담는다.
function makeKit() {
  const root = tmp('kit');
  for (const d of ['subagent-system', 'bundles', 'extras'].filter((x) => fs.existsSync(path.join(KIT_SRC, x)))) {
    fs.cpSync(path.join(KIT_SRC, d), path.join(root, d), { recursive: true, filter: (s) => !s.split(path.sep).includes('node_modules') });
  }
  gitOk(root, 'init', '-q');
  gitOk(root, 'add', '-A');
  gitOk(root, 'commit', '-q', '-m', 'kit');
  return root;
}

// 설치 폴더의 파일 목록(기준본 .kit-base 제외).
function walk(root) {
  const out = [];
  const visit = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === 'subagent-system/.kit-base') continue;
      if (e.isDirectory()) visit(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  visit(root, '');
  return out.sort();
}

const settingsOf = (cfg) => (exists(cfg, 'settings.json') ? getJson(cfg, 'settings.json') : {});
const commandsOf = (cfg) => Object.values(settingsOf(cfg).hooks ?? {}).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
const tagsOf = (cfg) => commandsOf(cfg).map((c) => /# kit:([\w./-]+)$/.exec(c)?.[1]).filter(Boolean).sort();
const lockOf = (cfg) => lockApi.readLock(cfg);

// 정의가 말하는 훅 이름표 목록. when 조건이 있는 훅은 config 값이 맞을 때만 낸다.
function definedTags(defs, config, bundles) {
  const out = [];
  for (const part of defs.parts) {
    if (part.bundle !== 'base' && !bundles.includes(part.bundle)) continue;
    for (const h of part.hooks ?? []) {
      if (h.when && config[h.when.config] !== h.when.equals) continue;
      out.push(`${part.bundle}/${h.name}`);
    }
  }
  return out.sort();
}

// 설치본에서 시험 전체를 돌린다(APPLY_GUIDE 「확인과 재시작」 단계와 같다). 실패가 0이어야 하고, 시험이 하나도 안 돌았으면 실패다.
// 안 깐 묶음의 파일을 읽는 시험은 설치본 쪽에서 건너뛰기 표시가 돼야 한다(tests/fixtures/installedLayout.js).
function runInstalledSuite(cfg) {
  const scripts = path.join(cfg, 'subagent-system', 'scripts');
  const files = fs.readdirSync(path.join(scripts, 'tests')).filter((f) => f.endsWith('.test.js')).sort().map((f) => `tests/${f}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: scripts, env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg, SUBAGENT_RECORDS_DIR: tmp('records') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      const num = (name) => Number(new RegExp(`^ℹ ${name} (\\d+)`, 'm').exec(out)?.[1] ?? NaN);
      const failing = out.includes('✖ failing tests:') ? out.slice(out.indexOf('✖ failing tests:')).replace(/\n\s+at .*/g, '').slice(0, 1500) : '';
      resolve({ code, pass: num('pass'), fail: num('fail'), failing });
    });
  });
}
// 여러 설치를 한꺼번에 돌리되 동시에 limit개까지만 돌려 시간 제한 시험이 흔들리지 않게 한다.
async function runInstalledSuites(cfgs, limit = 3) {
  const results = new Map();
  const queue = [...cfgs];
  await Promise.all(Array.from({ length: limit }, async () => {
    for (let cfg = queue.shift(); cfg; cfg = queue.shift()) results.set(cfg, await runInstalledSuite(cfg));
  }));
  return results;
}
function assertSuiteClean(label, r) {
  assert.equal(r.fail, 0, `${label}: 설치본 시험 실패 ${r.fail}\n${r.failing}`);
  assert.equal(r.code, 0, `${label}: 설치본 시험 종료 코드\n${r.failing}`);
  assert.ok(r.pass > 100, `${label}: 설치본에서 돈 시험이 너무 적다(${r.pass})`);
}

const KIT_DEFS = () => loadDefinitions({ kitRoot: KIT_SRC });
const ALL_BUNDLES = () => selectableBundles(KIT_DEFS());

describe('설치 바닥 빈 폴더 설치', { skip: SKIP }, () => {
  let kit;
  let sharedBase;
  before(() => {
    kit = makeKit();
    sharedBase = tmp('base-only');
    setupJson(sharedBase, ['install', '--kit', kit, '--profile', 'personal', '--bundles', 'none', '--options', 'none']);
  });

  it('U5-1 바닥만 깔면 바닥 파일만 놓이고, 등록은 ask-log 하나, 기록에는 base만 남으며, 이어 쓰는 명령이 모두 성공하고, 설치본 시험 전체가 실패 0이다', { timeout: 300000 }, async () => {
    const cfg = sharedBase;
    const defs = KIT_DEFS();
    const baseKeys = entriesFor(defs, { bundles: [], options: [] }).map((e) => e.key);
    for (const key of baseKeys) assert.ok(exists(cfg, key), key);
    const meta = new Set(['settings.json', 'subagent-system/config.json', 'subagent-system/bundles.lock.json', 'subagent-system/VERSION']);
    assert.deepEqual(walk(cfg).filter((f) => !meta.has(f) && !baseKeys.includes(f)), [], '바닥 밖의 파일이 놓였다');
    assert.deepEqual(tagsOf(cfg), ['base/ask-log']);
    assert.deepEqual(Object.keys(lockOf(cfg).installed), ['base']);
    assert.equal(exists(cfg, 'subagent-system/scripts/subagent-retro.js'), false);

    for (const args of [['bundles'], ['settings'], ['diff', '--kit', kit], ['uninstall', '--records', 'keep', '--dry-run']]) {
      const r = setup(cfg, args);
      assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}${r.stdout.slice(0, 400)}`);
    }

    // ask-log: PermissionRequest 견본 한 건이 permission-asks.jsonl 한 줄이 된다.
    const sample = { session_id: 's', agent_id: 'a', agent_type: 'sonnet-low', cwd: '/w', tool_name: 'Bash', tool_input: { command: 'ls /tmp' }, hook_event_name: 'PermissionRequest' };
    const hook = spawnSync(process.execPath, [path.join(cfg, 'subagent-system', 'hooks', 'ask-log.js')], { input: JSON.stringify(sample), env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
    assert.equal(hook.status, 0, hook.stderr);
    const rows = get(cfg, 'permission-asks.jsonl').split('\n').filter(Boolean);
    assert.equal(rows.length, 1);

    // 저장소 커밋: 키트 검사 조각이 없으니 저장소의 .githooks만 이어 부르고 성공한다.
    const repo = tmp('repo');
    gitOk(repo, 'init', '-q');
    put(repo, '.githooks/commit-msg', '#!/bin/sh\necho called >> "$(git rev-parse --show-toplevel)/.hook-called"\nexit 0\n');
    fs.chmodSync(path.join(repo, '.githooks', 'commit-msg'), 0o755);
    const commit = git(repo, '-c', `core.hooksPath=${path.join(cfg, 'subagent-system', 'hooks', 'git')}`, 'commit', '--allow-empty', '-q', '-m', '제목만 있는 커밋');
    assert.equal(commit.status, 0, commit.stderr);
    assert.equal(get(repo, '.hook-called'), 'called\n');

    // 설치본에서 시험 전체(맨 끝에 돌린다: 위 단언이 설치본 파일을 건드리지 않은 뒤)
    assertSuiteClean('바닥만', await runInstalledSuite(cfg));
  });

  it('U5-2 고를 수 있는 묶음을 하나씩 깔면 그 묶음 파일만 놓이고, 설치본 시험 전체가 실패 0이며, 훅이 견본 입력에 종료 0이다', { timeout: 900000 }, async () => {
    const defs = KIT_DEFS();
    const baseKeys = new Set(entriesFor(defs, { bundles: [], options: [] }).map((e) => e.key));
    const installs = new Map();
    for (const bundle of ALL_BUNDLES()) {
      const cfg = tmp(`one-${bundle}`);
      setupJson(cfg, ['install', '--kit', kit, '--profile', 'personal', '--bundles', bundle, '--options', 'default']);
      const own = entriesFor(defs, { bundles: [bundle], options: optionIds(defs).filter((o) => o.startsWith(`${bundle}.`)) });
      const ownKeys = own.filter((e) => e.bundle === bundle).map((e) => e.key);
      for (const key of ownKeys) assert.ok(exists(cfg, key), `${bundle}: ${key}`);
      // 다른 묶음의 파일이 따라 놓이지 않았다.
      const others = entriesFor(defs, { bundles: ALL_BUNDLES().filter((b) => b !== bundle), options: [] }).filter((e) => e.bundle !== bundle && e.bundle !== 'base' && !ownKeys.includes(e.key));
      for (const e of others) assert.equal(exists(cfg, e.key), false, `${bundle}를 깔았는데 ${e.bundle}의 ${e.key}가 놓였다`);
      assert.deepEqual(Object.keys(lockOf(cfg).installed).sort(), ['base', bundle].sort());

      installs.set(bundle, cfg);

      // 이 묶음이 거는 훅마다 견본 입력 한 번이 종료 0이다.
      const mine = tagsOf(cfg).filter((t) => t.startsWith(`${bundle}/`));
      for (const tag of mine) {
        const command = commandsOf(cfg).find((c) => c.endsWith(`# kit:${tag}`));
        const event = Object.entries(settingsOf(cfg).hooks).find(([, groups]) => groups.some((g) => g.hooks.some((h) => h.command === command)))[0];
        const input = { session_id: 's', agent_id: 'a', agent_type: 'sonnet-low', cwd: '/w', hook_event_name: event, tool_name: 'Bash', tool_input: { command: 'ls' } };
        const r = spawnSync(command.replace(/\s+#\s+kit:.*$/, ''), { shell: true, input: JSON.stringify(input), env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg, SUBAGENT_RECORDS_DIR: tmp('records') }, encoding: 'utf8' });
        assert.equal(r.status, 0, `${tag}\n${r.stderr}`);
      }
      assert.ok(baseKeys.size > 20);
    }
    // 묶음 하나만 깐 설치마다 설치본 시험 전체가 실패 0이다. 그 묶음의 파일과 안 깐 묶음의 파일을 읽는 시험은 건너뛰기로 표시돼야 한다.
    const results = await runInstalledSuites([...installs.values()]);
    for (const [bundle, cfg] of installs) assertSuiteClean(`${bundle}만 깐 설치`, results.get(cfg));
  });

  it('U5-3 모든 묶음과 기본 항목을 깔면 옛 설치 목록(caa02fe)의 파일이 모두 놓이고 훅 등록이 정의와 같으며, 설치본 시험 전체가 실패 0이다', { timeout: 600000, skip: partialKit() }, async () => {
    const cfg = tmp('all');
    setupJson(cfg, ['install', '--kit', kit, '--profile', 'personal', '--bundles', 'all', '--options', 'default']);
    const defs = KIT_DEFS();
    const chosen = lockedOptions(cfg);
    const installed = entriesFor(defs, { bundles: ALL_BUNDLES(), options: chosen });
    assert.ok(installed.length > 100);
    for (const e of installed) {
      assert.ok(exists(cfg, e.key), e.key);
      assert.equal(Boolean(fs.statSync(path.join(cfg, ...e.key.split('/'))).mode & 0o111), Boolean(e.exec), `${e.key} 실행 권한`);
    }
    // 고르지 않은 항목의 파일만 빠지고, 옛 설치 목록의 나머지는 모두 놓였다.
    const installedKeys = new Set(installed.map((e) => e.key));
    const unchosen = new Set(entriesFor(defs, { bundles: ALL_BUNDLES(), options: optionIds(defs) }).map((e) => e.key).filter((k) => !installedKeys.has(k)));
    for (const f of FIXTURE.all) {
      if (f.key.startsWith('subagent-system/scripts/tests/fixtures/') || unchosen.has(f.key)) continue;
      assert.ok(exists(cfg, f.key), `옛 설치 목록의 ${f.key}`);
    }
    const config = getJson(cfg, 'subagent-system/config.json');
    assert.deepEqual(tagsOf(cfg), definedTags(defs, config, ALL_BUNDLES()));
    assert.equal(NEW_FILES.length, 0);
    assertSuiteClean('모든 묶음', await runInstalledSuite(cfg));
  });
});

// 깐 기록에 남은 고른 항목을 묶음.항목 꼴로 모은다.
function lockedOptions(cfg) {
  const lock = lockOf(cfg);
  return Object.entries(lock.installed).flatMap(([bundle, v]) => (v.options ?? []).map((o) => (o.includes('.') ? o : `${bundle}.${o}`)));
}

const DEMO_BUNDLE = { name: 'demo-local', title: '데모 로컬', summary: '시험용 로컬 묶음', order: 90, selectable: true, alwaysRules: [], options: [], configKeys: [], uses: [], records: [] };
const DEMO_PART = {
  bundle: 'demo-local',
  part: 'guard',
  files: ['hooks/demo-guard.js'],
  hooks: [{ name: 'demo-guard', event: 'PreToolUse', matcher: 'Bash', command: 'node "$HOME/.claude/hooks/demo-guard.js"', timeout: 10 }],
};
const DEMO_FILE = '// demo-guard: 이 설치에서만 쓰는 장치\n';
function placeDemo(cfg) {
  put(cfg, 'subagent-system/local-bundles/demo-local/bundle.json', DEMO_BUNDLE);
  put(cfg, 'subagent-system/local-bundles/demo-local/guard.part.json', DEMO_PART);
  put(cfg, 'hooks/demo-guard.js', DEMO_FILE);
}
const demoRegistered = (cfg) => tagsOf(cfg).includes('demo-local/demo-guard');
const demoLocked = (cfg) => Boolean(lockOf(cfg)?.installed?.['demo-local']?.parts?.guard);

describe('로컬 조각이 있는 설치', { skip: SKIP }, () => {
  let kit;
  before(() => {
    kit = makeKit();
  });
  const installWithDemo = () => {
    const cfg = tmp('demo');
    placeDemo(cfg);
    setupJson(cfg, ['install', '--kit', kit, '--profile', 'personal', '--bundles', 'all', '--options', 'default']);
    // sync가 읽는 원본 자리
    const file = path.join(cfg, 'subagent-system', 'config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.kitSourcePath = kit;
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    return cfg;
  };

  it('U5-4 먼저 둔 로컬 조각의 훅이 이름표 꼴로 걸리고, 그 파일은 그대로이며 키트 기록에 들지 않는다', () => {
    const cfg = installWithDemo();
    assert.ok(demoRegistered(cfg), tagsOf(cfg).join('\n'));
    assert.ok(demoLocked(cfg));
    assert.equal(sha(get(cfg, 'hooks/demo-guard.js')), sha(DEMO_FILE));
    assert.equal(exists(cfg, 'subagent-system/.kit-base/hooks/demo-guard.js'), false);
    assert.equal(JSON.stringify(getJson(cfg, 'subagent-system/config.json').kitFileHashes ?? {}).includes('demo-guard'), false);
  });

  it('U5-5 update, sync, 묶음 빼기와 더하기, 사용 방식 바꾸기를 거쳐도 로컬 조각의 등록과 기록이 남고, 두 번째 update는 바꿀 것이 없다', { timeout: 300000, skip: missingBundles('work-git') }, () => {
    const cfg = installWithDemo();
    const stays = (label) => {
      assert.ok(demoRegistered(cfg), `${label}: 등록`);
      assert.ok(demoLocked(cfg), `${label}: 기록`);
      assert.equal(get(cfg, 'hooks/demo-guard.js'), DEMO_FILE, `${label}: 파일`);
    };
    setupJson(cfg, ['update', '--kit', kit]);
    stays('update 1');
    setupJson(cfg, ['sync']);
    stays('sync');
    setupJson(cfg, ['remove', '--bundles', 'work-git']);
    stays('remove work-git');
    setupJson(cfg, ['add', '--bundles', 'work-git']);
    stays('add work-git');
    setupJson(cfg, ['set-profile', 'company']);
    stays('set-profile company');
    setupJson(cfg, ['set-profile', 'personal']);
    stays('set-profile personal');
    setupJson(cfg, ['update', '--kit', kit]);
    const second = setupJson(cfg, ['update', '--kit', kit]);
    stays('update 2');
    const changed = (second.files ?? []).filter((f) => !['unchanged', 'same'].includes(f.status));
    assert.deepEqual(changed, [], '두 번째 update가 바꿀 것을 찾았다');
    assert.deepEqual(second.settings.hooks.added, []);
    assert.deepEqual(second.settings.hooks.removed, []);
  });

  it('U5-16 설치본의 kit-setup.js도 kitSourcePath가 있으면 그 원본의 정의로 source-of와 bundles를 답하고, 없으면 원본을 모른다고 멈춘다', () => {
    const cfg = installWithDemo();
    const installed = path.join(cfg, 'subagent-system', 'scripts', 'kit-setup.js');
    const run = (...args) => spawnSync(process.execPath, [installed, ...args], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
    const kitSide = JSON.parse(run('source-of', 'subagent-system/scripts/kitMerge.js').stdout);
    assert.equal(kitSide.origin, 'kit');
    assert.equal(kitSide.source, path.join(kit, 'subagent-system', 'scripts', 'kitMerge.js'));
    const localSide = run('source-of', 'hooks/demo-guard.js');
    assert.equal(localSide.status, 0, localSide.stderr);
    const localOut = JSON.parse(localSide.stdout);
    assert.equal(localOut.origin, 'local');
    assert.equal(localOut.source, null);
    assert.match(localOut.note, /원본에 내지 않음/);
    const names = JSON.parse(run('bundles', '--json').stdout).bundles.map((b) => b.name);
    assert.ok(names.includes('base') && names.includes('routing') && names.includes('demo-local'), names.join(','));

    // 관리자 표시가 없으면 정의를 못 읽는다(공개 사용자 설치의 지금 동작)
    const file = path.join(cfg, 'subagent-system', 'config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete config.kitSourcePath;
    fs.writeFileSync(file, JSON.stringify(config));
    assert.notEqual(run('source-of', 'subagent-system/scripts/kitMerge.js').status, 0);
  });

  it('U5-18 unowned는 키트 원본을 몰라도 키트 조각과 로컬 조각에 들지 않은 방법 파일만 찍고, --mark 뒤에는 새로 생긴 것만 새것으로 찍는다', () => {
    const cfg = installWithDemo();
    const file = path.join(cfg, 'subagent-system', 'config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete config.kitSourcePath;
    fs.writeFileSync(file, JSON.stringify(config));
    const installed = path.join(cfg, 'subagent-system', 'scripts', 'kit-setup.js');
    const records = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-unowned-rec-'));
    const run = (...args) => {
      const r = spawnSync(process.execPath, [installed, 'unowned', ...args], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg, SUBAGENT_RECORDS_DIR: records }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };
    const put = (rel) => {
      fs.mkdirSync(path.dirname(path.join(cfg, rel)), { recursive: true });
      fs.writeFileSync(path.join(cfg, rel), 'x\n');
    };
    put('docs/code/MY_FLOW.md');
    put('docs/plan/some-decision.md');
    const first = run('--mark');
    assert.deepEqual(first.new, ['docs/code/MY_FLOW.md']);
    put('rules/my-rule.md');
    assert.deepEqual(run().new, ['rules/my-rule.md']);
  });

  it('U5-13 remove로 뺀 로컬 묶음은 update, sync, add를 거쳐도 되살아나지 않고, 다른 묶음의 로컬 조각은 그대로다', { timeout: 300000, skip: missingBundles('work-git') }, () => {
    const cfg = installWithDemo();
    assert.ok(demoLocked(cfg));
    setupJson(cfg, ['remove', '--bundles', 'demo-local']);
    assert.equal(demoLocked(cfg), false, 'remove 직후 기록');
    assert.equal(demoRegistered(cfg), false, 'remove 직후 등록');
    assert.equal(get(cfg, 'hooks/demo-guard.js'), DEMO_FILE, '로컬 파일은 남는다');
    for (const args of [['update', '--kit', kit], ['sync'], ['add', '--bundles', 'work-git'], ['set-profile', 'company'], ['update', '--kit', kit]]) {
      setupJson(cfg, args);
      assert.equal(demoLocked(cfg), false, `${args[0]} 뒤 기록`);
      assert.equal(demoRegistered(cfg), false, `${args[0]} 뒤 등록`);
    }
  });

  it('U5-17 remove는 파일을 지우다 실패해도 훅 등록과 깐 상태 기록을 먼저 뺀 뒤다(도는 세션이 지워진 스크립트를 부르지 않게)', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? '권한 거절을 만들 수 없음' : false }, () => {
    const cfg = tmp('remove-order');
    setupJson(cfg, ['install', '--kit', kit, '--profile', 'personal', '--bundles', 'routing', '--options', 'none']);
    assert.ok(tagsOf(cfg).some((t) => t.startsWith('routing/')));
    const dir = path.join(cfg, 'agents');
    fs.chmodSync(dir, 0o500);
    try {
      const r = setup(cfg, ['remove', '--bundles', 'routing']);
      assert.notEqual(r.status, 0, '지우기가 막혔는데 성공으로 끝났다');
    } finally {
      fs.chmodSync(dir, 0o700);
    }
    assert.equal(tagsOf(cfg).some((t) => t.startsWith('routing/')), false, '훅 등록이 파일 지우기보다 늦게 빠졌다');
    assert.equal(Boolean(lockOf(cfg).installed.routing), false, '깐 상태 기록이 파일 지우기보다 늦게 빠졌다');
  });

  it('U5-14 settings.json은 임시 파일을 만들어 바꿔 끼우고(옛 파일의 다른 이름은 완전한 옛 글 그대로), 권한을 지키며, 임시 파일이 남지 않는다', () => {
    const cfg = tmp('swap');
    setupJson(cfg, ['install', '--kit', kit, '--profile', 'personal', '--bundles', 'routing', '--options', 'none']);
    const file = path.join(cfg, 'settings.json');
    const old = fs.readFileSync(file, 'utf8');
    assert.ok(tagsOf(cfg).some((t) => t.startsWith('routing/')));
    // 같은 파일에 다른 이름을 하나 더 건다. 제자리에 덮어쓰면 이 이름도 새 글이 되고, 바꿔 끼우면 옛 글이 그대로 남는다.
    const link = path.join(cfg, 'settings.link');
    fs.linkSync(file, link);
    fs.chmodSync(file, 0o600);
    setupJson(cfg, ['remove', '--bundles', 'routing']);
    assert.equal(fs.readFileSync(link, 'utf8'), old, '옛 이름이 반쯤 쓴 글을 봤다');
    assert.equal(tagsOf(cfg).some((t) => t.startsWith('routing/')), false);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, '권한이 바뀌었다');
    assert.deepEqual(fs.readdirSync(cfg).filter((f) => f.includes('.tmp-')), []);
  });

  it('U5-11 제거하면 로컬 조각 장치 등록도 빼고 그 파일은 남기며 키트 등록이 0이 된다', () => {
    const cfg = installWithDemo();
    const out = setupJson(cfg, ['uninstall', '--records', 'keep']);
    assert.match(JSON.stringify(out), /로컬 조각 장치 등록도 뺌/);
    assert.equal(get(cfg, 'hooks/demo-guard.js'), DEMO_FILE);
    assert.deepEqual(tagsOf(cfg), []);
    assert.equal(commandsOf(cfg).some((c) => /kit-hook\.cjs/.test(c)), false);
  });
});

describe('빼고 넣을 때 설치 값과 사용자 훅', { skip: SKIP }, () => {
  let kit;
  let fresh;
  before(() => {
    kit = makeKit();
    fresh = () => {
      const cfg = tmp('values');
      setupJson(cfg, ['install', '--kit', kit, '--profile', 'personal', '--bundles', 'all', '--options', 'default']);
      return cfg;
    };
  });

  it('U5-6 정의 description 줄, 체크리스트의 이 설치 줄, rates 값을 고치고 라우팅을 빼면 셋을 보관하고, 다시 더하면 되살리고 보관 항목이 0이다', { timeout: 300000 }, () => {
    const cfg = fresh();
    const agent = 'agents/opus-high.md';
    const checklist = 'subagent-system/docs/SUBAGENT_BRIEF_CHECKLIST.md';
    const rates = 'subagent-system/rates.json';
    const editedAgent = get(cfg, agent).replace('설계와 구현 계획 종합 검토', '내 일 이름');
    assert.notEqual(editedAgent, get(cfg, agent));
    put(cfg, agent, editedAgent);
    const editedChecklist = `${get(cfg, checklist)}\n## 이 설치에서 더한 줄\n\n### 절\n\n| 이 설치 줄 | 이유 |\n|:---|:---|\n| 내 줄 | 내 까닭 |\n`;
    put(cfg, checklist, editedChecklist);
    const rateJson = getJson(cfg, rates);
    const modelKey = Object.keys(rateJson).find((k) => !k.startsWith('_') && typeof rateJson[k] === 'object');
    rateJson[modelKey].input = 987;
    put(cfg, rates, rateJson);

    setupJson(cfg, ['remove', '--bundles', 'routing']);
    const kept = getJson(cfg, 'subagent-system/kept-values.json');
    assert.equal(Object.keys(kept).length, 3, Object.keys(kept).join('\n'));
    assert.equal(exists(cfg, agent), false);

    setupJson(cfg, ['add', '--bundles', 'routing']);
    assert.match(get(cfg, agent), /내 일 이름/);
    assert.match(get(cfg, checklist), /\| 내 줄 \| 내 까닭 \|/);
    assert.equal(getJson(cfg, rates)[modelKey].input, 987);
    assert.equal(exists(cfg, 'subagent-system/kept-values.json') ? Object.keys(getJson(cfg, 'subagent-system/kept-values.json')).length : 0, 0);
  });

  it('U5-7 이름표 없는 사용자 훅이 부르는 키트 파일은 묶음을 빼도 지우지 않고 알린다', () => {
    const cfg = fresh();
    const file = 'subagent-system/scripts/work-metrics.js';
    assert.ok(exists(cfg, file));
    const s = settingsOf(cfg);
    s.hooks.Stop = [...(s.hooks.Stop ?? []), { hooks: [{ type: 'command', command: `node "${path.join(cfg, file).split(path.sep).join('/')}"` }] }];
    put(cfg, 'settings.json', s);
    const out = setupJson(cfg, ['remove', '--bundles', 'routing']);
    assert.ok(exists(cfg, file), '사용자 훅이 부르는 파일이 지워졌다');
    assert.match(JSON.stringify(out), /work-metrics\.js/);
    assert.ok(commandsOf(cfg).some((c) => c.includes('work-metrics.js')), '사용자 훅 등록이 지워졌다');
  });

  it('U5-9 회사용으로 깔면 쓰기 허용 훅이 걸리지 않고, 왜와 전제가 없는 커밋도 성공한다', () => {
    const cfg = tmp('company');
    setupJson(cfg, ['install', '--kit', kit, '--profile', 'company', '--bundles', 'all', '--options', 'default']);
    assert.equal(tagsOf(cfg).includes('routing/retro-write-allow'), false);
    assert.equal(commandsOf(cfg).some((c) => c.includes('retro-write-allow')), false);
    const repo = tmp('repo');
    gitOk(repo, 'init', '-q');
    const commit = git(repo, '-c', `core.hooksPath=${path.join(cfg, 'subagent-system', 'hooks', 'git')}`, 'commit', '--allow-empty', '-q', '-m', '왜와 전제가 없는 제목');
    assert.equal(commit.status, 0, commit.stderr);
  });
});

// 옛 커밋이 없는 얕은 복제에서는 건너뛴다.
const NO_OLD_COMMIT = SKIP || (spawnSync('git', ['-C', KIT_SRC, 'cat-file', '-e', 'caa02fe^{commit}']).status === 0 ? false : '옛 커밋 caa02fe가 저장소에 없음');
describe('옛 설치에서 갱신', { skip: NO_OLD_COMMIT }, () => {
  it('U5-8 옛 키트(caa02fe)로 깐 설치를 새 update로 갱신하면 기록을 추정하고 옛 훅 등록을 이름표 꼴로 바꾸며 이전 파일을 잃지 않는다', { timeout: 300000 }, () => {
    const oldKit = tmp('old-kit');
    const archive = spawnSync('git', ['-C', KIT_SRC, 'archive', 'caa02fe'], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
    assert.equal(archive.status, 0);
    const tar = spawnSync('tar', ['-x', '-C', oldKit], { input: archive.stdout });
    assert.equal(tar.status, 0);
    gitOk(oldKit, 'init', '-q');
    gitOk(oldKit, 'add', '-A');
    gitOk(oldKit, 'commit', '-q', '-m', 'old kit');
    const cfg = tmp('old-install');
    const oldSetup = path.join(oldKit, 'subagent-system', 'scripts', 'kit-setup.js');
    // 옛 설치가 고르는 규칙은 늘 깔리는 셋(core, routing, feedback)을 뺀 나머지이고 이름은 .md를 뗀 파일명이다.
    const oldRules = fs.readdirSync(path.join(oldKit, 'subagent-system', 'rules')).filter((f) => !['kit-core.md', 'kit-routing.md', 'kit-feedback.md'].includes(f)).map((f) => f.replace(/\.md$/, ''));
    const oldSkills = fs.readdirSync(path.join(oldKit, 'subagent-system', 'skills')).filter((n) => n !== 'retro');
    const oldInstall = spawnSync(process.execPath, [oldSetup, 'install', '--kit', oldKit, '--profile', 'personal', '--rules', oldRules.join(','), '--skills', oldSkills.join(','), '--hooks', 'commit-msg'], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
    assert.equal(oldInstall.status, 0, oldInstall.stderr + oldInstall.stdout.slice(0, 500));
    const before = walk(cfg);
    assert.equal(exists(cfg, 'subagent-system/bundles.lock.json'), false);
    assert.equal(tagsOf(cfg).length, 0, '옛 설치는 이름표가 없다');

    const kit = makeKit();
    const out = setupJson(cfg, ['update', '--kit', kit]);
    assert.ok(out.lock?.estimated, '기록을 추정했다고 알린다');
    const lock = lockOf(cfg);
    for (const b of ['base', 'routing', 'company', 'feedback']) assert.ok(lock.installed[b], `${b} 기록`);
    assert.ok(tagsOf(cfg).length >= 4, tagsOf(cfg).join('\n'));
    assert.equal(commandsOf(cfg).filter((c) => !/# kit:/.test(c) && /subagent-system\//.test(c)).length, 0, '이름표 없는 옛 키트 등록이 남았다');
    // 그 전 파일이 모두 있거나 백업으로 남는다.
    const after = new Set(walk(cfg));
    const baks = [...after].filter((f) => /\.bak-/.test(f));
    const missing = before.filter((f) => !after.has(f) && !baks.some((b) => b.startsWith(`${f}.bak-`)) && f !== 'subagent-system/VERSION');
    assert.deepEqual(missing, []);
  });

  it('U5-15 옛 설치가 git-work 스킬만 골랐으면 update 결과가 work-git이 둘을 함께 깐다는 것과 commit-msg 검사가 생기는 것을 알린다', { timeout: 300000 }, () => {
    const oldKit = tmp('old-kit-skill');
    const archive = spawnSync('git', ['-C', KIT_SRC, 'archive', 'caa02fe'], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
    assert.equal(archive.status, 0);
    assert.equal(spawnSync('tar', ['-x', '-C', oldKit], { input: archive.stdout }).status, 0);
    gitOk(oldKit, 'init', '-q');
    gitOk(oldKit, 'add', '-A');
    gitOk(oldKit, 'commit', '-q', '-m', 'old kit');
    const cfg = tmp('old-skill-only');
    const oldSetup = path.join(oldKit, 'subagent-system', 'scripts', 'kit-setup.js');
    const oldInstall = spawnSync(process.execPath, [oldSetup, 'install', '--kit', oldKit, '--profile', 'personal', '--rules', 'none', '--skills', 'git-work', '--hooks', 'none'], { env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
    assert.equal(oldInstall.status, 0, oldInstall.stderr + oldInstall.stdout.slice(0, 500));
    assert.equal(exists(cfg, 'subagent-system/hooks/git/commit-msg'), false, '옛 설치는 commit-msg를 고르지 않았다');
    const out = setupJson(cfg, ['update', '--kit', makeKit()]);
    const notes = out.notes.join('\n');
    assert.match(notes, /git-work 스킬만 골랐지만 work-git 묶음은/);
    assert.match(notes, /commit-msg 훅을 고르지 않았습니다/);
  });
});

describe('묶음 넣고 빼기 되풀이와 실패 경로', { skip: SKIP }, () => {
  let kit;
  before(() => {
    kit = makeKit();
  });

  it('바닥만 깐 곳에서 묶음을 더하고 빼기를 세 번 되풀이해도 파일 목록과 훅 등록과 기록이 매번 같은 상태로 돌아온다', { timeout: 300000, skip: missingBundles('company', 'feedback', 'work-git', 'work-tests') }, () => {
    const cfg = tmp('loop');
    setupJson(cfg, ['install', '--kit', kit, '--profile', 'personal', '--bundles', 'none', '--options', 'none']);
    // 백업과 보관 파일, 설치 값 자리라 지우지 않는 라우팅 표는 비교에서 뺀다(뺄 때 notes로 알린다).
    const comparable = (f) => f !== 'subagent-system/kept-values.json' && f !== 'subagent-system/docs/ROUTING_TABLE.md' && !/\.bak-/.test(f);
    const baseFiles = walk(cfg).filter(comparable);
    const baseTags = tagsOf(cfg);
    const group = 'company,routing,feedback,work-git,work-tests';
    let withFiles = null;
    let withTags = null;
    for (let round = 1; round <= 3; round += 1) {
      setupJson(cfg, ['add', '--bundles', group, '--options', 'default']);
      const files = walk(cfg).filter(comparable);
      const tags = tagsOf(cfg);
      if (withFiles === null) {
        withFiles = files;
        withTags = tags;
        assert.ok(files.length > baseFiles.length && tags.length > baseTags.length);
      } else {
        assert.deepEqual(files, withFiles, `${round}번째 더한 뒤 파일 목록`);
        assert.deepEqual(tags, withTags, `${round}번째 더한 뒤 훅 등록`);
      }
      setupJson(cfg, ['remove', '--bundles', group]);
      assert.deepEqual(walk(cfg).filter(comparable), baseFiles, `${round}번째 뺀 뒤 파일 목록`);
      assert.deepEqual(tagsOf(cfg), baseTags, `${round}번째 뺀 뒤 훅 등록`);
      assert.deepEqual(Object.keys(lockOf(cfg).installed), ['base'], `${round}번째 뺀 뒤 기록`);
    }
  });

  it('U5-10 새 명령의 스크립트가 원본에 없으면 dry-run도 멈추고 설치 폴더를 바꾸지 않는다', () => {
    const broken = makeKit();
    fs.rmSync(path.join(broken, 'subagent-system', 'hooks', 'kit-hook.cjs'));
    const part = path.join(broken, 'bundles', 'base', 'core.part.json');
    const def = JSON.parse(fs.readFileSync(part, 'utf8'));
    def.files = def.files.filter((f) => f !== 'subagent-system/hooks/kit-hook.cjs');
    fs.writeFileSync(part, `${JSON.stringify(def, null, 2)}\n`);
    gitOk(broken, 'add', '-A');
    gitOk(broken, 'commit', '-q', '-m', 'no wrapper');
    const cfg = tmp('dry');
    const r = setup(cfg, ['install', '--kit', broken, '--profile', 'personal', '--bundles', 'all', '--options', 'default', '--dry-run']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /새 명령의 스크립트 없음/);
    assert.deepEqual(fs.readdirSync(cfg), []);
  });

  it('U5-12 새 파일 목록(NEW_FILES)이 비어 있고 정의 점검에 오류도 경고도 없다', () => {
    assert.deepEqual(NEW_FILES, []);
    const defs = KIT_DEFS();
    assert.deepEqual(defs.problems.map((p) => `${p.level}: ${p.msg}`), []);
  });
});
