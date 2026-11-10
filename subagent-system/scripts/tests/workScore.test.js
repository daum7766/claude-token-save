import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { foldExperiments, dueExperiments, compareRows } from '../work-metrics.js';
import { score, CRITIQUE, RESEND } from '../work-score.js';

const CLI = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'work-metrics.js');
const SESSION = '11111111-2222-3333-4444-555555555555';
const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

const T0 = Date.UTC(2026, 10, 1, 0, 0, 0);
const at = (min) => new Date(T0 + min * 60000).toISOString();
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-score-test-'));
  roots.push(root);
  const claude = path.join(root, 'claude');
  const records = path.join(root, 'records');
  const proj = path.join(claude, 'projects', '-work-proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(records, { recursive: true });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claude, SUBAGENT_RECORDS_DIR: records };
  const run = (args) => {
    const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', env });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  return { root, claude, records, proj, run };
}

const human = (m, text) => ({ type: 'user', timestamp: at(m), uuid: `h${m}`, cwd: '/work/proj', origin: { kind: 'human' }, message: { content: text } });
const stop = (m, body) => ({ type: 'user', timestamp: at(m), uuid: `s${m}`, cwd: '/work/proj', message: { content: `Stop hook feedback:\n${body}` } });
const pre = (m, body) => ({ type: 'user', timestamp: at(m), uuid: `p${m}`, cwd: '/work/proj', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: `PreToolUse:Agent hook error: ${body}` }] } });
const send = (m, id, to, message) => ({ type: 'assistant', timestamp: at(m), uuid: `a${m}`, requestId: `q${m}`, message: { id: `mm${m}`, content: [{ type: 'tool_use', id, name: 'SendMessage', input: { to, message } }], usage: { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 } } });

describe('score', () => {
  const rows = [
    human(1, '진행해줘'),
    human(2, '왜 안 했어?'),
    { type: 'user', timestamp: at(3), uuid: 'n1', cwd: '/work/proj', origin: { kind: 'task-notification' }, message: { content: '작업 알림' } },
    { type: 'user', timestamp: at(4), uuid: 'n2', cwd: '/work/proj', message: { content: '<task-notification>x</task-notification>' } },
    stop(5, '보내기 전 점검: 확인하라'),
    stop(6, '결정 알림 : 보내라'),
    pre(7, '서브에이전트 지시문을 보내기 전에 고쳐라\n- 목표: 줄 없음'),
    pre(8, '낯선 막음'),
    send(9, 't1', 'worker-a', '지시문의 규칙이 빠졌으니 고쳐 주세요'),
    send(10, 't2', 'worker-a', '다음 일을 해 주세요'),
    send(11, 't3', 'Another-session', '고쳐'),
    human(500000, '범위 밖'),
  ];

  it('사람 말, 되돌림, 갈래, 재지시, 지적, 토큰을 구간 안에서만 센다', () => {
    const env = setup();
    fs.writeFileSync(path.join(env.proj, `${SESSION}.jsonl`), jsonl(rows));
    const r = score({ since: T0, until: T0 + 100 * 60000, root: path.join(env.claude, 'projects'), config: null, kindOf: () => null });
    assert.equal(r.human, 2);
    assert.equal(r.mainEvents, 4);
    assert.equal(r.mainPerHuman, 2);
    assert.equal(r.critique, 1);
    assert.deepEqual(Object.keys(r.byLabel).sort(), ['(Pre 갈래 모름: Agent)', '결정 알림', '보내기 전 점검', '지시문 고쳐라']);
    assert.equal(r.resendSent, 2);
    assert.equal(r.resend, 1);
    assert.equal(r.mainTokens, 3 * 115);
  });

  it('CLI --json이 같은 값을 찍고 --project로 다른 프로젝트를 거른다', () => {
    const env = setup();
    fs.writeFileSync(path.join(env.proj, `${SESSION}.jsonl`), jsonl(rows));
    const args = ['score', '--since', at(0), '--until', at(100), '--json'];
    const a = JSON.parse(env.run(args).out);
    assert.equal(a.human, 2);
    const mine = JSON.parse(env.run([...args, '--project', '/work/proj']).out);
    assert.equal(mine.human, 2);
    const other = JSON.parse(env.run([...args, '--project', '/elsewhere']).out);
    assert.equal(other.human, 0);
    const text = env.run(['score', '--since', at(0), '--until', at(100)]).out;
    assert.match(text, /사람 말\(메인 대화\): 2 .*표본이 작음/);
    assert.match(text, /메인 되돌림: 4건, 사람 말당 2.00/);
  });

  it('설정의 일 종류 정규식으로 일 종류를 가른다', () => {
    const env = setup();
    fs.writeFileSync(path.join(env.proj, `${SESSION}.jsonl`), jsonl(rows.slice(0, 7)));
    const r = score({ since: T0, until: T0 + 100 * 60000, root: path.join(env.claude, 'projects'), config: { scoreKinds: { 문서: '문서' } } });
    assert.equal(r.humanByKind['대화와 기타'], 2);
  });

  it('지적과 재지시 꼴 정규식', () => {
    assert.ok(CRITIQUE.test('이거 빠졌네'));
    assert.ok(!CRITIQUE.test('좋아 진행해'));
    assert.ok(RESEND.test('다시 만들어 주세요'));
  });
});

