// 무엇: 안전장치 묶음의 막는 훅(rm-guard, git-discard-guard, supabase-sql-guard)을 표본 입력으로 돌려 통과, 물음, 거절과 까닭, 승인 창 기록을 본다.
// 왜: 이 훅들이 잘못 통과시키면 되살릴 수 없는 삭제와 운영 DB 변경이 확인 없이 일어나고, 잘못 막으면 사용자가 자리를 비운 동안 일이 선다.
// 전제: CLAUDE_CONFIG_DIR가 가리키는 임시 폴더의 config.json, USER_SETTINGS.md를 읽고, 기록 파일은 ASK_LOG_FILE로 임시 폴더에 돌린다.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { missingFiles } from './fixtures/installedLayout.js';

const HOOKS = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), 'hooks');
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'safety-guards-')));
const WT = path.join(ROOT, 'repo', '.claude', 'worktrees', 'w');
fs.mkdirSync(WT, { recursive: true });
const LOG = path.join(ROOT, 'asks.jsonl');

function cfg({ config, settings } = {}) {
  const d = fs.mkdtempSync(path.join(ROOT, 'cfg-'));
  fs.mkdirSync(path.join(d, 'subagent-system'), { recursive: true });
  if (config) fs.writeFileSync(path.join(d, 'subagent-system', 'config.json'), JSON.stringify(config));
  if (settings !== undefined) fs.writeFileSync(path.join(d, 'USER_SETTINGS.md'), `## 값\n${settings}\n`);
  return d;
}
function run(hook, input, dir) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, hook)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, ASK_LOG_FILE: LOG } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
}
const decision = (out) => (out ? out.permissionDecision : null);
const rm = (command, dir) => run('rm-guard.js', { tool_name: 'Bash', tool_input: { command }, cwd: WT }, dir);
const lastRow = () => JSON.parse(fs.readFileSync(LOG, 'utf8').trim().split('\n').pop());

const TEMP_DIRS = ['_temp', 'docs/_temp', '.superpowers'];

describe('rm-guard', () => {
  it('설정에 든 워크트리 임시 폴더 안은 통과하고, 그 밖의 실제 경로는 묻고, Claude 임시 폴더가 아닌 /tmp는 거절한다', () => {
    const d = cfg({ config: { safetyTempDirs: TEMP_DIRS } });
    const samples = [
      [`rm -rf ${WT}/_temp/a`, null],
      [`rm -rf ${WT}/docs/_temp/a`, null],
      [`rm -rf ${WT}/.superpowers/a`, null],
      [`rm -rf ${WT}/_temp`, null],
      [`rm -rf ${WT}/src/a`, 'ask'],
      [`rm -rf ${WT}/_tempx/a`, 'ask'],
      [`rm -rf ${ROOT}/repo/_temp/a`, 'ask'],
      [`rm -rf ${WT}/docs/other`, 'ask'],
      ['rm -rf /private/tmp/other/x', 'deny'],
    ];
    for (const [cmd, want] of samples) assert.equal(decision(rm(cmd, d)), want, cmd);
  });

  it('설정에 든 폴더만 통과하고 safetyTempDirs가 없거나 비거나 배열이 아니면 그 통과 갈래가 꺼져 묻는다', () => {
    const only = cfg({ config: { safetyTempDirs: ['scratch'] } });
    fs.mkdirSync(path.join(WT, 'scratch'), { recursive: true });
    assert.equal(rm(`rm -rf ${WT}/scratch/a`, only), null);
    assert.equal(decision(rm(`rm -rf ${WT}/_temp/a`, only)), 'ask');
    for (const c of [{ config: {} }, { config: { safetyTempDirs: [] } }, {}, { config: { safetyTempDirs: 'x' } }]) {
      assert.equal(decision(rm(`rm -rf ${WT}/_temp/a`, cfg(c))), 'ask', JSON.stringify(c));
    }
  });

  it('폴더 이름의 정규식 기호는 글자 그대로 본다', () => {
    const d = cfg({ config: { safetyTempDirs: ['a.b'] } });
    assert.equal(rm(`rm -rf ${WT}/a.b/x`, d), null);
    assert.equal(decision(rm(`rm -rf ${WT}/axb/x`, d)), 'ask');
  });

  it('같은 명령에서 mktemp -d로 만든 폴더와 반복문 안에서 글자 그대로 정한 경로는 읽고, 그 밖의 치환과 벗어나는 경로는 막는다', () => {
    const d = cfg({ config: { safetyTempDirs: TEMP_DIRS } });
    const SP = '/private/tmp/claude-501/x/scratchpad';
    const cases = [
      ['T=$(mktemp -d); rm -rf $T', null],
      ['T="$(mktemp -d -t trial)"; rm -rf "$T"', null],
      [`for v in a b; do T=${SP}/sim/tmp-$v; rm -rf $T; done`, null],
      ['T=$(mktemp -d); rm -rf $T/../x', 'deny'],
      ['T=$(mktemp -d); rm -rf $T/..', 'deny'],
      ['T=$(mktemp); rm -rf $T', 'deny'],
      [`T=$(ls -d ${SP}/a*); rm -rf $T`, 'deny'],
      ['for v in a b; do T=$U/x-$v; rm -rf $T; done', 'deny'],
      [`for v in a b; do T=${WT}/src/x-$v; rm -rf $T; done`, 'ask'],
    ];
    for (const [cmd, want] of cases) assert.equal(decision(rm(cmd, d)), want, cmd);
  });

  it('거절은 다시 쓰는 법을 붙여 알리고, 묻거나 거절할 때마다 승인 창 기록에 훅 이름과 까닭과 명령을 한 줄 남긴다', () => {
    const d = cfg();
    const denied = rm('rm -rf $NOPE', d);
    assert.equal(denied.permissionDecision, 'deny');
    assert.match(denied.permissionDecisionReason, /다시 쓰는 법/);
    assert.deepEqual([lastRow().hook, lastRow().input], ['rm-guard:deny', 'rm -rf $NOPE']);
    rm(`rm -rf ${WT}/src/b`, d);
    assert.deepEqual([lastRow().hook, lastRow().reason], ['rm-guard', `Claude 임시 폴더 밖 재귀 삭제: ${WT}/src/b`]);
  });
});

