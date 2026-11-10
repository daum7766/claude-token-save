// 되돌려 견주는 도구(tools/kit-replay-diff.cjs)의 거짓 「차이 없음」 길을 시험한다.
// 왜: 도구가 셸의 기록 폴더 변수를 물려받아 기록 사본이 아닌 곳을 읽거나, 기록이 비어 두 판이 같은 빈 출력을 내면 「차이 없음」이 나와 고침의 부작용을 놓쳤다(2026-11-08 바퀴 6 판정).
// 키트 원본에서만 돈다(tools/는 설치하지 않는다).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TOOL = path.join(KIT, 'tools', 'kit-replay-diff.cjs');
const SKIP = fs.existsSync(TOOL) ? false : '설치본 배치라 tools/가 없음(키트 원본에서만 시험)';
const tool = SKIP ? {} : require(TOOL);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

describe('되돌려 견주기 도구의 자식 환경', { skip: SKIP }, () => {
  it('물려받은 설정 통로 변수를 모두 지우고 기록 사본 경로를 명시해 넘긴다', () => {
    const parent = { PATH: '/bin', HOME: '/h', SUBAGENT_RECORDS_DIR: '/real', SUBAGENT_CONFIG_FILE: '/real/c.json', KIT_HOOK_BLOCKS_FILE: '/real/b', CLAUDE_CONFIG_DIR: '/real', ANSWER_CHECK_RECORDS: '/real', FOO: 'x' };
    const env = tool.cleanEnv('/sandbox', {}, parent);
    assert.equal(env.SUBAGENT_RECORDS_DIR, path.join('/sandbox', 'subagent-system', 'records'));
    assert.equal(env.CLAUDE_CONFIG_DIR, '/sandbox');
    assert.equal(env.ANSWER_CHECK_RECORDS, path.join('/sandbox', 'subagent-system', 'records'));
    assert.equal(env.KIT_HOOK_BLOCKS_FILE, undefined);
    assert.equal(env.FOO, undefined);
    assert.equal(env.PATH, '/bin');
    assert.ok(env.SUBAGENT_CONFIG_FILE.startsWith('/sandbox'));
    assert.ok(env.TMPDIR.startsWith('/sandbox'));
  });
  it('지운 통로 이름을 알린다', () => {
    const names = tool.droppedChannels({ PATH: '/bin', SUBAGENT_RECORDS_DIR: '/real', KIT_HOOK_X: '1', FOO: 'x' });
    assert.deepEqual(names.sort(), ['KIT_HOOK_X', 'SUBAGENT_RECORDS_DIR']);
  });
});

describe('되돌려 견주기 도구의 빈 기록 거부', { skip: SKIP }, () => {
  const rec = (fixes) => {
    const d = tmp('replay-rec-');
    fs.mkdirSync(path.join(d, 'subagent-system', 'records'), { recursive: true });
    if (fixes !== null) fs.writeFileSync(path.join(d, 'subagent-system', 'records', 'fixes.tsv'), fixes);
    return d;
  };
  it('판정 쪽을 견주는데 고침 기록이 0줄이면 멈춘다', () => {
    assert.throws(() => tool.assertRecords({ judge: true }, rec('시각\t프로젝트\n'), null), /fixes\.tsv가 0줄/);
    assert.throws(() => tool.assertRecords({ judge: true }, rec(null), null), /fixes\.tsv가 0줄/);
    assert.deepEqual(tool.assertRecords({ judge: true }, rec('시각\n2026-11-08T00:00:00Z\tp\n'), null), { fixes: 1, blocks: 0 });
  });
  it('막는 훅 쪽을 견주는데 대화 기록 파일이 0개면 멈춘다', () => {
    assert.throws(() => tool.assertRecords({ judge: false }, rec('x\n'), 0), /대화 기록이 0개/);
    assert.doesNotThrow(() => tool.assertRecords({ judge: false }, rec('x\n'), 3));
  });
});

