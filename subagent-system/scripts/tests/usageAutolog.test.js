import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(SCRIPTS, '..', 'hooks', 'usage-autolog.js');
const KIT_RETRO = path.join(SCRIPTS, 'subagent-retro.js');
const REAL_USAGE = path.join(os.homedir(), '.claude', 'subagent-system', 'records', 'subagent-usage.tsv');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-autolog-'));
  const records = path.join(root, 'records');
  const sessionId = 'sess-1';
  const sessionFile = path.join(root, `${sessionId}.jsonl`);
  const subDir = path.join(root, sessionId, 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  return { root, records, sessionFile, subDir };
}

function writeSession(sb, cwd) {
  fs.writeFileSync(sb.sessionFile, JSON.stringify({ type: 'user', cwd, sessionId: 'sess-1' }) + '\n');
}

function assistant(id, ts, usage, content = []) {
  return JSON.stringify({ type: 'assistant', requestId: id, timestamp: ts, message: { id: `m-${id}`, model: 'claude-sonnet-5-5', usage, content } });
}

function writeAgent(sb, agentId, { description = '일 이름 시험', agentType = 'sonnet-low', lines } = {}) {
  const base = path.join(sb.subDir, `agent-${agentId}`);
  const body = lines ?? [
    assistant('r1', '2026-10-30T01:00:00.000Z', { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 5 }, [{ type: 'tool_use' }, { type: 'tool_use' }]),
    // 같은 요청의 앞선 줄은 마지막 줄만 센다.
    assistant('r2', '2026-10-30T01:00:20.000Z', { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1, output_tokens: 1 }, []),
    assistant('r2', '2026-10-30T01:00:30.000Z', { input_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 300, output_tokens: 7 }, [{ type: 'tool_use' }, { type: 'text' }]),
  ];
  fs.writeFileSync(`${base}.jsonl`, body.join('\n') + '\n');
  fs.writeFileSync(`${base}.meta.json`, JSON.stringify({ agentType, description }));
  return `${base}.jsonl`;
}

function input(sb, agentId, extra = {}) {
  return {
    session_id: 'sess-1',
    transcript_path: sb.sessionFile,
    cwd: '/somewhere/else',
    hook_event_name: 'SubagentStop',
    stop_hook_active: false,
    agent_id: agentId,
    agent_type: 'sonnet-low',
    agent_transcript_path: path.join(sb.subDir, `agent-${agentId}.jsonl`),
    last_assistant_message: '끝',
    ...extra,
  };
}

function runHook(sb, payload, extraEnv = {}) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), env: { ...process.env, SUBAGENT_RECORDS_DIR: sb.records, ...extraEnv }, encoding: 'utf8' });
}

const ROUTING = [
  '| | low | medium | high | xhigh |',
  '|:---|:---|:---|:---|:---|',
  '| **Haiku** | 시험 실행과 결과 정리(테스트, 빌드) | 파일 탐색과 검색 | | |',
  '| **Sonnet** | 원인이 확정된 작은 수정 | 구현, 구현 계획 실행 「(고정)」 | 코드 정리 검토(/simplify, 찾기만) 「(시험: `sonnet-low`)」 | |',
].join('\n');

function routingFile(sb, text = ROUTING) {
  const f = path.join(sb.root, 'ROUTING_TABLE.md');
  fs.writeFileSync(f, text);
  return { SUBAGENT_ROUTING_FILE: f };
}

const rowsOf = (sb) => {
  const f = path.join(sb.records, 'subagent-usage.tsv');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
};

test('SubagentStop 한 번이면 사용 기록에 9열 한 줄이 적힌다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111');
  const r = runHook(sb, input(sb, 'aaa111'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const rows = rowsOf(sb);
  assert.equal(rows.length, 1);
  const [date, project, def, kind, tokens, tools, secs, result, memo] = rows[0];
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(project, '/proj/app');
  assert.equal(def, 'sonnet-low');
  assert.equal(kind, '일 이름 시험');
  assert.equal(tokens, String(20 + 0 + 300 + 7));
  assert.equal(tools, '3');
  assert.equal(secs, '30');
  assert.equal(result, 'ok');
  assert.equal(memo, 'aaa111');
});

test('description에 라우팅 표의 일 이름이 있으면 일 종류 칸에 그 이름이 적히고 메모에 표에서 찾음이 붙는다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111', { description: '로그인 구현 마무리' });
  runHook(sb, input(sb, 'aaa111'), routingFile(sb));
  const [row] = rowsOf(sb);
  assert.equal(row[3], '구현');
  assert.equal(row[8], 'aaa111 표에서 찾음');
});

test('description에 표의 일 이름이 여럿 들면 가장 긴 이름이 적힌다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111', { description: '구현 계획 실행 1단계' });
  runHook(sb, input(sb, 'aaa111'), routingFile(sb));
  assert.equal(rowsOf(sb)[0][3], '구현 계획 실행');
});

test('description에서 표의 일 이름을 못 찾으면 description 그대로 적고 메모는 agentId뿐이다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111', { description: '표에 없는 일' });
  runHook(sb, input(sb, 'aaa111'), routingFile(sb));
  const [row] = rowsOf(sb);
  assert.equal(row[3], '표에 없는 일');
  assert.equal(row[8], 'aaa111');
});

test('라우팅 표 파일이 없으면 description 그대로 적는다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111', { description: '구현' });
  runHook(sb, input(sb, 'aaa111'), { SUBAGENT_ROUTING_FILE: path.join(sb.root, '없는 표.md') });
  const [row] = rowsOf(sb);
  assert.equal(row[3], '구현');
  assert.equal(row[8], 'aaa111');
});