describe('rm-guard 휴지통 설정(deleteToTrash)', () => {
  const FILE = path.join(WT, 'src', 'one.txt');
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, 'x');
  const on = () => cfg({ config: { deleteToTrash: true, safetyTempDirs: TEMP_DIRS } });

  it('켜면 임시 폴더 밖의 rm(파일 하나와 폴더째)과 작업 트리에서도 지우는 git rm을 막고 휴지통 스크립트와 커밋 방법을 알린다', () => {
    const d = on();
    for (const cmd of [`rm ${FILE}`, `rm -f ${FILE}`, `rm -rf ${WT}/src`, 'git rm src/one.txt', 'git rm -rf src']) {
      const out = rm(cmd, d);
      assert.equal(decision(out), 'deny', cmd);
      assert.match(out.permissionDecisionReason, /scripts\/trash\.js" .+ 로 휴지통에 옮긴다/, cmd);
      assert.match(out.permissionDecisionReason, /git 안 파일은 옮긴 뒤 그 파일만 지정해 커밋한다/, cmd);
    }
    assert.equal(lastRow().hook, 'rm-guard:trash');
  });

  it('켜도 Claude 임시 폴더, 설정의 워크트리 임시 폴더, 캐시 삭제와 git rm --cached는 지금처럼 통과한다', () => {
    const d = on();
    for (const cmd of ['rm /private/tmp/claude-501/x/f', 'rm -rf /private/tmp/claude-501/x/d', `rm -rf ${WT}/_temp/a`, 'rm -rf a/__pycache__', 'T=$(mktemp -d); rm -rf $T', 'git rm --cached src/one.txt']) {
      assert.equal(rm(cmd, d), null, cmd);
    }
  });

  it('켜도 대상을 미리 알 수 없는 삭제는 다시 쓰는 법과 함께 거절한다', () => {
    const out = rm('rm $NOPE', on());
    assert.equal(decision(out), 'deny');
    assert.match(out.permissionDecisionReason, /값을 알 수 없는 변수로 삭제: \$NOPE 다시 쓰는 법/);
  });

  it('끄거나 값이 true가 아니면 재귀 아닌 rm과 -f 없는 git rm은 통과하고 폴더째 지우기는 지금처럼 묻는다', () => {
    for (const d of [cfg(), cfg({ config: { deleteToTrash: false } }), cfg({ config: { deleteToTrash: 'true' } })]) {
      assert.equal(rm(`rm ${FILE}`, d), null);
      assert.equal(rm('git rm -r src', d), null);
      assert.equal(decision(rm(`rm -rf ${WT}/src`, d)), 'ask');
    }
  });
});

