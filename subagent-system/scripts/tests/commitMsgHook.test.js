import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { hasFile } from './fixtures/installedLayout.js';

const require = createRequire(import.meta.url);

const SUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIT_DIR = path.join(SUB, 'hooks', 'git');
const HOOK = path.join(GIT_DIR, 'commit-msg');
const WHY = path.join(GIT_DIR, 'commit-msg.d', '20-why-premise.cjs');
const REVIEW = path.join(GIT_DIR, 'commit-msg.d', '30-review-line.cjs');
const BEFORE_U3 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'git', 'commit-msg-before-u3.cjs');
// commit-msg 훅은 설치 때 고르는 선택 훅이라 고르지 않은 설치본에는 파일이 없다. 그때는 이 시험 전체를 건너뛴다(설치본 시험이 실패로 보고되지 않게).
const SKIP = fs.existsSync(HOOK) ? false : '설치본에 commit-msg 훅이 없음(선택 훅을 고르지 않음)';
// 근거 검사 조각은 work-git 묶음, 점검 줄 조각은 피드백 묶음의 것이다. 안 깐 묶음의 조각을 시험하는 단언은 건너뛴다.
const NO_WHY = hasFile('subagent-system/hooks/git/commit-msg.d/20-why-premise.cjs') ? false : '설치본에 work-git 묶음의 근거 검사 조각이 없음';
const NO_REVIEW = hasFile('subagent-system/hooks/git/commit-msg.d/30-review-line.cjs') ? false : '설치본에 피드백 묶음의 점검 줄 조각이 없음';
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const WHY_AND_PREMISE = '제목\n\n왜: 까닭\n전제: 믿은 사실\n';
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'CLAUDE_CONFIG_DIR'));

// 설치본 모양의 임시 설정 폴더: 훅 폴더 전체와 조각이 부르는 모듈, 설정과 깐 상태 기록 견본.
// 검사 동작 시험은 설정 없는 사본으로 돌려 설치본 설정(off 등)에 흔들리지 않게 한다. 반환은 commit-msg 경로다.
function installedHook({ config, lock } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-isolated-'));
  const sub = path.join(root, 'subagent-system');
  fs.cpSync(GIT_DIR, path.join(sub, 'hooks', 'git'), { recursive: true });
  fs.mkdirSync(path.join(sub, 'scripts'), { recursive: true });
  for (const f of ['userSettings.cjs', 'kitInstalled.cjs']) fs.copyFileSync(path.join(SUB, 'scripts', f), path.join(sub, 'scripts', f));
  if (config !== undefined) fs.writeFileSync(path.join(sub, 'config.json'), config);
  if (lock !== undefined) fs.writeFileSync(path.join(sub, 'bundles.lock.json'), JSON.stringify({ lockVersion: 1, installed: Object.fromEntries(lock.map((n) => [n, { options: [], parts: {} }])) }));
  return path.join(sub, 'hooks', 'git', 'commit-msg');
}
const ISOLATED = SKIP ? HOOK : installedHook();

// git은 훅을 저장소 맨 위 폴더에서 돌린다. 시험도 저장소가 아닌 빈 임시 폴더에서 돌린다.
function runHook(message, hook = ISOLATED, cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-cwd-'))) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-'));
  const file = path.join(dir, 'COMMIT_EDITMSG');
  fs.writeFileSync(file, message);
  return spawnSync(hook, [file], { encoding: 'utf8', cwd, env: gitEnv() });
}

