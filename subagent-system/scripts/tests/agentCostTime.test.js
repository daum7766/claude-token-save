import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRates, toCounts, cost } from '../subagent-usage.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIME = path.join(SCRIPTS, 'agent-time-breakdown.js');
const COST = path.join(SCRIPTS, 'main-session-cost.js');
const SESSION = '11111111-2222-3333-4444-555555555555';

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const at = (sec) => new Date(Date.UTC(2026, 9, 10, 0, 0, sec)).toISOString();

const tempRoots = [];
after(() => {
  for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true });
});

// 메인 세션 응답 비용의 기대값은 키트 요율표로 구해 요율이 바뀌어도 깨지지 않게 한다.
const MAIN_USAGE = { input_tokens: 1000000, output_tokens: 0 };
const mainCost = cost(toCounts({ message: { model: 'claude-opus-5-5', usage: MAIN_USAGE } }), loadRates().rates);
const dollars = (v) => `\\$${v.toFixed(2)}`;
const sharePct = (main, sub) => `${Math.round((100 * main) / (main + sub))}%`;

// 실제 ~/.claude를 읽지 않도록 설정 폴더와 기록 폴더를 임시 폴더로 바꾼다.
function setup({ withCostFile = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cost-time-'));
  tempRoots.push(root);
  const claude = path.join(root, 'claude');
  const records = path.join(root, 'records');
  const proj = path.join(claude, 'projects', '-work-proj');
  fs.mkdirSync(path.join(proj, SESSION, 'subagents'), { recursive: true });
  fs.mkdirSync(records, { recursive: true });

  // 서브에이전트마다 0초에 시작해 10초에 도구를 부르고 40초에 결과를 받고 50초에 끝난다(도구 30초, 모델 20초).
  const agent = (id) =>
    jsonl([
      { type: 'user', timestamp: at(0), message: { content: 'go' } },
      { type: 'assistant', timestamp: at(10), uuid: `${id}-a1`, message: { id: `${id}-m1`, content: [{ type: 'tool_use', id: `${id}-t1`, name: 'Bash', input: { command: 'sleep 30' } }] } },
      { type: 'user', timestamp: at(40), message: { content: [{ type: 'tool_result', tool_use_id: `${id}-t1`, content: 'x' }] } },
      { type: 'assistant', timestamp: at(50), uuid: `${id}-a2`, message: { id: `${id}-m2`, content: [{ type: 'text', text: 'done' }] } },
    ]);
  const ids = ['aaa1', 'aaa2'];
  for (const id of ids) fs.writeFileSync(path.join(proj, SESSION, 'subagents', `agent-${id}.jsonl`), agent(id));
  const usageRows = ids.map((id) => ['2026-10-10', '/work/proj', 'sonnet-high', '긴 구현', '-', '-', '50', 'ok', `${id} 메모`].join('\t'));
  fs.writeFileSync(path.join(records, 'subagent-usage.tsv'), ['날짜\t프로젝트\t정의\t일 종류\t토큰\t도구\t초\t결과\t메모', ...usageRows].join('\n') + '\n');

  // 메인 세션은 opus 한 요청이다. 같은 요청이 앞 줄(입력 50만)과 마지막 줄(입력 100만)로 두 번 찍혀, 마지막 줄 하나만 세야 한다.
  fs.writeFileSync(
    path.join(proj, `${SESSION}.jsonl`),
    jsonl([
      { type: 'user', timestamp: at(0), cwd: '/work/proj', message: { content: 'hi' } },
      { type: 'assistant', timestamp: at(4), requestId: 'r1', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 500000, output_tokens: 0 }, content: [{ type: 'text', text: '...' }] } },
      { type: 'assistant', timestamp: at(5), requestId: 'r1', message: { id: 'm1', model: 'claude-opus-5-5', usage: MAIN_USAGE, content: [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }] } },
      { type: 'user', timestamp: at(6), message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'abc' }] } },
    ])
  );
  if (withCostFile) {
    const header = ['날짜', '프로젝트', '세션', 'agentId', '정의', '모델', 'effort', '설명', '입력', '캐시 쓰기', '캐시 읽기', '출력', '요청 수', '걸린 초', '어림 비용($)'].join('\t');
    const row = ['2026-10-10', '/work/proj', SESSION, 'aaa1', 'sonnet-high', 'claude-sonnet-5-5', 'high', 'x', 1, 0, 0, 1, 1, 50, '1.5'].join('\t');
    fs.writeFileSync(path.join(records, 'subagent-cost.tsv'), [header, row].join('\n') + '\n');
  }
  return { root, proj, records, env: { ...process.env, CLAUDE_CONFIG_DIR: claude, SUBAGENT_RECORDS_DIR: records } };
}

