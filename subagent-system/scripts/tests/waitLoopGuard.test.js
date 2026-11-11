// 무엇: 기다리는 반복문 막기 훅(wait-loop-guard)을 표본 입력으로 돌려 막음, 통과, 메인 차례 통과, heredoc과 따옴표 안 글 통과, .sh 파일 안 반복문 막음, 승인 창 기록을 본다.
// 왜: 이 훅이 헛막으면 서브에이전트가 정상 명령(짧은 sleep, 파일을 쓰기만 하는 heredoc)까지 못 쓰고, 못 막으면 반복문이 한 회차에 20번씩 시간을 버린다.
// 전제: 훅은 표준 입력의 JSON 하나만 보고 판정한다. 기록 파일은 ASK_LOG_FILE로 임시 폴더에 돌린다.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { missingFiles } from './fixtures/installedLayout.js';

const HOOK = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), 'hooks', 'wait-loop-guard.js');
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wait-loop-guard-')));
const LOG = path.join(ROOT, 'asks.jsonl');
const SCRIPTS = path.join(ROOT, 'scripts');
fs.mkdirSync(SCRIPTS, { recursive: true });

function run(command, { agent = true, cwd = ROOT } = {}) {
  const input = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd, session_id: 's1' };
  if (agent) input.agent_id = 'a1';
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ASK_LOG_FILE: LOG } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
}
const blocked = (command, opts) => run(command, opts)?.permissionDecision === 'deny';
const script = (name, body) => {
  const f = path.join(SCRIPTS, name);
  fs.writeFileSync(f, body);
  return f;
};