describe('안 본 막는 훅 목록', { skip: SKIP }, () => {
  const hooks = (...names) => names.map((name) => ({ name }));
  const WANT_ALL = { judge: true, stall: true, brief: true, decision: true, answer: true, light: true };
  it('되돌리지 못하는 막는 훅은 까닭과 함께 나오고, 되돌린 훅은 나오지 않는다', () => {
    const text = tool.unseenLines(WANT_ALL, hooks('stall-check', 'brief-check', 'answer-check', 'rm-guard')).join('\n');
    assert.match(text, /rm-guard:/);
    assert.match(text, /되돌려 본 것 3개/);
    assert.doesNotMatch(text, /stall-check:/);
  });
  it('이번 실행에서 --only로 뺀 훅은 안 본 훅으로 나온다', () => {
    const text = tool.unseenLines({ ...WANT_ALL, brief: false }, hooks('stall-check', 'brief-check')).join('\n');
    assert.match(text, /brief-check: .*--only에 brief이 없음/);
  });
  it('도구가 모르는 훅은 이름을 밝혀 안 본 것으로 나온다', () => {
    assert.match(tool.unseenLines(WANT_ALL, hooks('new-guard')).join('\n'), /new-guard: 이 도구가 모르는 훅/);
  });
  it('설치본 settings.json이 감싸개를 거치는 훅은 모두 이름이 있다', () => {
    const d = tmp('replay-settings-');
    fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$HOME/.claude/subagent-system/hooks/kit-hook.cjs" rm-guard' }, { type: 'command', command: 'node other.js' }] }] } }));
    assert.deepEqual(tool.wrappedHooks(d).map((h) => h.name), ['rm-guard']);
  });
});

describe('되돌려 견주기 실행: 셸 변수가 섞여도 같은 차이가 나오고, 빈 기록이면 멈춘다', { skip: SKIP }, () => {
  // 설치본 대신 작은 설정 폴더를 쓴다. 결정 대조 파일만 두 판에 다르게 줘서, 기록에 든 쓰기 호출 하나가 「거짓→참」으로 바뀌어야 한다.
  const fixture = (withTranscript) => {
    const cfg = tmp('replay-cfg-');
    fs.mkdirSync(path.join(cfg, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'hooks', 'decision-check.js'), 'function touches() { return false; }\n');
    fs.mkdirSync(path.join(cfg, 'subagent-system', 'records'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'subagent-system', 'records', 'fixes.tsv'), '시각\t프로젝트\n2026-11-08T00:00:00Z\t/p\n');
    fs.writeFileSync(path.join(cfg, 'settings.json'), '{}');
    fs.mkdirSync(path.join(cfg, 'projects', 'p'), { recursive: true });
    if (withTranscript) {
      const line = JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), cwd: '/x', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/x/a.md', content: 'a' } }] } });
      fs.writeFileSync(path.join(cfg, 'projects', 'p', 'aaaaaaaa-1111.jsonl'), `${line}\n`);
    }
    const base = path.join(tmp('replay-dc-'), 'base.js');
    const next = path.join(path.dirname(base), 'new.js');
    fs.writeFileSync(base, 'function touches() { return false; }\n');
    fs.writeFileSync(next, 'function touches() { return true; }\n');
    return { cfg, base, next };
  };
  const run = (fx, extraEnv = {}) => spawnSync(process.execPath, [TOOL, '--base', 'work', '--new', 'work', '--only', 'decision', '--decision-base', fx.base, '--decision-new', fx.next], {
    encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: fx.cfg, KIT_REPLAY_TMP: fx.cfg, ...extraEnv }, timeout: 120000,
  });
  const body = (out) => out.split('\n').filter((l) => /^설치본 결정 대조|^기록 사본/.test(l)).join('\n');

  it('기록 폴더 변수가 비어 있는 폴더를 가리켜도 같은 차이가 나온다', () => {
    const fx = fixture(true);
    const clean = run(fx);
    assert.equal(clean.status, 0, clean.stderr + clean.stdout);
    assert.match(clean.stdout, /설치본 결정 대조: 도구 호출 1번, 문서 고침으로 본 수 전 0 후 1, 바뀐 호출 1\(새로 참 1/);
    const empty = tmp('replay-empty-');
    const polluted = run(fx, { SUBAGENT_RECORDS_DIR: empty, SUBAGENT_CONFIG_FILE: path.join(empty, 'none.json'), KIT_HOOK_BLOCKS_FILE: path.join(empty, 'b.tsv') });
    assert.equal(polluted.status, 0, polluted.stderr + polluted.stdout);
    assert.equal(body(polluted.stdout), body(clean.stdout));
    assert.match(polluted.stdout, /물려받은 설정 통로 \d+개는 자식에게 넘기지 않음: .*SUBAGENT_RECORDS_DIR/);
  });
  it('대화 기록이 없으면 「차이 없음」을 찍지 않고 오류로 멈춘다', () => {
    const r = run(fixture(false));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /대화 기록이 0개/);
    assert.doesNotMatch(r.stdout, /차이 없음/);
  });
});