const run = (script, args, env) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });

describe('agent-time-breakdown.js 실행', () => {
  it('--top이 1보다 작으면 사용법을 찍고 종료 코드 1이다', () => {
    const { env } = setup();
    const r = run(TIME, ['--top', '0'], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /사용: node "\$HOME\/\.claude\/subagent-system\/scripts\/agent-time-breakdown\.js"/);
  });

  it('같은 칸 2건의 대화 기록에서 모델 시간과 도구 시간을 나눠 찍는다', () => {
    const { env } = setup();
    const r = run(TIME, ['--since', '2026-10-01'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /== sonnet-high \/ 긴 구현/);
    assert.match(r.stdout, /건수 2, 평균 0\.8분, 대화 기록 분석 2건, 기록 없음 0건/);
    assert.match(r.stdout, /합 1\.7분: 모델 0\.7분 \(40%\), 도구 1\.0분 \(60%\), 그 밖 0\.0분 \(0%\), 사용자 기다림 0\.0분/);
    assert.match(r.stdout, /시간이 큰 Bash 명령:\n    "sleep" 1\.0분: sleep 30\n/);
  });

  it('--since보다 앞선 사용 기록은 건너뛰어 조건에 맞는 묶음이 없다고 알린다', () => {
    const { env } = setup();
    const r = run(TIME, ['--since', '2026-10-11'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /사용 기록 0줄/);
    assert.match(r.stdout, /조건에 맞는 묶음이 없습니다/);
  });

  it('도구 구간이 겹치면 겹친 시간을 한 번만 도구 시간으로 센다', () => {
    const { proj, records, env } = setup();
    const ev = (type, sec, content, extra = {}) => ({ type, timestamp: at(sec), message: { id: `o-${sec}`, content }, ...extra });
    fs.writeFileSync(
      path.join(proj, SESSION, 'subagents', 'agent-ovl1.jsonl'),
      jsonl([
        ev('user', 0, 'go'),
        ev('assistant', 10, [{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'sleep 30' } }, { type: 'tool_use', id: 'x2', name: 'Bash', input: { command: 'sleep 40' } }]),
        ev('user', 40, [{ type: 'tool_result', tool_use_id: 'x1', content: 'a' }]),
        ev('user', 50, [{ type: 'tool_result', tool_use_id: 'x2', content: 'b' }]),
        ev('assistant', 60, [{ type: 'text', text: 'done' }]),
      ])
    );
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), ['2026-10-10', '/work/proj', 'sonnet-high', '겹침', '-', '-', '60', 'ok', 'ovl1 메모'].join('\t') + '\n');
    const r = run(TIME, ['--kind', '겹침'], env);
    assert.equal(r.status, 0, r.stderr);
    // 도구 구간 10~40초와 10~50초가 겹쳐 합치면 10~50초(40초)다. 나머지 20초는 모델이 쓴다.
    assert.match(r.stdout, /합 1\.0분: 모델 0\.3분 \(33%\), 도구 0\.7분 \(67%\), 그 밖 0\.0분 \(0%\), 사용자 기다림 0\.0분/);
  });

  it('--kind를 주면 그 일 종류가 한 건뿐이어도 보이고 주지 않으면 2건 미만 묶음은 뺀다', () => {
    const { records, env } = setup();
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), ['2026-10-10', '/work/proj', 'sonnet-high', '혼자 한 일', '-', '-', '60', 'ok', 'solo1 메모'].join('\t') + '\n');
    const all = run(TIME, ['--since', '2026-10-01'], env);
    assert.doesNotMatch(all.stdout, /혼자 한 일/);
    const one = run(TIME, ['--kind', '혼자 한 일'], env);
    assert.equal(one.status, 0, one.stderr);
    assert.match(one.stdout, /== sonnet-high \/ 혼자 한 일/);
    assert.match(one.stdout, /건수 1, 평균 1\.0분/);
  });

  it('초를 적지 않은 에이전트는 평균에서 빼고 재지시로 같은 agentId가 여러 줄이면 초를 더해 한 건으로 센다', () => {
    const { records, env } = setup();
    const row = (sec, id) => ['2026-10-10', '/work/proj', 'sonnet-high', '재지시 일', '-', '-', sec, 'ok', `${id} 메모`].join('\t');
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), [row('60', 'rr1'), row('120', 'rr1'), row('-', 'rr2')].join('\n') + '\n');
    const r = run(TIME, ['--kind', '재지시 일'], env);
    assert.equal(r.status, 0, r.stderr);
    // 에이전트 둘이고 rr1은 60초와 120초를 더한 180초, rr2는 초를 몰라 뺀다. 0초로 넣으면 평균이 1.5분으로 낮아진다.
    assert.match(r.stdout, /건수 2, 평균 3\.0분/);
  });

  it('--kind에 부연 없는 이름을 주면 끝 괄호 부연이 붙은 기록도 같은 일 종류로 묶는다', () => {
    const { records, env } = setup();
    const row = (kind, id) => ['2026-10-10', '/work/proj', 'sonnet-high', kind, '-', '-', '60', 'ok', `${id} 메모`].join('\t');
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), [row('부연 일(상세)', 'pa1'), row('부연 일', 'pa2')].join('\n') + '\n');
    const r = run(TIME, ['--kind', '부연 일'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /== sonnet-high \/ 부연 일\n/);
    assert.match(r.stdout, /건수 2, 평균 1\.0분/);
  });

  it('--kind에 일 종류의 일부만 주어도 그 말을 포함한 일 종류를 잡는다', () => {
    const { records, env } = setup();
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), ['2026-10-10', '/work/proj', 'sonnet-high', '디자인 체크리스트 계측', '-', '-', '60', 'ok', 'cl1 메모'].join('\t') + '\n');
    const r = run(TIME, ['--kind', '체크리스트 계측'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /== sonnet-high \/ 디자인 체크리스트 계측\n/);
  });

  it('--kind와 정확히 같은 일 종류가 있으면 그 이름을 품은 다른 일 종류는 보지 않는다', () => {
    const { records, env } = setup();
    const row = (kind, id) => ['2026-10-10', '/work/proj', 'sonnet-high', kind, '-', '-', '60', 'ok', `${id} 메모`].join('\t');
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), [row('브라우저 조작', 'ex1'), row('브라우저 조작 길게', 'ex2')].join('\n') + '\n');
    const r = run(TIME, ['--kind', '브라우저 조작'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /== sonnet-high \/ 브라우저 조작\n/);
    assert.doesNotMatch(r.stdout, /브라우저 조작 길게/);
  });

  it('메모 첫 낱말에 agentId 뒤 꼬리가 붙어도 꼬리 없는 줄과 같은 에이전트 한 건으로 센다', () => {
    const { records, env } = setup();
    const row = (id) => ['2026-10-10', '/work/proj', 'sonnet-high', '꼬리 일', '-', '-', '60', 'ok', `${id} 메모`].join('\t');
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), [row('add4fa4fc4b15a337(이어서)'), row('add4fa4fc4b15a337')].join('\n') + '\n');
    const r = run(TIME, ['--kind', '꼬리 일'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /건수 1, 평균 2\.0분/);
  });

  it('사용 기록 메모에 agentId 앞 8자만 있어도 전체 ID 대화 기록을 찾는다', () => {
    const { proj, records, env } = setup();
    const full = 'abcd1234efgh5678i';
    const ev = (type, sec, content) => ({ type, timestamp: at(sec), message: { id: `p-${sec}`, content } });
    fs.writeFileSync(
      path.join(proj, SESSION, 'subagents', `agent-${full}.jsonl`),
      jsonl([
        ev('user', 0, 'go'),
        ev('assistant', 10, [{ type: 'tool_use', id: 'p1', name: 'Bash', input: { command: 'sleep 30' } }]),
        ev('user', 40, [{ type: 'tool_result', tool_use_id: 'p1', content: 'a' }]),
        ev('assistant', 50, [{ type: 'text', text: 'done' }]),
      ])
    );
    const usageRow = ['2026-10-10', '/work/proj', 'sonnet-high', '앞부분 일', '-', '-', '50', 'ok', 'abcd1234 메모'].join('\t');
    fs.writeFileSync(path.join(records, 'subagent-usage.tsv'), ['날짜\t프로젝트\t정의\t일 종류\t토큰\t도구\t초\t결과\t메모', usageRow].join('\n') + '\n');
    const r = run(TIME, ['--kind', '앞부분 일'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /대화 기록 분석 1건, 기록 없음 0건/);
  });

  it('--since와 --kind가 없고 회고 줄이 있으면 그 줄 뒤 기록만 센다', () => {
    const { records, env } = setup();
    const row = (kind, id) => ['2026-10-10', '/work/proj', 'sonnet-high', kind, '-', '-', '60', 'ok', `${id} 메모`].join('\t');
    const mark = ['회고', '-', '회고', '-', '-', '-', '-', '-', '2026-10-10 회고'].join('\t');
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), [mark, row('회고 뒤 일', 'af1'), row('회고 뒤 일', 'af2')].join('\n') + '\n');
    const r = run(TIME, [], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /사용 기록 2줄/);
    assert.match(r.stdout, /== sonnet-high \/ 회고 뒤 일\n/);
    assert.doesNotMatch(r.stdout, /긴 구현/);
  });

  it('도구 호출이 상한을 넘으면 넘는 몫을 사용자 기다림으로 따로 찍는다', () => {
    const { proj, records, env } = setup();
    const ev = (type, sec, content) => ({ type, timestamp: at(sec), message: { id: `w-${sec}`, content } });
    fs.writeFileSync(
      path.join(proj, SESSION, 'subagents', 'agent-wait1.jsonl'),
      jsonl([
        ev('user', 0, 'go'),
        ev('assistant', 10, [{ type: 'tool_use', id: 'w1', name: 'Bash', input: { command: 'rm -r x' } }]),
        ev('user', 1010, [{ type: 'tool_result', tool_use_id: 'w1', content: 'a' }]),
        ev('assistant', 1020, [{ type: 'text', text: 'done' }]),
      ])
    );
    fs.appendFileSync(path.join(records, 'subagent-usage.tsv'), ['2026-10-10', '/work/proj', 'sonnet-high', '기다림 일', '-', '-', '1020', 'ok', 'wait1 메모'].join('\t') + '\n');
    const r = run(TIME, ['--kind', '기다림 일'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /도구 11\.0분 \(65%\), 그 밖 0\.0분 \(0%\), 사용자 기다림 5\.7분/);
  });

  it('사용 기록 파일이 없으면 경로를 알리고 종료 코드 1이다', () => {
    const { root, env } = setup();
    fs.rmSync(path.join(root, 'records', 'subagent-usage.tsv'));
    const r = run(TIME, ['--since', '2026-10-01'], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /사용 기록이 없습니다: .*subagent-usage\.tsv/);
  });
});

