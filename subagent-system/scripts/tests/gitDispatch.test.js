// git 훅 이어 부르기(hooks/git/commit-msg, pre-commit, git-dispatch.cjs와 조각)를 임시 저장소의 진짜 git 커밋으로 시험한다. 시험 이름의 U3-n은 설치 바닥 설계 9.4의 번호다.
// 임시 저장소마다 core.hooksPath를 임시 설정 폴더에 복사한 hooks/git에 걸고, 같은 설정 폴더에 config.json과 깐 상태 기록 견본을 둔다.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { missingFiles } from './fixtures/installedLayout.js';

const require = createRequire(import.meta.url);
const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const SKIP = !HAS_GIT ? 'git이 없음' : process.platform === 'win32' ? 'sh 훅은 Windows에서 Git Bash가 돌려 여기서는 건너뜀' : false;
const GOOD = '제목\n\n왜: 까닭\n전제: 믿은 사실\n';

const tmp = (p = 'git-dispatch-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (dir, rel, text) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_CONFIG_DIR' && k !== 'KIT_DRIFT_SKIP'));
const GIT_BIN = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

const lockOf = (names) => ({ lockVersion: 1, installed: Object.fromEntries(names.map((n) => [n, { options: [], parts: {} }])) });

// 설정 폴더(훅과 모듈 복사, config, 깐 상태 기록)와 그 훅을 거는 저장소를 만든다.
//   config   config.json 객체(null이면 파일 없음)
//   lock     깐 묶음 이름 목록(null이면 기록 파일 없음)
//   pieces   true면 진짜 조각을 그대로 두고, false면 .d 폴더를 비운다(시험이 직접 조각을 둠)
function rig({ config = { profile: 'personal', commitCheck: 'block' }, lock = ['base', 'work-git', 'feedback', 'company'], pieces = true } = {}) {
  const cfg = tmp('git-dispatch-cfg-');
  const hooks = path.join(cfg, 'subagent-system', 'hooks', 'git');
  fs.cpSync(path.join(SUB, 'hooks', 'git'), hooks, { recursive: true });
  for (const f of ['userSettings.cjs', 'kitInstalled.cjs']) put(cfg, `subagent-system/scripts/${f}`, fs.readFileSync(path.join(SUB, 'scripts', f), 'utf8'));
  return finish(cfg, hooks, { config, lock, pieces });
}
function finish(cfg, hooks, { config, lock, pieces }) {
  if (!pieces) for (const d of ['commit-msg.d', 'pre-commit.d']) fs.rmSync(path.join(hooks, d), { recursive: true, force: true });
  if (config !== null) put(cfg, 'subagent-system/config.json', JSON.stringify(config));
  if (lock !== null) put(cfg, 'subagent-system/bundles.lock.json', JSON.stringify(lockOf(lock)));
  const repo = tmp('git-dispatch-repo-');
  const run = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', env: { ...gitEnv(), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull } });
  assert.equal(run('init', '-q', '-b', 'main').status, 0);
  assert.equal(run('config', '--local', 'core.hooksPath', hooks).status, 0);
  return {
    cfg,
    hooks,
    repo,
    run,
    stage: (rel, text) => {
      put(repo, rel, text);
      assert.equal(run('add', '-A').status, 0);
    },
    commit: (message = GOOD, extra = []) => run('commit', '-q', '--allow-empty', '-m', message, ...extra),
    setConfig: (c) => put(cfg, 'subagent-system/config.json', JSON.stringify(c)),
  };
}

// 조각을 직접 두는 도우미: 파일 이름 앞 숫자가 차례다.
const piece = (r, hook, file, body) => put(r.hooks, `${hook}.d/${file}`, body);
const logger = (name) => `'use strict';\nconst fs = require('node:fs');\nmodule.exports = { name: '${name}', run() { fs.appendFileSync(process.env.PIECE_LOG, '${name}\\n'); return null; } };\n`;