describe('실험 장부', () => {
  it('add, list, due, close가 덧붙이기로 돌고 더봄은 날수를 다시 센다', () => {
    const env = setup();
    const add = env.run(['exp', 'add', '--what', '패널 걷기', '--why', '말마다 붙는 비용', '--expect', '사람 말당 되돌림 감소', '--days', '2', '--kit', 'abc123', '--at', at(0)]);
    assert.equal(add.code, 0, add.err);
    const file = path.join(env.records, 'experiments.tsv');
    assert.match(fs.readFileSync(file, 'utf8'), /^번호\t시각\t줄/);
    env.run(['exp', 'add', '--what', '둘째', '--why', 'w', '--expect', 'e', '--at', at(0)]);
    assert.match(env.run(['exp', 'list']).out, /1\s+2026-11-01\s+2\s+열림\s+패널 걷기/);
    const early = at(60 * 24 * 2);
    assert.equal(env.run(['exp', 'due', '--count', '--now', early]).out.trim(), '1');
    assert.equal(env.run(['exp', 'due', '--count', '--now', at(60)]).out.trim(), '0');
    const due = env.run(['exp', 'due', '--now', at(60 * 24 * 2)]);
    assert.match(due.out, /## 실험 1/);
    assert.match(due.out, /기대: 사람 말당 되돌림 감소/);
    assert.match(due.out, /메인 되돌림 말당/);
    const more = env.run(['exp', 'close', '--id', '1', '--result', '더봄', '--memo', '표본 작음']);
    assert.equal(more.code, 0, more.err);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 4);
    assert.equal(env.run(['exp', 'close', '--id', '1', '--result', '남김', '--memo', '나아짐']).code, 0);
    assert.match(env.run(['exp', 'list']).out, /1\s+2026-11-01\s+2\s+남김/);
    const again = env.run(['exp', 'close', '--id', '1', '--result', '되돌림', '--memo', 'x']);
    assert.notEqual(again.code, 0);
    assert.match(again.err, /이미 남김/);
    assert.notEqual(env.run(['exp', 'close', '--id', '9', '--result', '남김', '--memo', 'x']).code, 0);
    assert.notEqual(env.run(['exp', 'close', '--id', '2', '--result', '아무거나', '--memo', 'x']).code, 0);
  });

  it('foldExperiments는 마지막 닫음으로 상태를 정하고 더봄이면 그 시각부터 센다', () => {
    const base = { 번호: '1', 줄: '시작', '볼 날수': '3', 시각: '2026-11-01T00:00:00.000Z' };
    const rows = [base, { 번호: '1', 줄: '닫음', 결과: '더봄', 시각: '2026-11-04T00:00:00.000Z', 메모: 'm' }];
    const [e] = foldExperiments(rows);
    assert.equal(e.state, '더봄');
    assert.equal(e.dueMs, Date.parse('2026-11-07T00:00:00.000Z'));
    assert.equal(dueExperiments(rows, Date.parse('2026-11-06T00:00:00Z')).length, 0);
    assert.equal(dueExperiments(rows, Date.parse('2026-11-07T00:00:00Z')).length, 1);
  });

  it('compareRows는 말당 값이 10% 넘게 오르면 나빠짐을 붙인다', () => {
    const b = { human: 10, subEvents: 0, mainPerHuman: 1, resendPerHuman: 0, critiquePerHuman: 0.1, tokensPerHuman: 100 };
    const a = { human: 10, subEvents: 0, mainPerHuman: 0.5, resendPerHuman: 0, critiquePerHuman: 0.3, tokensPerHuman: 105 };
    const rows = compareRows(b, a);
    assert.equal(rows.find((r) => r[0] === '대표 지적 말당')[3], '(나빠짐)');
    assert.equal(rows.find((r) => r[0] === '메인 되돌림 말당')[3], '');
    assert.equal(rows.find((r) => r[0] === '메인 토큰 말당')[3], '');
  });
});
