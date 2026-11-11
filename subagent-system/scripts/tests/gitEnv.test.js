// git 훅을 저장소 설정(core.hooksPath) 대신 settings.json env(GIT_CONFIG_*)로 거는 방식(env 방식)을 시험한다.
//   (1) hooks/git/chain.sh: env로 들어온 훅은 허용 목록(git-hook-repos.txt)에 든 저장소에서만 키트 검사를 부르고, 이어서 저장소 원래 훅을 부른다.
//   (2) kit-setup --git-env: settings.json env의 세 키를 더하고, 빼고, 보인다. uninstall도 뺀다.
// 왜: 저장소 설정에 건 core.hooksPath는 그 저장소의 모든 커밋(다른 프로필, 터미널)에 걸리고, 그 저장소의 .git/hooks와 원래 core.hooksPath를 끈다.
//   env 방식은 이 설정 폴더로 뜬 Claude Code 세션의 git에만 걸리므로, 원래 훅이 빠지지 않는지와 허용 목록 밖에서 키트 검사가 쉬는지를 진짜 git 커밋으로 본다.
// 전제: 저장소 설정으로 거는 옛 방식(legacy)은 gitDispatch.test.js가 본다. 여기서는 env 방식만 본다.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KIT_SETUP = path.join(SUB, 'scripts', 'kit-setup.js');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const SKIP = !HAS_GIT ? 'git이 없음' : process.platform === 'win32' ? 'sh 훅은 Windows에서 Git Bash가 돌려 여기서는 건너뜀' : false;

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (dir, rel, text, mode) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  if (mode !== undefined) fs.chmodSync(f, mode);
  return f;
};
const real = (p) => fs.realpathSync(p);
const baseEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_CONFIG_DIR' && k !== 'KIT_DRIFT_SKIP'));
const logHook = (log, name) => `#!/bin/sh\necho ${name} >> '${log}'\n`;

// 설정 폴더(훅 복사, 허용 목록)와 저장소를 만든다. 키트 조각은 시험이 직접 둔다(진짜 조각은 gitDispatch.test.js가 본다).
function rig({ allow = false } = {}) {
  const cfg = real(tmp('git-env-cfg-'));
  const hooks = path.join(cfg, 'subagent-system', 'hooks', 'git');
  fs.cpSync(path.join(SUB, 'hooks', 'git'), hooks, { recursive: true });
  for (const d of ['commit-msg.d', 'pre-commit.d']) fs.rmSync(path.join(hooks, d), { recursive: true, force: true });
  for (const f of ['userSettings.cjs', 'kitInstalled.cjs']) put(cfg, `subagent-system/scripts/${f}`, fs.readFileSync(path.join(SUB, 'scripts', f), 'utf8'));
  put(cfg, 'subagent-system/config.json', JSON.stringify({ profile: 'personal', commitCheck: 'block' }));
  const repo = real(tmp('git-env-repo-'));
  const log = path.join(cfg, 'hook.log');
  const globalConfig = path.join(cfg, 'global.gitconfig');
  fs.writeFileSync(globalConfig, '');
  const env = (extra = {}) => ({
    ...baseEnv(), GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: os.devNull,
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooks, ...extra,
  });
  const git = (args, { cwd = repo, extra, input } = {}) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: env(extra), input });
  assert.equal(git(['init', '-q', '-b', 'main']).status, 0);
  const r = {
    cfg, hooks, repo, log, globalConfig, git,
    allow: (dir = repo) => fs.appendFileSync(path.join(cfg, 'subagent-system', 'git-hook-repos.txt'), `${dir}\n`),
    kitPiece: (hook, body) => put(hooks, `${hook}.d/10-test.cjs`, body),
    commit: (extra) => git(['commit', '-q', '--allow-empty', '-m', '제목'], { extra }),
    lines: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []),
  };
  if (allow) r.allow();
  return r;
}
const kitLogger = (log, name, block = false) => `'use strict';\nmodule.exports = { name: '${name}', run() { require('node:fs').appendFileSync('${log}', '${name}\\n'); return ${block ? "'키트가 막음'" : 'null'}; } };\n`;