test('같은 agentId로 두 번 불려도 한 줄만 적힌다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111');
  runHook(sb, input(sb, 'aaa111'));
  runHook(sb, input(sb, 'aaa111'));
  assert.equal(rowsOf(sb).length, 1);
});

test('같은 agentId의 훅이 동시에 돌아도 한 줄만 적힌다', async () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111');
  const run = () =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [HOOK], { env: { ...process.env, SUBAGENT_RECORDS_DIR: sb.records } });
      p.on('close', resolve);
      p.stdin.end(JSON.stringify(input(sb, 'aaa111')));
    });
  await Promise.all([run(), run(), run(), run()]);
  assert.equal(rowsOf(sb).length, 1);
});

test('agentId가 다르면 각각 한 줄씩 적힌다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111');
  writeAgent(sb, 'bbb222');
  runHook(sb, input(sb, 'aaa111'));
  runHook(sb, input(sb, 'bbb222'));
  assert.deepEqual(rowsOf(sb).map((r) => r[8]), ['aaa111', 'bbb222']);
});

test('메인이 같은 agentId의 줄을 덧붙인 뒤에도 훅은 다시 적지 않는다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111');
  fs.mkdirSync(sb.records, { recursive: true });
  fs.writeFileSync(path.join(sb.records, 'subagent-usage.tsv'), '2026-10-30\t/proj/app\tsonnet-low\t분석과 가공\t1\t1\t1\t재지시\taaa111 지시문 탓\n');
  runHook(sb, input(sb, 'aaa111'));
  assert.equal(rowsOf(sb).length, 1);
});

test('agent_type이 빈 내부 에이전트는 적지 않는다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111', { agentType: '' });
  runHook(sb, input(sb, 'aaa111', { agent_type: '' }));
  assert.equal(rowsOf(sb).length, 0);
});

test('afork- 로 시작하는 포크는 적지 않는다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'afork-1');
  runHook(sb, input(sb, 'afork-1'));
  assert.equal(rowsOf(sb).length, 0);
});

test('세션이 워크트리에서 시작했으면 프로젝트 칸에는 본 폴더 경로가 적힌다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app/.claude/worktrees/wt1');
  writeAgent(sb, 'aaa111');
  runHook(sb, input(sb, 'aaa111', { cwd: '/proj/app/.claude/worktrees/wt1/src' }));
  assert.equal(rowsOf(sb)[0][1], '/proj/app');
});

test('세션 기록을 못 읽으면 훅 입력의 cwd로 프로젝트를 적는다', () => {
  const sb = sandbox();
  writeAgent(sb, 'aaa111');
  runHook(sb, input(sb, 'aaa111', { transcript_path: path.join(sb.root, 'none.jsonl'), cwd: '/proj/other' }));
  assert.equal(rowsOf(sb)[0][1], '/proj/other');
});

test('서브에이전트 기록이 없으면 사용량 칸을 -로 두고 한 줄은 적는다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  runHook(sb, input(sb, 'ghost9'));
  const [row] = rowsOf(sb);
  assert.deepEqual(row.slice(2, 9), ['sonnet-low', '-', '-', '-', '-', 'ok', 'ghost9']);
});

test('description의 탭과 줄바꿈은 공백으로 바뀌어 열이 깨지지 않는다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111', { description: '앞\t뒤\n끝' });
  runHook(sb, input(sb, 'aaa111'));
  const [row] = rowsOf(sb);
  assert.equal(row.length, 9);
  assert.equal(row[3], '앞 뒤 끝');
});

test('깨진 입력이어도 종료 코드 0이고 기록은 만들어지지 않는다', () => {
  const sb = sandbox();
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', env: { ...process.env, SUBAGENT_RECORDS_DIR: sb.records }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(rowsOf(sb).length, 0);
});

test('훅이 적은 줄은 키트 --log 줄과 열 순서가 같고 키트가 에이전트로 읽는다', { skip: !fs.existsSync(KIT_RETRO) }, async () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111');
  runHook(sb, input(sb, 'aaa111'));
  const hookRow = rowsOf(sb)[0];

  const kitRecords = path.join(sb.root, 'kit-records');
  const logged = spawnSync(
    process.execPath,
    [KIT_RETRO, '--log', '--project', '/proj/app', '--def', 'sonnet-low', '--kind', '일 이름 시험', '--tokens', '327', '--tools', '3', '--secs', '30', '--result', 'ok', '--memo', 'aaa111', '--date', hookRow[0]],
    { env: { ...process.env, SUBAGENT_RECORDS_DIR: kitRecords }, encoding: 'utf8' }
  );
  assert.equal(logged.status, 0, logged.stderr);
  const kitRow = fs.readFileSync(path.join(kitRecords, 'subagent-usage.tsv'), 'utf8').trim().split('\t');
  assert.deepEqual(hookRow, kitRow);

  const helpers = await import(path.join(SCRIPTS, 'subagentRetroHelpers.js'));
  const parsed = helpers.parseUsage(fs.readFileSync(path.join(sb.records, 'subagent-usage.tsv'), 'utf8'));
  assert.equal(parsed.all[0].agentId, 'aaa111');
  assert.equal(parsed.all[0].def, 'sonnet-low');
});

test('시험은 실제 사용 기록 파일을 바꾸지 않는다', () => {
  const sb = sandbox();
  writeSession(sb, '/proj/app');
  writeAgent(sb, 'aaa111');
  const before = fs.existsSync(REAL_USAGE) ? fs.statSync(REAL_USAGE).size : -1;
  runHook(sb, input(sb, 'aaa111'));
  const after = fs.existsSync(REAL_USAGE) ? fs.statSync(REAL_USAGE).size : -1;
  assert.equal(after, before);
});
