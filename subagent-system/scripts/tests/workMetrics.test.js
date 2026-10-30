import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadRates, toCounts, cost } from '../subagent-usage.js';
import { countDecisionLines, summarizePairs, judge } from '../work-metrics.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(SCRIPTS, 'work-metrics.js');
const SESSION = '11111111-2222-3333-4444-555555555555';
const OTHER_SESSION = '99999999-2222-3333-4444-555555555555';

const tempRoots = [];
after(() => {
  for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true });
});

const BASE = Date.UTC(2026, 9, 10, 0, 0, 0);
const at = (sec) => new Date(BASE + sec * 1000).toISOString();
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// 실제 ~/.claude를 읽지 않도록 설정 폴더와 기록 폴더를 임시 폴더로 바꾼다.
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-metrics-test-'));
  tempRoots.push(root);
  const claude = path.join(root, 'claude');
  const records = path.join(root, 'records');
  const proj = path.join(claude, 'projects', '-work-proj');
  fs.mkdirSync(path.join(proj, SESSION, 'subagents'), { recursive: true });
  fs.mkdirSync(records, { recursive: true });
  const run = (args, extraEnv = {}) => {
    const r = spawnSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: claude, SUBAGENT_RECORDS_DIR: records, ...extraEnv },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  return { root, claude, records, proj, run };
}