describe('env 방식: chain.sh가 키트 검사와 저장소 원래 훅을 이어 부른다', { skip: SKIP }, () => {
  it('허용 목록 밖 저장소는 키트 검사를 부르지 않고 .git/hooks만 돈다', () => {
    const r = rig();
    r.kitPiece('pre-commit', kitLogger(r.log, 'kit'));
    put(r.repo, '.git/hooks/pre-commit', logHook(r.log, 'orig'), 0o755);
    const res = r.commit();
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(r.lines(), ['orig']);
  });

  it('허용 목록 안 저장소는 키트 검사가 먼저 돌고 이어서 .git/hooks가 돈다', () => {
    const r = rig({ allow: true });
    r.kitPiece('commit-msg', kitLogger(r.log, 'kit'));
    put(r.repo, '.git/hooks/commit-msg', logHook(r.log, 'orig'), 0o755);
    const res = r.commit();
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(r.lines(), ['kit', 'orig']);
  });

  it('키트 검사가 막으면 커밋이 실패하고 원래 훅은 돌지 않는다', () => {
    const r = rig({ allow: true });
    r.kitPiece('pre-commit', kitLogger(r.log, 'kit', true));
    put(r.repo, '.git/hooks/pre-commit', logHook(r.log, 'orig'), 0o755);
    const res = r.commit();
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /키트가 막음/);
    assert.deepEqual(r.lines(), ['kit']);
  });

  it('원래 훅이 실패하면 커밋도 실패한다', () => {
    const r = rig({ allow: true });
    put(r.repo, '.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n', 0o755);
    assert.notEqual(r.commit().status, 0);
  });

  it('저장소 설정의 core.hooksPath가 .githooks이면 허용 목록 안에서도 .githooks 훅은 한 번만 돈다', () => {
    const r = rig({ allow: true });
    put(r.repo, '.githooks/commit-msg', logHook(r.log, 'githooks'), 0o755);
    assert.equal(r.git(['config', '--local', 'core.hooksPath', '.githooks']).status, 0);
    const res = r.commit();
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(r.lines(), ['githooks']);
  });

  it('허용 목록 밖이고 저장소 설정의 core.hooksPath가 따로 있으면 그 폴더의 훅이 돈다(husky 같은 경우)', () => {
    const r = rig();
    put(r.repo, '.husky/pre-commit', logHook(r.log, 'husky'), 0o755);
    put(r.repo, '.git/hooks/pre-commit', logHook(r.log, 'git-hooks'), 0o755);
    assert.equal(r.git(['config', '--local', 'core.hooksPath', '.husky']).status, 0);
    assert.equal(r.commit().status, 0);
    assert.deepEqual(r.lines(), ['husky']);
  });

  it('저장소 설정에 없으면 전역 설정의 core.hooksPath를 원래 훅 폴더로 본다', () => {
    const r = rig();
    const globalHooks = real(tmp('git-env-global-hooks-'));
    put(globalHooks, 'pre-commit', logHook(r.log, 'global'), 0o755);
    fs.writeFileSync(r.globalConfig, `[core]\n\thooksPath = ${globalHooks}\n`);
    assert.equal(r.commit().status, 0);
    assert.deepEqual(r.lines(), ['global']);
  });

  it('키트가 검사하지 않는 훅(pre-push)도 원래 훅에 인자와 표준 입력을 그대로 넘긴다', () => {
    const r = rig({ allow: true });
    const out = path.join(r.cfg, 'push.txt');
    put(r.repo, '.git/hooks/pre-push', `#!/bin/sh\necho "$1" > '${out}'\ncat >> '${out}'\n`, 0o755);
    assert.equal(r.commit().status, 0);
    const remote = real(tmp('git-env-remote-'));
    assert.equal(spawnSync('git', ['init', '-q', '--bare', remote]).status, 0);
    const res = r.git(['push', '-q', remote, 'HEAD:refs/heads/main']);
    assert.equal(res.status, 0, res.stderr);
    const text = fs.readFileSync(out, 'utf8');
    assert.match(text, new RegExp(`^${remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`));
    assert.match(text, /refs\/heads\/main/);
  });

  it('허용 목록에 든 저장소의 worktree도 허용 목록 안으로 본다', () => {
    const r = rig({ allow: true });
    r.kitPiece('pre-commit', kitLogger(r.log, 'kit'));
    assert.equal(r.commit().status, 0);
    const wt = path.join(real(tmp('git-env-wt-')), 'wt');
    assert.equal(r.git(['worktree', 'add', '-q', wt, '-b', 'side']).status, 0);
    fs.rmSync(r.log, { force: true });
    const res = r.git(['commit', '-q', '--allow-empty', '-m', '제목'], { cwd: wt });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(r.lines(), ['kit']);
  });

  it('env로 들어왔어도 저장소 설정의 core.hooksPath가 이 폴더이면 허용 목록 밖이어도 옛 방식대로 키트 검사와 .githooks가 돈다', () => {
    const r = rig();
    r.kitPiece('commit-msg', kitLogger(r.log, 'kit'));
    put(r.repo, '.githooks/commit-msg', logHook(r.log, 'githooks'), 0o755);
    put(r.repo, '.git/hooks/commit-msg', logHook(r.log, 'git-hooks'), 0o755);
    assert.equal(r.git(['config', '--local', 'core.hooksPath', r.hooks]).status, 0);
    assert.equal(r.commit().status, 0);
    assert.deepEqual(r.lines(), ['kit', 'githooks']);
  });

  it('env를 걸지 않은 git(터미널, 다른 프로필)에서는 키트 훅이 끼어들지 않는다', () => {
    const r = rig({ allow: true });
    r.kitPiece('pre-commit', kitLogger(r.log, 'kit'));
    put(r.repo, '.git/hooks/pre-commit', logHook(r.log, 'orig'), 0o755);
    const res = r.commit({ GIT_CONFIG_COUNT: '0' });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(r.lines(), ['orig']);
    assert.equal(r.git(['config', '--local', '--get', 'core.hooksPath']).stdout, '', '저장소 설정에 아무것도 남기지 않는다');
  });
});