describe('커밋 메시지 근거 검사 훅 commit-msg', { skip: SKIP || NO_WHY }, () => {
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
    assert.equal(spawnSync(ISOLATED, [], { encoding: 'utf8', env: gitEnv() }).status, 1);
  });

  describe('설치본의 config.json commitCheck', () => {
    it('commitCheck가 off이면 근거가 없는 메시지도 통과한다', () => {
      assert.equal(runHook('근거 없음\n', installedHook({ config: '{"commitCheck":"off"}' })).status, 0);
    });

    it('commitCheck가 block이거나 설정이 없거나 깨졌으면 검사한다', () => {
      for (const config of ['{"commitCheck":"block"}', undefined, '{']) assert.equal(runHook('근거 없음\n', installedHook({ config })).status, 1, String(config));
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

  it('결정 문서가 열려 있으면 다른 문서에 새 결정 표기를 넣는 커밋은 막히고, 대조 줄이 있거나 결정 문서 안이면 통과한다', { skip: spawnSync('git', ['--version']).status !== 0 }, () => {
    const git = (cwd, args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull },
    });
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-decision-'));
    const write = (f, text) => fs.writeFileSync(path.join(repo, f), text);
    const commit = (msgExtra = '') => git(repo, ['commit', '-m', '제목', '-m', `왜: 까닭\n전제: 믿은 사실${msgExtra}`]);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', '--local', 'core.hooksPath', path.dirname(ISOLATED)]);
    write('plan.md', '# 기획\n');
    git(repo, ['add', '.']);
    assert.equal(commit().status, 0);

    // 결정 문서가 없으면 결정 표기를 넣어도 통과한다
    write('plan.md', '# 기획\n- 광고 최대 3개(2026-10-31 사용자)\n');
    git(repo, ['add', '.']);
    assert.equal(commit().status, 0);

    // 표시를 글 속에서 설명만 하는 안내 문서는 결정 문서가 아니다
    write('guide.md', '# 안내\n- 결정 문서 머리에 `<!-- decision-doc -->` 표시를 둔다.\n');
    write('plan.md', '# 기획\n- 광고 최대 3개(2026-10-31 사용자)\n- 둘(2026-10-31 사용자 지시)\n');
    git(repo, ['add', '.']);
    assert.equal(commit().status, 0);

    // 결정 문서 안의 결정 표기는 통과한다
    write('overhaul.md', '<!-- decision-doc -->\n# 결정\n| 광고 | 최대 3개(2026-10-31 사용자) |\n');
    git(repo, ['add', '.']);
    assert.equal(commit().status, 0);

    // 열린 결정 문서가 있는데 다른 문서에 넣으면 막힌다. 날짜만 있거나 결정어만 있는 괄호는 표기가 아니다
    write('plan.md', '# 기획\n- 광고 최대 3개(2026-10-31 사용자)\n- 뺀 것(2026-11-01 사용자 지시, 이유)\n');
    git(repo, ['add', '.']);
    const bad = commit();
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /결정 문서\(overhaul\.md\)/);
    assert.match(bad.stderr, /plan\.md: - 뺀 것/);
    write('plan.md', '# 기획\n- 광고 최대 3개(2026-10-31 사용자)\n- 측정(2026-11-01)과 정리(사용자 몫)\n');
    git(repo, ['add', '.']);
    assert.equal(commit().status, 0);

    // 대조표대로 옮기는 커밋은 대조 줄로 통과한다
    write('plan.md', '# 기획\n- 뺀 것(2026-11-01 사용자 지시)\n');
    git(repo, ['add', '.']);
    assert.equal(commit('\n대조: overhaul.md 뺀 것 행').status, 0);
  });

  it('결정 문서에 1,000자가 넘는 표 행을 넣으면 막고, 다른 문서나 표가 아닌 줄은 길어도 통과한다', () => {
    const { checkRowLength } = require(WHY);
    const long = `| 항목 | ${'가'.repeat(1000)} |`;
    assert.match(checkRowLength(['d.md'], [['d.md', long]]), /1000자가 넘는 표 행/);
    assert.equal(checkRowLength(['d.md'], [['a.md', long]]), null);
    assert.equal(checkRowLength(['d.md'], [['d.md', '가'.repeat(1200)]]), null);
    assert.equal(checkRowLength(['d.md'], [['d.md', `| 항목 | ${'가'.repeat(900)} |`]]), null);
  });

  it('결정어는 config.json decisionWords를 따른다', () => {
    const { checkDecision } = require(WHY);
    const added = [['a.md', '- 정함(2026-10-31 팀장)']];
    assert.equal(checkDecision('제목\n', ['d.md'], added, ['사용자']), null);
    assert.match(checkDecision('제목\n', ['d.md'], added, ['사용자', '팀장']), /a\.md/);
  });

});

describe('점검 줄 검사 조각(피드백 묶음)', { skip: NO_REVIEW }, () => {
  it('막는 장치와 체계 스크립트를 고친 커밋은 점검 줄을 요구하고, 시험 파일과 다른 저장소의 scripts는 보지 않는다', () => {
    const { checkReview } = require(REVIEW);
    const m = '제목\n\n왜: 까닭\n전제: 사실\n';
    assert.match(checkReview(m, ['subagent-system/hooks/brief-check.js']), /점검:/);
    assert.match(checkReview(m, ['hooks/demo-guard.py']), /점검:/);
    assert.equal(checkReview(m + '점검: 되돌려 보기 200건 중 새로 막음 0\n', ['subagent-system/hooks/brief-check.js']), null);
    assert.equal(checkReview(m, ['subagent-system/scripts/tests/briefCheck.test.js']), null);
    assert.equal(checkReview(m, ['scripts/analytics-weekly.js', 'docs/a.md']), null);
    assert.equal(checkReview('Merge branch x\n', ['subagent-system/hooks/a.js']), null);
  });
});