describe('git 훅 이어 부르기: 조각 부르기', { skip: SKIP }, () => {
  it('U3-1 조각 10-a와 20-b가 파일 이름 차례로 불린다', () => {
    const r = rig({ pieces: false });
    piece(r, 'commit-msg', '20-b.cjs', logger('b'));
    piece(r, 'commit-msg', '10-a.cjs', logger('a'));
    const log = path.join(r.cfg, 'piece.log');
    const withLog = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', GOOD], { cwd: r.repo, encoding: 'utf8', env: { ...gitEnv(), PIECE_LOG: log } });
    assert.equal(withLog.status, 0, withLog.stderr);
    assert.equal(fs.readFileSync(log, 'utf8'), 'a\nb\n');
  });

  it('앞 숫자는 숫자로 견준다(100이 20보다 뒤)', () => {
    const r = rig({ pieces: false });
    piece(r, 'commit-msg', '100-c.cjs', logger('c'));
    piece(r, 'commit-msg', '20-b.cjs', logger('b'));
    piece(r, 'commit-msg', '9-a.cjs', logger('a'));
    const log = path.join(r.cfg, 'piece.log');
    const res = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', GOOD], { cwd: r.repo, encoding: 'utf8', env: { ...gitEnv(), PIECE_LOG: log } });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.readFileSync(log, 'utf8'), 'a\nb\nc\n');
  });

  it('U3-2 조각 하나가 막는 말을 돌려주면 커밋이 실패하고 표준 에러에 그 말이 나온다', () => {
    const r = rig({ pieces: false });
    piece(r, 'commit-msg', '10-block.cjs', "module.exports = { name: 'block', run() { return '막는 말입니다 가나다'; } };\n");
    const res = r.commit();
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /막는 말입니다 가나다/);
  });

  it('U3-3 없는 모듈을 require하거나 문법이 틀린 조각은 커밋을 막고 조각 이름과 --no-verify를 알린다', () => {
    for (const [file, body] of [['10-missing.cjs', "require('./no-such-module-demo.cjs');\nmodule.exports = { name: 'm', run() { return null; } };\n"], ['20-syntax.cjs', 'module.exports = { name: ;\n']]) {
      const r = rig({ pieces: false });
      piece(r, 'commit-msg', file, body);
      const res = r.commit();
      assert.notEqual(res.status, 0, file);
      assert.ok(res.stderr.includes(file), `${file}: ${res.stderr}`);
      assert.match(res.stderr, /--no-verify/);
      assert.equal(r.commit(GOOD, ['--no-verify']).status, 0, '--no-verify로 건너뜀');
    }
  });

  it('U3-4 run이 던지는 조각은 커밋을 막고 같은 안내를 한다', () => {
    const r = rig({ pieces: false });
    piece(r, 'commit-msg', '10-throw.cjs', "module.exports = { name: 't', run() { throw new Error('폭발 데모'); } };\n");
    const res = r.commit();
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /10-throw\.cjs/);
    assert.match(res.stderr, /폭발 데모/);
    assert.match(res.stderr, /--no-verify/);
  });

  it('run 함수가 없는 조각도 막는다', () => {
    const r = rig({ pieces: false });
    piece(r, 'pre-commit', '10-norun.cjs', "module.exports = { name: 'x' };\n");
    const res = r.commit();
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /10-norun\.cjs/);
  });

  it('commitCheckOf는 off로 적혀 있을 때만 쉬고 키가 없거나 설정이 없으면 검사한다', () => {
    const { commitCheckOf } = require(path.join(SUB, 'hooks', 'git', 'gitHookShared.cjs'));
    assert.equal(commitCheckOf({ commitCheck: 'off' }), 'off');
    assert.equal(commitCheckOf({ commitCheck: 'block' }), 'block');
    assert.equal(commitCheckOf({ profile: 'company' }), 'block');
    assert.equal(commitCheckOf({}), 'block');
    assert.equal(commitCheckOf(null), 'block');
  });
});