describe('git-discard-guard', () => {
  const REPO = path.join(ROOT, 'gitrepo');
  fs.mkdirSync(REPO);
  const g = (...a) => spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8' });
  g('init', '-q');
  fs.writeFileSync(path.join(REPO, 'f.txt'), 'a\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x');
  fs.writeFileSync(path.join(REPO, 'f.txt'), 'b\n');
  const discard = (dir, command = 'git checkout -- f.txt') => run('git-discard-guard.js', { tool_name: 'Bash', tool_input: { command }, cwd: REPO }, dir);

  it('미커밋 변경이 있는 파일을 되돌리면 막고, --staged만 쓴 restore는 둔다', () => {
    assert.equal(decision(discard(cfg())), 'deny');
    assert.equal(discard(cfg(), 'git restore --staged f.txt'), null);
  });

  it('막는 까닭의 끝은 설정 문서의 호칭(끝의 님은 뗌)에게 묻게 하고, 호칭이 없으면 사용자에게 묻게 한다', () => {
    assert.match(discard(cfg({ settings: '- 호칭: 대표' })).permissionDecisionReason, /정말 버릴 것이면 대표에게 묻는다\.$/);
    assert.match(discard(cfg({ settings: '- 호칭: 팀장님' })).permissionDecisionReason, /정말 버릴 것이면 팀장에게 묻는다\.$/);
    assert.match(discard(cfg({})).permissionDecisionReason, /정말 버릴 것이면 사용자에게 묻는다\.$/);
  });
});

describe('git-discard-guard: stash', () => {
  const stash = (command) => run('git-discard-guard.js', { tool_name: 'Bash', tool_input: { command }, cwd: WT }, cfg());

  it('작업 트리나 보관함을 바꾸는 stash 꼴은 막고 까닭에 대체 방법을 싣는다', () => {
    const blocked = ['git stash', 'git stash -q', 'git stash -u', 'git stash push', 'git stash push -m x', 'git stash save x', 'git stash pop', 'git stash apply', 'git stash drop', 'git stash clear', 'git stash branch b', 'git -C x stash pop', 'cd x && git stash', 'git status && git stash pop'];
    for (const c of blocked) assert.equal(decision(stash(c)), 'deny', c);
    assert.match(stash('git stash').permissionDecisionReason, /다른 세션 변경을 치우거나 꺼낼 수 있다.*임시 커밋\(WIP\)/);
  });

  it('읽기만 하는 list와 show, 다른 git 명령, 커밋 메시지 안의 stash 글자는 둔다', () => {
    for (const c of ['git stash list', 'git stash show -p', 'git -C x stash list', 'git status && git stash show', 'git commit -m "stash 설명"', 'git log --grep stash', 'echo stash']) assert.equal(stash(c), null, c);
  });
});

describe('supabase-sql-guard', { skip: missingFiles('subagent-system/hooks/supabase-sql-guard.js') }, () => {
  const sql = (query) => run('supabase-sql-guard.js', { tool_name: 'mcp__supabase__execute_sql', tool_input: { query } }, cfg());

  it('조회와 INSERT는 통과하고 주석과 문자열 안의 낱말은 보지 않는다', () => {
    for (const q of ['select updated_at from t', "insert into t values ('drop')", '-- delete\nselect 1', '/* drop */ select 1']) assert.equal(sql(q), null, q);
  });

  it('데이터나 구조, 권한을 바꾸는 SQL은 바꾸는 낱말을 모아 묻고 기록에 남긴다', () => {
    const out = sql('update t set a = 1; DROP TABLE x');
    assert.equal(out.permissionDecision, 'ask');
    assert.match(out.permissionDecisionReason, /\(DROP, UPDATE\)/);
    assert.equal(lastRow().hook, 'supabase-sql-guard');
  });

  it('SQL을 읽지 못하면 묻는다', () => {
    assert.equal(decision(run('supabase-sql-guard.js', { tool_name: 'mcp__supabase__execute_sql', tool_input: {} }, cfg())), 'ask');
  });
});