// U3-10: 이어 부르는 새 꼴이 U3 전의 commit-msg(fixtures/git/commit-msg-before-u3.cjs)와 같은 입력에 같은 판정을 내는지 견준다.
// 깐 상태 기록에 work-git, feedback, 회사 규칙이 모두 있는 설치(대표의 지금 설치와 같은 조합)에서, 같은 저장소 색인과 같은 메시지로 둘을 돌려 종료 코드와 표준 에러를 대 본다.
describe('U3-10 이어 부르는 commit-msg는 U3 전의 commit-msg와 같은 판정을 낸다', { skip: SKIP || NO_WHY || NO_REVIEW || !HAS_GIT }, () => {
  const MESSAGES = [
    WHY_AND_PREMISE,
    '제목\n\n전제: 믿은 사실\n',
    '제목\n\n왜: 까닭\n',
    '제목만\n',
    '제목\n\n왜:\n전제: 믿은 사실\n',
    '제목\n\n왜: 까닭\n전제:   \n',
    '제목\n\n  왜： 까닭\n  전제 : 믿은 사실\n',
    '제목\n\n이건 왜: 라고 쓴 문장 전제: 도 있다\n',
    '제목\n\n# 왜: 주석\n# 전제: 주석\n',
    '제목\n\n# ------------------------ >8 ------------------------\n왜: 까닭\n전제: 믿은 사실\n',
    "Merge branch 'wt/x' into main\n",
    'fixup! 앞 커밋 제목\n',
    'squash! 앞 커밋 제목\n',
    'amend! 앞 커밋 제목\n',
    'feat: x\n\nMerge 설명\n',
    'feat: fixup! 아님\n',
    '# 주석만\n\n',
    `${WHY_AND_PREMISE}점검: 되돌려 보기 0건\n`,
    `${WHY_AND_PREMISE}대조: overhaul.md 뺀 것 행\n`,
  ];
  const STAGED = {
    '색인 비어 있음': {},
    '막는 장치를 고침': { 'subagent-system/hooks/demo-check.js': 'x\n', 'subagent-system/scripts/tests/a.test.js': 'y\n' },
    '시험 파일만 고침': { 'subagent-system/scripts/tests/a.test.js': 'y\n' },
    '결정 문서가 열려 있고 결정 표기를 더함': { 'overhaul.md': '<!-- decision-doc -->\n# 결정\n', 'plan.md': '# 기획\n- 뺀 것(2026-11-01 사용자 지시)\n' },
  };
  const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: gitEnv() });

  it('메시지 19개 × 색인 4가지에서 종료 코드와 표준 에러가 같다', () => {
    const next = installedHook({ config: JSON.stringify({ profile: 'personal', commitCheck: 'block' }), lock: ['base', 'work-git', 'feedback', 'company'] });
    const before = path.join(path.dirname(next), 'commit-msg-before-u3.cjs');
    fs.copyFileSync(BEFORE_U3, before);
    let blocked = 0;
    let passed = 0;
    for (const [label, files] of Object.entries(STAGED)) {
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-msg-compare-'));
      assert.equal(git(repo, 'init', '-q', '-b', 'main').status, 0);
      // 결정 문서와 계획 문서의 원래 줄은 이미 커밋돼 있어야 "더한 줄"이 색인 차이로 보인다.
      fs.writeFileSync(path.join(repo, 'base.txt'), '1\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '--no-verify', '-m', 'init');
      for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
        fs.writeFileSync(path.join(repo, rel), text);
      }
      git(repo, 'add', '-A');
      for (const message of MESSAGES) {
        const file = path.join(repo, '.git', 'COMMIT_EDITMSG');
        fs.writeFileSync(file, message);
        const oldRun = spawnSync(process.execPath, [before, file], { encoding: 'utf8', cwd: repo, env: gitEnv() });
        const newRun = spawnSync(next, [file], { encoding: 'utf8', cwd: repo, env: gitEnv() });
        const where = `${label} / ${JSON.stringify(message)}`;
        assert.equal(newRun.status, oldRun.status, `${where}: 종료 코드`);
        assert.equal(newRun.stderr, oldRun.stderr, `${where}: 표준 에러`);
        if (oldRun.status === 0) passed += 1;
        else blocked += 1;
      }
    }
    // 견줌이 한쪽으로만 쏠려 아무것도 대 보지 못한 시험이 되지 않게 한다.
    assert.ok(blocked >= 20, `막힌 입력 ${blocked}`);
    assert.ok(passed >= 20, `통과한 입력 ${passed}`);
  });
});