describe('git 훅 이어 부르기: node와 저장소 자체 훅', { skip: SKIP }, () => {
  // git과 sh, dirname만 든 폴더를 PATH로 삼아 node가 없는 환경을 만든다.
  function narrowPath() {
    const bin = tmp('git-dispatch-bin-');
    for (const name of ['git', 'sh', 'dirname']) {
      const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
      fs.symlinkSync(found, path.join(bin, name));
    }
    const probe = spawnSync('sh', ['-c', 'command -v node'], { env: { PATH: bin }, encoding: 'utf8' });
    assert.notEqual(probe.status, 0, `좁힌 PATH에 node가 남아 있음: ${probe.stdout}`);
    return bin;
  }
  const repoHook = (r, name, body, mode = 0o755) => {
    put(r.repo, `.githooks/${name}`, body);
    fs.chmodSync(path.join(r.repo, '.githooks', name), mode);
  };

  it('U3-5 node가 없으면 키트 검사만 건너뛰고(안내 한 줄) 저장소의 .githooks/pre-commit은 돈다', () => {
    const r = rig();
    const marker = path.join(r.cfg, 'repo-hook-ran');
    repoHook(r, 'pre-commit', `#!/bin/sh\necho ran > '${marker}'\nexit 0\n`);
    const res = spawnSync(GIT_BIN, ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', '왜와 전제가 없어도 node가 없으면 키트 검사는 건너뜀'], { cwd: r.repo, encoding: 'utf8', env: { PATH: narrowPath(), HOME: os.homedir(), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull } });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /node가 없어 키트 검사를 건너뜁니다/);
    assert.ok(fs.existsSync(marker), '저장소 훅이 돎');
  });

  it('U3-6 .githooks/pre-commit이 exit 1이면 실패, exit 0이면 성공, 실행 권한이 없으면 건너뛰고 성공한다', () => {
    const r = rig();
    repoHook(r, 'pre-commit', '#!/bin/sh\necho 저장소검사실패 >&2\nexit 1\n');
    const bad = r.commit();
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /저장소검사실패/);
    repoHook(r, 'pre-commit', '#!/bin/sh\nexit 0\n');
    assert.equal(r.commit().status, 0);
    repoHook(r, 'pre-commit', '#!/bin/sh\nexit 1\n', 0o644);
    assert.equal(r.commit().status, 0, '실행 권한이 없으면 건너뜀');
  });

  it('U3-7 .githooks/commit-msg는 git이 준 인자(메시지 파일 경로)를 받는다', () => {
    const r = rig();
    const argsFile = path.join(r.cfg, 'args.txt');
    repoHook(r, 'commit-msg', `#!/bin/sh\necho "$@" > '${argsFile}'\nexit 0\n`);
    assert.equal(r.commit().status, 0);
    assert.match(fs.readFileSync(argsFile, 'utf8'), /COMMIT_EDITMSG/);
    // 저장소 commit-msg가 실패하면 커밋도 실패한다.
    repoHook(r, 'commit-msg', '#!/bin/sh\nexit 1\n');
    assert.notEqual(r.commit().status, 0);
  });

  it('U3-14 .d 폴더가 없어도(바닥만) 커밋은 성공하고 저장소 훅은 돈다', () => {
    const r = rig({ pieces: false });
    const marker = path.join(r.cfg, 'repo-hook-ran');
    repoHook(r, 'pre-commit', `#!/bin/sh\necho ran > '${marker}'\n`);
    const res = r.commit('왜와 전제가 없는 제목');
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(marker));
  });
});