// kit-setup --git-env와 uninstall
const runKit = (cfg, ...args) => spawnSync(process.execPath, [KIT_SETUP, ...args], { encoding: 'utf8', env: { ...baseEnv(), CLAUDE_CONFIG_DIR: cfg } });
const settingsOf = (cfg) => JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));

describe('kit-setup --git-env', () => {
  const setup = (settings = { env: { KEEP: '1' } }) => {
    const cfg = real(tmp('git-env-kit-'));
    fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(settings));
    return { cfg, file: path.join(cfg, 'settings.json'), hooksPath: path.join(cfg, 'subagent-system', 'hooks', 'git').split(path.sep).join('/') };
  };

  it('on은 env에 세 키를 더하고 다른 env 키는 지키며, 다시 돌려도 같다', () => {
    const { cfg, file, hooksPath } = setup();
    const on = runKit(cfg, '--git-env', file, 'on');
    assert.equal(on.status, 0, on.stderr);
    const out = JSON.parse(on.stdout);
    assert.equal(out.changed, true);
    assert.ok(out.backup, '고치기 전 백업');
    assert.deepEqual(settingsOf(cfg).env, { KEEP: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hooksPath });
    const again = JSON.parse(runKit(cfg, '--git-env', file, 'on').stdout);
    assert.equal(again.changed, false);
    assert.equal(again.state, 'on');
  });

  it('env에 다른 GIT_CONFIG_ 값이 있으면 고치지 않고 오류로 멈춘다', () => {
    const { cfg, file } = setup({ env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x' } });
    const before = fs.readFileSync(file, 'utf8');
    const res = runKit(cfg, '--git-env', file, 'on');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /GIT_CONFIG_/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });

  it('off는 이 키트가 넣은 세 키만 빼고, status는 상태와 허용 목록을 보인다', () => {
    const { cfg, file } = setup();
    runKit(cfg, '--git-env', file, 'on');
    put(cfg, 'subagent-system/git-hook-repos.txt', '# 주석\n/a/repo\n\n');
    const st = JSON.parse(runKit(cfg, '--git-env', file, 'status').stdout);
    assert.equal(st.state, 'on');
    assert.deepEqual(st.repos, ['/a/repo']);
    const off = JSON.parse(runKit(cfg, '--git-env', file, 'off').stdout);
    assert.equal(off.changed, true);
    assert.deepEqual(settingsOf(cfg).env, { KEEP: '1' });
    assert.equal(JSON.parse(runKit(cfg, '--git-env', file, 'status').stdout).state, 'off');
  });

  const NO_KIT = fs.existsSync(path.resolve(SUB, '..', 'bundles', 'base', 'bundle.json')) ? false : '설치본 배치라 키트 원본이 없음';
  it('uninstall은 env의 세 키를 빼고 허용 목록은 지우지 않고 옆 백업으로 남긴다', { skip: NO_KIT }, () => {
    const { cfg, file } = setup();
    put(cfg, 'subagent-system/VERSION', '1\n');
    runKit(cfg, '--git-env', file, 'on');
    put(cfg, 'subagent-system/git-hook-repos.txt', '/a/repo\n');
    const res = runKit(cfg, 'uninstall', '--records', 'keep', '--kit', path.resolve(SUB, '..'));
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.gitEnvRemoved, true);
    assert.deepEqual(settingsOf(cfg).env, { KEEP: '1' });
    assert.ok(out.keptAsBackup.some((b) => /git-hook-repos\.txt\.bak-uninstall-/.test(b)));
  });
});