// 멈춤 검사의 실무자 칸과 예약을 대화 기록에서 되살리는 길.
// 왜: 칸을 빈 채로 넣어 「실무자 기다림」과 「예약 정리」 판정을 되살리지 못했고, 11-09 그 판정을 고칠 때 「바뀐 Stop 0」이 통과로 읽혔다(실제 막음은 70번 안팎).
describe('되돌려 견주기: 실무자 칸과 예약 되살리기', { skip: SKIP }, () => {
  const t0 = Date.parse('2026-11-09T10:00:00Z');
  const iso = (min) => new Date(t0 + min * 60000).toISOString();
  const use = (id, name, input, min) => ({ type: 'assistant', timestamp: iso(min), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
  const res = (id, toolUseResult, min) => ({ type: 'user', timestamp: iso(min), toolUseResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] } });
  const note = (id, status, summary, min) => ({ type: 'user', timestamp: iso(min), message: { role: 'user', content: `<task-notification>\n<task-id>${id}</task-id>\n${status ? `<status>${status}</status>\n` : ''}<summary>${summary}</summary>\n<result>긴 결과</result>\n</task-notification>` } });
  const feed = (...objs) => { const tr = new tool.BgTracker(); for (const o of objs) tr.feed(o); return tr; };
  const launch = (id, agentId, min, extra = {}) => [use(id, 'Agent', { description: `일 ${agentId}`, run_in_background: 'true', ...extra }, min), res(id, { status: extra.name ? 'teammate_spawned' : 'async_launched', agentId, description: `일 ${agentId}` }, min)];

  it('띄운 실무자는 돌고, 끝 알림이 오면 빠지고, 이름 붙인 실무자는 teammate다', () => {
    const tr = feed(...launch('u1', 'aa', 0), ...launch('u2', 'bb', 1, { name: 'lead' }));
    assert.deepEqual(tr.snapshot(t0 + 5 * 60000).tasks.map((t) => [t.id, t.type, t.status]), [['aa', 'subagent', 'running'], ['bb', 'teammate', 'running']]);
    tr.feed(note('aa', 'completed', 'Agent "일 aa" finished', 3));
    assert.deepEqual(tr.snapshot(t0 + 5 * 60000).tasks.map((t) => t.id), ['bb']);
  });
  it('뒤 작업을 기다린다는 알림은 칸에서 빼고, 기다림 알림 뒤 다시 일한 것으로 가려지면 돌게 한다', () => {
    const tr = feed(...launch('u1', 'aa', 0), note('aa', 'completed', 'Agent "일 aa" is waiting on its own background work', 2));
    assert.deepEqual(tr.snapshot(t0 + 5 * 60000).tasks, []);
    assert.deepEqual(tr.snapshot(t0 + 5 * 60000, (id, at) => id === 'aa' && at === t0 + 2 * 60000).tasks.map((t) => t.id), ['aa']);
  });
  it('끝난 실무자에게 메시지를 보내면 다시 돌고, TaskStop 성공은 칸에서 뺀다', () => {
    const tr = feed(...launch('u1', 'aa', 0), note('aa', 'completed', 'Agent "일 aa" finished', 2), use('m', 'SendMessage', { to: 'aa', message: '더' }, 3), res('m', { success: true }, 3));
    assert.deepEqual(tr.snapshot(t0 + 5 * 60000).tasks.map((t) => t.id), ['aa']);
    tr.feed(use('s', 'TaskStop', { task_id: 'aa' }, 4));
    tr.feed(res('s', { task_id: 'aa', message: 'Successfully stopped task: aa (x)' }, 4));
    assert.deepEqual(tr.snapshot(t0 + 5 * 60000).tasks, []);
  });
  it('셸은 명령과 함께 들고, Monitor는 만료되면 빠지며, 끝 알림 없이 6시간 넘긴 셸은 빼고 센다', () => {
    const tr = feed(use('b', 'Bash', { command: 'npm run dev', run_in_background: true }, 0), res('b', { backgroundTaskId: 'sh1' }, 0), use('m', 'Monitor', { description: '감시' }, 0), res('m', { taskId: 'mon1', timeoutMs: 300000 }, 0));
    const early = tr.snapshot(t0 + 60000).tasks;
    assert.deepEqual(early.map((t) => [t.id, t.type, t.command]), [['sh1', 'shell', 'npm run dev'], ['mon1', 'monitor', undefined]]);
    assert.deepEqual(tr.snapshot(t0 + 10 * 60000).tasks.map((t) => t.id), ['sh1']);
    assert.deepEqual(tr.snapshot(t0 + 7 * 3600000).tasks, []);
    assert.equal(tr.staleShells.size, 1);
  });
  it('띄웠는데 id를 못 읽은 작업은 센다', () => {
    const tr = feed(use('u', 'Agent', { description: 'x', run_in_background: 'true' }, 0), res('u', { weird: true }, 0));
    assert.equal(tr.stat.unresolved, 1);
    assert.deepEqual(tr.snapshot(t0 + 60000).tasks, []);
  });
  it('예약은 걸 때 들어가고, 지우면 빠지며, 한 번짜리는 울릴 시각이 지나면 빠진다', () => {
    const tr = feed(
      use('c1', 'CronCreate', { cron: '1 1 1 1 *', recurring: false, prompt: '<check-in> 뒤 작업 확인' }, 0), res('c1', { id: 'cr1', recurring: false, nextFireAt: t0 + 30 * 60000 }, 0),
      use('c2', 'CronCreate', { cron: '*/5 * * * *', recurring: true, prompt: '루프' }, 0), res('c2', { id: 'cr2', recurring: true }, 0),
    );
    assert.deepEqual(tr.snapshot(t0 + 10 * 60000).crons.map((c) => [c.id, c.recurring]), [['cr1', false], ['cr2', true]]);
    assert.deepEqual(tr.snapshot(t0 + 40 * 60000).crons.map((c) => c.id), ['cr2']);
    tr.feed(use('d', 'CronDelete', { id: 'cr2' }, 41));
    tr.feed(res('d', { id: 'cr2' }, 41));
    assert.deepEqual(tr.snapshot(t0 + 42 * 60000).crons, []);
  });
  it('알림 줄은 결과 글을 빼고 id, 끝 상태, 요약만 남기며 인용된 알림은 알림으로 세지 않는다', () => {
    const stub = tool.noteStub(note('aa', 'completed', 'Agent "x" is waiting on its own background work', 1));
    assert.doesNotMatch(JSON.stringify(stub), /긴 결과/);
    assert.deepEqual(tool.parseNotes(stub).map((n) => [n.id, n.status, n.waiting]), [['aa', 'completed', true]]);
    assert.equal(tool.noteStub({ type: 'user', timestamp: iso(0), message: { role: 'user', content: '앞 글 <task-notification><task-id>zz</task-id></task-notification>' } }), null);
  });
  it('실무자 기록 사본은 Stop 시각까지의 줄만 남기고 마지막 줄 시각을 파일 시각으로 둔다', () => {
    const d = tmp('replay-cut-');
    const src = path.join(d, 'agent-aa.jsonl');
    fs.writeFileSync(src, [0, 1, 2, 3, 4].map((m) => JSON.stringify({ type: 'assistant', timestamp: iso(m), n: m })).join('\n') + '\n');
    const got = tool.cutAgentFile(src, t0 + 2 * 60000 + 500, 1 << 20, d, new Map());
    assert.equal(got.lastAt, t0 + 2 * 60000);
    assert.deepEqual(fs.readFileSync(got.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l).n), [0, 1, 2]);
    assert.equal(Math.round(fs.statSync(got.file).mtimeMs), t0 + 2 * 60000);
    assert.equal(tool.cutAgentFile(src, t0 - 60000, 1 << 20, d, new Map()), null);
    assert.equal(tool.cutAgentFile(path.join(d, 'none.jsonl'), t0, 1 << 20, d, new Map()), null);
  });

  // 끝에서 끝까지: 대화 기록에 띄운 실무자가 돌고 있는 Stop은 「실무자 기다림」으로 막히고, 끝 알림이 온 Stop은 막히지 않는다.
  const stallRun = (events, withAgentFile = true) => {
    const cfg = tmp('replay-stall-');
    fs.mkdirSync(path.join(cfg, 'subagent-system', 'records'), { recursive: true });
    fs.mkdirSync(path.join(cfg, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'settings.json'), '{}');
    fs.mkdirSync(path.join(cfg, 'projects', 'p'), { recursive: true });
    const now = Date.now();
    const at = (min) => new Date(now - 3 * 3600000 + min * 60000).toISOString();
    const fix = (o, min) => ({ ...o, timestamp: at(min) });
    fs.writeFileSync(path.join(cfg, 'projects', 'p', 'bbbbbbbb-2222.jsonl'), `${events.map(([o, min]) => JSON.stringify(fix(o, min))).join('\n')}\n`);
    if (withAgentFile) {
      const sub = path.join(cfg, 'projects', 'p', 'bbbbbbbb-2222', 'subagents');
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, 'agent-aa.meta.json'), JSON.stringify({ description: '일 aa' }));
      fs.writeFileSync(path.join(sub, 'agent-aa.jsonl'), `${JSON.stringify({ type: 'assistant', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'text', text: '일하는 중' }], stop_reason: 'tool_use' } })}\n`);
    }
    const r = spawnSync(process.execPath, [TOOL, '--base', 'work', '--new', 'work', '--only', 'stall'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, KIT_REPLAY_TMP: cfg }, timeout: 120000 });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return r.stdout;
  };
  const stop = (min) => [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '실무자를 띄웠습니다. 결과를 기다립니다.' }], stop_reason: 'end_turn' } }, min];
  const lau = launch('u1', 'aa', 0);

  it('도는 실무자가 있는 Stop은 「실무자 기다림」으로 막히고 되살림 줄에 센다', () => {
    const out = stallRun([[lau[0], 0], [lau[1], 0], stop(2)]);
    assert.match(out, /실무자 기다림 1/);
    assert.match(out, /실무자 칸 되살림: Stop 1개 가운데 실무자나 셸이 든 Stop 1\(실무자가 든 Stop 1\)/);
  });
  it('끝 알림이 온 뒤의 Stop은 막히지 않는다', () => {
    const out = stallRun([[lau[0], 0], [lau[1], 0], [note('aa', 'completed', 'Agent "일 aa" finished', 1), 1], stop(2)]);
    assert.doesNotMatch(out, /실무자 기다림/);
    assert.match(out, /실무자가 든 Stop 0/);
  });
  it('막힌 Stop 뒤 이어 쓴 첫 Stop은 stop_hook_active가 참이라 같은 기다림으로 다시 막지 않는다', () => {
    const feedback = [{ type: 'user', message: { role: 'user', content: 'Stop hook feedback:\n실무자 기다림: ...' } }, 3];
    const out = stallRun([[lau[0], 0], [lau[1], 0], stop(2), feedback, stop(4)]);
    assert.match(out, /실무자 기다림 1(?!\d)/);
  });
  it('실무자 기록이 없어도 칸에는 두고 못 되살린 수에 센다', () => {
    const out = stallRun([[lau[0], 0], [lau[1], 0], stop(2)], false);
    assert.match(out, /기록이 없는 실무자 1/);
  });
});