// 이 절은 work-git(근거 검사), 피드백(점검 줄) 조각을 함께 쓴다. 하나라도 안 깐 설치에서는 건너뛴다.
const NO_PIECES = missingFiles('subagent-system/hooks/git/commit-msg.d/20-why-premise.cjs', 'subagent-system/hooks/git/commit-msg.d/30-review-line.cjs');
describe('git 훅 이어 부르기: 검사 켜기와 끄기', { skip: SKIP || NO_PIECES }, () => {
  const NO_WHY = '근거 없는 제목';
  const guarded = (r) => r.stage('hooks/demo-guard.py', 'print(1)\n');

  it('U3-8 commitCheck가 off이면 왜 없는 커밋도, 점검 없는 장치 커밋도 성공한다', () => {
    const r = rig({ config: { profile: 'personal', commitCheck: 'off' } });
    assert.equal(r.commit(NO_WHY).status, 0);
    guarded(r);
    assert.equal(r.commit('장치를 고침\n\n왜: 까닭\n전제: 사실').status, 0);
    // 같은 저장소에서 block이면 둘 다 막힌다.
    r.setConfig({ profile: 'personal', commitCheck: 'block' });
    assert.notEqual(r.commit(NO_WHY).status, 0);
    r.stage('hooks/demo-guard.py', 'print(2)\n');
    const res = r.commit('장치를 고침\n\n왜: 까닭\n전제: 사실');
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /점검:/);
  });

  // 설계 9.4 U3-9는 키가 없을 때 회사용 성공으로 적었으나, 메인이 사용 방식과 상관없이 검사로 정했다(느슨한 기본값은 신호 없이 꺼짐).
  it('U3-9 commitCheck 키가 없으면 회사용도 개인용도 검사한다', () => {
    for (const profile of ['company', 'personal']) {
      const bad = rig({ config: { profile } }).commit(NO_WHY);
      assert.notEqual(bad.status, 0, profile);
      assert.match(bad.stderr, /`왜:`/);
    }
  });

  it('U3-11 회사 규칙 묶음이 없으면 결정 표기 검사는 쉬고, 있으면 막는다', () => {
    const setup = (lock) => {
      const r = rig({ lock });
      r.stage('overhaul.md', '<!-- decision-doc -->\n# 결정\n');
      assert.equal(r.commit().status, 0);
      r.stage('plan.md', '# 기획\n- 뺀 것(2026-11-01 사용자 지시)\n');
      return r;
    };
    assert.equal(setup(['base', 'work-git', 'feedback']).commit().status, 0);
    const blocked = setup(['base', 'work-git', 'feedback', 'company']).commit();
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /결정 문서\(overhaul\.md\)/);
  });

  it('U3-12 feedback이 없으면 점검 줄 검사가, work-git이 없으면 왜 전제 검사가 쉰다', () => {
    const noFeedback = rig({ lock: ['base', 'work-git'] });
    guarded(noFeedback);
    assert.equal(noFeedback.commit('장치를 고침\n\n왜: 까닭\n전제: 사실').status, 0);
    const withFeedback = rig({ lock: ['base', 'work-git', 'feedback'] });
    guarded(withFeedback);
    assert.notEqual(withFeedback.commit('장치를 고침\n\n왜: 까닭\n전제: 사실').status, 0);

    assert.equal(rig({ lock: ['base', 'feedback'] }).commit(NO_WHY).status, 0);
    assert.notEqual(rig({ lock: ['base', 'work-git'] }).commit(NO_WHY).status, 0);
  });

  it('U3-13 깐 상태 기록이 없으면 깔린 것으로 보고 검사한다(지금 동작)', () => {
    const r = rig({ lock: null });
    assert.notEqual(r.commit(NO_WHY).status, 0);
    assert.equal(r.commit().status, 0);
  });

  it('설정 파일이 없거나 깨졌어도 검사한다', () => {
    assert.notEqual(rig({ config: null }).commit(NO_WHY).status, 0);
    const broken = rig({});
    put(broken.cfg, 'subagent-system/config.json', '{깨짐');
    assert.notEqual(broken.commit(NO_WHY).status, 0);
  });
});
