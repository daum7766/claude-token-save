import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(SUB, 'hooks', 'git', 'commit-msg');
// commit-msg 훅은 설치 때 고르는 선택 훅이라 고르지 않은 설치본에는 파일이 없다. 그때는 이 시험 전체를 건너뛴다(설치본 시험이 실패로 보고되지 않게).
const SKIP = fs.existsSync(HOOK) ? false : '설치본에 commit-msg 훅이 없음(선택 훅을 고르지 않음)';
const WHY_AND_PREMISE = '제목\n\n왜: 까닭\n전제: 믿은 사실\n';

// 설치본 훅은 설치본 config.json의 commitCheck를 읽는다. 검사 동작 시험은 설정 없는 사본으로 돌려 설치본 설정(off 등)에 흔들리지 않게 한다.
function isolatedHook() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-isolated-'));
  const hook = path.join(root, 'subagent-system', 'hooks', 'git', 'commit-msg');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.copyFileSync(HOOK, hook);
  fs.chmodSync(hook, 0o755);
  return hook;
}
const ISOLATED = SKIP ? HOOK : isolatedHook();

function runHook(message, hook = ISOLATED) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-'));
  const file = path.join(dir, 'COMMIT_EDITMSG');
  fs.writeFileSync(file, message);
  return spawnSync(process.execPath, [hook, file], { encoding: 'utf8' });
}

describe('커밋 메시지 근거 검사 훅 commit-msg', { skip: SKIP }, () => {
  it('훅 파일에 실행 권한이 있다', { skip: process.platform === 'win32' }, () => {
    assert.ok(fs.statSync(HOOK).mode & 0o111);
  });

  it('왜와 전제 줄이 모두 있으면 통과한다', () => {
    assert.equal(runHook(WHY_AND_PREMISE).status, 0);
  });

  it('왜 줄이 없으면 막고 왜가 빠졌다고 알린다', () => {
    const r = runHook('제목\n\n전제: 믿은 사실\n');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /`왜:`/);
    assert.doesNotMatch(r.stderr, /`전제:` 줄이 없습니다/);
  });

  it('전제 줄이 없으면 막고 전제가 빠졌다고 알린다', () => {
    const r = runHook('제목\n\n왜: 까닭\n');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /`전제:`/);
  });

  it('둘 다 없으면 막고 둘 다 알리며 무엇을, 왜, 전제를 안내한다', () => {
    const r = runHook('제목만\n');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /`왜:`, `전제:`/);
    assert.match(r.stderr, /무엇을/);
  });

  it('값이 비어 있는 왜: 줄은 없는 것으로 본다', () => {
    assert.equal(runHook('제목\n\n왜:\n전제: 믿은 사실\n').status, 1);
    assert.equal(runHook('제목\n\n왜: 까닭\n전제:   \n').status, 1);
  });

  it('전각 콜론과 줄 앞 공백이 있어도 줄로 읽는다', () => {
    assert.equal(runHook('제목\n\n  왜： 까닭\n  전제 : 믿은 사실\n').status, 0);
  });

  it('문장 중간의 왜:와 주석 줄 안의 왜와 전제는 세지 않는다', () => {
    assert.equal(runHook('제목\n\n이건 왜: 라고 쓴 문장 전제: 도 있다\n').status, 1);
    assert.equal(runHook('제목\n\n# 왜: 주석\n# 전제: 주석\n').status, 1);
  });

  it('편집기 가위선 아래의 diff에 있는 왜:는 세지 않는다', () => {
    assert.equal(runHook('제목\n\n# ------------------------ >8 ------------------------\n왜: 까닭\n전제: 믿은 사실\n').status, 1);
  });

  it('Merge 커밋과 fixup!, squash!, amend! 메시지는 통과한다', () => {
    for (const m of ["Merge branch 'wt/x' into main\n", 'fixup! 앞 커밋 제목\n', 'squash! 앞 커밋 제목\n', 'amend! 앞 커밋 제목\n']) {
      assert.equal(runHook(m).status, 0, m);
    }
  });

  it('Merge나 fixup!이 첫 줄이 아니면 면제하지 않는다', () => {
    assert.equal(runHook('feat: x\n\nMerge 설명\n').status, 1);
    assert.equal(runHook('feat: fixup! 아님\n').status, 1);
  });

  it('빈 메시지는 git이 알아서 중단하므로 훅은 통과시킨다', () => {
    assert.equal(runHook('# 주석만\n\n').status, 0);
  });

  it('인자가 없으면 오류로 끝난다', () => {
    assert.equal(spawnSync(process.execPath, [ISOLATED], { encoding: 'utf8' }).status, 1);
  });

  describe('설치본의 config.json commitCheck', () => {
    const installedHook = (config) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-installed-'));
      const hook = path.join(root, 'subagent-system', 'hooks', 'git', 'commit-msg');
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.copyFileSync(HOOK, hook);
      if (config !== undefined) fs.writeFileSync(path.join(root, 'subagent-system', 'config.json'), config);
      return hook;
    };

    it('commitCheck가 off이면 근거가 없는 메시지도 통과한다', () => {
      assert.equal(runHook('근거 없음\n', installedHook('{"commitCheck":"off"}')).status, 0);
    });

    it('commitCheck가 block이거나 설정이 없거나 깨졌으면 검사한다', () => {
      for (const config of ['{"commitCheck":"block"}', undefined, '{']) assert.equal(runHook('근거 없음\n', installedHook(config)).status, 1, String(config));
    });
  });

  it('실제 git에서 왜와 전제가 빠진 커밋은 막히고 갖춘 커밋은 만들어진다', { skip: spawnSync('git', ['--version']).status !== 0 }, () => {
    const git = (cwd, args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull },
    });
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-repo-'));
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', '--local', 'core.hooksPath', path.dirname(ISOLATED)]);
    fs.writeFileSync(path.join(repo, 'a.txt'), '1');
    git(repo, ['add', 'a.txt']);
    const bad = git(repo, ['commit', '-m', '근거 없음']);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /왜:/);
    const ok = git(repo, ['commit', '-m', '제목', '-m', '왜: 까닭\n전제: 믿은 사실']);
    assert.equal(ok.status, 0, ok.stderr);
  });
});