const usageRow = (sec, id, usage, model = 'claude-opus-5-5') => ({ type: 'assistant', timestamp: at(sec), requestId: `r-${id}`, uuid: `u-${id}`, message: { id: `m-${id}`, model, usage, content: [{ type: 'text', text: 'x' }] } });
const toolUse = (sec, id, usage, command = 'sleep 100') => ({
  type: 'assistant',
  timestamp: at(sec),
  requestId: `r-${id}`,
  uuid: `u-${id}`,
  message: { id: `m-${id}`, model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
});
const toolResult = (sec, id) => ({ type: 'user', timestamp: at(sec), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const prompt = (sec, text = '진행') => ({ type: 'user', timestamp: at(sec), cwd: '/work/proj', message: { content: text } });

const rates = loadRates().rates;
const dollars = (usage, model = 'claude-opus-5-5') => cost(toCounts({ message: { model, usage } }), rates);

function writeSession(env, rows) {
  fs.writeFileSync(path.join(env.proj, `${SESSION}.jsonl`), jsonl(rows));
}
const budgetRows = (env) => fs.readFileSync(path.join(env.records, 'work-budget.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
const COL = { 종류: 1, 작업: 2, 세션: 4, 어림토큰: 5, 실제토큰: 7, 실제초: 8, 기다린초: 9, 메인토큰: 10, 서브토큰: 11, 메인비용: 12, 서브비용: 13, 비용모름: 14, 판정: 15, 원인: 16 };

describe('예산 원장', () => {
  const MAIN_A = { input_tokens: 1000, output_tokens: 500 };
  const MAIN_B = { input_tokens: 2000, cache_read_input_tokens: 4000, output_tokens: 100 };
  const SUB = { input_tokens: 3000, output_tokens: 700 };

  function scenario(env, { tool = { start: 120, end: 220 }, last = 230 } = {}) {
    writeSession(env, [
      prompt(0),
      usageRow(50, 'before', { input_tokens: 999999, output_tokens: 0 }),
      prompt(110),
      toolUse(tool.start, 'a', MAIN_A),
      toolResult(tool.end, 'a'),
      usageRow(last, 'b', MAIN_B),
      usageRow(900, 'after', { input_tokens: 999999, output_tokens: 0 }),
    ]);
    fs.writeFileSync(
      path.join(env.proj, SESSION, 'subagents', 'agent-aaa.jsonl'),
      jsonl([usageRow(30, 's0', { input_tokens: 888888, output_tokens: 0 }), usageRow(150, 's1', SUB), usageRow(1000, 's2', { input_tokens: 888888, output_tokens: 0 })])
    );
  }

  it('작업이 끝나면 시작과 끝 사이의 메인과 서브에이전트 토큰, 비용, 기다림을 뺀 초가 적힌다', () => {
    const env = setup();
    scenario(env);
    assert.equal(env.run(['budget', 'start', '--id', 'T1', '--tokens', '1000', '--secs', '120', '--project', '/work/proj', '--at', at(100)]).code, 0);
    const r = env.run(['budget', 'end', '--id', 'T1', '--at', at(400)]);
    assert.equal(r.code, 0, r.err);
    const row = budgetRows(env).find((c) => c[COL.종류] === '끝');
    const mainTokens = 1000 + 500 + 2000 + 4000 + 100;
    assert.equal(row[COL.세션], SESSION);
    assert.equal(Number(row[COL.메인토큰]), mainTokens);
    assert.equal(Number(row[COL.서브토큰]), 3700);
    assert.equal(Number(row[COL.실제토큰]), mainTokens + 3700);
    assert.equal(Number(row[COL.실제초]), 120);
    assert.equal(Number(row[COL.기다린초]), 0);
    assert.ok(Math.abs(Number(row[COL.메인비용]) - (dollars(MAIN_A) + dollars(MAIN_B))) < 0.001);
    assert.ok(Math.abs(Number(row[COL.서브비용]) - dollars(SUB)) < 0.001);
    assert.equal(row[COL.판정], '토큰 넘음, 시간 범위 안');
  });

  it('도구가 상한보다 오래 걸린 시간은 사용자 기다림이라 실제 초에서 빠진다', () => {
    const env = setup();
    scenario(env, { tool: { start: 120, end: 820 }, last: 830 });
    env.run(['budget', 'start', '--id', 'T2', '--tokens', '1000', '--secs', '600', '--project', '/work/proj', '--at', at(100)]);
    env.run(['budget', 'end', '--id', 'T2', '--at', at(840)]);
    const row = budgetRows(env).find((c) => c[COL.종류] === '끝');
    assert.equal(Number(row[COL.기다린초]), 40);
    assert.equal(Number(row[COL.실제초]), 720 - 40);
  });

  it('실제가 어림의 절반 이하이면 덜 듦으로 판정하고 원인이 비었으면 남기라고 알린다', () => {
    const env = setup();
    scenario(env);
    env.run(['budget', 'start', '--id', 'T3', '--tokens', '100000', '--secs', '1000', '--project', '/work/proj', '--at', at(100)]);
    const r = env.run(['budget', 'end', '--id', 'T3', '--at', at(400)]);
    assert.match(r.out, /판정: 토큰 덜 듦, 시간 덜 듦/);
    assert.match(r.out, /원인 칸이 비었습니다.*budget cause --id T3/);
  });

  it('어림 안에 든 작업은 원인을 남기라고 하지 않는다', () => {
    const env = setup();
    scenario(env);
    env.run(['budget', 'start', '--id', 'T4', '--tokens', '9000', '--secs', '120', '--project', '/work/proj', '--at', at(100)]);
    const r = env.run(['budget', 'end', '--id', 'T4', '--at', at(400), '--over', '10']);
    assert.match(r.out, /판정: 토큰 범위 안, 시간 범위 안/);
    assert.doesNotMatch(r.out, /원인 칸이 비었습니다/);
  });

  it('끝낼 때 원인을 주면 기록에 남고 원인을 따로 덧붙이면 목록에 마지막 원인이 보인다', () => {
    const env = setup();
    scenario(env);
    env.run(['budget', 'start', '--id', 'T5', '--tokens', '100000', '--secs', '1000', '--project', '/work/proj', '--at', at(100)]);
    const end = env.run(['budget', 'end', '--id', 'T5', '--at', at(400), '--cause', '지시가 짧아 한 번에 끝남']);
    assert.doesNotMatch(end.out, /원인 칸이 비었습니다/);
    assert.equal(budgetRows(env).find((c) => c[COL.종류] === '끝')[COL.원인], '지시가 짧아 한 번에 끝남');
    assert.equal(env.run(['budget', 'cause', '--id', 'T5', '--text', '캐시가 따뜻했음']).code, 0);
    const list = env.run(['budget', 'list']);
    assert.match(list.out, /T5/);
    assert.match(list.out, /캐시가 따뜻했음/);
    assert.match(list.out, /원인이 빈 것 0건/);
  });

  it('요율표에 없는 모델의 응답은 비용에서 빠지고 건수로 알려 준다', () => {
    const env = setup();
    writeSession(env, [prompt(110), usageRow(150, 'x', { input_tokens: 500, output_tokens: 10 }, 'claude-unknown-9')]);
    env.run(['budget', 'start', '--id', 'T7', '--tokens', '510', '--secs', '60', '--project', '/work/proj', '--at', at(100)]);
    const r = env.run(['budget', 'end', '--id', 'T7', '--at', at(400)]);
    assert.equal(Number(budgetRows(env).find((c) => c[COL.종류] === '끝')[COL.비용모름]), 1);
    assert.match(r.out, /요율표에 없는 모델의 응답 1건/);
  });

  it('시작하지 않은 작업을 끝내려 하면 실패한다', () => {
    const env = setup();
    writeSession(env, [prompt(0)]);
    const r = env.run(['budget', 'end', '--id', 'NOPE']);
    assert.equal(r.code, 1);
    assert.match(r.err, /끝나지 않은 작업 NOPE가 없습니다/);
  });

  it('끝나지 않은 작업과 같은 이름으로 다시 시작하면 실패하고 끝낸 뒤에는 다시 시작할 수 있다', () => {
    const env = setup();
    scenario(env);
    const start = (at0) => env.run(['budget', 'start', '--id', 'T8', '--tokens', '1', '--secs', '1', '--project', '/work/proj', '--at', at(at0)]);
    assert.equal(start(100).code, 0);
    assert.equal(start(101).code, 1);
    env.run(['budget', 'end', '--id', 'T8', '--at', at(400)]);
    assert.equal(start(500).code, 0);
  });

  it('끝나지 않은 작업은 budget list에 열린 작업으로 보인다', () => {
    const env = setup();
    scenario(env);
    assert.equal(env.run(['budget', 'start', '--id', 'T10', '--tokens', '1', '--secs', '1', '--project', '/work/proj', '--at', at(100)]).code, 0);
    assert.match(env.run(['budget', 'list']).out, /끝나지 않은 작업 1건: T10/);
  });

  it('프로젝트의 대화 기록이 없으면 끝낼 때 세션을 알려 달라고 실패한다', () => {
    const env = setup();
    const start = env.run(['budget', 'start', '--id', 'T9', '--tokens', '1', '--secs', '1', '--project', '/elsewhere', '--at', at(100)]);
    assert.equal(start.code, 0);
    assert.match(start.out, /찾지 못함/);
    const end = env.run(['budget', 'end', '--id', 'T9', '--at', at(400)]);
    assert.equal(end.code, 1);
    assert.match(end.err, /--session <id>/);
  });

  it('세션을 주지 않으면 같은 프로젝트에서 가장 최근에 바뀐 세션을 고른다', () => {
    const env = setup();
    scenario(env);
    const other = path.join(env.claude, 'projects', '-other');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, `${OTHER_SESSION}.jsonl`), jsonl([{ ...prompt(0), cwd: '/other/place' }]));
    env.run(['budget', 'start', '--id', 'T10', '--tokens', '1', '--secs', '1', '--project', '/work/proj/.claude/worktrees/wt', '--at', at(100)]);
    assert.equal(budgetRows(env)[0][COL.세션], SESSION);
  });
});

describe('judge', () => {
  const th = { over: 2, under: 0.5 };
  for (const [est, actual, want] of [
    [100, 200, '넘음'],
    [100, 199, '범위 안'],
    [100, 50, '덜 듦'],
    [100, 51, '범위 안'],
    [0, 10, '어림 없음'],
  ]) {
    it(`어림 ${est}에 실제 ${actual}이면 ${want}이다`, () => {
      assert.equal(judge(est, actual, th), want);
    });
  }
});

describe('짝 시험', () => {
  const add = (env, cell, a, b, extra = []) =>
    env.run(['pair', 'add', '--cell', cell, '--task', '입력 요약', '--a', a.name, '--cost-a', String(a.cost), '--quality-a', a.q, '--b', b.name, '--cost-b', String(b.cost), '--quality-b', b.q, ...extra]);

  it('같은 칸의 시험은 정의 순서가 바뀌어 적혀도 한 쌍으로 모이고 싼 쪽 기준으로 통과가 갈린다', () => {
    const env = setup();
    const hi = (cost, q) => ({ name: 'opus-medium', cost, q });
    const lo = (cost, q) => ({ name: 'sonnet-high', cost, q });
    assert.equal(add(env, '문서 검수', hi(3, '통과'), lo(1, '통과')).code, 0);
    assert.equal(add(env, '문서 검수', lo(1.5, '통과'), hi(4, '통과')).code, 0);
    assert.equal(add(env, '문서 검수', hi(3, '통과'), lo(1, '실패')).code, 0);
    assert.equal(add(env, '문서 검수', lo(1, '모자람'), hi(3, '모자람')).code, 0);
    assert.equal(add(env, '문서 검수', lo(1, '통과'), hi(3, '실패')).code, 0);
    const text = fs.readFileSync(path.join(env.records, 'pair-trials.tsv'), 'utf8').trim().split('\n');
    const rows = text.slice(1).map((l) => {
      const c = l.split('\t');
      return { 칸: c[1], '정의 A': c[3], '비용 A': c[4], '품질 A': c[5], '정의 B': c[6], '비용 B': c[7], '품질 B': c[8] };
    });
    const [g, ...rest] = summarizePairs(rows);
    assert.equal(rest.length, 0);
    assert.deepEqual({ n: g.n, bothPass: g.bothPass, onlyCheap: g.onlyCheap, onlyDear: g.onlyDear, neither: g.neither }, { n: 5, bothPass: 2, onlyCheap: 1, onlyDear: 1, neither: 1 });
    const list = env.run(['pair', 'list']);
    assert.match(list.out, /문서 검수\s+opus-medium 대 sonnet-high\s+5\s+2\s+1\s+1\s+1/);
  });

  it('품질 값이 통과, 모자람, 실패가 아니거나 두 정의가 같거나 비용이 숫자가 아니면 적지 않는다', () => {
    const env = setup();
    assert.equal(add(env, '칸', { name: 'a1', cost: 1, q: 'ok' }, { name: 'b1', cost: 2, q: '통과' }).code, 1);
    assert.equal(add(env, '칸', { name: 'a1', cost: 1, q: '통과' }, { name: 'a1', cost: 2, q: '통과' }).code, 1);
    assert.equal(add(env, '칸', { name: 'a1', cost: 'abc', q: '통과' }, { name: 'b1', cost: 2, q: '통과' }).code, 1);
    assert.equal(fs.existsSync(path.join(env.records, 'pair-trials.tsv')), false);
  });
});

describe('안 쓰는 매뉴얼', () => {
  const DAY = 86400000;
  const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
  const stamp = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

  function build() {
    const env = setup();
    const skills = path.join(env.root, 'skills');
    for (const name of ['fresh-skill', 'plugin-skill', 'slash-skill', 'old-skill', 'never-skill', 'sub-skill']) {
      fs.mkdirSync(path.join(skills, name), { recursive: true });
      fs.writeFileSync(path.join(skills, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }
    const agents = path.join(env.root, 'agents');
    fs.mkdirSync(agents);
    for (const n of ['used-def', 'never-def']) fs.writeFileSync(path.join(agents, `${n}.md`), '정의');
    const scripts = path.join(env.root, 'kit-scripts');
    fs.mkdirSync(scripts);
    fs.writeFileSync(path.join(scripts, 'tool.js'), "const a = process.argv;\nif (a[0] === '--used-flag') {}\nif (a[0] === '--idle-flag') {}\n");
    fs.writeFileSync(path.join(scripts, 'helper.js'), 'export const x = 1;\n');
    const docs = path.join(env.root, 'kit-docs');
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(docs, 'GUIDE.md'), '# 제목\n## 말로 꺼낸 절\n내용\n## 읽기만 한 절\n내용\n### 아무도 안 쓴 절\n```\n## 코드 안 제목\n```\n');

    const asst = (daysAgo, content, id) => ({ type: 'assistant', timestamp: stamp(daysAgo), message: { id, content } });
    const user = (daysAgo, content) => ({ type: 'user', timestamp: stamp(daysAgo), message: { content } });
    const rows = [
      asst(2, [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'fresh-skill' } }], 'm1'),
      asst(1, [{ type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'someplugin:plugin-skill' } }], 'm2'),
      user(3, '<command-name>/slash-skill</command-name>\n<command-message>slash-skill</command-message>'),
      asst(60, [{ type: 'tool_use', id: 't3', name: 'Skill', input: { skill: 'old-skill' } }], 'm3'),
      asst(5, [{ type: 'tool_use', id: 't4', name: 'Agent', input: { subagent_type: 'used-def', prompt: 'x' } }], 'm4'),
      asst(4, [{ type: 'tool_use', id: 't5', name: 'Bash', input: { command: 'node "$HOME/x/tool.js" --used-flag --other' } }], 'm5'),
      asst(6, [{ type: 'text', text: 'GUIDE의 「말로 꺼낸 절」을 따른다' }], 'm6'),
      user(6, [{ type: 'tool_result', tool_use_id: 'z', content: '## 읽기만 한 절 「읽기만 한 절」 파일 본문, 스킬 "skill":"never-skill" 도 이 안에' }]),
      asst(7, [{ type: 'tool_use', id: 't6', name: 'Bash', input: { command: 'cat tool.js' } }], 'm7'),
    ];
    const sub = [asst(8, [{ type: 'tool_use', id: 't7', name: 'Skill', input: { skill: 'sub-skill' } }], 'm8')];
    fs.writeFileSync(path.join(env.proj, `${SESSION}.jsonl`), jsonl([{ ...prompt(0), timestamp: stamp(9) }, ...rows.slice(0, 7)]));
    fs.writeFileSync(path.join(env.proj, SESSION, 'subagents', 'agent-s.jsonl'), jsonl([...rows.slice(7), ...sub]));
    return { env, skills, agents, scripts, docs, sub };
  }

  const stale = (out) => out.split('\n').filter((l) => /^(스킬|정의|스크립트|하위 명령|문서 절)\s/.test(l));

  for (const noRg of ['0', '1']) {
    describe(noRg === '1' ? 'rg 없이' : 'rg로', () => {
      const unusedRun = (b, extra = []) => b.env.run(['unused', '--skills', b.skills, '--agents', b.agents, '--scripts', b.scripts, '--docs', b.docs, '--now', stamp(0), ...extra], { WORK_METRICS_NO_RG: noRg });

      it('기간 안에 쓴 스킬과 정의는 목록에 없고 쓴 적이 없거나 기간 밖인 것만 마지막 사용일과 함께 나온다', () => {
        const b = build();
        const r = unusedRun(b);
        assert.equal(r.code, 0, r.err);
        const lines = stale(r.out);
        assert.ok(lines.some((l) => /^스킬\s+old-skill\s+2026-09-01\s+1$/.test(l)), r.out);
        assert.ok(lines.some((l) => /^스킬\s+never-skill\s+기록 없음\s+0$/.test(l)), `도구 결과 안의 스킬 이름은 쓴 것이 아니다\n${r.out}`);
        assert.ok(lines.some((l) => /^정의\s+never-def\s+기록 없음\s+0$/.test(l)), r.out);
        for (const used of ['fresh-skill', 'plugin-skill', 'slash-skill', 'sub-skill', 'used-def']) assert.ok(!lines.some((l) => l.includes(used)), `${used}는 쓴 것으로 센다\n${r.out}`);
      });
    });
  }
});

describe('사용자에게 온 질문 수', () => {
  describe('countDecisionLines', () => {
    const cases = [
      ['정할 것 아래 질문 줄을 센다', '한 일을 했습니다.\n\n정할 것\n1. 광고를 붙일지\n2. 색을 바꿀지\n\n알아 둘 것\n- 위험 하나\n', 2],
      ['선택지처럼 들여쓴 줄은 질문 하나에 딸린 것이라 세지 않는다', '정할 것\n1. 광고 위치\n   - a. 위\n   - b. 아래\n2. 문구\n', 2],
      ['결정할 것 이름도 같게 센다', '### 결정할 것\n1. 하나\n', 1],
      ['없음이라고 적으면 0이다', '정할 것: 없음\n', 0],
      ['다음 제목을 만나면 멈춘다', '정할 것\n1. 하나\n알아 둘 것\n- 위험\n- 위험 둘\n', 1],
      ['문장 속에 나온 정할 것은 제목이 아니므로 세지 않는다', '정할 것은 두 가지입니다.\n- 하나\n- 둘\n', 0],
    ];
    for (const [name, text, want] of cases) {
      it(name, () => {
        assert.equal(countDecisionLines(text), want);
      });
    }
  });

  function build() {
    const env = setup();
    const msg = (sec, id, text) => ({ type: 'assistant', timestamp: at(sec), message: { id, content: [{ type: 'text', text }] } });
    const toolOnly = (sec, id) => ({ type: 'assistant', timestamp: at(sec), message: { id, content: [{ type: 'tool_use', id: `t-${id}`, name: 'Read', input: {} }] } });
    writeSession(env, [
      prompt(0, '첫 요청'),
      msg(10, 'mid', '정할 것\n1. 중간 글의 질문은 최종 보고가 아니다\n'),
      toolOnly(20, 'tool1'),
      toolResult(30, 't-tool1'),
      msg(40, 'final1', '끝냈습니다.\n\n정할 것\n1. 광고를 붙일지\n2. 색을 바꿀지\n   - a. 파랑\n\n알아 둘 것\n- 위험\n'),
      prompt(100, '두 번째 요청'),
      msg(110, 'final2', '끝냈습니다.\n'),
    ]);
    const other = path.join(env.claude, 'projects', '-other');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, `${OTHER_SESSION}.jsonl`), jsonl([{ ...prompt(0, '다른 프로젝트'), cwd: '/other/place' }, msg(10, 'o1', '정할 것\n1. 다른 곳 질문\n2. 하나 더\n3. 또 하나\n')]));
    const asks = path.join(env.root, 'permission-asks.jsonl');
    const ask = (sec, hook, cwd = '/work/proj') => JSON.stringify({ ts: at(sec), hook, cwd, reason: 'r' });
    fs.writeFileSync(asks, [ask(5, 'guard-a'), ask(50, 'guard-a'), ask(60, 'guard-b'), ask(70, 'guard-a', '/other/place'), ask(-86400 * 40, 'guard-a'), '깨진 줄'].join('\n') + '\n');
    return { env, asks };
  }
  const args = (b, extra = []) => ['asks', '--since', '2026-10-01', '--now', '2026-10-31', '--asks-file', b.asks, ...extra];

  it('중간 글이 아니라 최종 보고의 정할 것 줄과 확인 창을 합쳐 센다', () => {
    const b = build();
    const r = b.env.run(args(b, ['--project', '/work/proj']));
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /최종 보고\s+정할 것 있는 보고\s+정할 것 줄\s+확인 창/);
    assert.match(r.out, /\d{4}-\d{2}-\d{2}\s+2\s+1\s+2\s+3/);
    assert.match(r.out, /정할 것이 있는 보고 1건당 평균 2.00줄/);
    assert.match(r.out, /정할 것 2줄 \+ 확인 창 3건 = 5건/);
    assert.match(r.out, /guard-a 2, guard-b 1/);
  });

  it('기간 밖의 확인 창과 깨진 줄은 세지 않는다', () => {
    const b = build();
    const r = b.env.run(args(b, ['--project', '/work/proj', '--since', '2026-10-11']));
    assert.match(r.out, /정할 것 0줄 \+ 확인 창 0건 = 0건/);
  });
});

describe('사용법', () => {
  it('하위 명령이 없거나 모르는 것이면 사용법을 찍고 실패한다', () => {
    const env = setup();
    for (const args of [[], ['nope'], ['budget'], ['budget', 'start']]) {
      const r = env.run(args);
      assert.equal(r.code, 1);
      assert.match(r.err, /사용: /);
    }
  });
});