describe('wait-loop-guard', { skip: missingFiles('subagent-system/hooks/wait-loop-guard.js', 'subagent-system/hooks/guardShared.cjs') }, () => {
  it('until이나 while 반복문과 sleep이 함께 있는 명령은 한 줄이든 여러 줄이든 막고 알릴 말을 준다', () => {
    const cmds = [
      'until [ -s /x/out ]; do sleep 5; done',
      'while pgrep -f "kit-replay-diff.cjs --only stall" >/dev/null; do sleep 3; done; echo done',
      'cd /x && until grep -q DONE log.txt\ndo\n  sleep 2\ndone',
      'while ! test -s out; do sleep 1; done',
      "bash -c 'until [ -s out ]; do sleep 5; done'",
      'node a.js & while kill -0 $!; do sleep 1; done',
    ];
    for (const c of cmds) assert.ok(blocked(c), c);
    const out = run(cmds[0]);
    assert.match(out.permissionDecisionReason, /^결과를 기다리는 반복문은 막습니다\. 남은 일이 결과뿐이면 앞에서 돌리고\(제한 10분\), 뒤에서 돌렸으면 완료 알림을 받습니다\./);
  });

  it('30초 이상의 sleep은 막고 그 아래와 반복문 없는 짧은 sleep, 길이를 모르는 변수 sleep은 통과한다', () => {
    for (const c of ['sleep 100; cat out', 'sleep 30', 'sleep 1m', 'sleep 0.5 && sleep 30', 'sleep infinity', 'cd /x && sleep 45 && ls', '/bin/sleep 60']) assert.ok(blocked(c), c);
    for (const c of ['sleep 29', 'sleep 5 && ls', 'sleep 0.2', 'sleep $N', 'echo sleep 100', 'ls sleep']) assert.equal(blocked(c), false, c);
  });

  it('sleep 없는 반복문과 반복문 없는 명령은 통과한다', () => {
    for (const c of ['while read l; do echo "$l"; done < list.txt', 'until true; do echo x; break; done', 'for i in 1 2 3; do echo $i; done', 'npm test', 'git log --oneline | head']) assert.equal(blocked(c), false, c);
  });

  it('잠금을 얻으려고 차례를 기다리는 반복문(until mkdir, flock)은 통과하고, 서버가 뜨기를 기다리는 curl 반복문은 막으면서 curl 재시도로 기다리는 법을 알린다', () => {
    const lock = script('lock.sh', '#!/bin/bash\nLOCK=/tmp/x.lock\nuntil mkdir "$LOCK" 2>/dev/null; do\n  # 주인이 죽어 남은 잠금은 20분 뒤 푼다\n  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +20 2>/dev/null)" ]; then rmdir "$LOCK"; continue; fi\n  sleep 15\ndone\ntrap \'rmdir "$LOCK"\' EXIT\nnpx vitest run\n');
    for (const c of [lock, `bash ${lock} 2>&1 | tail -5`, 'until mkdir /tmp/l.d 2>/dev/null; do sleep 5; done', 'while ! mkdir "$L"; do sleep 2; done', 'until flock -n 9; do sleep 1; done']) assert.equal(blocked(c), false, c);
    assert.ok(blocked('until mkdir /tmp/l.d; do sleep 5; done; until [ -s out ]; do sleep 5; done'), '잠금 반복문 옆에 결과 기다림이 있으면 막는다');
    const out = run('(npm run dev &) ; until curl -s -o /dev/null http://localhost:5184/; do sleep 2; done');
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason, /curl --retry-connrefused/);
    assert.doesNotMatch(run('until grep -q done out.log; do sleep 2; done').permissionDecisionReason, /curl --retry/);
  });

  it('메인 차례(agent_id 없음)는 같은 명령도 통과한다', () => {
    assert.equal(blocked('until [ -s out ]; do sleep 5; done', { agent: false }), false);
    assert.equal(blocked('sleep 100', { agent: false }), false);
  });

  it('heredoc 본문과 따옴표 안 글은 명령으로 보지 않는다', () => {
    const cmds = [
      "cat > notes.md <<'EOF'\n기다릴 때: until [ -s out ]; do sleep 5; done 는 쓰지 않는다\nsleep 100\nEOF",
      'echo "until [ -s out ]; do sleep 5; done"',
      "grep -n 'sleep 100' docs/x.md",
      'git commit -m "while 반복문에서 sleep 120 을 걷는다"',
      'rg "sleep 60" subagent-system',
      "python3 - <<'PY'\nprint('while True: sleep(60)')\nPY",
    ];
    for (const c of cmds) assert.equal(blocked(c), false, c);
    assert.ok(blocked("bash <<'EOF'\nuntil [ -s out ]; do sleep 5; done\nEOF"), '셸에 넘기는 heredoc 본문은 셸 글이다');
  });

  it('반복문이 든 .sh 파일 실행을 막는다(경로, 인터프리터, source, 명령 안의 cd와 변수를 따라 풀기)', () => {
    const w = script('waitrun.sh', '#!/bin/sh\nwhile pgrep -f "tests/*.test.js" >/dev/null || pgrep -f x >/dev/null; do sleep 3; done\necho done\n');
    for (const c of [w, `bash ${w}`, `sh -e ${w}`, `source ${w}`, `${w}; cat log`, `nohup ${w} &`, `cd ${SCRIPTS} && ./waitrun.sh`, `cd ${SCRIPTS}; bash waitrun.sh`, `S=${SCRIPTS}; $S/waitrun.sh`]) {
      assert.ok(blocked(c), c);
    }
    assert.match(run(w).permissionDecisionReason, /waitrun\.sh 안/);
    const long = script('long.sh', '#!/bin/sh\nsleep 120\n');
    assert.ok(blocked(long), '30초 이상 sleep이 든 파일');
    const nested = script('outer.sh', `#!/bin/sh\nbash ${w}\n`);
    assert.ok(blocked(nested), '파일이 부르는 파일');
  });

  it('반복문 없는 .sh, 없는 파일, 구문 검사만 하는 실행, 주석 안의 반복문은 통과한다', () => {
    const ok = script('ok.sh', '#!/bin/sh\necho hi\nsleep 2\n');
    const commented = script('commented.sh', '#!/bin/sh\n# while true; do sleep 60; done 은 쓰지 않는다\necho hi\n');
    const loop = script('loop.sh', 'until [ -s out ]; do sleep 5; done\n');
    for (const c of [ok, `bash ${ok}`, commented, `bash ${path.join(SCRIPTS, 'nothing.sh')}`, `bash -n ${loop}`, `cat ${loop}`, `shellcheck ${loop}`, `git add ${loop}`, `./nothing-here.sh`]) assert.equal(blocked(c), false, c);
  });

  it('같은 명령에서 heredoc으로 쓴 .sh를 곧바로 실행하면 막고, 쓰기만 하면 통과한다', () => {
    const f = path.join(SCRIPTS, 'w2.sh');
    const body = `cat > ${f} <<'EOF'\n#!/bin/sh\nwhile pgrep -f x >/dev/null; do sleep 3; done\nEOF\nchmod +x ${f}`;
    assert.equal(blocked(body), false);
    assert.ok(blocked(`${body}; ${f}`));
    assert.ok(blocked(`${body}\nbash ${f}`));
  });

  it('막을 때마다 승인 창 기록에 훅 이름과 까닭과 명령을 한 줄 남기고, 통과한 호출은 남기지 않는다', () => {
    fs.rmSync(LOG, { force: true });
    run('sleep 5');
    assert.equal(fs.existsSync(LOG), false);
    run('until [ -s out ]; do sleep 5; done');
    const rows = fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hook, 'wait-loop-guard');
    assert.equal(rows[0].agent_id, 'a1');
    assert.equal(rows[0].tool, 'Bash');
    assert.match(rows[0].reason, /결과를 기다리는 반복문은 막습니다/);
    assert.equal(rows[0].input, 'until [ -s out ]; do sleep 5; done');
  });

  it('해석하지 못한 입력과 Bash가 아닌 도구, 명령이 글자가 아닌 입력은 통과한다', () => {
    for (const raw of ['not json', '{}', JSON.stringify({ tool_name: 'Read', agent_id: 'a', tool_input: { file_path: 'x' } }), JSON.stringify({ tool_name: 'Bash', agent_id: 'a', tool_input: { command: 42 } }), JSON.stringify({ tool_name: 'Bash', agent_id: 'a', tool_input: { command: "echo 'sleep 100" } })]) {
      const r = spawnSync(process.execPath, [HOOK], { input: raw, encoding: 'utf8', env: { ...process.env, ASK_LOG_FILE: LOG } });
      assert.equal(r.status, 0, raw);
      assert.equal(r.stdout.trim(), '', raw);
    }
  });
});