describe('main-session-cost.js 실행', () => {
  it('--since가 없으면 사용법을 찍고 종료 코드 1이다', () => {
    const { env } = setup();
    const r = run(COST, [], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /사용: node "\$HOME\/\.claude\/subagent-system\/scripts\/main-session-cost\.js"/);
  });

  it('메인 세션 비용과 서브에이전트 비용을 프로젝트별로 나란히 찍고 메인 몫을 센다', () => {
    const { env } = setup();
    const r = run(COST, ['--since', '2026-10-01'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`/work/proj\\s+${dollars(mainCost)}\\s+\\$1\\.50\\s+${sharePct(mainCost, 1.5)}`));
    assert.match(r.stdout, new RegExp(`합계\\s+${dollars(mainCost)}\\s+\\$1\\.50\\s+${sharePct(mainCost, 1.5)}`));
    assert.match(r.stdout, /11111111: Read 1회 3자/);
  });

  it('서브에이전트 비용 기록이 없어도 메인 비용은 찍고 서브는 $0.00이다', () => {
    const { env } = setup({ withCostFile: false });
    const r = run(COST, ['--since', '2026-10-01'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`합계\\s+${dollars(mainCost)}\\s+\\$0\\.00\\s+100%`));
  });

  it('--since보다 앞선 메인 응답과 서브에이전트 비용은 세지 않는다', () => {
    const { env } = setup();
    const r = run(COST, ['--since', '2026-10-11'], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /합계\s+\$0\.00\s+\$0\.00\s+-/);
  });
});
